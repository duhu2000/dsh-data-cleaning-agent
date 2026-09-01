# Spike #1：本地 tarball 双版本安装验证

- 状态：PASS（双基线通过）
- 日期：2026-08-31
- 相关：`docs/adr/0001-dsh-baseline.md`、`PLAN-REVIEW.md`
- 产物目录：`spike1/`（本 Spike 的可复现产物与隔离 home，全部位于工作区，可整体删除）

## 目标

在两条 DSH 基线（`0.1.1-rc.2` 本机 / `0.1.2-alpha.2` 官方 alpha）上，用一个**最小 Bundle 插件 tarball** 完成：

1. `dsh plugin --profile <名> add <tarball>` 可安装；
2. `--dump-config` 可见本插件的 `insert` 层；
3. 受限启动能打印插件的 `apply()` 标记（证明插件被真实挂载）；
4. `remove` 后 profile 回归干净、`--dump-config` 仍健康；
5. 全程不污染正在运行 GUI 的 `~/.dsh/profiles/web`（用隔离 `DSH_HOME` 实现）。

## 环境

| 项 | 值 |
|---|---|
| Node | v25.9.0（Homebrew） |
| pnpm | 11.7.0（DSH Desktop runtime-commands） |
| rc.2 CLI | `/opt/homebrew/bin/dsh` → `@deepseek-ai/dsh@0.1.1-rc.2` |
| alpha.2 CLI | `spike1/cli-alpha2/node_modules/@deepseek-ai/dsh/lib/bin.js` → `0.1.2-alpha.2`（`pnpm add @deepseek-ai/dsh@0.1.2-alpha.2` 隔离安装） |
| npm alpha tag | `@deepseek-ai/dsh` 的 `alpha` tag = `0.1.2-alpha.2`（registry 已确认） |

## 方法

最小插件 = 三件套（见 `spike1/plugin/`）：

- `package.json`：`dsh.bundle.patch = "./cordis.patch.yml"`，`main: lib/index.js`；
- `cordis.patch.yml`：`- insert: [{ id: data-cleaning-agent, name: '@qcc/dsh-data-cleaning-agent', config: { provider: mock } }]`；
- `lib/index.js`：导出 `name` / `inject` / `apply(ctx)`，`apply` 打印唯一标记。

打包：`pnpm pack --pack-destination ..` → `qcc-dsh-data-cleaning-agent-0.0.1-spike1.tgz`（621 字节）。

安装命令（以 rc.2 为例，alpha.2 仅换 `BIN` 与 `DSH_HOME`）：

```bash
export DSH_HOME="$WS/home-rc2"          # 隔离 home，不碰 ~/.dsh
export npm_config_store_dir="$WS/.pnpm-store"
export npm_config_virtual_store_dir="$WS/.pnpm-virtual-store"
export npm_config_cache="$WS/.npm-cache"

dsh plugin --profile spike1-rc2 add "$WS/qcc-dsh-data-cleaning-agent-0.0.1-spike1.tgz"
dsh --profile spike1-rc2 --dump-config
# 受限启动（8s watchdog，断言 apply 标记）
dsh plugin --profile spike1-rc2 remove @qcc/dsh-data-cleaning-agent
dsh --profile spike1-rc2 --dump-config
```

## 结果

| 验收项 | rc.2 (0.1.1-rc.2) | alpha.2 (0.1.2-alpha.2) |
|---|---|---|
| CLI `--version` | `0.1.1-rc.2` | `0.1.2-alpha.2` |
| `plugin add` | exit 0 | exit 0 |
| 对账后 `dsh.profile.bundles` | `[base, @qcc/dsh-data-cleaning-agent]` | `[base, @qcc/dsh-data-cleaning-agent]` |
| `--dump-config` 见 insert 层 | ✅ 行 314–318（`id: data-cleaning-agent` / `provider: mock`） | ✅ 行 339–343（同） |
| 启动 `apply()` 标记 | ✅ 打印（watchdog kill，非崩溃） | ✅ 打印（同） |
| `plugin remove` | exit 0；deps 清空、bundles 回 `[base]` | exit 0；同上 |
| remove 后 `--dump-config` | exit 0，0 条插件残留 | exit 0，0 条插件残留 |

## 机制要点（可复用事实，写入 ADR）

1. **安装 = 依赖 + 声明**：`dsh plugin --profile <名> add <pkg>` 本质是"在 profile 目录内转发 pnpm + 对账"——某依赖若声明了 `dsh.bundle.patch`，就会被自动追加进 `dsh.profile.bundles` 成为 profile 层；`remove` 则自动摘除。因此插件可走 registry 名、`file:`、tarball 三种 spec 安装，无独立"插件注册表"。
2. **`--dump-config` 不启动、不执行 JS**：它只做 patch 层组合渲染，适合做"安装是否可见"的快速断言；真实挂载需受限启动 + 观察 `apply()` 标记。
3. **`DSH_HOME` 可隔离**：`resolveDshHome` 优先级为「显式配置 > `$DSH_HOME` > `~/.dsh`」，因此 Spike 全部用独立 `DSH_HOME`，与运行中 GUI 完全解耦。
4. **两条基线 CLI 面一致**：`plugin` 子命令、`--dump-config`、`--dump-default-config`、`--patch` 在 rc.2 与 alpha.2 完全相同，本 Spike 无版本分叉代码路径。
5. **alpha.2 原生构建脚本被 pnpm 忽略**（`node-pty`/`koffi`/`protobufjs`/`subprocess-local`/`@google/genai`）：只影响原生依赖，不影响纯 JS 的 `--dump-config` 与插件 `apply` 路径；后续做完整 UI/远程通路 Spike 时需 `pnpm approve-builds` 放行相关脚本。

## 结论与后续

- **Spike #1 通过**：最小 Bundle 的"安装 / 可见 / 挂载 / 卸载"在 `0.1.1-rc.2` 与 `0.1.2-alpha.2` 双基线上一致可用，未发现 rc.2 需要为此保留额外兼容分支的必要性。
- **对 ADR 的裁决输入**：rc.2 的"工具/Skill 可注册"最小兼容成本极低（安装机制同源）；是否继续保留 rc.2 兼容，仍待 Spike #2（Host/Client Bridge）给出成本结论后一并裁决。
- **下一步**：Spike #2（Host/Client Bridge）——在最小插件上补 `dsh.client.inject` + 一个 web 端点/UI 探针，验证 Host 与 Web Client 的双向桥；其结果与本次一并决定 rc.2 是否保留。

## 可复现

- 产物目录 `spike1/` 含：`plugin/`（源码）、`*.tgz`、`home-rc2/`、`home-alpha2/`、`cli-alpha2/`（alpha.2 隔离安装）、`.pnpm-store/`、`.npm-cache/`。
- 全部位于工作区内，验证完毕可整体删除，无对外副作用。

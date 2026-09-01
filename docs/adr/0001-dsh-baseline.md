# ADR-0001：DSH 目标基线

- 状态：Accepted（POC 阶段基线；未过 POC Gate 前不进入真实 MVP）
- 日期：2026-08-31
- 相关：`PLAN-REVIEW.md`（核对纪要）、`docs/COMPATIBILITY.md`

## 背景

"数据清洗补全智能体"需以 DeepSeek Harness（DSH）插件形态实现。DSH 尚处预发布阶段，本机与官方最新预发布存在差异，必须先冻结开发基线，避免在错误版本上返工。

## 已验证事实（本机 + 一手来源）

1. 本机 DSH **框架 npm 包线**为 `0.1.1-rc.2`（`app.asar.unpacked/package.json` 中全部 `@deepseek-ai/*` 依赖精确 pin 为 `0.1.1-rc.2`）。
2. 官方最新预发布为 **`v0.1.2-alpha.2`**（官方 tag：https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2）。
3. ApiProxy → `@Remote` 网关的迁移**方向属实**：本机 rc.2 同时存在 `@deepseek-ai/dsh-host-apiproxy`（`ctx.apiProxy`）与 `@deepseek-ai/dsh-api-remotes`（`ctx.remote`）。**"alpha.1 移除 ApiProxy" 的精确时点未经官方 release notes 逐字核对**，在本 ADR 通过前仅按"迁移进行中"处理，不作"rc.2 已无 ApiProxy"的断言。
4. 插件可安装契约：需声明 `dsh.bundle.patch`（`cordis.patch.yml`）+ `dsh.client.inject`（参考 `mcp-connector-plugin-release-0.2.32`）。**安装机制已实测**（Spike #1）：`dsh plugin --profile <名> add <pkg>` 是在 profile 目录内转发 pnpm 并按"依赖是否声明 `dsh.bundle.patch`"对账 `dsh.profile.bundles`；插件即"声明了 bundle patch 的依赖"，支持 registry / `file:` / tarball 三种 spec，无独立插件注册表。
5. 模型工具注册：`ctx.tools.register(definition)`；内嵌 Skill 注册：`ctx.skills.register(skill)`。
5a. **Spike #1 已实测通过**：最小 Bundle（`package.json` + `cordis.patch.yml` + `lib/index.js` 导出 `name/inject/apply`）在 `0.1.1-rc.2` 与 `0.1.2-alpha.2` 双基线上均可"安装→`--dump-config` 可见 insert 层→受限启动打印 `apply()` 标记→`remove` 回归干净"。两条基线 CLI 面（`plugin` 子命令、`--dump-config`、`--dump-default-config`、`--patch`）完全一致。详见证词 `docs/spike-1-tarball-install.md`。
5b. **Spike #2 已实测通过**：`dsh.client`（`platform: web`）+ `exports["./client"]` + `window.__ModuleLoader__.load({id, factory})` 的双面契约在双基线上同构——Host 半区 `ctx.inject(['webServer','webRuntime'])` 挂路由成功，client bundle 被扫描进 `__DSH_BOOT__` 并物化，`apply()` 真实执行，Host→Client（fetch）与 Client→Host（POST）双向回环 PASS。详见证词 `docs/spike-2-host-client-bridge.md`。
5c. **唯一实质差异在 web 外壳服务层**（Spike #2 实测）：rc.2 根 HTML 无 token 直接 200、client bundle 走**单包** `/plugins/<id>/client.js?rev=…`；alpha.2 根 HTML 需 **token**（无 token→401、带 token→303 落地）、client bundle 走**组合端点** `/plugins/??<id>/client.js&rev=…`（单包 URL 404）。**插件自身挂载的路由（如 `/data-cleaning/api/*`）在双基线均无 token 门禁、直接 200**，故该差异不影响插件业务路由；仅当插件依赖"无门禁外壳"或"缓存 client bundle URL 形态"时才需按基线分支处理。alpha.2 的 profile 清单另多 `dsh.profile.patchReload: "live"` 字段（rc.2 无），行为未验证，仅记录。
5d. **Spike #3 已实测通过（文件边界 seam 双基线同构）**：web profile 默认即提供 `ctx.fs`（`@deepseek-ai/dsh-fs-sandbox`，与 `dsh-tool-fs` 同 `fs` 服务）、`ctx.storage`/`ctx.storageDomain`（本次仅验 present，写路径留 Spike #4）与 `ctx.tools`；`fs.sandboxMode` 双基线均为 `workspace-write`。实测链路：专用上传路由 → `fs.resolve` → `fs.writeText`（原子写，返回 version）→ `fs.readBytes(maxBytes)` 有界读回 → CSV 解析 → **仅回摘要不回原文**。边界负例：`readBytes` 上限强制（`FS_TOO_LARGE`）、cwd 之外越界写拒绝（`FS_SANDBOX_DENIED`）、`/tmp` 平台临时区放行——与本环境 `workspace-write` 语义一致。XLSX 解析需引入第三方依赖，属实现细节而非 DSH seam 分歧，不阻塞基线。详见证词 `docs/spike-3-file-boundary.md`。
5e. **Spike #4 已实测通过（Job / Storage seam 双基线同构）**：web profile 默认即提供 `ctx.jobs`（`dsh-jobs-local`，服务 id `jobs`）与 `ctx.storage`/`ctx.storageDomain`（`dsh-storage` hub + `dsh-storage-json` backend + `dsh-storage-domain` facility，backend `json` 落盘 `DSH_HOME/storages/<domain>.json`）。Job 生命周期实测：`start`→`wait`（终端态 `completed|killed|failed`）→`read({text,snapshot})`→`kill`（detail 透传）→`list(caller)`；**owner/controller 门禁**：host bundle 直接 `start()` 抛 `no job controller serves this agent`，需自行 `ctx.jobs.attachController()` 后放行（本 spike 用 owner=undefined 的无主 job 验证）。Storage 实测：`open(spec)` → `table().put/get/update/delete/entries/size` 串行写链、单开保护（`already-open`）、关后重开读回、**schema 校验只在 `open()` 的 `loadAll()` 阶段**（违例 → `invalid-record`，版本不符 → `version-mismatch`，写路径不重校验）、跨进程重启恢复（seed→重启→read `recovered:true`）。落点：清洗任务持久化状态机用 `ctx.storageDomain`，轻量后台执行用 `ctx.jobs`；归因到 agent 会话的长任务需 `dsh-tool-jobs` 在 agent 组合内，留 Spike #5。详见证词 `docs/spike-4-job-storage.md`。
5f. **Spike #5 已实测通过（工具闭环 seam 双基线同构）**：`ctx.tools`（`@deepseek-ai/dsh-tools`，`ToolRuntime`）`register` 仅校验 `output.render` 为函数 + `output.schema` 过 `assertSupportedJsonSchema`（纯 JSON Schema 子集）+ `name !== "run_code"`，**不**校验 `parameters`（那层在 `defineTool` 的 `parameterSchemaSpecToJsonSchema`）；`schemas()` 返回模型投射 `{name,description,parameters}`，`execute(exec)` 需 `{callId,name,signal,arguments}`（lossless JSON，deepFrozen），直接调度自定义工具不触发 code-mode 折叠（`defaultMode="native"`），无 guard 时默认放行不弹审批。`ctx.skills`（`@deepseek-ai/dsh-skill`）`register` 要求 name 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`、`description` 非空，runtime skill 的 `get()` 要求 **`source`（字符串）+ `content`（字符串）都 truthy**。三步闭环实测：注册内嵌 Skill（正文指向工具名）→ `skills.list()/get()` 读回 `bodyHasToolName:true` → `tools.execute` 调度 1000 行 Mock 脏数据返回 `total:1000/kept:600/dropped:400/badMissing:200/badAmount:200`。**关键踩坑**：手写 definition 的 `output.schema`/`parameters` 必须用对象级 `required: [key]` 数组，把 `required:true` 写进 property 内部会触发 `required is not supported on type ...`；直接 `tar -czf` 打包缺 `package/` 前缀会导致 pnpm 解成扁平目录（`lib/index.js` 缺失），须用 `pnpm pack`。插件路由双基线均无 token 门禁、`sec-fetch-site:cross-site` 被 `isTrusted` 拒为 403。详见证词 `docs/spike-5-tool-skill.md`。
5g. **Spike #6 已实测通过（端到端接真实模型，双基线同构）**：headless 一次性任务（`dsh --profile headless "<task>"`）在 rc.2 与 alpha.2 上均跑通完整闭环——真实 LLM 经 agent 回路**自主**执行 `skill("data-cleaning")` 加载内嵌 Skill → 按 Skill 正文调度 `data_clean_rows` → 工具真实执行（`execute` 落地日志 `total=5 kept=2 dropped=3 badMissing=1 badAmount=2`）→ 模型只回摘要不回原文，`exit=0`。session JSONL 的 `tool/call` 序列双基线一致（`skill` → `data_clean_rows`）。关键工程点：headless 合成树无 `webServer`/`webRuntime`，插件 web 半区用 `ctx.get(name) !== undefined` 做存在性守卫（缺服务时 `ctx.get` 返回 `undefined` 不抛，规避 spike5 踩过的异步 fiber 失败）；真实 API key 仅注入子进程 env（`dsh-credentials-local` 先查进程环境变量），不落盘不回显。至此 Spike #1–#6 全部 PASS，五条 seam + 一条活 LLM 回合闭环在双基线上实测同构，无未展开 Spike。详见证词 `docs/spike-6-end-to-end.md`。
6. **两个"版本"概念必须区分**：
   - `@deepseek-ai/*` 框架包线：`0.1.1-rc.2`（本机）；
   - Desktop 启动器（launcher）：`dsh-plugin-desktop@2.0.2`（本机），独立于框架包线。
7. 本机 DSH Desktop `engines`：`^22.19.0 || >=24.0.0`。CI 矩阵以 **Node 22 / 24** 为准收敛，不再对 Node 20 做承诺。

## 决策

- **POC 双基线**：`0.1.1-rc.2`（本机可用）与 `0.1.2-alpha.2`（官方最新预发布）并行验证。
- **完整 UI 基线优先 `0.1.2-alpha.2` @Remote**；`0.1.1-rc.2` 仅承诺"工具/Skill 可注册"的最小兼容，是否保留由 Spike #1/#2 的成本结论裁决。
- **前置顺序（已更新）**：Spike #1（Bundle 安装）**已通过**、Spike #2（Host/Client Bridge）**已通过**、Spike #3（文件边界）**已通过**、Spike #4（Job/Storage）**已通过**、Spike #5（工具闭环）**已通过**、Spike #6（端到端接真实模型）**已通过**，六条关键通路双基线实测同构（含一条活 LLM 回合闭环），rc.2 兼容成本未发现异常——**最终裁决：保留 rc.2 最小兼容**（工具/Skill 可注册 + 工具可调度 + Host/Client 桥可用 + 文件边界 seam 可用 + Job/Storage seam 可用 + 真实模型端到端闭环可用）。已知的 web 外壳服务层差异（见 5c）不影响插件自身路由，暂不作基线分支。无剩余待展开 Spike。
- 所有"alpha 版本变更"类表述一律标注来源（官方 release notes / 本机实测），不得引用二手报道作为事实依据。

## 后果

- 正：POC 期间即可在本机 rc.2 上跑通工具/Skill，同时用 alpha.2 验证未来完整 UI 通路；风险前移、返工可控。
- 负：双基线增加 Bridge 抽象与 CI 矩阵成本；若 Spike 证明 rc.2 兼容成本过高，则砍掉 rc.2 兼容，仅保留 alpha.2 完整 UI。
- 负：alpha.2 属预发布，其 `@Remote` 契约仍可能变动，需在 COMPATIBILITY 表持续跟踪，不得在产品文档或对外材料中当作稳定 API 引用。

## 替代方案

- **仅 rc.2**：本机可用、零升级成本，但基于已迁移前的 ApiProxy，未来迁移成本后置，POC 结论可能作废。
- **仅 alpha.2**：直接面向未来，但本机不可直接验证，且预发布契约不稳定。
- 结论：选双基线 + Spike 裁决，兼顾可验证性与前瞻性。

## 记录：MVP 已落地（2026-08-31）

Spike #1–#6 全部 PASS 后，按本 ADR 冻结的基线完成 `@qcc/dsh-data-cleaning-agent@0.1.0-mvp` 开发并双基线验证通过。要点：

- 引擎（CSV/XLSX/JSON 解析、清洗/补全/画像，13 例单元测试全过）、三个模型工具、内嵌 `data-cleaning` Skill、Job/Storage 状态机、Web 路由 + UI、Client 半区 seam 全部落地。
- 双基线 Web 冒烟：`/data-cleaning/api/mvp/*`（seam/parse/clean/complete/profile/jobs/job）rc.2(43136) 与 alpha.2(43137) 全部 200/202。
- 双基线 headless 真实模型端到端：rc.2 与 alpha.2 均 `exit=0`，模型自主加载 Skill → 调度工具 → 只回摘要不回原文；alpha.2 session 记录 `skill` + `data_clean_rows`×13 + `data_profile`×10 + `data_complete_rows`×1。
- 关键修正（均已回写源码并重验）：web 半区存在性守卫改用 `ctx.inject([...])`；inject 数组补 `jobs`/`storageDomain`；cordis Logger 用 `.info`（无 `.log`）；job 详情路由去尾斜杠（最长前缀匹配）。
- 详见 `docs/mvp.md`。不对外发布、未建 GitHub 仓库、未触碰生产 profile。

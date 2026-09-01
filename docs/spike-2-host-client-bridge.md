# Spike #2：Host/Client Bridge 验证

- 状态：PASS（双基线双向桥通过；发现 1 处版本差异）
- 日期：2026-08-31
- 相关：`docs/adr/0001-dsh-baseline.md`、`docs/spike-1-tarball-install.md`
- 产物目录：`spike2/`

## 目标

在 Spike #1 最小 Bundle 基础上补全 **Host↔Client 双向桥**，在两条基线上验证：

1. Host 半区通过 `ctx.inject(['webServer','webRuntime'])` 挂载同源 HTTP 路由；
2. 包声明 `dsh.client`（`platform: web`）+ `exports["./client"]` 后，client bundle 被发现并服务；
3. client 半区经 `window.__ModuleLoader__.load` 注册 factory，`apply()` 真实物化；
4. 数据双向流动：Host→Client（fetch hello）与 Client→Host（POST echo）。

## 探针结构

- `plugin/package.json`：`dsh.bundle.patch` + `dsh.client = { inject: [], platform: "web" }` + `exports["./client"]`。
- `plugin/lib/index.js`：host 半区，`apply()` 打标记并注入 `webServer`/`webRuntime` 后挂路由。
- `plugin/lib/web.js`：挂 `/data-cleaning/api/hello`（GET）与 `/data-cleaning/api/echo`（POST），loopback+同源信任 fence。
- `plugin/lib/client.js`：`window.__ModuleLoader__.load({id, factory})`，`apply()` 打标记 → fetch hello → POST echo，结果存 `window.__SPIKE2_BRIDGE__`。
- `client-harness.mjs`：本环境无 browser provider，用 Node shim（`window.__ModuleLoader__` + `fetch` 指向运行中的服务器）物化 client factory 并跑真实 `apply()`，验证双向回环。

## 结果矩阵

| 验收项 | rc.2 (0.1.1-rc.2) | alpha.2 (0.1.2-alpha.2) |
|---|---|---|
| `plugin add` 进 web profile | exit 0 | exit 0 |
| 对账 `dsh.profile.bundles` | `[base, web-app, @qcc/...]` | `[base, web-app, @qcc/...]`（另有 `patchReload: live`） |
| `--dump-config` 见 insert 层 | ✅ | ✅ |
| host `apply()` 标记 | ✅ | ✅ |
| Host 路由 hello / echo | ✅ 200（无 token） | ✅ 200（无 token） |
| client bundle 被发现 | ✅ 单包 URL `/plugins/@qcc/.../client.js?rev=…` | ✅ 组合端点 `/plugins/??…/client.js&rev=…` |
| client `apply()` 物化 | ✅（shim 真实执行） | ✅（shim 真实执行） |
| Host→Client + Client→Host 回环 | ✅ PASS | ✅ PASS |

## 关键发现（写入 ADR）

1. **web shell 服务层有版本差异**：
   - rc.2：根 HTML 直接 200，`__DSH_BOOT__` 直接内联；client bundle 走**单包** `/plugins/<id>/client.js?rev=…`，**无 token 门禁**。
   - alpha.2：根 HTML 需 **token**（无 token → 401；带 token → 303 落地到 200 页面）；client bundle 走**组合端点** `/plugins/??<id>/client.js&rev=…`（多个 bundle 合并服务），单包 URL 404。
2. **插件自身挂载的路由不受 token 门禁影响**：两条基线上 `/data-cleaning/api/*` 均无 token 直接 200（信任 fence 只验 loopback+同源）。即"web 外壳的门禁差异"与"插件业务路由"是解耦的两层。
3. **`dsh.client` 双面契约双基线同构**：`platform: web` + `exports["./client"]` + `window.__ModuleLoader__.load({id, factory})` 在两条基线都被正确扫描进 `__DSH_BOOT__` 并物化，`apply()` 签名（`(ctx)`）与 `inject` 数组一致。
4. **alpha.2 profile 清单多一个字段** `dsh.profile.patchReload: "live"`（rc.2 无）——仅记录差异，本 Spike 未验证其行为。
5. **本环境限制**：browser provider 未注册，client 半区物化用 Node shim 代替真实浏览器执行；真实浏览器内 `window.__DSH_BOOT__` 解析路径已通过"根 HTML 含本插件 boot 条目 + bundle 端点 200"间接验证。

## 结论

- **Spike #2 通过**：最小 Bundle 的 Host↔Client 双向桥在 `0.1.1-rc.2` 与 `0.1.2-alpha.2` 上均可用；`dsh.client` 双面契约、Host web 路由挂载、client factory 物化与双向数据流全部同构。
- **唯一实质差异在 web 外壳服务层**（token 门禁 + `/plugins/??` 组合端点 vs 单包 URL），且**不影响插件自身路由**，故不构成 rc.2 兼容的阻断项；但若插件要"读取/缓存 client bundle 的 URL 形态"或依赖无门禁的外壳，需按基线分支处理。
- 结合 Spike #1：**"插件可安装契约"与"Host/Client Bridge"两条关键通路双基线实测通过**，rc.2 保留兼容的边际成本未出现异常。

## 可复现

- 产物目录 `spike2/` 含：`plugin/`（三半区源码）、`*.tgz`、`home-rc2/`、`home-alpha2/`、`client-harness.mjs`、两份 boot 日志。全部位于工作区内，验证完毕可整体删除。
- 命令序列：`dsh plugin --profile web add <tgz>` → `dsh --profile web --port <p> --no-open` → curl hello/echo → 解析根 HTML 取 boot 条目 → curl bundle 端点 → `node client-harness.mjs`。

# 兼容性 / Compatibility

## 1. 目标基线

本插件面向 DeepSeek Harness（DSH）预发布阶段，双基线验证：

| 基线 | 框架 npm 包线 | 备注 |
| --- | --- | --- |
| rc.2 | `0.1.1-rc.2` | 本机 Desktop 内置；web 冒烟端口 43136 |
| alpha.2 | `0.1.2-alpha.2` | 官方最新预发布；web 冒烟端口 43137 |

> 生产 GUI（`http://127.0.0.1:43120`）不用于验证，验证一律使用隔离 `DSH_HOME` + 专用端口。

## 2. Node 运行时

- 本包 `engines.node` 声明 `>=20`。
- CI 矩阵按 ADR-0001 收敛为 **Node 22 / 24**（本机 Desktop `engines` 为 `^22.19.0 || >=24.0.0`）。

## 3. 契约面（Spike #1–#7 已实测）

| 契约 | 用法 | 备注 |
| --- | --- | --- |
| 插件注册 | `dsh.bundle.patch` → `cordis.patch.yml`（`insert` 插件行）+ `dsh.client` | 包声明 `dsh` 字段 |
| 模型工具 | `ctx.tools.register` | 需 `output.render` 返回 content 块数组 + `output.schema`；`required` 为对象级；name 不得为 `run_code` |
| 内嵌 Skill | `ctx.skills.register` | name `^[a-z0-9]+(?:-[a-z0-9]+)*$`，非空 description，get() 返回 truthy |
| 服务注入 | `ctx.inject([...])` | 访问未注入服务会抛 `cannot get property "x" without inject`；inject 数组必须列全 |
| Logger | `ctx.logger` | 仅 `error/info/warn/debug`，无 `.log` |
| 任务 | `ctx.jobs` | `attachController('data-cleaning-agent-mvp')` 后 `start({kind,label,run})` |
| 存储 | `ctx.storageDomain` | `open({name,version,tables})` → `table('jobs')` |
| web 路由 | `webServer.register({kind:'prefix', path, handler})` | 最长前缀匹配；前缀需以 `/` 结尾且匹配 `pathname.startsWith(prefix + '/')` |
| 同源守卫 | `isTrusted(req)` | `sec-fetch-site !== 'cross-site'` 且 origin 为 127.0.0.1/localhost |
| 程序化工具调用 | `ctx.tools.get()` + `ctx.tools.execute()` | S7 双基线验证；每次调用重新解析，不缓存动态 MCP 工具 |

## 4. 与企查查 MCP OAuth 插件的共存

| | `qcc-dsh-mcp-oauth` | 本插件 |
| --- | --- | --- |
| 工具名前缀 | `qcc_oauth_*` + `mcp__qcc-*` | `data_clean_rows` / `data_complete_rows` / `data_profile` |
| Skill | — | `data-cleaning`、`enterprise-enrichment` |
| 存储域 | 自有 grant store | `dc_tasks_v1` |
| 能否共存 | ✅ | ✅（工具名 / Skill 名 / 存储域 / 条目 id 全独立） |

- `enterprise-enrichment` Skill 本身**不重造 OAuth**：它只调用
  `qcc_oauth_status` / `qcc_oauth_connect`（由 qcc-dsh-mcp-oauth 提供）与
  `mcp__qcc-company__*` / `mcp__qcc-risk__*`（授权成功后由 mcp-client 动态提供）。
- 若 qcc-dsh-mcp-oauth 未安装或未授权，`enterprise-enrichment` Skill 的第一步
  `qcc_oauth_status` 即会中断并引导用户先连接，不会假装补全。
- G5 Host Bridge 不读取 grant/token，也不访问 mcp-client 私有 client；只经共享 `ctx.tools`
  调用动态注册的 `mcp__qcc-*` 工具。G5-2 增加幂等、候选续跑、人工重试与安全审计；
  run 明细仅驻留 Host 内存。Mock/Contract 已通过，真实 OAuth 刷新与 QCC E2E 尚未验收。

## 5. 已知限制

- alpha.2 的 `@Remote` 契约仍可能变动，本包不对其作稳定 API 承诺。
- web 半区仅 web 组合可用；headless 组合自动跳过（工具与 Skill 仍注册）。
- XLSX 解析依赖 `xlsx`（懒加载），缺失时返回 `XLSX_UNAVAILABLE` 而非崩溃。
- `/data-cleaning/api/g5/enrich` 当前为 Unreleased 能力，单批上限 100 行、并发上限 4，
  且必须显式 `confirmPaidCalls:true` 和唯一 `idempotencyKey`；未完成真实 E2E 前不作生产可用承诺。

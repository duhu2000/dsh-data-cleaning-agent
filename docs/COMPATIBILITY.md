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

## 3. 契约面（Spike #1–#6 已实测）

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

## 4. 与企查查 MCP OAuth 插件的共存（规划）

| | `qcc-dsh-mcp-oauth` | 本插件 |
| --- | --- | --- |
| 工具名前缀 | `qcc_oauth_*` + `mcp__qcc-*` | `data_clean_rows` / `data_complete_rows` / `data_profile` |
| 存储域 | 自有 grant store | `dc_tasks_v1` |
| 能否共存 | ✅ | ✅（工具名 / 存储域 / 条目 id 全独立） |

## 5. 已知限制

- alpha.2 的 `@Remote` 契约仍可能变动，本包不对其作稳定 API 承诺。
- web 半区仅 web 组合可用；headless 组合自动跳过（工具与 Skill 仍注册）。
- XLSX 解析依赖 `xlsx`（懒加载），缺失时返回 `XLSX_UNAVAILABLE` 而非崩溃。

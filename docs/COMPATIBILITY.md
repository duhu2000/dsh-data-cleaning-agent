# 兼容性 / Compatibility

## 1. 目标基线

本插件面向 DeepSeek Harness（DSH）预发布阶段，双基线验证：

| 基线 | 框架 npm 包线 | 备注 |
| --- | --- | --- |
| rc.2 | `0.1.1-rc.2` | 本机 Desktop 内置；web 冒烟端口 43136 |
| alpha.2 | `0.1.2-alpha.2` | 官方最新预发布；web 冒烟端口 43137 |

> 生产 GUI（`http://127.0.0.1:43120`）不用于验证，验证一律使用隔离 `DSH_HOME` + 专用端口。

2026-09-01 的 0.4.0 发布内容已分别在 rc.2（43153）和 alpha.2（43154）
隔离 Host 完成 tarball 加载冒烟，两者均返回 `enrichSkillRegistered:true`；测试进程已停止。

2026-09-03 已发布的 0.5.0 在 rc.2（43136）与 alpha.2（43137）完成 24/24 零调用 Host 冒烟：
MVP 路由、Phase-3 capabilities、estimate 与未确认 enrich 阻断均通过。rc.2 另完成实际工作台渲染、
中文企业名称映射和本地清洗闭环；alpha.2 仍只定位为兼容探针。

0.5.1 为已发布的 README 状态与发布 Gate 文档补丁，不修改 Host/Client、QCC 契约或运行时依赖，
因此继承 0.5.0 的 DSH、Node 与 OAuth 兼容矩阵。

0.5.2 已发布版本只调整 Client UI：入口 Portal 到 `sidebar.workspaces` 前，中央区域复用 DSH 原生会话，
五能力入口使用公开 `conversation.input.left`，会话头恢复入口使用公开
`conversation.session.header.actions`，右侧面板继续使用 additive `shell.overlay`。不替换单占位
`details` / `conversation.session.header`，也不修改 Host、QCC 工具契约或计费安全门。

0.5.3 正式版本修正第二轮 UI 位置：五能力入口迁到公开 `conversation.input.dock`，只使用稳定
`data-slot` 和 `:has()` 把本插件 cell 排到输入框下方；提示词生成器使用公开
`conversation.input.overlay` 和标准 `inputActions.setDraft`。DSH 未提供公开 Hero headline 槽位，
因此仅对插件创建且仍为空白的会话使用精确中英文文本匹配、卸载恢复的 DOM Bridge。图片接入对
`conversation.createDraftImages` / `input.shell(sessionId).addImages` 做运行时探测，视为隔离兼容层，
不承诺 alpha 实验面稳定。

2026-09-04 的未发布 v2 工作流在 rc.2（43190）与 alpha.2（43191）完成最新本地 tarball
隔离安装：两条基线均创建 `dc_workflows_v2` 任务与结果/异常 CSV+XLSX 四类制品，停止并重启 Host
后可按原 taskId 下载，XLSX 反向解析工作表为“清洗补全结果”。稳定发布判断仍以 rc.2 为主，
alpha.2 只作兼容探针。全程未触碰生产 43120，未调用 QCC。

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
| 工具名前缀 | `qcc_oauth_*` + 规范 `mcp__qcc-*`；0.1.7 实测为 legacy `mcp__company__*` 等 | `data_clean_rows` / `data_complete_rows` / `data_profile` |
| Skill | — | `data-cleaning`、`enterprise-enrichment` |
| 存储域 | 自有 grant store | `dc_tasks_v1` + `dc_workflows_v2` |
| 能否共存 | ✅ | ✅（工具名 / Skill 名 / 存储域 / 条目 id 全独立） |

- `enterprise-enrichment` Skill 本身**不重造 OAuth**：它只调用
  `qcc_oauth_status` / `qcc_oauth_connect`（由 qcc-dsh-mcp-oauth 提供）与
  `mcp__qcc-company__*` / `mcp__qcc-risk__*`（授权成功后由 mcp-client 动态提供）。
- 若 qcc-dsh-mcp-oauth 未安装或未授权，`enterprise-enrichment` Skill 的第一步
  `qcc_oauth_status` 即会中断并引导用户先连接，不会假装补全。
- G5 Host Bridge 不读取 grant/token，也不访问 mcp-client 私有 client；只经共享 `ctx.tools`
  调用动态注册的 `mcp__qcc-*` 工具。G5-2 增加幂等、候选续跑、人工重试与安全审计；
  run 明细仅驻留 Host 内存。Bridge 会把 OAuth 0.1.7 的 legacy `mcp__company__*` / `mcp__history__*`
  映射到规范名称，并在 capabilities 中同时报告两者。
- 0.5.0 三域 Bridge 同时兼容 `mcp__qcc-{risk,ipr,operation}__*`、OAuth 0.1.7 实测 legacy
  `mcp__{risk,ipr,operation}__*` 与内部短名；输出始终记录规范 `sourceTool` 和实际 `runtimeTool`。

### 4.1 2026-09-01 rc.2 实测结论

- fresh Profile 必须显式安装与 Host 同版本的 `@deepseek-ai/dsh-mcp-client@0.1.1-rc.2`；
  仅依赖 DSH CLI 全局副本时，OAuth grant 可恢复但动态工具不会进入 Profile 的可调用工具面。
- `qcc-dsh-mcp-oauth@0.1.7` 的 `serverName` 实际为 `company/history/...`，注册名因此不带 `qcc-`。
  当前 Bridge 已兼容；上游修复后无需迁移证据或 Skill 规范名。
- 真实 OAuth、跨重启恢复、16+4 工具预检、20 企业/400 调用及自然到期 refresh 已通过；
  refresh 后 16+4 工具恢复，并以 1 行真实 enrich 验证新 token 可用。

### 4.2 应用内入口（M1–M3）双基线实测

0.5.0/0.5.1 的侧边栏底部入口、全屏工作台、三张工具卡片（`data_clean_rows` /
`data_complete_rows` / `data_profile`）与任务 pill 在双基线均已通过隔离 `DSH_HOME` 冒烟验证：

- **rc.2**：根 HTML 直接引用 `/plugins/dsh-data-cleaning-agent/client.js?rev=…`，client bundle
  HTTP 200 且含全部入口标记；后端 seam/parse/clean/complete/profile/jobs/ui 均 200/202。
- **alpha.2**：web 半区默认要求鉴权，需先带 `?token=…` 访问拿 `dsh-auth-*` Cookie（303 → 200），
  client bundle 改经合并端点 `/plugins/??dsh-data-cleaning-agent/client.js&rev=…` 交付，同样
  200 且含全部入口标记；后端端点一致通过。

两条基线均返回 `[dc-agent] host apply() ran`，且未发起任何真实 QCC 调用。

0.5.2 将入口和工作台改为 Mockup 对齐结构；已在 rc.2 与 alpha.2 的全新隔离安装中复验顶部
Portal、原生会话、五能力按钮、跨 scope 状态桥、窄桌面布局避让与非模态右栏。alpha.2 将
工作区导航方法放在 `uiWorkspace.connectWorkspace`，rc.2 使用 `workspaces.connectWorkspace`；
插件只做运行时能力探测并保留 `sessions.create` 安全降级，不承诺 alpha 实验面稳定。Portal 失败时
仍保留 footer 降级按钮。

0.5.3 新增业务首页和提示词生成器，并把流程栏移出输入框。当前未发布 v2 已在 rc.2 真实页面完成
浅色、深色及 820×900 窄屏回归；窄屏页面无横向溢出，最近完成任务可恢复原 taskId 并显示四个
Host 制品下载按钮。alpha.2 继续只检查 Host/路由/制品 Bridge，不作为精确视觉基线。

### 4.4 未发布 v2 制品兼容面（2026-09-04）

| 能力 | rc.2 | alpha.2 | 备注 |
| --- | --- | --- | --- |
| `dc_workflows_v2` schema 2 | ✅ | ✅ | taskId + revision；原始行不进入 KV |
| `ctx.fs.writeText/readBytes` | ✅ | ✅ | 当前已验证的公共 Host seam |
| 结果/异常 CSV | ✅ | ✅ | UTF-8 文本，工作区本地保存 |
| 结果/异常 XLSX | ✅ | ✅ | Base64 over writeText；下载恢复真实 ZIP 字节 |
| checksum / 跨重启下载 | ✅ | ✅ | SHA-256；同一 taskId/artifactId |
| 深浅色/窄屏实际 UI | ✅ | 探针 | rc.2 为视觉基线，alpha.2 不作稳定视觉承诺 |

### 4.3 0.5.0 三域兼容面

| 能力 | rc.2 | alpha.2 | 备注 |
| --- | --- | --- | --- |
| 91 工具契约加载 | ✅ | ✅ | canonical / legacy / short-name 单测全覆盖 |
| Phase-3 capabilities / estimate | ✅ | ✅ | 零 QCC 调用 |
| 未确认 enrich 阻断 | ✅ | ✅ | HTTP 409，ToolRuntime 前阻断 |
| 工作台实际交互 | ✅ | 探针 | rc.2 完成上传映射、体检、中文字段清洗 |
| 维护者测试账号最小真实 Phase-3 E2E | ✅ 2/2 调用 | 不作为发布门 | rc.2：1 家公开主体 + 1 个风险工具；知产/经营仅过注册、契约与零调用门 |

## 5. 已知限制

- alpha.2 的 `@Remote` 契约仍可能变动，本包不对其作稳定 API 承诺。
- web 半区仅 web 组合可用；headless 组合自动跳过（工具与 Skill 仍注册）。
- XLSX 解析依赖 `xlsx`（懒加载），缺失时返回 `XLSX_UNAVAILABLE` 而非崩溃。
- `/data-cleaning/api/g5/enrich` 为 0.4.0 已发布能力，单批上限 100 行、并发上限 4，
  且必须显式 `confirmPaidCalls:true` 和唯一 `idempotencyKey`；token 到期刷新与 401/429/配额故障门已通过，
  npm/GitHub Release 均已发布 `v0.4.0`。
- `/data-cleaning/api/phase3/*` 为 0.5.0 已发布能力；单批最多 100 行、并发最多 4、默认/硬调用上限
  500/2000。run 只保留在 Host 内存 30 分钟，Host 重启不恢复。
- alpha.2 的实际 UI 只作兼容探针；0.5.0 的稳定发布与回滚判断以 rc.2 为准。
- v2 单制品上限 32 MiB、单次最多 100,000 行和 256 列；当前 Host 未验证稳定 `writeBytes`，
  XLSX 因此以 Base64 文本落盘。未来切换二进制 seam 必须保留旧 `v1` 制品读取兼容。
- v2 已生成制品可跨 Host 重启恢复，但浏览器 runtime 中尚未导出的原始行不会持久化；恢复中途任务
  仍需用户重新提供输入。制品只在当前工作区，不承诺跨设备同步。

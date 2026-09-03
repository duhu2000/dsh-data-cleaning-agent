# Changelog

本文件记录 `dsh-data-cleaning-agent` 的版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.5.3] - 2026-09-03

> UI 二次对齐版本；不改变 Host/QCC 工具契约或计费安全门。

### Added
- 为插件创建的 blank 会话增加「数据清洗补全智能体」业务首页、产品说明、四阶段工作流与安全边界说明。
- 在原生输入框左上角增加提示词生成器：支持粘贴企业名/统一社会信用代码、解析 Excel/CSV/JSON、
  附加图片、选择清洗动作和补全维度，并将自然语言任务描述回填原生输入框供人工修改。
- 表格由本地同源解析端点处理，完整数据经 session→root 事件桥载入工作台；提示词仅带主体预览，
  避免把整表无边界写入模型上下文。

### Changed
- 侧栏菜单由「数据清洗」改为「数据清洗补全」，点击后先进入中央业务首页，不再自动拉开右侧工作台。
- 五个流程入口从输入框内部 `conversation.input.left` 迁到公开 `conversation.input.dock`，并仅移动
  本插件 cell 到输入框下方；普通 DSH 会话不显示业务首页、提示词按钮或流程入口。

### Compatibility
- DSH 没有公开 Hero headline 替换槽位；0.5.3 使用精确匹配中英文原生标题、卸载时恢复的隔离 DOM Bridge。
- 图片接入只在运行时探测到 `conversation.createDraftImages` 与 `input.shell().addImages` 后启用；
  不硬编码未验证的企查查智能文档解析工具名，任务描述只要求模型使用当前已连接且可用的能力。

## [0.5.2] - 2026-09-03

> DSH 原生 UI 对齐版本；不改变 QCC 工具范围、OAuth、计费确认或数据契约。

### Added
- 在 DSH 原生输入框工具行增加上传清洗、质量体检、匹配核验、字段补全和任务历史五个能力入口。
- 在原生会话头增加「清洗工作台」恢复入口，任务历史页复用 Host `/mvp/jobs` 状态。

### Changed
- 左栏入口采用与 MCP连接器一致的兼容方式：公开 `sidebar.footer.action` 仅托管生命周期和降级，
  实际按钮 Portal 到 `sidebar.workspaces` 前，显示在「新会话」与「工作区」之间。
- 点击左栏入口通过 DSH `workspaces` / `sessions` / `conversation` 服务打开中央原生会话并预填清洗提示词。
- 工作台由 980px 模态遮罩改为默认 510px 的非模态右侧面板；中央原生会话保持可见，移动端仍安全降级为全宽面板。

### Fixed
- 修复应用入口错误显示在侧栏底部、点击后只出现大尺寸右侧遮罩而没有中央原生对话的问题。
- 修复 DSH 禁止同一 store handle 跨 root/session scope 复用导致的运行时挂载错误；会话按钮通过同页事件桥接根工作台状态。
- 右栏打开时按实际重叠量左移输入框能力栏，避免窄桌面视口中「匹配核验」「字段补全」「任务历史」被遮挡。
- 为 alpha.2 的 `uiWorkspace.connectWorkspace` 与 rc.2 的 `workspaces.connectWorkspace` 增加能力探测 Bridge，避免预发布版本入口只打开工作台却无法预填原生会话。

## [0.5.1] - 2026-09-03

> 文档与发布流程修正版本；无运行时、QCC 工具契约或 API 变化。

### Fixed
- 准备 0.5.1 文档补丁，使下一份 npm tarball 的中英文 README 正确反映最新已发布版本。

### Changed
- 发布工作流启用严格文案 Gate：`v*` 标签只有在中英文 README 均切换到当前正式版本时才能进入
  `npm publish`，防止候选状态再次进入不可变 npm 包。
- `docs:check` 增加普通分支/标签发布双模式与三项回归测试；运行时能力、QCC 工具契约和 API 均不变。

## [0.5.0] - 2026-09-03

> 风险 / 知产 / 经营三域批量补全与 Mockup 对齐工作台；已通过 npm OIDC Trusted Publishing
> 发布并生成 GitHub Release。

### Added
- 冻结三域 91 工具契约：风险 38、知识产权 18、经营 35；兼容 canonical、OAuth 0.1.7 legacy 与短名，
  明确 90 个 `searchKey` 工具和裁判文书详情的 `documentId` 依赖。
- `Phase3BatchService` 与 `Phase3RunStore`：主体去重、精确/多候选/未匹配分流、调用上限、并发上限、
  部分成功、30 分钟 Host 内存恢复、多候选续跑与只重试失败工具。
- 同源 `/data-cleaning/api/phase3/{capabilities,estimate,enrich,resolve,retry,run}`；estimate 零调用，
  计费端点强制 `confirmPaidCalls:true` + 唯一幂等键，结果和复核队列分别导出 CSV。
- 默认关闭的 `e2e:phase3` Runner：仅允许回环 Host；preflight 要求 91/91 工具 ready 且验证零调用估算；
  enrich 模式还要求显式付费确认、经批准夹具和正数 `maxCalls`，报告为 `0600` 且脱敏。

### Changed
- GitHub Actions 升级到 `actions/checkout@v7`、`actions/setup-node@v7` 与
  `softprops/action-gh-release@v3`，移除托管 Runner 的 Node 20 action runtime 弃用警告。
- 明确 QCC 采用客户自带连接/账号（BYO QCC）：客户自行承担其账号额度或合同费用，插件不共享 Key、
  不代理结算、不代付；`confirmPaidCalls` 仅表示当前用户确认使用自己的 QCC 账号额度。
- 应用内工作台升级为四步：上传与映射 → 数据体检 → 匹配核验 → 补全与导出；支持三域选择、
  调用估算/二次确认、候选复核、失败重试、任务恢复与双 CSV。
- 本地清洗接受显式字段映射；中文“企业名称/联系电话”等表头会按映射清洗，不再套用默认 `name/phone` 误删。
- `enterprise-enrichment` Skill 增加风险/知产/经营域组，并保持多候选暂停、来源原值保真与权限/无数据/限流降级。
- 同步修正 0.4.0 tarball README 的历史状态文案；已发布 0.4.0 仍为不可变快照。

### Fixed
- 修复真实 DSH React 渲染中，工作台关闭态在部分 store hooks 前返回导致首次打开报 React #310 的问题。

### Verified
- `npm run check`：125/125 测试通过；lint、双语版本、marketing 与 pack 白名单全绿。
- DSH `0.1.1-rc.2` / `0.1.2-alpha.2` 隔离 Host 零调用冒烟共 24/24 通过；生产端口 43120 未触碰。
- rc.2 实际渲染完成上传映射、体检和中文字段清洗闭环。
- 2026-09-03 以维护者测试账号完成最小真实 Phase-3 E2E：1 家公开主体、1 个风险工具，
  估算/实际调用均为 2，补全 1 行、待复核 0、错误 0；知产与经营域未做付费实调。
- Release workflow `33708528501` 通过，npm provenance 为 SLSA v1；公共 Registry 全新安装与 ESM 导入通过。

## [0.4.0] - 2026-09-02

> 工商全景与历史工商二期、QCC Host Bridge 和完整安全验收版本；已通过 npm OIDC Trusted Publishing
> 发布并生成 GitHub Release。

### Added
- 0.4.0 二期第一切片：新增可测的 QCC 工商全景契约（16 个工商工具 + 4 个历史工商工具）；
  `enterprise-enrichment` 按 `panorama` / `ownership` / `governance` / `history` 组按需调用，
  强制来源标记、历史权限降级与付费批次约束。
- 0.4.0 验收评估器与默认关闭的 `e2e:phase2` Runner：强制 20 企业 / 每企业 ≥15 维、
  源工具匹配、字段原值一致、历史账号门，并显式拒绝合成证据充当真实 E2E。
- 只读 `/data-cleaning/api/phase2/capabilities` 预检：报告 16+4 工具注册状态，
  不调用 QCC，并将历史工具可用性与账号权限验证明确分开。
- G5-1 QCC Host Bridge（`lib/qcc.js`）：通过公共 `ctx.tools.execute()` 程序化调用动态 MCP 工具，
  支持允许列表、超时/取消、OAuth 重注册窗口、企业去重批处理、多候选暂停与部分失败隔离。
- 同源 Web 端点 `/data-cleaning/api/g5/capabilities` 与 `/data-cleaning/api/g5/enrich`；
  计费调用前强制 `confirmPaidCalls:true`，单批最多 100 行。
- G5 Mock/Contract 测试已覆盖主路径；真实 OAuth/QCC 主路径、token 自然到期刷新与故障注入均已验收。
- G5-2 安全闭环：默认关闭且仅允许回环 Host 的 E2E Runner、日志/报告脱敏、请求幂等、
  Host 内存 run 状态、多候选人工确认续跑、retryable 失败人工重试和安全调用审计。
- 上游错误细分为授权、权限、限流、配额、超时、工具刷新、服务不可用和契约拒绝；
  错误响应不再复述可能包含敏感内容的上游原始 message。

### Changed
- QCC Host Bridge 兼容 `qcc-dsh-mcp-oauth@0.1.7` 实测注册的
  `mcp__company__*` / `mcp__history__*` legacy serverName，同时保留
  `mcp__qcc-company__*` / `mcp__qcc-history__*` 作为规范名称；capabilities 同时报告规范名与实际运行时名。

### Verified
- 在隔离 DSH `0.1.1-rc.2` Host 完成真实 OAuth、授权跨重启恢复与 20 家公开企业的 400 次 QCC 调用；
  严格历史域验收通过：20/20 主体已解析、每企业当前工商最低 15 维、历史工商 4 维。
- 原始证据与脱敏报告仅保存在 Git 忽略的 `.phase2-e2e/`，权限为 `0600`；未触碰生产端口。
- 自然过期 access token 的真实 refresh、动态工具恢复与续期后最小真实调用已通过；
  401/429/配额耗尽故障注入确认无自动重试、人工重试门正确且审计不泄密。
- 公共 npm Registry 全新安装和 ESM 导入通过，导出 `apply / inject / name`。

## [0.3.0] - 2026-09-01

> 企查查 MCP 接入 · 方案 A（模型中介式企业名单补全）首个版本。

### Added
- 内嵌 Skill `enterprise-enrichment`（`lib/skill-enrich.js`）：引导模型复用
  `qcc-dsh-mcp-oauth` 已上架的工具面（`qcc_oauth_status` / `mcp__qcc-company__*` /
  `mcp__qcc-risk__*`），逐个企业完成「消歧 → 工商详情 → 风险标签」补全。
- `docs/QCC-ENRICHMENT-DESIGN.md`：QCC 能力设计（方案 A 模型中介式 + v1 字段契约）。
- 文档：`docs/USER-GUIDE.md` 增补企业名单补全一节；`docs/COMPATIBILITY.md` 补共存说明。

## [0.2.1] - 2026-09-01

> OIDC 可信发布链路验证版本，无功能变更。

### Changed
- 发布流程：接入 npm OIDC Trusted Publishing（`release.yml` + `--provenance`），`v*` tag 自动发布并生成 GitHub Release。

## [0.2.0] - 2026-09-01

> 首个开源社区版本。包名由 `@qcc/dsh-data-cleaning-agent`（私有 scope）改为 `dsh-data-cleaning-agent`（无 scope），
> 以便社区 fork / PR / npm 公开安装。

### Added
- 开源社区化工程骨架（README 双语、LICENSE、CONTRIBUTING、install.sh、marketing 元数据、CI/Release workflow）。
- MVP 全量能力：CSV/XLSX/JSON 解析、清洗（trim / 手机号规范化 / 缺失剔除 / 负金额剔除 / 去重）、
  确定性补全、概览画像、CSV 回写（`lib/engine.js`）。
- 三个模型工具：`data_clean_rows` / `data_complete_rows` / `data_profile`（`lib/tools.js`）。
- 内嵌 Skill `data-cleaning`（`lib/skill.js`）。
- 异步任务状态机 + 持久化存储（`lib/jobs.js`，`ctx.jobs` + `ctx.storageDomain`）。
- web 半区路由与 UI（`lib/web.js`），同源 `/data-cleaning/` 前缀。
- Client 半区 seam（`lib/client.js`）。
- 引擎单元测试 13 例（`test/engine.test.js`）。

### Changed
- 包名：`@qcc/dsh-data-cleaning-agent` → `dsh-data-cleaning-agent`。
- 补全 `license` / `repository` / `homepage` / `bugs` / `keywords` / `engines`。

## [0.1.0-mvp] - 2026-08-31

> 内部 MVP 基线，双基线（0.1.1-rc.2 + 0.1.2-alpha.2）验证通过。不对外发布。

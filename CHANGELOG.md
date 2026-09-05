# Changelog

本文件记录 `dsh-data-cleaning-agent` 的版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.8.1] - 2026-09-05

### Changed
- 图片企业名单识别切换为企查查智能文档解析：本地图片只通过官方 `qcc-document-mcp`
  `parse_document(file_path)` 提交，并仅在异步处理中按返回的 `task_id` 查询 `get_parse_result`。
- 提示词向导不再要求先发送 OCR 专用说明；用户可一次完成图片、匹配规则、清洗动作和补全字段选择，
  再向原生对话框回填一段完整、可读、可编辑的中文任务说明。
- 识别完成后名单直接进入同一 taskId 工作台人工核对，继续现有主体匹配、字段补全和导出流程。

### Security
- Host 仍以 0700 目录和 0600 文件临时保存图片，成功、失败、取消或 TTL 到期后删除；原图不进入
  `storageDomain`、任务元数据、模型上下文或导出制品。
- 远端 `qcc-document` 只接受公网 `file_url`，不能读取本机临时图片；仅连接远端服务时明确 fail closed，
  不自动上传图片、不暴露本地路径，也不回退到聊天模型视觉能力。
- 文档解析与后续企业补全均使用当前用户自己连接的企查查账号和额度；插件不读取、保存或分发凭据。

### Fixed
- 文本模型（包括不支持图片的 DeepSeek 模型）不再收到原生图片附件，避免在执行清洗任务前被模型能力门拒绝。
- 统一解析企查查文档任务状态、Markdown 结果与认证失败，支持处理中轮询、超时和安全错误提示。

## [0.8.0] - 2026-09-05

### Added
- 新增企业名单图片接入：数据清洗补全会话 Composer 可直接粘贴图片，提示词向导支持 PNG/JPEG/WebP 粘贴、拖入与选择。
- 图片使用 DSH 原生 draft attachment，向导显示 64px 缩略图、文件信息、移除操作和可点击放大的预览。
- Host 暂存完成后，回填识别说明前自动释放 Composer 图片附件，避免文本模型因不支持图片而拒绝执行。
- 新增 Agent-owned `data_cleaning_extract_image_companies` 高层工具与 `/data-cleaning/api/images/*` Host 指令/状态契约；运行时探测 `modlens_read_image` 并以 nested execution 识别企业名称和统一社会信用代码。
- 识别结果自动回传原四步向导供人工核对，然后进入既有 taskId 字段选择、主体匹配、QCC 补全和导出流程。

### Security
- 图片上限 8 MiB，按 PNG/JPEG/WebP 魔数验证；Host 临时目录为 0700、文件为 0600，成功、失败、取消或 TTL 到期后删除。
- 原图不进入 `storageDomain`、模型任务 KV 或导出制品；识别指令仅暴露随机 commandId，不包含 Host 文件路径。
- Provider 未安装时 fail closed；图片识别阶段不调用 QCC，后续匹配补全仍受客户自有 QCC 账号确认门保护。

## [0.7.0] - 2026-09-05

### Added
- 数据清洗补全字段目录从 30 项扩展到 128 项：第一批开放联系方式、上市信息、税务开票、进出口信用 40 字段；第二批开放企业自身与关联风险扫描 58 字段。
- 新增 6 个一企一行 Host 适配器、风险因子稳定透视与目录漂移审计；电话/邮箱/网址全集、海关资质、风险明细和关联方列表继续排除。
- UI 按 8 个来源工具展示字段；同工具多字段每企只调用一次，Host 按实际来源工具在调用前校验 300 次预算上限。

### Changed
- 所有新增字段贯通任务草稿、Agent-owned 命令、候选续跑、结果预览和中文 CSV/XLSX；缺失值保留空列，股票代码、税号、电话和银行账号保持文本。

## [0.6.3] - 2026-09-05

### Fixed
- 无表头、每行一家企业的粘贴名单改按「主体标识」逐行解析，不再把第一家企业误识为 CSV 表头。
- 已完成或已确认规则的任务再录入名单时自动创建新 taskId，避免新数据继承旧任务的锁定状态、默认字段或运行结果。
- 匹配补全预览的内部字段键改为中文表头，并改善窄工作台下的列宽和横向滚动。
- 缩小桌面端右侧工作台宽度，打开时让中央会话区留出同宽空间，并固定头部操作组、在窄屏隐藏次要状态，避免输入框被遮挡或关闭按钮被挤出可见区。

### Changed
- 首次主体匹配不再立即发送内部 JSON 命令；改为向中央对话框回填可阅读、可编辑的中文任务说明，关闭右栏后由用户显式发送才执行 Agent-owned QCC 高层工具。

## [0.6.2] - 2026-09-04

### Fixed
- 清洗补全结果 CSV/XLSX 的插件字段与状态字段统一导出为中文表头，并按任务字段选择保留空值列，
  不再因企查查未返回某一字段而从制品中静默丢列。
- 将任务选择的补全字段贯穿中央工作台、Agent-owned 命令、G5 Host Bridge、任务恢复与耐久制品；
  工商详情补充注册地址、行政区划、经营范围、行业、营业期限和企业规模映射，企业简介等画像字段按需
  调用 `get_company_profile`，且不把未声明层级的“企查查行业”猜测为一级/二级行业。

## [0.6.1] - 2026-09-04

### Fixed
- 修复 DSH Code Mode 下同源 Web 路由直接调用动态 QCC 工具会被 ToolRuntime 拒绝的问题：新增
  `data_cleaning_qcc_run` Agent-owned 高层工具，工作台仅在 Host 暂存明细并向原生会话发送不含企业
  名单的 commandId；真实 QCC 调用以父执行 token/Session 的 nested execution 运行。
- 当宿主不提供工具注册能力时 fail closed，并在 capabilities 中报告
  `agentCommandToolRegistered:false`，不会暂存或误执行付费任务。
- 历史任务恢复下载页改为读取 Host 持久化的匹配/补全摘要；进程重启后不再把已补全数和待核验数
  显示为“—”。

### Verified
- DSH `0.1.1-rc.2` 真实连接环境完成一次且仅一次主体检索：唯一精确匹配
  `企查查科技股份有限公司`（统一社会信用代码 `91320594088140947F`）；未查询工商详情、未重试。
- 同一公开主体通过工作台完整执行 Agent-owned 批次：实际 2 次 QCC 调用，1/1 精确补全，回填
  信用代码、法定代表人、注册资本、成立日期与登记状态；0 待核验、0 失败、无重试。
- 结果 CSV/XLSX 与异常清单 CSV/XLSX 四件套均生成成功，下载后 checksum 与 Host 元数据一致，
  XLSX 结构校验通过；重启 DSH Host 后任务、统计和四件套仍可从任务历史恢复。
- `npm run check` 通过，174/174 自动化测试全绿。

## [0.6.0] - 2026-09-04

### Added
- 启动 v2 五步工作流：上传数据、规则确认、数据匹配、清洗补全、下载数据；新增共享字段目录、
  映射锚点和可审计匹配状态契约。
- 新增 `dc_workflows_v2` Host 元数据存储与同源 `/data-cleaning/api/workflow/*` API，支持 taskId
  隔离、revision 并发保护、任务恢复及阶段推进。
- 上传/粘贴解析、数据预览、自动字段映射、任务目标、匹配规则与字段选择正式接入 taskId 工作流；
  规则确认后自动生成本地质量体检并推进匹配阶段。
- 提示词生成器升级为数据来源、匹配规则、清洗与补全、确认描述四步向导，并把解析数据和任务草稿
  通过会话事件桥安全传入同一 Host 任务。
- 增加中央七阶段业务首页、最近任务恢复、输入框下五能力入口，以及 taskId 驱动的右侧五步工作台。
- 新增 Host 耐久制品层：每个任务生成清洗补全结果与异常清单的 CSV/XLSX 四个文件，提供列表、生成、
  checksum 校验下载 API；XLSX 为可由 Excel/SheetJS 读取的真实工作簿。
- 新增 v2 升级/迁移/回滚说明和 T6～T9 双基线、视觉、恢复及发布准备验收文档。

### Changed
- Client 原始数据按 taskId 隔离，不再使用跨任务模块级共享 session；同一会话并发创建与写操作分别
  通过 coalescing 和串行队列避免重复任务及 revision 冲突。
- 当前基础企业匹配、补全、预览和 CSV 下载复用 G5 Host Bridge，并保留零调用估算、客户自带 QCC
  账号确认、幂等键与调用上限门。
- 下载页改为读取 Host 四类耐久制品；已经完成的历史任务无需恢复浏览器原始行即可跨 Host 重启下载。
- 本地确定性清洗可从规则确认/质量体检直接进入 `export_ready`，不会为零 QCC 调用强造匹配步骤。

### Fixed
- 修复中央业务首页条件调用组件导致真实 DSH 页面出现 React #310 的 Hooks 顺序问题。
- 修复提示词数据集与任务草稿事件并发时可能创建两个 Host taskId 的竞态。
- 修复规则按钮文案承诺“运行质量体检”但只切换页面的问题；现在规则确认后立即生成并持久化摘要。
- 修复 `partial` 任务在显式重试后无新候选时走入非法匹配状态的问题；现在可继续补全并回到
  `export_ready`。
- 修复从中央首页最近任务打开工作台时只传阶段、未携带 taskId，导致误创建新草稿的问题。

### Verified
- `npm test` 165/165 通过；DSH `0.1.1-rc.2` 隔离 Host 43182 实际渲染 T3～T5，并完成
  2 行 CSV 的上传、自动映射、规则确认与质量体检，任务达到 `diagnosed / match`。
- 最新 tarball 在 rc.2（43190）与 alpha.2（43191）均完成四类制品创建、真实 XLSX 反向解析和
  跨 Host 重启恢复；rc.2 完成浅色、深色和 820×900 窄屏视觉回归。未执行真实 QCC 调用。

### Security
- v2 Host KV 只保存任务元数据、数字汇总和制品引用，不持久化原始企业名单、候选详情、QCC 原始响应或凭据。
- 工作流契约和任务元数据 API 不执行 QCC 工具；真实补全继续受零调用估算、用户付费确认、幂等键和调用上限保护。
- 制品 ID 与路径严格校验，文件名去除控制字符，单制品限 32 MiB；下载前验证 SHA-256，运行制品目录
  已从 Git 和 npm 包排除。
- CSV 导出会中和以 `= + - @` 开头的外部文本，防止 Excel/LibreOffice 公式注入；XLSX Base64
  读取上限覆盖编码后的 4/3 体积膨胀，解码后仍执行 32 MiB 硬限制。

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

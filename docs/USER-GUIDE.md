# 使用指南 / User Guide

## 1. 安装

```bash
dsh plugin --profile web add dsh-data-cleaning-agent
```

没有 `dsh` CLI 时：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-data-cleaning-agent/main/install.sh)
```

安装后**完全重启** DeepSeek Harness。

## 2. 使用方式

### 2.1 对话式（推荐）

在对话中说：

> 帮我清洗这批企业名单数据，先做画像，再清洗，缺失的金额补 0。

插件会加载内嵌 Skill `data-cleaning`，自动按 `data_profile → data_clean_rows → data_complete_rows` 工作流调度。

### 2.2 应用内入口（侧边栏「数据清洗补全」）

重启后，DeepSeek Harness 侧栏顶部的「新会话」与「工作区」之间会出现「数据清洗补全」。点击后先进入
中央业务首页，右侧工作台保持关闭；输入框下方的五个入口分别定位到上传清洗、质量体检、匹配核验、
字段补全和任务历史。处理步骤为：

1. **上传数据**：粘贴或上传 CSV / XLSX / JSON，预览列和行；
2. **规则确认**：映射企业名称/统一社会信用代码/注册号，选择清洗目标与补全字段；
3. **数据匹配**：运行质量体检与主体匹配，多候选由人工确认；
4. **清洗补全**：执行本地确定性清洗；需要 QCC 时先零调用估算，再由当前用户确认使用自己的账号额度；
5. **下载数据**：生成结果 CSV/XLSX 与异常清单 CSV/XLSX，后续可从任务历史恢复下载。

输入框左上角的「提示词生成」提供三种名单录入方式：

- **粘贴名单**：每行一个企业名称或统一社会信用代码；
- **上传 Excel**：支持 XLSX/XLS/CSV/JSON，识别企业名称/信用代码列并把完整数据载入右侧工作台；
- **上传图片**：支持 PNG/JPEG/WebP（单张不超过 8 MiB）；可在向导中粘贴、拖入或选择，也可直接在数据清洗补全会话的原生输入框粘贴。输入框使用 DSH 原生图片附件，向导同时显示 64px 缩略图，点击可放大。

随后可选择名称规范、信用代码校验、去重、模糊候选复核等清洗动作，以及工商字段或已支持的维度组。
图片流程分为两轮可见交互：

1. 选择图片后，点击「回填图片识别指令」。此时 Host 已安全暂存原图，Client 会释放 Composer 图片附件并把可读的纯文本说明放入原生对话框；用户检查后发送。该步骤不会把图片交给当前聊天模型，因此兼容不支持视觉输入的文本模型。
2. Agent 只调用一次 `data_cleaning_extract_image_companies`，Host 在当前父执行中调用已探测的图片文字 Provider；识别到的企业名称/统一社会信用代码会回到向导，由用户逐条核对后选择匹配规则和补全字段。

当前已验证 Provider 是 Modlens `modlens_read_image`。插件不引入对 Modlens 的强依赖；运行时未安装或未配置时会 fail closed，请改用文本/Excel。图片仅作为 0600 权限的 Host 临时文件，成功、失败、取消或 15 分钟超时后删除；不进入任务 KV 或导出制品。识别阶段不调用 QCC、不消耗 QCC MCP 额度；人工核对后的匹配/补全仍受既有 BYO QCC 确认门保护。

模型在对话中调用 `data_clean_rows` / `data_complete_rows` / `data_profile` 时，
对话内会渲染对应的工具结果卡片（含运行中 / 已完成 / 失败状态）；工作台头部用任务 pill
实时展示排队 / 运行中的后台任务（轮询 `/data-cleaning/api/mvp/jobs`）。

### 2.3 web 界面

打开 DeepSeek Harness 后访问插件的同源界面（`/data-cleaning/`），可上传 CSV/XLSX/JSON，
执行解析、清洗、补全与导出。旧 MVP 路由前缀为 `/data-cleaning/api/mvp/*`；0.6.0 五步任务和
耐久制品使用 `/data-cleaning/api/workflow/*`。

## 3. 能力说明

### 3.1 本地清洗 / 补全 / 画像（Skill `data-cleaning`）

| 工具 | 作用 |
| --- | --- |
| `data_profile` | 输出列概览与金额分布（min/max/sum/count） |
| `data_clean_rows` | trim、手机号规范化、剔除缺失必填/负金额/重复行 |
| `data_complete_rows` | 空金额填 0、空姓名填占位、报告不可确定性补全的项 |

### 3.2 企查查企业名单补全（Skill `enterprise-enrichment`）

#### 账号与费用边界

- 客户必须在自己的 DSH 环境中开通并连接自己的企查查 MCP 账号。
- QCC 调用消耗客户自有账号的套餐额度，或按客户与企查查之间的合同计费。
- 本插件及其开发者不提供共享 Key，不代客户购买、结算、垫付或补贴 QCC 调用费用。
- 开发者 Key 只用于隔离测试环境，不写入代码、日志、夹具或 npm 发布包。
- API 字段 `confirmPaidCalls` 为兼容性保留；它表示“当前用户确认使用自己的 QCC 账号额度”，
  不表示插件开发者或维护者承担费用。

先用企查查 MCP 连接插件（`qcc-dsh-mcp-oauth`）完成授权，然后对对话说：

> 帮我补全这份企业名单：工商全景 + 股权穿透，不要历史工商。

模型会按 `enterprise-enrichment` Skill 逐个企业调 `mcp__qcc-company__get_company_by_query`
（消歧，多候选时停下询问）→ `get_company_registration_info`（工商详情），
然后只调用请求的维度组：

- `panorama`：企业画像、联系方式、开票、上市、财务；
- `ownership`：实控人、受益所有人、股东和对外投资；
- `governance`：分支机构、主要人员、变更记录和年报；
- `history`：历史股东、法人、高管和登记信息（需企业认证账号）。

如果请求没有明确维度，Skill 会先让用户选择，不默认调用全部付费工具。
历史域无权时只标记 `permission_required`，当前工商组仍继续。对话默认返回统计摘要和小量预览；
完整明细只在 Host 确实提供同源下载/产物能力时交付。
开发者可在真实调用前 GET `/data-cleaning/api/phase2/capabilities`，只读检查 16+4 工具面；
该预检不发起 QCC 或付费调用，也不会把「工具已注册」误报为「历史账号已授权」。

**前置条件**：先连接企查查 MCP（未连接时 Skill 会引导执行 `qcc_oauth_connect`）。

**本阶段边界**（方案 A，模型中介式）：
- 不重造 OAuth；工具面来自 `qcc-dsh-mcp-oauth`。
- 逐企业调用，适合中小名单（几十条以内）。
- 金额、比例、计数保留 QCC 原值，不自算股权链、不将缺失值写成「无」或 0。
- 0.4.0 已发布；20 企业、每企业至少 15 个当前维度并含 4 个历史维度的真实账号验收已通过。
  access token 自然到期后的真实刷新、动态工具恢复以及限流/配额故障注入已在隔离环境验收。

### 3.3 QCC 后台批量 Host Bridge（0.4.0 / G5-2）

源码 `main` 已提供 `/data-cleaning/api/g5/capabilities`（只读能力探测）和
`/data-cleaning/api/g5/enrich`（同源批量补全）基础层。它按企业名去重调用、只对唯一精确主体继续补全，
多候选进入人工确认队列，模型不接触完整明细。

这是 0.4.0 已发布能力：真实 OAuth、授权跨重启恢复、QCC 主调用路径、token 自然到期刷新
与 401 / 429 / 配额故障注入均已完成隔离验收。
调用批量端点必须由 UI 在用户确认后同时发送 `confirmPaidCalls:true` 和唯一 `idempotencyKey`；
未确认或缺少幂等键时不会产生任何 QCC 调用。

初次请求返回 `runId`：多候选进入 `awaiting-review`，只能通过 `/g5/resolve` 选择返回候选中的
信用代码后续跑；retryable 失败只能由用户通过 `/g5/retry` 显式重试。run 仅在 Host 内存保留
30 分钟，Host 重启后失效，不把原始企业行持久化落盘。

### 3.4 三域批量补全（0.5.0）

0.5.0 在工作台中增加三个可选域：

- **风险信息 · 38**：司法、执行、处罚、经营异常、税务、违约等；
- **知识产权 · 18**：专利、商标、软著、数字资产、备案等；
- **经营信息 · 35**：资质、招投标、融资、舆情、监管、进出口等。

推荐流程：

1. 上传数据并确认“企业名称字段”；
2. 生成数据体检，执行本地清洗；
3. 点击“检测企查查连接”，按需要勾选域；
4. 点击“估算调用量”。估算为上界且不执行 QCC 工具；
5. 只有在核对企业数、工具数、估算调用量和 `maxCalls` 后，才勾选“确认使用当前用户的企查查账号额度”；
6. 多候选逐项人工选择；失败项只在明确点击重试时重放；
7. 生成并下载结果/异常清单的 CSV 或 XLSX；需要重新核验的行会进入异常清单。

同源 API 为 `/data-cleaning/api/phase3/*`。单批最多 100 行，并发上限 4，硬调用上限 2000；
默认调用上限 500。`enrich` / `resolve` / `retry` 均要求 `confirmPaidCalls:true` 和唯一幂等键。
当前维护者测试账号的真实三域计费 E2E 仍是发布门；与客户生产费用无关，详见
[PHASE3-ACCEPTANCE.md](PHASE3-ACCEPTANCE.md)。

## 4. 数据边界

- 模型只收到统计摘要（total / kept / dropped / incomplete），**从不读取原始明细行**。
- 明细数据只经同源 web 端点（`127.0.0.1` / `localhost`）交付；非可信跨源请求被拒绝。
- 不要上传含真实敏感业务数据的文件到公开环境做演示；开发测试请用脱敏夹具。

## 5. 支持的数据格式

- CSV：RFC4180 子集（引号字段、转义引号、字段内换行、BOM、CRLF）。
- XLSX / XLS：懒加载 `xlsx` 依赖；headless 组合无 `xlsx` 时返回 `XLSX_UNAVAILABLE`。
- JSON：对象数组，每项一行。

## 6. 常见问题

- **Q：安装后工具不出现？** A：确认已完全重启 DSH；确认 `dsh plugin list`（或 profile 的
  `package.json` → `dsh.profile.bundles`）含 `dsh-data-cleaning-agent`。
- **Q：XLSX 解析报 `XLSX_UNAVAILABLE`？** A：当前 DSH 组合未安装 `xlsx`；web 组合默认可用。
- **Q：能接企查查补全企业信息吗？** A：可以。先安装并连接 `qcc-dsh-mcp-oauth`；rc.2 隔离 Profile
  需同时显式安装同版本 `@deepseek-ai/dsh-mcp-client`。再说"帮我补全这份企业名单"，会自动走
  `enterprise-enrichment` Skill（方案 A 模型中介式）。字段契约与二期规划见
  [QCC-ENRICHMENT-DESIGN.md](QCC-ENRICHMENT-DESIGN.md)。
- **Q：可以在后台批量补全吗？** A：可以。0.4.0 G5 工商批量已发布并完成真实 OAuth/token 验收；
  0.5.0 风险/知产/经营三域已发布，先用 estimate 核对调用上限，再显式确认使用当前用户自己的 QCC 账号额度。
- **Q：刷新页面或重启后还能恢复吗？** A：五步任务元数据与已生成制品可按 taskId 跨 Host 重启恢复；
  尚未导出的浏览器原始行不会持久化，需要重新上传。QCC 的临时 `runId` 仍只在同一 Host 进程保留
  30 分钟，但完成任务的 CSV/XLSX 不依赖该内存 run。

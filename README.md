# dsh-data-cleaning-agent

> 在 DeepSeek Harness 中清洗、补全、画像企业名单数据的智能体插件：本地 CSV/XLSX/JSON 引擎 + 可选企查查（Qichacha/QCC）MCP 企业数据补全，由企查查（Qichacha/QCC）团队发起并维护。
>
> 当前源码版本 / Current source version: **0.8.1**（正式版本）

[![CI](https://github.com/duhu2000/dsh-data-cleaning-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-data-cleaning-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-data-cleaning-agent)](https://www.npmjs.com/package/dsh-data-cleaning-agent)
[![npm downloads](https://img.shields.io/npm/dm/dsh-data-cleaning-agent)](https://www.npmjs.com/package/dsh-data-cleaning-agent)
[![GitHub stars](https://img.shields.io/github/stars/duhu2000/dsh-data-cleaning-agent?style=social)](https://github.com/duhu2000/dsh-data-cleaning-agent/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/duhu2000/dsh-data-cleaning-agent?style=social)](https://github.com/duhu2000/dsh-data-cleaning-agent/forks)
[![GitHub release](https://img.shields.io/github/v/release/duhu2000/dsh-data-cleaning-agent)](https://github.com/duhu2000/dsh-data-cleaning-agent/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 简介

`dsh-data-cleaning-agent` 是 DeepSeek Harness 的插件（DSH Bundle plugin）。
它面向"客户给的一批企业名单 / 表格数据"这个高频场景：上传 CSV / XLSX / JSON，
对姓名、手机号、金额等列做清洗（去空格、手机号规范化、剔除缺失/负金额/重复行）、
确定性补全与概览画像，并导出干净的 CSV。

通过右侧工作台处理表格时，模型（LLM）默认只拿到统计摘要，完整明细仅在同源 web 界面查看与导出。
如果用户主动用提示词生成器粘贴名单、附加图片或把表格主体预览回填对话框，这些用户明确选择发送的
内容会进入模型上下文；表格完整数据仍只保留在本机工作台。

企查查补全采用 **客户自带连接与账号（BYO QCC）**：每位客户在自己的 DSH 中开通企查查 MCP，
调用消耗其自有账号的套餐额度或按其与企查查的合同计费。本插件不内置、不分发、不共享开发者 Key，
不代理结算，也不为客户代付或补贴企查查费用。维护者自己的 Key 仅用于隔离开发测试，不进入发布包。

## 30 秒开始

```bash
dsh plugin --profile web add dsh-data-cleaning-agent
```

安装后**完全重启** DeepSeek Harness（停止后重新运行 `dsh web`）。
之后在对话中说「帮我清洗这批企业名单数据」，插件会自动加载内嵌 Skill 并调度清洗/补全/画像工具。

重启后，「数据清洗补全」入口会显示在侧边栏顶部的「新会话」与「工作区」之间。点击后打开专属的
DSH 原生会话：首页标题、产品说明与工作流会替换通用探索页；输入框左上角提供提示词生成器，支持
粘贴名单、解析 Excel/CSV/JSON 或附加图片并选择清洗动作、补全字段。上传清洗、质量体检、匹配核验、
字段补全和任务历史五个入口位于输入框下方，右侧工作台承载“上传数据 → 规则确认 → 数据匹配 →
清洗补全 → 下载数据”五步闭环。完成后可下载结果与异常清单的 CSV/XLSX 四类 Host 耐久制品。

0.8.1 起，在数据清洗补全会话的原生输入框粘贴图片，或在「提示词生成」的图片页
拖入/选择 PNG、JPEG、WebP，会显示可点击放大的原生缩略图。用户可继续完成匹配规则、清洗项与补全字段，
最后一次性把完整、可编辑的任务说明回填到对话框；不再先发送一轮 OCR 专用指令。发送前 Client 释放
Composer 图片附件，因此不支持视觉输入的文本模型也能调度 Agent-owned 高层工具。高层工具通过官方
`qcc-document-mcp` 的 `parse_document(file_path)` 提交本地图片，仅在异步处理中以同一 `task_id`
调用 `get_parse_result`，再将企业名称/信用代码交回工作台人工核对。

本地图片解析需在 MCP 连接器中另行配置官方 `qcc-document-mcp`；市场中的远端 `qcc-document`
只支持公网 `file_url`，不能读取本机图片。两者使用当前客户自己的企查查账号与额度，本插件不读取、保存
或分发凭据。本地服务会把用户明确提交的图片上传到企查查文档解析网关；未连接本地服务时功能会
fail closed，并明确提示配置要求，文本与 Excel 流程不受影响。

没有 `dsh` CLI 时，也可以用安装脚本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-data-cleaning-agent/main/install.sh)
```

或直接让 Agent 安装：

> 帮我安装这个插件 https://github.com/duhu2000/dsh-data-cleaning-agent

## 能力矩阵

| 能力 | 工具 / 入口 | 说明 |
| --- | --- | --- |
| 清洗 | `data_clean_rows` | trim、手机号规范化、剔除缺失必填/负金额/重复行 |
| 补全 | `data_complete_rows` | 空金额填 0、空姓名填占位、不可补全项上报 |
| 画像 | `data_profile` | 列概览与金额分布 |
| 解析 | web `/data-cleaning/api/mvp/parse` | CSV / XLSX / JSON |
| 异步任务 | web `/data-cleaning/api/mvp/jobs` | 任务状态机 + 持久化存储 |
| UI | web `/data-cleaning/` | 上传 → 清洗/补全 → 导出 |
| 五步任务 | web `/data-cleaning/api/workflow/*` | taskId/revision、规则、匹配、补全、恢复与状态审计 |
| 耐久制品 | Host 工作区 `.dsh-data-cleaning-artifacts/v1` | 结果/异常 CSV+XLSX，checksum 校验，跨 Host 重启下载 |
| 应用内入口 | 侧栏顶部「数据清洗补全」+ 输入框下方五能力按钮 | 中央业务首页与原生对话，右侧按需打开 Mockup 对齐工作台 |
| 提示词生成 | `conversation.input.overlay` | 文本 / Excel / 图片录入、清洗项与补全维度选择，生成后回填原生输入框供人工修改 |
| 图片名单 | `data_cleaning_extract_image_companies` + `qcc-document-mcp` | 原生缩略图/放大、粘贴/拖入；一次性完整任务说明；`parse_document` → 按需 `get_parse_result` → 人工核对 |
| 工具卡片 | `tool.call.toolview`（清洗/补全/画像/图片名单） | 对话内渲染四类工具结果卡，含运行/已完成/失败状态 |
| 任务进度 | 工作台头部任务 pill | 轮询 `/data-cleaning/api/mvp/jobs`，展示排队/运行中任务 |
| Skill | `data-cleaning` | 引导模型按工作流调度上述工具 |
| 企查查 Skill 补全 | `enterprise-enrichment` | 0.4.0：工商全景、股权穿透与历史工商 |
| 0.4.0 工具预检 | web `/data-cleaning/api/phase2/capabilities` | 只读检查 16+4 动态工具，不发起 QCC/付费调用 |
| QCC Host Bridge | `data_cleaning_qcc_run` + web `/data-cleaning/api/g5/*` | Web 仅在 Host 暂存任务；Agent-owned 高层工具以 nested execution 调用动态 QCC 工具；真实 OAuth/QCC 主路径、自然到期刷新与故障注入均已验收 |
| 三域补全 | web `/data-cleaning/api/phase3/*` | 0.5.0：风险 38 + 知产 18 + 经营 35；零调用估算、显式付费确认、候选复核、恢复/重试与双 CSV 导出（当前按用户要求暂不扩展工具域） |

## 企查查 MCP 补全（状态与路线图）

插件同时提供本地确定性补全和企查查 MCP 企业数据补全：

- **方案 A（模型中介，优先）**：用户已用 `qcc-dsh-mcp-oauth` 连接企查查后，
  Skill 引导模型对名单中每个企业名调用 `mcp__qcc-company__get_company_by_query` /
  `mcp__qcc-company__get_company_registration_info`，把返回的最新工商信息回填到补全工具。
  0.4.0 已将 16 个工商工具和 4 个历史工商工具固化为可测契约，
  按 `panorama` / `ownership` / `governance` / `history` 维度组按需调用；未显式选择时不会默认打满全部付费工具。
- **方案 B（Agent-owned 批量，0.4.0 起）**：DSH Code Mode 下，工作台先把名单安全暂存在本机
  Host，并只把不含企业名单的 commandId 类型化意图发送到原生会话；Agent 随后准确调用一次
  `data_cleaning_qcc_run`，Bridge 使用该父执行的 token/Session 以 nested execution 调度动态 QCC 工具。
  该路径实现批量补全、请求幂等、多候选人工确认续跑、retryable 失败人工重试与安全审计。
  暂存命令前要求 `confirmPaidCalls:true`；该字段表示当前用户确认
  使用自己的 QCC 账号额度，不代表插件开发者代客户付款；多候选绝不自动选择。
  默认关闭的本机 E2E Runner 已就绪；2026-09-01 已在隔离 rc.2 Host 完成真实 OAuth、跨重启恢复和
  20 家公开企业的 400 次 QCC 调用；自然过期 token 的真实刷新、动态工具恢复及 1 行续期后调用也已通过。
  401 / 429 / 配额耗尽使用 Web→Bridge→ToolRuntime 故障注入验证，不额外消耗真实付费批次。
- **0.5.0 三域批量扩展（已发布）**：风险 38、知识产权 18、经营 35 个工具已冻结为 91 工具契约；
  工作台支持域组勾选、零调用上界估算、独立付费确认、多候选人工锁定、部分失败人工重试、
  30 分钟 Host 内存恢复、结果 CSV 与复核 CSV。rc.2 / alpha.2 零调用 Host 冒烟 24/24 通过，
  rc.2 实际渲染与中文企业字段映射闭环通过。2026-09-03 又以维护者自己的测试账号完成最小真实
  Phase-3 E2E：1 家公开主体、1 个风险工具、实际 2 次调用，1 行补全、0 待复核、0 错误；
  知产与经营域本次只覆盖运行时注册、契约与零调用门。

`qcc-dsh-mcp-oauth@0.1.7` 在 rc.2 实测注册为 `mcp__company__*` / `mcp__history__*`；
本插件的兼容 Bridge 会自动映射到文档规范名 `mcp__qcc-company__*` / `mcp__qcc-history__*`。
隔离 Profile 还需显式安装与 Host 同版本的 `@deepseek-ai/dsh-mcp-client`，详见兼容性文档。

详见 [docs/PLAN-OSS.md](docs/PLAN-OSS.md)。

0.4.0 真实账号验收的证据格式、安全门和命令见
[docs/PHASE2-ACCEPTANCE.md](docs/PHASE2-ACCEPTANCE.md)。
发布记录、验收门和回滚步骤见 [docs/RELEASE-0.4.0.md](docs/RELEASE-0.4.0.md)。
0.5.0 三域验收状态见 [docs/PHASE3-ACCEPTANCE.md](docs/PHASE3-ACCEPTANCE.md)，
发布记录、升级与回滚见 [docs/RELEASE-0.5.0.md](docs/RELEASE-0.5.0.md)。
0.5.1 文档补丁与防回归发布门见 [docs/RELEASE-0.5.1.md](docs/RELEASE-0.5.1.md)。
0.5.2 DSH 原生 UI 对齐范围、验收与回滚见 [docs/RELEASE-0.5.2.md](docs/RELEASE-0.5.2.md)。
0.5.3 业务首页、提示词生成和输入框下方流程栏见 [docs/RELEASE-0.5.3.md](docs/RELEASE-0.5.3.md)。
0.7.0 第一批 40 字段、第二批 58 字段、调用编排和真实两企业验收见
[docs/RELEASE-0.7.0.md](docs/RELEASE-0.7.0.md)。0.8.0 图片粘贴、原生缩略图、Agent-owned OCR 和人工核对流程见
[docs/RELEASE-0.8.0.md](docs/RELEASE-0.8.0.md)。0.8.1 企查查智能文档解析与单次任务说明见
[docs/RELEASE-0.8.1.md](docs/RELEASE-0.8.1.md)。0.6.3 多行名单解析、可编辑执行说明与工作台遮挡修复见
[docs/RELEASE-0.6.3.md](docs/RELEASE-0.6.3.md)。0.6.2 中文导出表头、完整字段选择传递与画像字段补全见
[docs/RELEASE-0.6.2.md](docs/RELEASE-0.6.2.md)。0.6.1 Agent-owned QCC 工作台、会话隔离、恢复统计及真实闭环验收见
[docs/RELEASE-0.6.1.md](docs/RELEASE-0.6.1.md)。0.6.0 五步 taskId 工作流、耐久制品、
跨重启恢复与双基线验收见 [docs/RELEASE-0.6.0.md](docs/RELEASE-0.6.0.md)。

## 本地开发

要求 Node.js 20 或更高。DSH 运行期服务（`ctx.tools` / `ctx.skills` / `ctx.jobs` /
`ctx.storageDomain` / `webServer` / `webRuntime`）由 Host 提供，本地只装 `xlsx`：

```bash
npm install --legacy-peer-deps
npm run check
```

`npm run check` 会依次执行 lint、文档版本一致性、发布包白名单校验与单元测试。
真实 G5 验收必须按 [E2E 手册](docs/G5-E2E-RUNBOOK.md) 显式开启；默认执行 `npm run e2e:g5` 会安全拒绝。
0.5.0 三域 Runner 同样默认关闭；`npm run e2e:phase3` 仅允许回环 Host，付费模式还需单独设置确认门。

## 配置

插件通过 `cordis.patch.yml` 注册为 bundle；`dsh plugin add` 会自动把本包加入 profile 的
`dsh.profile.bundles`，无需手工配置。

## 文档

- [使用指南](docs/USER-GUIDE.md)
- [首次贡献](docs/FIRST-CONTRIBUTION.md)
- [兼容性](docs/COMPATIBILITY.md)
- [贡献指南](CONTRIBUTING.md)

## 安全与隐私

- 模型工具只返回摘要，原始明细行永不进入模型上下文。
- 明细数据仅经同源（`127.0.0.1` / `localhost`）web 端点交付；非可信跨源请求会被拒绝。
- 不要在任何 Issue、PR、日志、截图或测试夹具中提交 Token、API Key、Cookie、OAuth 凭据或真实业务数据。

## 许可证

[MIT](LICENSE) © 2026 dsh-data-cleaning-agent plugin contributors

## 参与

如果这个插件帮你更快地清洗企业名单数据，欢迎
[GitHub 点个 Star](https://github.com/duhu2000/dsh-data-cleaning-agent/stargazers)、
[提交 Issue](https://github.com/duhu2000/dsh-data-cleaning-agent/issues) 或
[参与贡献](CONTRIBUTING.md)。

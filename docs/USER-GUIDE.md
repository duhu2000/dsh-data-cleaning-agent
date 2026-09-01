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

### 2.2 web 界面

打开 DeepSeek Harness 后访问插件的同源界面（`/data-cleaning/`），可上传 CSV/XLSX/JSON，
执行解析、清洗、补全、导出 CSV。web 界面的后端路由前缀为 `/data-cleaning/api/mvp/*`。

## 3. 能力说明

### 3.1 本地清洗 / 补全 / 画像（Skill `data-cleaning`）

| 工具 | 作用 |
| --- | --- |
| `data_profile` | 输出列概览与金额分布（min/max/sum/count） |
| `data_clean_rows` | trim、手机号规范化、剔除缺失必填/负金额/重复行 |
| `data_complete_rows` | 空金额填 0、空姓名填占位、报告不可确定性补全的项 |

### 3.2 企查查企业名单补全（Skill `enterprise-enrichment`）

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
- 0.4.0 尚未发布；20 企业、每企业至少 15 个当前维度并含 4 个历史维度的真实账号验收已通过。
  access token 自然到期后的真实刷新、动态工具恢复以及限流/配额故障注入已在隔离环境验收。

### 3.3 QCC 后台批量 Host Bridge（0.4.0 发布候选 / G5-2）

源码 `main` 已提供 `/data-cleaning/api/g5/capabilities`（只读能力探测）和
`/data-cleaning/api/g5/enrich`（同源批量补全）基础层。它按企业名去重调用、只对唯一精确主体继续补全，
多候选进入人工确认队列，模型不接触完整明细。

这是 0.4.0 尚未发布的候选能力：真实 OAuth、授权跨重启恢复、QCC 主调用路径、token 自然到期刷新
与 401 / 429 / 配额故障注入均已完成隔离验收；正式可用版本仍以 npm/GitHub Release 为准。
调用批量端点必须由 UI 在用户确认后同时发送 `confirmPaidCalls:true` 和唯一 `idempotencyKey`；
未确认或缺少幂等键时不会产生任何 QCC 调用。

初次请求返回 `runId`：多候选进入 `awaiting-review`，只能通过 `/g5/resolve` 选择返回候选中的
信用代码后续跑；retryable 失败只能由用户通过 `/g5/retry` 显式重试。run 仅在 Host 内存保留
30 分钟，Host 重启后失效，不把原始企业行持久化落盘。

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
- **Q：可以在后台批量补全吗？** A：`main` 已有 G5-2 Host Bridge 安全闭环，真实 OAuth/QCC 主路径已验收但尚未发布；
  生产使用前仍需通过 `docs/G5-HOST-BRIDGE.md` 的 token 到期刷新与计费错误门。

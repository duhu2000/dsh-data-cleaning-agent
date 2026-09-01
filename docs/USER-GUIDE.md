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

> 帮我补全这份企业名单：统一社会信用代码、法人、注册资本、成立日期、登记状态、风险标签。

模型会按 `enterprise-enrichment` Skill 逐个企业调 `mcp__qcc-company__get_company_by_query`
（消歧，多候选时停下询问）→ `get_company_registration_info`（工商详情）→
`get_company_risk_scan`（风险标签），最后输出摘要 + Markdown 补全表。

**前置条件**：先连接企查查 MCP（未连接时 Skill 会引导执行 `qcc_oauth_connect`）。

**本阶段边界**（方案 A，模型中介式）：
- 不重造 OAuth；工具面来自 `qcc-dsh-mcp-oauth`。
- 逐企业调用，适合中小名单（几十条以内）。

### 3.3 QCC 后台批量 Host Bridge（Unreleased / G5-1）

源码 `main` 已提供 `/data-cleaning/api/g5/capabilities`（只读能力探测）和
`/data-cleaning/api/g5/enrich`（同源批量补全）基础层。它按企业名去重调用、只对唯一精确主体继续补全，
多候选进入人工确认队列，模型不接触完整明细。

这是尚未发布的新能力：真实 OAuth、token 自动刷新和真实 QCC 调用还未完成 E2E 验收。
调用批量端点必须由 UI 在用户确认后发送 `confirmPaidCalls:true`；未确认时不会产生任何 QCC 调用。

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
- **Q：能接企查查补全企业信息吗？** A：可以。先安装并连接 `qcc-dsh-mcp-oauth`，再说"帮我补全这份企业名单"，会自动走
  `enterprise-enrichment` Skill（方案 A 模型中介式）。字段契约与二期规划见
  [QCC-ENRICHMENT-DESIGN.md](QCC-ENRICHMENT-DESIGN.md)。
- **Q：可以在后台批量补全吗？** A：`main` 已有 G5-1 Host Bridge，但还未发布且未完成真实 E2E；
  生产使用前需通过 `docs/G5-HOST-BRIDGE.md` 的 OAuth、刷新、计费错误和真实 QCC 验收门。

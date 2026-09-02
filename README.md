# dsh-data-cleaning-agent

> 在 DeepSeek Harness 中清洗、补全、画像企业名单数据的智能体插件：本地 CSV/XLSX/JSON 引擎 + 可选企查查（Qichacha/QCC）MCP 企业数据补全，由企查查（Qichacha/QCC）团队发起并维护。
>
> 当前源码版本 / Current source version: **0.4.0**（已发布；npm `latest` 为 0.4.0）

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

模型（LLM）**只拿到统计摘要，从不读取原始明细行**；明细只在同源 web 界面查看与导出，
从架构上避免把客户原始数据灌进模型上下文。

## 30 秒开始

```bash
dsh plugin --profile web add dsh-data-cleaning-agent
```

安装后**完全重启** DeepSeek Harness（停止后重新运行 `dsh web`）。
之后在对话中说「帮我清洗这批企业名单数据」，插件会自动加载内嵌 Skill 并调度清洗/补全/画像工具。

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
| Skill | `data-cleaning` | 引导模型按工作流调度上述工具 |
| 企查查 Skill 补全 | `enterprise-enrichment` | 0.4.0：工商全景、股权穿透与历史工商 |
| 0.4.0 工具预检 | web `/data-cleaning/api/phase2/capabilities` | 只读检查 16+4 动态工具，不发起 QCC/付费调用 |
| QCC Host Bridge | web `/data-cleaning/api/g5/*` | 0.4.0：后台批量基础层；真实 OAuth/QCC 主路径、自然到期刷新与故障注入均已验收 |

## 企查查 MCP 补全（状态与路线图）

插件同时提供本地确定性补全和企查查 MCP 企业数据补全：

- **方案 A（模型中介，优先）**：用户已用 `qcc-dsh-mcp-oauth` 连接企查查后，
  Skill 引导模型对名单中每个企业名调用 `mcp__qcc-company__get_company_by_query` /
  `mcp__qcc-company__get_company_registration_info`，把返回的最新工商信息回填到补全工具。
  0.4.0 已将 16 个工商工具和 4 个历史工商工具固化为可测契约，
  按 `panorama` / `ownership` / `governance` / `history` 维度组按需调用；未显式选择时不会默认打满全部付费工具。
- **方案 B（后台程序化，0.4.0）**：Host Bridge 已通过公共 `ctx.tools.execute()` 实现
  批量补全、请求幂等、多候选人工确认续跑、retryable 失败人工重试与安全审计。
  批量 Web 端点同时要求 `confirmPaidCalls:true` 和唯一 `idempotencyKey`；多候选绝不自动选择。
  默认关闭的本机 E2E Runner 已就绪；2026-09-01 已在隔离 rc.2 Host 完成真实 OAuth、跨重启恢复和
  20 家公开企业的 400 次 QCC 调用；自然过期 token 的真实刷新、动态工具恢复及 1 行续期后调用也已通过。
  401 / 429 / 配额耗尽使用 Web→Bridge→ToolRuntime 故障注入验证，不额外消耗真实付费批次。

`qcc-dsh-mcp-oauth@0.1.7` 在 rc.2 实测注册为 `mcp__company__*` / `mcp__history__*`；
本插件的兼容 Bridge 会自动映射到文档规范名 `mcp__qcc-company__*` / `mcp__qcc-history__*`。
隔离 Profile 还需显式安装与 Host 同版本的 `@deepseek-ai/dsh-mcp-client`，详见兼容性文档。

详见 [docs/PLAN-OSS.md](docs/PLAN-OSS.md)。

0.4.0 真实账号验收的证据格式、安全门和命令见
[docs/PHASE2-ACCEPTANCE.md](docs/PHASE2-ACCEPTANCE.md)。
发布记录、验收门和回滚步骤见 [docs/RELEASE-0.4.0.md](docs/RELEASE-0.4.0.md)。

## 本地开发

要求 Node.js 20 或更高。DSH 运行期服务（`ctx.tools` / `ctx.skills` / `ctx.jobs` /
`ctx.storageDomain` / `webServer` / `webRuntime`）由 Host 提供，本地只装 `xlsx`：

```bash
npm install --legacy-peer-deps
npm run check
```

`npm run check` 会依次执行 lint、文档版本一致性、发布包白名单校验与单元测试。
真实 G5 验收必须按 [E2E 手册](docs/G5-E2E-RUNBOOK.md) 显式开启；默认执行 `npm run e2e:g5` 会安全拒绝。

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

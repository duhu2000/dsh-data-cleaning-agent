# Changelog

本文件记录 `dsh-data-cleaning-agent` 的版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- G5-1 QCC Host Bridge（`lib/qcc.js`）：通过公共 `ctx.tools.execute()` 程序化调用动态 MCP 工具，
  支持允许列表、超时/取消、OAuth 重注册窗口、企业去重批处理、多候选暂停与部分失败隔离。
- 同源 Web 端点 `/data-cleaning/api/g5/capabilities` 与 `/data-cleaning/api/g5/enrich`；
  计费调用前强制 `confirmPaidCalls:true`，单批最多 100 行。
- G5 Mock/Contract 测试 17 项。真实 OAuth、token 刷新和 QCC 调用保留为发布前 E2E 验收门。
- G5-2 安全闭环：默认关闭且仅允许回环 Host 的 E2E Runner、日志/报告脱敏、请求幂等、
  Host 内存 run 状态、多候选人工确认续跑、retryable 失败人工重试和安全调用审计。
- 上游错误细分为授权、权限、限流、配额、超时、工具刷新、服务不可用和契约拒绝；
  错误响应不再复述可能包含敏感内容的上游原始 message。

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

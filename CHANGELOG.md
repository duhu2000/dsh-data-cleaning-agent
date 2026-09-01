# Changelog

本文件记录 `dsh-data-cleaning-agent` 的版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

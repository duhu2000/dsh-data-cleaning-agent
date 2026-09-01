# 贡献指南 / Contributing

感谢你帮助改进 `dsh-data-cleaning-agent`。请不要在 Issue、PR、日志、截图或测试数据中提交 Token、API Key、Cookie、OAuth 凭据或真实业务数据。

Thank you for contributing. Never put tokens, API keys, cookies, OAuth credentials, or real business data in issues, pull requests, logs, screenshots, or fixtures.

## 参与方式

- 报告缺陷或提交功能建议：[GitHub Issues](https://github.com/duhu2000/dsh-data-cleaning-agent/issues)
- 修复插件或改进文档：Fork 本仓库，从最新 `main` 创建单一目的的分支并提交 PR。
- 第一次参与：从带有 [`good first issue`](https://github.com/duhu2000/dsh-data-cleaning-agent/labels/good%20first%20issue) 标签的任务开始，并按[首次贡献路径](docs/FIRST-CONTRIBUTION.md)完成本地校验。
- 提出企查查 MCP 补全相关需求：先阅读 [docs/PLAN-OSS.md](docs/PLAN-OSS.md) 了解路线图，再开 Issue 讨论。

## 本地开发

要求 Node.js 20 或更高版本。DSH 运行期 peer dependencies 由 Host 提供，本地安装使用：

```bash
npm install --legacy-peer-deps
npm run check
```

`npm run check` = lint（`node --check` 全部 lib）+ 文档版本一致性 + 发布包白名单校验 + 单元测试。

## PR 要求

1. 一个 PR 解决一个明确问题，不要夹带无关重构。
2. 新增或修改行为时增加对应测试；纯文档改动也必须通过 `npm run check`。
3. 中英文用户文档应同步更新（`README.md` 与 `README.en.md`）。
4. README 中展示的版本必须与 `package.json` 一致，`npm run docs:check` 会阻断版本漂移。
5. 只使用无凭据 mock 或已脱敏数据做测试与截图；引擎测试夹具不得含真实手机号/企业名。

## 从 Fork 到 PR

```bash
git switch main
git pull --ff-only
git switch -c feat/<short-purpose>
npm install --legacy-peer-deps
npm run check
```

提交时说明用户问题、解决方案、测试结果与必要的手工验收步骤。

## 维护者如何准备首次贡献任务

首次贡献任务应边界清楚、无需真实凭据或私有 DSH 环境，并在 Issue 中写明背景、建议修改文件、验收标准和验证命令。适合的范围包括文档示例、无凭据测试夹具、可访问性文案和小型校验器改进；涉及发布、OAuth 凭据、企查查 MCP 授权或大规模重构的工作不应标记为 `good first issue`。

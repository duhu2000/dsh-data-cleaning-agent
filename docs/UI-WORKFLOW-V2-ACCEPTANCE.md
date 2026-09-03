# 数据清洗补全 v2 · T6～T9 验收与发布准备

> 验收日期：2026-09-04
> 分支：`feat/ui-workflow-v2`，基线 `main@0be4de3`
> 状态：本地开发与验收完成，作为 `0.6.0` 发布门；本文不替代 npm/GitHub 外部发布核验。

## 1. 验收范围

| 任务 | 交付 | 结论 |
| --- | --- | --- |
| T6 | Host 耐久制品、真实 XLSX、异常清单、双基线、视觉回归、迁移/回滚 | 通过 |
| T7 | 匹配摘要、候选人工核验、部分失败显式重试、补全后导出 | 通过 |
| T8 | 四类制品下载、taskId 历史恢复、跨 Host 重启下载 | 通过 |
| T9 | 自动化门禁、tarball 白名单、兼容与发布决策 | 通过；版本确定为 0.6.0 |

## 2. T6 制品契约

每个完成任务生成四个工作区本地制品：

1. 清洗补全结果 CSV；
2. 清洗补全结果 XLSX；
3. 异常清单 CSV；
4. 异常清单 XLSX。

DSH rc.2 / alpha.2 当前验证的 `ctx.fs` 只公开 `writeText` 与 `readBytes`，未验证稳定的二进制写接口。
因此 CSV 以 UTF-8 文本保存，真实 XLSX 字节以 Base64 文本保存，下载时解码并校验 SHA-256。该策略被
隔离在 `lib/artifacts.js`，以后 Host 提供稳定 `writeBytes` 时可只替换适配层。

限制：单制品最大 32 MiB、单次最多 100,000 行、最多 256 列。制品目录是
`.dsh-data-cleaning-artifacts/v1/<taskId>/`，已加入 Git 忽略规则，不进入 npm 包。
CSV 会中和公式型外部文本；XLSX Base64 的读取上限按编码膨胀计算，解码后仍执行 32 MiB 硬限制。

## 3. 双基线跨重启实测

| DSH | 隔离端口 | 初次运行 | 重启恢复 | XLSX |
| --- | ---: | --- | --- | --- |
| `0.1.1-rc.2` | 43190 | seam、任务、四制品通过 | 同一 taskId/制品通过 | ZIP magic `PK`；工作表“清洗补全结果” |
| `0.1.2-alpha.2` | 43191 | seam、任务、四制品通过 | 同一 taskId/制品通过 | ZIP magic `PK`；工作表“清洗补全结果” |

实测使用合成的两行数据和隔离 Profile；未触碰生产端口 `43120`，未调用 QCC，未产生企查查费用。

## 4. T7 匹配与补全闭环

- 字段映射必须包含企业名称、统一社会信用代码或注册号之一。
- `exact / candidate / confirmed / unresolved / failed` 数量受总数约束，不显示无来源置信度。
- 多候选进入人工核验；`partial` 可显式重试并回到 `export_ready`。
- QCC 估算为零调用；真正执行前仍要求 `confirmPaidCalls:true`、幂等键与调用上限。
- 用户使用自己连接的 QCC MCP 账号并承担其账号额度/费用；插件不共享 Key、不代付。

## 5. T8 恢复与下载

- 最近任务入口会把完整 taskId 注入工作台，不会误创建新草稿。
- 已完成任务即使浏览器 runtime 中没有原始行，也能从 Host 读取四类制品并下载。
- 下载响应使用固定同源路由、受控文件名、内容类型、长度与 `nosniff`，读取时验证 checksum。
- v2 不再登记 `browser-download:` 伪引用。

## 6. 视觉回归

真实 rc.2 页面已验证：

- 浅色桌面：首页、原生 Composer、输入框下五能力、右侧非模态工作台位置正确；
- 深色：首页、按钮、五步状态、下载制品信息可读；
- 820×900 窄屏：`scrollWidth === viewport width`，页面无横向溢出；右栏按窄屏安全覆盖中央内容；
- 完成任务恢复后显示原 taskId、输入行数及四个下载按钮。

## 7. 自动化与发布门

发布候选必须同时满足：

```bash
npm run check
git diff --check
npm pack --dry-run --json --cache .npm-cache
```

并复核 tarball 不包含测试、OAuth/Key、真实名单、QCC 原始响应、`.dsh-data-cleaning-artifacts/` 或
`_scratch/`。2026-09-04 最新本地门禁结果为 `npm run check` 全绿、165/165 测试通过、npm tarball
44 个文件全部命中白名单，`git diff --check` 无错误。

## 8. 版本决策与剩余发布动作

版本确定为 **0.6.0**，原因是新增 Host 工作流 API、持久化 domain、耐久制品和完整五步业务流程。
发布按顺序执行：最终代码审查 → 版本/README/Changelog 快照 → commit/push → Tag → OIDC npm 发布 →
GitHub Release → 公共 Registry 全新安装。验收记录本身不等于外部平台已经完成发布。

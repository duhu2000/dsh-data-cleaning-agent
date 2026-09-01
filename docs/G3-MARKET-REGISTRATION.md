# G3：DSH 视觉插件市场收录与自动验收

- 日期：2026-09-01
- 状态：**G3-2 已完成并推送；外部 PR 未提交**
- 外部仓库：[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- 官方提交说明：[`contributing.md`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)

## 目标与边界

让 `dsh-data-cleaning-agent` 进入 DSH 视觉插件市场实际读取的 curated registry。提交材料和可重复验收链路已推送到插件仓库；尚未创建外部 PR，也没有修改上游仓库。

## 已验证事实

1. 视觉市场读取 `https://awesome-dsh-plugin.com/plugins.json`；截至本次检查，其中没有精确匹配的 `dsh-data-cleaning-agent` 条目。
2. 上游当前要求插件仓库至少存在 1 天、至少 10 个 commit、包含 `dsh.bundle`，并带 `dsh-plugin` topic；收录文件必须是单个 YAML。
3. 本地接手前远端 `main` 有 3 个 commit；T0 + G3-2 + S7 推送后为 6 个，本次 G5-1 推送后为 7 个，仍不满足“至少 10 个 commit”。不得为凑门槛制造空提交。
4. npm `0.3.0` 已在隔离 DSH host 安装冒烟通过，`enrichSkillRegistered:true`；这证明包可用，但不等于市场已经收录。

## 上游提交材料

待远端真实历史满足准入条件后，在上游创建：

`data/plugins/duhu2000__dsh-data-cleaning-agent.yml`

```yaml
url: https://github.com/duhu2000/dsh-data-cleaning-agent
name: duhu2000/dsh-data-cleaning-agent
category: tools
description:
  en: 'Clean, complete, profile, and deduplicate CSV/XLSX/JSON enterprise lists in DeepSeek Harness, with optional Qichacha MCP enrichment.'
  zh: '在 DeepSeek Harness 中清洗、补全、画像和去重 CSV/XLSX/JSON 企业名单，并可选使用企查查 MCP 补全企业数据。'
```

提交前仍需在上游再次核对 schema 与分类枚举，避免上游规则变更后照搬本文件。

## 自动验收

本仓库新增：

- `npm run market:check`：本地读取验收状态；没有 PR 号时返回 `not-submitted`，退出码为 0。
- `scripts/check-market-registration.mjs`：依次检查上游 PR、上游 YAML、线上 `plugins.json`。
- `.github/workflows/market-registration.yml`：支持手动触发、主分支相关文件变更和每小时定时检查。
- `test/market-registration.test.mjs`：覆盖地址规范化、registry 形态和完整状态机。

PR 创建后，把编号配置为仓库变量 `DSH_MARKET_PR_NUMBER`，或手动运行 workflow 时传入 `pull_request_number`。

| 状态 | 含义 | 自动验收 |
| --- | --- | --- |
| `not-submitted` | 尚无外部 PR | 等待，不失败 |
| `awaiting-merge` | PR 开放但未合并 | 等待，不失败 |
| `awaiting-directory-sync` | PR 已合并，但 YAML 或线上目录尚未同时生效 | strict workflow 失败，继续追踪 |
| `accepted` | PR、YAML、线上目录均生效 | 通过 |
| `closed-without-merge` | PR 关闭且未合并 | 失败 |

## G3 完成门

只有以下各项全部成立才可将 G3 标为完成：

1. 远端仓库满足上游实时准入规则。
2. 上游 PR 已合并。
3. `awesome-dsh-plugin` 主分支出现目标 YAML。
4. `https://awesome-dsh-plugin.com/plugins.json` 可精确搜索到插件。
5. 从视觉市场一键安装后，隔离 host 的 seam 与核心闭环通过。

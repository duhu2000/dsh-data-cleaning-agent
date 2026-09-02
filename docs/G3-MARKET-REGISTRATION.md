# G3：DSH 视觉插件市场收录与自动验收

- 日期：2026-09-02
- 状态：**已完成（G3 全部门通过）**
- 外部仓库：[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- 上游 PR：[`awesome-dsh-plugin#4095`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4095)
- 官方提交说明：[`contributing.md`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)

## 目标与边界

让 `dsh-data-cleaning-agent` 进入 DSH 视觉插件市场实际读取的 curated registry。提交材料和可重复验收链路已推送到插件仓库；上游 PR #4095 只新增目标注册 YAML。

## 已验证事实

1. 视觉市场读取 `https://awesome-dsh-plugin.com/plugins.json`；截至本次检查，其中没有精确匹配的 `dsh-data-cleaning-agent` 条目。
2. 上游当前要求插件仓库至少存在 1 天、至少 10 个 commit、包含 `dsh.bundle`，并带 `dsh-plugin` topic；收录文件必须是单个 YAML。
3. 远端 `main` 已有 10 个有效 commit，并已配置 `dsh-plugin` topic；第 10 个提交修复了“粘贴 CSV 后清洗误按 JSON 解析”的真实 UI 闭环，并加入市场截图，不是空提交。
4. 仓库创建时间为 2026-09-01 01:47:13 UTC；年龄门于 2026-09-02 01:47:13 UTC 达成。
   由于贡献者无权直接 rerun 上游 workflow，使用 GitHub 标准 Update branch 将落后上游 245 个提交的
   PR 分支同步到最新 `main`，触发 `synchronize`；新 head `57ee04b` 的常规 `check` 与
   `Submission gate` 均于 2026-09-02 01:58 UTC 通过，PR 状态为 `CLEAN`。
5. npm `0.3.0` 已在隔离 DSH host 安装冒烟通过，`enrichSkillRegistered:true`；这证明包可用，但不等于市场已经收录。
6. 2026-09-02 npm `0.4.0` 发布后又从公共 Registry 安装到全新隔离 DSH profile（端口 43160）：
   三工具、两个 Skill、Web 与 QCC Bridge seam 全部注册，未装 OAuth 时正确返回 `oauth-plugin-missing`；
   测试 Host 已停止，生产 43120 未触碰。
7. 2026-09-02 PR #4095 已合并：`state=MERGED`，`mergedAt=2026-09-02T03:49:24Z`，`mergedBy.login=fkysly`。
   `MARKET_PR_NUMBER=4095 npm run market:check` → `{"status":"accepted","ok":true}`（`pullRequestMerged` / `registrationPresent` / `directoryPresent` 全 true）。
8. 上游主分支已出现目标 YAML（`data/plugins/duhu2000__dsh-data-cleaning-agent.yml`，原始 URL 内容与本文件 §「上游提交材料」逐字一致）。
9. `plugins.json`（2585310 字节，2936 条）精确命中 1 条：`name=dsh-data-cleaning-agent`、`owner=duhu2000`、
   `category=tools`、`install=dsh plugin --profile web add github:duhu2000/dsh-data-cleaning-agent`、
   `page=https://awesome-dsh-plugin.com/p/duhu2000/dsh-data-cleaning-agent/`、`added=2026-09-01`、`npm=null`、双语描述、2 张截图。
10. 视觉市场一键安装（G3 完成门第 5 门）在全新隔离 `DSH_HOME` + 端口 `43161` 冒烟通过：
    市场 install 命令 `dsh plugin --profile web add github:duhu2000/dsh-data-cleaning-agent` 安装到 `0.4.0`；
    `--dump-config` 见 `data-cleaning-agent` 插件层；host `apply()` 打印；根 HTML 含 `__DSH_BOOT__` 与 `dsh-data-cleaning-agent`；
    `/data-cleaning/api/mvp/seam` 全绿（`toolRegistered` / `skillRegistered` / `webMounted` / `qccBridgeMounted` 均 true，
    未装 OAuth 正确返回 `oauth-plugin-missing`）；核心闭环 parse→clean→complete→profile→CSV 导出全通（clean 缺 phone/负金额/重复正确丢弃）。
    测试 Host 已停止，生产 43120 未触碰。
11. 市场 UI「搜不到本插件」≠ 收录失败：视觉市场 `dsh-market` 按区域双通道加载目录（`src/regions.ts`）。
    - `global`：直读 `https://awesome-dsh-plugin.com/plugins.json`。
    - `china`：① 先读腾讯 npm 镜像的 **`dsh-plugin-catalog`** 包 → ② 仅当 npm 包拉取失败/为空才回退到 `plugins.json` URL。
    实测：在线 `plugins.json` = 2936 条、**含**本插件（`added=2026-09-01`）；npm 包 `dsh-plugin-catalog@2026.901.3077` = 2821 条、**不含**本插件，
    `updated=2026-09-01`、发布于 `2026-09-01T09:02:21Z`（早于 PR 合并 `2026-09-02T03:49:24Z`）。npm 包按约 1–3 天周期发布
    （`2026.824→825→826→829→831→901`），上次发布恰好落在合并前，故 china 区域市场仍显示旧目录且因「npm 包返回成功」而永不回退到已更新的 URL。
    这是上游目录管线的一次正常发布滞后，非本仓库/PR 问题；待下次 `dsh-plugin-catalog` 发布即自动进入市场搜索。
    立即可验证：市场 Settings 切到 `global` 区域，或设 `DSHM_REGISTRY_URL=https://awesome-dsh-plugin.com/plugins.json`。

## 上游提交材料

PR #4095 已在上游创建：

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
- `screenshots.json`：声明市场详情页使用的实际插件 UI 截图；图片位于 `assets/screenshots/`。

仓库变量 `DSH_MARKET_PR_NUMBER=4095` 已配置；自动 workflow 会追踪合并及目录同步，也可手动运行时传入 `pull_request_number`。

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

# 整体进度总账 / Progress Ledger

> 单一进度入口：每次会话收口后更新本文档，记录「已完成 / 进行中 / 待办 / 挂起」与任务清单，
> 方便随时跟进。交接细节与禁区规则见根目录 `HANDOFF.md`；本文档只做滚动进度台账。
>
> 最近更新：2026-09-02

---

## 0. 一句话状态

`0.4.0` 已正式发布（npm `latest` + GitHub Latest 一致）。`0.5.0` 开发主线进行中：
P1.1 契约盘点与 M1–M4 应用内入口（侧边栏「数据清洗」→ 工作台 → 工具卡 → 任务 pill）已全部完成并双基线冒烟通过；
P1.2 / P1.3（风险/知产/经营三域 Skill 与 Host Bridge 批量）按计划延后，待恢复。
P0/G3 市场收录已全部门完成（PR 合并 + 目录 YAML 落库 + `plugins.json` 命中 + 视觉市场一键安装冒烟通过）。

---

## 1. 状态图例

| 标记 | 含义 |
| --- | --- |
| ✅ 完成 | 已落地并验收 |
| 🔵 进行中 | 正在做 |
| ⏸️ 挂起 | 按计划延后，成果保留、解冻后复用 |
| ⬜ 待办 | 尚未开始 |
| ⏳ 外部等待 | 依赖第三方（上游合并等） |

---

## 2. 总账看板

| 编号 | 任务 | 状态 | 说明 / 验收结论 |
| --- | --- | --- | --- |
| **P0 / G3** | 上游市场收录（PR #4095） | ✅ 完成 | PR 已合并、目录 YAML 落库、`plugins.json` 命中、视觉市场一键安装冒烟（43161）通过 |
| **P1.1** | 风险/知产/经营三域契约盘点 | ✅ 完成 | 91 工具（risk 38 + ipr 18 + operation 35）冻结契约；`lib/qcc-phase3.js` + `/data-cleaning/api/phase3/capabilities` + 契约测试 |
| **M1** | 应用内入口克隆验证 | ✅ 完成 | 侧边栏 footer「数据清洗」入口 + `shell.overlay` 占位；隔离 profile，未触碰 43120 |
| **M2** | 工作台视图（四步） | ✅ 完成 | 上传 → 画像 → 清洗 → 导出；复用 `/data-cleaning/api/mvp/*` |
| **M3** | 交互闭环（工具卡 + 任务 pill） | ✅ 完成 | 三张 `tool.call.toolview` 卡（clean/complete/profile）+ 工作台头部 jobs 轮询 pill |
| **M4** | 验收 + 文档 | ✅ 完成 | `npm run check` 100/100 全绿；rc.2 + alpha.2 双基线入口可发现；README/README.en/USER-GUIDE/COMPATIBILITY 更新；无新真实 QCC 调用 |
| **P1.2** | Skill 扩展（`enterprise-enrichment` 三域组） | ⏸️ 挂起 | 契约成果（P1.1）保留，解冻后直接复用 |
| **P1.3** | Host Bridge 扩展（三域批量） | ⏸️ 挂起 | 复用 `lib/qcc.js` 公共 ToolRuntime，不新建第二套 client |
| **P1.4** | Web/UI 与输出契约（0.5.0 完整版） | 🔵 部分 | M1–M4 已提前交付工作台/工具卡/任务 pill；剩余：维度组勾选、计费确认、候选复核、部分成功/失败重试 |
| **P1.5** | 0.5.0 验收 | ⬜ 待办 | Mock/Contract/Web/Safety 全量回归 + 隔离 Host E2E（真实 QCC 前须用户确认名单/域/上限/预算） |
| **P1.6** | 0.5.0 发布 | ⬜ 待办 | README/CHANGELOG/兼容矩阵/迁移回滚 + 隔离安装冒烟 → 用户批准后打 tag 走 OIDC |
| **P2** | 可选 `0.4.1`（仅 README 文案） | ⬜ 待决策 | 运行时无故障，不阻断 0.5.0，由用户拍板 |

---

## 3. 当前工作树（未提交变更）

> 本次会话（M4）完成后 `npm run check` EXIT=0。以下为 `git status --short` 实测结果。

**已修改（M）**：`HANDOFF.md`、`README.md`、`README.en.md`、`docs/COMPATIBILITY.md`、
`docs/G3-MARKET-REGISTRATION.md`、`docs/USER-GUIDE.md`、`lib/client.js`、`lib/qcc.js`、
`lib/web.js`、`package.json`、`test/qcc-bridge.test.mjs`

**未跟踪（??）**：`docs/DSH-ENTRY-UI-PLAN.md`、`docs/P1.1-CONTRACT-INVENTORY.md`、
`lib/qcc-phase3.js`、`test/client-entry.test.mjs`、`test/qcc-phase3-contract.test.mjs`

---

## 4. 关键坐标与基线

| 项 | 值 |
| --- | --- |
| 代码基线 | `508103661ec8398b41d4f9b99aba9cc96b9fac9d`（`main` / `origin/main`） |
| 当前版本 | `0.4.0`（npm `latest` + GitHub `v0.4.0` 已发布） |
| 下一版本 | `0.5.0`（风险/知产/经营 + 批量后端） |
| 稳定发布基线 | DSH `0.1.1-rc.2`（冒烟端口 43136 / 43141） |
| 兼容探针基线 | DSH `0.1.2-alpha.2`（冒烟端口 43137 / 43143，仅探针，非稳定契约） |
| 生产 GUI | `http://127.0.0.1:43120` —— **严禁触碰** |
| Git 远端 | `https://github.com/duhu2000/dsh-data-cleaning-agent.git`（`main`） |

---

## 5. 禁区与铁律（每次续做前重读）

1. 不重跑 20 企业 / 400 次真实 QCC 调用，除非用户再次明确批准名单、调用量与费用。
2. 不触碰生产端口 `43120`；一切安装/E2E/冒烟用隔离 `DSH_HOME` + 专用新端口。
3. 不重发或覆盖 npm `0.4.0`（已发布版本不可变）。
4. 不提交 `.phase2-e2e/`、`.g5-e2e/`、OAuth 参数、token、真实名单或工具原始响应。
5. 只走公共 `ctx.tools.get/execute`，不访问 mcp-client 私有 client/loader 内部。
6. 不把 `0.1.2-alpha.2` 实验 API 当稳定公开契约。

---

## 6. 下一步（按优先级）

1. **G3 已完成**：PR #4095 合并、目录 YAML 落库、`plugins.json` 命中、视觉市场一键安装冒烟（43161）均通过；唯一残留为 china 区 npm 目录 `dsh-plugin-catalog` 的常规发布滞后（上游管线，非本仓库问题）。
2. **恢复 P1.2 → P1.3**：解冻风险/知产/经营三域 Skill 与 Host Bridge 批量（复用 P1.1 契约成果）。
3. **P1.4 收尾**：维度组勾选、付费调用估算/二次确认、部分成功、候选复核、失败重试、CSV 导出。
4. **P1.5 → P1.6**：全量回归 + 隔离 Host E2E + 发布物料，最终由用户批准打 `v0.5.0` tag。

---

*本台账与代码同步维护；权威细节以 `HANDOFF.md`、`docs/PLAN-OSS.md`、`docs/QCC-PHASES-ROADMAP.md`、`CHANGELOG.md` 为准。*

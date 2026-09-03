# 整体进度总账 / Progress Ledger

> 单一进度入口：每次会话收口后更新本文档，记录「已完成 / 进行中 / 待办 / 挂起」与任务清单，
> 方便随时跟进。交接细节与禁区规则见根目录 `HANDOFF.md`；本文档只做滚动进度台账。
>
> 最近更新：2026-09-03

---

## 0. 一句话状态

`0.5.0` 已正式发布：npm `latest`、Git tag 与 GitHub Latest 一致。P1.1～P1.6 开发、验收、
最小真实 Phase-3 E2E 与发布后公共安装均已完成。发布标签 `v0.5.0` 指向 `c1c889f`；
Release workflow `33708528501` 全绿，npm provenance 为 SLSA v1。CI run `33708216132` 的
Linux Node 22/24 与 Windows Node 24 矩阵全绿；Actions 使用 Node 24 runtime。
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
| **M2** | 工作台视图（四步） | ✅ 完成 | 上传与映射 → 数据体检 → 匹配核验 → 补全与导出；复用 `/mvp/*` 与 `/phase3/*` |
| **M3** | 交互闭环（工具卡 + 任务 pill） | ✅ 完成 | 三张 `tool.call.toolview` 卡（clean/complete/profile）+ 工作台头部 jobs 轮询 pill |
| **M4** | 验收 + 文档 | ✅ 完成 | rc.2 + alpha.2 双基线入口可发现；README/README.en/USER-GUIDE/COMPATIBILITY 更新；无新真实 QCC 调用 |
| **P1.2** | Skill 扩展（`enterprise-enrichment` 三域组） | ✅ 完成 | 风险/知产/经营域组、付费确认、来源保真与无权/无数据/限流降级规则已固化并测试 |
| **P1.3** | Host Bridge 扩展（三域批量） | ✅ 完成 | 91 工具批量服务、调用预算、Host 内存 run、候选续跑与失败工具人工重试已实现 |
| **P1.4** | Web/UI 与输出契约（0.5.0 完整版） | ✅ 完成 | 域组勾选、零调用估算、付费确认、候选复核、恢复/重试、双 CSV；中文字段映射贯通本地清洗 |
| **P1.5** | 0.5.0 验收 | ✅ 完成 | `npm run check` 125/125；双基线 Host 24/24；rc.2 实际渲染；最小真实 Phase-3 E2E 2/2 调用、1 行补全、0 错误 |
| **P1.6** | 0.5.0 发布 | ✅ 完成 | `v0.5.0`、npm OIDC provenance、GitHub Release 与公共 Registry 全新安装均已通过 |
| **P2** | `0.4.1` 文案补丁 | ⏸️ 取消单独发布 | 0.4.0 tarball 文案修正并入 0.5.0，不覆盖已发布版本 |

---

## 3. 当前工作树

P1.3、P1.4、P1.5 均已形成独立提交；P1.6 版本与发布物料已完成本地验收和版本收口。
本地 `main` 与 `origin/main` 已同步；实现基线包含 `0a22251`，工作树干净。

---

## 4. 关键坐标与基线

| 项 | 值 |
| --- | --- |
| 代码基线 | `v0.5.0` → `c1c889f`；`main` / `origin/main` 发布后文档收口 |
| 当前源码版本 | `0.5.0`（已发布） |
| npm `latest` | `0.5.0`（OIDC Trusted Publishing + SLSA v1 provenance） |
| 稳定发布基线 | DSH `0.1.1-rc.2`（冒烟端口 43136 / 43141） |
| 兼容探针基线 | DSH `0.1.2-alpha.2`（冒烟端口 43137 / 43143，仅探针，非稳定契约） |
| 生产 GUI | `http://127.0.0.1:43120` —— **严禁触碰** |
| Git 远端 | `https://github.com/duhu2000/dsh-data-cleaning-agent.git`（`main`） |

---

## 5. 禁区与铁律（每次续做前重读）

1. 客户自带 QCC MCP 账号并自行付费，开发者 Key 不交付客户；不重跑 20 企业 / 400 次真实 QCC
   调用，除非维护者再次批准测试名单、调用上限及自己承担的测试预算。
2. 不触碰生产端口 `43120`；一切安装/E2E/冒烟用隔离 `DSH_HOME` + 专用新端口。
3. 不重发或覆盖任何已发布 npm 版本；新版本 tag / npm / GitHub Release 仍需单独批准。
4. 不提交 `.phase2-e2e/`、`.g5-e2e/`、OAuth 参数、token、真实名单或工具原始响应。
5. 只走公共 `ctx.tools.get/execute`，不访问 mcp-client 私有 client/loader 内部。
6. 不把 `0.1.2-alpha.2` 实验 API 当稳定公开契约。

---

## 6. 下一步（按优先级）

1. 决定是否为 npm 包页的不可变 0.5.0 README 状态文案安排后续补丁版本；不得覆盖 0.5.0。
2. 如需对知产或经营域追加真实付费实调，重新批准工具、企业夹具、`maxCalls` 和维护者测试预算；
   该扩展不属于当前 0.5.0 发布阻断项。
3. 0.6.0 历史/人员/招投标扩展在产品范围确认后再启动。

---

*本台账与代码同步维护；权威细节以 `HANDOFF.md`、`docs/PLAN-OSS.md`、`docs/QCC-PHASES-ROADMAP.md`、`CHANGELOG.md` 为准。*

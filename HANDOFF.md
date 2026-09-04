# 数据清洗补全智能体 · DeepSeek Harness 开发移交文档

> 目的：作为从 GPT 开发任务转入 DeepSeek Harness（DSH）继续开发的唯一入口。
> 接手者无需回溯对话，应先执行下方「接手启动清单」，再按 P0 → P1 顺序续做。
> 最近更新：2026-09-04
> 当前已发布版本：**0.6.0**（npm `latest`、Git tag 与 GitHub Latest 一致）
> 当前开发分支：**`main`**（UI-V2 T0～T9 已发布）

---

## 接手摘要（DeepSeek Harness 先读）

### 当前结论

- **已稳定发布**：`dsh-data-cleaning-agent@0.6.0`，npm `latest` 与 GitHub Release `v0.6.0` 一致。
- **当前开发主线**：基于企查查专业版 3.5.1 与新版 Mockup，主流程为“上传数据 → 规则确认 →
  数据匹配 → 清洗补全 → 下载数据”。T0～T9 已完成：契约、Host taskId/revision、上传/字段映射、
  提示词向导、中央首页、匹配与补全闭环、结果/异常 CSV+XLSX、历史恢复、双基线和视觉回归均已接通；
  当前自动化 165/165，rc.2 43190 与 alpha.2 43191 跨重启恢复通过。详见
  `docs/UI-WORKFLOW-V2.md` 与 `docs/UI-WORKFLOW-V2-ACCEPTANCE.md`。
  PR #1 已合并，`v0.6.0`、npm OIDC provenance、GitHub Release 与公共安装已全部通过。
- **已完成的主能力**：本地 CSV/XLSX/JSON 清洗补全、三工具、两个 Skill、异步任务、Web UI、
  QCC Host Bridge、批量幂等、多候选人工续跑、脱敏审计、工商 16 + 历史工商 4 工具契约。
- **真实 E2E 已过**：隔离 DSH `0.1.1-rc.2` 完成 OAuth、授权跨重启恢复、20 企业/400 次 QCC 调用、
  token 自然到期 refresh、续期后最小真实调用、401/429/配额故障注入。
- **当前代码基线**：`v0.6.0` 指向 PR #1 合并提交 `084efd0`；本地开发回到 `main`。
- **最新 CI**：PR run `33817126492` 在 Linux Node 22/24 + Windows Node 24 及打包门全绿；
  Release workflow `33817341580` 完成 npm OIDC publish 与 GitHub Release。
- **P0/G3 已完成**：上游市场 [PR #4095](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4095)
  已合并，目录 YAML、在线 `plugins.json` 与视觉市场隔离安装冒烟均通过。
- **0.5.0 已完成的主线**：91 工具契约、三域 Skill、批量 Host Bridge、四步工作台、候选续跑、
  失败重试、双 CSV 与默认关闭 Runner；本地 125/125、双基线 Host 24/24、rc.2 实际 UI 闭环通过。
- **最小真实门已过**：2026-09-03 在隔离 rc.2 Host 以维护者测试账号执行 1 家公开主体、
  1 个风险工具，实际 2/2 次调用，1 行补全、0 待复核、0 错误；临时凭据副本已清理。
- **发布已完成**：`v0.5.0` 指向 `c1c889f`；OIDC publish、SLSA v1 provenance、GitHub Release
  与公共 Registry 全新安装均已验证。客户生产费用不在本插件承担范围内。
- **0.5.1 已发布**：只修正文档快照并增加标签发布严格文案 Gate；128/128、36 文件、Release
  workflow `33710151625`、SLSA v1 provenance、GitHub Release 与公共安装全绿。运行时/QCC 契约不变。

### 接手启动清单

```bash
cd '/Users/qcc/Documents/DuHu/QCC/beichacha_doc/云聚接口/MCP/MCP/workspace/dsh-data-cleaning-agent'
git status --short --branch
git pull --ff-only
npm install --ignore-scripts --no-package-lock   # 仅在 node_modules 缺失时执行
npm run check
MARKET_PR_NUMBER=4095 npm run market:check
```

预期：

- `npm run check` 应全绿；已发布 0.6.0 基线为 165/165 测试通过。
- `market:check` 应返回 `accepted`，不应修改已合并的市场提交 YAML。
- 若基线不符，先停止功能开发，核对 `git log` / 远端 CI / npm `latest`，不得盲目覆盖用户更改。

### 不要重复或越界的事

1. 不要重发或覆盖任何已发布版本；未来新版本未经新批准不得打 tag、发布 npm 或创建 GitHub Release。
2. 客户使用时自带 QCC MCP 账号并自行付费；开发者 Key 不得交付客户。不要重跑 20 企业/400 次
   真实 QCC 调用，除非维护者再次明确批准测试名单、调用上限和自己承担的测试预算。
3. 不要触碰生产 DSH GUI/Profile（端口 `43120`）；所有安装和 E2E 必须用隔离 `DSH_HOME` 与新端口。
4. 不要提交 `.phase2-e2e/`、`.g5-e2e/`、OAuth 参数、token、真实企业名单或工具原始响应。
5. 不要访问 mcp-client 私有 client/loader 内部；只能走已验证的公共 `ctx.tools.get/execute`。
6. 不要把 `0.1.2-alpha.2` 的实验 API 当稳定公开契约。

## 0. 一句话定位

在 DeepSeek Harness（DSH）中清洗、补全、画像企业名单数据的智能体插件：
本地 CSV/XLSX/JSON 引擎（清洗 / 补全 / 画像 / 去重）+ 内嵌 Skill + 异步任务状态机，
**可选**接入企查查（Qichacha/QCC）MCP 做企业工商数据补全。由企查查团队发起并维护，MIT 开源。

---

## 1. 关键坐标（接手必读）

| 项 | 值 |
| --- | --- |
| 本机仓库路径 | `/Users/qcc/Documents/DuHu/QCC/beichacha_doc/云聚接口/MCP/MCP/workspace/dsh-data-cleaning-agent` |
| Git 远端 | `https://github.com/duhu2000/dsh-data-cleaning-agent.git`（分支 `main`） |
| npm 包名 | `dsh-data-cleaning-agent`（无 scope，public） |
| npm `latest` | `0.6.0`（OIDC Trusted Publishing + SLSA v1 provenance） |
| GitHub Release | `v0.6.0`（Latest） |
| Git tags | `v0.2.1`、`v0.3.0`、`v0.4.0`、`v0.5.0`、`v0.5.1`、`v0.5.2`、`v0.5.3`、`v0.6.0` |
| 工作树状态 | `v0.6.0` 指向 `084efd0`；PR #1 已合并，`main` 在发布 Tag 后仅补充发布记录 |
| git 身份 | `DuHu <duhu@greatld.com>` |
| gh 账号 | `duhu2000` |
| npm 维护者 | `duhu2000 <dlaohu2008@gmail.com>` |
| license | MIT |
| 本机 DSH 框架 | `0.1.1-rc.2`（`@deepseek-ai/*` 包线；launcher 为 `dsh-plugin-desktop@2.0.2`） |
| 生产 GUI | `http://127.0.0.1:43120`（profile：`~/.dsh/profiles/web`）——**冒烟测试严禁触碰** |

> npm 缓存坑：本机 `/Users/qcc/.npm/_cacache` 曾被 root 占用导致 `npm view` EPERM，
> 解决办法是 `npm ... --cache .npm-cache`（项目本地缓存目录）。
>
> 0.4.0 tarball 的 README 是 tag 时快照，仍写“发布候选 / latest 0.3.0”；运行包与 provenance 正常，
> GitHub `main` 已修正，文案更新已并入 0.5.0；npm 同版本不可覆盖。
>
> 0.5.0 tarball 的 README 同样是 tag 时快照，仍写“发布候选 / latest 0.4.0”；运行包、provenance
> 与 Release 正常，GitHub `main` 已修正。若需要修正 npm 包页，只能发布新的补丁版本。

---

## 2. 版本时间线

| 版本 | 日期 | 内容 | 状态 |
| --- | --- | --- | --- |
| 0.1.0-mvp | 2026-08-31 | 内部 MVP，双基线（rc.2 + alpha.2）端到端验证通过；`@qcc` scope，**未对外发布** | ✅ 完成（仅本机） |
| 0.2.0 | 2026-09-01 | 开源化 G1：改名 `dsh-data-cleaning-agent`，补齐 README/LICENSE/CONTRIBUTING/install.sh/marketing/CI 骨架 | ✅ 已发布 |
| 0.2.1 | 2026-09-01 | G2 补充：npm OIDC Trusted Publishing 发布链路验证（无功能变更） | ✅ 已发布 |
| 0.3.0 | 2026-09-01 | G4 方案 A：内嵌 `enterprise-enrichment` Skill，模型中介式调企查查 MCP 补全企业名单 | ✅ 已发布 |
| 0.4.0 | 2026-09-02 | 二期工商全景 16+4 工具契约、G5 Host Bridge、安全验收与 OAuth 0.1.7 双命名兼容 | ✅ 已发布 |
| 0.5.0 | 2026-09-03 | 三域 91 工具、批量后端、Mockup 对齐工作台、任务恢复/重试与双 CSV | ✅ 已发布 |
| 0.5.1 | 2026-09-03 | README 状态修正 + 标签发布严格文案 Gate；无运行时变化 | ✅ 已发布 |
| 0.5.2 | 2026-09-03 | DSH 原生 UI 对齐：顶部入口、原生会话、五能力入口、非模态右栏 | ✅ 已发布 |
| 0.5.3 | 2026-09-03 | 中央业务首页、提示词生成器、输入框下能力入口与 Excel/图片 Bridge | ✅ 已发布 |
| 0.6.0 | 2026-09-04 | 五步 taskId 工作流、Host 耐久 CSV/XLSX、异常清单、跨重启恢复与双基线 | ✅ 已发布（npm latest） |

---

## 3. 仓库结构（核心文件）

```
dsh-data-cleaning-agent/
├── package.json              # dsh.bundle.patch + dsh.client + exports["./client"]
├── cordis.patch.yml          # bundle patch 入口
├── lib/
│   ├── index.js              # apply(ctx)：注入 tools/skills/jobs/storageDomain/web/client
│   ├── engine.js             # 纯函数引擎：parseCsv/Xlsx/Json、cleanRows、completeRows、profileRows、toCsv、normalizePhone
│   ├── tools.js              # data_clean_rows / data_complete_rows / data_profile
│   ├── skill.js              # 内嵌 Skill：data-cleaning
│   ├── skill-enrich.js       # 内嵌 Skill：enterprise-enrichment（QCC 方案 A，0.3.0 新增）
│   ├── qcc.js                # G5 Host Bridge：公共 ToolRuntime + 批量消歧/补全
│   ├── qcc-runs.js           # G5 Host 内存 run、幂等、候选续跑与人工重试
│   ├── qcc-safety.js         # G5 日志/E2E 脱敏与安全审计白名单
│   ├── qcc-phase3.js         # 0.5.0 风险/知产/经营 91 工具冻结契约
│   ├── qcc-phase3-batch.js   # 0.5.0 三域批量、调用预算与 Host 内存 run
│   ├── jobs.js               # 异步任务状态机 + storageDomain dc_tasks_v1
│   ├── workflow-contract.js   # v2 五步、字段目录、映射与状态契约
│   ├── workflow.js            # v2 taskId/revision Host 元数据工作流
│   ├── artifacts.js           # v2 结果/异常 CSV+XLSX Host 耐久制品与 checksum
│   ├── web.js                # Host 半区路由 + UI（/data-cleaning/ 前缀）
│   └── client.js             # Client 半区 seam（window.__ModuleLoader__.load）
├── test/                     # 引擎、市场、G5/Phase3 Bridge/Run/Web/UI/Safety/Runner 契约与验收
├── scripts/
│   ├── check-marketing.mjs   # marketing/metadata.json 结构校验
│   ├── check-readme-version.mjs  # README 版本标记同步校验
│   ├── check-market-registration.mjs # 上游 PR → YAML → 线上目录三段市场验收
│   ├── g5-e2e.mjs            # 默认关闭、仅回环 Host 的真实 E2E Runner
│   ├── phase3-e2e.mjs        # 0.5.0 默认关闭、失败关闭的三域 E2E Runner
│   └── verify-pack.mjs       # 打包内容白名单校验
├── marketing/metadata.json   # 市场/npm/GitHub/README 元数据（G3 市场收录用）
├── .github/workflows/
│   ├── ci.yml                # Node 22/24 + Windows + PR 预发布包
│   ├── release.yml           # v* tag → npm OIDC 发布 + GitHub Release
│   └── market-registration.yml # 每小时市场验收（metadata + 上游 PR/YAML + 线上目录）
├── install.sh                # 一键安装脚本（dsh CLI → pnpm 回退）
├── docs/                     # 见下
├── HANDOFF.md                # 本文档
├── verify-mvp.sh             # 双基线 web 冒烟脚本（仅本机隔离 home 使用）
└── mvp/ spike1~7/            # 本机验证产物（.gitignore 排除，不进仓库）
```

### docs/ 关键文档

| 文档 | 作用 |
| --- | --- |
| `PLAN-OSS.md` | 开源社区化 + QCC 接入总规划（G0–G6 门禁路线图） |
| `QCC-ENRICHMENT-DESIGN.md` | G4 方案 A 设计（v1 字段契约、消歧规则、安全不变量、验收门） |
| `QCC-PHASES-ROADMAP.md` | 二期/三期/四期路线图 + 185 工具完整维度→字段→来源工具清单 |
| `USER-GUIDE.md` | 用户手册（安装、数据清洗、企业名单补全边界） |
| `COMPATIBILITY.md` | 与 `qcc-dsh-mcp-oauth` 共存兼容表 |
| `FIRST-CONTRIBUTION.md` | 首次贡献路径 |
| `adr/0001-dsh-baseline.md` | DSH 基线 ADR |
| `adr/0002-programmatic-mcp-tool-execution.md` | S7 后方案 B 的公共 ToolRuntime 决策 |
| `mvp.md` | MVP 交付说明 + 6 条工程踩坑 |
| `spike-1~6-*.md` | 六个技术 Spike 结论 |
| `spike-7-programmatic-mcp-call.md` | 动态 MCP 工具程序化调用、取消和生命周期证词 |
| `G3-MARKET-REGISTRATION.md` | 市场上架材料、准入门槛和自动验收状态机 |
| `G5-HOST-BRIDGE.md` | G5-1 实现契约、安全边界与真实 E2E 验收门 |
| `G5-E2E-RUNBOOK.md` | G5 E2E 安全门、脱敏夹具、执行命令与验收矩阵 |
| `PHASE3-ACCEPTANCE.md` | 0.5.0 三域自动化、双基线、UI 与真实付费验收门 |
| `RELEASE-0.5.0.md` | 0.5.0 发布结果、升级、回滚和发布清单 |
| `RELEASE-0.5.1.md` | 0.5.1 文档补丁、严格发布门与回滚清单 |
| `UI-WORKFLOW-V2.md` | 新版五步业务、字段/状态契约、Host API、隐私边界与 T0～T9 证据 |
| `UI-WORKFLOW-V2-ACCEPTANCE.md` | T6～T9 双基线、视觉、匹配/补全、恢复与发布准备验收 |
| `UI-WORKFLOW-V2-MIGRATION.md` | 从 0.5.3 升级、数据保留、回滚与前滚策略 |

---

## 4. 已完成事项（G0–G4 + G5-2 本地安全闭环）

### G0 拍板 ✅
- 命名/scope/license/团队署名/仓库 URL 全部确定（见 §1 坐标表）。

### G1 开源化 ✅（v0.2.0）
- 包名 `@qcc/dsh-data-cleaning-agent` → `dsh-data-cleaning-agent`（无 scope）。
- README 中英双语 + 徽章矩阵、LICENSE（MIT）、CONTRIBUTING、FIRST-CONTRIBUTION、install.sh、
  marketing/metadata.json、`.github/workflows`（ci / release / market-registration）、CHANGELOG。

### G2 建仓发布 ✅（v0.2.1）
- GitHub 建仓 push、CI 绿、npm OIDC Trusted Publishing 跑通、GitHub Release 自动生成。

### G4 企查查接入 · 方案 A（模型中介式）✅（v0.3.0）
- 新增 `lib/skill-enrich.js` → Skill `enterprise-enrichment`。
- Skill 工作流：`qcc_oauth_status` 检测连接 → 逐个企业 `get_company_by_query` 消歧
  （唯一→锁定；多候选→**必须询问用户**；无→标记 unresolved）→
  `get_company_registration_info` 取工商字段 → `get_company_risk_scan` 取风险标签。
- v1 字段契约：`credit_no / legal_rep / reg_capital / establish_date / reg_status / biz_status / risk_tags`。
- `lib/index.js` 同时注册 `registerSkill`（data-cleaning）与 `registerEnrichSkill`（enterprise-enrichment）。

### G5-1 企查查 Host Bridge（方案 B 基础层）✅（v0.4.0）
- `lib/qcc.js` 只经公共 `ctx.tools.get/execute` 调用动态 QCC MCP 工具，不接触 token 或私有 client。
- 每调用重新解析工具；OAuth 重注册竞态只对 `UNKNOWN_TOOL` 安全重试一次；其余错误不自动重试，避免重复计费。
- 企业名去重批处理、唯一主体锁定、多候选 `reviewQueue`、未匹配/部分失败、取消/超时已落地。
- Web：`GET /data-cleaning/api/g5/capabilities` 与 `POST /data-cleaning/api/g5/enrich`；后者强制 `confirmPaidCalls:true`、100 行/并发 4 上限。
- Mock/Contract 全绿；真实 OAuth、授权跨重启恢复、真实 QCC 主调用路径、access token 自然到期刷新、
  动态工具恢复及续期后最小真实调用均已通过。

### G5-2.1～G5-2.5 E2E 安全准备 ✅（v0.4.0）
- `scripts/g5-e2e.mjs` 默认关闭，只允许回环 DSH Host；真实 enrich 需二次显式确认。
- 日志/E2E 报告脱敏覆盖凭据、Bearer/JWT、OAuth 参数、企业名、信用代码、邮箱和手机号。
- `idempotencyKey` 成为计费端点硬门；并发重复请求复用首个 Promise/结果，同键不同请求冲突。
- Host 内存 run 支持多候选合法性校验、确认后续跑、retryable 失败人工重试和 30 分钟过期。
- 401/403/429/配额/超时/工具刷新/5xx/契约错误细分；审计只记录工具名、callId、结果码和耗时。
- 自动测试全绿；真实 OAuth、授权跨重启恢复、真实 QCC 主调用路径、自然到期 refresh 已执行；
  401/429/配额耗尽故障注入已验证无自动重试、显式重试门和安全审计。

### MVP 核心能力（沿用自 0.1.0-mvp，0.2.0 起公开）
- 引擎：CSV/XLSX/JSON 解析、清洗（trim/手机号规范化/缺失剔除/负金额剔除/去重）、确定性补全、概览画像、CSV 回写。
- 三工具：`data_clean_rows` / `data_complete_rows` / `data_profile`（只回摘要，不回原始行）。
- Skill：`data-cleaning`。
- 异步任务：`queued → running → completed | failed | killed`，持久化 `dc_tasks_v1`。
- Web 半区：`/data-cleaning/` UI 与 `/data-cleaning/api/mvp/*`（seam/parse/clean/complete/profile/jobs/job/<id>）。
- 当前 T1～T9 `npm test` 共 165 例，覆盖引擎、市场、G5/Phase3 Bridge/Run/Safety/Runner/Web/UI、
  故障注入、字段映射、并发 taskId、v2 工作流、真实 XLSX/异常清单、Host 制品与历史恢复。

---

## 5. 剩余任务（按接手顺序）

### 当前 UI-V2 发布主线

T0～T9 已完成并随 `0.6.0` 发布。发布证据见 `docs/RELEASE-0.6.0.md`，双基线与视觉证据见
`docs/UI-WORKFLOW-V2-ACCEPTANCE.md`；升级和回滚见 `docs/UI-WORKFLOW-V2-MIGRATION.md`。

### P0 —— DSH 视觉市场收录（G3）✅

**当前状态**：上游 [PR #4095](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4095)
已合并；目录 YAML、在线 `plugins.json` 与视觉市场隔离安装冒烟均通过。不要重复提交 PR。

历史验收动作（均已完成）：

1. 查 PR 状态：`gh pr view 4095 --repo awesome-dsh-plugin/awesome-dsh-plugin`。
2. PR 未合并：只跟踪，不要做空提交、不要重复建 PR、不要改已通过 Gate 的 YAML。
3. PR 合并后：运行 `MARKET_PR_NUMBER=4095 npm run market:check`，直到返回 `accepted`。
4. 确认上游 `main` 有目标 YAML，且 `https://awesome-dsh-plugin.com/plugins.json` 可精确搜到包名。
5. 从视觉市场安装到全新隔离 Profile，验证 seam、粘贴 CSV → 清洗 → 预览 → CSV 导出。
6. 上述五门全过后，才将 G3 标记为完成并更新 `docs/G3-MARKET-REGISTRATION.md`。

### P1 —— 0.5.0（风险 / 知产 / 经营 + 批量后端）

**范围建议**：覆盖风险 38、知产 18、经营 35 个计划工具；详细维度见
`docs/QCC-PHASES-ROADMAP.md` §4。这些数量是当前路线图口径，**编码前必须用本地 QCC MCP 一手注册表
与真实 ToolRuntime capabilities 重新核对**，不得根据文档猜插件 API。

完成状态：

1. **P1.1 契约盘点**：✅ 91 工具 canonical/legacy/短名、输入依赖、权限与付费语义已冻结。
2. **P1.2 Skill 扩展**：✅ 三域按需调用、来源保真、多候选和降级规则已落地。
3. **P1.3 Host Bridge 扩展**：✅ 批量、调用预算、幂等、Host run、候选续跑和失败工具重试已落地。
4. **P1.4 Web/UI 与输出契约**：✅ 四步工作台、估算/确认、复核、恢复/重试和双 CSV 已落地。
5. **P1.5 验收**：✅ 125/125、双基线 24/24、rc.2 实际 UI；最小真实 Phase-3 E2E 2/2 调用通过。
6. **P1.6 发布**：✅ `v0.5.0`、npm OIDC provenance、GitHub Release 与公共 Registry 安装均已通过。

0.5.0 最低验收门：

- 工具契约来自一手注册表/运行时预检，不是记忆或文档推断。
- 金额、比例、计数、评级与风险结论均保留来源原值，不自行聚合或补造。
- 多候选零自动误选；未确认计费时零 QCC 调用；幂等重放不重复计费。
- `npm run check` 与 Linux Node 22/24 + Windows Node 24 CI 全绿。
- 隔离 DSH `0.1.1-rc.2` 为稳定发布基线；`0.1.2-alpha.2` 只做兼容探针。

### P2 —— 待用户决策的小版本与 MVP 技术债

1. **`0.4.1` 不再单独发布**：0.4.0 tarball 文案修正并入 0.5.0；不得覆盖 0.4.0。
2. **`0.5.1` 文档补丁**：README 修正、标签发布严格文案 Gate、OIDC 发布与公共安装均已完成。
3. **异步任务结果持久化**：v2 已以 Host 制品层完成结果/异常 CSV+XLSX 跨重启下载；旧 `dc_tasks_v1`
   任务仍保持原行为。
4. **XLSX 大文件压测**：耐久 XLSX 已发布，32 MiB / 100,000 行硬上限内的大文件性能仍待专项压测。
5. **LLM dispatch seam**：Web 组合内联 seam 尚未接入稳定模型端到端；不影响纯本地和 Host Bridge 主路径。
6. **Node engine 收敛**：`package.json` 是 `>=20`，DSH Desktop 是 `^22.19.0 || >=24.0.0`；变更前需做兼容影响评估。

### P3 —— 后续版本（版本号待定，仅规划）

覆盖历史 34 + 人员 44 + 招投标 6。历史域需企业认证账号，未授权必须显式降级。
启动前必须由用户确认是否纳入范围，不要在 0.5.0 内顺带扩张。

### 已完成，不再列为 TODO

| 项目 | 结论 |
| --- | --- |
| G5 / Spike #7 / 方案 B 基础层 | 已 GO、已实现、已真实 E2E，随 0.4.0 发布 |
| G5-2.1～G5-2.5 | 幂等、候选续跑、人工重试、脱敏审计、默认关闭 Runner 均完成 |
| 二期 0.4.0 | 工商全景 16 + 历史工商 4、20 企业/400 调用真实验收、发布全完成 |
| OAuth/token 发布门 | 首连、跨重启恢复、自然到期 refresh、续期后调用已过 |
| 401/429/配额故障门 | 已用 Web→Bridge→Mock ToolRuntime 注入验收，无需重做真实计费故障 |

---

## 6. 规划全景（分期 + 工具面）

### 6.1 企查查 MCP 工具面（6 大资源域 185 个 + 招投标 6 个）

| 资源域 | MCP 前缀 | 工具数 | 授权 | 数据主题 |
| --- | --- | --- | --- | --- |
| 工商 | `mcp__qcc-company__*` | 16 | 基础 | 主体、股权、人员、财务、上市 |
| 风险 | `mcp__qcc-risk__*` | 38 | 基础 | 司法、失信、执行、处罚、冻结 |
| 知产 | `mcp__qcc-ipr__*` | 18 | 基础 | 专利、商标、软著、数字资产 |
| 经营 | `mcp__qcc-operation__*` | 35 | 基础 | 资质、招投标、融资、舆情、监管 |
| 历史 | `mcp__qcc-history__*` | 34 | **企业认证账号** | 历史股东/法人/变更/风险 |
| 人员 | `mcp__qcc-executive__*` | 44 | 基础 | 董监高个人风险与关联 |
| 招投标（附加） | `mcp__qcc-tender__*` | 6 | 基础 | 标讯、拟建项目、企业标讯画像 |

### 6.2 分期总览（对应版本）

| 阶段 | 版本 | 交付形态 | 覆盖 | 状态 |
| --- | --- | --- | --- | --- |
| 一期 | 0.3.0 | 方案 A Skill `enterprise-enrichment` | 核心工商 7 字段 + 风险标签 | ✅ 已发布 |
| 二期 | 0.4.0 | 方案 A 扩展 Skill | 工商全景 16 + 历史工商 | ✅ 已发布 |
| 三期 | 0.5.0 | 方案 A 扩展 + 方案 B 批量后端 | 风险 38 + 知产 18 + 经营 35 | ✅ 已发布 |
| 四期 | 待定 | （仅规划） | 历史 34 + 人员 44 + 招投标 6 | ⏸️ 暂不开发 |

### 6.3 可清洗补全的 10 大通用维度族（跨期复用的"列"模型）
身份 / 主体 / 股权 / 人员 / 财务 / 合规风险 / 司法风险 / 知产 / 经营资质 / 市场活动
（逐项明细见 `QCC-PHASES-ROADMAP.md` §6）。

---

## 7. 安全不变量（任何一期都必须遵守）

1. **不编造字段**：QCC 工具没返回的字段，绝不臆测填充。
2. **消歧硬规则**：`get_company_by_query` 多候选时**禁止自动取第一名**，必须让用户确认。
3. **逐字引用**：金额/比例/计数/评级一律逐字引用工具返回值；禁止自行加总、相乘、推断或"四舍五入"圆场。
4. **模型不回原始行**：模型只拿统计摘要；原始明细只经同源 web 下载链路交付。
5. **凭据红线**：企业名单、QCC token 严禁进 Issue/PR/日志/截图/夹具；token 只走 `ctx.storageDomain`（0700），不落仓库。
6. **未连接降级**：未连企查查时补全流程显式引导 `qcc_oauth_connect`，不得假装补全。

### 工程契约（易踩坑，接手必读）
- 工具契约：`ctx.tools.register` 需 `output.render [{type:'text',text}]` + `output.schema`；对象级 `required`；工具名不能叫 `run_code`。
- Skill 契约：name `^[a-z0-9]+(?:-[a-z0-9]+)*$`、非空 description、truthy `get()`；用 `skills.register`。
- 共存契约：本插件 `data_*` 工具 + `data-cleaning`/`enterprise-enrichment` 两 Skill，与
  `qcc-dsh-mcp-oauth` 的 `qcc_oauth_*` + `mcp__qcc-*` 前缀、存储域 `dc_tasks_v1` 全独立，可共存。
- `npm run check` = lint + docs:check + marketing:check + verify-pack + test，**合入前必须全绿**。

---

## 8. 发布与验证流程（接手后复用）

### 日常检查
```bash
cd <repo>
npm run check                # 必须全绿
npm view dsh-data-cleaning-agent version --cache .npm-cache   # 查看远端版本
```

### 版本发布（v* tag 自动触发 release.yml）
```bash
# 1) 改 package.json version、README.md/README.en.md 版本标记、CHANGELOG 新条目
# 2) 本地检查
npm run check
# 3) 提交 + 打 tag + 推送
git add -A && git commit -m "feat: X.Y.Z — ..."
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
# 4) 等 release workflow 绿（自动 npm OIDC 发布 + GitHub Release）
gh run watch
gh release view vX.Y.Z
```

### 本机安装冒烟（隔离 profile，不碰生产 GUI）
```bash
# 2026-09-02 已从公共 Registry 对 0.4.0 做过全新 profile 冒烟：
export DSH_HOME="/private/tmp/dsh-data-cleaning-agent-v040/home"
dsh plugin --profile web add dsh-data-cleaning-agent@0.4.0
DSH_HOME="$DSH_HOME" dsh web --port 43160 --no-open &
# seam 报告应含：enrichSkillRegistered:true, skillRegistered:true, 3 工具, webMounted:true
curl -s -H 'sec-fetch-site: same-origin' http://127.0.0.1:43160/data-cleaning/api/mvp/seam
```
> 2026-09-02 实测：npm 包 0.4.0 在全新隔离 home 安装、启动和 seam 全 PASS；
> `enrichSkillRegistered:true` 确认企业补全 Skill 已注册，QCC 未安装时安全降级；生产 43120 未触碰。

### T0 / G3-2 / S7 本地验证（2026-09-01）

- T0：接手前 `npm run check` 全绿；`HANDOFF.md` 基线提交 `48641de` 已推送。
- G3-2：`npm run market:check` 在无 PR 号时返回 `not-submitted`（等待态，不误报失败）；7 个状态机单测通过。
- S7：rc.2（隔离端口 43138）和 alpha.2（隔离端口 43139）均通过 seam / execute / cancel / lifecycle；两个测试 host 已停止，生产 43120 未触碰。

### G5-1 Host Bridge 验证（2026-09-01）

- `lib/qcc.js` + `/data-cleaning/api/g5/*` 已实现，17 个 Mock/Contract 测试全绿。
- 测试覆盖未确认计费零调用、多候选不下钻、重复企业去重、部分失败、取消/超时和动态重注册。
- rc.2 隔离 Host（端口 43140）已通过插件加载、MVP seam 和 G5 未连接态路由冒烟：`qccBridgeMounted:true`；未确认返回 `409 QCC_CONFIRM_REQUIRED`，确认后因无 QCC 工具返回 `503 QCC_NOT_CONNECTED`。
- 冒烟进程已停止，生产端口 43120 未触碰；测试进程单独使用 `CHOKIDAR_USEPOLLING=1` 规避本机文件监听器 `EMFILE`。
- 此处为早期未连接态冒烟；后续真实 OAuth/QCC 结果见下方「0.4.0 真实 E2E」。

### G5-2.1～G5-2.5 本地验证（2026-09-01～2026-09-02）

- `npm test`：0.4.0 当时为 84/84 通过（0.5.0 发布基线为 125/125）。
- `npm run e2e:g5` 在无环境门时以退出码 2 和 `G5_E2E_DISABLED` 安全拒绝，没有网络调用。
- 针对性验证覆盖 Runner 回环限制/付费确认、凭据与企业标识脱敏、并发幂等复用、候选确认续跑、
  retryable 失败人工重试、Host 内存 run 过期和八类稳定错误映射。
- rc.2 隔离 Host（端口 43141）通过 27 文件 tarball 加载、capabilities 新契约、幂等键前置阻断、
  未连接降级和 Runner preflight；报告权限为 `0600`，测试 Host 已停止，生产 43120 未触碰。
- 本阶段当时没有执行真实 OAuth；后续真实主路径结果见下方。

### 0.4.0 本地实现验证（2026-09-01）

- QCC MCP 本地一手源码注册表已确认 16 个工商工具 + 4 个历史工商工具的精确名称。
- `npm run check` 通过：84/84 测试、lint、文档版本、marketing 和 31 文件打包白名单均通过。
- `npm run e2e:phase2` 默认以退出码 2 / `PHASE2_ACCEPTANCE_DISABLED` 安全拒绝；
  验收器覆盖 20×15 维、工具来源、原值对照、主体消歧、历史权限和合成证据拒绝。
- 当前工作树 tarball 已分别在 DSH `0.1.1-rc.2`（43153）和 `0.1.2-alpha.2`（43154）
  隔离 Host 加载，两者 seam 均返回 `enrichSkillRegistered:true`；两个测试 Host 已停止，生产 43120 未触碰。
- 新 `/data-cleaning/api/phase2/capabilities` 已在 rc.2（43155）/ alpha.2（43156）验证：
  无 OAuth 插件时两者均稳定返回 `companyRegistered:0` / `historyRegistered:0` /
  `oauth-plugin-missing` / `paidCalls:false`。
- rc.2 追加安装 `qcc-dsh-mcp-oauth@0.1.7` 但不授权的隔离冒烟（43157）：
  状态正确切换为 `not-connected-or-refreshing`，仍为 0/16 + 0/4 工具、`executesTools:false`。
  上述三个测试 Host 均已停止。
- 上述为授权前冒烟；后续发布门已按下节完成。

### 0.4.0 真实 OAuth / QCC E2E（2026-09-01）

- 环境：隔离 DSH `0.1.1-rc.2`（端口 43158），生产 `43120` 未触碰。
- OAuth PKCE 成功；6 个 QCC Server 均连接，授权跨多次 Host 重启恢复成功。
- fresh Profile 需显式安装 `@deepseek-ai/dsh-mcp-client@0.1.1-rc.2`；这是 OAuth 动态条目在 rc.2
  进入 Profile 工具面的实测安装前提。
- 发现 `qcc-dsh-mcp-oauth@0.1.7` 实际注册 `mcp__company__*` / `mcp__history__*`，与文档
  `mcp__qcc-company__*` / `mcp__qcc-history__*` 不一致；Bridge 已加入双命名兼容与回归测试。
- 用户确认后以 20 家公开知名企业顺序执行 400 次真实调用；20/20 主体解析、当前工商最低 15 维、
  历史工商 4 维，`e2e:phase2` 严格历史门 PASS。
- `verifyIdentity` 因输入仅含企业名而统一不交付，符合 Skill「有信用代码或用户明确要求时才调用」的规则。
- `.phase2-e2e/evidence.json` 与报告均为 `0600`、Git 忽略且不打 npm 包；未提交企业名单、Token 或原始响应。

### 0.4.0 token 自然到期刷新 / 故障注入（2026-09-02）

- 环境：同一隔离 DSH `0.1.1-rc.2` Profile（端口 43159），生产 `43120` 未触碰。
- 启动前持久 grant 的 access token 已自然过期；Host 启动后 grant 更新时间与到期时间前移，
  company 16 + history 4 动态工具全部恢复 ready。
- 使用批准名单中的 1 行执行真实 `e2e:g5`：1/1 补全、0 失败、2 条安全审计；输入与报告为
  Git 忽略的 `0600` 文件，隔离 Host 随后已停止。
- Web→Bridge→Mock ToolRuntime 注入 401、429 与 `QUOTA_EXHAUSTED`：每类首次失败只派发一次工商调用；
  401/429 仅在显式 `/retry` 后恢复，配额错误以 `QCC_RETRY_NOT_ALLOWED` 在派发前阻断；审计无参数、
  原始响应、token、企业名或信用代码。

---

## 9. 给接手的「第一优先」建议

1. 在干净 `main` 上重跑 `npm run check`；期望版本 0.6.0、165/165。
2. 如需人工复验，从视觉市场安装到全新隔离 DSH Profile；不得触碰生产 43120。
3. 不重跑真实 QCC；T6～T9 已用合成数据完成 rc.2/alpha.2、跨重启与视觉验收。
4. 历史/人员/招投标仅保留后续规划，仍需另行确认范围，不随补丁版本扩张。

---

*本文档与代码同步生成；若代码库有更新，以仓库内 `docs/PLAN-OSS.md`、`docs/QCC-PHASES-ROADMAP.md`、`CHANGELOG.md` 为准。*

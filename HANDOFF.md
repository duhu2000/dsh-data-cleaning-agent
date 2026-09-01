# 数据清洗补全智能体 · 项目移交文档（Handoff）

> 目的：让接手的 GPT / 协作者无需回溯全部对话，即可掌握项目全貌、当前基线、已完成事项、待办与后续规划，并直接续做剩余开发任务。
> 生成日期：2026-09-01
> 当前源码版本：**0.4.0**（发布候选；npm `latest` 与 GitHub Latest 仍为 `0.3.0`）

---

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
| npm `latest` | `0.3.0`（带 OIDC provenance） |
| GitHub Release | `v0.3.0`（Latest，2026-09-01T03:38:43Z）；另有 `v0.2.1` |
| Git tags | `v0.2.1`、`v0.3.0` |
| 工作树状态 | 0.4.0 发布候选已收口：二期与 OAuth 0.1.7 兼容修复已实现，真实 OAuth + 20 企业/400 调用严格验收通过；G3 上游 PR #4095 等待年龄门与合并 |
| git 身份 | `DuHu <duhu@greatld.com>` |
| gh 账号 | `duhu2000` |
| npm 维护者 | `duhu2000 <dlaohu2008@gmail.com>` |
| license | MIT |
| 本机 DSH 框架 | `0.1.1-rc.2`（`@deepseek-ai/*` 包线；launcher 为 `dsh-plugin-desktop@2.0.2`） |
| 生产 GUI | `http://127.0.0.1:43120`（profile：`~/.dsh/profiles/web`）——**冒烟测试严禁触碰** |

> npm 缓存坑：本机 `/Users/qcc/.npm/_cacache` 曾被 root 占用导致 `npm view` EPERM，
> 解决办法是 `npm ... --cache .npm-cache`（项目本地缓存目录）。

---

## 2. 版本时间线

| 版本 | 日期 | 内容 | 状态 |
| --- | --- | --- | --- |
| 0.1.0-mvp | 2026-08-31 | 内部 MVP，双基线（rc.2 + alpha.2）端到端验证通过；`@qcc` scope，**未对外发布** | ✅ 完成（仅本机） |
| 0.2.0 | 2026-09-01 | 开源化 G1：改名 `dsh-data-cleaning-agent`，补齐 README/LICENSE/CONTRIBUTING/install.sh/marketing/CI 骨架 | ✅ 已发布 |
| 0.2.1 | 2026-09-01 | G2 补充：npm OIDC Trusted Publishing 发布链路验证（无功能变更） | ✅ 已发布 |
| 0.3.0 | 2026-09-01 | G4 方案 A：内嵌 `enterprise-enrichment` Skill，模型中介式调企查查 MCP 补全企业名单 | ✅ 已发布（npm latest） |
| 0.4.0 | 2026-09-01 | 二期工商全景 16+4 工具契约、G5 Host Bridge、安全验收与 OAuth 0.1.7 双命名兼容 | 🟡 发布候选；tag/npm 暂缓 |

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
│   ├── jobs.js               # 异步任务状态机 + storageDomain dc_tasks_v1
│   ├── web.js                # Host 半区路由 + UI（/data-cleaning/ 前缀）
│   └── client.js             # Client 半区 seam（window.__ModuleLoader__.load）
├── test/                     # 引擎、市场、G5 Bridge/Run/Web/Safety/Runner、0.4.0 契约与验收
├── scripts/
│   ├── check-marketing.mjs   # marketing/metadata.json 结构校验
│   ├── check-readme-version.mjs  # README 版本标记同步校验
│   ├── check-market-registration.mjs # 上游 PR → YAML → 线上目录三段市场验收
│   ├── g5-e2e.mjs            # 默认关闭、仅回环 Host 的真实 E2E Runner
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

### G5-1 企查查 Host Bridge（方案 B 基础层）✅（0.4.0 发布候选）
- `lib/qcc.js` 只经公共 `ctx.tools.get/execute` 调用动态 QCC MCP 工具，不接触 token 或私有 client。
- 每调用重新解析工具；OAuth 重注册竞态只对 `UNKNOWN_TOOL` 安全重试一次；其余错误不自动重试，避免重复计费。
- 企业名去重批处理、唯一主体锁定、多候选 `reviewQueue`、未匹配/部分失败、取消/超时已落地。
- Web：`GET /data-cleaning/api/g5/capabilities` 与 `POST /data-cleaning/api/g5/enrich`；后者强制 `confirmPaidCalls:true`、100 行/并发 4 上限。
- Mock/Contract 全绿；真实 OAuth、授权跨重启恢复与真实 QCC 主调用路径已通过，
  access token 到期刷新和计费故障注入仍是 G5 E2E Gate。

### G5-2.1～G5-2.5 E2E 安全准备 ✅（0.4.0 发布候选）
- `scripts/g5-e2e.mjs` 默认关闭，只允许回环 DSH Host；真实 enrich 需二次显式确认。
- 日志/E2E 报告脱敏覆盖凭据、Bearer/JWT、OAuth 参数、企业名、信用代码、邮箱和手机号。
- `idempotencyKey` 成为计费端点硬门；并发重复请求复用首个 Promise/结果，同键不同请求冲突。
- Host 内存 run 支持多候选合法性校验、确认后续跑、retryable 失败人工重试和 30 分钟过期。
- 401/403/429/配额/超时/工具刷新/5xx/契约错误细分；审计只记录工具名、callId、结果码和耗时。
- 自动测试全绿；真实 OAuth、授权跨重启恢复和真实 QCC 主调用路径已执行。

### MVP 核心能力（沿用自 0.1.0-mvp，0.2.0 起公开）
- 引擎：CSV/XLSX/JSON 解析、清洗（trim/手机号规范化/缺失剔除/负金额剔除/去重）、确定性补全、概览画像、CSV 回写。
- 三工具：`data_clean_rows` / `data_complete_rows` / `data_profile`（只回摘要，不回原始行）。
- Skill：`data-cleaning`。
- 异步任务：`queued → running → completed | failed | killed`，持久化 `dc_tasks_v1`。
- Web 半区：`/data-cleaning/` UI 与 `/data-cleaning/api/mvp/*`（seam/parse/clean/complete/profile/jobs/job/<id>）。
- 当前 `npm test` 共 81 例，覆盖引擎、市场、G5 Bridge/Run/Safety/Runner/Web 与 0.4.0 契约/验收。

---

## 5. 待办（TODO，按优先级）

### P0 —— 让插件出现在「视觉插件市场」（G3，进行中：G3-3 已提交）
- **现状**：dshmarket（视觉市场）只安装 curated registry 条目，来源
  `https://awesome-dsh-plugin.com/plugins.json`（当前 2777 条）；**本插件尚未被收录**（hitCount=0）。
- **已完成并推送**：提交 YAML 材料已固化；新增 `market:check`、上游 PR→YAML→线上目录三段检查、每小时 workflow 和 7 例状态机测试，详见 `docs/G3-MARKET-REGISTRATION.md`。
- **上游 PR**：[`awesome-dsh-plugin#4095`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4095) 已创建，只新增一个注册 YAML；上游 `check` 已通过。
- **年龄门**：远端已有 10 个有效 commit 且 `dsh-plugin` topic 已配置；`Submission gate` 首轮仅因仓库为 0.4 天失败。2026-09-02 01:47 UTC 满 1 天后重跑。
- **自动追踪**：仓库变量 `DSH_MARKET_PR_NUMBER=4095` 已配置，持续跟踪合并、YAML 与线上目录同步。
- **验收**：市场可搜索 + 一键安装成功。

### P0 —— 方案 B 批量后端（真实主路径已验收；刷新/故障门待做）
- **Spike #7 结论**：rc.2 与 alpha.2 隔离 host 均通过动态 entry 创建、`ctx.tools.execute()` 调用、AbortSignal 取消、禁用/恢复四项验证。方案 B **GO**，但只能使用公共 ToolRuntime，禁止依赖 mcp-client 私有 client。详见 `docs/spike-7-programmatic-mcp-call.md` 与 ADR-0002。
- **已完成**：Host Bridge、字段映射、批量消歧、幂等、候选续跑、人工重试、脱敏审计、
  默认关闭 E2E Runner；加上 0.4.0 契约/验收、legacy 命名兼容和审计回归测试后全量为 81 项，详见 `docs/G5-HOST-BRIDGE.md` 和 `docs/G5-E2E-RUNBOOK.md`。
- **共享**：§5 字段契约、§6 消歧策略、未连接引导路径（与方案 A 一致，不重定义）。
- **真实主路径已验收**：隔离 rc.2 Host 完成 OAuth、授权跨重启恢复、16+4 工具预检与
  20 企业/400 次真实 QCC 调用；Bridge 已兼容 OAuth 0.1.7 的 legacy serverName。
- **待验收**：access token 到期刷新、401/429/配额故障注入。S7/G5-1 Mock 不能替代这些故障门。

### P1 —— 二期 0.4.0（工商全景 + 股权穿透，Skill 扩展）
- 覆盖 `mcp__qcc-company__*` 16 工具 + 历史工商：实控人、受益所有人、股东、对外投资、分支机构、
  主要人员、变更记录、年报、联系方式、开票、上市、财务等（详见 `QCC-PHASES-ROADMAP.md` §3）。
- **发布候选已完成**：工具名已与本地 QCC MCP 注册表逐项核对；新增 `lib/qcc-phase2.js`
  契约和 `test/skill-enrich.test.mjs`，Skill 已支持按工商全景/股权穿透/组织沿革/历史工商组选择。
- **本地开发已完成**：新增验收评估器、默认关闭 Runner 和脱敏报告；
  只读 capabilities 端点可在付费调用前检查 16+4 工具面；
  rc.2 / alpha.2 隔离 Host 均已通过新 Skill 注册冒烟；rc.2 真实账号 20 企业发布门已通过。
- 验收门：20 条名单每企业 ≥15 个维度；消歧规则不变；金额/比例/计数逐字引用。

### P1 —— 三期 0.5.0（风险/知产/经营 + 方案 B 批量后端）
- 覆盖风险 38 + 知产 18 + 经营 35 工具（详见 `QCC-PHASES-ROADMAP.md` §4）。

### P2 —— 四期 0.6.0（可选，历史轨迹 + 董监高 + 招投标）
- 覆盖历史 34 + 人员 44 + 招投标 6；历史域需**企业认证账号**（未授权须显式降级）。

### P2 —— MVP 遗留未决项（`docs/mvp.md` §5）
1. **异步任务明细结果不落盘**：`result.rows` 当前只经内存闭包消费；"任务完成后下载明细"需把结果写入
   storage 表或临时文件。
2. **XLSX 大文件异步化**：CSV 路径已完整实测；XLSX 大文件留产品阶段。
3. **web 组合内联模型 dispatch seam 未接活 LLM**：真实模型端到端仅在 headless 组合验证过。

### P3 —— 工程口径收敛
1. **Node engine 不一致**：`package.json` 写 `>=20`，但 DSH Desktop `engines` 为 `^22.19.0 || >=24.0.0`；
   建议收敛为 22/24（CI 已是 22/24，见 `PLAN-REVIEW.md` §4）。
2. **双基线兼容口径**：公开 README 不得把 alpha.2 的 `@Remote` 当稳定 API。

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
| 二期 | 0.4.0 | 方案 A 扩展 Skill | 工商全景 16 + 历史工商 | 🟢 本地开发与真实主路径 E2E 完成，刷新/故障门待验 |
| 三期 | 0.5.0 | 方案 A 扩展 + 方案 B 批量后端 | 风险 38 + 知产 18 + 经营 35 | ⬜ 待做 |
| 四期 | 0.6.0 | （可选） | 历史 34 + 人员 44 + 招投标 6 | ⬜ 待做 |

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
# 已用 mvp/home-market 做过一次：dsh plugin add dsh-data-cleaning-agent@0.3.0
export DSH_HOME="$PWD/mvp/home-market"
dsh plugin --profile web add dsh-data-cleaning-agent@0.3.0
# 清理旧 @qcc 残留、bundle 名改为 dsh-data-cleaning-agent 后：
DSH_HOME="$DSH_HOME" dsh web --port 43136 --no-open &
# seam 报告应含：enrichSkillRegistered:true, skillRegistered:true, 3 工具, webMounted:true
curl -s -H 'sec-fetch-site: same-origin' http://127.0.0.1:43136/data-cleaning/api/mvp/seam
```
> 2026-09-01 实测：npm 包 0.3.0 在隔离 home 安装、启动、seam、parse/clean/complete/profile/jobs 全 PASS，
> `enrichSkillRegistered:true` 确认企业补全 Skill 已在真实 host 注册。

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

### G5-2.1～G5-2.5 本地验证（2026-09-01）

- `npm test`：当前 81/81 通过（含 0.4.0 工具契约 / Skill / capabilities / 验收 Runner、legacy 命名兼容与审计回归）。
- `npm run e2e:g5` 在无环境门时以退出码 2 和 `G5_E2E_DISABLED` 安全拒绝，没有网络调用。
- 针对性验证覆盖 Runner 回环限制/付费确认、凭据与企业标识脱敏、并发幂等复用、候选确认续跑、
  retryable 失败人工重试、Host 内存 run 过期和八类稳定错误映射。
- rc.2 隔离 Host（端口 43141）通过 27 文件 tarball 加载、capabilities 新契约、幂等键前置阻断、
  未连接降级和 Runner preflight；报告权限为 `0600`，测试 Host 已停止，生产 43120 未触碰。
- 本阶段当时没有执行真实 OAuth；后续真实主路径结果见下方。

### 0.4.0 本地实现验证（2026-09-01）

- QCC MCP 本地一手源码注册表已确认 16 个工商工具 + 4 个历史工商工具的精确名称。
- `npm run check` 通过：81/81 测试、lint、文档版本、marketing 和 31 文件打包白名单均通过。
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
- 仍未完成：等待 access token 自然到期后的真实刷新轮换，以及 401/429/配额故障注入。

---

## 9. 给接手的「第一优先」建议

1. **G3 完成年龄门与合并闭环**：PR #4095 已提交，2026-09-02 01:47 UTC 后重跑 `Submission gate`；合并后等待 YAML 与 `plugins.json` 同步，再做视觉市场一键安装冒烟。
2. **补齐 G5 剩余故障门**：真实 OAuth/QCC 主路径已通过；下一步只做 token 到期刷新、
   401/429/配额故障注入，避免重放已完成的 400 次调用。
3. **完成 0.4.0 发布门**：发布候选的代码审查、版本和说明已收口；按
   `docs/RELEASE-0.4.0.md` 补齐 token 到期刷新与故障注入，远端 CI 全绿后再创建 tag。
4. 之后按 0.5.0 → 0.6.0 扩展；每期合入前跑 `npm run check`，发布走 §8 的 tag 流程。

---

*本文档与代码同步生成；若代码库有更新，以仓库内 `docs/PLAN-OSS.md`、`docs/QCC-PHASES-ROADMAP.md`、`CHANGELOG.md` 为准。*

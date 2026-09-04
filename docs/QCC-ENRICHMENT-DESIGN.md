# QCC 能力设计：企业名单补全（G4 · 方案 A 模型中介式）

> 状态：设计稿（待评审通过后实施）
> 日期：2026-09-01
> 关联：`docs/PLAN-OSS.md` §8（Phase 2 接入规划）
> 决策：先做 **方案 A（模型中介式，快、可发布）**；同阶段开 **Spike #7** 验证方案 B 的程序化调用面。
> 范围：本文档只设计 G4（方案 A）。方案 B（`lib/qcc.js` 后台批量）见 Spike #7 另行设计。

---

## 1. 目标与非目标

### 1.1 目标

让"数据清洗补全智能体"在**已连接企查查 MCP** 的前提下，把一批**企业名单**
（只有企业名，或企业名 + 少量残缺字段）补全为带最新工商信息的结构化名单：

```
输入：企业名（必填，支持模糊名/简称）
输出：credit_no / legal_rep / reg_capital / establish_date /
      reg_status / biz_status / risk_tags
```

### 1.2 非目标（本次不做）

- **不重造 OAuth**：完全复用 `qcc-dsh-mcp-oauth` 已上架的授权与工具面
  （`qcc_oauth_connect` / `mcp__qcc-company__*` / `mcp__qcc-risk__*`）。
- **不做后台程序化批量**（方案 B）：模型中介式就是让模型亲自调 QCC 工具，
  本插件不新增 `lib/qcc.js`、不直接调用 mcp-client 服务。
- **不改现有清洗/补全/概览引擎**：`data_clean_rows` / `data_complete_rows` /
  `data_profile` 的确定性语义保持原样；企业补全作为**新 Skill + 新流程**叠加，不污染旧路径。

---

## 2. 复用机制与工具契约

### 2.1 依赖的已上架插件

| 插件 | npm 包 | 提供的工具面 | 与本插件关系 |
| --- | --- | --- | --- |
| 企查查 MCP OAuth | `qcc-dsh-mcp-oauth` | `qcc_oauth_connect/status/disconnect` + `mcp__qcc-company__*` + `mcp__qcc-risk__*` | **前置依赖**：用户先连企查查，本插件才有数据源 |

共存约束（已写入 `docs/COMPATIBILITY.md`）：

| | qcc-dsh-mcp-oauth | 本插件（数据清洗） |
| --- | --- | --- |
| 工具名前缀 | `qcc_oauth_*` + `mcp__qcc-*` | `data_clean_rows` / `data_complete_rows` / `data_profile` |
| 存储域 | 自有 grant store | `dc_tasks_v1` |
| 能否共存 | ✅ 工具名/存储域/条目 id 全独立 | ✅ |

### 2.2 方案 A 用到的 QCC 工具（真实工具名）

| 步骤 | 工具 | 用途 |
| --- | --- | --- |
| 1. 消歧 | `mcp__qcc-company__get_company_by_query` | 企业名 → 唯一精确匹配（自动锁定，带统一社会信用代码）或多候选（最多 5 个） |
| 2. 工商详情 | `mcp__qcc-company__get_company_registration_info` | 用锁定实体（名称或统一社会信用代码）取法定代表人/注册资本/成立日期/登记状态等 |
| 3. 风险标签 | `mcp__qcc-risk__get_company_risk_scan` | 用锁定实体取 35 项风险因子计数（失信/被执行/裁判文书/行政处罚/股权冻结…） |

> 字段名以 QCC MCP 工具**实际返回**为准，实施时逐字段核对；本文档用概念名
> （`creditNo`/`legalRep`/`regCapital`/`establishDate`/`regStatus`/`bizStatus`）
> 表达契约，落地时映射到工具真实字段。

---

## 3. 数据路径

```
用户：帮我补全这份企业名单（CSV/JSON/文本，或直接给企业名列表）
  │
  ├─ 模型解析名单（可复用现有 data_profile 概览 + 本地解析）
  │
  ├─ 模型确认「已连接企查查」：
  │     调 qcc_oauth_status；或发现 mcp__qcc-company__* 工具存在
  │
  ├─ 对每个企业名：
  │     mcp__qcc-company__get_company_by_query(name)
  │        └─ 唯一精确匹配 → 锁定实体（creditNo）
  │        └─ 多候选 → 暂停，交用户确认（禁止自动取第一名，见 §6）
  │     mcp__qcc-company__get_company_registration_info(锁定实体)
  │     mcp__qcc-risk__get_company_risk_scan(锁定实体)   [可选，取风险标签]
  │
  ├─ 模型把 QCC 返回字段按 §5 契约组装为结构化行
  │
  └─ 产出：补全后的名单（对话摘要 + 可下载 CSV）
       明细经同源 web 下载链路交付，不把完整明细直接吐回对话（沿用现有安全边界）
```

关键点：**QCC 调用是模型亲自完成的**（模型 → MCP 工具 → 模型），本插件只提供
（1）名单解析与（2）结果写回/下载，（3）Skill 工作流指引。这正好落在
"数据由模型组装"的既有边界内，零后端改造。

---

## 4. Skill 设计

### 4.1 方案：新增 `enterprise-enrichment` Skill（不改 `data-cleaning`）

- 现有 `data-cleaning` Skill 语义是"确定性清洗/补全/概览"，不应混入"外部工商数据补全"
  （职责不同、失败模式不同、依赖不同）。
- 新增 Skill `enterprise-enrichment`，触发语：用户说"补全企业名单""补齐工商信息"
  "用企查查补全""查一下这些公司的统一社会信用代码/法人/注册资本"等。

### 4.2 Skill 内容草案

```text
name: enterprise-enrichment
description: Enrich a list of company names with the latest Qichacha (QCC)
  business-registration fields via the QCC MCP tools.
whenToUse: When the user gives a list of company names (possibly incomplete or
  fuzzy) and asks to fill in credit code / legal representative / registered
  capital / establishment date / registration & business status / risk tags,
  or to "enrich / complete with Qichacha".
source: dsh-data-cleaning-agent
content:
  - Workflow:
    1. Detect QCC availability: run `qcc_oauth_status`. If not connected,
       tell the user to run `qcc_oauth_connect` first, and stop.
    2. Parse the company-name list (from pasted text / CSV / JSON). Keep only
       the distinct company-name column.
    3. For EACH name: `mcp__qcc-company__get_company_by_query`.
       - unique exact match → lock the entity (use its credit code).
       - multiple candidates → DO NOT auto-pick the first; show the candidates
         (name + region + credit code) and ask the user which one.
       - no match → mark that row as `unresolved` and continue.
    4. For each locked entity: `mcp__qcc-company__get_company_registration_info`
       (fill credit_no / legal_rep / reg_capital / establish_date / reg_status /
       biz_status) and, when risk tags are wanted,
       `mcp__qcc-risk__get_company_risk_scan` (fill risk_tags).
    5. Assemble the enriched table. NEVER invent a field — if QCC returns no
       value, leave it empty and mark the row/field as unresolved.
    6. Report only a summary (enriched N / unresolved M / multi-candidate K)
       plus the enriched CSV via the download link. Never dump full detail rows
       into the chat.
  - Safety rules:
    - Never fabricate a credit code, legal rep, capital, or status.
    - Never auto-select among ambiguous candidates.
    - Never expose QCC tokens or credentials.
```

> 具体措辞在实施时打磨，并与 QCC OAuth 插件的 `qcc_oauth_connect` 引导语对齐。

### 4.3 是否新增模型工具

方案 A 可做到**零新工具**（模型直接调 QCC 工具 + 复用现有 web 解析/下载）。
可选加一个轻量工具 `data_rows_to_csv`（把模型组装的补全行数组 → CSV 下载链接），
避免模型手拼 CSV。**实施时评估**：若模型拼 CSV 易错，再加；否则不加，保持零后端改动。

---

## 5. v1 字段契约与映射表

| 输出字段 | 中文 | 来源工具 | 备注 |
| --- | --- | --- | --- |
| `credit_no` | 统一社会信用代码 | `get_company_by_query` 锁定实体时带回 / `get_company_registration_info` | 消歧成功即有 |
| `legal_rep` | 法定代表人 | `get_company_registration_info` | 缺失留空 + 标记 |
| `reg_capital` | 注册资本 | `get_company_registration_info` | 原样引用，不四舍五入 |
| `establish_date` | 成立日期 | `get_company_registration_info` | 原样引用 |
| `reg_status` | 登记状态 | `get_company_registration_info` | 原样引用（存续/在业/吊销/注销…） |
| `biz_status` | 经营状态 | `get_company_registration_info`（若含）/ `get_company_profile` 兜底 | 实施时核对字段落点 |
| `risk_tags` | 风险标签 | `get_company_risk_scan`（35 项计数中命中项） | 仅陈述"命中维度+计数"，不下定性结论 |

> 对齐 QCC 工具的数据纪律：金额/比例/计数一律**逐字引用工具返回值**，
> 禁止模型自行相加、相乘或估算；聚合/穿透值以工具返回为准。

---

## 6. 消歧与安全策略

1. **多候选必须交用户确认**：`get_company_by_query` 返回 >1 候选时，模型列出候选
   （企业名 + 地区 + 统一社会信用代码），等待用户选定，**禁止自动取排名第一**。
   - 这是 QCC 工具契约的硬性要求（错误选择会对错误主体做补全）。
2. **模糊名先行提示**：对明显残缺/简称的名称，先提示用户补充地区等线索，
   减少多候选与错配。
3. **不编造**：QCC 未返回值 → 留空 + `unresolved`，绝不占位编造。
4. **凭据安全**：整个流程不接触、不回显 QCC token；token 只存在于 qcc-mcp-oauth
   自己的 grant store，本插件不读它。
5. **数据边界**：完整明细经同源 web 下载交付（沿用 `isTrusted` + `no-store` 响应头），
   对话内只给摘要 + 下载链接。

---

## 7. 未连接企查查时的引导路径

- Skill 第一步 `qcc_oauth_status`：
  - **未连接** → 模型告知用户先运行 `qcc_oauth_connect`（QCC OAuth 插件提供），并停止补全。
  - **已连接但 token 过期** → 引导 `qcc_oauth_connect`（OAuth 插件会复用授权自动刷新，不重复弹授权页）。
  - **已连接** → 继续。
- 兜底：若模型在未连接时直接调 `mcp__qcc-company__*`，QCC MCP 工具会返回
  未授权错误（401 语义），Skill 的失败处理同样引导到 `qcc_oauth_connect`。

---

## 8. 验收 Gate（G4 达成标准）

1. **双基线 headless 真实模型**：给一段企业名单（含 1 个精确名 + 1 个模糊名 + 1 个多候选名），
   在已连接企查查的环境下，模型按 Skill 完成：
   - 精确名 → 工商字段回填正确；
   - 多候选名 → 模型停下询问而非乱选；
   - 未命中名 → `unresolved` 标记。
2. **未连接环境**：模型第一步即引导 `qcc_oauth_connect` 并停止，不假装补全。
3. **安全回归**：`npm run check` 全绿；现有 13 例引擎测试不受影响；
   补全明细只经下载链路交付，对话内无完整明细泄露。
4. **文档同步**：`docs/USER-GUIDE.md` 增补"企业名单补全"一节；
   `docs/COMPATIBILITY.md` 的共存表若缺 `enterprise-enrichment` 技能则补上。

---

## 9. 与方案 B 的边界与预留

- 方案 A 不改 `lib/`（最多可选加 `data_rows_to_csv` 工具）。
- 方案 B 已新增 `lib/qcc.js` 与 `lib/qcc-command.js`：工作台通过同源 Web 路由把名单暂存在
  Host，只向原生会话发送 commandId；`data_cleaning_qcc_run` 持有 Agent 父执行 token/Session 后，
  才可通过公共 `ctx.tools.execute()` 以 nested execution 调度动态 MCP 工具。G5-2 幂等、候选续跑、
  人工重试与安全 Runner 的 Mock/Contract 已通过。
  禁止访问 mcp-client 私有 client；真实 OAuth/QCC 主路径已验收，token 到期刷新与
  2026-09-02 已完成自然过期 token refresh 与 401/429/配额故障注入验收；
  故障注入使用本地 ToolRuntime，不重复真实付费批次。
- 两者**共享**：§5 字段契约、§6 消歧策略、§7 未连接引导。方案 B 落地时直接复用，
  不重定义契约。

---

## 10. 实施变更清单（评审通过后执行）

| # | 变更 | 文件 | 可逆 |
| --- | --- | --- | --- |
| 1 | 新增 `enterprise-enrichment` Skill | `lib/skill.js`（或新 `lib/skill-enrich.js`） | ✅ 本地 |
| 2 | （可选）新增 `data_rows_to_csv` 工具 | `lib/tools.js` | ✅ 本地 |
| 3 | `docs/USER-GUIDE.md` 增补企业名单补全一节 | `docs/USER-GUIDE.md` | ✅ 本地 |
| 4 | `docs/COMPATIBILITY.md` 补共存说明 | `docs/COMPATIBILITY.md` | ✅ 本地 |
| 5 | `npm run check` + 双基线 headless 真实模型验收 | — | ✅ 本地 |
| 6 | 版本号 bump + CHANGELOG + README 版本同步 | 多文件 | ✅ 本地 |
| 7 | tag → OIDC 自动发布（已跑通链路） | — | ⚠️ 外发，需授权 |

---

## 11. 风险

1. **名单大时 token 消耗大、逐条慢**：方案 A 是逐企业调用 QCC 工具，百级名单成本高；
   → Skill 里写明批处理节奏（一次一批，批间汇报进度）；百级以上建议走方案 B。
2. **多候选误配**：靠 §6 的"必须确认"策略兜底，但模型可能未遵守；
   → Skill 强调 + 验收用例覆盖。
3. **QCC 工具字段名漂移**：本文档用概念名，落地时以工具真实返回为准并冻结到实现里。

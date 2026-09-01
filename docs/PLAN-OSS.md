# PLAN-OSS — 数据清洗补全插件：开源社区化 + 企查查 MCP 接入规划

> 状态：规划稿（待用户授权后逐项落地；未执行任何外发/不可逆动作）
> 日期：2026-09-01
> 当前基线：`@qcc/dsh-data-cleaning-agent@0.1.0-mvp`（MVP 已双基线验证，见 `docs/mvp.md`）
> 对标仓库：`duhu2000/dsh-mcp-connector`、`duhu2000/qcc-mcp-oauth`、`duhu2000/qcc-mcp-legal-oauth`

---

## 0. 目标与一句话定位

把"数据清洗补全智能体"从**单机 MVP** 升级为 **开源社区插件**（可 fork / 可 PR / 可下载安装），
后期按 `dsh-mcp-connector` 的运营模式持续维护，并在**后台接入企查查 MCP**，
用企查查最新企业数据来清洗、补全客户的企业名单。

一句话定位（对标 connector 的 README 首句）：

> 在 DeepSeek Harness 中清洗、补全、画像企业名单数据的智能体插件，支持本地 CSV/XLSX/JSON 引擎
> 与企查查 MCP 企业数据后台补全，由企查查（Qichacha/QCC）团队发起并维护。

---

## 1. 对标参照：`dsh-mcp-connector` 的运营要素清单

逐项对照，作为本插件开源化的"验收清单"：

| 运营要素 | connector 现状 | 数据清洗插件需补齐 |
| --- | --- | --- |
| README 中英双语 + 徽章矩阵（CI/npm/下载/star/fork/release/license） | ✅ | 补齐 |
| 30 秒开始（`dsh plugin --profile web add <pkg>`） | ✅ | 补齐 |
| `LICENSE`（MIT） | ✅ | 补齐（当前无 license 字段） |
| `CONTRIBUTING.md`（参与方式 / PR 规范 / 凭据红线 / good first issue 策略） | ✅ | 补齐 |
| `docs/FIRST-CONTRIBUTION.md`（首次贡献路径） | ✅ | 补齐 |
| `install.sh`（dsh CLI 优先 → pnpm 回退 → bundle 幂等注册） | ✅ | 补齐（改包名与结尾文案） |
| `marketing/metadata.json`（npm 必填关键词 / GitHub topics / README hero+cta / 外部市场 listing） | ✅ | 补齐 |
| 独立 Registry 分仓 | ✅（connector 特有） | 本插件**无需** registry 分仓（无"连接器目录"概念） |
| `.github/workflows/ci.yml`（Node 20/22/24 + Windows + PR 预发布包 artifact） | ✅ | 补齐（Node 矩阵按本 ADR 收敛 22/24） |
| `.github/workflows/release.yml`（tag 触发 npm OIDC 发布 + GitHub Release） | ✅ | 补齐 |
| `.github/workflows/market-registration.yml`（每小时外部市场验收） | ✅ | 补齐（awesome-dsh-plugin 上架后） |
| `.github/ISSUE_TEMPLATE/` + `pull_request_template.md` | ✅ | 补齐 |
| `CHANGELOG.md` | ✅ | 补齐（当前 v0.1.0-mvp 起步） |
| npm Trusted Publishing（GitHub OIDC，无长期 NPM_TOKEN） | ✅ | 补齐 |
| 外部 DSH 市场注册（awesome-dsh-plugin PR） | ✅ | 补齐（见 §7） |

结论：**照抄 connector 的工程骨架，替换为数据清洗的产品内容**；registry 分仓这一项跳过。

---

## 2. 命名与仓库决策（待用户拍板）

| 决策点 | 推荐 | 说明 |
| --- | --- | --- |
| GitHub 仓库名 | `dsh-data-cleaning-agent` | 与 connector 同风格（功能 + 形态），社区友好 |
| npm 包名 | `dsh-data-cleaning-agent`（无 scope） | connector 用无 scope；QCC OAuth 系用 `qcc-` 前缀但**无 scope**。当前 `@qcc/...` 是私有 scope，发布到 npm 官方需先有 `@qcc` org 权限 |
| 是否保留 `@qcc/` scope | 建议**改为无 scope** | 无 scope 才与"社区维护、人人可装"目标一致；`@qcc` 需 npm org 权限且易与"私有企业包"混淆 |
| license | MIT | 与三个对标仓库一致；最终以法务确认为准 |
| 团队署名 | "企查查（Qichacha/QCC）团队发起维护" | 与 connector 一致 |
| 默认分支 | `main` | 与对标一致 |
| npm topic | `dsh-plugin` | awesome-dsh-plugin 市场要求 |

> ⚠️ 无 scope 改名意味着 `cordis.patch.yml` 里 `name: '@qcc/dsh-data-cleaning-agent'` 同步改。
> 这是对外发布的身份性问题，**先拍板再动**。

---

## 3. 开源仓库结构（目标态）

```
dsh-data-cleaning-agent/
├── README.md / README.en.md
├── LICENSE                      # MIT
├── CHANGELOG.md
├── CONTRIBUTING.md
├── install.sh                   # 一键安装（dsh CLI → pnpm 回退 → bundle 幂等注册）
├── package.json                 # 根级插件形态：dsh.bundle.patch + dsh.client
├── cordis.patch.yml
├── marketing/metadata.json      # npm/GitHub/README/外部市场元数据
├── .github/
│   ├── workflows/ci.yml         # Node 22/24 + Windows + PR 预发布包
│   ├── workflows/release.yml    # tag → npm OIDC 发布 + GitHub Release
│   ├── workflows/market-registration.yml
│   ├── ISSUE_TEMPLATE/…         # bug / feature / question
│   └── pull_request_template.md
├── docs/
│   ├── USER-GUIDE.md
│   ├── FIRST-CONTRIBUTION.md
│   ├── COMPATIBILITY.md         # 双基线兼容表（承接 ADR-0001）
│   └── …
├── lib/
│   ├── index.js                 # apply(ctx)：tools/skills/jobs/storageDomain/web
│   ├── engine.js                # 纯函数：parseCsv/Xlsx/Json、cleanRows、completeRows、profileRows、toCsv
│   ├── tools.js                 # data_clean_rows / data_complete_rows / data_profile
│   ├── skill.js                 # data-cleaning
│   ├── jobs.js                  # DataCleaningJobs + storageDomain(dc_tasks_v1)
│   ├── web.js                   # /data-cleaning/ 路由 + UI
│   ├── client.js                # window.__ModuleLoader__ 客户端半区
│   └── qcc.js                   # 【新增】企查查 MCP 补全适配层（Phase 2）
├── test/
│   ├── engine.test.js           # 13 例（已有）
│   └── …                        # 增量：qcc adapter、打包校验
└── scripts/
    ├── verify-pack.mjs          # 发布包白名单校验（对标 connector）
    └── check-readme-version.mjs # 版本漂移阻断
```

> 注：当前仓库还混有 `spike1..6/`、`mvp/`、`_refs_oss/` 等**验证期产物**，
> 开源前需做一次"发布面清理"：`spike*/`、`mvp/`、`*.tgz`、`*.log`、`.DS_Store` 全部进 `.gitignore`
> 或移到 `workspace/_archive/`（对标 connector 的"本地草案清理"）。

---

## 4. 开源治理（fork / PR / 社区维护）

直接移植 connector 的治理文本，改动点仅限包名：

1. **`CONTRIBUTING.md`**：
   - 红线：Issue/PR/日志/截图/测试夹具**不得含** Token、API Key、Cookie、OAuth 凭据、真实业务数据。
   - 参与方式：报告缺陷 / 功能建议（Issues）；修插件 / 改文档（fork → 从最新 `main` 开单目的分支 → PR）。
   - 本地开发：`npm install --legacy-peer-deps && npm run check`（DSH peer 由 Host 提供）。
   - PR 要求：单一目的、带测试、中英文文档同步、README 版本与 package.json 一致、只用脱敏夹具。
   - 首次贡献：`good first issue` 标签，范围限文档示例 / 无凭据测试夹具 / 小型校验器，不含发布与凭据类。
2. **`docs/FIRST-CONTRIBUTION.md`**：从 fork → PR 的完整命令路径 + 本地验收命令。
3. **`pull_request_template.md`**：变更类型 / 测试结果 / 手工验收步骤。
4. **`ISSUE_TEMPLATE/`**：bug（复现步骤 + 期望/实际）、feature（场景 + 验收）、question。
5. **维护者清单**（写入 README 或 CODEOWNERS）：仓库 owner `duhu2000`，团队 "Qichacha/QCC"。
6. **版本纪律**：`package.json` 用纯 semver（`0.2.0` 起，不再用 `0.1.0-mvp` 这种带后缀），
   `npm run docs:check` 阻断 README 版本漂移，`prepublishOnly` 跑全量门禁。

---

## 5. CI / Release / npm 发布

**CI（`ci.yml`）**：
- 矩阵 Node `22` / `24`（承接 ADR-0001 第 7 条，不再承诺 Node 20）+ Windows(24)。
- 步骤：`npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund` → `npm run check`。
- `check` = lint（`node --check` 全部 lib/scripts）+ docs:check + verify-pack + `node --test`。

**PR 预发布包（`pr-package` job）**：PR 时 stamp 一个 `x.y.z-pr.<PR号>.<run号>` 版本 →
`npm pack` → 上传 tgz + SHA256SUMS artifact（7 天保留）。让 reviewer 直接拿到可装包。

**Release（`release.yml`）**：
- `on: push: tags: ['v*']`。
- `npm run lint && npm test` → **GitHub OIDC Trusted Publishing** 发 `npm publish --access public`
  （Secrets 无 NPM_TOKEN；对标 connector 已用 OIDC，Provenance 可验）→ `softprops/action-gh-release` 自动生成 Release notes。
- 首次发布前需一次性：npm 端允许 Trusted Publishing 绑定仓库 + workflow 文件。

**发布面校验（`verify-pack.mjs`）**：白名单文件清单（lib/README/LICENSE/cordis.patch.yml/install.sh/marketing…），
扫描敏感内容与本机绝对路径，对标 connector 的 44 文件门禁。

---

## 6. 安装体验（让更多人下载安装使用）

1. **README 30 秒开始**：
   ```bash
   dsh plugin --profile web add dsh-data-cleaning-agent
   ```
   安装后完全重启 DeepSeek Harness（或 `dsh web`）。
2. **`install.sh`**：dsh CLI 优先（自动注册 bundle）→ 无 dsh 回退 pnpm → bundle 幂等注册 → 提示重启。
   结尾文案引导到 GitHub 仓库。
3. **让 Agent 安装**（对标 legal-oauth 的做法）：README 提供一句
   `帮我安装这个插件 https://github.com/duhu2000/dsh-data-cleaning-agent`，
   Agent 按 README 自动执行安装命令。
4. **README hero + cta**（marketing/metadata.json）：中文 hero 一句、英文 hero 一句、
   cta 指向 GitHub star / issues / CONTRIBUTING。
5. **徽章矩阵**：CI / npm 版本 / 下载量 / star / fork / release / license。

---

## 7. 外部市场注册（上架 awesome-dsh-plugin）

对标 connector 的"外部 DSH 市场注册"节点：

1. 仓库 public + 默认分支 `main` + `dsh-plugin` topic。
2. `marketing/metadata.json` 字段齐备（repository/packageName/npm 必填关键词/github topics/readme hero+cta/外部 listing）。
3. 向 `awesome-dsh-plugin` 提交 PR（含 YAML 上架描述），CI 通过后每小时自动验收
   （对标 connector PR #2633 的"每小时市场验收"workflow）。
4. 上架后可被 dshmarket 搜索 + 一键安装。

---

## 8. 企查查 MCP 后台接入（Phase 2，核心新增）

### 8.1 目标

现有引擎的 `completeRows` 只做**确定性补全**（手机号规范化、缺失值确定性填充）。
"补全企业名单"真正需要的是**用企查查最新企业数据**回填：公司名 → 统一社会信用代码 /
法定代表人 / 注册资本 / 成立日期 / 登记状态 / 经营状态 / 风险标签 等。

### 8.2 复用的机制（来自 qcc-mcp-oauth 已验证的 seam）

- 企查查 MCP 通过 `ctx.loader` 创建 `@deepseek-ai/dsh-mcp-client` 条目（`transport: streamable-http`，
  `serverName: company|risk|ipr|operation|history|executive`，`headers: {Authorization: Bearer <token>}`）。
- 授权成功后的工具名形态：`mcp__qcc-company__*`、`mcp__qcc-risk__*` 等。
- 本插件**不重新造 OAuth**，而是与 `qcc-dsh-mcp-oauth` **共存复用**：
  用户已连企查查 → 本插件的补全工具直接调 `mcp__qcc-company__*` 等工具；
  未连接 → 补全工具返回"未连接企查查"并引导模型触发 `qcc_oauth_connect`（401 兜底，对标 PLAN §F7）。

### 8.3 两种接入方案

**方案 A（推荐，模型中介式）**：补全工具不改后端，由 Skill 引导模型
"对名单中每个企业名调用 `mcp__qcc-company__get_company_by_query` / `get_company_registration_info`，
把返回的最新工商信息填进 `data_complete_rows` 的补全字段"。数据路径：模型 → QCC MCP 工具 → 模型 → 补全工具。
- 优点：零 OAuth 重复开发、复用已上架插件、符合"数据由模型组装"的现有边界。
- 缺点：名单大时 token 消耗大、逐条调用慢；需在 Skill 里写清批处理节奏。

**方案 B（后台程序化式）**：新增 `lib/qcc.js`，在 host 半区注入 `@deepseek-ai/dsh-mcp-client` 服务
（`ctx.loader` 动态建条目，与 qcc-mcp-oauth 同机制），补全工具的 `execute` 内部**直接**以
`tools/call` 调 QCC MCP 工具，把结果写入 `completeRows` 的 enrichment 分支，模型只见最终摘要。
- 优点：批量快、不占用模型上下文、真正"后台接入"。
- 缺点：需复用/共享 grant 存储与 token 刷新，工程量大；依赖 mcp-client 的**程序化调用面**
  （需先做 Spike #7 验证 `ctx.loader` 条目能否被插件代码直接 `tools/call`）。

**决策建议**：先做 **A（Phase 2.1，快、可发布）**，同阶段开 **Spike #7** 验证 B 的程序化调用面；
若可行再上 **B（Phase 2.2）**。两者共享"未连接企查查时的引导"路径。

### 8.4 企业名单补全的最小字段契约（v1）

```
输入：企业名（必填，支持模糊名）
输出：credit_no / legal_rep / reg_capital / establish_date /
      reg_status / biz_status / risk_tags（从 risk scan 取）
```
对应 QCC MCP 工具：`mcp__qcc-company__get_company_by_query`（模糊消歧）、
`mcp__qcc-company__get_company_registration_info`（工商详情）、
`mcp__qcc-risk__get_company_risk_scan`（风险标签，可选）。

### 8.5 与 QCC OAuth 插件的共存约束（写入 COMPATIBILITY）

| | qcc-dsh-mcp-oauth | 本插件（数据清洗） |
| --- | --- | --- |
| 覆盖 | company/risk/ipr/operation/history/executive | 数据清洗/补全/画像 + 企业名单补全 |
| 工具名前缀 | `qcc_oauth_*` + `mcp__qcc-*` | `data_clean_rows` / `data_complete_rows` / `data_profile` |
| 存储域 | 自有 grant store | `dc_tasks_v1` |
| 能否共存 | ✅（工具名/存储域/条目 id 全独立） | ✅ |

---

## 9. 路线图与 Gate

| 阶段 | 内容 | Gate（达成才进下一阶段） |
| --- | --- | --- |
| **G0 拍板** | 命名/scope/license/团队署名/仓库 URL | 用户明确授权（本文档第 2 节） |
| **G1 开源化** | 发布面清理 → 仓库结构 → README/EN/LICENSE/CONTRIBUTING/ISSUE/PR 模板 → install.sh → marketing 元数据 | `npm run check` 全绿；`verify-pack` 白名单通过 |
| **G2 建仓发布** | 本地 git init + 首次 commit → GitHub 建仓 push → CI 绿 → tag `v0.2.0` → npm OIDC 发布 → GitHub Release | npm 全新下载安装验证通过（对标 connector "全新安装验证"） |
| **G3 市场上架** | awesome-dsh-plugin PR + 每小时验收 workflow | 市场可搜索 + 一键安装成功 |
| **G4 QCC 接入 A** | Skill 引导模型调 QCC MCP 工具补全企业名单（模型中介式） | 双基线 headless 真实模型：企业名 → 工商字段回填，exit=0 |
| **G5 Spike#7 + 接入 B** | 验证 mcp-client 程序化调用面 → `lib/qcc.js` 后台批量补全 | 后台批量补全端到端通过、token 刷新正确、未授权引导正确 |
| **G6 持续运营** | CHANGELOG 迭代、issue 分诊、good first issue 供给、市场统计同步 | 对标 connector 的运营节奏 |

> 每阶段均为**可逆/可回退**；G2 起涉及外发（push/npm publish），逐项经用户授权后执行。

---

## 10. 风险与合规

1. **凭据安全**：企业名单属真实业务数据，严禁进入 Issue/PR/日志/截图/夹具；补全功能涉及 QCC token，
   只走 `ctx.storageDomain`（0700 落盘），不落仓库。
2. **license / 团队署名**：MIT 与 "企查查团队发起维护" 以法务确认为准，确认前不发包。
3. **scope 改名**：`@qcc/dsh-data-cleaning-agent` → `dsh-data-cleaning-agent` 是身份变更，
   一旦发布不可逆，必须先拍板。
4. **npm 名冲突**：无 scope 名 `dsh-data-cleaning-agent` 可能已被占用，发布前 `npm view` 探测；
   若占用改用 `qcc-dsh-data-cleaning`（QCC OAuth 系命名风格）。
5. **数据边界**：模型始终只回摘要不回原文（现有约束保持）；补全结果明细只经同源 web 端点交付，
   不直接吐给模型。
6. **双基线兼容**：公开 README 不把 alpha.2 的 `@Remote` 当稳定 API；兼容性表述沿用 ADR-0001 口径。

---

## 11. 待用户拍板清单

1. GitHub 仓库名 / npm 包名（无 scope `dsh-data-cleaning-agent` vs `qcc-dsh-data-cleaning`）。
2. license 用 MIT 是否可接受（法务）。
3. 团队署名文案确认。
4. 是否现在执行 **G1（开源化改造，纯本地可逆）**？
5. G2 建仓 push 时需提供仓库 URL 与公开/私有。
6. Phase 2 接入方案：先 A 后 B（推荐）？是否现在就开 Spike #7？

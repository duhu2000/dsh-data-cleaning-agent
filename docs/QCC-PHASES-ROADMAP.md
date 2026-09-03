# 企查查数据维度补全 · 二期 / 三期路线图与字段清单

> 本文档是 `dsh-data-cleaning-agent` 接入企查查（QCC）MCP 的**分期规划与可清洗/补全维度字段清单**。
> 一期（方案 A 模型中介式，已落地于 0.3.0）见 [QCC-ENRICHMENT-DESIGN.md](QCC-ENRICHMENT-DESIGN.md)。

## 0. 工具面口径

企查查 MCP 当前按 **6 大资源域** 暴露数据工具，**合计 185 个**（16 + 38 + 18 + 35 + 34 + 44 = 185），
另加招投标附加域 6 个：

| 资源域 | MCP 前缀 | 工具数 | 授权要求 | 数据主题 |
| --- | --- | --- | --- | --- |
| 工商 | `mcp__qcc-company__*` | 16 | 基础授权 | 主体、股权、人员、财务、上市 |
| 风险 | `mcp__qcc-risk__*` | 38 | 基础授权 | 司法、失信、执行、处罚、冻结 |
| 知产 | `mcp__qcc-ipr__*` | 18 | 基础授权 | 专利、商标、软著、数字资产 |
| 经营 | `mcp__qcc-operation__*` | 35 | 基础授权 | 资质、招投标、融资、舆情、监管 |
| 历史 | `mcp__qcc-history__*` | 34 | **企业认证账号** | 历史股东/法人/变更/风险 |
| 人员 | `mcp__qcc-executive__*` | 44 | 基础授权 | 董监高个人风险与关联 |
| 招投标（附加） | `mcp__qcc-tender__*` | 6 | 基础授权 | 标讯、拟建项目、企业标讯画像 |

> 6 大资源域恰好 185 个；招投标域为附加能力。实际可用工具数随授权资源域（`QCC_RESOURCES`）
> 与账号等级变化。各工具的具体输入输出字段以官方 MCP 工具 schema 为准，本文只列
> 「补全维度 → 关键字段 → 来源工具」的映射。

---

## 1. 分期总览

| 阶段 | 版本 | 交付形态 | 覆盖维度 | 依赖 |
| --- | --- | --- | --- | --- |
| 一期 | 0.3.0 ✅ | 方案 A：模型中介式 Skill `enterprise-enrichment` | 核心工商 7 字段 + 风险标签 | `qcc-dsh-mcp-oauth` 已连接 |
| 二期 | 0.4.0 ✅ | 方案 A 扩展 Skill：工商全景 + 股权穿透 | 工商域 16 工具 + 历史工商 | 同上 |
| 三期 | 0.5.0 RC | 方案 A 扩展 Skill：风险/知产/经营 + 方案 B 批量后端 | 风险 38 + 知产 18 + 经营 35 | 本地/双基线零调用门与最小真实 Phase-3 E2E 已过；待发布授权 |
| 四期（可选） | 0.6.0 | 历史轨迹 + 董监高 + 招投标 | 历史 34 + 人员 44 + 招投标 6 | 企业认证账号（历史域） |

每期之间不互相阻塞：二期工商全景、三期风险知产都可独立评审与合入。

---

## 2. 一期（0.3.0，已落地）· 核心工商字段

v1 字段契约（方案 A）：

| 字段 | 含义 | 来源工具 |
| --- | --- | --- |
| `credit_no` | 统一社会信用代码 | `mcp__qcc-company__get_company_registration_info` |
| `legal_rep` | 法定代表人 | 同上 |
| `reg_capital` | 注册资本 | 同上 |
| `establish_date` | 成立日期 | 同上 |
| `reg_status` | 登记状态 | 同上 |
| `biz_status` | 经营状态 | 同上 |
| `risk_tags` | 风险标签（命中维度 + 计数） | `mcp__qcc-risk__get_company_risk_scan` |

---

## 3. 二期（0.4.0）· 工商全景 + 股权穿透

目标：把「只补身份证」升级为「补全家福」——主体详情、股权结构、对外投资、人员、财务、上市、
联系方式、开票信息，以及历史工商沿革（历史域）。

### 3.1 工商域（`mcp__qcc-company__*`）

| 补全维度 | 关键字段 | 来源工具 |
| --- | --- | --- |
| 主体锚定 | 企业名、统一社会信用代码、注册号 | `get_company_by_query` / `get_company_registration_info` |
| 企业画像 | 简介、行业、产业链 | `get_company_profile` |
| 二要素核验 | 名称 ↔ 信用代码是否一致 | `verify_company_accuracy` |
| 实控人 | 总持股比例、表决权比例、最终受益股份 | `get_actual_controller` |
| 受益所有人 | UBO 识别（央行口径） | `get_beneficial_owners` |
| 股东构成 | 股东名、持股比例、认缴出资额、出资时间 | `get_shareholder_info` |
| 对外投资 | 被投企业、持股比例、认缴额 | `get_external_investments` |
| 分支机构 | 机构名、负责人、地区、状态 | `get_branches` |
| 主要人员 | 姓名、职务（董监高） | `get_key_personnel` |
| 变更记录 | 变更事项、前后值、日期 | `get_change_records` |
| 年报 | 报告年度、从业人数、资产/营收 | `get_annual_reports` |
| 联系方式 | 电话、邮箱、网站、ICP 备案 | `get_contact_info` |
| 开票信息 | 税号、地址、开户行 | `get_tax_invoice_info` |
| 上市信息 | 代码、简称、交易所、市值 | `get_listing_info` |
| 财务数据 | 营收、利润、资产负债率、增长率 | `get_financial_data` |

### 3.2 历史工商（`mcp__qcc-history__*`，需企业认证账号）

| 补全维度 | 关键字段 | 来源工具 |
| --- | --- | --- |
| 历史股东 | 曾持股比例、退出日期 | `get_historical_shareholders` |
| 历史法人 | 历任法代、任职起止 | `get_historical_legal_rep` |
| 历史高管 | 历任高管、任职起止 | `get_historical_executives` |
| 历史登记 | 曾用名、历史注册资本/地址/经营范围 | `get_historical_registration` |

### 3.3 二期验收门

- Skill 对一份 20 条企业名单，能在二期字段契约内输出**每企业 ≥ 15 个维度**的补全表。
- 消歧规则不变（`get_company_by_query` 多候选必须询问用户）。
- 金额/比例/计数逐字引用工具返回值，禁止自算、禁止臆测。

### 3.4 实施状态（0.4.0 已发布）

- ✅ 第一切片：`lib/qcc-phase2.js` 已固化本地 QCC MCP 一手源码核对过的
  16 个工商工具和 4 个历史工商工具；`enterprise-enrichment` 已扩展为按维度组调用。
- ✅ 安全规则：多候选人工确认、付费组按需调用、数值原样保留、来源工具标记、
  历史域无权显式降级。
- ✅ 验收自动化：`e2e:phase2` 默认关闭，检查 20 企业 / 每企业 ≥15 维、
  来源工具、原值一致性、主体消歧和历史账号门，拒绝合成证据替代真实 E2E。
- ✅ DSH 冒烟：当前工作树 tarball 已在隔离 `0.1.1-rc.2` 和 `0.1.2-alpha.2` Host
  完成加载，两者 seam 均返回 `enrichSkillRegistered:true`；测试 Host 已停止，生产端口未触碰。
- ✅ 预检状态冒烟：无 OAuth 插件时返回 `oauth-plugin-missing`；安装插件但未授权时
  返回 `not-connected-or-refreshing`。两种情况都不执行 QCC 工具，不产生付费调用。
- ✅ 真实发布门主路径：隔离 rc.2 Host 完成 OAuth、20 企业、400 次调用；20/20 主体解析，
  每企业当前最低 15 维、历史 4 维，严格验收通过。
- ✅ 2026-09-02 发布门收口：自然过期 token 真实刷新、16+4 动态工具恢复、续期后 1 行真实 enrich；
  401/429/配额耗尽通过 Web→Bridge→ToolRuntime 故障注入验证，无自动重试且审计脱敏。

---

## 4. 三期（0.5.0）· 风险 / 知产 / 经营 + 批量后端

目标：覆盖风控名单、供应商尽调、招投标核查三类场景；同时启动方案 B 批量后端。

### 4.1 风险域（`mcp__qcc-risk__*`，38 工具）

| 补全维度 | 关键字段 | 来源工具 |
| --- | --- | --- |
| 风险总览 | 35 项因子命中计数 | `get_company_risk_scan` |
| 关联风险 | 股东/投资/法人等关联方命中 | `get_company_related_risk_scan` |
| 行政处罚 | 处罚结果、金额、机关、日期 | `get_administrative_penalty` |
| 环保处罚 | 处罚结果、金额、机关 | `get_environmental_penalty` |
| 经营异常 | 列入原因、日期、决定机关 | `get_business_exception` |
| 严重违法 | 列入原因、日期、移出 | `get_serious_violation` |
| 失信被执行人 | 案号、金额、法院、日期 | `get_dishonest_info` |
| 被执行人 | 案号、执行标的、法院 | `get_judgment_debtor_info` |
| 终本案件 | 案号、终本日期、未履行金额 | `get_terminated_cases` |
| 限制高消费 | 案号、申请人、对象 | `get_high_consumption_restriction` |
| 股权冻结 | 股权数额、法院、期限 | `get_equity_freeze` |
| 股权出质 | 出质人、质权人、数额 | `get_equity_pledge_info` |
| 动产/土地抵押 | 抵押物、担保债权额、抵押权人 | `get_chattel_mortgage_info` / `get_land_mortgage_info` |
| 破产重整 | 案号、申请人、被申请人 | `get_bankruptcy_reorganization` |
| 立案信息 | 案号、案由、当事人 | `get_case_filing_info` |
| 开庭公告 | 案号、案由、开庭时间 | `get_hearing_notice` |
| 法院公告/送达 | 公告类型、案号、当事人 | `get_court_notice` / `get_service_notice` |
| 裁判文书 | 文书 ID、标题、案由、金额 | `get_judicial_documents`（详情 `get_judicial_document_detail`） |
| 欠税/税收违法 | 税种、金额、机关 | `get_tax_arrears_notice` / `get_tax_violation` / `get_tax_abnormal` |
| 违约 | 债券/票据/非标违约本金利息 | `get_default_info` |
| 担保/惩戒/限出境 | 担保金额、惩戒类型、案号 | `get_guarantee_info` / `get_disciplinary_list` / `get_exit_restriction` |
| 司法拍卖/悬赏/询价 | 起拍价、案号、财产 | `get_judicial_auction` / `get_property_asset_announcement` / `get_valuation_inquiry` |
| 诉前调解/公示催告/清算/注销 | 案号、案由、状态 | `get_pre_litigation_mediation` / `get_public_exhortation` / `get_liquidation_info` / `get_cancellation_record_info` / `get_simple_cancellation_info` / `get_service_announcement` |

### 4.2 知产域（`mcp__qcc-ipr__*`，18 工具）

| 补全维度 | 关键字段 | 来源工具 |
| --- | --- | --- |
| 专利 | 专利名、类型、法律状态、申请日 | `get_patent_info` |
| 国际专利 | 发明名、公开号、发明人 | `get_international_patent` |
| 商标 | 商标名、类别、状态 | `get_trademark_info` |
| 商标文书 | 文书号、申请人、被申请人 | `get_trademark_document` |
| 软著 | 软件名、版本、登记号 | `get_software_copyright_info` |
| 作品著作权 | 作品名、登记号 | `get_copyright_work_info` |
| 标准 | 标准名、编号 | `get_standard_info` |
| 知产出质 | 出质类型、名称、期限 | `get_ipr_pledge` |
| 集成电路布图 | 布图名、登记号 | `get_integrated_circuit_layout` |
| 数字资产 | APP / 小程序 / 公众号 / 抖音 / 快手 / 微博 / 网店 | `get_app_info` / `get_mini_program` / `get_wechat_official_account` / `get_douyin_account` / `get_kuaishou_account` / `get_weibo_account` / `get_online_store` |
| 备案 | ICP/APP/小程序/算法备案 | `get_internet_service_info` |
| 特许经营 | 备案号、特许人 | `get_commercial_franchise` |

### 4.3 经营域（`mcp__qcc-operation__*`，35 工具）

| 补全维度 | 关键字段 | 来源工具 |
| --- | --- | --- |
| 行政许可 | 许可证名称、编号、有效期 | `get_administrative_license` |
| 资质证书 | 证书类型、等级、状态 | `get_qualifications` |
| 纳税资质 | 纳税人类型、税务机关 | `get_taxpayer_qualification` |
| 信用评价 | 纳税信用、海关信用等级 | `get_credit_evaluation` |
| 信用承诺 | 类型、履行状态 | `get_credit_commitments` |
| 荣誉/榜单 | 荣誉名、榜单名、排名 | `get_honor_info` / `get_ranking_list_info` |
| 招投标 | 项目名、角色、金额 | `get_bidding_info` |
| 融资记录 | 轮次、金额、时间 | `get_financing_records` |
| 融资租赁 | 出租/承租、租赁价值 | `get_financing_lease_info` |
| 私募基金 | 管理人编号、规模区间 | `get_private_fund_manager` |
| 投资机构 | 机构类型、管理规模 | `get_investment_institution` |
| 上市公告 | 公告标题、类型、日期 | `get_company_announcement` / `get_related_announcement` |
| 舆情 | 新闻标题、情感倾向、时间 | `get_news_sentiment` |
| 政府约谈/公告 | 约谈问题、机关、日期 | `get_government_interview` / `get_government_announcement` |
| 监管抽查 | 抽查事项、结果、机关 | `get_random_check` / `get_spot_check_info` / `get_product_spot_check` |
| 食品安全 | 抽检结果、生产商 | `get_food_safety` |
| 违规通报 | 软件/化妆品/未准入境/召回 | `get_software_violation` / `get_counterfeit_cosmetics` / `get_entry_denied` / `get_product_recall` |
| 进出口信用 | 信用等级、备案 | `get_import_export_credit` |
| 土地/产权 | 受让/转让/产权交易 | `get_land_grant_info` / `get_land_transfer_info` / `get_property_rights_transaction` |
| 电信/游戏/广告 | 许可、版号、审查 | `get_telecom_license` / `get_game_approval` / `get_advertising_review` |
| 科技成果 | 成果名、登记号 | `get_tech_achievement` |
| 资产拍卖/招聘 | 起拍价、职位、薪酬 | `get_asset_auction` / `get_recruitment_info` |

### 4.4 三期并行 · 方案 B 批量后端

一期/二期/三期均为模型中介式（模型逐个调 QCC 工具）。当名单规模进入百级/千级，模型逐调成本高，
方案 B 已启动：插件内 `lib/qcc.js` 经公共 `ctx.tools.execute()` 调用 mcp-client 动态注册的工具；
不直接访问 `ctx.loader` 条目或 mcp-client 私有 client。

- Spike #7：rc.2 / alpha.2 双基线 PASS。
- G5-2：在 G5-1 基础上完成默认关闭 E2E Runner、脱敏、请求幂等、多候选确认续跑、
  retryable 失败人工重试、细分错误分类与安全审计，均已通过 Mock/Contract 测试。
- 已通过：真实 OAuth 首连、授权跨重启恢复、真实 QCC 主调用路径、token 自然到期刷新与续期后调用。
- 已通过：401/429/配额耗尽故障注入；仅 retryable 错误允许用户显式重试，非 retryable 配额错误在派发前阻断。
- 已完成：91 工具冻结契约、三域批量服务、`/phase3/*` API、四步工作台、零调用估算、
  付费确认、候选续跑、失败工具重试、双 CSV 和默认关闭的 `e2e:phase3` Runner。
- 已验证：125/125 自动化、rc.2 / alpha.2 Host 零调用冒烟 24/24、rc.2 实际 UI 与中文字段映射闭环。
- 待批准：维护者测试账号真实三域 E2E 的企业夹具、域、调用上限与维护者自担测试预算；
  客户生产账号费用不在插件承担范围内，未批准测试边界前不得执行。

---

## 5. 四期（0.6.0，可选）· 历史轨迹 + 董监高 + 招投标

### 5.1 人员域（`mcp__qcc-executive__*`，44 工具）

| 补全维度 | 关键字段 | 来源工具 |
| --- | --- | --- |
| 个人风险总览 | 18 项命中计数 | `get_executive_risk_scan` |
| 关联企业风险 | 其任法代/董监高/控制企业的风险 | `get_executive_related_risk_scan` |
| 任职 | 在外任职企业、职务 | `get_executive_positions` |
| 法代角色 | 担任法代的企业列表 | `get_executive_legal_rep_roles` |
| 对外投资 | 直接 + 间接持股 | `get_executive_investments` |
| 控制企业 | 实控企业、投资比例 | `get_executive_controlled_companies` |
| 关联企业 | 全部关联企业 + 角色 | `get_executive_related_companies` |
| 个人司法/处罚 | 失信/被执行/限高/限出境/处罚/冻结/出质 | 对应 `get_executive_*`（18 维 + 历史版本） |
| 历史轨迹 | 历史任职/法代/投资/合伙 | `get_executive_historical_*`（约 20 个） |

### 5.2 招投标域（`mcp__qcc-tender__*`，6 工具）

| 补全维度 | 关键字段 | 来源工具 |
| --- | --- | --- |
| 企业标讯画像 | 招采/投标/中标/代理数量 | `search_companies` |
| 企业标讯明细 | 标讯列表 + 角色 | `search_company_tenders` |
| 招标/中标公告 | 标题、金额、时间 | `search_tenders`（详情 `get_tender_detail`） |
| 拟建项目 | 项目、投资、阶段 | `search_proposed_projects`（详情 `get_proposed_project_detail`） |

---

## 6. 可清洗补全的通用维度（跨期复用的「列」模型）

无论哪一期，补全输出的列都归入以下**通用维度族**，便于用户勾选与 CSV 回写：

1. **身份维度**：企业名、统一社会信用代码、注册号、曾用名、股票代码/简称。
2. **主体维度**：法定代表人、注册资本、成立日期、登记状态、经营状态、注册地址、行业、简介。
3. **股权维度**：股东构成、实控人、受益所有人、对外投资、分支机构、历史股东/法人。
4. **人员维度**：董监高、主要人员、个人任职/投资/风险。
5. **财务维度**：营收、利润、资产负债率、增长率、融资记录、年报。
6. **合规风险维度**：经营异常、严重违法、行政处罚、环保处罚、欠税、税收违法、食品/产品/违规通报。
7. **司法风险维度**：立案、开庭、裁判文书、失信、被执行、终本、限高、股权冻结/出质、抵押、破产。
8. **知产维度**：专利、商标、软著、著作权、标准、数字资产、备案。
9. **经营资质维度**：行政许可、资质、纳税资质、信用评价、荣誉、榜单、进出口信用。
10. **市场活动维度**：招投标、拟建项目、融资、上市公告、舆情、招聘。

---

## 7. 分期评审与合入规则

- 每期交付前须通过 `npm run check`（lint + docs:check + marketing:check + verify-pack + 全量测试）。
- 每期新增 Skill 内容须遵守安全不变量：不编造字段、多候选必询问、金额比例计数逐字引用。
- 历史域（`qcc-history`）与四期人员历史工具需企业认证账号，未授权时 Skill 须显式降级并说明，不得假装补全。
- 版本号按 SemVer：二期 0.4.0、三期 0.5.0、四期 0.6.0，均需 CHANGELOG + README 版本同步后走 OIDC 发布。

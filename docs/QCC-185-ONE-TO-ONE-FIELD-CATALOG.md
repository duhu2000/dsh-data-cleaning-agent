# 企查查 MCP 185 工具：数据清洗补全一对一字段目录

> 快照日期：2026-09-05
> 适用产品：`dsh-data-cleaning-agent` 0.7.0 开发基线
> 核心口径：一家输入企业对应一行结果；一个补全字段必须能稳定落入一个 Excel 单元格。

## 1. 结论

当前企查查 MCP 企业数据工具共 185 个：工商 16、风险 38、知识产权 18、经营 35、历史 34、董监高 44。工具说明工作簿中的 187 行与该注册表完全对齐；多出的 2 个是文档解析工具 `parse_document`、`get_parse_result`，不属于企业数据 185 工具。

按“一企一行、一字段一单元格”重新审计后：

| 分类 | 工具数 | 处理方式 |
| --- | ---: | --- |
| A · 当前可选 | 2 | Host 已有确定性映射，可直接进入字段选择与 XLSX |
| B · 当前可选 | 6 | 专用 Host 适配器、按需调用、中文导出与自动化验收已完成 |
| C · 需先冻结快照规则 | 2 | 多报告期；必须明确“最新报告期”的选择与空值规则后开放 |
| W · 工作流辅助 | 2 | 只用于主体锚定/二要素核验，不作为普通补全字段组 |
| X · 当前排除 | 173 | 多人、多机构、多事件、多证书、历史序列或二级详情粒度，留待一对多数据产品 |
| **合计** | **185** | |

字段层面：A+B 当前共开放 128 个字段；C 类在冻结“最新期”规则后可候选 72 个字段。C 字段不得在 Host 尚未接入时先作为 UI 占位。

## 2. 判定规则

### 2.1 可以进入数据清洗补全

必须同时满足：

1. 输入锚点是企业名称、统一社会信用代码或注册号；
2. 输出主体仍是同一家企业；
3. 每个字段有唯一、可复现的值；
4. 缺失时输出空单元格，不猜测、不由模型补造；
5. 字段中文名、来源工具、提取路径和选择规则均可审计；
6. 同一工具选择多个字段时，每家企业只调用一次该工具。

### 2.2 当前排除

- 一家企业返回多个股东、人员、分支、投资、案件、证书、专利、商标、招聘、新闻等记录；
- 历史事件或历年快照没有冻结“取哪一期”的合同；
- 需要 `documentId`、人员姓名或其他二级标识，而不是企业主键；
- 只能通过地址文本推断省/市/区，或把“企查查行业”猜成一级/二级行业；
- 把多条记录用分号强行拼入单元格，导致行级语义不可复用。

一对多数据后续应输出子表/独立 Sheet，或采用“企业主表 + 明细表 + 关联键”，而不是扩展当前一企一行模型。

## 3. A 类：当前业务开放的 30 个字段

### 3.1 企业工商信息 · `get_company_registration_info`

该工具对普通企业返回一个顶层对象，以下 27 个字段均为直接映射。

| 内部字段 ID | 导出中文表头 | MCP 返回字段 |
| --- | --- | --- |
| `company_name` | 企业名称 | 企业名称 |
| `credit_no` | 统一社会信用代码 | 统一社会信用代码 |
| `legal_rep` | 法定代表人 | 法定代表人 |
| `reg_status` | 登记状态 | 登记状态 |
| `establish_date` | 成立日期 | 成立日期 |
| `reg_capital` | 注册资本 | 注册资本 |
| `paid_capital` | 实缴资本 | 实缴资本 |
| `org_no` | 组织机构代码 | 组织机构代码 |
| `reg_no` | 注册号 | 工商注册号 |
| `tax_no` | 纳税人识别号 | 纳税人识别号 |
| `company_type` | 企业类型 | 企业类型 |
| `operating_period` | 营业期限 | 营业期限 |
| `taxpayer_qualification` | 纳税人资质 | 纳税人资质 |
| `company_size` | 人员规模 | 人员规模 |
| `insured_count` | 参保人数 | 参保人数 |
| `branch_insured_count` | 分支机构参保人数 | 分支机构参保人数 |
| `approval_date` | 核准日期 | 核准日期 |
| `region` | 所属地区 | 所属地区 |
| `registration_authority` | 登记机关 | 登记机关 |
| `payment_line_no` | 支付系统行号 | 支付系统行号 |
| `import_export_company_code` | 进出口企业代码 | 进出口企业代码 |
| `industry_category` | 国标行业 | 国标行业 |
| `short_name` | 企业简称 | 企业简称 |
| `english_name` | 英文名 | 英文名 |
| `registered_address` | 注册地址 | 注册地址 |
| `mailing_address` | 通信地址 | 通信地址 |
| `business_scope` | 经营范围 | 经营范围 |

说明：

- `人员规模` 使用原工具字段，不再显示为来源不明的泛化“企业规模”；内部 ID 暂保留 `company_size` 以兼容已有任务。
- `所属地区` 原值输出，不从地址或地区文本二次拆分省、市、区县。
- 普通企业响应没有“曾用名”，当前字段选择中移除。其他机构类型虽有专属标量字段，但不混入普通企业默认目录，后续单独做“主体类型模板”。

### 3.2 企业简介 · `get_company_profile`

| 内部字段 ID | 导出中文表头 | MCP 返回字段 | 规则 |
| --- | --- | --- | --- |
| `company_profile` | 企业简介 | 简介 | 原文输出 |
| `qcc_industry` | 企查查行业 | 企查查行业 | 工具返回的最细单个展示层级 |
| `industry_chain_overview` | 产业链概览 | 产业链概览 | 有值才输出；缺失为空 |

特别约束：

- `国标行业` 只来自 `get_company_registration_info`；
- `企查查行业` 只来自 `get_company_profile`；
- 当前工具没有返回“一级行业”“二级行业”，因此这两个字段已从业务、提示词向导和导出目录移除；不得由模型猜测拆分。
- 用户上传数据中的联系电话仍可映射为本地质量检查字段；QCC 补全的联系方式使用 B 类专用字段，二者不互相覆盖。

## 4. B 类：已开放的一对一适配字段

这些字段已完成 Host 适配器、工具存在性预检、字段路径、空值、调用量、中文 XLSX 与 Mock/Contract 验收；真实 QCC 双企业回归结论另见本版本验收记录。

### 4.1 联系方式 · `get_contact_info` · 6 字段

原始返回包含电话、邮箱、网址数组，只允许提取具有自然“主值”语义的字段：

| 候选字段 | 固定提取规则 |
| --- | --- |
| 首选联系电话 | `电话[0].电话号码`；通常为当前联系电话，当前值缺失时上游可能返回历史首项 |
| 首选电话无效标记 | `电话[0].是否无效`；未标记时为空，不把空值解释为“否” |
| 首选电话标签 | `电话[0].标签`；仅标签数组可用 `；`连接为一个属性值 |
| 主邮箱 | `邮箱[0].邮箱`；源代码把主邮箱放在更多邮箱之前 |
| 官方网站 | 仅取 `网址` 中 `是否是官网=是` 的记录；没有官网则为空 |
| 官网 ICP 备案 | 与“官方网站”同一条记录的 `ICP备案` |

不开放“全部电话/邮箱/网址”拼接列，也不以第一个非官网网站冒充官网。

### 4.2 上市信息 · `get_listing_info` · 15 字段

上市日期、股票简称、股票代码、上市交易所、上市板块、上市曾用名、总市值、总股本、预测市盈率、流通值、流通股、市净率、EPS、表决权差异、是否注册制。

该工具当前只选择 A 股或红筹证券的首个目标证券，输出本身已是一对一顶层对象；仍需在插件中记录该证券选择口径。

### 4.3 税务开票信息 · `get_tax_invoice_info` · 8 字段

企业名称、纳税人识别号、企业类型、经营状态、开票地址、开票联系电话、开户行、开户行账号。

“地址”“联系电话”在 UI 中必须标注为开票字段，避免与工商注册地址、企业主联系电话混淆。

### 4.4 进出口信用 · `get_import_export_credit` · 11 字段

统一社会信用代码、所在地海关、行政区划、地址、经济区划、经营类别、统计经济区划、行业种类、跨境贸易电子商务类型、信用等级、备案日期。

原始响应中的“海关资质”是数组，当前排除；只保留上述顶层标量。

### 4.5 企业自身风险扫描 · `get_company_risk_scan` · 38 字段

可输出 3 个聚合字段：有记录因子数、无记录因子数、风险命中摘要；并可把以下当前 35 个配置因子的 `条目数` 按因子名透视成 35 个数值列：

失信信息、被执行人、限制高消费、终本案件、裁判文书、立案信息、开庭公告、法院公告、送达公告、破产重整、股权冻结、司法拍卖、询价评估、诉前调解、限制出境、行政处罚、经营异常、严重违法、环保处罚、税务非正常户、欠税公告、税收违法、惩戒名单、违约事项、担保信息、股权出质、股权质押、动产抵押、土地抵押、简易注销、注销备案、清算信息、劳动仲裁、公示催告、财产悬赏公告。

风险因子由数据库配置驱动，插件必须按返回的因子名动态透视，并在制品元数据记录因子目录版本；不能把 35 当作永不变化的常量。

### 4.6 企业关联风险扫描 · `get_company_related_risk_scan` · 20 字段

可输出：

- 有风险关联方数、关联风险摘要；
- 11 个重要风险条目数：失信被执行人、被执行人、限制高消费、严重违法、税收违法、行政处罚、破产重整、终本案件、股权冻结、欠税公告、经营异常；
- 7 个重点维度命中关联方数：失信被执行人、严重违法、破产重整、税收违法、被执行人、终本案件、股权冻结。

“司法案件”“其他关联风险”“重点维度关联方定位”中的关联方列表仍是一对多，当前排除。

## 5. C 类：需冻结“最新期”规则后才能开放的 72 字段

### 5.1 企业年报 · `get_annual_reports` · 48 个候选标量

工具返回最多 3 个年度。只有在插件实现“解析年报年度并取最大年度；同年度冲突进入人工核验”的合同后，才可开放以下最新年报字段：

- 年报基础 4 项：年报年度、发布日期、备注、是否有详细信息；
- 企业基本 16 项：统一社会信用代码、注册号、企业经营状态、从业人数、女性从业人数、企业控股情况、本年度是否股权转让、是否有投资/购买股权、是否对外担保、是否有网站或网店、企业联系电话、电子邮箱、隶属企业名称、企业通信地址、邮政编码、企业主营业务活动；
- 企业资产 8 项：资产总额、所有者权益合计、营业总收入、利润总额、净利润、主营业务收入、纳税总额、负债总额；
- 社保 20 项：五险参保人数、单位缴费基数、本期实际缴费金额/基数、累计欠缴金额对应的 20 个原始字段。

年报中的股东出资、股权变更、对外投资、担保、网站、行政许可、修改记录都是列表，不随“最新年报”一起进入一企一行列。

### 5.2 财务数据 · `get_financial_data` · 24 个候选标量

工具返回最近 3 个报告期。冻结“按可解析报告期降序取最新一期；同报告期冲突或报告期不可解析则不自动选择”后，可开放：

报告期、披露等级、营业总收入、利润总额、净利润、资产合计、负债合计、所有者权益总计、经营活动产生的现金流、加权净资产收益率、净利率、毛利率、资产负债率、营运资本、流动比率、速动比率、总资产周转率、应收账款周转天数、总资产同比、营业收入同比、毛利同比增长、流动资产合计、流动负债合计、固定资产。

## 6. 185 工具完整审计

标记：`A` 当前开放；`B` 一对一可适配；`C` 需最新期规则；`W` 工作流辅助；`X` 当前一对多排除。

### 6.1 工商信息 16

| 工具 | 分类 | 说明 |
| --- | --- | --- |
| `get_company_registration_info` | A | 普通企业 27 个顶层标量 |
| `get_company_profile` | A | 简介、企查查行业、产业链概览 |
| `get_contact_info` | B | 数组中仅自然主值可抽取 |
| `get_listing_info` | B | 当前证券快照顶层标量 |
| `get_tax_invoice_info` | B | 税务开票顶层标量 |
| `get_annual_reports` | C | 多年度；仅可做最新年报快照 |
| `get_financial_data` | C | 最近三期；仅可做最新报告期快照 |
| `get_company_by_query` | W | 主体锚定与多候选人工选择 |
| `verify_company_accuracy` | W | 企业名 + 信用代码二要素核验 |
| `get_actual_controller` | X | 可能多个最终控制人 |
| `get_beneficial_owners` | X | 多个受益所有人 |
| `get_branches` | X | 多个分支机构 |
| `get_change_records` | X | 多条工商变更事件 |
| `get_external_investments` | X | 多个被投资主体 |
| `get_key_personnel` | X | 多名人员/职务 |
| `get_shareholder_info` | X | 多个股东及出资记录 |

### 6.2 风险信息 38

| 分类 | 工具 |
| --- | --- |
| B | `get_company_risk_scan`、`get_company_related_risk_scan` |
| X | `get_administrative_penalty`、`get_bankruptcy_reorganization`、`get_business_exception`、`get_cancellation_record_info`、`get_case_filing_info`、`get_chattel_mortgage_info`、`get_court_notice`、`get_default_info`、`get_disciplinary_list`、`get_dishonest_info`、`get_environmental_penalty`、`get_equity_freeze`、`get_equity_pledge_info`、`get_exit_restriction`、`get_guarantee_info`、`get_hearing_notice`、`get_high_consumption_restriction`、`get_judgment_debtor_info`、`get_judicial_auction`、`get_judicial_document_detail`、`get_judicial_documents`、`get_land_mortgage_info`、`get_liquidation_info`、`get_pre_litigation_mediation`、`get_property_asset_announcement`、`get_public_exhortation`、`get_serious_violation`、`get_service_announcement`、`get_service_notice`、`get_simple_cancellation_info`、`get_stock_pledge_info`、`get_tax_abnormal`、`get_tax_arrears_notice`、`get_tax_violation`、`get_terminated_cases`、`get_valuation_inquiry` |

排除原因：均返回案件、处罚、执行、冻结、公告、抵押等明细列表；其中 `get_judicial_document_detail` 还需要 `documentId`，不属于企业主表粒度。

### 6.3 知识产权 18

全部为 X：`get_app_info`、`get_commercial_franchise`、`get_copyright_work_info`、`get_douyin_account`、`get_integrated_circuit_layout`、`get_international_patent`、`get_internet_service_info`、`get_ipr_pledge`、`get_kuaishou_account`、`get_mini_program`、`get_online_store`、`get_patent_info`、`get_software_copyright_info`、`get_standard_info`、`get_trademark_document`、`get_trademark_info`、`get_wechat_official_account`、`get_weibo_account`。

排除原因：一家企业可拥有多个专利、商标、著作权、账号、网站、应用、网店或特许经营记录。当前不提供“商标摘要/专利摘要”这类未经定义的拼接列。

### 6.4 经营信息 35

| 分类 | 工具 |
| --- | --- |
| B | `get_import_export_credit`（只取 11 个顶层标量，排除海关资质数组） |
| X | `get_administrative_license`、`get_advertising_review`、`get_asset_auction`、`get_bidding_info`、`get_company_announcement`、`get_counterfeit_cosmetics`、`get_credit_commitments`、`get_credit_evaluation`、`get_entry_denied`、`get_financing_lease_info`、`get_financing_records`、`get_food_safety`、`get_game_approval`、`get_government_announcement`、`get_government_interview`、`get_honor_info`、`get_investment_institution`、`get_land_grant_info`、`get_land_transfer_info`、`get_news_sentiment`、`get_private_fund_manager`、`get_product_recall`、`get_product_spot_check`、`get_property_rights_transaction`、`get_qualifications`、`get_random_check`、`get_ranking_list_info`、`get_recruitment_info`、`get_related_announcement`、`get_software_violation`、`get_spot_check_info`、`get_taxpayer_qualification`、`get_tech_achievement`、`get_telecom_license` |

排除原因：对应许可、融资、招投标、荣誉、资质、招聘、新闻、土地、产品、信用评级等多条记录。`get_credit_evaluation` 虽有“种类数”标量，但主要评级仍是多类型、多年度列表；没有统一最新期合同前不开放。

### 6.5 历史存档 34

全部为 X：`get_historical_admin_license`、`get_historical_admin_penalty`、`get_historical_bankruptcy`、`get_historical_business_exception`、`get_historical_case_filing`、`get_historical_chattel_mortgage`、`get_historical_court_notice`、`get_historical_dishonest`、`get_historical_environmental_penalty`、`get_historical_equity_freeze`、`get_historical_equity_pledge`、`get_historical_executives`、`get_historical_hearing_notice`、`get_historical_high_consumption_ban`、`get_historical_honor`、`get_historical_internet_service`、`get_historical_investments`、`get_historical_ipr_pledge`、`get_historical_judgment_debtor`、`get_historical_judicial_docs`、`get_historical_land_mortgage`、`get_historical_legal_rep`、`get_historical_listing`、`get_historical_patent`、`get_historical_pre_litigation_mediation`、`get_historical_random_check`、`get_historical_registration`、`get_historical_serious_violation`、`get_historical_service_notice`、`get_historical_shareholders`、`get_historical_spot_check`、`get_historical_tax_arrears`、`get_historical_terminated_cases`、`get_historical_trademark`。

排除原因：数据天然是历史序列，并且部分能力需要企业认证账号。当前一企一行产品不自动选择某次历史状态。

### 6.6 董监高画像 44

全部为 X：`get_executive_admin_penalty`、`get_executive_beneficial_owner`、`get_executive_case_filing`、`get_executive_controlled_companies`、`get_executive_court_notice`、`get_executive_dishonest`、`get_executive_equity_freeze`、`get_executive_equity_pledge`、`get_executive_exit_restriction`、`get_executive_hearing_notice`、`get_executive_high_consumption_ban`、`get_executive_historical_admin_penalty`、`get_executive_historical_case_filing`、`get_executive_historical_court_notice`、`get_executive_historical_dishonest`、`get_executive_historical_equity_freeze`、`get_executive_historical_equity_pledge`、`get_executive_historical_hearing_notice`、`get_executive_historical_high_consumption_ban`、`get_executive_historical_investments`、`get_executive_historical_judgment_debtor`、`get_executive_historical_judicial_docs`、`get_executive_historical_legal_rep_roles`、`get_executive_historical_partners`、`get_executive_historical_positions`、`get_executive_historical_pre_litigation_mediation`、`get_executive_historical_related_companies`、`get_executive_historical_service_notice`、`get_executive_historical_terminated_cases`、`get_executive_investments`、`get_executive_judgment_debtor`、`get_executive_judicial_docs`、`get_executive_legal_rep_roles`、`get_executive_positions`、`get_executive_pre_litigation_mediation`、`get_executive_property_reward_notice`、`get_executive_related_companies`、`get_executive_related_risk_scan`、`get_executive_risk_scan`、`get_executive_service_notice`、`get_executive_stock_pledge`、`get_executive_tax_violation`、`get_executive_terminated_cases`、`get_executive_valuation_inquiry`。

排除原因：输入或输出粒度是自然人及其多个任职/投资/案件记录。一个企业可能有多名董监高，无法映射到企业主表唯一单元格。

## 7. UI 与 Host 对接规则

1. 字段选择界面只展示 Host 已实现且运行时已探测到来源工具的字段组。
2. 每个字段展示来源工具；`国标行业` 与 `企查查行业` 不合并、不互为兜底。
3. 先按工具对所选字段分组，再估算调用量：`唯一企业数 × 实际需要的工具数`；同工具多字段只算一次。
4. 选中字段但上游无值时保留空列，并记录字段级状态 `no_record`，不删除表头。
5. 工具未注册、无权、超时、配额不足分别记录状态，不把失败伪装为空值。
6. B 类字段变更必须保持：响应夹具、路径单测、空值单测、双企业真实 QCC E2E、XLSX 中文表头验收。
7. C 类字段开放前，必须另加：期次排序、同周期冲突、无法解析日期、缺期、跨主体类型测试。

## 8. 下一步实施顺序

1. 以 A+B 共 128 字段作为当前开发目录，并保持 UI、Host、XLSX 字段 ID 与中文表头一致；
2. 完成两企业真实 QCC 回归、双基线视觉验收与 0.7.0 发布门；
3. 冻结“最新年报/最新财务报告期”RFC 后再实现 C 类；
4. 一对多明细另立产品能力，不回填当前企业主表。

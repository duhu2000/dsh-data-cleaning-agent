/**
 * 数据清洗补全的一企一行字段目录。
 *
 * 这里只收录已核对 QCC MCP 一手实现、能够稳定投影为单个 Excel 单元格的字段。
 * 任何明细列表（电话全集、海关资质、风险关联方等）都不得进入本目录。
 */

const field = (id, label, options = {}) => Object.freeze({ id, label, ...options });
const group = (id, label, sourceTool, fields, options = {}) => Object.freeze({
  id,
  label,
  sourceTool,
  ...options,
  fields: Object.freeze(fields),
});

export const SELF_RISK_FACTORS = Object.freeze([
  ['dishonest', '失信信息'],
  ['judgment_debtor', '被执行人'],
  ['consumption_restriction', '限制高消费'],
  ['terminated_case', '终本案件'],
  ['judicial_document', '裁判文书'],
  ['case_filing', '立案信息'],
  ['hearing_announcement', '开庭公告'],
  ['court_announcement', '法院公告'],
  ['service_notice', '送达公告'],
  ['bankruptcy_reorganization', '破产重整'],
  ['equity_freeze', '股权冻结'],
  ['judicial_auction', '司法拍卖'],
  ['valuation_inquiry', '询价评估'],
  ['pre_litigation_mediation', '诉前调解'],
  ['exit_restriction', '限制出境'],
  ['administrative_penalty', '行政处罚'],
  ['operating_exception', '经营异常'],
  ['serious_violation', '严重违法'],
  ['environmental_penalty', '环保处罚'],
  ['abnormal_taxpayer', '税务非正常户'],
  ['tax_arrears', '欠税公告'],
  ['tax_violation', '税收违法'],
  ['disciplinary_list', '惩戒名单'],
  ['default_matter', '违约事项'],
  ['guarantee', '担保信息'],
  ['equity_pledge_registration', '股权出质'],
  ['stock_pledge', '股权质押'],
  ['chattel_mortgage', '动产抵押'],
  ['land_mortgage', '土地抵押'],
  ['simple_cancellation', '简易注销'],
  ['cancellation_filing', '注销备案'],
  ['liquidation', '清算信息'],
  ['labor_arbitration', '劳动仲裁'],
  ['public_notice', '公示催告'],
  ['property_reward_notice', '财产悬赏公告'],
].map(Object.freeze));

export const RELATED_RISK_FACTORS = Object.freeze([
  ['dishonest', '失信被执行人'],
  ['judgment_debtor', '被执行人'],
  ['consumption_restriction', '限制高消费'],
  ['serious_violation', '严重违法'],
  ['tax_violation', '税收违法'],
  ['administrative_penalty', '行政处罚'],
  ['bankruptcy_reorganization', '破产重整'],
  ['terminated_case', '终本案件'],
  ['equity_freeze', '股权冻结'],
  ['tax_arrears', '欠税公告'],
  ['operating_exception', '经营异常'],
].map(Object.freeze));

export const RELATED_RISK_KEY_FACTORS = Object.freeze([
  ['dishonest', '失信被执行人'],
  ['serious_violation', '严重违法'],
  ['bankruptcy_reorganization', '破产重整'],
  ['tax_violation', '税收违法'],
  ['judgment_debtor', '被执行人'],
  ['terminated_case', '终本案件'],
  ['equity_freeze', '股权冻结'],
].map(Object.freeze));

export const RISK_FACTOR_CATALOG_VERSION = 'qcc-risk-snapshot-2026-09-05';

export const QCC_FIELD_CATALOG = Object.freeze([
  group('company_registration', '企业工商信息', 'get_company_registration_info', [
    field('company_name', '企业名称', { inputAnchor: true, defaultSelected: true }),
    field('credit_no', '统一社会信用代码', { inputAnchor: true, defaultSelected: true }),
    field('reg_no', '注册号', { inputAnchor: true }),
    field('org_no', '组织机构代码'),
    field('tax_no', '纳税人识别号'),
    field('reg_status', '登记状态', { defaultSelected: true }),
    field('legal_rep', '法定代表人', { defaultSelected: true }),
    field('reg_capital', '注册资本', { defaultSelected: true }),
    field('paid_capital', '实缴资本'),
    field('establish_date', '成立日期', { defaultSelected: true }),
    field('company_type', '企业类型'),
    field('approval_date', '核准日期'),
    field('registration_authority', '登记机关'),
    field('taxpayer_qualification', '纳税人资质'),
    field('payment_line_no', '支付系统行号'),
    field('import_export_company_code', '进出口企业代码'),
    field('short_name', '企业简称'),
    field('english_name', '英文名'),
    field('registered_address', '注册地址', { defaultSelected: true }),
    field('mailing_address', '通信地址'),
    field('region', '所属地区', { matchAuxiliary: true }),
    field('business_scope', '经营范围'),
    field('industry_category', '国标行业'),
    field('operating_period', '营业期限'),
    field('company_size', '人员规模'),
    field('insured_count', '参保人数'),
    field('branch_insured_count', '分支机构参保人数'),
  ], { releaseBatch: 'current' }),
  group('company_profile', '企业简介', 'get_company_profile', [
    field('qcc_industry', '企查查行业'),
    field('company_profile', '企业简介'),
    field('industry_chain_overview', '产业链概览'),
  ], { releaseBatch: 'current' }),
  group('contact_info', '联系方式', 'get_contact_info', [
    field('contact_preferred_phone', '首选联系电话'),
    field('contact_phone_invalid_flag', '首选电话无效标记'),
    field('contact_phone_tags', '首选电话标签'),
    field('contact_preferred_email', '首选邮箱'),
    field('contact_official_website', '官方网站'),
    field('contact_official_website_icp', '官网 ICP 备案'),
  ], { releaseBatch: 'batch-1' }),
  group('listing_info', '上市信息', 'get_listing_info', [
    field('listing_date', '上市日期'),
    field('listing_short_name', '股票简称'),
    field('listing_stock_code', '股票代码'),
    field('listing_exchange', '上市交易所'),
    field('listing_board', '上市板块'),
    field('listing_former_short_name', '上市曾用名'),
    field('listing_total_market_value', '总市值'),
    field('listing_total_shares', '总股本'),
    field('listing_predicted_pe', '预测市盈率'),
    field('listing_float_market_value', '流通值'),
    field('listing_float_shares', '流通股'),
    field('listing_pb_ratio', '市净率'),
    field('listing_eps', 'EPS'),
    field('listing_voting_rights_difference', '表决权差异'),
    field('listing_registration_based', '是否注册制'),
  ], { releaseBatch: 'batch-1', selectionNote: '首个 A 股或红筹证券快照' }),
  group('tax_invoice_info', '税务开票信息', 'get_tax_invoice_info', [
    field('tax_company_name', '税务主体名称'),
    field('tax_identification_no', '税务纳税人识别号'),
    field('tax_company_type', '税务企业类型'),
    field('tax_business_status', '税务经营状态'),
    field('invoice_address', '开票地址'),
    field('invoice_phone', '开票联系电话'),
    field('invoice_bank', '开户行'),
    field('invoice_bank_account', '开户行账号'),
  ], { releaseBatch: 'batch-1' }),
  group('import_export_credit', '进出口信用', 'get_import_export_credit', [
    field('import_export_credit_no', '进出口统一社会信用代码'),
    field('import_export_customs', '所在地海关'),
    field('import_export_admin_division', '进出口行政区划'),
    field('import_export_address', '进出口备案地址'),
    field('import_export_economic_area', '经济区划'),
    field('import_export_trade_type', '经营类别'),
    field('import_export_statistical_economic_area', '统计经济区划'),
    field('import_export_industry', '进出口行业种类'),
    field('import_export_ecommerce_type', '跨境贸易电子商务类型'),
    field('import_export_credit_grade', '海关信用等级'),
    field('import_export_filing_date', '进出口备案日期'),
  ], { releaseBatch: 'batch-1' }),
  group('company_risk_scan', '企业自身风险扫描', 'get_company_risk_scan', [
    field('risk_recorded_factor_count', '风险有记录因子数'),
    field('risk_no_record_factor_count', '风险无记录因子数'),
    field('risk_hit_summary', '企业自身风险命中摘要'),
    ...SELF_RISK_FACTORS.map(([id, label]) => field(`risk_${id}_count`, `${label}条目数`)),
  ], { releaseBatch: 'batch-2', catalogVersion: RISK_FACTOR_CATALOG_VERSION }),
  group('company_related_risk_scan', '企业关联风险扫描', 'get_company_related_risk_scan', [
    field('related_risk_party_count', '有风险关联方数'),
    field('related_risk_summary', '企业关联风险摘要'),
    ...RELATED_RISK_FACTORS.map(([id, label]) => field(`related_risk_${id}_count`, `关联风险-${label}条目数`)),
    ...RELATED_RISK_KEY_FACTORS.map(([id, label]) => field(`related_risk_${id}_party_count`, `关联风险-${label}命中关联方数`)),
  ], { releaseBatch: 'batch-2', catalogVersion: RISK_FACTOR_CATALOG_VERSION }),
]);

export const QCC_FIELD_SOURCE_TOOL = Object.freeze(Object.fromEntries(
  QCC_FIELD_CATALOG.flatMap((entry) => entry.fields.map((item) => [item.id, entry.sourceTool])),
));

export function selectedSourceTools(fieldSelection, fallbackFields = []) {
  const fields = Array.isArray(fieldSelection) && fieldSelection.length ? fieldSelection : fallbackFields;
  return [...new Set(fields.map((id) => QCC_FIELD_SOURCE_TOOL[String(id)]).filter(Boolean))];
}

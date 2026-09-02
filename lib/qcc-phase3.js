/**
 * QCC 0.5.0 三期工具契约：风险 / 知产 / 经营 三大域。
 *
 * 工具名与分类来源：一手注册表 mcp_web/packages/shared/src/lib/tool-category.js
 * （185 工具 = 工商 16 + 风险 38 + 知产 18 + 经营 35 + 历史 34 + 董监高 44），
 * 并经过真实 ToolRuntime preflight（本机 QCC MCP 六端点 streamable-http）核对。
 *
 * 契约只固化四类事实，不固化上游响应字段：
 *   1. 精确工具名（canonical `mcp__qcc-<domain>__<name>`）与 legacy 运行时名映射；
 *   2. 必需输入 schema（除 get_judicial_document_detail 需 searchKey+documentId 外，全部仅需 searchKey）；
 *   3. 权限（三域均为 basic 基础授权，区别于 history 的企业认证）；
 *   4. 付费语义（三域均为按次计费，调用前须确认）。
 *
 * 方案 A 延续：模型中介解读工具返回，必须保留原值；本模块不固化上游响应字段。
 */

import { qccToolRuntimeCandidates } from './qcc-phase2.js';

const riskTool = (name) => `mcp__qcc-risk__${name}`;
const iprTool = (name) => `mcp__qcc-ipr__${name}`;
const operationTool = (name) => `mcp__qcc-operation__${name}`;

// canonical↔legacy 映射复用二期单一实现（覆盖全部六域），避免双份漂移。
export { qccToolRuntimeCandidates };

/**
 * 三大域的权限与付费语义。0.5.0 只覆盖基础授权域；
 * history 域的企业认证语义在 0.6.0 引入，不在此表。
 */
export const QCC_PHASE3_DOMAIN_META = Object.freeze({
  risk: Object.freeze({
    label: '风险信息',
    access: 'basic',
    paid: true,
    requiresConfirmation: true,
  }),
  ipr: Object.freeze({
    label: '知识产权',
    access: 'basic',
    paid: true,
    requiresConfirmation: true,
  }),
  operation: Object.freeze({
    label: '经营信息',
    access: 'basic',
    paid: true,
    requiresConfirmation: true,
  }),
});

/** 精确工具名（短名，按字母序，与 tool-category.js TOOLS_BY_CATEGORY 一一对应）。 */
export const QCC_PHASE3_TOOL_NAMES = Object.freeze({
  // 风险信息 · 38 个
  risk: Object.freeze([
    'get_administrative_penalty',
    'get_bankruptcy_reorganization',
    'get_business_exception',
    'get_cancellation_record_info',
    'get_case_filing_info',
    'get_chattel_mortgage_info',
    'get_company_related_risk_scan',
    'get_company_risk_scan',
    'get_court_notice',
    'get_default_info',
    'get_disciplinary_list',
    'get_dishonest_info',
    'get_environmental_penalty',
    'get_equity_freeze',
    'get_equity_pledge_info',
    'get_exit_restriction',
    'get_guarantee_info',
    'get_hearing_notice',
    'get_high_consumption_restriction',
    'get_judgment_debtor_info',
    'get_judicial_auction',
    'get_judicial_document_detail',
    'get_judicial_documents',
    'get_land_mortgage_info',
    'get_liquidation_info',
    'get_pre_litigation_mediation',
    'get_property_asset_announcement',
    'get_public_exhortation',
    'get_serious_violation',
    'get_service_announcement',
    'get_service_notice',
    'get_simple_cancellation_info',
    'get_stock_pledge_info',
    'get_tax_abnormal',
    'get_tax_arrears_notice',
    'get_tax_violation',
    'get_terminated_cases',
    'get_valuation_inquiry',
  ]),
  // 知识产权 · 18 个
  ipr: Object.freeze([
    'get_app_info',
    'get_commercial_franchise',
    'get_copyright_work_info',
    'get_douyin_account',
    'get_integrated_circuit_layout',
    'get_international_patent',
    'get_internet_service_info',
    'get_ipr_pledge',
    'get_kuaishou_account',
    'get_mini_program',
    'get_online_store',
    'get_patent_info',
    'get_software_copyright_info',
    'get_standard_info',
    'get_trademark_document',
    'get_trademark_info',
    'get_wechat_official_account',
    'get_weibo_account',
  ]),
  // 经营信息 · 35 个
  operation: Object.freeze([
    'get_administrative_license',
    'get_advertising_review',
    'get_asset_auction',
    'get_bidding_info',
    'get_company_announcement',
    'get_counterfeit_cosmetics',
    'get_credit_commitments',
    'get_credit_evaluation',
    'get_entry_denied',
    'get_financing_lease_info',
    'get_financing_records',
    'get_food_safety',
    'get_game_approval',
    'get_government_announcement',
    'get_government_interview',
    'get_honor_info',
    'get_import_export_credit',
    'get_investment_institution',
    'get_land_grant_info',
    'get_land_transfer_info',
    'get_news_sentiment',
    'get_private_fund_manager',
    'get_product_recall',
    'get_product_spot_check',
    'get_property_rights_transaction',
    'get_qualifications',
    'get_random_check',
    'get_ranking_list_info',
    'get_recruitment_info',
    'get_related_announcement',
    'get_software_violation',
    'get_spot_check_info',
    'get_taxpayer_qualification',
    'get_tech_achievement',
    'get_telecom_license',
  ]),
});

/** 规范名构造：短名 → `mcp__qcc-<domain>__<name>`。 */
export function canonicalPhase3ToolName(domain, name) {
  if (domain === 'risk') return riskTool(name);
  if (domain === 'ipr') return iprTool(name);
  if (domain === 'operation') return operationTool(name);
  throw new RangeError(`Unknown QCC phase-3 domain: ${domain}`);
}

/** 全量规范名（risk+ipr+operation，91 个），用于迭代与预检。 */
export const QCC_PHASE3_ALL_CANONICAL_TOOLS = Object.freeze(
  Object.entries(QCC_PHASE3_TOOL_NAMES).flatMap(([domain, names]) =>
    names.map((name) => canonicalPhase3ToolName(domain, name)),
  ),
);

/**
 * 必需输入参数（required 键，按工具短名）。
 * 契约事实：三域 91 个工具里，90 个仅需 `searchKey`（企业名称或统一社会信用代码）；
 * 唯一例外 get_judicial_document_detail（风险·裁判文书详情）额外要求 `documentId`。
 * 其余输入均为可选项（分页游标 / 年份 / 角色 / 状态 / 日期过滤等），不在必需契约内。
 */
export const QCC_PHASE3_REQUIRED_INPUTS = Object.freeze({
  'get_judicial_document_detail': Object.freeze(['searchKey', 'documentId']),
});

export const QCC_PHASE3_DEFAULT_REQUIRED_INPUTS = Object.freeze(['searchKey']);

/** 返回某工具的必需输入键（规范名或短名均可）。 */
export function requiredInputsFor(toolName) {
  const name = String(toolName ?? '').split('__').at(-1) ?? '';
  return QCC_PHASE3_REQUIRED_INPUTS[name] ?? QCC_PHASE3_DEFAULT_REQUIRED_INPUTS;
}

const PHASE3_SHORT_NAMES = new Set(
  Object.values(QCC_PHASE3_TOOL_NAMES).flat(),
);

/** 判断一个规范名/legacy 名/短名是否属于 0.5.0 三大域契约。 */
export function isPhase3Tool(toolName) {
  const name = String(toolName ?? '');
  const short = name.split('__').at(-1) ?? '';
  return PHASE3_SHORT_NAMES.has(short);
}

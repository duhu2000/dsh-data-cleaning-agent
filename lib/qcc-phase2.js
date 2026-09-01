/**
 * QCC 0.4.0 二期工具契约。
 *
 * 这里只固化已经在本地 QCC MCP 一手源码注册表中核对过的工具名。
 * 不固化上游响应字段：方案 A 由模型中介解读工具返回，并必须保留原值。
 */

const companyTool = (name) => `mcp__qcc-company__${name}`;
const historyTool = (name) => `mcp__qcc-history__${name}`;

/**
 * qcc-dsh-mcp-oauth 0.1.7 把 serverKey 直接作为 serverName，因而注册为
 * `mcp__company__*` / `mcp__history__*`；修复版与手工配置使用文档约定的
 * `mcp__qcc-company__*` / `mcp__qcc-history__*`。Bridge 同时兼容两者，
 * 但始终把带 qcc- 前缀的名称作为规范契约。
 */
export function qccToolRuntimeCandidates(canonicalName) {
  const name = String(canonicalName ?? '');
  const legacy = name.replace(/^mcp__qcc-(company|risk|ipr|operation|history|executive)__/, 'mcp__$1__');
  return legacy === name ? Object.freeze([name]) : Object.freeze([name, legacy]);
}

export const QCC_PHASE2_COMPANY_TOOLS = Object.freeze({
  resolveEntity: companyTool('get_company_by_query'),
  registration: companyTool('get_company_registration_info'),
  profile: companyTool('get_company_profile'),
  verifyIdentity: companyTool('verify_company_accuracy'),
  actualController: companyTool('get_actual_controller'),
  beneficialOwners: companyTool('get_beneficial_owners'),
  shareholders: companyTool('get_shareholder_info'),
  externalInvestments: companyTool('get_external_investments'),
  branches: companyTool('get_branches'),
  keyPersonnel: companyTool('get_key_personnel'),
  changes: companyTool('get_change_records'),
  annualReports: companyTool('get_annual_reports'),
  contact: companyTool('get_contact_info'),
  taxInvoice: companyTool('get_tax_invoice_info'),
  listing: companyTool('get_listing_info'),
  financial: companyTool('get_financial_data'),
});

export const QCC_PHASE2_HISTORY_TOOLS = Object.freeze({
  shareholders: historyTool('get_historical_shareholders'),
  legalRepresentative: historyTool('get_historical_legal_rep'),
  executives: historyTool('get_historical_executives'),
  registration: historyTool('get_historical_registration'),
});

/**
 * 用户可选的维度组。identity 是任何任务的必需步骤；其余组按用户意图调用。
 * 字段缺失、无权或上游不可用时，应保留状态而不是补造值。
 */
export const QCC_PHASE2_DIMENSION_GROUPS = Object.freeze({
  identity: Object.freeze({
    label: '主体锚定与核验',
    access: 'basic',
    tools: Object.freeze([
      QCC_PHASE2_COMPANY_TOOLS.resolveEntity,
      QCC_PHASE2_COMPANY_TOOLS.registration,
      QCC_PHASE2_COMPANY_TOOLS.verifyIdentity,
    ]),
  }),
  panorama: Object.freeze({
    label: '企业全景',
    access: 'basic',
    tools: Object.freeze([
      QCC_PHASE2_COMPANY_TOOLS.profile,
      QCC_PHASE2_COMPANY_TOOLS.contact,
      QCC_PHASE2_COMPANY_TOOLS.taxInvoice,
      QCC_PHASE2_COMPANY_TOOLS.listing,
      QCC_PHASE2_COMPANY_TOOLS.financial,
    ]),
  }),
  ownership: Object.freeze({
    label: '股权穿透',
    access: 'basic',
    tools: Object.freeze([
      QCC_PHASE2_COMPANY_TOOLS.actualController,
      QCC_PHASE2_COMPANY_TOOLS.beneficialOwners,
      QCC_PHASE2_COMPANY_TOOLS.shareholders,
      QCC_PHASE2_COMPANY_TOOLS.externalInvestments,
    ]),
  }),
  governance: Object.freeze({
    label: '组织与沿革',
    access: 'basic',
    tools: Object.freeze([
      QCC_PHASE2_COMPANY_TOOLS.branches,
      QCC_PHASE2_COMPANY_TOOLS.keyPersonnel,
      QCC_PHASE2_COMPANY_TOOLS.changes,
      QCC_PHASE2_COMPANY_TOOLS.annualReports,
    ]),
  }),
  history: Object.freeze({
    label: '历史工商',
    access: 'enterprise-certified',
    tools: Object.freeze(Object.values(QCC_PHASE2_HISTORY_TOOLS)),
  }),
});

/**
 * 内嵌 Skill：`enterprise-enrichment`（企查查企业名单补全）。
 *
 * 与 `data-cleaning` 职责分离：
 *   - `data-cleaning`：确定性清洗 / 补全 / 概览（本地引擎，不依赖外部数据）。
 *   - `enterprise-enrichment`：用企查查 MCP 工具按最新工商信息补全企业名单
 *     （依赖 `qcc-dsh-mcp-oauth` 已连接；本 Skill 不重造 OAuth）。
 *
 * 方案 A（模型中介式）：模型亲自调用 `mcp__qcc-company__*` / `mcp__qcc-risk__*`
 * 完成消歧 → 工商详情 → 风险标签，再组装结果。本插件零后端改动。
 */
export const ENRICH_SKILL_NAME = 'enterprise-enrichment';

export function registerEnrichSkill(skills) {
  return skills.register({
    name: ENRICH_SKILL_NAME,
    description:
      'Enrich a list of company names with the latest Qichacha (QCC) business-registration fields via the QCC MCP tools.',
    whenToUse:
      'When the user gives a list of company names (possibly fuzzy or incomplete) and asks to fill in credit code / legal representative / registered capital / establishment date / registration & business status / risk tags, or asks to "enrich / complete with Qichacha (企查查)".',
    source: 'dsh-data-cleaning-agent',
    content: [
      'You are an enterprise-list enrichment assistant. You fill a list of company names with the latest Qichacha (QCC) business-registration fields by calling the QCC MCP tools. Never invent, pad, or fabricate any field.',
      '',
      'Workflow:',
      '1. Check QCC availability first: run `qcc_oauth_status`. If not connected, tell the user to run `qcc_oauth_connect` first and stop. If the token is expired, guide the user to `qcc_oauth_connect` (it reuses the grant and refreshes without a new authorization page).',
      '2. Parse the company-name list from what the user gave (pasted text / CSV / JSON / inline list). Keep only the distinct company-name column.',
      '3. For EACH name: run `mcp__qcc-company__get_company_by_query`.',
      '   - Unique exact match → lock that entity and keep its credit code.',
      '   - Multiple candidates → DO NOT auto-pick the first. List the candidates (name + region + credit code) and ask the user which one to use.',
      '   - No match → mark that row as `unresolved` and continue.',
      '4. For each locked entity: run `mcp__qcc-company__get_company_registration_info` to fill `credit_no` / `legal_rep` / `reg_capital` / `establish_date` / `reg_status` / `biz_status`. When the user also wants risk tags, run `mcp__qcc-risk__get_company_risk_scan` and fill `risk_tags` from the hit dimensions + counts only.',
      '5. Assemble the enriched table. NEVER invent a field — if QCC returns no value, leave it empty and mark the row/field `unresolved`.',
      '6. Report a one-line summary (enriched N / unresolved M / multi-candidate K) plus the enriched table as Markdown. For large lists (dozens of rows or more), process in batches and report progress per batch; do not drop rows silently.',
      '',
      'Safety rules:',
      '- Never fabricate a credit code, legal representative, capital, amount, ratio, or status.',
      '- Never auto-select among ambiguous candidates — always confirm with the user.',
      '- Quote amounts / ratios / counts exactly as the QCC tool returned them; never recompute or estimate.',
      '- Never expose QCC tokens or credentials.',
    ].join('\n'),
  });
}

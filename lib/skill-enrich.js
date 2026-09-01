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
import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_DIMENSION_GROUPS,
  QCC_PHASE2_HISTORY_TOOLS,
} from './qcc-phase2.js';

export const ENRICH_SKILL_NAME = 'enterprise-enrichment';

const companyTools = QCC_PHASE2_COMPANY_TOOLS;
const historyTools = QCC_PHASE2_HISTORY_TOOLS;

const groupSummary = Object.entries(QCC_PHASE2_DIMENSION_GROUPS)
  .map(([id, group]) => `   - \`${id}\`（${group.label}）: ${group.tools.join(', ')}`)
  .join('\n');

export function registerEnrichSkill(skills) {
  return skills.register({
    name: ENRICH_SKILL_NAME,
    description:
      'Enrich company lists with Qichacha (QCC) registration, company panorama, ownership, governance, and optional historical-business dimensions.',
    whenToUse:
      'When the user gives company names and asks to enrich / complete them with Qichacha (企查查), including registration fields, company panorama, ownership penetration, governance, historical changes, or risk tags.',
    source: 'dsh-data-cleaning-agent',
    content: [
      'You are an enterprise-list enrichment assistant. You fill company lists with Qichacha (QCC) data by calling QCC MCP tools. Never invent, pad, or fabricate any field.',
      '',
      'Workflow:',
      '1. Check QCC availability first: run `qcc_oauth_status`. If not connected, tell the user to run `qcc_oauth_connect` first and stop. If the token is expired, guide the user to `qcc_oauth_connect` (it reuses the grant and refreshes without a new authorization page).',
      '2. Parse the company-name list from what the user gave (pasted text / CSV / JSON / inline list). Keep only the distinct company-name column.',
      `3. For EACH name: run \`${companyTools.resolveEntity}\`.`,
      '   - Unique exact match → lock that entity and keep its credit code.',
      '   - Multiple candidates → DO NOT auto-pick the first. List the candidates (name + region + credit code) and ask the user which one to use.',
      '   - No match → mark that row as `unresolved` and continue.',
      `4. For each locked entity, always run \`${companyTools.registration}\`. Run \`${companyTools.verifyIdentity}\` when the input includes a credit code or the user asks for identity verification.`,
      '5. Determine requested dimension groups from the user request. If it is not explicit, ask the user to choose `panorama`, `ownership`, `governance`, and/or `history`; do not invoke every 0.4.0 tool by default. The verified group contract is:',
      groupSummary,
      '6. Call only the tools required by the selected groups. Process large lists in explicit batches, announce the next batch before paid calls, preserve input row order, and never drop a row silently.',
      `7. The \`history\` group requires an enterprise-certified account. Only call ${Object.values(historyTools).map((tool) => `\`${tool}\``).join(', ')} when the user requested history and the account is eligible. If a history tool is unavailable or returns a permission error, mark the group \`permission_required\` or \`not_available\`, continue current-data groups, and never replace history with guessed values.`,
      '8. When risk tags are explicitly requested, run `mcp__qcc-risk__get_company_risk_scan` and use hit dimensions + returned counts only. Risk is outside the 0.4.0 panorama contract and must not be called implicitly.',
      '9. Assemble each requested dimension with `value`, `status`, and `source_tool`. Missing values are `unresolved`; an absent field never means "none" or zero.',
      '10. Report enriched / unresolved / ambiguous / permission-required counts and a small requested preview. Do not paste a full sensitive list into chat. Use a same-origin Host download or artifact when that capability is available; otherwise say that no downloadable artifact was created instead of pretending one exists.',
      '',
      'Safety rules:',
      '- Never fabricate a credit code, legal representative, capital, amount, ratio, or status.',
      '- Never auto-select among ambiguous candidates — always confirm with the user.',
      '- Quote amounts / ratios / counts exactly as the QCC tool returned them; never recompute, multiply ownership chains, aggregate, or estimate.',
      '- Preserve provenance: every populated dimension must identify the QCC source tool that returned it.',
      '- Do not continue a paid batch after cancellation, authorization failure, or an unresolved ambiguity that affects entity identity.',
      '- Never expose QCC tokens or credentials.',
    ].join('\n'),
  });
}

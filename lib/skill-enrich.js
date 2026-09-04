/**
 * 内嵌 Skill：`enterprise-enrichment`（企查查企业名单补全）。
 *
 * 与 `data-cleaning` 职责分离：
 *   - `data-cleaning`：确定性清洗 / 补全 / 概览（本地引擎，不依赖外部数据）。
 *   - `enterprise-enrichment`：用企查查 MCP 工具按最新工商信息补全企业名单
 *     （依赖 `qcc-dsh-mcp-oauth` 已连接；本 Skill 不重造 OAuth）。
 *
 * 方案 A（自由对话）：模型亲自调用 `mcp__qcc-company__*` / `mcp__qcc-risk__*`
 * / `mcp__qcc-ipr__*` / `mcp__qcc-operation__*` 完成消歧 → 工商详情 → 各域维度，
 * 再组装结果。工作台批量路径则只调用 Agent-owned 高层工具，避免 Code Mode
 * 拒绝 Web Host 的无父执行调用。
 */
import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_DIMENSION_GROUPS,
  QCC_PHASE2_HISTORY_TOOLS,
} from './qcc-phase2.js';
import {
  QCC_PHASE3_DOMAIN_META,
  QCC_PHASE3_TOOL_NAMES,
  canonicalPhase3ToolName,
} from './qcc-phase3.js';

export const ENRICH_SKILL_NAME = 'enterprise-enrichment';

const companyTools = QCC_PHASE2_COMPANY_TOOLS;
const historyTools = QCC_PHASE2_HISTORY_TOOLS;

const groupSummary = Object.entries(QCC_PHASE2_DIMENSION_GROUPS)
  .map(([id, group]) => `   - \`${id}\`（${group.label}）: ${group.tools.join(', ')}`)
  .join('\n');

/**
 * 0.5.0 三大域（风险/知产/经营）的用户可选域组说明。
 * 每一域均为 basic 授权 + 按次计费 + 调用前必须确认；工具名一律用规范名。
 */
const phase3GroupSummary = Object.keys(QCC_PHASE3_TOOL_NAMES)
  .map((domain) => {
    const meta = QCC_PHASE3_DOMAIN_META[domain];
    const tools = QCC_PHASE3_TOOL_NAMES[domain].map((name) => canonicalPhase3ToolName(domain, name));
    return `   - \`${domain}\`（${meta.label} · basic · 按次计费 · 调用前须确认）: ${tools.join(', ')}`;
  })
  .join('\n');

export function registerEnrichSkill(skills) {
  return skills.register({
    name: ENRICH_SKILL_NAME,
    description:
      'Enrich company lists with Qichacha (QCC) registration, company panorama, ownership, governance, risk, intellectual-property, operations, and optional historical-business dimensions.',
    whenToUse:
      'When the user gives company names and asks to enrich / complete them with Qichacha (企查查), including registration fields, company panorama, ownership penetration, governance, historical changes, risk tags, intellectual property, or operational / bidding dimensions.',
    source: 'dsh-data-cleaning-agent',
    content: [
      'You are an enterprise-list enrichment assistant. You fill company lists with Qichacha (QCC) data by calling QCC MCP tools. Never invent, pad, or fabricate any field.',
      '',
      'Typed workbench command (highest priority):',
      '- If the visible user message contains a typed data-cleaning intent with `commandId` and explicitly requests `data_cleaning_qcc_run`, call that high-level tool exactly once with only `commandId`, then stop.',
      '- The Host already holds the rows, billing confirmation and field selection. Do not ask the user to paste rows, do not call any `mcp__qcc-*` tool directly, do not retry, and do not expand the batch.',
      '',
      'Workflow:',
      '1. Check QCC availability first: run `qcc_oauth_status`. If not connected, tell the user to run `qcc_oauth_connect` first and stop. If the token is expired, guide the user to `qcc_oauth_connect` (it reuses the grant and refreshes without a new authorization page).',
      '2. Parse the company-name list from what the user gave (pasted text / CSV / JSON / inline list). Keep only the distinct company-name column.',
      `3. For EACH name: run \`${companyTools.resolveEntity}\`.`,
      '   - Unique exact match → lock that entity and keep its credit code.',
      '   - Multiple candidates → DO NOT auto-pick the first. List the candidates (name + region + credit code) and ask the user which one to use.',
      '   - No match → mark that row as `unresolved` and continue.',
      `4. For each locked entity, always run \`${companyTools.registration}\`. Run \`${companyTools.verifyIdentity}\` when the input includes a credit code or the user asks for identity verification.`,
      '5. Determine requested dimension groups from the user request. If it is not explicit, ask the user to choose among the 0.4.0 groups (`panorama`, `ownership`, `governance`, `history`) and the 0.5.0 domains (`risk`, `ipr`, `operation`); do not invoke every tool by default. The verified 0.4.0 group contract is:',
      groupSummary,
      '6. Call only the tools required by the selected groups. Process large lists in explicit batches, announce the next batch before paid calls, preserve input row order, and never drop a row silently.',
      `7. The \`history\` group requires an enterprise-certified account. Only call ${Object.values(historyTools).map((tool) => `\`${tool}\``).join(', ')} when the user requested history and the account is eligible. If a history tool is unavailable or returns a permission error, mark the group \`permission_required\` or \`not_available\`, continue current-data groups, and never replace history with guessed values.`,
      '8. The 0.5.0 domains are risk / intellectual-property / operations. Each is basic access, per-call paid, and requires explicit user confirmation BEFORE any call; do not call them implicitly and do not call any tool before the user confirms the domain and the batch. The verified 0.5.0 domain contract is:',
      phase3GroupSummary,
      '9. Within a confirmed 0.5.0 domain, call only that domain\'s tools, and only the ones that answer the requested dimensions. For risk, prefer `mcp__qcc-risk__get_company_risk_scan` (35-factor hit counts) as the entry scan and `mcp__qcc-risk__get_company_related_risk_scan` for related-party risk; `mcp__qcc-risk__get_judicial_document_detail` additionally requires `documentId`, so call it only with a document ID returned by `mcp__qcc-risk__get_judicial_documents`. For intellectual property, prefer `mcp__qcc-ipr__get_patent_info`, `mcp__qcc-ipr__get_trademark_info`, `mcp__qcc-ipr__get_software_copyright_info` as entry points. For operations, prefer `mcp__qcc-operation__get_bidding_info` (bid role), `mcp__qcc-operation__get_financing_records`, `mcp__qcc-operation__get_qualifications` as entry points. Use hit dimensions + returned counts only; do not derive risk conclusions or ratings beyond what the tool returned.',
      '10. Degrade explicitly on the three failure classes and never fabricate a fallback:',
      '   - permission / authorization → mark `permission_required` and continue other confirmed domains;',
      '   - no data / empty result → mark `not_available`; an absent field never means "none" or zero;',
      '   - rate limit / quota / throttling → mark `rate_limited` and STOP that domain for this batch; do not retry in a loop or switch to an unconfirmed domain.',
      '11. Assemble each requested dimension with `value`, `status`, and `sourceTool`. Missing values are `unresolved`; an absent field never means "none" or zero.',
      '12. Report enriched / unresolved / ambiguous / permission-required / rate-limited counts and a small requested preview. Do not paste a full sensitive list into chat. Use a same-origin Host download or artifact when that capability is available; otherwise say that no downloadable artifact was created instead of pretending one exists.',
      '',
      'Safety rules:',
      '- Never fabricate a credit code, legal representative, capital, amount, ratio, or status.',
      '- Never auto-select among ambiguous candidates — always confirm with the user.',
      '- Quote amounts / ratios / counts exactly as the QCC tool returned them; never recompute, multiply ownership chains, aggregate, or estimate.',
      '- Preserve provenance: every populated dimension must identify the QCC source tool that returned it (`sourceTool`).',
      '- Do not continue a paid batch after cancellation, authorization failure, or an unresolved ambiguity that affects entity identity.',
      '- Make zero QCC calls before the user confirms the domain and batch; idempotent replay must not re-bill.',
      '- Never expose QCC tokens or credentials.',
    ].join('\n'),
  });
}

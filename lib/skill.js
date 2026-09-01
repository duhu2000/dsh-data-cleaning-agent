/**
 * 内嵌 Skill：`data-cleaning`。
 * 正文只描述工作流，把「工具选择」交给模型；安全约束：绝不回传原始行、绝不编造数据。
 */
import { TOOL_CLEAN, TOOL_COMPLETE, TOOL_PROFILE } from './tools.js';

export const SKILL_NAME = 'data-cleaning';

export function registerSkill(skills) {
  return skills.register({
    name: SKILL_NAME,
    description:
      'Clean, complete, and profile a batch of raw tabular data rows (name / phone / amount and similar columns).',
    whenToUse:
      'When the user asks to clean, complete, validate, de-duplicate, or summarize a batch of raw data rows, CSV records, or table-like data.',
    source: 'dsh-data-cleaning-agent',
    content: [
      'You are a data cleaning and completion assistant. Work only on the rows the user actually provided; never invent, pad, or fabricate extra rows.',
      '',
      'Workflow:',
      `1. (Optional) Run \`${TOOL_PROFILE}\` on the batch to understand columns and amount distribution.`,
      `2. Run \`${TOOL_CLEAN}\` to trim, normalize phone, drop rows with missing required fields, drop non-numeric/negative amounts, and de-duplicate.`,
      `3. If the user also asks to fill gaps, run \`${TOOL_COMPLETE}\` on the kept rows: it fills empty amount with 0 and empty name with a placeholder, and reports anything it cannot deterministically complete.`,
      '4. Report only the returned summaries (total / kept / dropped / incomplete). Never echo raw rows or full detail rows back to the user.',
      '',
      'Safety rules:',
      '- Never return raw input rows or the full cleaned/completed rows in your reply — summaries only.',
      '- Never invent a phone number, name, or amount. If a value cannot be derived deterministically, say it is incomplete.',
      '',
    ].join('\n'),
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectLegacy } from './helpers/legacy-characterization.mjs';
import { ACTUAL_CONTROLLER_GROUP, SNAPSHOT_GROUPS } from 'qcc-field-contracts';

test('v0.8.2 golden: duplicate-header/backfill fixes audited; other behavior unchanged', async () => {
  const golden = JSON.parse(await readFile(new URL('./fixtures/legacy-v082.golden.json', import.meta.url)));
  assert.equal(golden.cases.length, 24);
  // Preserve the original golden file. This intentional bug fix must retain both
  // source cells instead of reproducing the v0.8.2 last-column-wins data loss.
  const duplicate = golden.cases.find((item) => item.id === 'csv-10');
  assert.equal(duplicate.input, 'A,A\nx,y');
  duplicate.expected = { headers: ['A', 'A（重复列 2）'], rows: [{ A: 'x', 'A（重复列 2）': 'y' }] };
  // Audited source changes: pass confirmed mappings, project empty-cell backfill,
  // preserve nonempty canonical input keys. Other source hashes remain frozen.
  Object.assign(golden.contract.unchanged, {
    // v0.9.8 immutable origin guards are preserved alongside narrow workflow
    // delivery/retry mutations; no generic transition API is introduced.
    'lib/workflow.js': 'b9a0c09c9a57679c903ac8b4807fd1047077d53a79f4c1b783645cd886e5d92b',
    // UX49: input sufficiency clarification precedes every business tool (including OAuth).
    'lib/skill-enrich.js': '2b7e3fe13e741280d33e18c88d9957503d651f303a26fc424e1793dbca49bc34',
    'lib/skill.js': '563d352d106d4ece144b5600b86a4c652d40e0de0ccd97b36d3ed513b3541976',
    // The versioned Host projection defines stage access and allowed actions,
    // while origin metadata stays immutable and identity anchors stay unique.
    'lib/workflow-contract.js': 'ffee0ef6b7e6e97bd12b14f30e01e21b955c1a9b8018cfaa7764ee773c898b08',
    // v0.8.14: draft-only staging drops billing checkbox; execution/legacy gates remain.
    // Workflow routes enforce source ownership and Host action permissions;
    // refresh cache verification is read-only, while delivery still commits after artifacts persist.
    'lib/web.js': 'f5ee2a69dfd4dcb0252df21f8b8932bd59679ff44533b900a39683f798550256',
    // v0.8.20: normal absence notes are separate from actionable field issues.
    'lib/artifacts.js': '0ce08d0fba95d4c46b017caa3a7d4773482fa9f4397fd3ae2a592bca48d78e49',
    // Planning is shared by draft preflight and execution; all 24 output cases unchanged.
    // Failed rows now retain normalized error identifiers for exception exports.
    'lib/qcc.js': '1a74b7288d94b2d446e7f25353aa820dfa2d9cb65971cb13f78348761bcb8769',
    'lib/qcc-safety.js': '57267a973ea369ca1ea0affd831bfccf334123054b31cac18a85803d3399fb68',
    'lib/qcc-field-catalog.js': '7055dd390c40e8e3b5090d5122770c57485225b32f8ae8f010cd3246d287aaf3',
  });
  // Audited additive controller contract; all pre-existing labels/tools/cases remain frozen.
  golden.contract.tools.actualController = 'mcp__qcc-company__get_actual_controller';
  Object.assign(golden.contract.fields,Object.fromEntries(ACTUAL_CONTROLLER_GROUP.fields.map(f=>[f.id,f.label])));
  Object.assign(golden.contract.fields, Object.fromEntries(SNAPSHOT_GROUPS.flatMap(g => g.fields.map(f => [f.id, f.label]))));
  // Audited delivery change: XLSX only, execution metadata moved to a report.
  const artifacts = golden.cases.find(item => item.id === 'artifacts');
  const complete = structuredClone(artifacts.expected.find(a => a.kind === 'complete' && a.format === 'xlsx'));
  const report = { ...structuredClone(complete), kind: 'report', fileName: '合成客户台账-任务结果报告.xlsx' };
  for (const row of complete.content) delete row.匹配状态;
  for (const row of report.content) { row.匹配状态 = row.匹配状态 === 'exact' ? '精确匹配' : '候选主体待确认'; row.数据来源 = ''; }
  const review = structuredClone(artifacts.expected.find(a => a.kind === 'review' && a.format === 'xlsx'));
  for (const row of review.content) { row.匹配状态 = '候选主体待确认'; row.数据来源 = ''; }
  artifacts.expected = [complete, report, review];
  assert.deepEqual(await collectLegacy(), golden);
});

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
    // v0.8.17: Host finalizes workbench artifacts; partial remains retryable.
    // Image drafts retain sanitized source metadata, without advancing upload state.
    // v0.9.8: reviewed immutable origin guards and safe Provider audit metadata.
    'lib/workflow.js': '68544fe18efdaad99f42533e3cdbc20f45dc82749cbdfd851325ec7efaac9d30',
    'lib/skill-enrich.js': '245f5b2b099d2242f1ddb4cafb6db3bb1d612911f929f3eb1f64e850dba9941b',
    // Confirmed output mappings allow fan-out; identity anchors remain unique.
    'lib/workflow-contract.js': '9816db761ddbb273f6e48307887e7d82710b60d7730db2325ac613583fb77acc',
    // v0.8.14: draft-only staging drops billing checkbox; execution/legacy gates remain.
    // Additive Host capability flags prevent new-client/old-Host staging errors.
    // v0.8.21: derive artifact origin from actual browser request.
    // Authorized image continuation binds a confirmed draft revision before Agent execution.
    // Read-only artifact preview now uses a compact scroll grid with fixed headers.
    'lib/web.js': '42ab153371903fdbca565d0cd8e24f07898c871619e78268fa5e212cbed0f20d',
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

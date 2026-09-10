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
    'lib/workflow.js': 'b61016e1d31ed380f9b8c6d332c10f79783d0f65ef63a706e85c631ecdb1f491',
    'lib/skill-enrich.js': '245f5b2b099d2242f1ddb4cafb6db3bb1d612911f929f3eb1f64e850dba9941b',
    // Confirmed output mappings allow fan-out; identity anchors remain unique.
    'lib/workflow-contract.js': '3147387a10f4fdc6b295b9bd8c4e3877fd2b36ec4778d7c58cae07c8f5ce58f8',
    // v0.8.14: draft-only staging drops billing checkbox; execution/legacy gates remain.
    // Additive Host capability flags prevent new-client/old-Host staging errors.
    // v0.8.21: derive artifact origin from actual browser request.
    // Authorized image continuation binds a confirmed draft revision before Agent execution.
    // Read-only artifact preview now uses a compact scroll grid with fixed headers.
    'lib/web.js': '6318ba469fb6fb5cac87771dbe681307c434fd90079ccbba3459f90951387e67',
    // v0.8.20: normal absence notes are separate from actionable field issues.
    'lib/artifacts.js': '8895aa013d29e8b62c7e317db54639fe1caecc837c5329e5d099dced5e464cba',
    // Planning is shared by draft preflight and execution; all 24 output cases unchanged.
    // Failed rows now retain normalized error identifiers for exception exports.
    'lib/qcc.js': '8ac6e50c2e00e738c18f8da044cb165b393bfc8a5cd381fa73c54a0cb8f7c9fa',
    'lib/qcc-field-catalog.js': '7055dd390c40e8e3b5090d5122770c57485225b32f8ae8f010cd3246d287aaf3',
  });
  // Audited additive controller contract; all pre-existing labels/tools/cases remain frozen.
  golden.contract.tools.actualController = 'mcp__qcc-company__get_actual_controller';
  Object.assign(golden.contract.fields,Object.fromEntries(ACTUAL_CONTROLLER_GROUP.fields.map(f=>[f.id,f.label])));
  Object.assign(golden.contract.fields, Object.fromEntries(SNAPSHOT_GROUPS.flatMap(g => g.fields.map(f => [f.id, f.label]))));
  assert.deepEqual(await collectLegacy(), golden);
});

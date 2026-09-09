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
    'lib/workflow.js': '59606d45a2e81ea78a0829ca86d3da37ffef9f3af000d14427c11eebe80c797f',
    'lib/skill-enrich.js': '245f5b2b099d2242f1ddb4cafb6db3bb1d612911f929f3eb1f64e850dba9941b',
    // Confirmed output mappings allow fan-out; identity anchors remain unique.
    'lib/workflow-contract.js': '3147387a10f4fdc6b295b9bd8c4e3877fd2b36ec4778d7c58cae07c8f5ce58f8',
    // v0.8.14: draft-only staging drops billing checkbox; execution/legacy gates remain.
    // Additive Host capability flags prevent new-client/old-Host staging errors.
    // v0.8.21: derive artifact origin from actual browser request.
    'lib/web.js': '7f71d0ff1fcb88b6fb89e25e6c64dff9cd2cc69ac46d4d589d54431e5190e4a9',
    // v0.8.20: normal absence notes are separate from actionable field issues.
    'lib/artifacts.js': '8895aa013d29e8b62c7e317db54639fe1caecc837c5329e5d099dced5e464cba',
    // Planning is shared by draft preflight and execution; all 24 output cases unchanged.
    'lib/qcc.js': '4a12bffa908e1af54d5e710796896708482989a4f9be49fb7b0bbb6786282308',
    'lib/qcc-field-catalog.js': '7055dd390c40e8e3b5090d5122770c57485225b32f8ae8f010cd3246d287aaf3',
  });
  // Audited additive controller contract; all pre-existing labels/tools/cases remain frozen.
  golden.contract.tools.actualController = 'mcp__qcc-company__get_actual_controller';
  Object.assign(golden.contract.fields,Object.fromEntries(ACTUAL_CONTROLLER_GROUP.fields.map(f=>[f.id,f.label])));
  Object.assign(golden.contract.fields, Object.fromEntries(SNAPSHOT_GROUPS.flatMap(g => g.fields.map(f => [f.id, f.label]))));
  assert.deepEqual(await collectLegacy(), golden);
});

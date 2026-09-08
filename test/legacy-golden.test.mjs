import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectLegacy } from './helpers/legacy-characterization.mjs';
import { ACTUAL_CONTROLLER_GROUP } from 'qcc-field-contracts';

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
    'lib/web.js': 'ab3945c31f44d922bff472761c5f7904af26dc46c0f081f2c340d80b6d1a9f34',
    'lib/artifacts.js': '6d51d3735f01c50c4af3493d9ba08b5109915bca244c59ef1449f98242425088',
    // Planning is shared by draft preflight and execution; all 24 output cases unchanged.
    'lib/qcc.js': '1b6e35e7bbaf07c3344bd0669beb794b57506195a0eca1ee5399f65513cd9e28',
    'lib/qcc-field-catalog.js': 'e255ea1500cf064ae92a4cd6a2fe4e6da257a74d0910e8ae02afbf3d91a89e28',
  });
  // Audited additive controller contract; all pre-existing labels/tools/cases remain frozen.
  golden.contract.tools.actualController = 'mcp__qcc-company__get_actual_controller';
  Object.assign(golden.contract.fields,Object.fromEntries(ACTUAL_CONTROLLER_GROUP.fields.map(f=>[f.id,f.label])));
  assert.deepEqual(await collectLegacy(), golden);
});

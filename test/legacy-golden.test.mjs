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
    'lib/web.js': '072f3384592ffbae8492531d3ddab2f182f0876a8681262d12645337f11aab2d',
    'lib/artifacts.js': '6d51d3735f01c50c4af3493d9ba08b5109915bca244c59ef1449f98242425088',
    'lib/qcc.js': '172a38b8acff0794a4797a740382dc898dd46b3912ae0979724e253f8e2c6e74',
    'lib/qcc-field-catalog.js': 'e255ea1500cf064ae92a4cd6a2fe4e6da257a74d0910e8ae02afbf3d91a89e28',
  });
  // Audited additive controller contract; all pre-existing labels/tools/cases remain frozen.
  golden.contract.tools.actualController = 'mcp__qcc-company__get_actual_controller';
  Object.assign(golden.contract.fields,Object.fromEntries(ACTUAL_CONTROLLER_GROUP.fields.map(f=>[f.id,f.label])));
  assert.deepEqual(await collectLegacy(), golden);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectLegacy } from './helpers/legacy-characterization.mjs';

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
    'lib/artifacts.js': '4e6e8633eb29a747123f1cf4b5352619c37e96a058178faca8f7f020a1c82d98',
    'lib/qcc.js': '1fef57ddf70a45e048a57eefbb0e36ee32fc53dc7b7c889fcf5526eff925617e',
  });
  assert.deepEqual(await collectLegacy(), golden);
});

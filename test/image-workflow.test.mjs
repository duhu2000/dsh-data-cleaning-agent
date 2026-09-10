import test from 'node:test';
import assert from 'node:assert/strict';
import { DataCleaningWorkflowStore } from '../lib/workflow.js';
import { createImageWorkflow } from '../lib/image-workflow.js';
import { memoryStorageDomain } from './helpers/workflow-memory.mjs';

for (const kind of ['stale', 'ambiguous', 'truncated', 'oversized']) test(`图片自动续跑 ${kind} 不发起企业查询`, async () => {
  const store = await new DataCleaningWorkflowStore({ storageDomain: memoryStorageDomain(), logger: { info() {} } }).init();
  try {
    const task = await store.create({ fieldSelection: ['legal_rep'], source: { type: 'image', fileName: '图.png' } });
    const run = createImageWorkflow({ getWorkflow: () => store,
      execution: { prepare: () => assert.fail('must not prepare paid lookup') },
      commands: { prepare: () => assert.fail('must not create paid command') } });
    const record = { fileName: '图.png', workflow: { taskId: task.id, revision: kind === 'stale' ? 0 : task.revision } };
    const result = { entries: Array.from({ length: kind === 'oversized' ? 101 : 1 }, (_, i) => `合成${i}有限公司`),
      needsReview: kind === 'ambiguous', truncated: kind === 'truncated' };
    if (kind === 'stale') await assert.rejects(run(record, result, {}), { code: 'DC_WORKFLOW_REVISION_CONFLICT' });
    else {
      const output = await run(record, result, {});
      assert.equal(output.deliveryState, 'review_required');
      const saved = await store.require(task.id);
      assert.equal(saved.state, 'uploaded');
      assert.deepEqual(saved.fieldSelection, ['legal_rep']);
      assert.equal(saved.mappings[0].sourceField, '主体标识');
    }
  } finally { await store.dispose(); }
});

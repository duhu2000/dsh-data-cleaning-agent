import test from 'node:test';
import assert from 'node:assert/strict';

import { runSync } from '../lib/jobs.js';
import { registerTools, TOOL_COMPLETE } from '../lib/tools.js';

const rows = [
  { name: '示例科技有限公司', phone: '138-0000-0001', amount: '100' },
  { name: '', phone: '', amount: '' },
];

test('runSync complete 的摘要只返回整数，明细仍保留在 rows', () => {
  const result = runSync('complete', rows);
  assert.equal(result.summary.completed, 2);
  assert.equal(typeof result.summary.completed, 'number');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].phone, '13800000001');
});

test('data_complete_rows 工具输出符合 integer schema，不泄露明细数组', async () => {
  const definitions = [];
  const dispose = registerTools({
    register(definition) {
      definitions.push(definition);
      return () => {};
    },
  });
  const complete = definitions.find((definition) => definition.name === TOOL_COMPLETE);
  assert.ok(complete);
  const result = await complete.execute({ rows });
  assert.equal(result.completed, 2);
  assert.equal(typeof result.completed, 'number');
  assert.equal(Array.isArray(result.completed), false);
  assert.equal('rows' in result, false);
  for (const release of dispose) release();
});

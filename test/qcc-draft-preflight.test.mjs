import test from 'node:test';
import assert from 'node:assert/strict';
import { QccHostBridge, QCC_TOOL_NAMES } from '../lib/qcc.js';
import { QccCommandStore } from '../lib/qcc-command.js';

function setup() {
  const definitions = new Set(Object.values(QCC_TOOL_NAMES));
  let calls = 0;
  const bridge = new QccHostBridge({ toolWaitMs: 0, tools: {
    get: name => definitions.has(name) ? { name } : undefined,
    execute: async () => { calls++; throw new Error('Preflight must not query'); },
  } });
  const store = new QccCommandStore({ bridge, runs: {} });
  return { bridge, store, definitions, calls: () => calls };
}
const input = { kind: 'enrich', taskId: 'dcw-preflight', rows: [{ code: '91320594088140947F' }, { code: '91320594088140947F' }], nameField: 'code', fieldSelection: ['credit_no', 'legal_rep'] };

test('Host automatically deduplicates identity column and stages a non-paid editable draft', () => {
  const app = setup(), command = app.store.prepare(input);
  assert.equal(command.estimate.uniqueCompanies, 1);
  assert.equal(command.estimate.rowCount, 2);
  assert.equal(command.estimate.estimatedCalls, 2);
  assert.equal(command.estimate.maxCalls, 300);
  assert.match(command.prompt, /发送本说明即确认/);
  assert.doesNotMatch(command.prompt, /额度确认已|91320594088140947F/);
  assert.equal(app.calls(), 0);
});

test('Draft preflight rejects missing selected tools and excessive scope without any QCC call', () => {
  const app = setup();
  app.definitions.delete(QCC_TOOL_NAMES.contact);
  assert.throws(() => app.store.prepare({ ...input, fieldSelection: ['contact_preferred_phone'] }), { code: 'QCC_NOT_CONNECTED' });
  assert.throws(() => app.store.prepare({ ...input, rows: Array.from({ length: 101 }, () => ({ code: 'x' })) }), { code: 'QCC_BATCH_TOO_LARGE' });
  assert.throws(() => app.bridge.previewEnrichment(input.rows, { nameField: 'missing' }), { code: 'QCC_INVALID_ROWS' });
  assert.throws(() => app.bridge.previewEnrichment(input.rows, { nameField: 'code', maxCalls: 1 }), { code: 'QCC_CALL_BUDGET_EXCEEDED' });
  assert.equal(app.calls(), 0);
});

test('Sending rechecks current connection and still requires Agent-owned execution', async () => {
  const app = setup(), command = app.store.prepare(input);
  await assert.rejects(app.store.run(command.commandId, {}), { code: 'QCC_AGENT_EXECUTION_REQUIRED' });
  assert.equal(app.store.status(command.commandId).state, 'prepared');
  app.definitions.delete(QCC_TOOL_NAMES.registration);
  await assert.rejects(app.store.run(command.commandId, { agent: {}, token: 'synthetic-token' }), { code: 'QCC_NOT_CONNECTED' });
  assert.equal(app.calls(), 0);
});

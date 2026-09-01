import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintRequest, G5RunStore } from '../lib/qcc-runs.js';

function resultWith({ status, reviewQueue = [], errors = [] }) {
  return {
    summary: {
      totalRows: 1,
      uniqueCompanies: 1,
      enriched: status === 'enriched' ? 1 : 0,
      ambiguous: status === 'ambiguous' ? 1 : 0,
      unresolved: status === 'unresolved' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      missingName: 0,
      includeRisk: false,
    },
    rows: [{ name: '测试企业', qcc_match_status: status }],
    reviewQueue,
    errors,
  };
}

test('同一幂等键的并发请求只执行一次并复用结果', async () => {
  const store = new G5RunStore();
  const fingerprint = fingerprintRequest('enrich', { rows: [{ name: '测试企业' }] });
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await Promise.resolve();
    return { runId: 'run-1' };
  };
  const [first, second] = await Promise.all([
    store.executeOnce({ key: 'idem-key-0001', fingerprint, operation }),
    store.executeOnce({ key: 'idem-key-0001', fingerprint, operation }),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.deepEqual(first.value, second.value);
});

test('执行中的幂等记录超过 TTL 也不会重复发起付费调用', async () => {
  let now = 1_000;
  const store = new G5RunStore({ clock: () => now, ttlMs: 50 });
  const fingerprint = fingerprintRequest('enrich', { rows: [{ name: '慢请求企业' }] });
  let calls = 0;
  let complete;
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { complete = resolve; });
  };

  const first = store.executeOnce({ key: 'idem-long-running', fingerprint, operation });
  await Promise.resolve();
  now = 1_100;
  const replay = store.executeOnce({ key: 'idem-long-running', fingerprint, operation });
  await Promise.resolve();

  assert.equal(calls, 1);
  complete({ runId: 'run-slow' });
  const [firstResult, replayResult] = await Promise.all([first, replay]);
  assert.equal(firstResult.replayed, false);
  assert.equal(replayResult.replayed, true);
  assert.deepEqual(firstResult.value, replayResult.value);
});

test('同一幂等键不能复用于不同请求', async () => {
  const store = new G5RunStore();
  await store.executeOnce({
    key: 'idem-key-0002',
    fingerprint: fingerprintRequest('enrich', { row: 1 }),
    operation: async () => ({ ok: true }),
  });
  await assert.rejects(
    store.executeOnce({
      key: 'idem-key-0002',
      fingerprint: fingerprintRequest('enrich', { row: 2 }),
      operation: async () => ({ ok: false }),
    }),
    (error) => error.code === 'QCC_IDEMPOTENCY_CONFLICT',
  );
});

test('幂等缓存达到上限时在新计费操作前关闭', async () => {
  const store = new G5RunStore({ maxIdempotency: 1 });
  await store.executeOnce({
    key: 'idem-capacity-001',
    fingerprint: fingerprintRequest('enrich', { row: 1 }),
    operation: async () => ({ ok: true }),
  });
  let calls = 0;
  await assert.rejects(
    store.executeOnce({
      key: 'idem-capacity-002',
      fingerprint: fingerprintRequest('enrich', { row: 2 }),
      operation: async () => { calls += 1; },
    }),
    (error) => error.code === 'QCC_IDEMPOTENCY_CAPACITY' && error.retryable,
  );
  assert.equal(calls, 0);
});

test('候选必须来自待复核列表，确认后续跑且不重新检索', async () => {
  const store = new G5RunStore({ runIdFactory: () => 'g5-run-review' });
  const run = store.createRun({
    headers: ['name'],
    nameField: 'name',
    includeRisk: false,
    concurrency: 1,
    result: resultWith({
      status: 'ambiguous',
      reviewQueue: [{
        companyName: '测试企业',
        rowIndexes: [0],
        candidates: [
          { companyName: '测试企业甲', creditNo: '9132A' },
          { companyName: '测试企业乙', creditNo: '9132B' },
        ],
      }],
    }),
  });
  let calls = 0;
  const bridge = {
    async enrichLockedCompany(selection, options) {
      calls += 1;
      options.onAudit({ toolName: 'registration', callId: 'locked-1', attempt: 1, outcome: 'success' });
      return {
        status: 'enriched',
        fields: { credit_no: selection.creditNo, legal_rep: '某负责人' },
      };
    },
  };
  await assert.rejects(
    store.resolveCandidate(run.runId, {
      companyName: '测试企业',
      selectedCreditNo: 'NOT-IN-CANDIDATES',
    }, bridge),
    (error) => error.code === 'QCC_CANDIDATE_INVALID',
  );
  assert.equal(calls, 0);

  const resolved = await store.resolveCandidate(run.runId, {
    companyName: '测试企业',
    selectedCreditNo: '9132B',
  }, bridge);
  assert.equal(calls, 1);
  assert.equal(resolved.state, 'completed');
  assert.equal(resolved.reviewQueue.length, 0);
  assert.equal(resolved.rows[0].credit_no, '9132B');
  assert.equal(resolved.audit.length, 1);
});

test('只有 retryable 失败可由用户显式重试并更新原行', async () => {
  const store = new G5RunStore({ runIdFactory: () => 'g5-run-retry' });
  const run = store.createRun({
    headers: ['name'],
    nameField: 'name',
    includeRisk: false,
    concurrency: 1,
    result: resultWith({
      status: 'failed',
      errors: [{
        companyName: '测试企业',
        rowIndexes: [0],
        error: { code: 'QCC_RATE_LIMITED', retryable: true },
      }],
    }),
  });
  const bridge = {
    async enrichCompany(name, options) {
      options.onAudit({ toolName: 'entityLookup', callId: 'retry-1', attempt: 1, outcome: 'success' });
      return { status: 'enriched', fields: { credit_no: '9132RETRIED', legal_rep: name } };
    },
  };
  const retried = await store.retryCompanies(run.runId, ['测试企业'], bridge);
  assert.equal(retried.state, 'completed');
  assert.equal(retried.errors.length, 0);
  assert.equal(retried.rows[0].qcc_match_status, 'enriched');
  assert.equal(retried.rows[0].credit_no, '9132RETRIED');
});

test('Host 内存态过期后明确要求新建 run', () => {
  let now = 1_000;
  const store = new G5RunStore({ clock: () => now, ttlMs: 50, runIdFactory: () => 'g5-expiring' });
  const run = store.createRun({
    headers: ['name'],
    result: resultWith({ status: 'unresolved' }),
  });
  now = 1_100;
  assert.throws(() => store.get(run.runId), (error) => error.code === 'QCC_RUN_NOT_FOUND');
});

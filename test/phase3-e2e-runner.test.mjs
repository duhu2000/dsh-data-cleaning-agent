import assert from 'node:assert/strict';
import test from 'node:test';
import { runPhase3E2E } from '../scripts/phase3-e2e.mjs';

function response(payload, status = 200) { return { status, async json() { return payload; } }; }

test('Phase3 E2E 默认关闭且拒绝非回环地址', async () => {
  await assert.rejects(runPhase3E2E({ env: {}, fetchImpl: async () => { throw new Error('must not fetch'); } }), { code: 'PHASE3_E2E_DISABLED' });
  await assert.rejects(runPhase3E2E({ env: { PHASE3_E2E: '1', PHASE3_BASE_URL: 'https://example.com' }, fetchImpl: async () => response({}) }), { code: 'PHASE3_E2E_LOOPBACK_ONLY' });
});

test('Phase3 preflight 只执行 capabilities 与零调用 estimate', async () => {
  const calls = [];
  const report = await runPhase3E2E({
    env: { PHASE3_E2E: '1', PHASE3_BASE_URL: 'http://127.0.0.1:43201', PHASE3_E2E_MODE: 'preflight' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/capabilities')) return response({
        ok: true,
        marker: 'qcc-phase3-capabilities',
        capabilities: { totalRegistered: 91, total: 91, ready: true },
        executesTools: false,
        paidCalls: false,
      });
      return response({
        ok: true,
        marker: 'qcc-phase3-estimate',
        estimate: { estimatedCalls: 2, withinLimit: true, executesTools: false, paidCalls: false },
      });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(report.steps.map((step) => step.name), ['capabilities', 'estimate-zero-call']);
});

test('Phase3 preflight 对缺失工具和错误端点 fail closed', async () => {
  const baseEnv = { PHASE3_E2E: '1', PHASE3_BASE_URL: 'http://127.0.0.1:43201', PHASE3_E2E_MODE: 'preflight' };
  await assert.rejects(runPhase3E2E({
    env: baseEnv,
    fetchImpl: async () => response({
      ok: true,
      marker: 'qcc-phase3-capabilities',
      capabilities: { totalRegistered: 90, total: 91, ready: false },
      executesTools: false,
      paidCalls: false,
    }),
  }), { code: 'PHASE3_E2E_CAPABILITIES_INCOMPLETE' });

  await assert.rejects(runPhase3E2E({
    env: baseEnv,
    fetchImpl: async () => response({ ok: false, code: 'NOT_FOUND' }, 404),
  }), { code: 'PHASE3_E2E_ENDPOINT_FAILED' });
});

test('enrich 模式缺付费确认时在读取夹具和调用 enrich 前阻断', async () => {
  const calls = [];
  await assert.rejects(runPhase3E2E({
    env: { PHASE3_E2E: '1', PHASE3_BASE_URL: 'http://localhost:43201', PHASE3_E2E_MODE: 'enrich' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/capabilities')) return response({
        ok: true,
        marker: 'qcc-phase3-capabilities',
        capabilities: { totalRegistered: 91, total: 91, ready: true },
        executesTools: false,
        paidCalls: false,
      });
      return response({
        ok: true,
        marker: 'qcc-phase3-estimate',
        estimate: { estimatedCalls: 2, withinLimit: true, executesTools: false, paidCalls: false },
      });
    },
  }), { code: 'PHASE3_E2E_PAID_CONFIRMATION_REQUIRED' });
  assert.equal(calls.length, 2);
});

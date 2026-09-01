import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runG5E2E } from '../scripts/g5-e2e.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/g5-e2e.example.json', import.meta.url));

function jsonResponse(status, payload) {
  return { status, async json() { return payload; } };
}

test('G5 E2E Runner 默认关闭且不会发出请求', async () => {
  let calls = 0;
  await assert.rejects(
    runG5E2E({ env: {}, fetchImpl: async () => { calls += 1; } }),
    (error) => error.code === 'G5_E2E_DISABLED',
  );
  assert.equal(calls, 0);
});

test('G5 E2E Runner 拒绝非回环地址', async () => {
  await assert.rejects(
    runG5E2E({
      env: { G5_E2E: '1', G5_BASE_URL: 'https://example.com' },
      fetchImpl: async () => jsonResponse(200, {}),
    }),
    (error) => error.code === 'G5_E2E_LOOPBACK_ONLY',
  );
});

test('preflight 模式只读取 capabilities，不进入付费调用', async () => {
  const urls = [];
  const report = await runG5E2E({
    env: { G5_E2E: '1', G5_BASE_URL: 'http://127.0.0.1:43150', G5_E2E_MODE: 'preflight' },
    fetchImpl: async (url) => {
      urls.push(url);
      return jsonResponse(200, {
        ok: true,
        marker: 'g5-host-bridge',
        capabilities: { ready: false, state: 'not-connected-or-refreshing' },
      });
    },
  });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/capabilities$/);
  assert.equal(report.steps[0].state, 'not-connected-or-refreshing');
});

test('enrich 模式缺少明确付费确认时在读取夹具和调用前阻断', async () => {
  let calls = 0;
  await assert.rejects(
    runG5E2E({
      env: {
        G5_E2E: '1',
        G5_BASE_URL: 'http://localhost:43150',
        G5_E2E_MODE: 'enrich',
        G5_FIXTURE_PATH: fixturePath,
      },
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(200, { ok: true, capabilities: { ready: true } });
      },
    }),
    (error) => error.code === 'G5_E2E_PAID_CONFIRMATION_REQUIRED',
  );
  assert.equal(calls, 1, 'only passive capabilities preflight may run');
});

test('显式门控后 Runner 只输出摘要，不携带原始行或候选详情', async () => {
  let calls = 0;
  const report = await runG5E2E({
    env: {
      G5_E2E: '1',
      G5_BASE_URL: 'http://127.0.0.1:43150',
      G5_E2E_MODE: 'enrich',
      G5_E2E_CONFIRM_PAID_CALLS: 'YES',
      G5_FIXTURE_PATH: fixturePath,
    },
    fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, { ok: true, capabilities: { ready: true, state: 'ready' } });
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.confirmPaidCalls, true);
      assert.match(requestBody.idempotencyKey, /^g5-e2e:enrich:/);
      return jsonResponse(200, {
        ok: true,
        marker: 'g5-host-bridge',
        runId: 'g5-test-run',
        state: 'awaiting-review',
        summary: { totalRows: 3, ambiguous: 1, accidentalCompanyName: '测试甲企业' },
        rows: [{ name: '测试甲企业', credit_no: '91320100MA1234567X' }],
        reviewQueue: [{ companyName: '测试多候选企业', candidates: [{ creditNo: '91320100MA1234567X' }] }],
        errors: [],
      });
    },
  });
  assert.equal(calls, 2);
  const json = JSON.stringify(report);
  assert.equal(json.includes('测试甲企业'), false);
  assert.equal(json.includes('测试多候选企业'), false);
  assert.equal(json.includes('91320100MA1234567X'), false);
  assert.equal(report.steps.at(-1).reviewQueueCount, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mountWebRoutes } from '../lib/web.js';
import { QCC_TOOL_NAMES } from '../lib/qcc.js';
import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_HISTORY_TOOLS,
} from '../lib/qcc-phase2.js';

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = String(body);
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

function request({ method = 'GET', url, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { 'sec-fetch-site': 'same-origin' };
  return req;
}

function harness({ omitDefinitions = [] } = {}) {
  const routes = new Map();
  const calls = [];
  let retryRegistrationCalls = 0;
  const definitions = new Set([
    'data_clean_rows',
    'data_complete_rows',
    'data_profile',
    QCC_TOOL_NAMES.oauthConnect,
    QCC_TOOL_NAMES.oauthStatus,
    QCC_TOOL_NAMES.entityLookup,
    QCC_TOOL_NAMES.registration,
    QCC_TOOL_NAMES.riskScan,
    ...Object.values(QCC_PHASE2_COMPANY_TOOLS),
    ...Object.values(QCC_PHASE2_HISTORY_TOOLS),
  ]);
  for (const name of omitDefinitions) definitions.delete(name);
  const tools = {
    get: (name) => definitions.has(name) ? { name } : undefined,
    async execute(exec) {
      calls.push(exec);
      if (exec.name === QCC_TOOL_NAMES.entityLookup) {
        const searchKey = exec.arguments.searchKey;
        if (searchKey === '模糊企业') {
          return {
            isError: false,
            value: { content: [{ type: 'text', text: JSON.stringify({
              匹配结果: '多候选',
              企业信息: [
                { 企业名称: '模糊企业甲', 统一社会信用代码: '9132AMBIG-A' },
                { 企业名称: '模糊企业乙', 统一社会信用代码: '9132AMBIG-B' },
              ],
            }) }] },
          };
        }
        return {
          isError: false,
          value: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                匹配结果: '唯一精确匹配',
                企业信息: {
                  企业名称: searchKey === '重试企业' ? '重试企业有限公司' : '示例企业有限公司',
                  统一社会信用代码: searchKey === '重试企业' ? '9132RETRY' : '9132WEBMOCK',
                },
              }),
            }],
          },
        };
      }
      if (exec.name === QCC_TOOL_NAMES.registration) {
        if (exec.arguments.searchKey === '9132RETRY') {
          retryRegistrationCalls += 1;
          if (retryRegistrationCalls === 1) {
            return {
              isError: true,
              error: { message: 'Bearer raw-secret 真实企业名单', info: { code: '503' } },
            };
          }
        }
        return {
          isError: false,
          value: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                企业名称: '示例企业有限公司',
                统一社会信用代码: exec.arguments.searchKey,
                法定代表人: '张三',
                登记状态: '存续',
              }),
            }],
          },
        };
      }
      return { isError: false, value: { structuredContent: {} } };
    },
  };
  const webServer = {
    register({ path, handler }) {
      routes.set(path, handler);
      return () => routes.delete(path);
    },
  };
  const report = {};
  const dispose = mountWebRoutes({
    webServer,
    tools,
    skills: {},
    jobs: null,
    storageDomain: null,
  }, {
    logger: { info() {}, warn() {} },
    report,
    TOOL_NAME: 'data_clean_rows',
    SKILL_NAME: 'data-cleaning',
  });
  return { routes, calls, report, dispose };
}

test('MVP 页面粘贴 CSV 后的清洗操作复用解析接口', async () => {
  const app = harness();
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/')(
    request({ url: '/data-cleaning/' }),
    res,
  );
  assert.equal(res.status, 200);
  assert.match(res.body, /content\.startsWith\('\['\)/);
  assert.match(
    res.body,
    /call\('\/data-cleaning\/api\/mvp\/parse', \{ filename: 'data\.csv', content \}\)/,
  );
  app.dispose();
});

test('G5 capabilities 路由被挂载且只做被动工具探测', async () => {
  const app = harness();
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/capabilities')(
    request({ url: '/data-cleaning/api/g5/capabilities' }),
    res,
  );
  assert.equal(res.status, 200);
  assert.equal(res.json().marker, 'g5-host-bridge');
  assert.equal(res.json().capabilities.ready, true);
  assert.equal(res.json().paidCallConfirmationRequired, true);
  assert.equal(res.json().idempotencyRequired, true);
  assert.equal(res.json().candidateResume, true);
  assert.equal(res.json().capabilities.phase2.companyReady, true);
  assert.equal(app.calls.length, 0);
  assert.equal(app.report.qccBridgeMounted, true);
  app.dispose();
});

test('0.4.0 capabilities 预检覆盖 16+4 工具且不执行调用', async () => {
  const app = harness();
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase2/capabilities')(
    request({ url: '/data-cleaning/api/phase2/capabilities' }),
    res,
  );
  const payload = res.json();
  assert.equal(res.status, 200);
  assert.equal(payload.marker, 'qcc-phase2-capabilities');
  assert.equal(payload.capabilities.companyRegistered, 16);
  assert.equal(payload.capabilities.historyRegistered, 4);
  assert.equal(payload.capabilities.companyReady, true);
  assert.equal(payload.capabilities.historyToolsReady, true);
  assert.equal(payload.capabilities.historyAuthorizationVerified, false);
  assert.equal(payload.executesTools, false);
  assert.equal(payload.paidCalls, false);
  assert.equal(app.calls.length, 0);
  app.dispose();
});

test('0.4.0 预检区分历史工具缺失与账号授权', async () => {
  const missingHistoryTool = QCC_PHASE2_HISTORY_TOOLS.executives;
  const app = harness({ omitDefinitions: [missingHistoryTool] });
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase2/capabilities')(
    request({ url: '/data-cleaning/api/phase2/capabilities' }),
    res,
  );
  const capabilities = res.json().capabilities;
  assert.equal(capabilities.companyReady, true);
  assert.equal(capabilities.historyRegistered, 3);
  assert.equal(capabilities.historyToolsReady, false);
  assert.equal(capabilities.historyAuthorizationVerified, false);
  assert.equal(capabilities.state, 'current-ready-history-tools-missing');
  assert.equal(app.calls.length, 0);
  app.dispose();
});

test('G5 enrich 未显式确认计费调用时在工具执行前阻断', async () => {
  const app = harness();
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({ method: 'POST', url: '/data-cleaning/api/g5/enrich', body: { rows: [{ name: '示例企业' }] } }),
    res,
  );
  assert.equal(res.status, 409);
  assert.equal(res.json().code, 'QCC_CONFIRM_REQUIRED');
  assert.equal(app.calls.length, 0);
  app.dispose();
});

test('G5 enrich 经 Mock ToolRuntime 完成补全并生成同源 CSV', async () => {
  const app = harness();
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/g5/enrich',
      body: {
        idempotencyKey: 'web-enrich-0001',
        confirmPaidCalls: true,
        rows: [{ name: '示例企业' }],
        headers: ['name'],
      },
    }),
    res,
  );
  const body = res.json();
  assert.equal(res.status, 200);
  assert.equal(body.summary.enriched, 1);
  assert.equal(body.state, 'completed');
  assert.match(body.runId, /^g5-/);
  assert.equal(body.rows[0].credit_no, '9132WEBMOCK');
  assert.match(body.csv, /credit_no/);
  assert.equal(app.calls.length, 2);
  app.dispose();
});

test('G5 enrich 要求幂等键，并对相同请求复用结果而不重复计费调用', async () => {
  const app = harness();
  const missing = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/g5/enrich',
      body: { confirmPaidCalls: true, rows: [{ name: '示例企业' }] },
    }),
    missing,
  );
  assert.equal(missing.status, 400);
  assert.equal(missing.json().code, 'QCC_IDEMPOTENCY_REQUIRED');
  assert.equal(app.calls.length, 0);

  const body = {
    idempotencyKey: 'web-idempotent-0001',
    confirmPaidCalls: true,
    rows: [{ name: '示例企业' }],
    headers: ['name'],
  };
  const first = responseRecorder();
  const second = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({ method: 'POST', url: '/data-cleaning/api/g5/enrich', body }),
    first,
  );
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({ method: 'POST', url: '/data-cleaning/api/g5/enrich', body }),
    second,
  );
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.json().idempotencyReplayed, true);
  assert.equal(second.json().runId, first.json().runId);
  assert.equal(app.calls.length, 2);

  const conflict = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/g5/enrich',
      body: { ...body, rows: [{ name: '另一个请求' }] },
    }),
    conflict,
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json().code, 'QCC_IDEMPOTENCY_CONFLICT');
  assert.equal(app.calls.length, 2);
  app.dispose();
});

test('多候选必须选中待复核信用代码后续跑，且不重复实体检索', async () => {
  const app = harness();
  const started = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/g5/enrich',
      body: {
        idempotencyKey: 'web-ambiguous-0001',
        confirmPaidCalls: true,
        rows: [{ name: '模糊企业' }],
        headers: ['name'],
      },
    }),
    started,
  );
  assert.equal(started.status, 200);
  assert.equal(started.json().state, 'awaiting-review');
  assert.equal(started.json().reviewQueue.length, 1);
  assert.equal(app.calls.length, 1);

  const invalid = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/resolve')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/g5/resolve',
      body: {
        idempotencyKey: 'web-resolve-invalid-1',
        confirmPaidCalls: true,
        runId: started.json().runId,
        companyName: '模糊企业',
        selectedCreditNo: 'NOT-A-CANDIDATE',
      },
    }),
    invalid,
  );
  assert.equal(invalid.status, 409);
  assert.equal(invalid.json().code, 'QCC_CANDIDATE_INVALID');
  assert.equal(app.calls.length, 1);

  const resolved = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/resolve')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/g5/resolve',
      body: {
        idempotencyKey: 'web-resolve-valid-001',
        confirmPaidCalls: true,
        runId: started.json().runId,
        companyName: '模糊企业',
        selectedCreditNo: '9132AMBIG-B',
      },
    }),
    resolved,
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json().state, 'completed');
  assert.equal(resolved.json().rows[0].credit_no, '9132AMBIG-B');
  assert.equal(resolved.json().reviewQueue.length, 0);
  assert.equal(app.calls.filter((call) => call.name === QCC_TOOL_NAMES.entityLookup).length, 1);
  assert.equal(app.calls.filter((call) => call.name === QCC_TOOL_NAMES.registration).length, 1);

  const fetched = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/run')(
    request({ method: 'GET', url: `/data-cleaning/api/g5/run/${started.json().runId}` }),
    fetched,
  );
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json().version, 2);
  app.dispose();
});

test('retryable 部分失败只能通过显式人工重试恢复，原始错误不泄露', async () => {
  const app = harness();
  const started = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/enrich')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/g5/enrich',
      body: {
        idempotencyKey: 'web-retry-start-001',
        confirmPaidCalls: true,
        rows: [{ name: '重试企业' }],
        headers: ['name'],
      },
    }),
    started,
  );
  assert.equal(started.status, 200);
  assert.equal(started.json().state, 'needs-retry');
  assert.equal(started.json().errors[0].error.code, 'QCC_UPSTREAM_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(started.json()), /raw-secret|真实企业名单/);
  assert.equal(app.calls.length, 2);

  const retried = responseRecorder();
  const retryBody = {
    idempotencyKey: 'web-retry-action-001',
    confirmPaidCalls: true,
    runId: started.json().runId,
    companyNames: ['重试企业'],
  };
  await app.routes.get('/data-cleaning/api/g5/retry')(
    request({ method: 'POST', url: '/data-cleaning/api/g5/retry', body: retryBody }),
    retried,
  );
  assert.equal(retried.status, 200);
  assert.equal(retried.json().state, 'completed');
  assert.equal(retried.json().errors.length, 0);
  assert.equal(retried.json().rows[0].credit_no, '9132RETRY');
  assert.equal(app.calls.length, 4);

  const replay = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/retry')(
    request({ method: 'POST', url: '/data-cleaning/api/g5/retry', body: retryBody }),
    replay,
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.json().idempotencyReplayed, true);
  assert.equal(app.calls.length, 4);
  app.dispose();
});

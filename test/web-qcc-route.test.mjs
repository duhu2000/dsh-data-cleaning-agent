import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mountWebRoutes } from '../lib/web.js';
import { QCC_TOOL_NAMES } from '../lib/qcc.js';

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

function harness() {
  const routes = new Map();
  const calls = [];
  const definitions = new Set([
    'data_clean_rows',
    'data_complete_rows',
    'data_profile',
    QCC_TOOL_NAMES.oauthConnect,
    QCC_TOOL_NAMES.oauthStatus,
    QCC_TOOL_NAMES.entityLookup,
    QCC_TOOL_NAMES.registration,
    QCC_TOOL_NAMES.riskScan,
  ]);
  const tools = {
    get: (name) => definitions.has(name) ? { name } : undefined,
    async execute(exec) {
      calls.push(exec);
      if (exec.name === QCC_TOOL_NAMES.entityLookup) {
        return {
          isError: false,
          value: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                匹配结果: '唯一精确匹配',
                企业信息: { 企业名称: '示例企业有限公司', 统一社会信用代码: '9132WEBMOCK' },
              }),
            }],
          },
        };
      }
      if (exec.name === QCC_TOOL_NAMES.registration) {
        return {
          isError: false,
          value: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                企业名称: '示例企业有限公司',
                统一社会信用代码: '9132WEBMOCK',
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
  assert.equal(app.calls.length, 0);
  assert.equal(app.report.qccBridgeMounted, true);
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
  assert.equal(body.rows[0].credit_no, '9132WEBMOCK');
  assert.match(body.csv, /credit_no/);
  assert.equal(app.calls.length, 2);
  app.dispose();
});

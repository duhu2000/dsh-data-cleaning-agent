import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { memoryStorageDomain, memoryFs } from './helpers/workflow-memory.mjs';
import { Readable } from 'node:stream';
import { mountWebRoutes } from '../lib/web.js';
import { QCC_TOOL_NAMES } from '../lib/qcc.js';
import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_HISTORY_TOOLS,
} from '../lib/qcc-phase2.js';
import { QCC_PHASE3_ALL_CANONICAL_TOOLS } from '../lib/qcc-phase3.js';
import { QCC_DOCUMENT_LOCAL_TOOL_PAIRS } from '../lib/image-intake.js';

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

function harness({ omitDefinitions = [], registrationFault = null, storageDomain = null, fs = null } = {}) {
  const routes = new Map();
  const calls = [];
  const registeredTools = new Map();
  let retryRegistrationCalls = 0;
  let registrationFaultsRemaining = Math.max(0, Number(registrationFault?.times ?? 0));
  const [documentTools] = QCC_DOCUMENT_LOCAL_TOOL_PAIRS;
  const definitions = new Set([
    'data_clean_rows',
    'data_complete_rows',
    'data_profile',
    documentTools.parse,
    documentTools.result,
    QCC_TOOL_NAMES.oauthConnect,
    QCC_TOOL_NAMES.oauthStatus,
    QCC_TOOL_NAMES.entityLookup,
    QCC_TOOL_NAMES.registration,
    QCC_TOOL_NAMES.riskScan,
    ...Object.values(QCC_PHASE2_COMPANY_TOOLS),
    ...Object.values(QCC_PHASE2_HISTORY_TOOLS),
    ...QCC_PHASE3_ALL_CANONICAL_TOOLS,
  ]);
  for (const name of omitDefinitions) definitions.delete(name);
  const tools = {
    get: (name) => definitions.has(name) ? {
      name,
      ...(name === documentTools.parse ? { parameters: { properties: { file_path: { type: 'string' } } } } : {}),
    } : undefined,
    register(definition) {
      definitions.add(definition.name);
      registeredTools.set(definition.name, definition);
      return () => {
        definitions.delete(definition.name);
        registeredTools.delete(definition.name);
      };
    },
    async execute(exec) {
      calls.push(exec);
      if (exec.name === documentTools.parse) {
        return {
          isError: false,
          value: { content: [{ type: 'text', text: JSON.stringify({
            task_id: 'qcc-document-web-task',
            status: 'success',
            details: [{ result_md: '示例企业有限公司 91320594088140947F\n星际量子（北京）科技有限公司 91110108MA01LUR06B' }],
          }) }] },
        };
      }
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
        if (registrationFaultsRemaining > 0) {
          registrationFaultsRemaining -= 1;
          return {
            isError: true,
            error: {
              message: 'Bearer fault-injection-secret 敏感企业原名',
              info: {
                code: registrationFault.upstreamCode,
                retryAfterMs: registrationFault.retryAfterMs,
              },
            },
          };
        }
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
    storageDomain,
    fs,
  }, {
    logger: { info() {}, warn() {} },
    report,
    TOOL_NAME: 'data_clean_rows',
    SKILL_NAME: 'data-cleaning',
  });
  return { routes, calls, registeredTools, report, dispose };
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

test('MVP 同步清洗接受显式字段映射，中文企业表头不会按默认 name/phone 误删', async () => {
  const app = harness();
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/api/mvp/clean')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/mvp/clean',
      body: {
        headers: ['企业名称', '联系电话'],
        rows: [
          { 企业名称: '企查查科技股份有限公司', 联系电话: '025-9999-9999' },
          { 企业名称: '示例科技有限公司', 联系电话: '' },
        ],
        options: {
          required: ['企业名称'],
          dedupeOn: '企业名称',
          phoneField: '联系电话',
          amountField: null,
        },
      },
    }),
    res,
  );
  assert.equal(res.status, 200);
  assert.equal(res.json().summary.kept, 2);
  assert.equal(res.json().summary.badMissing, 0);
  assert.match(res.json().csv, /02599999999/);
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
  assert.equal(res.json().draftPreparationVersion, 2);
  assert.equal(res.json().draftPaidCallConfirmationRequired, false);
  assert.equal(res.json().multipleOutputColumns, true);
  assert.equal(res.json().idempotencyRequired, true);
  assert.equal(res.json().candidateResume, true);
  assert.equal(res.json().agentCommandTool, 'data_cleaning_qcc_run');
  assert.equal(res.json().agentCommandToolRegistered, true);
  assert.equal(res.json().agentOwnedExecutionRequired, true);
  assert.equal(res.json().capabilities.phase2.companyReady, true);
  assert.equal(app.calls.length, 0);
  assert.equal(app.report.qccBridgeMounted, true);
  app.dispose();
});

test('一次发送图片任务保留已选字段、生成 XLSX，重复调用不重复查询', async () => {
  const app = harness({ storageDomain: memoryStorageDomain(), fs: memoryFs() });
  const call = async (route, method, url, body) => {
    const res = responseRecorder();
    await app.routes.get(route)(request({ method, url, body }), res);
    return res;
  };
  try {
    const base = '/data-cleaning/api/workflow/tasks';
    const image = '/data-cleaning/api/images/commands';
    const taskResponse = await call(base, 'POST', base, { fieldSelection: ['reg_capital'],
      source: { type: 'image', fileName: '名单.png' } });
    const task = taskResponse.json().task;
    const prepared = await call(image, 'POST', image, { fileName: '名单.png',
      content: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(24)]).toString('base64') });
    const id = prepared.json().command.commandId;
    const refused = await call(image, 'PATCH', image + '/' + id, { taskId: task.id, expectedRevision: task.revision });
    assert.equal(refused.status, 409, '未声明发送授权不绑定自动续跑');
    const bound = await call(image, 'PATCH', image + '/' + id, { taskId: task.id,
      expectedRevision: task.revision, executeOnSend: true });
    assert.equal(bound.status, 200);
    assert.equal(app.calls.length, 0, '向导确认不提前消耗额度');
    const tool = app.registeredTools.get('data_cleaning_extract_image_companies');
    const exec = { agent: { session: { id: 'image-once' } }, token: 'original-parent', signal: new AbortController().signal };
    const results = await Promise.all([tool.execute({ commandId: id }, exec), tool.execute({ commandId: id }, exec)]);
    assert.equal(results[0].workflowResult.artifactCount > 0, true);
    assert.deepEqual(results[0], results[1]);
    const count = app.calls.length;
    await tool.execute({ commandId: id }, exec);
    assert.equal(app.calls.length, count);
    assert.equal(app.calls.filter(c => c.name === QCC_DOCUMENT_LOCAL_TOOL_PAIRS[0].parse).length, 1);
    assert.ok(app.calls.every(c => c.parent === exec.token && c.agent === exec.agent));
    const final = (await call(base, 'GET', base + '/' + task.id)).json().task;
    assert.deepEqual(final.fieldSelection, ['reg_capital']);
    assert.equal(final.source.type, 'image');
    assert.equal(final.source.rowCount, 2);
    assert.ok(final.artifacts.some(a => a.format === 'xlsx'));
  } finally { app.dispose(); }
});

test('图片名单路由只暂存原图，Agent-owned 高层工具识别后可轮询结果', async () => {
  const app = harness();
  const capabilities = responseRecorder();
  await app.routes.get('/data-cleaning/api/images/capabilities')(
    request({ url: '/data-cleaning/api/images/capabilities' }),
    capabilities,
  );
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.json().capabilities.ready, true);
  assert.equal(capabilities.json().qccCalls, true);
  assert.equal(capabilities.json().billing, 'current-user-qcc-document-account');

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(24),
  ]);
  const prepared = responseRecorder();
  await app.routes.get('/data-cleaning/api/images/commands')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/images/commands',
      body: { fileName: '名单.png', mimeType: 'image/png', content: png.toString('base64') },
    }),
    prepared,
  );
  assert.equal(prepared.status, 201);
  const command = prepared.json().command;
  assert.match(command.commandId, /^dci-/);
  assert.match(command.prompt, /data_cleaning_extract_image_companies/);
  assert.equal(app.calls.length, 0, '暂存图片不得执行文档解析调用');

  const definition = app.registeredTools.get('data_cleaning_extract_image_companies');
  const agent = { session: { id: 'image-session' } };
  const result = await definition.execute({ commandId: command.commandId }, {
    rootCallId: 'image-root', token: 'image-parent', agent, signal: new AbortController().signal,
  });
  assert.equal(result.entryCount, 2);
  assert.deepEqual(result.entries, [
    '示例企业有限公司 | 91320594088140947F',
    '星际量子（北京）科技有限公司 | 91110108MA01LUR06B',
  ]);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].name, QCC_DOCUMENT_LOCAL_TOOL_PAIRS[0].parse);
  assert.equal(app.calls[0].parent, 'image-parent');
  assert.match(app.calls[0].arguments.file_path, /dci-.*\.png$/);
  assert.equal(app.calls[0].arguments.wait, true);

  const fetched = responseRecorder();
  await app.routes.get('/data-cleaning/api/images/commands')(
    request({ url: `/data-cleaning/api/images/commands/${command.commandId}` }),
    fetched,
  );
  assert.equal(fetched.json().command.state, 'completed');
  assert.equal(fetched.json().command.result.entryCount, 2);
  app.dispose();
});

test('图片路由未连接 OCR 仍返回可用暂存任务与连接提示，取消清理且零调用', async () => {
  const app = harness({ omitDefinitions: QCC_DOCUMENT_LOCAL_TOOL_PAIRS.map((pair) => pair.parse) });
  try {
    const route = app.routes.get('/data-cleaning/api/images/commands');
    const prepared = responseRecorder();
    await route(request({ method: 'POST', url: '/data-cleaning/api/images/commands', body: {
      fileName: '截图.png', content: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(24)]).toString('base64'),
    } }), prepared);
    assert.equal(prepared.status, 201);
    const command = prepared.json().command;
    assert.equal(command.state, 'prepared');
    assert.equal(command.providerReady, false);
    assert.match(command.providerIssue.message, /qcc-document-mcp/);
    assert.match(command.prompt, new RegExp(command.commandId));
    const deleted = responseRecorder();
    await route(request({ method: 'DELETE', url: `/data-cleaning/api/images/commands/${command.commandId}` }), deleted);
    assert.equal(deleted.status, 200);
    const missing = responseRecorder();
    await route(request({ url: `/data-cleaning/api/images/commands/${command.commandId}` }), missing);
    assert.equal(missing.status, 404);
    assert.equal(app.calls.length, 0);
  } finally { app.dispose(); }
});

test('G5 候选和重试仍需显式确认，初始草稿不需要额度确认', async () => {
  const app = harness();
  try {
    for (const kind of ['resolve', 'retry']) {
      const response = responseRecorder();
      await app.routes.get('/data-cleaning/api/g5/commands')(request({
        method: 'POST', url: '/data-cleaning/api/g5/commands', body: { kind, taskId: 'dcw-confirm' },
      }), response);
      assert.equal(response.status, 409);
      assert.equal(response.json().code, 'QCC_CONFIRM_REQUIRED');
    }
    assert.equal(app.calls.length, 0);
  } finally { app.dispose(); }
});

test('G5 Agent command 只在 Host 暂存名单，Agent-owned 工具执行时才调用 QCC', async () => {
  const app = harness();
  const prepared = responseRecorder();
  const input = {
    kind: 'enrich',
    taskId: 'dcw-agent-owned-1',
    rows: [{ name: '敏感企业名称' }],
    headers: ['name'],
    nameField: 'name',
    fieldSelection: ['credit_no', 'legal_rep', 'registered_address'],
  };
  await app.routes.get('/data-cleaning/api/g5/commands')(
    request({ method: 'POST', url: '/data-cleaning/api/g5/commands', body: input }),
    prepared,
  );
  const command = prepared.json().command;
  assert.equal(prepared.status, 201);
  assert.equal(prepared.json().paidCalls, false);
  assert.equal(command.estimate.uniqueCompanies, 1);
  assert.equal(command.estimate.estimatedCalls, 2);
  assert.match(command.prompt, /生成说明不会查询；发送本说明即确认/);
  assert.match(command.commandId, /^dcq-/);
  assert.doesNotMatch(command.prompt, /敏感企业名称/);
  assert.doesNotMatch(command.prompt, /```json|schemaVersion/, '用户可见草稿不应暴露内部 JSON 意图');
  assert.match(command.prompt, /处理数量：1 条企业记录/);
  assert.match(command.prompt, /统一社会信用代码、法定代表人、注册地址/);
  assert.match(command.prompt, new RegExp(`安全任务凭证：${command.commandId}`));
  assert.equal(app.calls.length, 0);

  const definition = app.registeredTools.get('data_cleaning_qcc_run');
  assert.ok(definition);
  assert.equal(definition.output.schema.properties.summary.type, 'object');
  const agent = { session: { id: 'session-agent-owned-1' } };
  const result = await definition.execute({ commandId: command.commandId }, {
    callId: 'outer-command-1',
    rootCallId: 'root-command-1',
    token: 'parent-token-1',
    agent,
    signal: new AbortController().signal,
  });
  assert.equal(result.summary.enriched, 1);
  assert.equal(app.calls.length, 2);
  assert.ok(app.calls.every((call) => call.parent === 'parent-token-1'));
  assert.ok(app.calls.every((call) => call.agent === agent));

  const fetched = responseRecorder();
  await app.routes.get('/data-cleaning/api/g5/commands')(
    request({ url: `/data-cleaning/api/g5/commands/${command.commandId}` }),
    fetched,
  );
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json().command.state, 'completed');
  assert.equal(fetched.json().command.run.rows[0].qcc_match_status, 'enriched');
  assert.deepEqual(fetched.json().command.run.fieldSelection, input.fieldSelection);

  await definition.execute({ commandId: command.commandId }, {
    callId: 'outer-command-duplicate', rootCallId: 'root-command-duplicate', token: 'parent-token-duplicate', agent,
    signal: new AbortController().signal,
  });
  assert.equal(app.calls.length, 2);
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

test('Phase3 estimate 零调用返回三域批量上界', async () => {
  const app = harness();
  const res = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase3/estimate')(
    request({
      method: 'POST',
      url: '/data-cleaning/api/phase3/estimate',
      body: { rows: [{ name: 'A' }, { name: 'A' }, { name: 'B' }], tools: ['get_patent_info'], maxCalls: 10 },
    }),
    res,
  );
  assert.equal(res.status, 200);
  assert.equal(res.json().estimate.uniqueCompanies, 2);
  assert.equal(res.json().estimate.estimatedCalls, 4);
  assert.equal(res.json().estimate.executesTools, false);
  assert.equal(app.calls.length, 0);
  app.dispose();
});

test('Phase3 enrich 要求确认与幂等，三域结果可恢复并导出 CSV', async () => {
  const app = harness();
  const blocked = responseRecorder();
  const body = {
    rows: [{ name: '示例企业' }], headers: ['name'],
    tools: ['get_company_risk_scan', 'get_patent_info', 'get_bidding_info'], maxCalls: 4,
  };
  await app.routes.get('/data-cleaning/api/phase3/enrich')(
    request({ method: 'POST', url: '/data-cleaning/api/phase3/enrich', body }), blocked,
  );
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json().code, 'QCC_CONFIRM_REQUIRED');
  assert.equal(app.calls.length, 0);

  const completed = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase3/enrich')(
    request({ method: 'POST', url: '/data-cleaning/api/phase3/enrich', body: {
      ...body, confirmPaidCalls: true, idempotencyKey: 'phase3-web-enrich-001',
    } }),
    completed,
  );
  const payload = completed.json();
  assert.equal(completed.status, 200);
  assert.equal(payload.marker, 'qcc-phase3-batch');
  assert.equal(payload.state, 'completed');
  assert.equal(payload.summary.enriched, 1);
  assert.equal(payload.summary.actualCalls, 4);
  assert.match(payload.csv, /qcc_phase3_json/);
  assert.match(payload.runId, /^phase3-/);
  assert.equal(app.calls.length, 4);

  const replay = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase3/enrich')(
    request({ method: 'POST', url: '/data-cleaning/api/phase3/enrich', body: {
      ...body, confirmPaidCalls: true, idempotencyKey: 'phase3-web-enrich-001',
    } }), replay,
  );
  assert.equal(replay.json().idempotencyReplayed, true);
  assert.equal(app.calls.length, 4);

  const fetched = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase3/run')(
    request({ url: `/data-cleaning/api/phase3/run/${payload.runId}` }), fetched,
  );
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json().runId, payload.runId);
  app.dispose();
});

test('Phase3 多候选只能从 reviewQueue 选择，续跑不重复主体检索', async () => {
  const app = harness();
  const started = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase3/enrich')(
    request({ method: 'POST', url: '/data-cleaning/api/phase3/enrich', body: {
      rows: [{ name: '模糊企业' }], headers: ['name'], tools: ['get_patent_info'], maxCalls: 2,
      confirmPaidCalls: true, idempotencyKey: 'phase3-ambiguous-start',
    } }), started,
  );
  assert.equal(started.json().state, 'awaiting-review');
  assert.equal(app.calls.length, 1);

  const resolved = responseRecorder();
  await app.routes.get('/data-cleaning/api/phase3/resolve')(
    request({ method: 'POST', url: '/data-cleaning/api/phase3/resolve', body: {
      runId: started.json().runId, companyName: '模糊企业', selectedCreditNo: '9132AMBIG-B',
      confirmPaidCalls: true, idempotencyKey: 'phase3-ambiguous-resolve',
    } }), resolved,
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json().state, 'completed');
  assert.equal(resolved.json().summary.enriched, 1);
  assert.equal(app.calls.filter((call) => call.name === QCC_TOOL_NAMES.entityLookup).length, 1);
  assert.equal(app.calls.length, 2);
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

for (const fault of [
  {
    label: '401 过期授权',
    upstreamCode: '401',
    expectedCode: 'QCC_AUTH_REQUIRED',
    retryable: true,
    connectRequired: true,
  },
  {
    label: '429 限流',
    upstreamCode: '429',
    expectedCode: 'QCC_RATE_LIMITED',
    retryable: true,
    connectRequired: false,
    retryAfterMs: 1_500,
  },
  {
    label: '配额耗尽',
    upstreamCode: 'QUOTA_EXHAUSTED',
    expectedCode: 'QCC_QUOTA_EXHAUSTED',
    retryable: false,
    connectRequired: false,
  },
]) {
  test(`G5 故障注入：${fault.label} 不自动重试并保留安全审计`, async () => {
    const app = harness({ registrationFault: { ...fault, times: 1 } });
    const started = responseRecorder();
    await app.routes.get('/data-cleaning/api/g5/enrich')(
      request({
        method: 'POST',
        url: '/data-cleaning/api/g5/enrich',
        body: {
          idempotencyKey: `fault-${fault.upstreamCode.toLowerCase().replaceAll('_', '-')}-start`,
          confirmPaidCalls: true,
          rows: [{ name: '故障注入企业' }],
          headers: ['name'],
        },
      }),
      started,
    );

    const payload = started.json();
    assert.equal(started.status, 200);
    assert.equal(payload.state, fault.retryable ? 'needs-retry' : 'completed-with-errors');
    assert.equal(payload.errors.length, 1);
    assert.equal(payload.errors[0].error.code, fault.expectedCode);
    assert.equal(payload.errors[0].error.retryable, fault.retryable);
    assert.equal(payload.errors[0].error.connectRequired, fault.connectRequired);
    assert.equal(payload.errors[0].error.upstreamCode, fault.upstreamCode);
    if (fault.retryAfterMs) assert.equal(payload.errors[0].error.details.retryAfterMs, fault.retryAfterMs);
    assert.equal(app.calls.length, 2, 'lookup + one failed registration; no automatic retry');
    assert.equal(app.calls.filter((call) => call.name === QCC_TOOL_NAMES.registration).length, 1);

    const failedAudit = payload.audit.find((event) => event.code === fault.expectedCode);
    assert.ok(failedAudit);
    assert.equal(failedAudit.outcome, 'failed');
    assert.equal(failedAudit.attempt, 1);
    assert.equal(failedAudit.upstreamCode, fault.upstreamCode);
    assert.deepEqual(Object.keys(failedAudit).sort(), [
      'at', 'attempt', 'callId', 'code', 'durationMs', 'event', 'outcome', 'toolName', 'upstreamCode',
    ]);
    assert.doesNotMatch(JSON.stringify(payload.audit), /fault-injection-secret|敏感企业原名|9132WEBMOCK/);

    const retried = responseRecorder();
    await app.routes.get('/data-cleaning/api/g5/retry')(
      request({
        method: 'POST',
        url: '/data-cleaning/api/g5/retry',
        body: {
          idempotencyKey: `fault-${fault.upstreamCode.toLowerCase().replaceAll('_', '-')}-retry`,
          confirmPaidCalls: true,
          runId: payload.runId,
          companyNames: ['故障注入企业'],
        },
      }),
      retried,
    );

    if (fault.retryable) {
      assert.equal(retried.status, 200);
      assert.equal(retried.json().state, 'completed');
      assert.equal(retried.json().errors.length, 0);
      assert.equal(app.calls.length, 4, 'explicit retry reruns lookup + registration exactly once');
    } else {
      assert.equal(retried.status, 409);
      assert.equal(retried.json().code, 'QCC_RETRY_NOT_ALLOWED');
      assert.equal(app.calls.length, 2, 'non-retryable quota failure remains blocked before dispatch');
    }
    app.dispose();
  });
}
async function workflowRequest(app, url, body, method = body === undefined ? 'GET' : 'POST') {
  const response = responseRecorder();
  const route = url.includes('/g5/commands') ? '/data-cleaning/api/g5/commands' : '/data-cleaning/api/workflow/tasks';
  const req = request({ url, body, method });
  req.headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' };
  await app.routes.get(route)(req, response);
  assert.ok(response.status < 300, response.body);
  return response.json();
}

async function stagedWorkflow(app, name = '示例企业有限公司') {
  const base = '/data-cleaning/api/workflow/tasks';
  let { task } = await workflowRequest(app, base, { title: '自动交付测试' });
  const rows = [{ 公司名称: name, 法人: '', 负责人: '', 保留零: 0, 备注: '保留文本' }];
  const headers = Object.keys(rows[0]);
  ({ task } = await workflowRequest(app, base + '/' + task.id + '/actions/upload', {
    expectedRevision: task.revision, source: { type: 'xlsx', fileName: '测试.xlsx', rowCount: 1, columnCount: headers.length, headers },
  }));
  ({ task } = await workflowRequest(app, base + '/' + task.id + '/actions/rules', {
    expectedRevision: task.revision, fieldSelection: ['legal_rep'],
    mappings: [
      { sourceField: '公司名称', targetField: 'company_name' },
      { sourceField: '法人', targetField: 'legal_rep' },
      { sourceField: '负责人', targetField: 'legal_rep' },
      { sourceField: '保留零', targetField: 'legal_rep' },
    ],
  }));
  const payload = { kind: 'enrich', workflowOwned: true, expectedRevision: task.revision, taskId: task.id, rows, headers };
  const { command } = await workflowRequest(app, '/data-cleaning/api/g5/commands', payload);
  return { task, command, payload, rows };
}
function runCommand(app, command) {
  return app.registeredTools.get('data_cleaning_qcc_run').execute({ commandId: command.commandId }, {
    token: 'parent-token', agent: { session: { id: 'test-session' } }, signal: new AbortController().signal,
  });
}

test('Host 单次发送自动交付新 XLSX：多列补空、保留 0、无需页面轮询且重挂载可下载', async () => {
  const storageDomain = memoryStorageDomain(), fs = memoryFs();
  let app = harness({ storageDomain, fs });
  const { task, command, rows } = await stagedWorkflow(app);
  assert.equal(app.calls.length, 0, '生成说明不查询');
  assert.match(command.prompt, /不再询问额度或写回确认/);
  const result = await runCommand(app, command);
  assert.equal(result.deliveryState, 'completed');
  assert.equal(result.artifactCount, 2);
  assert.equal(result.artifacts.length, 2, '零异常只展示主结果和任务报告');
  assert.ok(result.artifacts[0].url.startsWith('http://127.0.0.1:3080/data-cleaning/'), '使用实际 HTTP 协议，不擅自升级 HTTPS');
  assert.ok(!result.artifacts[0].fileName.includes('异常清单'));
  const rendered = app.registeredTools.get('data_cleaning_qcc_run').output.render({}, result)[0].text;
  assert.match(rendered, /已处理.*去重主体/);
  assert.match(rendered, /按输入行统计/);
  const calls = app.calls.length;
  await runCommand(app, command);
  assert.equal(app.calls.length, calls, '同一发送重放不重复扣量');
  const completed = (await workflowRequest(app, '/data-cleaning/api/workflow/tasks/' + task.id)).task;
  assert.equal(completed.state, 'completed');
  assert.equal(rows[0].法人, '', '原始输入不变');
  const xlsx = completed.artifacts.find(a => a.kind === 'complete' && a.format === 'xlsx');
  assert.match(xlsx.fileName, /测试-清洗补全结果\.xlsx$/);
  app.dispose();
  app = harness({ storageDomain, fs });
  const restored = (await workflowRequest(app, '/data-cleaning/api/workflow/tasks/' + task.id)).task;
  assert.equal(restored.artifacts.length, 2);
  // Read actual persisted bytes, as the download service does after restart.
  const { WorkflowArtifactStore } = await import('../lib/artifacts.js');
  const artifactStore = new WorkflowArtifactStore({ fs });
  const bytes = await artifactStore.read(task.id, xlsx);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const output = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  assert.equal(output[0].法人, '张三');
  assert.equal(output[0].负责人, '张三');
  assert.equal(output[0].保留零, 0);
  assert.equal(output[0].备注, '保留文本');
  assert.equal(output[0].公司名称, rows[0].公司名称);
  assert.equal(app.calls.length, 0, '恢复下载不查询');
  app.dispose();
});

test('旧说明的 revision 失效时阻止重复扣量，不破坏已完成任务', async () => {
  const app = harness({ storageDomain: memoryStorageDomain(), fs: memoryFs() });
  const { task, command, payload } = await stagedWorkflow(app);
  const second = (await workflowRequest(app, '/data-cleaning/api/g5/commands', payload)).command;
  await runCommand(app, command);
  const calls = app.calls.length;
  await assert.rejects(runCommand(app, second), { code: 'DC_WORKFLOW_REVISION_CONFLICT' });
  assert.equal(app.calls.length, calls);
  assert.equal((await workflowRequest(app, '/data-cleaning/api/workflow/tasks/' + task.id)).task.state, 'completed');
  app.dispose();
});

test('真正的多候选仍在工作台待确认，选定后 Host 自动交付', async () => {
  const app = harness({ storageDomain: memoryStorageDomain(), fs: memoryFs() });
  const { task, command } = await stagedWorkflow(app, '模糊企业');
  const result = await runCommand(app, command);
  assert.equal(result.deliveryState, 'review_required');
  assert.equal(result.artifactCount, 0);
  const current = (await workflowRequest(app, '/data-cleaning/api/workflow/tasks/' + task.id)).task;
  const next = (await workflowRequest(app, '/data-cleaning/api/g5/commands', {
    kind: 'resolve', workflowOwned: true, expectedRevision: current.revision, taskId: task.id,
    runId: current.qccRunId, companyName: '模糊企业', selectedCreditNo: '9132AMBIG-A', confirmPaidCalls: true,
  })).command;
  assert.equal((await runCommand(app, next)).artifactCount, 2);
  app.dispose();
});

test('Host 写文件失败不伪报完成，命令重放不再扣量', async () => {
  const fs = memoryFs();
  fs.writeText = async () => { throw new Error('disk full'); };
  const app = harness({ storageDomain: memoryStorageDomain(), fs });
  const { task, command } = await stagedWorkflow(app);
  await assert.rejects(runCommand(app, command));
  const calls = app.calls.length;
  await assert.rejects(runCommand(app, command));
  assert.equal(app.calls.length, calls);
  const failed = (await workflowRequest(app, '/data-cleaning/api/workflow/tasks/' + task.id)).task;
  assert.equal(failed.state, 'failed');
  assert.equal(failed.artifacts.length, 0);
  app.dispose();
});
test('部分失败自动提供结果下载但保留 partial，显式重试只重跑失败项', async () => {
  const app = harness({ storageDomain: memoryStorageDomain(), fs: memoryFs(), registrationFault: { times: 1, upstreamCode: '503' } });
  const { task, command } = await stagedWorkflow(app);
  const first = await runCommand(app, command);
  assert.equal(first.deliveryState, 'partial');
  assert.equal(first.artifactCount, 3);
  const current = (await workflowRequest(app, '/data-cleaning/api/workflow/tasks/' + task.id)).task;
  const next = (await workflowRequest(app, '/data-cleaning/api/g5/commands', {
    kind: 'retry', workflowOwned: true, taskId: task.id, runId: current.qccRunId,
    expectedRevision: current.revision, companyNames: ['示例企业有限公司'], confirmPaidCalls: true,
  })).command;
  const result = await runCommand(app, next);
  assert.equal(result.deliveryState, 'completed');
  assert.equal(result.summary.failed, 0);
  app.dispose();
});

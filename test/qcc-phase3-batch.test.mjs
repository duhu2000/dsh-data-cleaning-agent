import assert from 'node:assert/strict';
import test from 'node:test';

import { QCC_TOOL_NAMES, QccHostBridge } from '../lib/qcc.js';
import {
  Phase3BatchService,
  Phase3RunStore,
  estimatePhase3Batch,
  normalizePhase3Selection,
} from '../lib/qcc-phase3-batch.js';

function ok(data) {
  return { isError: false, value: { content: [{ type: 'text', text: JSON.stringify(data) }] } };
}

function failed(code) {
  return { isError: true, error: { message: 'redacted upstream failure', info: { code } } };
}

function harness({ failTool, failTimes = Number.POSITIVE_INFINITY } = {}) {
  const calls = [];
  let failuresRemaining = failTimes;
  const definitions = new Map();
  const names = [
    QCC_TOOL_NAMES.entityLookup,
    'mcp__qcc-risk__get_company_risk_scan',
    'mcp__qcc-ipr__get_patent_info',
    'mcp__qcc-operation__get_bidding_info',
  ];
  for (const name of names) definitions.set(name, { name });
  const tools = {
    get: (name) => definitions.get(name),
    async execute(exec) {
      calls.push(exec);
      if (exec.name === QCC_TOOL_NAMES.entityLookup) {
        if (exec.arguments.searchKey === '模糊企业') return ok({
          匹配结果: '多候选',
          企业信息: [
            { 企业名称: '模糊企业甲', 统一社会信用代码: '9132A' },
            { 企业名称: '模糊企业乙', 统一社会信用代码: '9132B' },
          ],
        });
        if (exec.arguments.searchKey === '未匹配企业') return ok({ 匹配结果: '未匹配' });
        return ok({
          匹配结果: '唯一精确匹配',
          企业信息: { 企业名称: `${exec.arguments.searchKey}有限公司`, 统一社会信用代码: `credit-${exec.arguments.searchKey}` },
        });
      }
      if (exec.name === failTool && failuresRemaining > 0) {
        failuresRemaining -= 1;
        return failed('429');
      }
      return ok({ 原值: `${exec.name}:${exec.arguments.searchKey}` });
    },
  };
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0, pollMs: 1 });
  return { calls, definitions, service: new Phase3BatchService(bridge) };
}

test('selection 统一 canonical/legacy/短名并拒绝契约外工具', () => {
  const selection = normalizePhase3Selection({ tools: [
    'get_company_risk_scan',
    'mcp__ipr__get_patent_info',
    'mcp__qcc-operation__get_bidding_info',
    'get_company_risk_scan',
  ] });
  assert.deepEqual(selection.tools, [
    'mcp__qcc-risk__get_company_risk_scan',
    'mcp__qcc-ipr__get_patent_info',
    'mcp__qcc-operation__get_bidding_info',
  ]);
  assert.throws(() => normalizePhase3Selection({ tools: ['get_not_real'] }), { code: 'QCC_PHASE3_TOOL_INVALID' });
  assert.throws(() => normalizePhase3Selection({ domains: ['history'] }), { code: 'QCC_PHASE3_DOMAIN_INVALID' });
});

test('estimate 是零副作用上界并在调用前执行硬上限', async () => {
  const estimate = estimatePhase3Batch([{ name: 'A' }, { name: 'A' }, { name: '' }], {
    tools: ['get_company_risk_scan', 'get_patent_info'], maxCalls: 6,
  });
  assert.equal(estimate.uniqueCompanies, 1);
  assert.equal(estimate.estimatedCalls, 3);
  assert.equal(estimate.withinLimit, true);
  assert.equal(estimate.executesTools, false);
  const app = harness();
  await assert.rejects(
    app.service.run([{ name: 'A' }, { name: 'B' }], { tools: ['get_company_risk_scan', 'get_patent_info'], maxCalls: 5 }),
    { code: 'QCC_CALL_LIMIT_EXCEEDED' },
  );
  assert.equal(app.calls.length, 0);
});

test('批量三域调用按企业去重，保留原值/sourceTool，歧义项零下游调用', async () => {
  const app = harness();
  const result = await app.service.run([
    { name: '精确企业', source: 'a' },
    { name: '精确企业', source: 'b' },
    { name: '模糊企业' },
    { name: '未匹配企业' },
    { name: '' },
  ], {
    tools: ['get_company_risk_scan', 'get_patent_info', 'get_bidding_info'],
    maxCalls: 20,
    concurrency: 3,
  });
  assert.equal(result.summary.enriched, 2);
  assert.equal(result.summary.ambiguous, 1);
  assert.equal(result.summary.unresolved, 1);
  assert.equal(result.summary.missingName, 1);
  assert.equal(result.summary.actualCalls, 6, '3 lookup + 3 selected tools for the only exact company');
  assert.equal(result.reviewQueue.length, 1);
  const values = JSON.parse(result.rows[0].qcc_phase3_json);
  assert.equal(values.length, 3);
  assert.ok(values.every((item) => item.status === 'success' && item.sourceTool.startsWith('mcp__qcc-')));
  assert.equal(app.calls.filter((call) => call.arguments.searchKey === 'credit-精确企业').length, 3);
});

test('工具部分失败不会丢弃成功原值，且错误可人工重试', async () => {
  const failTool = 'mcp__qcc-ipr__get_patent_info';
  const app = harness({ failTool });
  const result = await app.service.run([{ name: '示例企业' }], {
    tools: ['get_company_risk_scan', 'get_patent_info'], maxCalls: 3,
  });
  assert.equal(result.rows[0].qcc_match_status, 'partial');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].toolName, failTool);
  assert.equal(result.errors[0].error.code, 'QCC_RATE_LIMITED');
  assert.equal(result.errors[0].error.retryable, true);
  assert.equal(result.summary.actualCalls, 3);
});

test('裁判文书详情缺 documentId 时显式降级且不派发详情调用', async () => {
  const app = harness();
  const detail = 'mcp__qcc-risk__get_judicial_document_detail';
  const result = await app.service.run([{ name: '示例企业' }], { tools: [detail], maxCalls: 2 });
  assert.equal(result.rows[0].qcc_match_status, 'failed');
  assert.equal(result.errors[0].error.code, 'QCC_DEPENDENCY_REQUIRED');
  assert.equal(app.calls.length, 1, 'only entity lookup is dispatched');
});

test('选择的工具未注册时在任何付费调用前阻断', async () => {
  const app = harness();
  app.definitions.delete('mcp__qcc-ipr__get_patent_info');
  await assert.rejects(
    app.service.run([{ name: '示例企业' }], { tools: ['get_patent_info'], maxCalls: 2 }),
    (error) => error.code === 'QCC_NOT_CONNECTED' && error.connectRequired,
  );
  assert.equal(app.calls.length, 0);
});

test('Phase3RunStore 生成可恢复快照并在 TTL 后明确失效', () => {
  let now = 1_000;
  const store = new Phase3RunStore({ clock: () => now, ttlMs: 50, runIdFactory: () => 'phase3-test' });
  const snapshot = store.create({ headers: ['name'], nameField: 'name', input: {}, result: {
    estimate: { estimatedCalls: 2 }, selectedTools: ['mcp__qcc-risk__get_company_risk_scan'],
    summary: { totalRows: 1 }, rows: [{ name: 'A', qcc_match_status: 'enriched' }],
    reviewQueue: [], errors: [], companyResults: {}, audit: [], actualCalls: 2,
  } });
  assert.equal(snapshot.runId, 'phase3-test');
  assert.equal(snapshot.state, 'completed');
  assert.equal(snapshot.persistence, 'host-memory');
  now += 51;
  assert.throws(() => store.get('phase3-test'), { code: 'QCC_RUN_NOT_FOUND' });
});

test('Phase3RunStore 人工重试只重放失败工具，不重复主体检索或成功调用', async () => {
  const failedTool = 'mcp__qcc-ipr__get_patent_info';
  const app = harness({ failTool: failedTool, failTimes: 1 });
  const input = { tools: ['get_company_risk_scan', 'get_patent_info'], maxCalls: 5 };
  const result = await app.service.run([{ name: '重试企业' }], input);
  const store = new Phase3RunStore({ runIdFactory: () => 'phase3-retry' });
  const started = store.create({ headers: ['name'], nameField: 'name', input, result });
  assert.equal(started.state, 'needs-retry');
  assert.equal(app.calls.length, 3);

  const retried = await store.retry('phase3-retry', ['重试企业'], app.service);
  assert.equal(retried.state, 'completed');
  assert.equal(retried.summary.enriched, 1);
  assert.equal(retried.summary.actualCalls, 4);
  assert.equal(app.calls.length, 4);
  assert.equal(app.calls.filter((call) => call.name === QCC_TOOL_NAMES.entityLookup).length, 1);
  assert.equal(app.calls.filter((call) => call.name === 'mcp__qcc-risk__get_company_risk_scan').length, 1);
  assert.equal(app.calls.filter((call) => call.name === failedTool).length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QCC_TOOL_NAMES,
  QccBridgeError,
  QccHostBridge,
  classifyEntityMatch,
  decodeQccToolValue,
  mapRegistrationFields,
  mapRiskTags,
} from '../lib/qcc.js';

function success(value) {
  return { isError: false, value, content: [] };
}

function failure(message, code = 'UPSTREAM_ERROR') {
  return { isError: true, error: { message, info: { code } }, content: [] };
}

function mcpValue(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fakeTools(handlers = {}) {
  const calls = [];
  const getCalls = [];
  const definitions = new Map(Object.keys(handlers).map((name) => [name, { name }]));
  return {
    calls,
    getCalls,
    definitions,
    get(name) {
      getCalls.push(name);
      return definitions.get(name);
    },
    async execute(exec) {
      calls.push(exec);
      const handler = handlers[exec.name];
      return handler ? handler(exec) : failure('unknown tool', 'UNKNOWN_TOOL');
    },
  };
}

test('decodeQccToolValue 优先 structuredContent，并兼容 QCC 文本 JSON', () => {
  assert.deepEqual(
    decodeQccToolValue({ structuredContent: { ok: true }, content: [{ type: 'text', text: 'ignored' }] }),
    { ok: true },
  );
  assert.deepEqual(decodeQccToolValue(mcpValue({ 企业名称: '示例企业' })), { 企业名称: '示例企业' });
});

test('Bridge 拒绝调用 QCC allowlist 之外的工具', async () => {
  const tools = fakeTools({ data_clean_rows: async () => success({}) });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.call('data_clean_rows', {}),
    (error) => error instanceof QccBridgeError && error.code === 'QCC_TOOL_NOT_ALLOWED',
  );
  assert.equal(tools.calls.length, 0);
});

test('Bridge 每次调用重新解析工具且使用唯一 callId', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.oauthStatus]: async () => success({ structuredContent: { ok: true } }),
  });
  let sequence = 0;
  const bridge = new QccHostBridge({
    tools,
    toolWaitMs: 0,
    callIdFactory: () => `call-${++sequence}`,
  });
  const first = await bridge.call(QCC_TOOL_NAMES.oauthStatus, {});
  const second = await bridge.call(QCC_TOOL_NAMES.oauthStatus, {});
  assert.deepEqual(first.data, { ok: true });
  assert.deepEqual(second.data, { ok: true });
  assert.deepEqual(tools.calls.map((call) => call.callId), ['call-1', 'call-2']);
  assert.ok(tools.getCalls.filter((name) => name === QCC_TOOL_NAMES.oauthStatus).length >= 2);
});

test('动态工具暂不可用时返回可重试、需连接错误', async () => {
  const tools = fakeTools();
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.call(QCC_TOOL_NAMES.registration, {}, { waitForToolMs: 0 }),
    (error) => error.code === 'QCC_TOOL_UNAVAILABLE' && error.retryable && error.connectRequired,
  );
});

test('get 后遇到 UNKNOWN_TOOL 重注册竞态时只重试该安全失败', async () => {
  let attempt = 0;
  const tools = fakeTools({
    [QCC_TOOL_NAMES.registration]: async () => {
      attempt += 1;
      return attempt === 1
        ? failure('temporarily absent', 'UNKNOWN_TOOL')
        : success(mcpValue({ 企业名称: '示例企业' }));
    },
  });
  let sequence = 0;
  const bridge = new QccHostBridge({
    tools,
    toolWaitMs: 0,
    pollMs: 1,
    callIdFactory: () => `retry-${++sequence}`,
  });
  const result = await bridge.call(QCC_TOOL_NAMES.registration, { searchKey: '示例企业' });
  assert.equal(result.data.企业名称, '示例企业');
  assert.equal(tools.calls.length, 2);
  assert.notEqual(tools.calls[0].callId, tools.calls[1].callId);
});

test('非 UNKNOWN_TOOL 的 isError 被归一化且不自动重试', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.registration]: async () => failure('quota exhausted', 'QUOTA_EXHAUSTED'),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.call(QCC_TOOL_NAMES.registration, { searchKey: '示例企业' }),
    (error) => error.code === 'QCC_TOOL_FAILED' && error.upstreamCode === 'QUOTA_EXHAUSTED' && !error.retryable,
  );
  assert.equal(tools.calls.length, 1);
});

test('调用方取消被归一化为 QCC_ABORTED', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.registration]: async () => success(mcpValue({})),
  });
  const controller = new AbortController();
  controller.abort(new Error('user cancelled'));
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.call(QCC_TOOL_NAMES.registration, {}, { signal: controller.signal }),
    (error) => error.code === 'QCC_ABORTED',
  );
  assert.equal(tools.calls.length, 0);
});

test('Bridge 自有超时被归一化为 QCC_TIMEOUT', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.registration]: (exec) => new Promise((resolve) => {
      exec.signal.addEventListener('abort', () => resolve(failure('aborted', 'ABORTED')), { once: true });
    }),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.call(QCC_TOOL_NAMES.registration, {}, { timeoutMs: 10 }),
    (error) => error.code === 'QCC_TIMEOUT' && error.retryable,
  );
});

test('实体匹配严格区分唯一、多候选和未匹配', () => {
  assert.deepEqual(classifyEntityMatch({
    匹配结果: '唯一精确匹配',
    企业信息: { 企业名称: '企查查科技股份有限公司', 统一社会信用代码: '9132MOCK' },
  }), { status: 'exact', companyName: '企查查科技股份有限公司', creditNo: '9132MOCK' });

  const ambiguous = classifyEntityMatch({
    匹配结果: '多候选',
    企业信息: [{ 企业名称: '示例一', 统一社会信用代码: 'A', 法定代表人名称: ['甲'] }],
  });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates[0].companyName, '示例一');
  assert.deepEqual(classifyEntityMatch({ 匹配结果: '未匹配' }), { status: 'unresolved' });
});

test('工商字段与风险标签按 QCC 返回原文映射，不自行计算', () => {
  assert.deepEqual(mapRegistrationFields({
    统一社会信用代码: '9132MOCK',
    法定代表人: '张三',
    注册资本: '1,000万元人民币',
    成立日期: '2020-01-02',
    登记状态: '存续',
  }), {
    credit_no: '9132MOCK',
    legal_rep: '张三',
    reg_capital: '1,000万元人民币',
    establish_date: '2020-01-02',
    reg_status: '存续',
    biz_status: '',
  });
  assert.equal(mapRiskTags({
    风险因子扫描: [
      { 风险因子: '行政处罚', 条目数: 2 },
      { 风险因子: '失信信息', 条目数: 0 },
      { 风险因子: '裁判文书', 条目数: '3' },
    ],
  }), '行政处罚:2；裁判文书:3');
});

test('批量补全去重调用，精确项补全，多候选暂停，未匹配保留', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.entityLookup]: async (exec) => {
      const name = exec.arguments.searchKey;
      if (name === '精确企业') return success(mcpValue({
        匹配结果: '唯一精确匹配',
        企业信息: { 企业名称: '精确企业有限公司', 统一社会信用代码: '9132EXACT' },
      }));
      if (name === '模糊企业') return success(mcpValue({
        匹配结果: '多候选',
        企业信息: [
          { 企业名称: '模糊企业一', 统一社会信用代码: 'A' },
          { 企业名称: '模糊企业二', 统一社会信用代码: 'B' },
        ],
      }));
      return success(mcpValue({ 匹配结果: '未匹配' }));
    },
    [QCC_TOOL_NAMES.registration]: async (exec) => success(mcpValue({
      企业名称: '精确企业有限公司',
      统一社会信用代码: exec.arguments.searchKey,
      法定代表人: '张三',
      注册资本: '500万元人民币',
      成立日期: '2022-02-02',
      登记状态: '存续',
    })),
    [QCC_TOOL_NAMES.riskScan]: async () => success(mcpValue({
      风险因子扫描: [{ 风险因子: '行政处罚', 条目数: 1 }],
    })),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  const result = await bridge.enrichRows([
    { name: '精确企业', source: 'a' },
    { name: '精确企业', source: 'b' },
    { name: '模糊企业' },
    { name: '不存在企业' },
    { name: '' },
  ], { includeRisk: true, concurrency: 3 });

  assert.deepEqual(result.summary, {
    totalRows: 5,
    uniqueCompanies: 3,
    enriched: 2,
    ambiguous: 1,
    unresolved: 1,
    failed: 0,
    missingName: 1,
    includeRisk: true,
  });
  assert.equal(result.rows[0].credit_no, '9132EXACT');
  assert.equal(result.rows[1].risk_tags, '行政处罚:1');
  assert.equal(result.rows[2].qcc_match_status, 'ambiguous');
  assert.equal(result.reviewQueue.length, 1);
  assert.deepEqual(result.reviewQueue[0].rowIndexes, [2]);
  assert.equal(result.rows[3].qcc_match_status, 'unresolved');
  assert.equal(result.rows[4].qcc_match_status, 'missing-name');

  assert.equal(tools.calls.filter((call) => call.name === QCC_TOOL_NAMES.entityLookup).length, 3);
  assert.equal(tools.calls.filter((call) => call.name === QCC_TOOL_NAMES.registration).length, 1);
  assert.equal(tools.calls.filter((call) => call.name === QCC_TOOL_NAMES.riskScan).length, 1);
  assert.equal(
    tools.calls.find((call) => call.name === QCC_TOOL_NAMES.registration).arguments.searchKey,
    '9132EXACT',
  );
});

test('单企业失败不会中断其余批次，错误不包含工具原始响应', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.entityLookup]: async (exec) => success(mcpValue({
      匹配结果: '唯一精确匹配',
      企业信息: { 企业名称: exec.arguments.searchKey, 统一社会信用代码: exec.arguments.searchKey },
    })),
    [QCC_TOOL_NAMES.registration]: async (exec) => exec.arguments.searchKey === '失败企业'
      ? failure('upstream failed', 'UPSTREAM_FAILURE')
      : success(mcpValue({ 企业名称: '成功企业', 统一社会信用代码: '成功企业' })),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  const result = await bridge.enrichRows([{ name: '失败企业' }, { name: '成功企业' }]);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.enriched, 1);
  assert.equal(result.errors[0].error.code, 'QCC_TOOL_FAILED');
  assert.equal('data' in result.errors[0].error, false);
});

test('未连接时在任何计费调用前阻断并给出连接引导语义', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.oauthConnect]: async () => success({ ok: true }),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.enrichRows([{ name: '示例企业' }], { waitForToolMs: 0 }),
    (error) => error.code === 'QCC_NOT_CONNECTED' && error.connectRequired,
  );
  assert.equal(tools.calls.length, 0);
});

test('批量上限在调用前强制执行', async () => {
  const tools = fakeTools();
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.enrichRows([{ name: 'A' }, { name: 'B' }], { maxRows: 1 }),
    (error) => error.code === 'QCC_BATCH_TOO_LARGE',
  );
  assert.equal(tools.calls.length, 0);
});

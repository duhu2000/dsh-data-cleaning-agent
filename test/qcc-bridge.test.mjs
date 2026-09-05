import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QCC_TOOL_NAMES,
  QccBridgeError,
  QccHostBridge,
  classifyEntityMatch,
  decodeQccToolValue,
  estimateQccCalls,
  inspectRelatedRiskCatalog,
  inspectSelfRiskCatalog,
  mapCompanyRelatedRiskScanFields,
  mapCompanyRiskScanFields,
  mapContactFields,
  mapImportExportCreditFields,
  mapListingFields,
  mapProfileFields,
  mapRegistrationFields,
  mapRiskTags,
  mapTaxInvoiceFields,
  sourceToolsForFieldSelection,
} from '../lib/qcc.js';

import {
  QCC_PHASE3_ALL_CANONICAL_TOOLS,
} from '../lib/qcc-phase3.js';
import {
  RELATED_RISK_FACTORS,
  RELATED_RISK_KEY_FACTORS,
  RISK_FACTOR_CATALOG_VERSION,
  SELF_RISK_FACTORS,
} from '../lib/qcc-field-catalog.js';

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

test('Agent-owned 调用把父执行 token 与 Session 传给 DSH nested ToolRuntime', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.entityLookup]: async () => success(mcpValue({ 匹配结果: '未匹配' })),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  const agent = { session: { id: 'session-1' } };
  await bridge.call(QCC_TOOL_NAMES.entityLookup, { searchKey: '示例企业' }, {
    execution: {
      rootCallId: 'root-1',
      token: 'parent-token-1',
      agent,
    },
  });
  assert.equal(tools.calls[0].rootCallId, 'root-1');
  assert.equal(tools.calls[0].parent, 'parent-token-1');
  assert.equal(tools.calls[0].agent, agent);
});

test('Bridge 兼容 qcc-dsh-mcp-oauth 0.1.7 的 legacy serverName', async () => {
  const legacy = 'mcp__company__get_company_registration_info';
  const tools = fakeTools({
    [legacy]: async () => success(mcpValue({ 企业名称: '示例企业' })),
  });
  const originalGet = tools.get.bind(tools);
  tools.get = (name) => {
    if (name === QCC_TOOL_NAMES.registration) throw new Error('canonical name absent during legacy refresh');
    return originalGet(name);
  };
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  const result = await bridge.call(QCC_TOOL_NAMES.registration, { searchKey: '示例企业' });
  assert.equal(result.toolName, legacy);
  assert.equal(tools.calls[0].name, legacy);
  assert.equal(bridge.capabilities().registration, true);
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

test('重注册重试后工具消失时，未派发审计不沿用上一 callId', async () => {
  const audit = [];
  const tools = fakeTools({
    [QCC_TOOL_NAMES.registration]: async () => {
      tools.definitions.delete(QCC_TOOL_NAMES.registration);
      return failure('temporarily absent', 'UNKNOWN_TOOL');
    },
  });
  const bridge = new QccHostBridge({
    tools,
    toolWaitMs: 0,
    pollMs: 1,
    callIdFactory: () => 'first-dispatch',
  });

  await assert.rejects(
    bridge.call(QCC_TOOL_NAMES.registration, {}, { onAudit: (event) => audit.push(event) }),
    (error) => error.code === 'QCC_TOOL_UNAVAILABLE',
  );
  assert.equal(audit.length, 2);
  assert.equal(audit[0].outcome, 'refresh-race');
  assert.equal(audit[0].callId, 'first-dispatch');
  assert.equal(audit[1].outcome, 'not-dispatched');
  assert.equal(audit[1].callId, '');
});

test('配额错误被归一化且不自动重试', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.registration]: async () => failure('quota exhausted', 'QUOTA_EXHAUSTED'),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.call(QCC_TOOL_NAMES.registration, { searchKey: '示例企业' }),
    (error) => error.code === 'QCC_QUOTA_EXHAUSTED' && error.upstreamCode === 'QUOTA_EXHAUSTED' && !error.retryable,
  );
  assert.equal(tools.calls.length, 1);
});

test('401、429、403、5xx 与非法请求映射为稳定安全错误', async () => {
  const cases = [
    ['401', 'QCC_AUTH_REQUIRED', true, true],
    ['RATE_LIMITED', 'QCC_RATE_LIMITED', true, false],
    ['FORBIDDEN', 'QCC_PERMISSION_DENIED', false, false],
    ['503', 'QCC_UPSTREAM_UNAVAILABLE', true, false],
    ['INVALID_ARGUMENT', 'QCC_UPSTREAM_REJECTED', false, false],
  ];
  for (const [upstream, expected, retryable, connectRequired] of cases) {
    const tools = fakeTools({
      [QCC_TOOL_NAMES.registration]: async () => failure('Bearer secret-token 企业原始名单', upstream),
    });
    const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
    await assert.rejects(
      bridge.call(QCC_TOOL_NAMES.registration, { searchKey: '示例企业' }),
      (error) => {
        assert.equal(error.code, expected);
        assert.equal(error.retryable, retryable);
        assert.equal(error.connectRequired, connectRequired);
        assert.doesNotMatch(error.message, /secret-token|企业原始名单/);
        return true;
      },
    );
    assert.equal(tools.calls.length, 1);
  }
});

test('ToolRuntime 未提供结构化错误码时只从文本提取安全分类，不泄露原文', async () => {
  const cases = [
    ['Error: only `run_code` is callable directly — secret-token 敏感企业', 'QCC_EXECUTION_DENIED', 'DSH_EXECUTION_DENIED'],
    ['MCP error -32602: invalid arguments — secret-token 敏感企业', 'QCC_UPSTREAM_REJECTED', 'INVALID_ARGUMENT'],
    ['HTTP 429 too many requests — secret-token 敏感企业', 'QCC_RATE_LIMITED', '429'],
    ['opaque upstream failure — secret-token 敏感企业', 'QCC_TOOL_FAILED', 'UNCLASSIFIED_TOOL_ERROR'],
  ];
  for (const [message, expectedCode, expectedUpstreamCode] of cases) {
    const tools = fakeTools({
      [QCC_TOOL_NAMES.registration]: async () => ({ isError: true, error: { message }, content: [] }),
    });
    const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
    await assert.rejects(
      bridge.call(QCC_TOOL_NAMES.registration, { searchKey: '示例企业' }),
      (error) => {
        assert.equal(error.code, expectedCode);
        assert.equal(error.upstreamCode, expectedUpstreamCode);
        assert.doesNotMatch(JSON.stringify(error.toJSON()), /secret-token|敏感企业/);
        return true;
      },
    );
  }
});

test('调用审计只记录安全元数据，不记录参数或工具响应', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.registration]: async () => success(mcpValue({ 统一社会信用代码: '9132SECRET' })),
  });
  const audit = [];
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0, callIdFactory: () => 'audit-call-1' });
  await bridge.call(QCC_TOOL_NAMES.registration, { searchKey: '敏感企业名称' }, { onAudit: (event) => audit.push(event) });
  assert.equal(audit.length, 1);
  assert.deepEqual(Object.keys(audit[0]).sort(), [
    'at', 'attempt', 'callId', 'code', 'durationMs', 'event', 'outcome', 'toolName', 'upstreamCode',
  ]);
  assert.equal(JSON.stringify(audit).includes('敏感企业名称'), false);
  assert.equal(JSON.stringify(audit).includes('9132SECRET'), false);
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

test('工商、画像字段与风险标签按 QCC 返回原文映射，不推导不存在的层级或行政区', () => {
  const fields = mapRegistrationFields({
    企业名称: '企查查科技股份有限公司',
    统一社会信用代码: '9132MOCK',
    法定代表人: '张三',
    注册资本: '1,000万元人民币',
    成立日期: '2020-01-02',
    登记状态: '存续',
    注册地址: '江苏省苏州市工业园区月亮湾路 10 号',
    所属地区: '江苏省苏州市工业园区',
    通信地址: '江苏省苏州市工业园区通信路 1 号',
    经营范围: '软件开发',
    国标行业: '信息技术服务业',
    营业期限: '2020-01-02至长期',
    人员规模: '1000-1999人',
    参保人数: '1234',
    分支机构参保人数: '12',
  });
  assert.equal(fields.credit_no, '9132MOCK');
  assert.equal(fields.legal_rep, '张三');
  assert.equal(fields.reg_capital, '1,000万元人民币');
  assert.equal(fields.registered_address, '江苏省苏州市工业园区月亮湾路 10 号');
  assert.equal(fields.region, '江苏省苏州市工业园区');
  assert.equal(fields.mailing_address, '江苏省苏州市工业园区通信路 1 号');
  assert.equal(fields.business_scope, '软件开发');
  assert.equal(fields.industry_category, '信息技术服务业');
  assert.equal(fields.operating_period, '2020-01-02至长期');
  assert.equal(fields.company_size, '1000-1999人');
  assert.equal(fields.insured_count, '1234');
  assert.equal(fields.branch_insured_count, '12');
  assert.deepEqual(mapProfileFields({ 简介: '企业简介原文', 企查查行业: 'IT技术服务', 产业链概览: '产业链原文' }), {
    qcc_industry: 'IT技术服务',
    company_profile: '企业简介原文',
    industry_chain_overview: '产业链原文',
  });
  assert.equal(mapRiskTags({
    风险因子扫描: [
      { 风险因子: '行政处罚', 条目数: 2 },
      { 风险因子: '失信信息', 条目数: 0 },
      { 风险因子: '裁判文书', 条目数: '3' },
    ],
  }), '行政处罚:2；裁判文书:3');
});

test('第一批 40 字段按固定一对一规则投影，不泄漏明细数组', () => {
  assert.deepEqual(mapContactFields({
    联系方式信息: {
      电话: [
        { 电话号码: '010-12345678', 是否无效: '是', 标签: ['总机', '客服'] },
        { 电话号码: '010-87654321', 标签: ['历史'] },
      ],
      邮箱: [{ 邮箱: 'main@example.com' }, { 邮箱: 'other@example.com' }],
      网址: [
        { 网址: 'https://not-official.example', 是否是官网: '否', ICP备案: '否' },
        { 网址: 'https://official.example', 是否是官网: '是', ICP备案: '是' },
      ],
    },
  }), {
    contact_preferred_phone: '010-12345678',
    contact_phone_invalid_flag: '是',
    contact_phone_tags: '总机；客服',
    contact_preferred_email: 'main@example.com',
    contact_official_website: 'https://official.example',
    contact_official_website_icp: '是',
  });
  assert.equal(mapListingFields({ 股票代码: '000001', 总市值: '123.4', 是否注册制: '否' }).listing_stock_code, '000001');
  assert.deepEqual(mapTaxInvoiceFields({ 企业名称: '示例公司', 纳税人识别号: '00123', 地址: '开票地址', 开户行账号: '0000123' }), {
    tax_company_name: '示例公司', tax_identification_no: '00123', tax_company_type: '', tax_business_status: '',
    invoice_address: '开票地址', invoice_phone: '', invoice_bank: '', invoice_bank_account: '0000123',
  });
  const importExport = mapImportExportCreditFields({
    统一社会信用代码: '9132EXAMPLE', 所在地海关: '苏州海关', 信用等级: 'A', 海关资质: [{ 备案编码: 'array-must-not-leak' }],
  });
  assert.equal(importExport.import_export_credit_no, '9132EXAMPLE');
  assert.equal(importExport.import_export_customs, '苏州海关');
  assert.equal(importExport.import_export_credit_grade, 'A');
  assert.equal(JSON.stringify(importExport).includes('array-must-not-leak'), false);
});

test('第二批 58 风险字段稳定透视计数并检测目录漂移', () => {
  const selfValue = {
    有记录因子数: 2,
    无记录因子数: SELF_RISK_FACTORS.length - 2,
    风险因子扫描: SELF_RISK_FACTORS.map(([, label], index) => ({ 风险因子: label, 条目数: index < 2 ? index + 1 : 0, 明细工具: 'ignored' })),
  };
  const self = mapCompanyRiskScanFields(selfValue);
  assert.equal(Object.keys(self).length, 38);
  assert.equal(self.risk_dishonest_count, 1);
  assert.equal(self.risk_judgment_debtor_count, 2);
  assert.equal(self.risk_hit_summary, '失信信息(1)；被执行人(2)');
  assert.deepEqual(inspectSelfRiskCatalog(selfValue).missing, []);
  assert.deepEqual(inspectSelfRiskCatalog(selfValue).unknown, []);
  assert.deepEqual(inspectSelfRiskCatalog({ 风险因子扫描: [{ 风险因子: '新增因子', 条目数: 1 }] }).unknown, ['新增因子']);

  const relatedValue = {
    有风险关联方数: '3',
    维度计数汇总: {
      重要风险: Object.fromEntries(RELATED_RISK_FACTORS.map(([, label], index) => [label, index === 0 ? '4' : '0'])),
      司法案件: [{ 类型: '数组不得输出', 条目数: '9' }],
      其他关联风险: [{ 类型: '数组不得输出', 条目数: '8' }],
    },
    重点维度关联方定位: RELATED_RISK_KEY_FACTORS.map(([, label], index) => ({
      维度: label, 本维度条目数: index === 0 ? '4' : '0', 命中关联方数: index === 0 ? '2' : '0',
      关联方: [{ 名称: '数组不得输出' }],
    })),
  };
  const related = mapCompanyRelatedRiskScanFields(relatedValue);
  assert.equal(Object.keys(related).length, 20);
  assert.equal(related.related_risk_party_count, 3);
  assert.equal(related.related_risk_dishonest_count, 4);
  assert.equal(related.related_risk_dishonest_party_count, 2);
  assert.equal(JSON.stringify(related).includes('数组不得输出'), false);
  assert.deepEqual(inspectRelatedRiskCatalog(relatedValue).missing, []);
  assert.deepEqual(inspectRelatedRiskCatalog(relatedValue).unknown, []);
});

test('风险目录漂移审计保留版本及缺失/新增标签，不包含工具原始响应', async () => {
  const expectedImportant = Object.fromEntries(RELATED_RISK_FACTORS.map(([, label]) => [label, '0']));
  delete expectedImportant.欠税公告;
  expectedImportant.生产新增风险 = '1';
  const audit = [];
  const tools = fakeTools({
    [QCC_TOOL_NAMES.entityLookup]: async () => success(mcpValue({
      匹配结果: '唯一精确匹配', 企业信息: { 企业名称: '示例企业', 统一社会信用代码: '9132AUDIT' },
    })),
    [QCC_TOOL_NAMES.relatedRiskScan]: async () => success(mcpValue({
      有风险关联方数: '1',
      维度计数汇总: { 重要风险: expectedImportant },
      重点维度关联方定位: RELATED_RISK_KEY_FACTORS.map(([, label]) => ({ 维度: label, 命中关联方数: '0' })),
      原始明细: '不得进入审计',
    })),
  });
  await new QccHostBridge({ tools, toolWaitMs: 0 }).enrichRows([{ name: '示例企业' }], {
    fieldSelection: ['related_risk_party_count'],
    onAudit: (event) => audit.push(event),
  });
  const drift = audit.find((event) => event.outcome === 'catalog-drift');
  assert.equal(drift.catalogVersion, RISK_FACTOR_CATALOG_VERSION);
  assert.deepEqual(drift.missing, ['重要风险:欠税公告']);
  assert.deepEqual(drift.unknown, ['重要风险:生产新增风险']);
  assert.equal(JSON.stringify(drift).includes('不得进入审计'), false);
});

test('字段选择精确计算来源工具，同一工具多个字段只调用一次', () => {
  assert.deepEqual(sourceToolsForFieldSelection([
    'contact_preferred_phone', 'contact_preferred_email', 'listing_stock_code',
    'invoice_bank', 'import_export_credit_grade', 'risk_dishonest_count',
    'related_risk_party_count',
  ]), [
    'get_contact_info', 'get_listing_info', 'get_tax_invoice_info', 'get_import_export_credit',
    'get_company_risk_scan', 'get_company_related_risk_scan',
  ]);
  assert.deepEqual(estimateQccCalls(2, [
    'contact_preferred_phone', 'contact_preferred_email', 'risk_dishonest_count',
  ]), {
    uniqueCompanies: 2,
    sourceTools: ['get_contact_info', 'get_company_risk_scan'],
    callsPerCompany: 3,
    estimatedCalls: 6,
  });
});

test('Bridge 跨第一、二批字段只调用所选 6 个来源工具且输出全为标量', async () => {
  const selfRows = SELF_RISK_FACTORS.map(([, label]) => ({ 风险因子: label, 条目数: label === '行政处罚' ? 2 : 0 }));
  const relatedImportant = Object.fromEntries(RELATED_RISK_FACTORS.map(([, label]) => [label, label === '经营异常' ? '1' : '0']));
  const relatedLocating = RELATED_RISK_KEY_FACTORS.map(([, label]) => ({ 维度: label, 命中关联方数: '0', 关联方: [] }));
  const tools = fakeTools({
    [QCC_TOOL_NAMES.entityLookup]: async () => success(mcpValue({
      匹配结果: '唯一精确匹配', 企业信息: { 企业名称: '示例企业', 统一社会信用代码: '9132SELECTED' },
    })),
    [QCC_TOOL_NAMES.contact]: async (exec) => success(mcpValue({ 联系方式信息: { 电话: [{ 电话号码: '010-1', 标签: [] }], 邮箱: [], 网址: [] } })),
    [QCC_TOOL_NAMES.listing]: async () => success(mcpValue({ 股票代码: '000001' })),
    [QCC_TOOL_NAMES.taxInvoice]: async () => success(mcpValue({ 开户行: '示例银行' })),
    [QCC_TOOL_NAMES.importExportCredit]: async () => success(mcpValue({ 信用等级: 'A' })),
    [QCC_TOOL_NAMES.riskScan]: async () => success(mcpValue({ 有记录因子数: 1, 无记录因子数: 34, 风险因子扫描: selfRows })),
    [QCC_TOOL_NAMES.relatedRiskScan]: async () => success(mcpValue({
      有风险关联方数: '1', 维度计数汇总: { 重要风险: relatedImportant }, 重点维度关联方定位: relatedLocating,
    })),
  });
  const fieldSelection = [
    'contact_preferred_phone', 'listing_stock_code', 'invoice_bank', 'import_export_credit_grade',
    'risk_administrative_penalty_count', 'related_risk_operating_exception_count',
  ];
  const result = await new QccHostBridge({ tools, toolWaitMs: 0 }).enrichRows([{ name: '示例企业' }], { fieldSelection });
  assert.deepEqual(tools.calls.map((call) => call.name), [
    QCC_TOOL_NAMES.entityLookup, QCC_TOOL_NAMES.contact, QCC_TOOL_NAMES.listing, QCC_TOOL_NAMES.taxInvoice,
    QCC_TOOL_NAMES.importExportCredit, QCC_TOOL_NAMES.riskScan, QCC_TOOL_NAMES.relatedRiskScan,
  ]);
  assert.equal(tools.calls[1].arguments.excludeInvalidPhone, false);
  assert.equal(result.rows[0].contact_preferred_phone, '010-1');
  assert.equal(result.rows[0].listing_stock_code, '000001');
  assert.equal(result.rows[0].invoice_bank, '示例银行');
  assert.equal(result.rows[0].import_export_credit_grade, 'A');
  assert.equal(result.rows[0].risk_administrative_penalty_count, 2);
  assert.equal(result.rows[0].related_risk_operating_exception_count, 1);
  for (const value of Object.values(result.rows[0])) assert.equal(typeof value === 'object' && value !== null, false);
});

test('所选工商和画像字段全部落列，国标行业与企查查行业分别映射', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.entityLookup]: async () => success(mcpValue({
      匹配结果: '唯一精确匹配',
      企业信息: { 企业名称: '示例企业', 统一社会信用代码: '9132FULL' },
    })),
    [QCC_TOOL_NAMES.registration]: async () => success(mcpValue({
      企业名称: '示例企业', 统一社会信用代码: '9132FULL', 登记状态: '存续',
      法定代表人: '李某', 注册资本: '500万元', 成立日期: '2020-01-01',
      注册地址: '北京市朝阳区示例路', 所属地区: '北京市朝阳区', 经营范围: '软件开发',
      营业期限: '2020-01-01至长期', 人员规模: '100-499人', 国标行业: '软件和信息技术服务业',
    })),
    [QCC_TOOL_NAMES.profile]: async () => success(mcpValue({ 简介: '一家软件企业', 企查查行业: 'IT技术服务', 产业链概览: '软件服务产业链' })),
  });
  const fieldSelection = [
    'credit_no', 'reg_status', 'legal_rep', 'reg_capital', 'establish_date', 'registered_address',
    'region', 'business_scope', 'industry_category', 'qcc_industry', 'operating_period',
    'company_size', 'company_profile', 'industry_chain_overview',
  ];
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  const result = await bridge.enrichRows([{ name: '示例企业' }], { fieldSelection });
  assert.deepEqual(Object.keys(result.rows[0]).filter((key) => fieldSelection.includes(key)), fieldSelection);
  assert.equal(result.rows[0].registered_address, '北京市朝阳区示例路');
  assert.equal(result.rows[0].region, '北京市朝阳区');
  assert.equal(result.rows[0].industry_category, '软件和信息技术服务业');
  assert.equal(result.rows[0].qcc_industry, 'IT技术服务');
  assert.equal(result.rows[0].company_profile, '一家软件企业');
  assert.equal(result.rows[0].industry_chain_overview, '软件服务产业链');
  assert.equal(Object.hasOwn(result.rows[0], 'industry_large'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'industry_middle'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'risk_tags'), false);
  assert.equal(tools.calls.filter((call) => call.name === QCC_TOOL_NAMES.profile).length, 1);
});

test('人工锁定候选后只调用工商与可选风险，不重复实体检索', async () => {
  const tools = fakeTools({
    [QCC_TOOL_NAMES.entityLookup]: async () => {
      throw new Error('should not run lookup');
    },
    [QCC_TOOL_NAMES.registration]: async (exec) => success(mcpValue({
      企业名称: '候选企业一',
      统一社会信用代码: exec.arguments.searchKey,
      登记状态: '存续',
    })),
    [QCC_TOOL_NAMES.riskScan]: async () => success(mcpValue({ 风险因子扫描: [] })),
  });
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  const result = await bridge.enrichLockedCompany({ companyName: '候选企业一', creditNo: '9132LOCKED' }, {
    includeRisk: true,
  });
  assert.equal(result.status, 'enriched');
  assert.equal(result.fields.credit_no, '9132LOCKED');
  assert.deepEqual(tools.calls.map((call) => call.name), [QCC_TOOL_NAMES.registration, QCC_TOOL_NAMES.riskScan]);
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

test('调用量上限在任何 QCC 调用前强制执行', async () => {
  const tools = fakeTools();
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  await assert.rejects(
    bridge.enrichRows([{ name: 'A' }, { name: 'B' }], {
      fieldSelection: ['contact_preferred_phone', 'listing_stock_code'],
      maxCalls: 5,
    }),
    (error) => error.code === 'QCC_CALL_BUDGET_EXCEEDED' && error.details.estimatedCalls === 6,
  );
  assert.equal(tools.calls.length, 0);
});

test('phase3Capabilities 只读注册表，不执行工具、不产生付费调用', () => {
  const handlers = Object.fromEntries(
    QCC_PHASE3_ALL_CANONICAL_TOOLS.map((name) => [name, async () => success({})]),
  );
  const tools = fakeTools(handlers);
  const bridge = new QccHostBridge({ tools, toolWaitMs: 0 });
  const caps = bridge.phase3Capabilities();
  assert.equal(caps.total, 91);
  assert.equal(caps.totalRegistered, 91);
  assert.equal(caps.ready, true);
  assert.equal(caps.byDomain.risk.total, 38);
  assert.equal(caps.byDomain.ipr.total, 18);
  assert.equal(caps.byDomain.operation.total, 35);
  assert.equal(caps.byDomain.risk.registered, 38);
  assert.equal(caps.byDomain.ipr.registered, 18);
  assert.equal(caps.byDomain.operation.registered, 35);
  // 每个工具都标记为 basic + paid + 需确认，且 runtimeName 用规范名回填
  for (const tool of caps.byDomain.risk.tools) {
    assert.equal(tool.registered, true);
    assert.match(tool.canonical, /^mcp__qcc-risk__/);
  }
  // 预检不得触发任何 execute
  assert.equal(tools.calls.length, 0);
});

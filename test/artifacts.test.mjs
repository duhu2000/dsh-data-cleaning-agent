import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { ARTIFACT_STORAGE, WorkflowArtifactStore, deriveExceptionRows } from '../lib/artifacts.js';
import { FIELD_CATALOG } from '../lib/workflow-contract.js';

function memoryFs() {
  const files = new Map();
  return {
    files,
    async resolve(path) { return { key: path, displayPath: `/workspace/${path}` }; },
    async writeText(target, content) { files.set(target.key, Buffer.from(content, 'utf8')); },
    async readBytes(target, _signal, maxBytes) {
      const bytes = files.get(target.key);
      if (!bytes) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' });
      if (bytes.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' });
      return bytes;
    },
  };
}

test('Host 生成可校验的 CSV、真实 XLSX 与异常清单四件套', async () => {
  const fs = memoryFs();
  let id = 0;
  const store = new WorkflowArtifactStore({
    fs,
    nowFn: () => '2026-09-03T12:00:00.000Z',
    idFactory: () => `dca-test-000${++id}`,
  });
  const rows = [
    { 企业名称: '甲公司', qcc_match_status: 'exact', 法定代表人: '张三' },
    { 企业名称: '乙公司', qcc_match_status: 'candidate', 法定代表人: '' },
  ];
  const artifacts = await store.createBundle('dcw-test-0001', {
    rows,
    headers: ['企业名称', 'qcc_match_status', '法定代表人'],
    baseName: '供应商/补全结果',
  });
  assert.equal(artifacts.length, 4);
  assert.deepEqual(artifacts.map((item) => `${item.kind}:${item.format}`), [
    'complete:csv', 'complete:xlsx', 'review:csv', 'review:xlsx',
  ]);
  assert.ok(artifacts.every((item) => item.checksum.startsWith('sha256:')));
  assert.ok(artifacts.every((item) => !item.fileName.includes('/')));

  const resultWorkbookBytes = await store.read('dcw-test-0001', artifacts[1]);
  const resultWorkbook = XLSX.read(resultWorkbookBytes, { type: 'buffer' });
  assert.deepEqual(resultWorkbook.SheetNames, ['清洗补全结果']);
  const resultRows = XLSX.utils.sheet_to_json(resultWorkbook.Sheets['清洗补全结果'], { defval: '' });
  assert.equal(resultRows.length, 2);
  assert.equal(resultRows[0].企业名称, '甲公司');

  const exceptionBytes = await store.read('dcw-test-0001', artifacts[3]);
  const exceptionWorkbook = XLSX.read(exceptionBytes, { type: 'buffer' });
  const exceptionRows = XLSX.utils.sheet_to_json(exceptionWorkbook.Sheets['异常清单'], { defval: '' });
  assert.equal(exceptionRows.length, 1);
  assert.equal(exceptionRows[0].企业名称, '乙公司');
  assert.match(exceptionRows[0].异常原因, /人工核验/);
});

test('补全结果使用中文表头并保留所有已选字段空列', async () => {
  const store = new WorkflowArtifactStore({
    fs: memoryFs(),
    idFactory: (() => { let id = 0; return () => `dca-cn-test-000${++id}`; })(),
  });
  const fieldSelection = [
    'credit_no', 'reg_status', 'legal_rep', 'reg_capital', 'establish_date',
    'registered_address', 'region', 'business_scope', 'industry_category', 'qcc_industry',
    'operating_period', 'company_size', 'company_profile', 'industry_chain_overview',
  ];
  const artifacts = await store.createBundle('dcw-cnheader-0001', {
    headers: ['原始企业名称'],
    fieldSelection,
    rows: [{
      原始企业名称: '企查查科技股份有限公司',
      credit_no: '91320594088140947F',
      legal_rep: '陈德强',
      qcc_match_status: 'enriched',
    }],
  });
  const bytes = await store.read('dcw-cnheader-0001', artifacts.find((item) => item.kind === 'complete' && item.format === 'xlsx'));
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets['清洗补全结果'], { header: 1, defval: '' });
  assert.deepEqual(matrix[0].slice(0, 15), [
    '原始企业名称', '统一社会信用代码', '登记状态', '法定代表人', '注册资本', '成立日期',
    '注册地址', '所属地区', '经营范围', '国标行业', '企查查行业', '营业期限', '人员规模', '企业简介', '产业链概览',
  ]);
  assert.equal(matrix[1][1], '91320594088140947F');
  assert.equal(matrix[1][9], '');
  assert.ok(!matrix[0].some((header) => /^(credit_no|legal_rep|reg_capital|establish_date|reg_status)$/.test(header)));
});

test('第一、二批 98 字段全部使用业务表头并保留标识符文本', async () => {
  const fs = memoryFs();
  const store = new WorkflowArtifactStore({
    fs,
    idFactory: (() => { let id = 0; return () => `dca-batch-test-${++id}`; })(),
  });
  const groups = FIELD_CATALOG.filter((group) => ['batch-1', 'batch-2'].includes(group.releaseBatch));
  const fieldSelection = groups.flatMap((group) => group.fields.map((field) => field.id));
  const expectedLabels = groups.flatMap((group) => group.fields.map((field) => field.label));
  assert.equal(fieldSelection.length, 98);
  assert.equal(new Set(expectedLabels).size, 98, '导出中文表头不得碰撞');
  const artifacts = await store.createBundle('dcw-batch-test-0001', {
    headers: ['原始企业名称'],
    fieldSelection,
    rows: [{ 原始企业名称: '示例企业', listing_stock_code: '000001', invoice_bank_account: '0000123' }],
  });
  const bytes = await store.read('dcw-batch-test-0001', artifacts.find((item) => item.kind === 'complete' && item.format === 'xlsx'));
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets['清洗补全结果'], { header: 1, defval: '', raw: true });
  assert.deepEqual(matrix[0], ['原始企业名称', ...expectedLabels]);
  assert.equal(matrix[1][matrix[0].indexOf('股票代码')], '000001');
  assert.equal(matrix[1][matrix[0].indexOf('开户行账号')], '0000123');
  assert.equal(matrix[0].some((header) => fieldSelection.includes(header)), false);
});

test('异常判定覆盖候选、未匹配、失败和显式错误', () => {
  const rows = deriveExceptionRows([
    { id: 1, qcc_match_status: 'candidate' },
    { id: 2, qcc_match_status: 'unresolved' },
    { id: 3, qcc_match_status: 'failed' },
    { id: 4, qcc_error: '上游超时' },
    { id: 5, qcc_match_status: 'exact' },
  ]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4]);
  assert.equal(rows[3]._exception_reason, '上游超时');
});

test('制品路径拒绝任意路径与非 Host 生成标识', async () => {
  const store = new WorkflowArtifactStore({ fs: memoryFs() });
  await assert.rejects(
    () => store.createBundle('../escape', { rows: [{ name: 'x' }], headers: ['name'] }),
    { code: 'DC_ARTIFACT_ID_INVALID' },
  );
  await assert.rejects(
    () => store.read('dcw-test-0001', { id: '../../secret', format: 'csv' }),
    { code: 'DC_ARTIFACT_ID_INVALID' },
  );
});

test('CSV 中的外部文本不会被表格软件解释为公式', async () => {
  const store = new WorkflowArtifactStore({
    fs: memoryFs(),
    idFactory: (() => { let id = 0; return () => `dca-safe-000${++id}`; })(),
  });
  const artifacts = await store.createBundle('dcw-safe-0001', {
    headers: ['企业名称', '=危险表头'],
    rows: [{ 企业名称: '=HYPERLINK("https://example.invalid")', '=危险表头': '+1+1' }],
  });
  const csv = (await store.read('dcw-safe-0001', artifacts[0])).toString('utf8');
  assert.match(csv, /'=危险表头/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\+1\+1/);
});

test('XLSX Base64 存储读取上限覆盖 4/3 编码膨胀', () => {
  assert.ok(ARTIFACT_STORAGE.maxStoredBytes > ARTIFACT_STORAGE.maxBytes * 4 / 3);
});

test('数组与对象字段以 JSON 文本写入真实 XLSX', async () => {
  const store = new WorkflowArtifactStore({
    fs: memoryFs(),
    idFactory: (() => { let id = 0; return () => `dca-json-000${++id}`; })(),
  });
  const artifacts = await store.createBundle('dcw-json-0001', {
    headers: ['企业名称', '来源'],
    rows: [{ 企业名称: '示例企业', 来源: [{ tool: 'mcp__company__get_base_info' }] }],
  });
  const bytes = await store.read('dcw-json-0001', artifacts[1]);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['清洗补全结果'], { defval: '' });
  assert.equal(rows[0].来源, '[{"tool":"mcp__company__get_base_info"}]');
});

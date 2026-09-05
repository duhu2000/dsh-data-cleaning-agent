import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_CATALOG,
  INPUT_ONLY_MAPPING_FIELDS,
  WORKFLOW_STAGES,
  assertWorkflowTransition,
  normalizeWorkflowDraft,
  publicWorkflowContract,
  validateMappings,
} from '../lib/workflow-contract.js';

test('v2 主流程严格采用企查查数据清洗补全五步', () => {
  assert.deepEqual(
    WORKFLOW_STAGES.map(({ id, label }) => ({ id, label })),
    [
      { id: 'upload', label: '上传数据' },
      { id: 'rules', label: '规则确认' },
      { id: 'match', label: '数据匹配' },
      { id: 'enrich', label: '清洗补全' },
      { id: 'download', label: '下载数据' },
    ],
  );
});

test('字段映射必须包含企业名称、统一社会信用代码或注册号之一', () => {
  assert.throws(
    () => validateMappings([{ sourceField: '联系电话', targetField: 'phone' }]),
    { code: 'DC_WORKFLOW_ANCHOR_REQUIRED' },
  );
  assert.deepEqual(
    validateMappings([
      { sourceField: '公司名', targetField: 'company_name' },
      { sourceField: '联系电话', targetField: 'phone' },
    ]),
    [
      { sourceField: '公司名', targetField: 'company_name' },
      { sourceField: '联系电话', targetField: 'phone' },
    ],
  );
  assert.throws(
    () => validateMappings([
      { sourceField: '公司名', targetField: 'company_name' },
      { sourceField: '未知列', targetField: 'unsupported_field' },
    ]),
    { code: 'DC_WORKFLOW_MAPPING_INVALID' },
  );
});

test('当前字段目录不混入延期的历史、人员和招投标三域', () => {
  const groupIds = FIELD_CATALOG.map((group) => group.id);
  assert.equal(groupIds.includes('history'), false);
  assert.equal(groupIds.includes('person'), false);
  assert.equal(groupIds.includes('tender'), false);
  assert.deepEqual(publicWorkflowContract().deferredDomains, ['history', 'person', 'tender']);
});

test('补全目录开放 30 个基础字段、第一批 40 字段与第二批 58 字段', () => {
  const fields = FIELD_CATALOG.flatMap((group) => group.fields);
  const ids = fields.map((field) => field.id);
  assert.equal(ids.length, 128);
  assert.deepEqual(INPUT_ONLY_MAPPING_FIELDS, [{ id: 'phone', label: '联系电话' }]);
  assert.equal(ids.includes('phone'), false);
  assert.equal(ids.includes('industry_large'), false);
  assert.equal(ids.includes('industry_middle'), false);
  assert.equal(ids.includes('province'), false);
  assert.equal(ids.includes('city'), false);
  assert.equal(ids.includes('district'), false);
  assert.equal(ids.includes('risk_summary'), false);
  assert.equal(ids.includes('trademark_summary'), false);
  assert.equal(ids.includes('contact_preferred_phone'), true);
  assert.equal(ids.includes('listing_stock_code'), true);
  assert.equal(ids.includes('tax_identification_no'), true);
  assert.equal(ids.includes('import_export_credit_grade'), true);
  assert.equal(ids.includes('risk_property_reward_notice_count'), true);
  assert.equal(ids.includes('related_risk_equity_freeze_party_count'), true);
  assert.equal(fields.find((field) => field.id === 'industry_category')?.label, '国标行业');
  assert.equal(fields.find((field) => field.id === 'qcc_industry')?.label, '企查查行业');
  assert.deepEqual(FIELD_CATALOG.map((group) => [group.label, group.sourceTool, group.fields.length]), [
    ['企业工商信息', 'get_company_registration_info', 27],
    ['企业简介', 'get_company_profile', 3],
    ['联系方式', 'get_contact_info', 6],
    ['上市信息', 'get_listing_info', 15],
    ['税务开票信息', 'get_tax_invoice_info', 8],
    ['进出口信用', 'get_import_export_credit', 11],
    ['企业自身风险扫描', 'get_company_risk_scan', 38],
    ['企业关联风险扫描', 'get_company_related_risk_scan', 20],
  ]);

  const draft = normalizeWorkflowDraft({
    fieldSelection: ['credit_no', 'phone', 'industry_large', 'qcc_industry', 'contact_preferred_phone', 'risk_dishonest_count'],
  });
  assert.deepEqual(draft.fieldSelection, ['credit_no', 'qcc_industry', 'contact_preferred_phone', 'risk_dishonest_count']);
  assert.equal(normalizeWorkflowDraft({ fieldSelection: ids }).fieldSelection.length, 128);
});

test('匹配契约不暴露虚构置信度字段', () => {
  const serialized = JSON.stringify(publicWorkflowContract());
  assert.doesNotMatch(serialized, /confidence|置信度/i);
});

test('工作流状态转换阻止跳过上传与规则确认', () => {
  assert.doesNotThrow(() => assertWorkflowTransition('draft', 'uploaded'));
  assert.doesNotThrow(() => assertWorkflowTransition('uploaded', 'rules_confirmed'));
  assert.throws(
    () => assertWorkflowTransition('draft', 'matched'),
    { code: 'DC_WORKFLOW_TRANSITION' },
  );
});

test('任务草稿只接受受支持的目标和字段', () => {
  const draft = normalizeWorkflowDraft({
    title: ' 客户名单清洗 ',
    objectives: ['clean_name', 'unknown', 'complete_fields'],
    fieldSelection: ['legal_rep', 'not_a_field'],
  });
  assert.equal(draft.title, '客户名单清洗');
  assert.deepEqual(draft.objectives, ['clean_name', 'complete_fields']);
  assert.deepEqual(draft.fieldSelection, ['legal_rep']);
});

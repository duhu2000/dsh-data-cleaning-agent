import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_CATALOG,
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
    () => validateMappings([{ sourceField: '电话', targetField: 'phone' }]),
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

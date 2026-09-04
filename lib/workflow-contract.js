/**
 * 数据清洗补全智能体 v2 工作流契约。
 *
 * 设计原则：
 *  - 业务主流程固定为五步；质量体检与任务历史是横向能力。
 *  - 匹配结果只表达状态与可审计依据，不生成无法验证的“置信度”。
 *  - 历史、人员、招投标三域不属于当前版本字段目录。
 */

export const WORKFLOW_SCHEMA_VERSION = 2;

export const WORKFLOW_STAGES = Object.freeze([
  Object.freeze({ id: 'upload', label: '上传数据', order: 1 }),
  Object.freeze({ id: 'rules', label: '规则确认', order: 2 }),
  Object.freeze({ id: 'match', label: '数据匹配', order: 3 }),
  Object.freeze({ id: 'enrich', label: '清洗补全', order: 4 }),
  Object.freeze({ id: 'download', label: '下载数据', order: 5 }),
]);

export const WORKFLOW_STATES = Object.freeze([
  'draft',
  'uploaded',
  'rules_confirmed',
  'diagnosed',
  'matching',
  'review_required',
  'matched',
  'enriching',
  'export_ready',
  'completed',
  'parse_failed',
  'authorization_required',
  'partial',
  'failed',
  'cancelled',
]);

export const TERMINAL_WORKFLOW_STATES = Object.freeze(['completed', 'cancelled']);

export const SOURCE_TYPES = Object.freeze(['text', 'csv', 'xlsx', 'json', 'image']);

export const MATCH_STATUSES = Object.freeze([
  'exact',
  'candidate',
  'confirmed',
  'unresolved',
  'failed',
]);

export const MATCH_ANCHORS = Object.freeze(['company_name', 'credit_no', 'reg_no']);

export const FIELD_CATALOG = Object.freeze([
  Object.freeze({
    id: 'identity',
    label: '基础工商信息',
    fields: Object.freeze([
      Object.freeze({ id: 'company_name', label: '企业名称', inputAnchor: true, defaultSelected: true }),
      Object.freeze({ id: 'credit_no', label: '统一社会信用代码', inputAnchor: true, defaultSelected: true }),
      Object.freeze({ id: 'reg_no', label: '注册号', inputAnchor: true }),
      Object.freeze({ id: 'org_no', label: '组织机构代码' }),
      Object.freeze({ id: 'reg_status', label: '登记状态', defaultSelected: true }),
      Object.freeze({ id: 'legal_rep', label: '法定代表人', defaultSelected: true }),
      Object.freeze({ id: 'reg_capital', label: '注册资本', defaultSelected: true }),
      Object.freeze({ id: 'paid_capital', label: '实缴资本' }),
      Object.freeze({ id: 'establish_date', label: '成立日期', defaultSelected: true }),
      Object.freeze({ id: 'company_type', label: '企业类型' }),
      Object.freeze({ id: 'registration_authority', label: '登记机关' }),
      Object.freeze({ id: 'former_name', label: '曾用名' }),
      Object.freeze({ id: 'english_name', label: '英文名' }),
    ]),
  }),
  Object.freeze({
    id: 'contact',
    label: '地址与联系方式',
    fields: Object.freeze([
      Object.freeze({ id: 'registered_address', label: '注册地址', defaultSelected: true }),
      Object.freeze({ id: 'province', label: '省份地区', matchAuxiliary: true }),
      Object.freeze({ id: 'city', label: '城市', matchAuxiliary: true }),
      Object.freeze({ id: 'district', label: '区县' }),
      Object.freeze({ id: 'phone', label: '电话', matchAuxiliary: true }),
      Object.freeze({ id: 'email', label: '邮箱' }),
      Object.freeze({ id: 'website', label: '官网' }),
    ]),
  }),
  Object.freeze({
    id: 'operation',
    label: '经营信息',
    fields: Object.freeze([
      Object.freeze({ id: 'business_scope', label: '经营范围' }),
      Object.freeze({ id: 'industry_category', label: '国标行业' }),
      Object.freeze({ id: 'industry_large', label: '一级行业' }),
      Object.freeze({ id: 'industry_middle', label: '二级行业' }),
      Object.freeze({ id: 'operating_period', label: '营业期限' }),
      Object.freeze({ id: 'company_size', label: '企业规模' }),
      Object.freeze({ id: 'company_profile', label: '企业简介' }),
    ]),
  }),
  Object.freeze({
    id: 'risk',
    label: '风险摘要',
    capability: 'qcc.risk',
    fields: Object.freeze([
      Object.freeze({ id: 'risk_summary', label: '风险摘要', capability: 'qcc.risk' }),
      Object.freeze({ id: 'operating_exception', label: '经营异常摘要', capability: 'qcc.risk' }),
      Object.freeze({ id: 'administrative_penalty', label: '行政处罚摘要', capability: 'qcc.risk' }),
    ]),
  }),
  Object.freeze({
    id: 'ipr',
    label: '知识产权摘要',
    capability: 'qcc.ipr',
    fields: Object.freeze([
      Object.freeze({ id: 'trademark_summary', label: '商标摘要', capability: 'qcc.ipr' }),
      Object.freeze({ id: 'patent_summary', label: '专利摘要', capability: 'qcc.ipr' }),
      Object.freeze({ id: 'software_copyright_summary', label: '软件著作权摘要', capability: 'qcc.ipr' }),
    ]),
  }),
]);

export const FIELD_LABELS = Object.freeze(Object.fromEntries(
  FIELD_CATALOG.flatMap((group) => group.fields.map((field) => [field.id, field.label])),
));

export function fieldLabel(fieldId) {
  const id = String(fieldId ?? '').trim();
  return FIELD_LABELS[id] ?? id;
}

const FIELD_IDS = new Set(FIELD_CATALOG.flatMap((group) => group.fields.map((field) => field.id)));
const STAGE_IDS = new Set(WORKFLOW_STAGES.map((stage) => stage.id));
const STATE_IDS = new Set(WORKFLOW_STATES);

const TRANSITIONS = Object.freeze({
  draft: ['uploaded', 'parse_failed', 'cancelled'],
  uploaded: ['draft', 'rules_confirmed', 'parse_failed', 'cancelled'],
  rules_confirmed: ['diagnosed', 'matching', 'matched', 'review_required', 'export_ready', 'authorization_required', 'failed', 'cancelled'],
  diagnosed: ['matching', 'matched', 'review_required', 'export_ready', 'authorization_required', 'failed', 'cancelled'],
  matching: ['matched', 'review_required', 'authorization_required', 'partial', 'failed', 'cancelled'],
  review_required: ['matching', 'matched', 'authorization_required', 'partial', 'failed', 'cancelled'],
  matched: ['enriching', 'export_ready', 'authorization_required', 'partial', 'failed', 'cancelled'],
  enriching: ['export_ready', 'review_required', 'authorization_required', 'partial', 'failed', 'cancelled'],
  export_ready: ['enriching', 'completed', 'failed', 'cancelled'],
  parse_failed: ['draft', 'uploaded', 'cancelled'],
  authorization_required: ['matching', 'enriching', 'failed', 'cancelled'],
  partial: ['review_required', 'enriching', 'export_ready', 'authorization_required', 'completed', 'failed', 'cancelled'],
  failed: ['draft', 'uploaded', 'rules_confirmed', 'diagnosed', 'matching', 'enriching', 'cancelled'],
  completed: [],
  cancelled: [],
});

export class WorkflowContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowContractError';
    this.code = code;
  }
}

function text(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function uniqueStrings(values, max = 64) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].slice(0, max);
}

export function normalizeMappings(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).map((mapping) => ({
    sourceField: text(mapping?.sourceField),
    targetField: text(mapping?.targetField),
  })).filter((mapping) => mapping.sourceField && FIELD_IDS.has(mapping.targetField));
}

export function validateMappings(value) {
  if (!Array.isArray(value) || value.length > 128) {
    throw new WorkflowContractError('DC_WORKFLOW_MAPPING_INVALID', 'Field mappings must be an array with at most 128 entries.');
  }
  const mappings = normalizeMappings(value);
  if (mappings.length !== value.length) {
    throw new WorkflowContractError('DC_WORKFLOW_MAPPING_INVALID', 'Every mapping needs a source field and a supported target field.');
  }
  if (mappings.length === 0) {
    throw new WorkflowContractError('DC_WORKFLOW_MAPPING_REQUIRED', 'At least one valid field mapping is required.');
  }
  if (!mappings.some((mapping) => MATCH_ANCHORS.includes(mapping.targetField))) {
    throw new WorkflowContractError(
      'DC_WORKFLOW_ANCHOR_REQUIRED',
      'Map at least one enterprise identity anchor: company name, unified social credit code, or registration number.',
    );
  }
  const targets = new Set();
  const sources = new Set();
  for (const mapping of mappings) {
    if (targets.has(mapping.targetField)) {
      throw new WorkflowContractError('DC_WORKFLOW_DUPLICATE_MAPPING', `Duplicate target mapping: ${mapping.targetField}`);
    }
    if (sources.has(mapping.sourceField)) {
      throw new WorkflowContractError('DC_WORKFLOW_DUPLICATE_MAPPING', `Duplicate source mapping: ${mapping.sourceField}`);
    }
    targets.add(mapping.targetField);
    sources.add(mapping.sourceField);
  }
  return mappings;
}

export function normalizeFieldSelection(value) {
  return uniqueStrings(value).filter((field) => FIELD_IDS.has(field));
}

export function normalizeWorkflowDraft(value = {}) {
  const objectives = uniqueStrings(value.objectives, 16).filter((item) => (
    ['clean_name', 'deduplicate', 'validate_identity', 'complete_fields'].includes(item)
  ));
  return {
    title: text(value.title, 120) || '未命名数据清洗补全任务',
    objectives,
    fieldSelection: normalizeFieldSelection(value.fieldSelection),
    mappings: normalizeMappings(value.mappings),
    matchRules: {
      normalizeNames: value.matchRules?.normalizeNames !== false,
      preferCreditNo: value.matchRules?.preferCreditNo !== false,
      deduplicate: value.matchRules?.deduplicate !== false,
      manualReviewAmbiguous: value.matchRules?.manualReviewAmbiguous !== false,
    },
  };
}

export function canTransition(from, to) {
  if (!STATE_IDS.has(from) || !STATE_IDS.has(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export function assertWorkflowTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new WorkflowContractError('DC_WORKFLOW_TRANSITION', `Invalid workflow transition: ${from} -> ${to}`);
  }
}

export function publicWorkflowContract() {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    stages: WORKFLOW_STAGES,
    states: WORKFLOW_STATES,
    terminalStates: TERMINAL_WORKFLOW_STATES,
    sourceTypes: SOURCE_TYPES,
    matchStatuses: MATCH_STATUSES,
    matchAnchors: MATCH_ANCHORS,
    fieldCatalog: FIELD_CATALOG,
    crossCuttingCapabilities: [
      { id: 'prompt', label: '任务设置' },
      { id: 'profile', label: '质量体检' },
      { id: 'history', label: '任务历史' },
    ],
    privacy: {
      persisted: ['task metadata', 'numeric summaries', 'artifact references'],
      notPersisted: ['raw rows and enterprise lists', 'QCC response payloads', 'candidate details'],
    },
    deferredDomains: ['history', 'person', 'tender'],
  };
}

export function assertWorkflowRecordShape(record) {
  if (!record || record.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    throw new WorkflowContractError('DC_WORKFLOW_SCHEMA', 'Unsupported workflow record schema.');
  }
  if (!STAGE_IDS.has(record.stage) || !STATE_IDS.has(record.state)) {
    throw new WorkflowContractError('DC_WORKFLOW_SCHEMA', 'Workflow record contains an invalid stage or state.');
  }
  return record;
}

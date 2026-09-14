/**
 * 数据清洗补全智能体 v2 工作流契约。
 *
 * 设计原则：
 *  - 业务主流程固定为五步；质量体检与任务历史是横向能力。
 *  - 匹配结果只表达状态与可审计依据，不生成无法验证的“置信度”。
 *  - 历史、人员、招投标三域不属于当前版本字段目录。
 */

import { QCC_FIELD_CATALOG } from './qcc-field-catalog.js';

export const WORKFLOW_SCHEMA_VERSION = 2;
export const FLOW_VERSION = 1;

export const WORKFLOW_STAGE_ACCESS = Object.freeze({
  CURRENT: 'current',
  READ: 'read',
  LOCKED: 'locked',
});

export const WORKFLOW_ACTIONS = Object.freeze({
  IMPORT_DATA: 'import-data',
  EDIT_RULES: 'edit-rules',
  CONFIRM_RULES: 'confirm-rules',
  RUN_QUALITY: 'run-quality',
  PREPARE_QCC_COMMAND: 'prepare-qcc-command',
  RUN_LOCAL_CLEAN: 'run-local-clean',
  RUN_LOCAL_COMPLETE: 'run-local-complete',
  CREATE_LOCAL_ARTIFACTS: 'create-local-artifacts',
  RESOLVE_CANDIDATE: 'resolve-candidate',
  RETRY_FAILED: 'retry-failed',
  RETRY_DELIVERY: 'retry-delivery',
});

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

export const FIELD_CATALOG = QCC_FIELD_CATALOG;

export const FIELD_LABELS = Object.freeze(Object.fromEntries(
  FIELD_CATALOG.flatMap((group) => group.fields.map((field) => [field.id, field.label])),
));

// 输入清洗字段可以参与字段映射与本地质量检查，但不是当前 QCC 可补全字段，
// 因此绝不能出现在 fieldSelection 或导出补全字段目录中。
export const INPUT_ONLY_MAPPING_FIELDS = Object.freeze([
  Object.freeze({ id: 'phone', label: '联系电话' }),
]);

export function fieldLabel(fieldId) {
  const id = String(fieldId ?? '').trim();
  return FIELD_LABELS[id] ?? id;
}

const ENRICHMENT_FIELD_IDS = new Set(FIELD_CATALOG.flatMap((group) => group.fields.map((field) => field.id)));
const MAPPING_FIELD_IDS = new Set([
  ...ENRICHMENT_FIELD_IDS,
  ...INPUT_ONLY_MAPPING_FIELDS.map((field) => field.id),
]);
const STAGE_IDS = new Set(WORKFLOW_STAGES.map((stage) => stage.id));
const STATE_IDS = new Set(WORKFLOW_STATES);

const TRANSITIONS = Object.freeze({
  draft: ['uploaded', 'parse_failed', 'cancelled'],
  uploaded: ['draft', 'rules_confirmed', 'parse_failed', 'cancelled'],
  rules_confirmed: ['diagnosed', 'failed', 'cancelled'],
  diagnosed: ['matching', 'export_ready', 'completed', 'authorization_required', 'failed', 'cancelled'],
  matching: ['matched', 'review_required', 'authorization_required', 'partial', 'completed', 'failed', 'cancelled'],
  review_required: ['matching', 'matched', 'authorization_required', 'partial', 'completed', 'failed', 'cancelled'],
  matched: ['enriching', 'export_ready', 'authorization_required', 'partial', 'failed', 'cancelled'],
  enriching: ['export_ready', 'review_required', 'authorization_required', 'partial', 'failed', 'cancelled'],
  export_ready: ['enriching', 'partial', 'completed', 'failed', 'cancelled'],
  parse_failed: ['draft', 'uploaded', 'cancelled'],
  authorization_required: ['matching', 'enriching', 'failed', 'cancelled'],
  partial: ['review_required', 'authorization_required', 'completed', 'failed', 'cancelled'],
  failed: ['partial', 'completed', 'cancelled'],
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
  })).filter((mapping) => mapping.sourceField && MAPPING_FIELD_IDS.has(mapping.targetField));
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
    if (MATCH_ANCHORS.includes(mapping.targetField) && targets.has(mapping.targetField)) {
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
  return uniqueStrings(value, 256).filter((field) => ENRICHMENT_FIELD_IDS.has(field));
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

export function requiresQcc(task) {
  return Array.isArray(task?.objectives)
    && task.objectives.some((objective) => ['validate_identity', 'complete_fields'].includes(objective));
}

function currentStageFor(task) {
  switch (task?.state) {
    case 'draft':
    case 'parse_failed':
      return 'upload';
    case 'uploaded':
    case 'rules_confirmed':
      return 'rules';
    case 'diagnosed':
      return requiresQcc(task) ? 'match' : 'enrich';
    case 'matching':
    case 'review_required':
      return 'match';
    case 'matched':
    case 'enriching':
      return 'enrich';
    case 'export_ready':
    case 'partial':
    case 'completed':
      return 'download';
    case 'authorization_required':
    case 'failed':
    case 'cancelled':
      return STAGE_IDS.has(task?.stage) ? task.stage : 'upload';
    default:
      return STAGE_IDS.has(task?.stage) ? task.stage : 'upload';
  }
}

export function allowedWorkflowActions(task) {
  const state = task?.state;
  if (state === 'draft' || state === 'parse_failed') {
    return [WORKFLOW_ACTIONS.IMPORT_DATA, WORKFLOW_ACTIONS.EDIT_RULES];
  }
  if (state === 'uploaded') {
    return [WORKFLOW_ACTIONS.IMPORT_DATA, WORKFLOW_ACTIONS.EDIT_RULES, WORKFLOW_ACTIONS.CONFIRM_RULES];
  }
  if (state === 'rules_confirmed') return [WORKFLOW_ACTIONS.RUN_QUALITY];
  if (state === 'diagnosed') {
    return requiresQcc(task)
      ? [WORKFLOW_ACTIONS.PREPARE_QCC_COMMAND]
      : [
          WORKFLOW_ACTIONS.RUN_LOCAL_CLEAN,
          WORKFLOW_ACTIONS.RUN_LOCAL_COMPLETE,
          WORKFLOW_ACTIONS.CREATE_LOCAL_ARTIFACTS,
        ];
  }
  if (state === 'review_required') return [WORKFLOW_ACTIONS.RESOLVE_CANDIDATE];
  if (state === 'export_ready') {
    return requiresQcc(task)
      ? [WORKFLOW_ACTIONS.RETRY_DELIVERY]
      : [WORKFLOW_ACTIONS.CREATE_LOCAL_ARTIFACTS];
  }
  if (state === 'partial') {
    return [
      WORKFLOW_ACTIONS.RETRY_FAILED,
      ...(task?.error?.code === 'DC_DELIVERY_FAILED' ? [WORKFLOW_ACTIONS.RETRY_DELIVERY] : []),
    ];
  }
  if (state === 'failed' && task?.error?.code === 'DC_DELIVERY_FAILED' && task?.qccRunId) {
    return [WORKFLOW_ACTIONS.RETRY_DELIVERY];
  }
  return [];
}

export function deriveWorkflowFlow(task) {
  const currentStage = currentStageFor(task);
  const stageAccess = Object.fromEntries(WORKFLOW_STAGES.map(({ id }) => [id, WORKFLOW_STAGE_ACCESS.LOCKED]));
  stageAccess[currentStage] = WORKFLOW_STAGE_ACCESS.CURRENT;

  const makeReadable = (stage, condition) => {
    if (condition && stage !== currentStage) stageAccess[stage] = WORKFLOW_STAGE_ACCESS.READ;
  };
  makeReadable('upload', Boolean(task?.source));
  makeReadable('rules', !['draft', 'uploaded', 'parse_failed'].includes(task?.state));
  makeReadable('match', requiresQcc(task) && Boolean(task?.matchSummary || task?.qccRunId));
  makeReadable('enrich', Boolean(task?.enrichmentSummary));
  makeReadable('download', Array.isArray(task?.artifacts) && task.artifacts.length > 0);

  const allowedActions = allowedWorkflowActions(task);
  return {
    flowVersion: FLOW_VERSION,
    currentStage,
    stageAccess,
    allowedActions,
    nextAction: allowedActions[0] ?? null,
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
    flowVersion: FLOW_VERSION,
    stages: WORKFLOW_STAGES,
    stageAccessModes: Object.values(WORKFLOW_STAGE_ACCESS),
    actions: Object.values(WORKFLOW_ACTIONS),
    states: WORKFLOW_STATES,
    terminalStates: TERMINAL_WORKFLOW_STATES,
    sourceTypes: SOURCE_TYPES,
    matchStatuses: MATCH_STATUSES,
    matchAnchors: MATCH_ANCHORS,
    fieldCatalog: FIELD_CATALOG,
    inputOnlyMappingFields: INPUT_ONLY_MAPPING_FIELDS,
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
  // Additive v2 migration: never infer ownership from whichever Session reads history.
  return { ...record, ...normalizeWorkflowOrigin(record) };
}

export function normalizeWorkflowOrigin(value = {}) {
  const id = value => typeof value === 'string' && /^[\w:.-]{1,200}$/.test(value) ? value : null;
  const label = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || null : null;
  return {
    originSessionId: id(value.originSessionId),
    originWorkspaceId: id(value.originWorkspaceId),
    originSessionName: label(value.originSessionName),
    originWorkspaceName: label(value.originWorkspaceName),
  };
}

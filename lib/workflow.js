/**
 * Host 持久化工作流：只保存任务元数据、统计摘要与导出制品引用。
 * 原始名单、企业名称、匹配候选及 QCC 返回明细不得写入 storageDomain。
 */
import { randomUUID } from 'node:crypto';
import {
  SOURCE_TYPES,
  TERMINAL_WORKFLOW_STATES,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowContractError,
  assertWorkflowRecordShape,
  assertWorkflowTransition,
  normalizeFieldSelection,
  normalizeWorkflowDraft,
  validateMappings,
} from './workflow-contract.js';

const DOMAIN_NAME = 'dc_workflows_v2';
const DOMAIN_VERSION = 1;
const TABLE_NAME = 'tasks';
const permissiveSchema = {
  parse: (value) => value,
  safeParse: (value) => ({ success: true, data: value }),
};

const domainSpec = () => ({
  name: DOMAIN_NAME,
  version: DOMAIN_VERSION,
  tables: { [TABLE_NAME]: { valueSchema: permissiveSchema } },
});

export class WorkflowError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.status = status;
  }
}

function contractCall(callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof WorkflowContractError) {
      throw new WorkflowError(error.code, error.message, 400);
    }
    throw error;
  }
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function safeText(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function safeStringList(value, maxItems = 128, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => safeText(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function safeSummary(value, keys) {
  const output = {};
  for (const key of keys) output[key] = integer(value?.[key]);
  return output;
}

function assertSummaryTotal(summary, componentKeys, code) {
  const accounted = componentKeys.reduce((total, key) => total + integer(summary[key]), 0);
  if (accounted > summary.total) {
    throw new WorkflowError(code, 'Summary component counts cannot exceed total.', 400);
  }
}

function sanitizeSource(value = {}) {
  const type = SOURCE_TYPES.includes(value.type) ? value.type : 'text';
  return {
    type,
    fileName: safeText(value.fileName, 240),
    rowCount: integer(value.rowCount, 0, 1_000_000),
    columnCount: integer(value.columnCount, 0, 1_000),
    headers: safeStringList(value.headers, 256, 120),
    sizeBytes: integer(value.sizeBytes, 0, 64 * 1024 * 1024),
    checksum: safeText(value.checksum, 160),
  };
}

function sanitizeArtifact(value = {}, timestamp) {
  const format = ['csv', 'xlsx', 'json'].includes(value.format) ? value.format : 'csv';
  return {
    id: safeText(value.id, 160),
    kind: ['clean', 'complete', 'review', 'report'].includes(value.kind) ? value.kind : 'complete',
    format,
    fileName: safeText(value.fileName, 240),
    rowCount: integer(value.rowCount, 0, 1_000_000),
    sizeBytes: integer(value.sizeBytes, 0, 64 * 1024 * 1024),
    checksum: safeText(value.checksum, 160),
    mediaType: safeText(value.mediaType, 160),
    createdAt: safeText(value.createdAt, 80) || timestamp,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function defaultId() {
  return `dcw-${randomUUID()}`;
}

export class DataCleaningWorkflowStore {
  constructor({ storageDomain, logger, nowFn = nowIso, idFactory = defaultId }) {
    this.storageDomain = storageDomain;
    this.logger = logger ?? console;
    this.nowFn = nowFn;
    this.idFactory = idFactory;
    this.access = null;
  }

  async init() {
    if (!this.storageDomain) throw new WorkflowError('DC_WORKFLOW_UNAVAILABLE', 'storageDomain service unavailable', 503);
    this.access = await this.storageDomain.open(domainSpec());
    this.logger.info('[dc-agent] workflow v2 storage ready');
    return this;
  }

  table() {
    if (!this.access) throw new WorkflowError('DC_WORKFLOW_UNAVAILABLE', 'workflow store not initialized', 503);
    return this.access.table(TABLE_NAME);
  }

  async create(input = {}) {
    const timestamp = this.nowFn();
    const draft = normalizeWorkflowDraft(input);
    const id = this.idFactory();
    const record = {
      id,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      revision: 1,
      title: draft.title,
      state: 'draft',
      stage: 'upload',
      objectives: draft.objectives,
      fieldSelection: draft.fieldSelection,
      mappings: draft.mappings,
      matchRules: draft.matchRules,
      source: null,
      qualitySummary: null,
      matchSummary: null,
      enrichmentSummary: null,
      qccRunId: null,
      artifacts: [],
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    await this.table().put(id, record);
    return record;
  }

  async list() {
    const records = [...this.table().entries()].map(([, record]) => assertWorkflowRecordShape(record));
    return records.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  async get(id) {
    const record = await this.table().get(String(id));
    return record ? assertWorkflowRecordShape(record) : null;
  }

  async require(id) {
    const record = await this.get(id);
    if (!record) throw new WorkflowError('DC_WORKFLOW_NOT_FOUND', `Workflow task not found: ${id}`, 404);
    return record;
  }

  async mutate(id, expectedRevision, updater) {
    const key = String(id);
    const current = await this.require(key);
    if (expectedRevision !== undefined && integer(expectedRevision) !== current.revision) {
      throw new WorkflowError('DC_WORKFLOW_REVISION_CONFLICT', 'Workflow task was updated by another session.', 409);
    }
    let updated;
    await this.table().update(key, (latest) => {
      if (!latest) throw new WorkflowError('DC_WORKFLOW_NOT_FOUND', `Workflow task not found: ${key}`, 404);
      if (latest.revision !== current.revision) {
        throw new WorkflowError('DC_WORKFLOW_REVISION_CONFLICT', 'Workflow task was updated by another session.', 409);
      }
      const patch = updater(assertWorkflowRecordShape(latest));
      updated = {
        ...latest,
        ...patch,
        id: latest.id,
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        revision: latest.revision + 1,
        updatedAt: this.nowFn(),
      };
      return updated;
    });
    return updated ?? this.require(key);
  }

  async updateDraft(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['draft', 'uploaded'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_LOCKED', 'Draft settings cannot be changed after rules are confirmed.', 409);
      }
      const draft = normalizeWorkflowDraft({
        title: input.title ?? record.title,
        objectives: input.objectives ?? record.objectives,
        fieldSelection: input.fieldSelection ?? record.fieldSelection,
        mappings: input.mappings ?? record.mappings,
        matchRules: input.matchRules ?? record.matchRules,
      });
      return draft;
    });
  }

  async recordUpload(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['draft', 'uploaded', 'parse_failed'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_UPLOAD_STATE', 'Upload metadata cannot be replaced in the current state.', 409);
      }
      if (record.state !== 'uploaded') contractCall(() => assertWorkflowTransition(record.state, 'uploaded'));
      return {
        state: 'uploaded',
        stage: 'rules',
        source: sanitizeSource(input.source),
        qualitySummary: null,
        matchSummary: null,
        enrichmentSummary: null,
        qccRunId: null,
        artifacts: [],
        error: null,
        completedAt: null,
      };
    });
  }

  async confirmRules(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['uploaded', 'rules_confirmed'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_RULE_STATE', 'Rules can only be confirmed after upload.', 409);
      }
      if (record.state !== 'rules_confirmed') contractCall(() => assertWorkflowTransition(record.state, 'rules_confirmed'));
      const mappings = contractCall(() => validateMappings(input.mappings ?? record.mappings));
      const draft = normalizeWorkflowDraft({
        title: record.title,
        objectives: input.objectives ?? record.objectives,
        fieldSelection: input.fieldSelection ?? record.fieldSelection,
        mappings,
        matchRules: input.matchRules ?? record.matchRules,
      });
      return { ...draft, state: 'rules_confirmed', stage: 'match', error: null };
    });
  }

  async recordQuality(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['rules_confirmed', 'diagnosed'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_QUALITY_STATE', 'Quality summary requires confirmed rules.', 409);
      }
      if (record.state !== 'diagnosed') contractCall(() => assertWorkflowTransition(record.state, 'diagnosed'));
      return {
        state: 'diagnosed',
        stage: 'match',
        error: null,
        qualitySummary: safeSummary(input.summary, [
          'total', 'valid', 'missingAnchor', 'duplicates', 'invalidCreditNo', 'invalidPhone', 'emptyFields',
        ]),
      };
    });
  }

  async startMatch(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      contractCall(() => assertWorkflowTransition(record.state, 'matching'));
      return { state: 'matching', stage: 'match', error: null };
    });
  }

  async recordMatch(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['rules_confirmed', 'diagnosed', 'matching', 'review_required', 'partial'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_MATCH_STATE', 'Match summary cannot be recorded in the current state.', 409);
      }
      const summary = safeSummary(input.summary, ['total', 'exact', 'candidate', 'confirmed', 'unresolved', 'failed', 'reviewRequired']);
      assertSummaryTotal(summary, ['exact', 'candidate', 'confirmed', 'unresolved', 'failed'], 'DC_WORKFLOW_MATCH_SUMMARY');
      if (summary.reviewRequired > summary.candidate) {
        throw new WorkflowError('DC_WORKFLOW_MATCH_SUMMARY', 'Review-required count cannot exceed candidate count.', 400);
      }
      const nextState = summary.reviewRequired > 0 ? 'review_required' : 'matched';
      if (record.state !== nextState) contractCall(() => assertWorkflowTransition(record.state, nextState));
      return {
        state: nextState,
        stage: nextState === 'review_required' ? 'match' : 'enrich',
        matchSummary: summary,
        qccRunId: safeText(input.qccRunId, 160) || record.qccRunId,
        error: null,
      };
    });
  }

  async startEnrichment(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (record.state === 'review_required' && integer(record.matchSummary?.reviewRequired) > 0) {
        throw new WorkflowError('DC_WORKFLOW_REVIEW_REQUIRED', 'Resolve ambiguous matches before enrichment.', 409);
      }
      contractCall(() => assertWorkflowTransition(record.state, 'enriching'));
      return {
        state: 'enriching',
        stage: 'enrich',
        fieldSelection: input.fieldSelection === undefined
          ? record.fieldSelection
          : normalizeFieldSelection(input.fieldSelection),
        error: null,
      };
    });
  }

  async recordEnrichment(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['matched', 'enriching', 'partial', 'authorization_required'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_ENRICH_STATE', 'Enrichment summary cannot be recorded in the current state.', 409);
      }
      const summary = safeSummary(input.summary, ['total', 'completed', 'unchanged', 'failed', 'reviewRequired', 'callsUsed']);
      assertSummaryTotal(summary, ['completed', 'unchanged', 'failed', 'reviewRequired'], 'DC_WORKFLOW_ENRICH_SUMMARY');
      const nextState = summary.failed > 0 || summary.reviewRequired > 0 ? 'partial' : 'export_ready';
      if (record.state !== nextState) contractCall(() => assertWorkflowTransition(record.state, nextState));
      return {
        state: nextState,
        stage: 'download',
        enrichmentSummary: summary,
        qccRunId: safeText(input.qccRunId, 160) || record.qccRunId,
        error: null,
      };
    });
  }

  async prepareLocalExport(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['rules_confirmed', 'diagnosed', 'export_ready'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_LOCAL_EXPORT_STATE', 'Local output requires confirmed rules or a completed quality check.', 409);
      }
      if (record.state !== 'export_ready') contractCall(() => assertWorkflowTransition(record.state, 'export_ready'));
      const total = integer(input.summary?.total ?? record.source?.rowCount);
      const completed = integer(input.summary?.completed ?? total);
      const unchanged = integer(input.summary?.unchanged);
      const failed = integer(input.summary?.failed);
      const summary = {
        total,
        completed,
        unchanged,
        failed,
        reviewRequired: 0,
        callsUsed: 0,
      };
      assertSummaryTotal(summary, ['completed', 'unchanged', 'failed'], 'DC_WORKFLOW_ENRICH_SUMMARY');
      return {
        state: 'export_ready',
        stage: 'download',
        enrichmentSummary: summary,
        error: null,
      };
    });
  }

  async recordExport(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['export_ready', 'partial'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_EXPORT_STATE', 'Export can only be recorded when output is ready.', 409);
      }
      contractCall(() => assertWorkflowTransition(record.state, 'completed'));
      const timestamp = this.nowFn();
      const incoming = Array.isArray(input.artifacts) ? input.artifacts : [input.artifact];
      const artifacts = incoming.filter(Boolean).map((artifact) => sanitizeArtifact(artifact, timestamp));
      if (!artifacts.length || artifacts.some((artifact) => !artifact.id)) {
        throw new WorkflowError('DC_WORKFLOW_ARTIFACT_REQUIRED', 'At least one Host artifact reference is required.', 400);
      }
      return {
        state: 'completed',
        stage: 'download',
        artifacts: [...record.artifacts, ...artifacts].slice(-20),
        error: null,
        completedAt: timestamp,
      };
    });
  }

  async recordParseFailure(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (!['draft', 'uploaded'].includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_PARSE_STATE', 'Parse failure cannot be recorded in the current state.', 409);
      }
      contractCall(() => assertWorkflowTransition(record.state, 'parse_failed'));
      return {
        state: 'parse_failed',
        stage: 'upload',
        error: { code: safeText(input.code, 80) || 'DC_PARSE' },
      };
    });
  }

  async requireAuthorization(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      contractCall(() => assertWorkflowTransition(record.state, 'authorization_required'));
      return {
        state: 'authorization_required',
        stage: ['matched', 'enriching'].includes(record.state) ? 'enrich' : 'match',
        error: { code: 'QCC_AUTH_REQUIRED' },
      };
    });
  }

  async recordFailure(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      contractCall(() => assertWorkflowTransition(record.state, 'failed'));
      return {
        state: 'failed',
        error: { code: safeText(input.code, 80) || 'DC_WORKFLOW_FAILED' },
      };
    });
  }

  async cancel(id, input = {}) {
    return this.mutate(id, input.expectedRevision, (record) => {
      if (TERMINAL_WORKFLOW_STATES.includes(record.state)) {
        throw new WorkflowError('DC_WORKFLOW_TERMINAL', 'Completed or cancelled tasks cannot be cancelled.', 409);
      }
      contractCall(() => assertWorkflowTransition(record.state, 'cancelled'));
      return { state: 'cancelled', error: null, completedAt: this.nowFn() };
    });
  }

  async dispose() {
    if (!this.access) return;
    try { await this.access.close(); } catch {}
    this.access = null;
  }
}

export const WORKFLOW_STORAGE = Object.freeze({
  domain: DOMAIN_NAME,
  domainVersion: DOMAIN_VERSION,
  table: TABLE_NAME,
});

import { isDeepStrictEqual } from 'node:util';
import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_HISTORY_TOOLS,
  qccToolRuntimeCandidates,
} from './qcc-phase2.js';

export const QCC_PHASE2_ACCEPTANCE_SCHEMA_VERSION = 1;
export const QCC_PHASE2_EVIDENCE_KIND = 'qcc-phase2-real-tool-transcript';
export const QCC_PHASE2_ACCEPTANCE_FLOORS = Object.freeze({
  minimumRecords: 20,
  minimumCurrentDimensions: 15,
  requiredHistoryDimensions: Object.keys(QCC_PHASE2_HISTORY_TOOLS).length,
});

const CURRENT_TOOLS = new Map(Object.entries(QCC_PHASE2_COMPANY_TOOLS));
const HISTORY_TOOLS = new Map(Object.entries(QCC_PHASE2_HISTORY_TOOLS));
const DELIVERED_STATUSES = new Set(['resolved', 'no_data']);
const ALLOWED_STATUSES = new Set([
  ...DELIVERED_STATUSES,
  'permission_required',
  'not_available',
  'error',
]);
const OPAQUE_REFERENCE = /^row-[0-9]{3,6}$/;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function evaluateField(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return false;
  if (typeof field.key !== 'string' || field.key.length === 0) return false;
  if (!hasOwn(field, 'value') || !hasOwn(field, 'sourceValue')) return false;
  if (!hasMeaningfulValue(field.value) || !hasMeaningfulValue(field.sourceValue)) return false;
  return isDeepStrictEqual(field.value, field.sourceValue);
}

function evaluateDimension(dimension, knownTools) {
  const failures = [];
  if (!dimension || typeof dimension !== 'object' || Array.isArray(dimension)) {
    return { id: null, delivered: false, failures: ['DIMENSION_INVALID'] };
  }
  const id = typeof dimension.id === 'string' ? dimension.id : null;
  const expectedTool = id ? knownTools.get(id) : null;
  if (!expectedTool) failures.push('DIMENSION_UNKNOWN');
  if (!qccToolRuntimeCandidates(expectedTool ?? '').includes(dimension.sourceTool)) {
    failures.push('SOURCE_TOOL_MISMATCH');
  }
  if (!ALLOWED_STATUSES.has(dimension.status)) failures.push('DIMENSION_STATUS_INVALID');

  const fieldsAreArray = Array.isArray(dimension.fields);
  const fields = fieldsAreArray ? dimension.fields : [];
  if (!fieldsAreArray) failures.push('FIELDS_ARRAY_REQUIRED');
  if (dimension.status === 'resolved') {
    if (fields.length === 0) failures.push('RESOLVED_FIELDS_REQUIRED');
    if (!fields.every(evaluateField)) failures.push('VALUE_NOT_VERBATIM');
  }
  if (dimension.status === 'no_data' && fields.length > 0) {
    failures.push('NO_DATA_MUST_NOT_CARRY_VALUES');
  }

  return {
    id,
    delivered: failures.length === 0 && DELIVERED_STATUSES.has(dimension.status),
    failures,
  };
}

function evaluateRecord(record, index, { requireHistory }) {
  const safeReference = OPAQUE_REFERENCE.test(record?.reference ?? '')
    ? record.reference
    : `row-${String(index + 1).padStart(3, '0')}`;
  const failures = [];
  if (!OPAQUE_REFERENCE.test(record?.reference ?? '')) failures.push('REFERENCE_NOT_OPAQUE');
  if (record?.entityStatus !== 'resolved') failures.push('ENTITY_NOT_RESOLVED');

  const dimensions = Array.isArray(record?.dimensions) ? record.dimensions : [];
  if (!Array.isArray(record?.dimensions)) failures.push('DIMENSIONS_REQUIRED');

  const seen = new Set();
  const deliveredStatuses = new Map();
  let currentDelivered = 0;
  let historyDelivered = 0;
  for (const dimension of dimensions) {
    const domain = dimension?.domain;
    const tools = domain === 'history' ? HISTORY_TOOLS : domain === 'company' ? CURRENT_TOOLS : null;
    if (!tools) {
      failures.push('DIMENSION_DOMAIN_INVALID');
      continue;
    }
    const uniqueKey = `${domain}:${dimension?.id ?? ''}`;
    if (seen.has(uniqueKey)) {
      failures.push('DIMENSION_DUPLICATE');
      continue;
    }
    seen.add(uniqueKey);
    const result = evaluateDimension(dimension, tools);
    failures.push(...result.failures);
    if (result.delivered) deliveredStatuses.set(uniqueKey, dimension.status);
    if (result.delivered && domain === 'company') currentDelivered += 1;
    if (result.delivered && domain === 'history') historyDelivered += 1;
  }

  if (
    deliveredStatuses.get('company:resolveEntity') !== 'resolved'
    || deliveredStatuses.get('company:registration') !== 'resolved'
  ) {
    failures.push('IDENTITY_EVIDENCE_REQUIRED');
  }
  if (currentDelivered < QCC_PHASE2_ACCEPTANCE_FLOORS.minimumCurrentDimensions) {
    failures.push('CURRENT_DIMENSION_FLOOR_NOT_MET');
  }
  if (requireHistory && historyDelivered < QCC_PHASE2_ACCEPTANCE_FLOORS.requiredHistoryDimensions) {
    failures.push('HISTORY_DIMENSION_FLOOR_NOT_MET');
  }

  return {
    reference: safeReference,
    passed: failures.length === 0,
    currentDelivered,
    historyDelivered,
    failures: [...new Set(failures)].sort(),
    entityStatus: ['resolved', 'ambiguous', 'unresolved'].includes(record?.entityStatus)
      ? record.entityStatus
      : 'invalid',
  };
}

/**
 * 评估 0.4.0 真实 E2E 证据。返回值严格不携带企业名、信用代码或字段值。
 */
export function evaluateQccPhase2Evidence(evidence, { requireHistory = false } = {}) {
  const globalFailures = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    globalFailures.push('EVIDENCE_INVALID');
  }
  if (evidence?.schemaVersion !== QCC_PHASE2_ACCEPTANCE_SCHEMA_VERSION) {
    globalFailures.push('SCHEMA_VERSION_UNSUPPORTED');
  }
  if (evidence?.evidenceKind !== QCC_PHASE2_EVIDENCE_KIND) {
    globalFailures.push('EVIDENCE_KIND_UNVERIFIED');
  }
  // 真实 E2E 证据必须显式声明 synthetic:false；缺省值也按未验证处理，保持 fail-closed。
  if (evidence?.synthetic !== false) globalFailures.push('SYNTHETIC_EVIDENCE_REJECTED');
  if (!Array.isArray(evidence?.records)) globalFailures.push('RECORDS_REQUIRED');
  const records = Array.isArray(evidence?.records) ? evidence.records : [];
  if (records.length < QCC_PHASE2_ACCEPTANCE_FLOORS.minimumRecords) {
    globalFailures.push('RECORD_FLOOR_NOT_MET');
  }
  if (requireHistory && evidence?.historyAccess !== 'enterprise-certified') {
    globalFailures.push('ENTERPRISE_HISTORY_ACCESS_NOT_VERIFIED');
  }

  const recordReports = records.map((record, index) => evaluateRecord(record, index, { requireHistory }));
  const references = recordReports.map((record) => record.reference);
  if (new Set(references).size !== references.length) globalFailures.push('REFERENCE_DUPLICATE');

  const failedRecords = recordReports.filter((record) => !record.passed);
  const summary = {
    recordCount: recordReports.length,
    passedRecords: recordReports.length - failedRecords.length,
    failedRecords: failedRecords.length,
    ambiguousRecords: recordReports.filter((record) => record.entityStatus === 'ambiguous').length,
    unresolvedRecords: recordReports.filter((record) => record.entityStatus === 'unresolved').length,
    minimumCurrentDimensions: recordReports.length === 0
      ? 0
      : Math.min(...recordReports.map((record) => record.currentDelivered)),
    minimumHistoryDimensions: recordReports.length === 0
      ? 0
      : Math.min(...recordReports.map((record) => record.historyDelivered)),
  };

  return {
    schemaVersion: QCC_PHASE2_ACCEPTANCE_SCHEMA_VERSION,
    passed: globalFailures.length === 0 && failedRecords.length === 0,
    requireHistory,
    floors: QCC_PHASE2_ACCEPTANCE_FLOORS,
    summary,
    globalFailures: [...new Set(globalFailures)].sort(),
    failures: failedRecords.map(({ reference, failures }) => ({ reference, codes: failures })),
  };
}

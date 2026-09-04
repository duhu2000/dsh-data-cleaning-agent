/**
 * G5 Host 内存态：候选续跑、人工重试和请求幂等。
 *
 * 原始/补全行只保存在当前 Host 进程，不写 storageDomain；重启后 run 明确失效。
 * 幂等缓存保存请求指纹与同源响应，避免客户端超时重发导致重复计费。
 */
import { createHash, randomUUID } from 'node:crypto';
import { QccBridgeError } from './qcc.js';
import { safeAuditEvent } from './qcc-safety.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RUNS = 50;
const DEFAULT_MAX_AUDIT = 200;
const DEFAULT_MAX_IDEMPOTENCY = 200;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function fingerprintRequest(operation, payload) {
  return createHash('sha256')
    .update(JSON.stringify({ operation: String(operation), payload: canonicalize(payload) }))
    .digest('hex');
}

export function validateIdempotencyKey(value) {
  const key = String(value ?? '').trim();
  if (!key) {
    throw new QccBridgeError('QCC_IDEMPOTENCY_REQUIRED', 'A unique idempotencyKey is required before paid QCC calls');
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new QccBridgeError(
      'QCC_IDEMPOTENCY_INVALID',
      'idempotencyKey must be 8-128 characters using letters, numbers, dot, underscore, colon or hyphen',
    );
  }
  return key;
}

function deriveState(record) {
  if (record.reviewQueue.length > 0) return 'awaiting-review';
  if (record.errors.some((item) => item.error?.retryable)) return 'needs-retry';
  if (record.errors.length > 0) return 'completed-with-errors';
  return 'completed';
}

function recomputeSummary(record) {
  const count = (status) => record.rows.filter((row) => row.qcc_match_status === status).length;
  record.summary = {
    ...record.summary,
    totalRows: record.rows.length,
    enriched: count('enriched'),
    ambiguous: count('ambiguous'),
    unresolved: count('unresolved'),
    failed: count('failed'),
    missingName: count('missing-name'),
    includeRisk: Boolean(record.includeRisk),
  };
  record.state = deriveState(record);
}

function clone(value) {
  return structuredClone(value);
}

export class G5RunStore {
  constructor({
    clock = () => Date.now(),
    runIdFactory = () => `g5-${randomUUID()}`,
    ttlMs = DEFAULT_TTL_MS,
    maxRuns = DEFAULT_MAX_RUNS,
    maxAudit = DEFAULT_MAX_AUDIT,
    maxIdempotency = DEFAULT_MAX_IDEMPOTENCY,
  } = {}) {
    this.clock = clock;
    this.runIdFactory = runIdFactory;
    this.ttlMs = ttlMs;
    this.maxRuns = maxRuns;
    this.maxAudit = maxAudit;
    this.maxIdempotency = maxIdempotency;
    this.runs = new Map();
    this.idempotency = new Map();
    this.locks = new Set();
  }

  nowIso() {
    return new Date(this.clock()).toISOString();
  }

  cleanup() {
    const cutoff = this.clock() - this.ttlMs;
    for (const [id, run] of this.runs) {
      if (run.touchedAtMs < cutoff) this.runs.delete(id);
    }
    for (const [key, entry] of this.idempotency) {
      // 进行中的付费请求必须保留幂等屏障：即使执行时间超过 TTL，也不能让
      // 同一 key 的重试绕过首个 Promise，否则可能重复计费。
      if (entry.settled && entry.touchedAtMs < cutoff) this.idempotency.delete(key);
    }
    while (this.runs.size > this.maxRuns) this.runs.delete(this.runs.keys().next().value);
  }

  async executeOnce({ key: rawKey, fingerprint, operation }) {
    const key = validateIdempotencyKey(rawKey);
    this.cleanup();
    const existing = this.idempotency.get(key);
    if (existing) {
      existing.touchedAtMs = this.clock();
      if (existing.fingerprint !== fingerprint) {
        throw new QccBridgeError(
          'QCC_IDEMPOTENCY_CONFLICT',
          'idempotencyKey was already used with a different request',
        );
      }
      return { value: await existing.promise, replayed: true };
    }
    if (this.idempotency.size >= this.maxIdempotency) {
      throw new QccBridgeError(
        'QCC_IDEMPOTENCY_CAPACITY',
        'G5 idempotency cache is full; wait for older requests to expire before starting another paid call',
        { retryable: true },
      );
    }

    const entry = {
      fingerprint,
      promise: null,
      touchedAtMs: this.clock(),
      settled: false,
    };
    entry.promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        entry.settled = true;
      });
    this.idempotency.set(key, entry);
    return { value: await entry.promise, replayed: false };
  }

  createRun({ headers, nameField, fieldSelection, includeRisk, concurrency, result, audit = [] }) {
    this.cleanup();
    const id = this.runIdFactory();
    const at = this.nowIso();
    const record = {
      id,
      state: 'completed',
      version: 1,
      createdAt: at,
      updatedAt: at,
      touchedAtMs: this.clock(),
      headers: Array.isArray(headers) ? headers.map(String) : [],
      nameField: String(nameField ?? 'name'),
      fieldSelection: Array.isArray(fieldSelection) ? fieldSelection.map(String) : [],
      includeRisk: Boolean(includeRisk),
      concurrency: Number(concurrency ?? 2),
      summary: clone(result.summary),
      rows: clone(result.rows),
      reviewQueue: clone(result.reviewQueue),
      errors: clone(result.errors),
      audit: audit.map(safeAuditEvent).slice(-this.maxAudit),
    };
    recomputeSummary(record);
    this.runs.set(id, record);
    this.cleanup();
    return this.snapshot(record);
  }

  requireRun(id) {
    this.cleanup();
    const record = this.runs.get(String(id ?? ''));
    if (!record) {
      throw new QccBridgeError(
        'QCC_RUN_NOT_FOUND',
        'G5 run was not found or expired; start a new enrichment run',
        { retryable: false },
      );
    }
    record.touchedAtMs = this.clock();
    return record;
  }

  get(id) {
    return this.snapshot(this.requireRun(id));
  }

  snapshot(record) {
    return clone({
      runId: record.id,
      state: record.state,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      headers: record.headers,
      fieldSelection: record.fieldSelection,
      summary: record.summary,
      rows: record.rows,
      reviewQueue: record.reviewQueue,
      errors: record.errors,
      audit: record.audit,
      expiresInMs: this.ttlMs,
      persistence: 'host-memory',
    });
  }

  appendAudit(record, event) {
    record.audit.push(safeAuditEvent(event));
    if (record.audit.length > this.maxAudit) record.audit.splice(0, record.audit.length - this.maxAudit);
    record.touchedAtMs = this.clock();
  }

  touch(record) {
    record.version += 1;
    record.updatedAt = this.nowIso();
    record.touchedAtMs = this.clock();
    recomputeSummary(record);
  }

  patchCompany(record, companyName, rowIndexes, result) {
    record.reviewQueue = record.reviewQueue.filter((item) => item.companyName !== companyName);
    record.errors = record.errors.filter((item) => item.companyName !== companyName);
    for (const index of rowIndexes) {
      const row = record.rows[index] ?? {};
      if (result.status === 'enriched') {
        record.rows[index] = {
          ...row,
          ...result.fields,
          qcc_match_status: 'enriched',
          qcc_source: 'qcc-mcp',
        };
      } else {
        record.rows[index] = { ...row, qcc_match_status: result.status };
      }
    }
    if (result.status === 'ambiguous') {
      record.reviewQueue.push({ companyName, rowIndexes: [...rowIndexes], candidates: clone(result.candidates) });
    }
    if (result.status === 'failed') {
      record.errors.push({ companyName, rowIndexes: [...rowIndexes], error: clone(result.error) });
    }
    this.touch(record);
  }

  async resolveCandidate(runId, { companyName, selectedCreditNo }, bridge, options = {}) {
    const record = this.requireRun(runId);
    const name = String(companyName ?? '').trim();
    const creditNo = String(selectedCreditNo ?? '').trim();
    const queued = record.reviewQueue.find((item) => item.companyName === name);
    if (!queued) {
      throw new QccBridgeError('QCC_REVIEW_NOT_PENDING', 'This company is not awaiting candidate review');
    }
    const candidate = queued.candidates.find((item) => item.creditNo === creditNo);
    if (!creditNo || !candidate) {
      throw new QccBridgeError('QCC_CANDIDATE_INVALID', 'Selected credit number is not in the pending candidate list');
    }

    const lock = `${record.id}:resolve:${name}`;
    if (this.locks.has(lock)) {
      throw new QccBridgeError('QCC_OPERATION_IN_PROGRESS', 'Candidate resolution is already in progress', { retryable: true });
    }
    this.locks.add(lock);
    try {
      const result = await bridge.enrichLockedCompany({
        companyName: candidate.companyName || name,
        creditNo,
      }, {
        ...options,
        includeRisk: record.includeRisk,
        fieldSelection: record.fieldSelection,
        onAudit: (event) => this.appendAudit(record, event),
      });
      this.patchCompany(record, name, queued.rowIndexes, result);
      return this.snapshot(record);
    } finally {
      this.locks.delete(lock);
    }
  }

  async retryCompanies(runId, companyNames, bridge, options = {}) {
    const record = this.requireRun(runId);
    const names = [...new Set((Array.isArray(companyNames) ? companyNames : []).map((name) => String(name).trim()).filter(Boolean))];
    if (names.length === 0) {
      throw new QccBridgeError('QCC_RETRY_EMPTY', 'At least one failed company must be selected for manual retry');
    }
    const selected = names.map((name) => {
      const item = record.errors.find((error) => error.companyName === name);
      if (!item) throw new QccBridgeError('QCC_RETRY_NOT_FAILED', 'Selected company is not in the failed queue');
      if (!item.error?.retryable) throw new QccBridgeError('QCC_RETRY_NOT_ALLOWED', 'Selected failure is not retryable');
      return item;
    });
    const locks = selected.map((item) => `${record.id}:retry:${item.companyName}`);
    if (locks.some((lock) => this.locks.has(lock))) {
      throw new QccBridgeError('QCC_OPERATION_IN_PROGRESS', 'A selected retry is already in progress', { retryable: true });
    }
    locks.forEach((lock) => this.locks.add(lock));

    try {
      for (const item of selected) {
        let result;
        try {
          result = await bridge.enrichCompany(item.companyName, {
            ...options,
            includeRisk: record.includeRisk,
            fieldSelection: record.fieldSelection,
            onAudit: (event) => this.appendAudit(record, event),
          });
        } catch (error) {
          if (error?.code === 'QCC_ABORTED') throw error;
          const normalized = error instanceof QccBridgeError
            ? error
            : new QccBridgeError('QCC_RUNTIME_ERROR', 'QCC enrichment failed', { retryable: true });
          result = { status: 'failed', error: normalized.toJSON() };
        }
        this.patchCompany(record, item.companyName, item.rowIndexes, result);
      }
      return this.snapshot(record);
    } finally {
      locks.forEach((lock) => this.locks.delete(lock));
    }
  }
}

/**
 * 0.5.0 三域批量服务：只通过 QccHostBridge 的公共 ToolRuntime 调用面执行。
 * 原始行和工具结果只返回给同源 Web 工作台，不进入模型上下文。
 */
import { randomUUID } from 'node:crypto';
import { QCC_TOOL_NAMES, QccBridgeError, classifyEntityMatch } from './qcc.js';
import {
  QCC_PHASE3_TOOL_NAMES,
  canonicalizePhase3Tool,
  canonicalPhase3ToolName,
  requiredInputsFor,
} from './qcc-phase3.js';
import { safeAuditEvent } from './qcc-safety.js';

export const PHASE3_BATCH_LIMITS = Object.freeze({ maxRows: 100, maxConcurrency: 4, defaultMaxCalls: 500, hardMaxCalls: 2_000 });
const DETAIL_TOOL = 'mcp__qcc-risk__get_judicial_document_detail';
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function uniqueNames(rows, nameField) {
  return [...new Set(rows.map((row) => String(isRecord(row) ? row[nameField] ?? '' : '').trim()).filter(Boolean))];
}

function safeError(error, fallback = 'QCC_PHASE3_FAILED') {
  if (error instanceof QccBridgeError) return error.toJSON();
  return new QccBridgeError(fallback, 'QCC phase-3 batch operation failed', { retryable: true }).toJSON();
}

export function normalizePhase3Selection(input = {}) {
  const domains = [...new Set((Array.isArray(input.domains) ? input.domains : []).map(String))];
  for (const domain of domains) {
    if (!Object.hasOwn(QCC_PHASE3_TOOL_NAMES, domain)) {
      throw new QccBridgeError('QCC_PHASE3_DOMAIN_INVALID', `Unknown phase-3 domain: ${domain}`);
    }
  }
  const selected = [];
  for (const domain of domains) {
    selected.push(...QCC_PHASE3_TOOL_NAMES[domain].map((name) => canonicalPhase3ToolName(domain, name)));
  }
  for (const raw of Array.isArray(input.tools) ? input.tools : []) {
    const canonical = canonicalizePhase3Tool(raw);
    if (!canonical) throw new QccBridgeError('QCC_PHASE3_TOOL_INVALID', `Tool is outside the phase-3 contract: ${String(raw)}`);
    selected.push(canonical);
  }
  const tools = [...new Set(selected)];
  if (tools.length === 0) {
    throw new QccBridgeError('QCC_PHASE3_SELECTION_REQUIRED', 'Select at least one risk, IPR or operation tool');
  }
  return { domains, tools };
}

export function estimatePhase3Batch(rows, input = {}) {
  if (!Array.isArray(rows)) throw new QccBridgeError('QCC_INVALID_ROWS', 'rows must be an array');
  const maxRows = Math.min(PHASE3_BATCH_LIMITS.maxRows, Math.max(1, Math.trunc(input.maxRows ?? PHASE3_BATCH_LIMITS.maxRows)));
  if (rows.length > maxRows) {
    throw new QccBridgeError('QCC_BATCH_TOO_LARGE', `QCC batch exceeds ${maxRows} rows`, {
      details: { maxRows, receivedRows: rows.length },
    });
  }
  const nameField = String(input.nameField ?? 'name');
  const selection = normalizePhase3Selection(input);
  const names = uniqueNames(rows, nameField);
  const lookupCalls = names.length;
  const enrichmentCalls = names.length * selection.tools.length;
  const estimatedCalls = lookupCalls + enrichmentCalls;
  const requestedMax = Math.trunc(input.maxCalls ?? PHASE3_BATCH_LIMITS.defaultMaxCalls);
  const maxCalls = Math.min(PHASE3_BATCH_LIMITS.hardMaxCalls, Math.max(1, requestedMax));
  return {
    ...selection,
    totalRows: rows.length,
    uniqueCompanies: names.length,
    missingNameRows: rows.length - rows.filter((row) => String(isRecord(row) ? row[nameField] ?? '' : '').trim()).length,
    lookupCalls,
    enrichmentCalls,
    estimatedCalls,
    maxCalls,
    withinLimit: estimatedCalls <= maxCalls,
    estimateType: 'upper-bound',
    detailDependencies: selection.tools.includes(DETAIL_TOOL) ? ['documentId'] : [],
    executesTools: false,
    paidCalls: false,
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

function rowStatus(result) {
  if (!result) return 'failed';
  return result.status;
}

function summarizeRows(rows, selectedTools, actualCalls, estimate) {
  const count = (status) => rows.filter((row) => row.qcc_match_status === status).length;
  return {
    totalRows: rows.length,
    uniqueCompanies: estimate.uniqueCompanies,
    enriched: count('enriched'),
    partial: count('partial'),
    ambiguous: count('ambiguous'),
    unresolved: count('unresolved'),
    failed: count('failed'),
    missingName: count('missing-name'),
    selectedTools: selectedTools.length,
    estimatedCalls: estimate.estimatedCalls,
    actualCalls,
  };
}

export class Phase3BatchService {
  constructor(bridge) {
    this.bridge = bridge;
  }

  estimate(rows, input) {
    return estimatePhase3Batch(rows, input);
  }

  async callBudgeted(toolName, args, options, budget) {
    if (budget.used >= budget.max) {
      throw new QccBridgeError('QCC_CALL_LIMIT_REACHED', 'QCC call limit reached before dispatch', {
        details: { maxCalls: budget.max, actualCalls: budget.used },
      });
    }
    budget.used += 1;
    return this.bridge.call(toolName, args, options);
  }

  async enrichLocked(selection, selectedTools, input, budget, options = {}) {
    const companyName = String(selection.companyName ?? '').trim();
    const lockedKey = String(selection.creditNo ?? selection.companyName ?? '').trim();
    const toolResults = [];
    const errors = [];
    for (const toolName of selectedTools) {
      const shortName = toolName.split('__').at(-1);
      const extraArgs = isRecord(input.toolArguments?.[toolName])
        ? input.toolArguments[toolName]
        : isRecord(input.toolArguments?.[shortName]) ? input.toolArguments[shortName] : {};
      const required = requiredInputsFor(toolName);
      const args = { searchKey: lockedKey, ...extraArgs };
      const missing = required.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
      if (missing.length) {
        const error = new QccBridgeError('QCC_DEPENDENCY_REQUIRED', `Required input is missing for ${shortName}`, {
          toolName,
          details: { missing },
        }).toJSON();
        toolResults.push({ sourceTool: toolName, status: 'dependency-required', error });
        errors.push({ toolName, error });
        continue;
      }
      try {
        const called = await this.callBudgeted(toolName, args, options, budget);
        toolResults.push({ sourceTool: toolName, runtimeTool: called.toolName, status: 'success', value: called.data });
      } catch (error) {
        if (error?.code === 'QCC_ABORTED' || error?.code === 'QCC_CALL_LIMIT_REACHED') throw error;
        const normalized = safeError(error);
        toolResults.push({ sourceTool: toolName, status: 'failed', error: normalized });
        errors.push({ toolName, error: normalized });
      }
    }
    const successes = toolResults.filter((item) => item.status === 'success').length;
    return {
      status: successes === selectedTools.length ? 'enriched' : successes > 0 ? 'partial' : 'failed',
      companyName,
      creditNo: String(selection.creditNo ?? ''),
      lockedKey,
      toolResults,
      errors,
    };
  }

  async enrichCompany(companyName, selectedTools, input, budget, options = {}) {
    const lookup = await this.callBudgeted(QCC_TOOL_NAMES.entityLookup, { searchKey: companyName }, options, budget);
    const match = classifyEntityMatch(lookup.data);
    if (match.status !== 'exact') return { ...match, companyName };
    return this.enrichLocked(match, selectedTools, input, budget, options);
  }

  async run(rows, input = {}, options = {}) {
    const estimate = this.estimate(rows, input);
    if (!estimate.withinLimit) {
      throw new QccBridgeError('QCC_CALL_LIMIT_EXCEEDED', 'Estimated QCC calls exceed maxCalls; narrow the tool or row selection', {
        details: { estimatedCalls: estimate.estimatedCalls, maxCalls: estimate.maxCalls },
      });
    }
    const requiredTools = [QCC_TOOL_NAMES.entityLookup, ...estimate.tools.filter((tool) => tool !== DETAIL_TOOL || input.toolArguments)];
    const missingTools = requiredTools.filter((name) => !this.bridge.has(name));
    if (missingTools.length) {
      throw new QccBridgeError('QCC_NOT_CONNECTED', 'Selected QCC tools are not ready; connect QCC or narrow the selection', {
        connectRequired: true,
        retryable: true,
        details: { missingTools },
      });
    }

    const nameField = String(input.nameField ?? 'name');
    const normalized = rows.map((row, index) => ({
      index,
      row: isRecord(row) ? { ...row } : {},
      companyName: String(isRecord(row) ? row[nameField] ?? '' : '').trim(),
    }));
    const names = uniqueNames(rows, nameField);
    const concurrency = Math.min(PHASE3_BATCH_LIMITS.maxConcurrency, Math.max(1, Math.trunc(input.concurrency ?? 2)));
    const budget = { used: 0, max: estimate.maxCalls };
    const audit = [];
    const callOptions = { ...options, onAudit: (event) => { audit.push(safeAuditEvent(event)); options.onAudit?.(event); } };
    let completedUnique = 0;
    const pairs = await mapConcurrent(names, concurrency, async (companyName) => {
      let result;
      try {
        result = await this.enrichCompany(companyName, estimate.tools, input, budget, callOptions);
      } catch (error) {
        if (error?.code === 'QCC_ABORTED' || error?.code === 'QCC_CALL_LIMIT_REACHED') throw error;
        result = { status: 'failed', companyName, error: safeError(error), errors: [{ toolName: error?.toolName ?? null, error: safeError(error) }] };
      }
      completedUnique += 1;
      options.onProgress?.({ completedUnique, totalUnique: names.length, actualCalls: budget.used });
      return [companyName, result];
    });
    const companyResults = Object.fromEntries(pairs);
    const outputRows = normalized.map(({ row, companyName }) => {
      if (!companyName) return { ...row, qcc_match_status: 'missing-name' };
      const result = companyResults[companyName];
      const next = { ...row, qcc_match_status: rowStatus(result) };
      if (Array.isArray(result?.toolResults)) {
        next.qcc_phase3_json = JSON.stringify(result.toolResults);
        if (result.toolResults.some((item) => item.status === 'success')) next.qcc_source = 'qcc-mcp';
      }
      return next;
    });
    const indexesFor = (name) => normalized.filter((item) => item.companyName === name).map((item) => item.index);
    const reviewQueue = pairs.filter(([, result]) => result.status === 'ambiguous').map(([companyName, result]) => ({
      companyName,
      rowIndexes: indexesFor(companyName),
      candidates: result.candidates,
    }));
    const errors = pairs.flatMap(([companyName, result]) => {
      const items = Array.isArray(result.errors) ? result.errors : result.error ? [{ toolName: null, error: result.error }] : [];
      return items.map((item) => ({ companyName, rowIndexes: indexesFor(companyName), ...item }));
    });
    return {
      estimate,
      selectedTools: estimate.tools,
      summary: summarizeRows(outputRows, estimate.tools, budget.used, estimate),
      rows: outputRows,
      reviewQueue,
      errors,
      companyResults,
      audit,
      actualCalls: budget.used,
    };
  }
}

function deriveState(record) {
  if (record.reviewQueue.length) return 'awaiting-review';
  if (record.errors.some((item) => item.error?.retryable)) return 'needs-retry';
  if (record.errors.length) return 'completed-with-errors';
  return 'completed';
}

export class Phase3RunStore {
  constructor({ clock = () => Date.now(), runIdFactory = () => `phase3-${randomUUID()}`, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.clock = clock;
    this.runIdFactory = runIdFactory;
    this.ttlMs = ttlMs;
    this.runs = new Map();
  }

  cleanup() {
    const cutoff = this.clock() - this.ttlMs;
    for (const [id, record] of this.runs) if (record.touchedAtMs < cutoff) this.runs.delete(id);
  }

  create({ headers, nameField, input, result }) {
    this.cleanup();
    const now = new Date(this.clock()).toISOString();
    const record = {
      id: this.runIdFactory(), version: 1, createdAt: now, updatedAt: now, touchedAtMs: this.clock(),
      headers: Array.isArray(headers) ? headers.map(String) : [], nameField: String(nameField ?? 'name'),
      input: clone(input), estimate: clone(result.estimate), selectedTools: clone(result.selectedTools),
      summary: clone(result.summary), rows: clone(result.rows), reviewQueue: clone(result.reviewQueue),
      errors: clone(result.errors), companyResults: clone(result.companyResults), audit: clone(result.audit),
      actualCalls: result.actualCalls,
    };
    record.state = deriveState(record);
    this.runs.set(record.id, record);
    return this.snapshot(record);
  }

  require(id) {
    this.cleanup();
    const record = this.runs.get(String(id ?? ''));
    if (!record) throw new QccBridgeError('QCC_RUN_NOT_FOUND', 'Phase-3 run was not found or expired');
    record.touchedAtMs = this.clock();
    return record;
  }

  get(id) { return this.snapshot(this.require(id)); }

  recompute(record) {
    const count = (status) => record.rows.filter((row) => row.qcc_match_status === status).length;
    record.summary = {
      ...record.summary,
      enriched: count('enriched'), partial: count('partial'), ambiguous: count('ambiguous'),
      unresolved: count('unresolved'), failed: count('failed'), missingName: count('missing-name'),
      actualCalls: record.actualCalls,
    };
    record.state = deriveState(record);
    record.version += 1;
    record.updatedAt = new Date(this.clock()).toISOString();
    record.touchedAtMs = this.clock();
  }

  patchCompany(record, companyName, rowIndexes, result, audit, actualCalls) {
    record.companyResults[companyName] = clone(result);
    record.reviewQueue = record.reviewQueue.filter((item) => item.companyName !== companyName);
    record.errors = record.errors.filter((item) => item.companyName !== companyName);
    for (const index of rowIndexes) {
      const row = { ...(record.rows[index] ?? {}), qcc_match_status: result.status };
      if (Array.isArray(result.toolResults)) {
        row.qcc_phase3_json = JSON.stringify(result.toolResults);
        if (result.toolResults.some((item) => item.status === 'success')) row.qcc_source = 'qcc-mcp';
      }
      record.rows[index] = row;
    }
    if (result.status === 'ambiguous') {
      record.reviewQueue.push({ companyName, rowIndexes: [...rowIndexes], candidates: clone(result.candidates) });
    }
    for (const item of Array.isArray(result.errors) ? result.errors : []) {
      record.errors.push({ companyName, rowIndexes: [...rowIndexes], ...clone(item) });
    }
    record.audit.push(...audit.map(safeAuditEvent));
    record.actualCalls += actualCalls;
    this.recompute(record);
  }

  async resolve(runId, { companyName, selectedCreditNo }, service) {
    const record = this.require(runId);
    const name = String(companyName ?? '').trim();
    const creditNo = String(selectedCreditNo ?? '').trim();
    const queued = record.reviewQueue.find((item) => item.companyName === name);
    if (!queued) throw new QccBridgeError('QCC_REVIEW_NOT_PENDING', 'This company is not awaiting candidate review');
    const candidate = queued.candidates.find((item) => item.creditNo === creditNo);
    if (!candidate || !creditNo) throw new QccBridgeError('QCC_CANDIDATE_INVALID', 'Selected credit number is not in the pending candidate list');
    const remaining = record.estimate.maxCalls - record.actualCalls;
    if (remaining < record.selectedTools.length) {
      throw new QccBridgeError('QCC_CALL_LIMIT_REACHED', 'Run call limit has no room for candidate enrichment');
    }
    const budget = { used: 0, max: remaining };
    const audit = [];
    const result = await service.enrichLocked(
      { companyName: candidate.companyName || name, creditNo },
      record.selectedTools,
      record.input,
      budget,
      { onAudit: (event) => audit.push(event) },
    );
    this.patchCompany(record, name, queued.rowIndexes, result, audit, budget.used);
    return this.snapshot(record);
  }

  async retry(runId, companyNames, service) {
    const record = this.require(runId);
    const names = [...new Set((Array.isArray(companyNames) ? companyNames : []).map((name) => String(name).trim()).filter(Boolean))];
    if (!names.length) throw new QccBridgeError('QCC_RETRY_EMPTY', 'Select at least one failed company');
    for (const name of names) {
      const failed = record.errors.filter((item) => item.companyName === name && item.error?.retryable);
      if (!failed.length) throw new QccBridgeError('QCC_RETRY_NOT_ALLOWED', 'Selected company has no retryable phase-3 failure');
      const previous = record.companyResults[name];
      const remaining = record.estimate.maxCalls - record.actualCalls;
      const retryTools = previous?.lockedKey
        ? [...new Set(failed.map((item) => item.toolName).filter(Boolean))]
        : record.selectedTools;
      const needed = retryTools.length + (previous?.lockedKey ? 0 : 1);
      if (remaining < needed) throw new QccBridgeError('QCC_CALL_LIMIT_REACHED', 'Run call limit has no room for retry');
      const budget = { used: 0, max: remaining };
      const audit = [];
      let result;
      if (previous?.lockedKey) {
        const retried = await service.enrichLocked(
          { companyName: previous.companyName || name, creditNo: previous.creditNo || previous.lockedKey },
          retryTools,
          record.input,
          budget,
          { onAudit: (event) => audit.push(event) },
        );
        const replacement = new Map(retried.toolResults.map((item) => [item.sourceTool, item]));
        const merged = previous.toolResults.map((item) => replacement.get(item.sourceTool) ?? item);
        const errors = merged.filter((item) => item.status !== 'success').map((item) => ({ toolName: item.sourceTool, error: item.error }));
        const successes = merged.filter((item) => item.status === 'success').length;
        result = {
          ...previous,
          status: successes === record.selectedTools.length ? 'enriched' : successes > 0 ? 'partial' : 'failed',
          toolResults: merged,
          errors,
        };
      } else {
        result = await service.enrichCompany(name, record.selectedTools, record.input, budget, {
          onAudit: (event) => audit.push(event),
        });
      }
      const indexes = record.rows.map((row, index) => ({ row, index }))
        .filter(({ row }) => String(row[record.nameField] ?? '').trim() === name)
        .map(({ index }) => index);
      this.patchCompany(record, name, indexes, result, audit, budget.used);
    }
    return this.snapshot(record);
  }

  snapshot(record) {
    return clone({
      runId: record.id, state: record.state, version: record.version, createdAt: record.createdAt,
      updatedAt: record.updatedAt, headers: record.headers, estimate: record.estimate,
      selectedTools: record.selectedTools, summary: record.summary, rows: record.rows,
      reviewQueue: record.reviewQueue, errors: record.errors, audit: record.audit,
      expiresInMs: this.ttlMs, persistence: 'host-memory',
    });
  }
}

#!/usr/bin/env node
/**
 * G5 真实 E2E Runner（默认关闭）。
 *
 * 安全门：
 * - 必须显式 G5_E2E=1；
 * - 仅允许 127.0.0.1 / localhost 回环 Host；
 * - enrich 模式还必须 G5_E2E_CONFIRM_PAID_CALLS=YES；
 * - 输出只有脱敏摘要，不写原始行、候选详情或 QCC 原始响应。
 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSensitive, redactSensitiveText } from '../lib/qcc-safety.js';

const SELF = fileURLToPath(import.meta.url);

export class G5E2EGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'G5E2EGateError';
    this.code = code;
  }
}

function requireLoopback(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new G5E2EGateError('G5_E2E_BASE_URL_INVALID', 'G5_BASE_URL must be an absolute HTTP URL');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new G5E2EGateError('G5_E2E_LOOPBACK_ONLY', 'G5 E2E only permits an isolated loopback DSH host');
  }
  return url.toString().replace(/\/$/, '');
}

function keyFor(operation, payload) {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
  return `g5-e2e:${operation}:${hash}`;
}

async function jsonRequest(fetchImpl, url, { method = 'GET', body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: body ? { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : {
      'sec-fetch-site': 'same-origin',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new G5E2EGateError('G5_E2E_NON_JSON', `G5 endpoint returned non-JSON HTTP ${response.status}`);
  }
  return { status: response.status, payload };
}

function responseSummary(response) {
  const payload = response.payload ?? {};
  const sourceSummary = payload.summary && typeof payload.summary === 'object' ? payload.summary : null;
  const summary = sourceSummary ? {
    totalRows: Number(sourceSummary.totalRows ?? 0),
    uniqueCompanies: Number(sourceSummary.uniqueCompanies ?? 0),
    enriched: Number(sourceSummary.enriched ?? 0),
    ambiguous: Number(sourceSummary.ambiguous ?? 0),
    unresolved: Number(sourceSummary.unresolved ?? 0),
    failed: Number(sourceSummary.failed ?? 0),
    missingName: Number(sourceSummary.missingName ?? 0),
    includeRisk: sourceSummary.includeRisk === true,
  } : null;
  return {
    httpStatus: response.status,
    ok: payload.ok === true,
    marker: payload.marker ?? null,
    code: payload.code ?? null,
    state: payload.state ?? payload.capabilities?.state ?? null,
    retryable: payload.retryable ?? null,
    connectRequired: payload.connectRequired ?? null,
    runState: payload.state ?? null,
    runId: payload.runId ?? null,
    summary,
    reviewQueueCount: Array.isArray(payload.reviewQueue) ? payload.reviewQueue.length : 0,
    errorCount: Array.isArray(payload.errors) ? payload.errors.length : 0,
    auditCount: Array.isArray(payload.audit) ? payload.audit.length : 0,
    idempotencyReplayed: payload.idempotencyReplayed ?? false,
  };
}

async function loadFixture(path) {
  if (!path) throw new G5E2EGateError('G5_E2E_FIXTURE_REQUIRED', 'G5_FIXTURE_PATH is required in enrich mode');
  let fixture;
  try {
    fixture = JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    throw new G5E2EGateError('G5_E2E_FIXTURE_INVALID', 'G5 fixture must be a readable JSON file');
  }
  if (!Array.isArray(fixture?.rows) || fixture.rows.length === 0) {
    throw new G5E2EGateError('G5_E2E_FIXTURE_INVALID', 'G5 fixture rows must be a non-empty array');
  }
  return fixture;
}

export async function runG5E2E({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.G5_E2E !== '1') {
    throw new G5E2EGateError('G5_E2E_DISABLED', 'Refusing to run: set G5_E2E=1 explicitly');
  }
  if (typeof fetchImpl !== 'function') throw new G5E2EGateError('G5_E2E_FETCH_MISSING', 'Global fetch is unavailable');
  const baseUrl = requireLoopback(env.G5_BASE_URL ?? '');
  const mode = String(env.G5_E2E_MODE ?? 'preflight');
  if (!['preflight', 'enrich'].includes(mode)) {
    throw new G5E2EGateError('G5_E2E_MODE_INVALID', 'G5_E2E_MODE must be preflight or enrich');
  }

  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    mode,
    target: baseUrl,
    steps: [],
  };
  const capabilities = await jsonRequest(fetchImpl, `${baseUrl}/data-cleaning/api/g5/capabilities`);
  report.steps.push({ name: 'capabilities', ...responseSummary(capabilities) });
  if (mode === 'preflight') return redactSensitive(report);
  if (env.G5_E2E_CONFIRM_PAID_CALLS !== 'YES') {
    throw new G5E2EGateError(
      'G5_E2E_PAID_CONFIRMATION_REQUIRED',
      'Refusing paid calls: set G5_E2E_CONFIRM_PAID_CALLS=YES explicitly',
    );
  }
  if (capabilities.payload?.capabilities?.ready !== true) {
    throw new G5E2EGateError('G5_E2E_HOST_NOT_READY', 'QCC tools are not ready; complete OAuth connection before enrich mode');
  }

  const fixture = await loadFixture(env.G5_FIXTURE_PATH);
  const nameField = String(fixture.nameField ?? 'name');
  const companyNames = fixture.rows.map((row) => String(row?.[nameField] ?? '')).filter(Boolean);
  const enrichInput = {
    rows: fixture.rows,
    headers: Array.isArray(fixture.headers) ? fixture.headers : [],
    nameField,
    includeRisk: fixture.includeRisk === true,
    concurrency: Number(fixture.concurrency ?? 1),
  };
  const enrichBody = {
    idempotencyKey: keyFor('enrich', enrichInput),
    confirmPaidCalls: true,
    ...enrichInput,
  };
  let current = await jsonRequest(fetchImpl, `${baseUrl}/data-cleaning/api/g5/enrich`, {
    method: 'POST',
    body: enrichBody,
  });
  report.steps.push({ name: 'enrich', ...responseSummary(current) });

  for (const [index, selection] of (Array.isArray(fixture.selections) ? fixture.selections : []).entries()) {
    if (!current.payload?.runId) break;
    const resolveInput = {
      runId: current.payload.runId,
      companyName: selection.companyName,
      selectedCreditNo: selection.selectedCreditNo,
    };
    const resolveBody = {
      idempotencyKey: keyFor(`resolve-${index}`, resolveInput),
      confirmPaidCalls: true,
      ...resolveInput,
    };
    current = await jsonRequest(fetchImpl, `${baseUrl}/data-cleaning/api/g5/resolve`, {
      method: 'POST',
      body: resolveBody,
    });
    report.steps.push({ name: 'resolve-candidate', ...responseSummary(current) });
  }

  if (Array.isArray(fixture.retryCompanyNames) && fixture.retryCompanyNames.length > 0 && current.payload?.runId) {
    const retryInput = {
      runId: current.payload.runId,
      companyNames: fixture.retryCompanyNames,
    };
    const retryBody = {
      idempotencyKey: keyFor('retry', retryInput),
      confirmPaidCalls: true,
      ...retryInput,
    };
    current = await jsonRequest(fetchImpl, `${baseUrl}/data-cleaning/api/g5/retry`, {
      method: 'POST',
      body: retryBody,
    });
    report.steps.push({ name: 'manual-retry', ...responseSummary(current) });
  }

  report.finishedAt = new Date().toISOString();
  return redactSensitive(report, { companyNames });
}

async function main() {
  try {
    const report = await runG5E2E();
    const output = resolve(process.env.G5_E2E_REPORT ?? join(tmpdir(), `g5-e2e-${Date.now()}.json`));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`G5 E2E report written: ${output}`);
  } catch (error) {
    const code = String(error?.code ?? 'G5_E2E_FAILED');
    console.error(`${code}: ${redactSensitiveText(error?.message ?? 'G5 E2E failed')}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) await main();

#!/usr/bin/env node
/** 0.5.0 三域 E2E Runner：默认关闭、仅回环 Host、付费模式双重确认。 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSensitive, redactSensitiveText } from '../lib/qcc-safety.js';

const SELF = fileURLToPath(import.meta.url);

export class Phase3E2EGateError extends Error {
  constructor(code, message) { super(message); this.name = 'Phase3E2EGateError'; this.code = code; }
}

function loopback(value) {
  let url;
  try { url = new URL(value); } catch { throw new Phase3E2EGateError('PHASE3_E2E_BASE_URL_INVALID', 'PHASE3_BASE_URL must be an absolute HTTP URL'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Phase3E2EGateError('PHASE3_E2E_LOOPBACK_ONLY', 'Phase-3 E2E only permits an isolated loopback DSH host');
  }
  return url.toString().replace(/\/$/, '');
}

async function request(fetchImpl, url, body) {
  const response = await fetchImpl(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : { 'sec-fetch-site': 'same-origin' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Phase3E2EGateError('PHASE3_E2E_NON_JSON', `Endpoint returned non-JSON HTTP ${response.status}`); }
  return { status: response.status, payload };
}

function summary(name, response) {
  const p = response.payload ?? {};
  return {
    name, httpStatus: response.status, ok: p.ok === true, marker: p.marker ?? null,
    code: p.code ?? null, state: p.state ?? p.capabilities?.state ?? null,
    runId: p.runId ?? null,
    totalRegistered: Number(p.capabilities?.totalRegistered ?? 0),
    estimatedCalls: Number(p.estimate?.estimatedCalls ?? p.summary?.estimatedCalls ?? 0),
    actualCalls: Number(p.summary?.actualCalls ?? 0),
    enriched: Number(p.summary?.enriched ?? 0),
    partial: Number(p.summary?.partial ?? 0),
    reviewQueueCount: Array.isArray(p.reviewQueue) ? p.reviewQueue.length : 0,
    errorCount: Array.isArray(p.errors) ? p.errors.length : 0,
  };
}

function requireEndpoint(name, response, marker) {
  const payload = response.payload ?? {};
  if (response.status < 200 || response.status >= 300 || payload.ok !== true || payload.marker !== marker) {
    throw new Phase3E2EGateError(
      'PHASE3_E2E_ENDPOINT_FAILED',
      `${name} failed contract validation (HTTP ${response.status})`,
    );
  }
  return payload;
}

function keyFor(payload) {
  return `phase3-e2e:${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24)}`;
}

async function fixture(path) {
  if (!path) throw new Phase3E2EGateError('PHASE3_E2E_FIXTURE_REQUIRED', 'PHASE3_FIXTURE_PATH is required in enrich mode');
  let value;
  try { value = JSON.parse(await readFile(resolve(path), 'utf8')); } catch { throw new Phase3E2EGateError('PHASE3_E2E_FIXTURE_INVALID', 'Fixture must be readable JSON'); }
  if (!Array.isArray(value.rows) || !value.rows.length) throw new Phase3E2EGateError('PHASE3_E2E_FIXTURE_INVALID', 'Fixture rows must be non-empty');
  if ((!Array.isArray(value.domains) || !value.domains.length) && (!Array.isArray(value.tools) || !value.tools.length)) {
    throw new Phase3E2EGateError('PHASE3_E2E_FIXTURE_INVALID', 'Fixture must select domains or tools');
  }
  return value;
}

export async function runPhase3E2E({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.PHASE3_E2E !== '1') throw new Phase3E2EGateError('PHASE3_E2E_DISABLED', 'Refusing to run: set PHASE3_E2E=1 explicitly');
  if (typeof fetchImpl !== 'function') throw new Phase3E2EGateError('PHASE3_E2E_FETCH_MISSING', 'Global fetch is unavailable');
  const baseUrl = loopback(env.PHASE3_BASE_URL ?? '');
  const mode = String(env.PHASE3_E2E_MODE ?? 'preflight');
  if (!['preflight', 'enrich'].includes(mode)) throw new Phase3E2EGateError('PHASE3_E2E_MODE_INVALID', 'Mode must be preflight or enrich');
  const report = { schemaVersion: 1, mode, target: baseUrl, startedAt: new Date().toISOString(), steps: [] };
  const capabilities = await request(fetchImpl, `${baseUrl}/data-cleaning/api/phase3/capabilities`);
  report.steps.push(summary('capabilities', capabilities));
  const capabilityPayload = requireEndpoint('capabilities', capabilities, 'qcc-phase3-capabilities');
  if (
    capabilityPayload.capabilities?.ready !== true
    || capabilityPayload.capabilities?.total !== 91
    || capabilityPayload.capabilities?.totalRegistered !== 91
    || capabilityPayload.executesTools !== false
    || capabilityPayload.paidCalls !== false
  ) {
    throw new Phase3E2EGateError(
      'PHASE3_E2E_CAPABILITIES_INCOMPLETE',
      'Phase-3 requires all 91 registered tools and a zero-call capabilities probe',
    );
  }
  const contractProbe = await request(fetchImpl, `${baseUrl}/data-cleaning/api/phase3/estimate`, {
    rows: [{ name: 'contract-probe' }], tools: ['get_company_risk_scan'], maxCalls: 2,
  });
  report.steps.push(summary('estimate-zero-call', contractProbe));
  const contractPayload = requireEndpoint('estimate-zero-call', contractProbe, 'qcc-phase3-estimate');
  if (
    contractPayload.estimate?.executesTools !== false
    || contractPayload.estimate?.paidCalls !== false
    || contractPayload.estimate?.estimatedCalls !== 2
    || contractPayload.estimate?.withinLimit !== true
  ) {
    throw new Phase3E2EGateError('PHASE3_E2E_ESTIMATE_INVALID', 'Zero-call estimate contract is invalid');
  }
  if (mode === 'preflight') return redactSensitive(report);
  if (env.PHASE3_E2E_CONFIRM_PAID_CALLS !== 'YES') {
    throw new Phase3E2EGateError('PHASE3_E2E_PAID_CONFIRMATION_REQUIRED', 'Set PHASE3_E2E_CONFIRM_PAID_CALLS=YES after approving companies, domains and maxCalls');
  }
  const f = await fixture(env.PHASE3_FIXTURE_PATH);
  const maxCalls = Number(f.maxCalls);
  if (!Number.isFinite(maxCalls) || maxCalls < 1) throw new Phase3E2EGateError('PHASE3_E2E_FIXTURE_INVALID', 'Fixture must define a positive maxCalls budget');
  const input = {
    rows: f.rows, headers: Array.isArray(f.headers) ? f.headers : [], nameField: String(f.nameField ?? 'name'),
    domains: Array.isArray(f.domains) ? f.domains : [], tools: Array.isArray(f.tools) ? f.tools : [],
    maxCalls, concurrency: Number(f.concurrency ?? 1),
  };
  const estimate = await request(fetchImpl, `${baseUrl}/data-cleaning/api/phase3/estimate`, input);
  report.steps.push(summary('approved-estimate', estimate));
  const estimatePayload = requireEndpoint('approved-estimate', estimate, 'qcc-phase3-estimate');
  if (estimatePayload.estimate?.withinLimit !== true) throw new Phase3E2EGateError('PHASE3_E2E_BUDGET_EXCEEDED', 'Approved fixture exceeds maxCalls');
  const enriched = await request(fetchImpl, `${baseUrl}/data-cleaning/api/phase3/enrich`, {
    ...input, confirmPaidCalls: true, idempotencyKey: keyFor(input),
  });
  report.steps.push(summary('enrich', enriched));
  requireEndpoint('enrich', enriched, 'qcc-phase3-batch');
  report.finishedAt = new Date().toISOString();
  const names = f.rows.map((row) => String(row?.[input.nameField] ?? '')).filter(Boolean);
  return redactSensitive(report, { companyNames: names });
}

async function main() {
  try {
    const report = await runPhase3E2E();
    const output = resolve(process.env.PHASE3_E2E_REPORT ?? join(tmpdir(), `phase3-e2e-${Date.now()}.json`));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Phase-3 E2E report written: ${output}`);
  } catch (error) {
    console.error(`${String(error?.code ?? 'PHASE3_E2E_FAILED')}: ${redactSensitiveText(error?.message ?? 'Phase-3 E2E failed')}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) await main();

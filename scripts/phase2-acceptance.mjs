#!/usr/bin/env node
/**
 * 0.4.0 二期验收 Runner（默认关闭）。
 *
 * 该 Runner 只读取本地证据 JSON，不主动调用 QCC 或网络；
 * 输出只保留聚合统计和不透明行引用。
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateQccPhase2Evidence } from '../lib/qcc-phase2-acceptance.js';
import { redactSensitive, redactSensitiveText } from '../lib/qcc-safety.js';

const SELF = fileURLToPath(import.meta.url);

export class Phase2AcceptanceGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Phase2AcceptanceGateError';
    this.code = code;
  }
}

async function loadEvidence(path, readFileImpl) {
  if (!path) {
    throw new Phase2AcceptanceGateError(
      'PHASE2_EVIDENCE_REQUIRED',
      'QCC_PHASE2_EVIDENCE must point to a local JSON evidence file',
    );
  }
  try {
    return JSON.parse(await readFileImpl(resolve(path), 'utf8'));
  } catch {
    throw new Phase2AcceptanceGateError(
      'PHASE2_EVIDENCE_INVALID',
      'QCC phase-2 evidence must be readable JSON',
    );
  }
}

export async function runPhase2Acceptance({ env = process.env, readFileImpl = readFile } = {}) {
  if (env.QCC_PHASE2_ACCEPTANCE !== '1') {
    throw new Phase2AcceptanceGateError(
      'PHASE2_ACCEPTANCE_DISABLED',
      'Refusing to run: set QCC_PHASE2_ACCEPTANCE=1 explicitly',
    );
  }
  const evidence = await loadEvidence(env.QCC_PHASE2_EVIDENCE, readFileImpl);
  const report = evaluateQccPhase2Evidence(evidence, {
    requireHistory: env.QCC_PHASE2_REQUIRE_HISTORY === 'YES',
  });
  return redactSensitive({
    ...report,
    evaluatedAt: new Date().toISOString(),
  });
}

export async function writePhase2AcceptanceReport(
  output,
  report,
  { mkdirImpl = mkdir, writeFileImpl = writeFile, chmodImpl = chmod } = {},
) {
  const target = resolve(output);
  await mkdirImpl(dirname(target), { recursive: true });
  await writeFileImpl(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmodImpl(target, 0o600);
  return target;
}

async function main() {
  try {
    const report = await runPhase2Acceptance();
    const output = resolve(
      process.env.QCC_PHASE2_REPORT ?? join(tmpdir(), `qcc-phase2-acceptance-${Date.now()}.json`),
    );
    const target = await writePhase2AcceptanceReport(output, report);
    console.log(`QCC phase-2 acceptance report written: ${target}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    const code = String(error?.code ?? 'PHASE2_ACCEPTANCE_FAILED');
    console.error(`${code}: ${redactSensitiveText(error?.message ?? 'QCC phase-2 acceptance failed')}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) await main();

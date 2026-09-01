import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  QCC_PHASE2_COMPANY_TOOLS,
  QCC_PHASE2_HISTORY_TOOLS,
} from '../lib/qcc-phase2.js';
import { evaluateQccPhase2Evidence } from '../lib/qcc-phase2-acceptance.js';
import {
  runPhase2Acceptance,
  writePhase2AcceptanceReport,
} from '../scripts/phase2-acceptance.mjs';

function dimensionsFrom(tools, rowIndex, count = Object.keys(tools).length) {
  return Object.entries(tools).slice(0, count).map(([id, sourceTool]) => ({
    domain: sourceTool.includes('__qcc-history__') ? 'history' : 'company',
    id,
    status: 'resolved',
    sourceTool,
    fields: [{ key: 'evidence', value: `sample-${rowIndex}-${id}`, sourceValue: `sample-${rowIndex}-${id}` }],
  }));
}

function validEvidence({ includeHistory = false } = {}) {
  return {
    schemaVersion: 1,
    evidenceKind: 'qcc-phase2-real-tool-transcript',
    synthetic: false,
    historyAccess: includeHistory ? 'enterprise-certified' : 'not-requested',
    records: Array.from({ length: 20 }, (_value, index) => ({
      reference: `row-${String(index + 1).padStart(3, '0')}`,
      entityStatus: 'resolved',
      dimensions: [
        ...dimensionsFrom(QCC_PHASE2_COMPANY_TOOLS, index, 15),
        ...(includeHistory ? dimensionsFrom(QCC_PHASE2_HISTORY_TOOLS, index) : []),
      ],
    })),
  };
}

test('phase-2 Runner 默认关闭且不读取证据', async () => {
  let reads = 0;
  await assert.rejects(
    runPhase2Acceptance({ env: {}, readFileImpl: async () => { reads += 1; } }),
    (error) => error.code === 'PHASE2_ACCEPTANCE_DISABLED',
  );
  assert.equal(reads, 0);
});

test('20 条记录每条 15 个当前工商维度通过验收', () => {
  const report = evaluateQccPhase2Evidence(validEvidence());
  assert.equal(report.passed, true);
  assert.equal(report.summary.recordCount, 20);
  assert.equal(report.summary.minimumCurrentDimensions, 15);
});

test('显式拒绝合成证据被当作真实 E2E', () => {
  const evidence = validEvidence();
  evidence.synthetic = true;
  const report = evaluateQccPhase2Evidence(evidence);
  assert.equal(report.passed, false);
  assert.ok(report.globalFailures.includes('SYNTHETIC_EVIDENCE_REJECTED'));

  delete evidence.synthetic;
  const missingDeclaration = evaluateQccPhase2Evidence(evidence);
  assert.equal(missingDeclaration.passed, false);
  assert.ok(missingDeclaration.globalFailures.includes('SYNTHETIC_EVIDENCE_REJECTED'));
});

test('任一记录低于 15 维时失败', () => {
  const evidence = validEvidence();
  evidence.records[3].dimensions = evidence.records[3].dimensions.slice(0, 14);
  const report = evaluateQccPhase2Evidence(evidence);
  assert.equal(report.passed, false);
  assert.deepEqual(report.failures[0], {
    reference: 'row-004',
    codes: ['CURRENT_DIMENSION_FLOOR_NOT_MET'],
  });
});

test('来源工具必须与已验证契约精确匹配', () => {
  const evidence = validEvidence();
  evidence.records[0].dimensions[0].sourceTool = 'mcp__qcc-company__unverified_tool';
  const report = evaluateQccPhase2Evidence(evidence);
  assert.equal(report.passed, false);
  assert.ok(report.failures[0].codes.includes('SOURCE_TOOL_MISMATCH'));
});

test('验收接受 qcc-dsh-mcp-oauth 0.1.7 的已验证 legacy serverName', () => {
  const evidence = validEvidence({ includeHistory: true });
  for (const record of evidence.records) {
    for (const dimension of record.dimensions) {
      dimension.sourceTool = dimension.sourceTool.replace(/^mcp__qcc-(company|history)__/, 'mcp__$1__');
    }
  }
  const report = evaluateQccPhase2Evidence(evidence, { requireHistory: true });
  assert.equal(report.passed, true);
});

test('输出值与工具源值不一致时拒绝验收', () => {
  const evidence = validEvidence();
  evidence.records[0].dimensions[0].fields[0].sourceValue = 'different-source-value';
  const report = evaluateQccPhase2Evidence(evidence);
  assert.equal(report.passed, false);
  assert.ok(report.failures[0].codes.includes('VALUE_NOT_VERBATIM'));
});

test('不允许用空值或 no_data 冒充已解析主体', () => {
  const emptyValue = validEvidence();
  emptyValue.records[0].dimensions[0].fields[0].value = null;
  emptyValue.records[0].dimensions[0].fields[0].sourceValue = null;
  const emptyReport = evaluateQccPhase2Evidence(emptyValue);
  assert.equal(emptyReport.passed, false);
  assert.ok(emptyReport.failures[0].codes.includes('VALUE_NOT_VERBATIM'));

  const noIdentity = validEvidence();
  noIdentity.records[0].dimensions[0] = {
    ...noIdentity.records[0].dimensions[0],
    status: 'no_data',
    fields: [],
  };
  const identityReport = evaluateQccPhase2Evidence(noIdentity);
  assert.equal(identityReport.passed, false);
  assert.ok(identityReport.failures[0].codes.includes('IDENTITY_EVIDENCE_REQUIRED'));
});

test('多候选或未解析主体不能通过', () => {
  const evidence = validEvidence();
  evidence.records[0].entityStatus = 'ambiguous';
  evidence.records[1].entityStatus = 'unresolved';
  const report = evaluateQccPhase2Evidence(evidence);
  assert.equal(report.passed, false);
  assert.equal(report.summary.ambiguousRecords, 1);
  assert.equal(report.summary.unresolvedRecords, 1);
});

test('历史域验收要求企业认证标记和全部 4 维', () => {
  const missing = evaluateQccPhase2Evidence(validEvidence(), { requireHistory: true });
  assert.equal(missing.passed, false);
  assert.ok(missing.globalFailures.includes('ENTERPRISE_HISTORY_ACCESS_NOT_VERIFIED'));

  const complete = evaluateQccPhase2Evidence(validEvidence({ includeHistory: true }), { requireHistory: true });
  assert.equal(complete.passed, true);
  assert.equal(complete.summary.minimumHistoryDimensions, 4);
});

test('验收报告不携带输入字段值', async () => {
  const evidence = validEvidence();
  evidence.records[0].dimensions[0].fields[0].value = '测试企业敏感值';
  evidence.records[0].dimensions[0].fields[0].sourceValue = '测试企业敏感值';
  const report = await runPhase2Acceptance({
    env: { QCC_PHASE2_ACCEPTANCE: '1', QCC_PHASE2_EVIDENCE: '/local/evidence.json' },
    readFileImpl: async () => JSON.stringify(evidence),
  });
  assert.equal(report.passed, true);
  assert.equal(JSON.stringify(report).includes('测试企业敏感值'), false);
});

test('报告覆盖写后仍强制 0600 权限', async () => {
  const calls = [];
  const output = 'phase2-report.json';
  const target = await writePhase2AcceptanceReport(output, { passed: true }, {
    mkdirImpl: async (_path, options) => calls.push(['mkdir', options]),
    writeFileImpl: async (_path, _body, options) => calls.push(['write', options]),
    chmodImpl: async (_path, mode) => calls.push(['chmod', mode]),
  });
  assert.equal(target, resolve(output));
  assert.equal(calls[1][1].mode, 0o600);
  assert.equal(calls[2][1], 0o600);
});

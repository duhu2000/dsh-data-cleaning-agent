import * as engine from '../../lib/engine.js';
import { normalizeMappings, FIELD_LABELS, WORKFLOW_STAGES, WORKFLOW_STATES } from '../../lib/workflow-contract.js';
import { estimateQccCalls, QCC_TOOL_NAMES, QccHostBridge } from '../../lib/qcc.js';
import { WorkflowArtifactStore } from '../../lib/artifacts.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import XLSX from 'xlsx';

export const csvCases = [
  '', '\ufeff企业名称,备注\n合成企业甲,', 'A,B\r\n1,2\r\n', 'A,B\r1,2',
  'A,B\n"x,y","a""b"', 'A,B\n"x\ny",z', 'A,B\n1', 'A,B\n1,2,3',
  ',B\nx,y', 'A,A\nx,y', ' A , B \n x , y ', 'A,B\n,\n1,2',
  'A\n"unterminated', 'A,B\n=1+1,@sample', 'A\n00123', 'A\n😀',
  'A\n0', 'A\nfalse', 'A\n\t', 'A,B\n"",x',
];
export async function collectLegacy() {
  const rows = [{ 企业名称: '合成企业甲', 法定代表人: '', qcc_match_status: 'exact' }, { 企业名称: '合成企业乙', 法定代表人: '合成人员乙', qcc_match_status: 'candidate' }];
  const files = new Map();
  const fs = { resolve: async key => ({ key, displayPath: `/synthetic/${key}` }), writeText: async (target, text) => { files.set(target.key, Buffer.from(text)); }, readBytes: async target => files.get(target.key) };
  let id = 0;
  const store = new WorkflowArtifactStore({ fs, idFactory: () => `dca-golden-000${++id}`, nowFn: () => '2026-09-06T00:00:00.000Z' });
  const artifacts = await store.createBundle('dcw-golden-0001', { rows, headers: ['企业名称', '法定代表人', 'qcc_match_status'], baseName: '合成客户台账' });
  const artifactSemantics = [];
  for (const artifact of artifacts) {
    const bytes = await store.read('dcw-golden-0001', artifact);
    artifactSemantics.push({ kind: artifact.kind, format: artifact.format, fileName: artifact.fileName, content: artifact.format === 'csv' ? bytes.toString() : XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets[XLSX.read(bytes).SheetNames[0]], { defval: '' }) });
  }
  let calls = 0;
  const bridge = new QccHostBridge({ tools: { get: () => undefined, execute: () => { calls++; throw new Error('forbidden'); } }, toolWaitMs: 0 });
  let safetyCode;
  try { await bridge.call('synthetic-forbidden-tool', {}); } catch (e) { safetyCode = e.code; }
  const unchanged = {};
  for (const file of ['lib/tools.js', 'lib/skill.js', 'lib/skill-enrich.js', 'lib/web.js', 'lib/workflow.js', 'lib/workflow-contract.js', 'lib/artifacts.js', 'lib/qcc.js', 'lib/qcc-safety.js', 'lib/qcc-field-catalog.js', 'cordis.patch.yml']) {
    unchanged[file] = createHash('sha256').update(await readFile(new URL(`../../${file}`, import.meta.url))).digest('hex');
  }
  return {
    baseline: 'ee8dafb / v0.8.2; cwd user patch preserved',
    cases: [...csvCases.map((input, index) => ({ id: `csv-${index + 1}`, input, expected: engine.parseCsv(input) })),
      { id: 'mapping', expected: normalizeMappings([{ sourceField: '企业名称', targetField: 'company_name' }, { sourceField: '备注', targetField: 'invented' }]) },
      { id: 'qcc-plan', expected: estimateQccCalls(2, ['company_name', 'credit_no', 'legal_person']) },
      { id: 'qcc-safety', expected: { code: safetyCode, calls } },
      { id: 'artifacts', expected: artifactSemantics }],
    contract: { tools: QCC_TOOL_NAMES, fields: FIELD_LABELS, stages: WORKFLOW_STAGES, states: WORKFLOW_STATES, unchanged },
  };
}
if (process.argv.includes('--capture')) console.log(JSON.stringify(await collectLegacy(), null, 2));

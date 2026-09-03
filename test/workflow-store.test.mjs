import test from 'node:test';
import assert from 'node:assert/strict';
import { DataCleaningWorkflowStore, WORKFLOW_STORAGE } from '../lib/workflow.js';

function memoryStorageDomain() {
  const domains = new Map();
  return {
    domains,
    async open(spec) {
      let tables = domains.get(spec.name);
      if (!tables) {
        tables = new Map(Object.keys(spec.tables).map((name) => [name, new Map()]));
        domains.set(spec.name, tables);
      }
      return {
        table(name) {
          const data = tables.get(name);
          return {
            get: (key) => data.get(key),
            entries: () => data.entries(),
            put: async (key, value) => { data.set(key, structuredClone(value)); },
            update: async (key, updater) => {
              const value = updater(data.get(key));
              data.set(key, structuredClone(value));
            },
          };
        },
        async close() {},
      };
    },
  };
}

function clock() {
  let tick = 0;
  return () => `2026-09-03T00:00:${String(tick++).padStart(2, '0')}.000Z`;
}

async function createStore(storageDomain, ids = ['dcw-test-1', 'dcw-test-2']) {
  let offset = 0;
  return new DataCleaningWorkflowStore({
    storageDomain,
    logger: { info() {} },
    nowFn: clock(),
    idFactory: () => ids[offset++],
  }).init();
}

test('Host 工作流完成五步闭环并仅持久化安全元数据', async () => {
  const storage = memoryStorageDomain();
  const store = await createStore(storage);
  let task = await store.create({
    title: '供应商清洗',
    rows: [{ 企业名称: '不得持久化有限公司' }],
    content: '不得持久化有限公司',
    fieldSelection: ['legal_rep', 'registered_address'],
  });
  assert.equal(task.state, 'draft');
  assert.equal(task.stage, 'upload');

  task = await store.recordUpload(task.id, {
    expectedRevision: task.revision,
    source: {
      type: 'xlsx',
      fileName: '供应商.xlsx',
      rowCount: 20,
      columnCount: 3,
      headers: ['企业名称', '信用代码', '备注'],
      rows: [{ 企业名称: '不得持久化有限公司' }],
      content: '不得持久化有限公司',
    },
  });
  assert.equal(task.state, 'uploaded');
  assert.equal(task.source.rowCount, 20);
  assert.equal(Object.hasOwn(task.source, 'rows'), false);

  task = await store.confirmRules(task.id, {
    expectedRevision: task.revision,
    mappings: [
      { sourceField: '企业名称', targetField: 'company_name' },
      { sourceField: '信用代码', targetField: 'credit_no' },
    ],
    objectives: ['clean_name', 'validate_identity', 'complete_fields'],
  });
  assert.equal(task.state, 'rules_confirmed');

  task = await store.recordQuality(task.id, {
    expectedRevision: task.revision,
    summary: { total: 20, valid: 17, duplicates: 2, missingAnchor: 1, rawRows: ['不得持久化'] },
  });
  assert.equal(task.state, 'diagnosed');
  assert.deepEqual(Object.keys(task.qualitySummary).sort(), [
    'duplicates', 'emptyFields', 'invalidCreditNo', 'invalidPhone', 'missingAnchor', 'total', 'valid',
  ]);

  task = await store.startMatch(task.id, { expectedRevision: task.revision });
  assert.equal(task.state, 'matching');
  task = await store.recordMatch(task.id, {
    expectedRevision: task.revision,
    qccRunId: 'run-safe-reference',
    summary: { total: 18, exact: 15, candidate: 2, unresolved: 1, reviewRequired: 2 },
    candidates: [{ companyName: '不得持久化有限公司' }],
  });
  assert.equal(task.state, 'review_required');
  assert.equal(Object.hasOwn(task, 'candidates'), false);

  task = await store.recordMatch(task.id, {
    expectedRevision: task.revision,
    summary: { total: 18, exact: 15, confirmed: 2, unresolved: 1, reviewRequired: 0 },
  });
  assert.equal(task.state, 'matched');
  assert.equal(task.stage, 'enrich');

  task = await store.startEnrichment(task.id, { expectedRevision: task.revision });
  assert.equal(task.state, 'enriching');
  task = await store.recordEnrichment(task.id, {
    expectedRevision: task.revision,
    summary: { total: 18, completed: 17, unchanged: 1, failed: 0, callsUsed: 34 },
    rows: [{ companyName: '不得持久化有限公司' }],
  });
  assert.equal(task.state, 'export_ready');
  assert.equal(task.stage, 'download');

  task = await store.recordExport(task.id, {
    expectedRevision: task.revision,
    artifact: {
      id: 'artifact-safe-reference',
      kind: 'complete',
      format: 'xlsx',
      fileName: '清洗补全结果.xlsx',
      rowCount: 17,
      rows: [{ companyName: '不得持久化有限公司' }],
    },
  });
  assert.equal(task.state, 'completed');
  assert.equal(task.artifacts.length, 1);
  assert.equal(Object.hasOwn(task.artifacts[0], 'rows'), false);

  const persisted = JSON.stringify(storage.domains.get(WORKFLOW_STORAGE.domain).get(WORKFLOW_STORAGE.table).get(task.id));
  assert.doesNotMatch(persisted, /不得持久化/);
  await store.dispose();
});

test('taskId 隔离、重启恢复与 revision 并发保护有效', async () => {
  const storage = memoryStorageDomain();
  const first = await createStore(storage);
  const taskA = await first.create({ title: '任务 A' });
  const taskB = await first.create({ title: '任务 B' });
  const updatedA = await first.recordUpload(taskA.id, {
    expectedRevision: taskA.revision,
    source: { type: 'csv', fileName: 'a.csv', rowCount: 3, headers: ['企业名称'] },
  });
  assert.equal((await first.get(taskB.id)).state, 'draft');
  await assert.rejects(
    () => first.updateDraft(taskA.id, { expectedRevision: taskA.revision, title: '过期写入' }),
    { code: 'DC_WORKFLOW_REVISION_CONFLICT', status: 409 },
  );
  await first.dispose();

  const reopened = await createStore(storage, ['unused']);
  assert.equal((await reopened.get(taskA.id)).revision, updatedA.revision);
  assert.equal((await reopened.get(taskA.id)).source.fileName, 'a.csv');
  assert.equal((await reopened.get(taskB.id)).state, 'draft');
  await reopened.dispose();
});

test('规则确认阻止无企业身份锚点的字段映射', async () => {
  const store = await createStore(memoryStorageDomain());
  let task = await store.create({ title: '非法映射任务' });
  task = await store.recordUpload(task.id, {
    source: { type: 'csv', fileName: 'bad.csv', rowCount: 1, headers: ['电话'] },
  });
  await assert.rejects(
    () => store.confirmRules(task.id, {
      expectedRevision: task.revision,
      mappings: [{ sourceField: '电话', targetField: 'phone' }],
    }),
    { code: 'DC_WORKFLOW_ANCHOR_REQUIRED' },
  );
  await store.dispose();
});

test('本地规则链路可直接进入导出，并原子登记制品清单', async () => {
  const store = await createStore(memoryStorageDomain(), ['dcw-local-0001']);
  let task = await store.create({ title: '本地导出任务' });
  task = await store.recordUpload(task.id, {
    expectedRevision: task.revision,
    source: { type: 'csv', fileName: 'local.csv', rowCount: 2, headers: ['企业名称'] },
  });
  task = await store.confirmRules(task.id, {
    expectedRevision: task.revision,
    mappings: [{ sourceField: '企业名称', targetField: 'company_name' }],
  });
  task = await store.recordQuality(task.id, {
    expectedRevision: task.revision,
    summary: { total: 2, valid: 2 },
  });
  task = await store.prepareLocalExport(task.id, {
    expectedRevision: task.revision,
    summary: { total: 2, completed: 2 },
  });
  assert.equal(task.state, 'export_ready');
  task = await store.recordExport(task.id, {
    expectedRevision: task.revision,
    artifacts: [
      { id: 'dca-local-0001', kind: 'complete', format: 'csv', fileName: '结果.csv', rowCount: 2, sizeBytes: 42, checksum: 'sha256:a' },
      { id: 'dca-local-0002', kind: 'review', format: 'xlsx', fileName: '异常.xlsx', rowCount: 0, sizeBytes: 7100, checksum: 'sha256:b' },
    ],
  });
  assert.equal(task.state, 'completed');
  assert.equal(task.artifacts.length, 2);
  assert.equal(task.artifacts[1].sizeBytes, 7100);
  await store.dispose();
});

test('匹配候选确认与失败重试可从 partial 回到 export_ready', async () => {
  const store = await createStore(memoryStorageDomain(), ['dcw-retry-0001']);
  let task = await store.create({ title: '重试任务' });
  task = await store.recordUpload(task.id, { expectedRevision: task.revision, source: { rowCount: 3, headers: ['企业名称'] } });
  task = await store.confirmRules(task.id, {
    expectedRevision: task.revision,
    mappings: [{ sourceField: '企业名称', targetField: 'company_name' }],
  });
  task = await store.startMatch(task.id, { expectedRevision: task.revision });
  task = await store.recordMatch(task.id, {
    expectedRevision: task.revision,
    summary: { total: 3, exact: 1, candidate: 1, failed: 1, reviewRequired: 1 },
  });
  assert.equal(task.state, 'review_required');
  task = await store.recordMatch(task.id, {
    expectedRevision: task.revision,
    summary: { total: 3, exact: 1, confirmed: 1, failed: 1, reviewRequired: 0 },
  });
  task = await store.startEnrichment(task.id, { expectedRevision: task.revision });
  task = await store.recordEnrichment(task.id, {
    expectedRevision: task.revision,
    summary: { total: 3, completed: 2, failed: 1 },
  });
  assert.equal(task.state, 'partial');
  task = await store.startEnrichment(task.id, { expectedRevision: task.revision });
  task = await store.recordEnrichment(task.id, {
    expectedRevision: task.revision,
    summary: { total: 3, completed: 3, failed: 0 },
  });
  assert.equal(task.state, 'export_ready');
  await store.dispose();
});

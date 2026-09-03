import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mountWebRoutes } from '../lib/web.js';

function memoryStorageDomain() {
  const domains = new Map();
  return {
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
            put: async (key, value) => data.set(key, structuredClone(value)),
            update: async (key, updater) => data.set(key, structuredClone(updater(data.get(key)))),
          };
        },
        async close() {},
      };
    },
  };
}

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    },
    json() {
      return JSON.parse(this.body.toString('utf8'));
    },
  };
}

function memoryFs() {
  const files = new Map();
  return {
    files,
    sandboxMode: 'workspace-write',
    async resolve(path) { return { key: path, displayPath: `/workspace/${path}` }; },
    async writeText(target, content) { files.set(target.key, Buffer.from(content, 'utf8')); },
    async readBytes(target, _signal, maxBytes) {
      const bytes = files.get(target.key);
      if (!bytes) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' });
      if (bytes.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' });
      return bytes;
    },
  };
}

function request({ method = 'GET', url, body, trusted = true } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = { 'sec-fetch-site': trusted ? 'same-origin' : 'cross-site' };
  return req;
}

function harness({ storageDomain = null, fs = null } = {}) {
  const routes = new Map();
  const toolCalls = [];
  const webServer = {
    register({ path, handler }) {
      routes.set(path, handler);
      return () => routes.delete(path);
    },
  };
  const tools = {
    get: () => undefined,
    async execute(input) {
      toolCalls.push(input);
      throw new Error('workflow metadata API must not execute tools');
    },
  };
  const dispose = mountWebRoutes({
    webServer,
    tools,
    skills: {},
    jobs: null,
    storageDomain,
    fs,
  }, {
    logger: { info() {}, warn() {} },
    report: {},
    TOOL_NAME: 'data_clean_rows',
    SKILL_NAME: 'data-cleaning',
  });
  return { routes, toolCalls, dispose };
}

async function invoke(app, route, options) {
  const res = responseRecorder();
  await app.routes.get(route)(request(options), res);
  return res;
}

test('工作流契约端点无需 storageDomain 且不会触发 QCC 调用', async () => {
  const app = harness();
  const res = await invoke(app, '/data-cleaning/api/workflow/contract', {
    url: '/data-cleaning/api/workflow/contract',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json().marker, 'data-cleaning-workflow-v2');
  assert.deepEqual(res.json().contract.stages.map((stage) => stage.label), [
    '上传数据', '规则确认', '数据匹配', '清洗补全', '下载数据',
  ]);
  assert.equal(res.json().paidCalls, false);
  assert.equal(app.toolCalls.length, 0);
  app.dispose();
});

test('工作流任务 API 按 taskId 创建、推进、读取和恢复元数据', async () => {
  const app = harness({ storageDomain: memoryStorageDomain() });
  const collectionRoute = '/data-cleaning/api/workflow/tasks';
  let res = await invoke(app, collectionRoute, {
    method: 'POST',
    url: collectionRoute,
    body: { title: 'UI v2 验收任务', fieldSelection: ['legal_rep'] },
  });
  assert.equal(res.status, 201);
  let task = res.json().task;

  res = await invoke(app, collectionRoute, {
    method: 'POST',
    url: `${collectionRoute}/${task.id}/actions/upload`,
    body: {
      expectedRevision: task.revision,
      source: { type: 'csv', fileName: 'companies.csv', rowCount: 2, headers: ['企业名称'] },
    },
  });
  task = res.json().task;
  assert.equal(task.state, 'uploaded');

  res = await invoke(app, collectionRoute, {
    method: 'POST',
    url: `${collectionRoute}/${task.id}/actions/rules`,
    body: {
      expectedRevision: task.revision,
      mappings: [{ sourceField: '企业名称', targetField: 'company_name' }],
      objectives: ['clean_name', 'complete_fields'],
    },
  });
  task = res.json().task;
  assert.equal(task.state, 'rules_confirmed');

  res = await invoke(app, collectionRoute, {
    method: 'POST',
    url: `${collectionRoute}/${task.id}/actions/match-start`,
    body: { expectedRevision: task.revision },
  });
  task = res.json().task;
  assert.equal(task.state, 'matching');

  res = await invoke(app, collectionRoute, {
    method: 'GET',
    url: `${collectionRoute}/${task.id}`,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json().task.id, task.id);
  assert.equal(res.json().task.state, 'matching');

  res = await invoke(app, collectionRoute, { method: 'GET', url: collectionRoute });
  assert.equal(res.status, 200);
  assert.equal(res.json().tasks.length, 1);
  assert.equal(app.toolCalls.length, 0);
  app.dispose();
});

test('工作流任务 API 拒绝跨站请求和过期 revision', async () => {
  const app = harness({ storageDomain: memoryStorageDomain() });
  const route = '/data-cleaning/api/workflow/tasks';
  let res = await invoke(app, route, {
    method: 'POST',
    url: route,
    body: { title: '安全任务' },
    trusted: false,
  });
  assert.equal(res.status, 403);

  res = await invoke(app, route, { method: 'POST', url: route, body: { title: '并发任务' } });
  const task = res.json().task;
  res = await invoke(app, route, {
    method: 'PATCH',
    url: `${route}/${task.id}`,
    body: { expectedRevision: task.revision + 1, title: '过期更新' },
  });
  assert.equal(res.status, 409);
  assert.equal(res.json().code, 'DC_WORKFLOW_REVISION_CONFLICT');
  app.dispose();
});

test('缺少 storageDomain 时任务 API 明确返回 503', async () => {
  const app = harness();
  const route = '/data-cleaning/api/workflow/tasks';
  const res = await invoke(app, route, { method: 'GET', url: route });
  assert.equal(res.status, 503);
  assert.equal(res.json().code, 'DC_WORKFLOW_UNAVAILABLE');
  app.dispose();
});

test('Host 导出制品可跨插件重挂载恢复并下载真实 XLSX', async () => {
  const storageDomain = memoryStorageDomain();
  const fs = memoryFs();
  const route = '/data-cleaning/api/workflow/tasks';
  let app = harness({ storageDomain, fs });
  let res = await invoke(app, route, {
    method: 'POST', url: route, body: { title: '耐久制品任务' },
  });
  let task = res.json().task;
  for (const [action, body] of [
    ['upload', { source: { type: 'csv', fileName: 'companies.csv', rowCount: 2, headers: ['企业名称', 'qcc_match_status'] } }],
    ['rules', { mappings: [{ sourceField: '企业名称', targetField: 'company_name' }] }],
    ['quality', { summary: { total: 2, valid: 2 } }],
  ]) {
    res = await invoke(app, route, {
      method: 'POST',
      url: `${route}/${task.id}/actions/${action}`,
      body: { ...body, expectedRevision: task.revision },
    });
    assert.equal(res.status, 200);
    task = res.json().task;
  }
  res = await invoke(app, route, {
    method: 'POST',
    url: `${route}/${task.id}/artifacts`,
    body: {
      expectedRevision: task.revision,
      headers: ['企业名称', 'qcc_match_status'],
      rows: [
        { 企业名称: '甲公司', qcc_match_status: 'exact' },
        { 企业名称: '乙公司', qcc_match_status: 'unresolved' },
      ],
      summary: { total: 2, completed: 2 },
    },
  });
  assert.equal(res.status, 201);
  task = res.json().task;
  assert.equal(task.state, 'completed');
  assert.equal(task.artifacts.length, 4);
  const xlsxArtifact = task.artifacts.find((item) => item.kind === 'complete' && item.format === 'xlsx');
  assert.ok(xlsxArtifact);
  app.dispose();

  app = harness({ storageDomain, fs });
  res = await invoke(app, route, {
    method: 'GET',
    url: `${route}/${task.id}/artifacts/${xlsxArtifact.id}`,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(res.body.subarray(0, 2).toString('ascii'), 'PK');
  res = await invoke(app, route, { method: 'GET', url: `${route}/${task.id}` });
  assert.equal(res.json().task.artifacts.length, 4);
  app.dispose();
});

// Executes actual installed SDK method bodies against isolated synthetic seams.
// No profile, transport, model, credentials, or production process is opened.
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const rc = process.env.DSH_RC_MODULES;
const alpha = process.env.DSH_ALPHA_STORE;
assert.ok(rc && alpha, 'Set DSH_RC_MODULES and DSH_ALPHA_STORE to installed SDK code (not profiles)');
const isolatedHome = mkdtempSync(join(tmpdir(), 'form-fill-session-probe-'));
process.env.DSH_HOME = isolatedHome;
function packageDir(name, baseline) {
  if (baseline === 'rc.2') return join(rc, '@deepseek-ai', name);
  const entry = readdirSync(alpha).find(p => p.startsWith(`@deepseek-ai+${name}@0.1.2-alpha.2_`));
  assert.ok(entry, `Missing alpha package: ${name}`);
  return join(alpha, entry, 'node_modules/@deepseek-ai', name);
}
function method(source, signature, occurrence = 0) {
  let start = -1;
  for (let i = 0; i <= occurrence; i++) start = source.indexOf(signature, start + 1);
  assert.ok(start >= 0, `SDK method not found: ${signature}`);
  const line = source.lastIndexOf('\n', start) + 1;
  const indent = source.slice(line, start);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(end > start);
  return source.slice(start, end + indent.length + 2);
}
const report = [];
for (const baseline of ['rc.2', 'alpha.2']) {
  const hostDir = packageDir(baseline === 'rc.2' ? 'dsh-host-apiproxy' : 'dsh-api-session-controller', baseline);
  const clientDir = packageDir(baseline === 'rc.2' ? 'dsh-client-runtime' : 'dsh-api-session-controller', baseline);
  const uiDir = packageDir(baseline === 'rc.2' ? 'dsh-client-runtime' : 'dsh-client-ui-workspace', baseline);
  const hostSource = readFileSync(join(hostDir, 'lib/index.js'), 'utf8');
  const clientSource = readFileSync(join(clientDir, 'lib/client.js'), 'utf8');
  const uiSource = readFileSync(join(uiDir, 'lib/client.js'), 'utf8');
  const version = JSON.parse(readFileSync(join(hostDir, 'package.json'))).version;
  assert.equal(version, baseline === 'rc.2' ? '0.1.1-rc.2' : '0.1.2-alpha.2');
  const workspace = { id: 'synthetic-workspace', workspaceId: 'synthetic-workspace', path: resolve(isolatedHome, baseline), sessionIds: [], async attachSession(id) { this.sessionIds.push(id); } };
  const created = new Map();
  const ctx = { workspaceRegistry: { get: id => id === workspace.id ? workspace : undefined }, agents: { get: () => undefined } };
  const ensureSession = async (id, cwd) => { created.set(id, cwd); return { session: {} }; };
  class RemoteError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const hostMethod = method(hostSource, 'async create(request)');
  const host = new Function('ctx', 'ensureSession', 'defaults', 'WorkspaceId', 'ok', 'err', 'RemoteError', `return ({${hostMethod}}).create`)(
    ctx, ensureSession, { cwd: isolatedHome }, x => x, (_, value) => ({ ok: true, value }), (_, error) => ({ ok: false, error }), RemoteError,
  );
  const owner = { ctx, defaultCwd: isolatedHome, agents: { ensureSession, presetForSession: () => undefined }, rejectCreation: (_, e) => { throw e; } };
  async function invoke(payload) {
    const value = await host.call(owner, baseline === 'rc.2' ? { payload } : payload);
    return baseline === 'rc.2' ? value : { ok: true, value };
  }
  const summaries = [];
  const manager = { api: { sessions: { create: async p => ({ result: await invoke(p) }) } }, remote: { session: { create: invoke } }, recordMutation: m => summaries.push({ ...m.summary, id: m.summary.sessionId }) };
  const managerCreate = new Function(`return ({${method(clientSource, 'async create(opts = {})')}}).create`)();
  const runtimeCreate = new Function('SessionCreateError', `return ({${method(clientSource, 'async create(opts = {})', 1)}}).create`)(RemoteError);
  const runtime = { manager: { create: p => managerCreate.call(manager, p) }, projectList() {} };
  assert.equal(await runtimeCreate.call(runtime, { cwd: workspace.path, sessionId: 'detached' }), 'detached');
  assert.equal(created.get('detached'), workspace.path);
  assert.deepEqual(workspace.sessionIds, []);
  assert.equal(summaries[0].blank, true);
  const list = { getSnapshot: () => ({ items: [workspace], archivedSessionIds: [] }) };
  let nativeCreates = 0;
  const ui = { list, workspaces: { list }, connecting: new Map(), sessions: { list: { getSnapshot: () => ({ ids: summaries.map(s => s.id), byId: Object.fromEntries(summaries.map(s => [s.id, s])) }) }, create: async () => { nativeCreates++; return 'native-new'; } } };
  const connect = new Function(`return ({${method(uiSource, 'async connectWorkspace(workspaceId)')}}).connectWorkspace`)();
  assert.equal(await connect.call(ui, workspace.id), 'native-new');
  assert.equal(nativeCreates, 1);
  assert.equal(await runtimeCreate.call(runtime, { workspaceId: workspace.id, sessionId: 'attached' }), 'attached');
  assert.deepEqual(workspace.sessionIds, ['attached']);
  // Host list hydration supplies cwd for workspace-created sessions.
  summaries.find(s => s.id === 'attached').cwd = workspace.path;
  assert.equal(await connect.call(ui, workspace.id), 'attached');
  if (baseline === 'alpha.2') await assert.rejects(invoke({ workspaceId: workspace.id, cwd: workspace.path, sessionId: 'invalid' }), { code: 'gateway/bad-request' });
  report.push({ baseline, version, hostSha256: createHash('sha256').update(hostSource).digest('hex'), clientSha256: createHash('sha256').update(clientSource).digest('hex'), checks: ['cwd-preserved', 'caller-id-preserved', 'cwd-not-attached', 'blank-stays-blank', 'detached-not-reused', 'workspace-attached', 'attached-reused'], result: 'PASS' });
}
console.log(JSON.stringify({ kind: 'installed-SDK-method-probe', networkCalls: 0, profilesOpened: 0, report }, null, 2));

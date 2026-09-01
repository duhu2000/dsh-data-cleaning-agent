/**
 * Host 半区路由：上传解析 / 同步清洗补全（含 CSV 下载）/ 异步任务 / UI 页面。
 * 路径沿用 spike 系列的 `/data-cleaning/...` 前缀；本 MVP 使用 `/data-cleaning/api/mvp/*`。
 *
 * 安全：
 *  - 同源守卫（isTrusted）：cross-site fetch 直接 403。
 *  - 上传体大小上限（parseBody）。
 *  - 同步接口返回明细行仅供「已授权同源 UI」下载，不面向模型。
 */
import { parseCsv, parseXlsx, parseJson, detectFormat, toCsv } from './engine.js';
import { runSync, DataCleaningJobs } from './jobs.js';

const MAX_BODY = 16 * 1024 * 1024; // 16 MiB 上传上限（MVP）

function isTrusted(req) {
  const ffs = String(req.headers['sec-fetch-site'] ?? '');
  if (ffs === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.hostname !== '127.0.0.1' && o.hostname !== 'localhost') return false;
    } catch {
      return false;
    }
  }
  return true;
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req, max = MAX_BODY) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) {
      const err = new Error(`body exceeds ${max} bytes`);
      err.code = 'DC_TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 从 JSON 协议解析上传：{ filename, content }。content 为字符串；xlsx 时为 base64。 */
async function parseUpload(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    const err = new Error('body must be JSON: { filename, content }');
    err.code = 'DC_BAD_JSON';
    throw err;
  }
  const filename = String(payload?.filename ?? 'data.csv');
  const content = payload?.content ?? '';
  const fmt = detectFormat(filename);
  if (fmt === 'xlsx') {
    const buf = Buffer.from(String(content), 'base64');
    return { fmt, ...(await parseXlsx(buf)) };
  }
  if (fmt === 'json') return { fmt, ...parseJson(String(content)) };
  return { fmt, ...parseCsv(String(content)) };
}

const UI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>数据清洗补全智能体 · MVP</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.6 system-ui, -apple-system, "PingFang SC", sans-serif; max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 140px; font: 12px/1.4 ui-monospace, SFMono-Regular, monospace; }
  .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
  button { padding: 6px 14px; cursor: pointer; }
  pre { background: rgba(128,128,128,.12); padding: 12px; border-radius: 6px; overflow: auto; }
  .muted { opacity: .7; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid rgba(128,128,128,.4); padding: 3px 8px; text-align: left; }
</style>
</head>
<body>
<h1>数据清洗补全智能体 <span class="muted">· MVP</span></h1>
<p class="muted">粘贴 CSV（含表头）或上传 CSV/XLSX，然后清洗 / 补全 / 概览。</p>

<div class="row">
  <input id="file" type="file" accept=".csv,.txt,.xlsx,.xls,.json">
  <button id="upload">上传并解析</button>
</div>
<textarea id="src" placeholder="name,phone,amount&#10;张三,13800000001,100&#10;李四,13800000002,-20"></textarea>

<div class="row">
  <button id="parse">解析预览</button>
  <button id="clean">清洗</button>
  <button id="complete">补全</button>
  <button id="profile">概览</button>
  <button id="job">后台任务</button>
</div>

<div id="out"><pre class="muted">结果将显示在这里。</pre></div>

<script>
const $ = (id) => document.getElementById(id);
const out = (obj) => { $('out').innerHTML = '<pre></pre>'; $('out').querySelector('pre').textContent = JSON.stringify(obj, null, 2); };

async function call(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function currentText() {
  const f = $('file').files[0];
  if (f) return { filename: f.name, content: null, file: f };
  return { filename: 'data.csv', content: $('src').value, file: null };
}

async function withRows() {
  const c = currentText();
  if (c.file) {
    const isXlsx = /\\.(xlsx|xls)$/i.test(c.file.name);
    if (isXlsx) {
      const buf = await c.file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const p = await call('/data-cleaning/api/mvp/parse', { filename: c.file.name, content: b64 });
      if (!p.ok) throw new Error(JSON.stringify(p));
      return { rows: p.rows, headers: p.headers };
    }
    const txt = await c.file.text();
    const p = await call('/data-cleaning/api/mvp/parse', { filename: c.file.name, content: txt });
    if (!p.ok) throw new Error(JSON.stringify(p));
    return { rows: p.rows, headers: p.headers };
  }
  return { rows: JSON.parse($('src').value || '[]'), headers: null };
}

$('parse').onclick = async () => {
  try {
    const c = currentText();
    if (c.file) {
      const isXlsx = /\\.(xlsx|xls)$/i.test(c.file.name);
      let content;
      if (isXlsx) {
        const buf = await c.file.arrayBuffer();
        content = btoa(String.fromCharCode(...new Uint8Array(buf)));
      } else content = await c.file.text();
      out(await call('/data-cleaning/api/mvp/parse', { filename: c.file.name, content }));
    } else {
      out(await call('/data-cleaning/api/mvp/parse', { filename: 'data.csv', content: $('src').value }));
    }
  } catch (e) { out({ ok: false, error: String(e) }); }
};

async function runOp(path) {
  try {
    const { rows, headers } = await withRows();
    const res = await call(path, { rows, headers });
    if (res && res.csv) {
      out({ ...res, csvPreview: res.csv.slice(0, 500) + (res.csv.length > 500 ? '…' : '') });
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = res.downloadName || (path.includes('clean') ? 'cleaned.csv' : 'completed.csv');
      a.click();
    } else out(res);
  } catch (e) { out({ ok: false, error: String(e) }); }
}

$('clean').onclick = () => runOp('/data-cleaning/api/mvp/clean');
$('complete').onclick = () => runOp('/data-cleaning/api/mvp/complete');
$('profile').onclick = () => runOp('/data-cleaning/api/mvp/profile');

$('job').onclick = async () => {
  try {
    const { rows, headers } = await withRows();
    const started = await call('/data-cleaning/api/mvp/jobs', { kind: 'clean', rows, headers });
    out(started);
    if (started && started.id) {
      let t = 0;
      const timer = setInterval(async () => {
        const st = await call('/data-cleaning/api/mvp/job/' + started.id);
        if (!st || st.state === 'completed' || st.state === 'failed' || st.state === 'killed' || t++ > 20) {
          clearInterval(timer);
          out(st);
        }
      }, 500);
    }
  } catch (e) { out({ ok: false, error: String(e) }); }
};
</script>
</body>
</html>`;

export function mountWebRoutes(wctx, { logger, report, TOOL_NAME, SKILL_NAME }) {
  const server = wctx.webServer;
  const tools = wctx.tools;
  const skills = wctx.skills;
  const disposers = [];
  let state = null; // DataCleaningJobs，惰性初始化
  let stateReady = null;

  const register = (path, handler) => {
    disposers.push(server.register({ kind: 'prefix', path, handler }));
  };

  const getState = () => {
    if (wctx.jobs && wctx.storageDomain) {
      if (!stateReady) {
        state = new DataCleaningJobs({ jobs: wctx.jobs, storageDomain: wctx.storageDomain, logger });
        stateReady = state.init();
      }
      return stateReady;
    }
    return null;
  };

  register('/data-cleaning/', (req, res) => {
    if (!isTrusted(req)) { res.writeHead(403); return res.end('untrusted origin'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(UI_HTML);
  });

  register('/data-cleaning/api/mvp/seam', (req, res) => {
    if (!isTrusted(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' });
    writeJson(res, 200, {
      ok: true,
      marker: 'mvp-seam',
      report,
      capabilities: {
        toolRegistered: Boolean(tools.get(TOOL_NAME)),
        tools: [TOOL_NAME, 'data_complete_rows', 'data_profile'].map((n) => ({ name: n, registered: Boolean(tools.get(n)) })),
        skillListed: null,
        jobs: Boolean(wctx.jobs),
        storageDomain: Boolean(wctx.storageDomain),
      },
    });
  });

  register('/data-cleaning/api/mvp/parse', async (req, res) => {
    if (!isTrusted(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' });
    try {
      const body = await readBody(req);
      const { fmt, headers, rows } = await parseUpload(body);
      writeJson(res, 200, {
        ok: true,
        fmt,
        headers,
        rowCount: rows.length,
        preview: rows.slice(0, 5),
        rows,
      });
    } catch (error) {
      writeJson(res, 400, { ok: false, code: error?.code ?? 'DC_PARSE', message: error instanceof Error ? error.message : String(error) });
    }
  });

  const syncOp = (kind) => async (req, res) => {
    if (!isTrusted(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' });
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body.toString('utf8'));
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      const headers = Array.isArray(payload?.headers) ? payload.headers : [];
      const result = runSync(kind, rows, { headers });
      const csv = result.rows.length ? toCsv(headers.length ? headers : result.rows[0] ? Object.keys(result.rows[0]) : [], result.rows) : '';
      writeJson(res, 200, {
        ok: true,
        kind,
        summary: result.summary,
        rowCount: result.rows.length,
        csv,
        downloadName: kind === 'clean' ? 'cleaned.csv' : kind === 'complete' ? 'completed.csv' : null,
      });
    } catch (error) {
      writeJson(res, 400, { ok: false, code: error?.code ?? 'DC_SYNC', message: error instanceof Error ? error.message : String(error) });
    }
  };

  register('/data-cleaning/api/mvp/clean', syncOp('clean'));
  register('/data-cleaning/api/mvp/complete', syncOp('complete'));
  register('/data-cleaning/api/mvp/profile', syncOp('profile'));

  register('/data-cleaning/api/mvp/jobs', async (req, res) => {
    if (!isTrusted(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' });
    try {
      if (req.method === 'GET') {
        const ready = getState();
        if (!ready) return writeJson(res, 503, { ok: false, error: 'jobs/storage unavailable in this composition' });
        await ready;
        const list = await state.list();
        return writeJson(res, 200, { ok: true, jobs: list });
      }
      const body = await readBody(req);
      const payload = JSON.parse(body.toString('utf8'));
      const ready = getState();
      if (!ready) return writeJson(res, 503, { ok: false, error: 'jobs/storage unavailable in this composition' });
      await ready;
      const id = await state.start({
        kind: payload?.kind === 'complete' || payload?.kind === 'profile' ? payload.kind : 'clean',
        rows: Array.isArray(payload?.rows) ? payload.rows : [],
        headers: Array.isArray(payload?.headers) ? payload.headers : [],
      });
      writeJson(res, 202, { ok: true, id });
    } catch (error) {
      writeJson(res, 400, { ok: false, code: error?.code ?? 'DC_JOB', message: error instanceof Error ? error.message : String(error) });
    }
  });

  register('/data-cleaning/api/mvp/job', async (req, res) => {
    if (!isTrusted(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' });
    try {
      const ready = getState();
      if (!ready) return writeJson(res, 503, { ok: false, error: 'jobs/storage unavailable in this composition' });
      await ready;
      const id = String((req.url ?? '').split('/').filter(Boolean).pop() ?? '');
      const rec = await state.get(id);
      writeJson(res, 200, rec ?? { ok: false, error: 'not found', id });
    } catch (error) {
      writeJson(res, 400, { ok: false, code: error?.code ?? 'DC_JOB', message: error instanceof Error ? error.message : String(error) });
    }
  });

  return () => {
    if (state) { state.dispose().catch(() => {}); }
    for (const dispose of disposers) dispose();
  };
}

/**
 * Job / Storage 状态机（Spike #4 实测同构）。
 *  - `ctx.jobs`：后台任务生命周期（start/wait/read/kill/list），host bundle 需先
 *    `attachController()`（无主 job 否则抛 "no job controller serves this agent"）。
 *  - `ctx.storageDomain`：schema 校验的持久 KV，落盘 `DSH_HOME/storages/<domain>.json`。
 *
 * 任务记录持久化到 domain `dc_tasks_v1`（table `jobs`），状态机：
 *   queued → running → completed | failed | killed
 */
import { cleanRows, completeRows, profileRows } from './engine.js';

const DOMAIN_NAME = 'dc_tasks_v1';
const DOMAIN_VERSION = 1;
const permissiveSchema = {
  parse: (v) => v,
  safeParse: (v) => ({ success: true, data: v }),
};

const domainSpec = () => ({
  name: DOMAIN_NAME,
  version: DOMAIN_VERSION,
  tables: { jobs: { valueSchema: permissiveSchema } },
});

function now() {
  return new Date().toISOString();
}

/** 同步执行一次清洗/补全/概览，返回完整明细（供下载）与摘要。 */
export function runSync(kind, rows, opts = {}) {
  switch (kind) {
    case 'clean': {
      const r = cleanRows(rows, opts);
      return { kind, summary: { total: r.total, kept: r.kept, dropped: r.dropped, badMissing: r.badMissing, badAmount: r.badAmount, badDuplicate: r.badDuplicate }, rows: r.cleaned, headers: opts.headers ?? [] };
    }
    case 'complete': {
      const r = completeRows(rows, opts);
      return { kind, summary: { total: r.total, completed: r.completed, incompleteCount: r.incompleteCount, name: r.fillStats.name, amount: r.fillStats.amount, phoneNormalized: r.fillStats.phoneNormalized }, rows: r.completed, headers: opts.headers ?? [] };
    }
    case 'profile': {
      const r = profileRows(rows, opts);
      return { kind, summary: { rowCount: r.rowCount, columnCount: r.columnCount, columns: r.columns, amountStats: r.amountStats }, rows: [], headers: opts.headers ?? [] };
    }
    default:
      throw new Error(`unknown kind: ${kind}`);
  }
}

export class DataCleaningJobs {
  constructor({ jobs, storageDomain, logger }) {
    this.jobs = jobs;
    this.storageDomain = storageDomain;
    this.logger = logger ?? console;
    this.access = null;
    this.detachController = null;
  }

  async init() {
    if (!this.jobs) throw new Error('jobs service unavailable');
    if (!this.storageDomain) throw new Error('storageDomain service unavailable');
    // host bundle 提供自己的后台执行器
    this.detachController = this.jobs.attachController('data-cleaning-agent-mvp');
    this.access = await this.storageDomain.open(domainSpec());
    this.logger.info('[dc-agent] jobs/storage state machine ready');
    return this;
  }

  table() {
    if (!this.access) throw new Error('state machine not initialized');
    return this.access.table('jobs');
  }

  async start({ kind, rows, headers, opts = {} }) {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      kind,
      state: 'queued',
      rowsIn: Array.isArray(rows) ? rows.length : 0,
      summary: null,
      rowsOut: 0,
      error: null,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
    };
    await this.table().put(id, record);

    // 将明细暂存在内存闭包，任务完成时写回摘要（不把原始行写进持久 KV，避免膨胀）。
    const taskRows = Array.isArray(rows) ? rows : [];

    this.jobs.start({
      kind: `dc-${kind}`,
      label: `data-cleaning ${kind} (${record.rowsIn} rows)`,
      run: () => {
        let resolveDone;
        const done = new Promise((res) => { resolveDone = res; });
        const finish = async (patch) => {
          try {
            await this.table().update(id, (rec) => ({ ...rec, ...patch, finishedAt: now() }));
          } catch (e) {
            this.logger.warn(`[dc-agent] update failed for ${id}: ${e?.message ?? e}`);
          }
        };
        // 同步执行（MVP 体量直接跑；大文件异步化留给产品阶段）
        queueMicrotask(async () => {
          try {
            await this.table().update(id, (rec) => ({ ...rec, state: 'running', startedAt: now() }));
            const result = runSync(kind, taskRows, { ...opts, headers });
            await finish({ state: 'completed', summary: result.summary, rowsOut: result.rows.length });
            resolveDone({ status: 'completed', output: result });
          } catch (error) {
            await finish({ state: 'failed', error: error instanceof Error ? error.message : String(error) });
            resolveDone({ status: 'failed', detail: error instanceof Error ? error.message : String(error) });
          }
        });
        return {
          done,
          readOutput: () => '',
          cancel: (reason) => {
            finish({ state: 'killed', error: String(reason ?? 'cancelled') }).catch(() => {});
            resolveDone({ status: 'killed', detail: String(reason ?? 'cancelled') });
          },
        };
      },
    });

    return id;
  }

  async list() {
    const entries = this.table().entries();
    return [...entries].map(([, rec]) => rec).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async get(id) {
    return this.table().get(id) ?? null;
  }

  async dispose() {
    if (this.access) { try { await this.access.close(); } catch {} this.access = null; }
    if (this.detachController) { try { this.detachController(); } catch {} this.detachController = null; }
  }
}

/**
 * Client 半区（M1 入口 + M2 工作台）。
 *
 * 通过 `window.__ModuleLoader__.load({id, factory})` 注册为惰性 CJS 工厂，
 * 与 dsh-mcp-connector@0.2.32（生产 profile 中已实测的「MCP连接器」）同构：
 *   - `react` / `@deepseek-ai/dsh-client-ui-primitives` 由 web shell 静态模块表提供，
 *     第三方 bundle 无需打包 React、无需构建步骤。
 *   - `defineStore` 首选 `@deepseek-ai/dsh-client-store`，回退 `@deepseek-ai/dsh-client-runtime/client`。
 *   - 入口注册到 `sidebar.footer.action`（order 10，排在 MCP连接器的 order 0 下方），
 *     工作台注册到 `shell.overlay`（order 200）。
 *
 * 0.5.0 工作台复用本地 `/mvp/*` 与三域 `/phase3/*` 后端，完整覆盖上传映射、
 * 数据体检、匹配核验、补全导出；计费调用仍由 Host Bridge 的确认/幂等/上限门约束。
 */
window.__ModuleLoader__.load({
  id: 'dsh-data-cleaning-agent',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives');

    let defineStore;
    try {
      ({ defineStore } = require('@deepseek-ai/dsh-client-store'));
    } catch (storeError) {
      try {
        ({ defineStore } = require('@deepseek-ai/dsh-client-runtime/client'));
      } catch (runtimeError) {
        throw new AggregateError(
          [storeError, runtimeError],
          'data-cleaning-agent: DSH client store is unavailable'
        );
      }
    }

    const h = react.createElement;

    /** 客户端所需服务：与 mcp-connector 对齐（槽位 + 会话/工作区/输入机）。 */
    const inject = ['slots', 'sessions', 'workspaces', 'conversation'];

    const FOOTER_STYLE_ID = 'dsh-data-cleaning-agent-sidebar';
    const stylesCss = `
[data-slot="sidebar.footer.action"] {
  display: flex !important;
  flex-direction: column;
  min-width: 0;
  width: 100%;
}

.dcAgentLauncher {
  flex: none;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.dcAgentOverlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  background: rgba(8, 10, 14, 0.22);
}

.dcAgentWorkbench {
  display: flex;
  flex-direction: column;
  width: min(980px, calc(100vw - 72px));
  height: 100vh;
  border: 1px solid light-dark(#d5dae4, #2a3038);
  border-radius: 14px 0 0 14px;
  background: light-dark(#ffffff, #161b23);
  color: light-dark(#172033, #edf2fa);
  box-shadow: light-dark(0 18px 50px rgba(33, 55, 88, .14), 0 20px 60px rgba(0, 0, 0, .42));
  overflow: hidden;
}
.dcAgentWorkbench.is-expanded { width: calc(100vw - 72px); }

.dcAgentWbHeader {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid light-dark(#e4e8f0, #303947);
}

.dcAgentWbTitle {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 auto;
}

.dcAgentWbIcon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 11px;
  font-size: 18px;
  background: light-dark(#edf4ff, #172841);
}

.dcAgentWbTitle b { display: block; font-size: 15px; }
.dcAgentWbTitle small { display: block; color: light-dark(#697386, #aab5c7); font-size: 11px; }

.dcAgentQccBadge {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 999px;
  color: light-dark(#697386, #aab5c7);
  font-size: 11px;
  white-space: nowrap;
}

.dcAgentWbClose {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
}
.dcAgentWbClose:hover, .dcAgentWbClose:focus-visible { background: light-dark(#f6f8fb, #202733); }

.dcAgentStepper {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid light-dark(#e4e8f0, #303947);
  background: light-dark(#fbfcfe, #12171e);
}

.dcAgentStep {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 6px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 9px;
  background: transparent;
  color: light-dark(#697386, #aab5c7);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.dcAgentStep.is-active {
  color: light-dark(#1556cf, #8cb3ff);
  border-color: light-dark(#2869e6, #6d9eff);
  background: light-dark(#edf4ff, #172841);
}

.dcAgentWbBody {
  flex: 1 1 auto;
  overflow: auto;
  padding: 18px;
}

.dcAgentPane { display: flex; flex-direction: column; gap: 14px; }
.dcAgentHint { margin: 0; color: light-dark(#697386, #aab5c7); font-size: 13px; line-height: 1.6; }

.dcAgentTextarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 132px;
  padding: 12px;
  border: 1px solid light-dark(#cfd6e2, #485364);
  border-radius: 10px;
  background: light-dark(#ffffff, #191f28);
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  resize: vertical;
}

.dcAgentRow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dcAgentField {
  flex: 1 1 auto;
  box-sizing: border-box;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid light-dark(#cfd6e2, #485364);
  border-radius: 9px;
  font-size: 12px;
  background: light-dark(#ffffff, #191f28);
  color: inherit;
}

.dcAgentButton {
  padding: 9px 16px;
  border: 1px solid light-dark(#cfd6e2, #485364);
  border-radius: 9px;
  background: light-dark(#ffffff, #191f28);
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dcAgentButton:hover, .dcAgentButton:focus-visible { border-color: light-dark(#2869e6, #6d9eff); }
.dcAgentButton.is-primary {
  border-color: transparent;
  color: #ffffff;
  background: light-dark(#2869e6, #3d7bf0);
}
.dcAgentButton.is-primary:hover, .dcAgentButton.is-primary:focus-visible { background: light-dark(#1556cf, #6d9eff); }
.dcAgentButton:disabled { opacity: 0.5; cursor: not-allowed; }

.dcAgentGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.dcAgentCard {
  padding: 12px 14px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 11px;
  background: light-dark(#fbfcfe, #191f28);
}
.dcAgentCard span { display: block; color: light-dark(#697386, #aab5c7); font-size: 11px; }
.dcAgentCard b { display: block; margin-top: 3px; font-size: 18px; }
.dcAgentCard b.is-good { color: light-dark(#118a5b, #56d39b); }
.dcAgentCard b.is-warn { color: light-dark(#c17412, #f4b85d); }
.dcAgentCard b.is-bad { color: light-dark(#d2454f, #ff838b); }

.dcAgentTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.dcAgentTable th, .dcAgentTable td {
  padding: 7px 9px;
  text-align: left;
  border-bottom: 1px solid light-dark(#eef1f6, #242b36);
}
.dcAgentTable th { color: light-dark(#697386, #aab5c7); font-weight: 600; }
.dcAgentTable td.num { font-variant-numeric: tabular-nums; }

.dcAgentError {
  padding: 10px 12px;
  border: 1px solid light-dark(#ffd6d8, #5b2f33);
  border-radius: 9px;
  background: light-dark(#fff0f0, #351d21);
  color: light-dark(#d2454f, #ff838b);
  font-size: 12px;
}

.dcAgentChips { display: flex; flex-wrap: wrap; gap: 6px; }
.dcAgentChip {
  padding: 4px 10px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 999px;
  font-size: 11px;
  color: light-dark(#697386, #aab5c7);
}
.dcAgentChip.is-selected {
  color: light-dark(#1556cf, #8cb3ff);
  border-color: light-dark(#2869e6, #6d9eff);
  background: light-dark(#edf4ff, #172841);
}
.dcAgentCheck { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.dcAgentSection {
  padding: 14px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 11px;
  background: light-dark(#fbfcfe, #191f28);
}
.dcAgentSection h3 { margin: 0 0 8px; font-size: 13px; }
.dcAgentCandidate {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(120px, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid light-dark(#eef1f6, #242b36);
}
.dcAgentCandidate:last-child { border-bottom: 0; }
.dcAgentCandidate small { color: light-dark(#697386, #aab5c7); }
.dcAgentProgress { height: 8px; overflow: hidden; border-radius: 99px; background: light-dark(#e8edf5, #293240); }
.dcAgentProgress > span { display: block; height: 100%; background: #2869e6; }

/* M3 · overlay 头部 jobs 状态 pill（轮询 /mvp/jobs，不接计费遥测）。 */
.dcAgentJobsPill {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  color: light-dark(#697386, #aab5c7);
}
.dcAgentJobsPill[data-state='running'] {
  color: light-dark(#1556cf, #8cb3ff);
  border-color: light-dark(#2869e6, #6d9eff);
  background: light-dark(#edf4ff, #172841);
}
.dcAgentJobsPill[data-state='completed'] {
  color: light-dark(#118a5b, #56d39b);
  border-color: light-dark(#118a5b, #2f7d5e);
  background: light-dark(#eefaf3, #12261d);
}
.dcAgentJobsPill[data-state='failed'] {
  color: light-dark(#d2454f, #ff838b);
  border-color: light-dark(#d2454f, #7a3a40);
  background: light-dark(#fff0f0, #351d21);
}

/* M3 · tool.call.toolview 富化卡片（三工具摘要，替代裸 JSON）。 */
.dcAgentToolCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 11px;
  background: light-dark(#fbfcfe, #191f28);
  margin: 4px 0;
}
.dcAgentToolCardHead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dcAgentToolCardIcon { flex: 0 0 auto; font-size: 15px; }
.dcAgentToolCardTitle {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}
.dcAgentToolCardState {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: light-dark(#697386, #aab5c7);
  border: 1px solid light-dark(#e4e8f0, #303947);
}
.dcAgentToolCardState.is-ok { color: light-dark(#118a5b, #56d39b); }
.dcAgentToolCardState.is-error { color: light-dark(#d2454f, #ff838b); }
.dcAgentToolCardState.is-running { color: light-dark(#1556cf, #8cb3ff); }
.dcAgentToolCardState.is-stopped { color: light-dark(#697386, #aab5c7); }
.dcAgentToolCardBody {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
  color: light-dark(#33415a, #c9d4e5);
}
@media (max-width: 760px) {
  .dcAgentWorkbench, .dcAgentWorkbench.is-expanded { width: 100vw; border-radius: 0; }
  .dcAgentStepper { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dcAgentQccBadge { display: none; }
  .dcAgentCandidate { grid-template-columns: 1fr; }
}
`;

    /** 让 footer 多个入口纵向堆叠（与 mcp-connector 注入的列式 CSS 幂等并存）。 */
    function installSidebarStyles() {
      if (document.querySelector(`style[data-plugin="${FOOTER_STYLE_ID}"]`) !== null) return () => {};
      const style = document.createElement('style');
      style.dataset.plugin = FOOTER_STYLE_ID;
      style.textContent = stylesCss;
      document.head.append(style);
      return () => { style.remove(); };
    }

    // 会话级数据（不进 store，避免大快照膨胀）。原始行仅用于后端往返，不进模型上下文。
    let session = { rows: [], headers: [] };
    let lastCsv = { clean: null, complete: null, qcc: null, review: null };

    const STEPS = [
      { key: 'upload', label: '上传与映射', icon: '📄' },
      { key: 'profile', label: '数据体检', icon: '🩺' },
      { key: 'review', label: '匹配核验', icon: '🔎' },
      { key: 'enrich', label: '补全与导出', icon: '⬇️' },
    ];

    /** 后端往返：POST JSON，返回解析后的对象。 */
    async function api(path, body) {
      const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.json();
    }

    /** 工作台 store：入口按钮与工作台共享 open，另存四步流程 UI 状态。 */
    function createWorkbenchStore() {
      return defineStore({
        init: () => ({
          open: false,
          expanded: false,
          step: 'upload',
          busy: false,
          error: null,
          input: '',
          dataset: null,   // { fmt, headers, rowCount, preview }
          profile: null,   // summary
          clean: null,     // summary
          complete: null,  // summary
          nameField: 'name',
          selectedDomains: [],
          qccCapabilities: null,
          qccEstimate: null,
          qccRun: null,
          paidConfirmed: false,
          jobs: [],        // 后台任务列表（/mvp/jobs 轮询），仅用于状态 pill，不接计费遥测
        }),
        actions: {
          open: (draft) => { draft.open = true; },
          close: (draft) => { draft.open = false; },
          toggleExpanded: (draft) => { draft.expanded = !draft.expanded; },
          setStep: (draft, step) => { draft.step = step; },
          setBusy: (draft, busy) => { draft.busy = busy; },
          setError: (draft, error) => { draft.error = error; },
          setInput: (draft, input) => { draft.input = input; },
          setDataset: (draft, dataset) => { draft.dataset = dataset; draft.error = null; },
          setProfile: (draft, profile) => { draft.profile = profile; draft.error = null; },
          setClean: (draft, clean) => { draft.clean = clean; draft.error = null; },
          setComplete: (draft, complete) => { draft.complete = complete; draft.error = null; },
          setNameField: (draft, nameField) => { draft.nameField = nameField; draft.qccEstimate = null; },
          toggleDomain: (draft, domain) => {
            const selected = new Set(draft.selectedDomains);
            if (selected.has(domain)) selected.delete(domain); else selected.add(domain);
            draft.selectedDomains = [...selected];
            draft.qccEstimate = null;
            draft.paidConfirmed = false;
          },
          setQccCapabilities: (draft, value) => { draft.qccCapabilities = value; draft.error = null; },
          setQccEstimate: (draft, value) => { draft.qccEstimate = value; draft.error = null; draft.paidConfirmed = false; },
          setQccRun: (draft, value) => { draft.qccRun = value; draft.error = null; },
          setPaidConfirmed: (draft, value) => { draft.paidConfirmed = Boolean(value); },
          setJobs: (draft, jobs) => { draft.jobs = Array.isArray(jobs) ? jobs : []; },
        },
      });
    }

    /** 左栏入口按钮：使用 DSH Button，与 MCP连接器一致。 */
    function SidebarEntry(props) {
      const { wide, useStore, actions } = props;
      const open = useStore((state) => state.open);
      return react.createElement(Button, {
        variant: 'ghost',
        className: 'dcAgentLauncher',
        'data-wide': wide,
        'aria-label': '数据清洗',
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: () => {
          try {
            actions.open();
            startJobsPolling(actions);
          } catch (error) {
            console.error('[dc-agent] open failed:', error);
          }
        },
        children: wide ? '🧹 数据清洗' : '🧹',
      });
    }

    /** M3 · 三工具 tool.call.toolview 卡片元数据（wire 名 → 展示文案）。 */
    const TOOL_VIEW_META = {
      data_clean_rows: { icon: '🧹', label: '数据清洗', hint: '去重 · 剔除非法金额 · 缺失补 0' },
      data_complete_rows: { icon: '🧩', label: '数据补全', hint: '名称 / 金额 / 手机号归一' },
      data_profile: { icon: '🩺', label: '数据体检', hint: '缺失率 · 去重值 · 金额分布' },
    };
    const TOOL_VIEW_STATE = { running: '运行中', stopped: '已停止', error: '失败', ok: '完成' };

    /** 从 settled 结果节点的 text 块提取可读摘要（对齐 tool 包 resultText 的降级口径）。 */
    function flattenResultText(block) {
      if (!block || typeof block !== 'object') return '';
      const parts = [];
      for (const b of (Array.isArray(block.content) ? block.content : [])) {
        if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
      const text = parts.join('');
      if (text) return text;
      if (block.error && block.error.name) return `${block.error.name}: ${block.error.code ?? ''}`;
      return '';
    }

    /** tool.call.toolview 富化卡片：把三工具摘要渲染为可读卡片，替代裸 JSON。 */
    function DataToolCard(props) {
      const { toolName, block } = props;
      const meta = TOOL_VIEW_META[toolName] ?? { icon: '🧹', label: toolName, hint: '' };
      const done = block !== null && typeof block === 'object' && 'kind' in block;
      let state = 'running';
      if (done) {
        state = block.error?.code === 'interrupted' ? 'stopped' : (block.isError ? 'error' : 'ok');
      }
      const summary = done ? flattenResultText(block) : '';
      return h('div', { className: 'dcAgentToolCard', 'data-tool': toolName, 'data-state': state },
        h('div', { className: 'dcAgentToolCardHead' },
          h('span', { className: 'dcAgentToolCardIcon', 'aria-hidden': 'true' }, meta.icon),
          h('span', { className: 'dcAgentToolCardTitle' }, meta.label),
          h('span', { className: `dcAgentToolCardState is-${state}` }, TOOL_VIEW_STATE[state] ?? state),
        ),
        meta.hint ? h('div', { className: 'dcAgentToolCardHint' }, meta.hint) : null,
        summary ? h('div', { className: 'dcAgentToolCardBody' }, summary) : null,
      );
    }

    /** jobs 状态 pill：由 /mvp/jobs 列表派生（服务端按 createdAt 降序，取队首）。 */
    const JOB_STATE_LABEL = { queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', killed: '已终止' };
    function jobsPill(jobs) {
      const list = Array.isArray(jobs) ? jobs : [];
      if (!list.length) return { state: 'idle', label: '无后台任务' };
      const state = list[0] && list[0].state ? list[0].state : 'idle';
      return { state, label: JOB_STATE_LABEL[state] ?? state };
    }

    // jobs 轮询器（模块级单例）：打开工作台时启动，关闭即停；任何失败静默降级为「无后台任务」。
    let jobsTimer = null;
    async function pollJobsOnce(actions) {
      try {
        const r = await api('/data-cleaning/api/mvp/jobs');
        if (r && r.ok !== false) actions.setJobs(Array.isArray(r.jobs) ? r.jobs : []);
      } catch (error) {
        // 静默：jobs 不可用不影响工作台主流程。
      }
    }
    function startJobsPolling(actions) {
      if (jobsTimer !== null) return;
      pollJobsOnce(actions);
      jobsTimer = setInterval(() => pollJobsOnce(actions), 2000);
      if (jobsTimer && typeof jobsTimer.unref === 'function') jobsTimer.unref();
    }
    function stopJobsPolling() {
      if (jobsTimer !== null) { clearInterval(jobsTimer); jobsTimer = null; }
    }

    /** 上传 pane 的处理：文件 → 文本/base64 → parse。 */
    async function parseFile(file) {
      const isXlsx = /\.(xlsx|xls)$/i.test(file && file.name ? file.name : '');
      let content;
      if (isXlsx) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
        content = btoa(bin);
      } else {
        content = await file.text();
      }
      return api('/data-cleaning/api/mvp/parse', { filename: file.name, content });
    }

    /** 文本/JSON 直通 parse（与 web.js 内联页同构，含 JSON 数组直通）。 */
    async function parseText(text, actions) {
      const trimmed = (text ?? '').trim();
      if (!trimmed) {
        actions.setError('请粘贴或上传数据后再解析。');
        return;
      }
      if (trimmed.startsWith('[')) {
        try {
          const rows = JSON.parse(trimmed);
          session.rows = Array.isArray(rows) ? rows : [];
          session.headers = session.rows.length ? Object.keys(session.rows[0]) : [];
          actions.setDataset({
            fmt: 'json',
            headers: session.headers,
            rowCount: session.rows.length,
            preview: session.rows.slice(0, 5),
          });
          actions.setStep('profile');
        } catch (error) {
          actions.setError(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      return api('/data-cleaning/api/mvp/parse', { filename: 'data.csv', content: trimmed });
    }

    /** 解析成功落库 + 前进到「数据体检」。 */
    function applyParsed(result, actions) {
      session.rows = Array.isArray(result.rows) ? result.rows : [];
      session.headers = Array.isArray(result.headers) ? result.headers : [];
      const guessedNameField = session.headers.find((name) => /^(name|company|company_name|企业名称|公司名称)$/i.test(name))
        ?? session.headers.find((name) => /企业|公司|名称|name/i.test(name))
        ?? session.headers[0]
        ?? 'name';
      actions.setNameField(guessedNameField);
      actions.setDataset({
        fmt: result.fmt ?? 'csv',
        headers: session.headers,
        rowCount: typeof result.rowCount === 'number' ? result.rowCount : session.rows.length,
        preview: Array.isArray(result.preview) ? result.preview : session.rows.slice(0, 5),
      });
      actions.setStep('profile');
    }

    /** 工作台主视图：header + stepper + 当前 pane。 */
    function WorkbenchOverlay(props) {
      const { useStore, actions } = props;
      const open = useStore((state) => state.open);
      if (!open) return null;

      const step = useStore((state) => state.step);
      const expanded = useStore((state) => state.expanded);
      const busy = useStore((state) => state.busy);
      const error = useStore((state) => state.error);
      const input = useStore((state) => state.input);
      const dataset = useStore((state) => state.dataset);
      const profile = useStore((state) => state.profile);
      const clean = useStore((state) => state.clean);
      const complete = useStore((state) => state.complete);
      const nameField = useStore((state) => state.nameField);
      const selectedDomains = useStore((state) => state.selectedDomains);
      const qccCapabilities = useStore((state) => state.qccCapabilities);
      const qccEstimate = useStore((state) => state.qccEstimate);
      const qccRun = useStore((state) => state.qccRun);
      const paidConfirmed = useStore((state) => state.paidConfirmed);
      const jobs = useStore((state) => state.jobs);

      const hasData = dataset !== null && dataset.rowCount > 0;

      const handleParse = async () => {
        if (busy) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const result = await parseText(input, actions);
          if (result) applyParsed(result, actions);
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const handleFile = async (event) => {
        const file = event.target && event.target.files && event.target.files[0];
        if (!file) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const result = await parseFile(file);
          if (result && result.ok !== false) applyParsed(result, actions);
          else actions.setError((result && (result.message || result.error)) || '解析失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const runProfile = async () => {
        if (busy || !session.rows.length) {
          if (!session.rows.length) actions.setError('请先上传并解析数据。');
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/mvp/profile', { rows: session.rows, headers: session.headers });
          if (r && r.ok !== false) {
            actions.setProfile(r.summary ?? r);
            actions.setStep('review');
          } else {
            actions.setError((r && (r.message || r.error)) || '体检失败');
          }
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const runClean = async () => {
        if (busy || !session.rows.length) {
          if (!session.rows.length) actions.setError('请先上传并解析数据。');
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/mvp/clean', { rows: session.rows, headers: session.headers });
          if (r && r.ok !== false) {
            actions.setClean(r.summary ?? r);
            lastCsv.clean = { csv: r.csv ?? '', name: r.downloadName ?? 'cleaned.csv' };
          } else {
            actions.setError((r && (r.message || r.error)) || '清洗失败');
          }
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const runComplete = async () => {
        if (busy || !session.rows.length) {
          if (!session.rows.length) actions.setError('请先上传并解析数据。');
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/mvp/complete', { rows: session.rows, headers: session.headers });
          if (r && r.ok !== false) {
            actions.setComplete(r.summary ?? r);
            lastCsv.complete = { csv: r.csv ?? '', name: r.downloadName ?? 'completed.csv' };
          } else {
            actions.setError((r && (r.message || r.error)) || '补全失败');
          }
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const loadQccCapabilities = async () => {
        if (busy) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/phase3/capabilities');
          if (r && r.ok !== false) actions.setQccCapabilities(r);
          else actions.setError((r && (r.message || r.error)) || '企查查能力检测失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const estimateQcc = async () => {
        if (busy || !selectedDomains.length) {
          if (!selectedDomains.length) actions.setError('请至少选择一个补全域。');
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/phase3/estimate', {
            rows: session.rows, nameField, domains: selectedDomains, maxCalls: 500,
          });
          if (r && r.ok !== false) actions.setQccEstimate(r.estimate);
          else actions.setError((r && (r.message || r.error)) || '调用估算失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const applyQccRun = (run) => {
        actions.setQccRun(run);
        session.rows = Array.isArray(run.rows) ? run.rows : session.rows;
        lastCsv.qcc = { csv: run.csv ?? '', name: run.downloadName ?? 'qcc-phase3-enriched.csv' };
        lastCsv.review = { csv: run.reviewCsv ?? '', name: run.reviewDownloadName ?? 'qcc-phase3-review.csv' };
        if (!Array.isArray(run.reviewQueue) || run.reviewQueue.length === 0) actions.setStep('enrich');
      };

      const runQcc = async () => {
        if (busy || !qccEstimate || !paidConfirmed || !qccEstimate.withinLimit) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const key = `phase3-ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const r = await api('/data-cleaning/api/phase3/enrich', {
            rows: session.rows,
            headers: session.headers,
            nameField,
            domains: selectedDomains,
            maxCalls: qccEstimate.maxCalls,
            concurrency: 2,
            confirmPaidCalls: true,
            idempotencyKey: key,
          });
          if (r && r.ok !== false) applyQccRun(r);
          else actions.setError((r && (r.message || r.error)) || '三域补全失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const resolveCandidate = async (item, candidate) => {
        if (busy || !paidConfirmed || !qccRun) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/phase3/resolve', {
            runId: qccRun.runId,
            companyName: item.companyName,
            selectedCreditNo: candidate.creditNo,
            confirmPaidCalls: true,
            idempotencyKey: `phase3-resolve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          });
          if (r && r.ok !== false) applyQccRun(r);
          else actions.setError((r && (r.message || r.error)) || '候选确认失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const retryFailures = async () => {
        if (busy || !paidConfirmed || !qccRun) return;
        const names = [...new Set((qccRun.errors || []).filter((item) => item.error && item.error.retryable).map((item) => item.companyName))];
        if (!names.length) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/phase3/retry', {
            runId: qccRun.runId,
            companyNames: names,
            confirmPaidCalls: true,
            idempotencyKey: `phase3-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          });
          if (r && r.ok !== false) applyQccRun(r);
          else actions.setError((r && (r.message || r.error)) || '失败项重试失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const download = (slot) => {
        const item = lastCsv[slot];
        if (!item || !item.csv) return;
        const blob = new Blob([item.csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = item.name;
        a.click();
        URL.revokeObjectURL(a.href);
      };

      const stat = (label, value, tone) => h('div', { className: 'dcAgentCard' },
        h('span', null, label),
        h('b', { className: tone ? `is-${tone}` : null }, value)
      );

      let pane;
      if (step === 'profile') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '基于已解析数据生成本地质量画像（缺失率、去重值、金额分布）。本步骤不发起企查查调用。'),
          profile ? h('div', null,
            h('div', { className: 'dcAgentGrid' },
              stat('行数', profile.rowCount ?? '—'),
              stat('列数', profile.columnCount ?? '—'),
              profile.amountStats ? stat('金额 最小', profile.amountStats.min) : null,
              profile.amountStats ? stat('金额 最大', profile.amountStats.max) : null,
              profile.amountStats ? stat('金额 总和', profile.amountStats.sum) : null,
              profile.amountStats ? stat('金额 均值', typeof profile.amountStats.mean === 'number' ? profile.amountStats.mean.toFixed(2) : profile.amountStats.mean) : null,
            ),
            Array.isArray(profile.columns) && profile.columns.length ? h('table', { className: 'dcAgentTable' },
              h('thead', null, h('tr', null,
                h('th', null, '字段'),
                h('th', null, '非空'),
                h('th', null, '缺失'),
                h('th', null, '去重值'),
              )),
              h('tbody', null, profile.columns.map((col) => h('tr', { key: col.name },
                h('td', null, col.name),
                h('td', { className: 'num' }, String(col.present)),
                h('td', { className: 'num' }, String(col.missing)),
                h('td', { className: 'num' }, String(col.distinct)),
              ))),
            ) : null,
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy, onClick: () => actions.setStep('review') }, '下一步：匹配核验'),
            ),
          ) : h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !hasData, 'aria-label': '生成体检报告', onClick: runProfile }, busy ? '体检中…' : '生成体检报告'),
          ),
        );
      } else if (step === 'review') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '先执行本地确定性清洗，再按真实 ToolRuntime 状态进行主体匹配。多候选始终由人工选择；界面不生成虚构置信度。'),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '本地清洗预处理'),
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy, 'aria-label': '执行清洗', onClick: runClean }, busy ? '处理中…' : '执行清洗'),
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy, 'aria-label': '执行补全', onClick: runComplete }, busy ? '处理中…' : '本地规则补全'),
            ),
            clean ? h('div', { className: 'dcAgentGrid' },
              stat('总数', clean.total), stat('保留', clean.kept, 'good'), stat('剔除', clean.dropped, 'bad'),
              stat('缺失关键字段', clean.badMissing, clean.badMissing > 0 ? 'bad' : null),
              stat('非法金额', clean.badAmount, clean.badAmount > 0 ? 'warn' : null),
              stat('重复', clean.badDuplicate, clean.badDuplicate > 0 ? 'warn' : null),
            ) : null,
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '企查查三域能力与调用范围'),
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy, onClick: loadQccCapabilities }, busy ? '检测中…' : '检测企查查连接'),
              qccCapabilities ? h('span', { className: 'dcAgentHint' }, qccCapabilities.capabilities?.ready ? '91 个三域工具已就绪' : `${qccCapabilities.capabilities?.totalRegistered ?? 0}/${qccCapabilities.capabilities?.total ?? 91} 工具可用`) : null,
            ),
            h('div', { className: 'dcAgentChips' },
              [['risk', '风险信息 · 38'], ['ipr', '知识产权 · 18'], ['operation', '经营信息 · 35']].map(([domain, label]) => h('label', {
                key: domain,
                className: `dcAgentChip${selectedDomains.includes(domain) ? ' is-selected' : ''}`,
              },
                h('input', { type: 'checkbox', checked: selectedDomains.includes(domain), 'aria-label': label, onChange: () => actions.toggleDomain(domain) }),
                ` ${label}`,
              )),
            ),
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !selectedDomains.length, onClick: estimateQcc }, '估算调用量'),
            ),
            qccEstimate ? h('div', null,
              h('div', { className: 'dcAgentGrid' },
                stat('唯一企业', qccEstimate.uniqueCompanies),
                stat('所选工具', qccEstimate.tools.length),
                stat('调用上界', qccEstimate.estimatedCalls, qccEstimate.withinLimit ? 'good' : 'bad'),
                stat('调用上限', qccEstimate.maxCalls),
              ),
              h('label', { className: 'dcAgentCheck' },
                h('input', { type: 'checkbox', checked: paidConfirmed, 'aria-label': '确认企查查付费调用', onChange: (event) => actions.setPaidConfirmed(event.target.checked) }),
                '我已核对企业数量、所选域及调用上界，并确认发起可能计费的企查查调用',
              ),
              h('div', { className: 'dcAgentRow' },
                h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !paidConfirmed || !qccEstimate.withinLimit, onClick: runQcc }, busy ? '执行中…' : '开始匹配与补全'),
              ),
            ) : null,
          ),
          qccRun ? h('section', { className: 'dcAgentSection' },
            h('h3', null, `任务 ${qccRun.runId} · ${qccRun.state}`),
            h('div', { className: 'dcAgentGrid' },
              stat('已补全', qccRun.summary?.enriched ?? 0, 'good'),
              stat('部分成功', qccRun.summary?.partial ?? 0, (qccRun.summary?.partial ?? 0) > 0 ? 'warn' : null),
              stat('待核验', qccRun.summary?.ambiguous ?? 0, (qccRun.summary?.ambiguous ?? 0) > 0 ? 'warn' : null),
              stat('失败', qccRun.summary?.failed ?? 0, (qccRun.summary?.failed ?? 0) > 0 ? 'bad' : null),
              stat('实际调用', qccRun.summary?.actualCalls ?? 0),
            ),
            (qccRun.reviewQueue || []).map((item) => h('div', { key: item.companyName, className: 'dcAgentSection' },
              h('h3', null, `待核验：${item.companyName}`),
              item.candidates.map((candidate) => h('div', { key: candidate.creditNo, className: 'dcAgentCandidate' },
                h('div', null, h('b', null, candidate.companyName || '未命名候选'), h('small', null, candidate.creditNo)),
                h('small', null, `${candidate.status || '状态未知'} · ${(candidate.legalRep || []).join('、') || '法人未知'}`),
                h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !paidConfirmed, onClick: () => resolveCandidate(item, candidate) }, '确认此主体'),
              )),
            )),
            (qccRun.errors || []).some((item) => item.error?.retryable) ? h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !paidConfirmed, onClick: retryFailures }, '重试可恢复失败项') : null,
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton is-primary', onClick: () => actions.setStep('enrich') }, '进入补全与导出'),
            ),
          ) : h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton', onClick: () => actions.setStep('enrich') }, '仅使用本地结果并导出'),
          ),
        );
      } else if (step === 'enrich') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '导出本地清洗结果、企查查三域补全结果和待核验清单。每个三域值均保留 sourceTool 与上游原值。'),
          h('div', { className: 'dcAgentGrid' },
            stat('输入行数', dataset ? dataset.rowCount : '—'),
            stat('清洗保留', clean ? clean.kept : '—', clean && clean.kept > 0 ? 'good' : null),
            stat('本地补全', complete ? complete.completed : '—', complete && complete.completed > 0 ? 'good' : null),
            stat('QCC 已补全', qccRun ? qccRun.summary?.enriched ?? 0 : '—', qccRun && qccRun.summary?.enriched > 0 ? 'good' : null),
            stat('待核验', qccRun ? qccRun.summary?.ambiguous ?? 0 : '—', qccRun && qccRun.summary?.ambiguous > 0 ? 'warn' : null),
          ),
          h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton', disabled: !lastCsv.clean, 'aria-label': '下载清洗结果', onClick: () => download('clean') }, '下载清洗结果 CSV'),
            h('button', { type: 'button', className: 'dcAgentButton', disabled: !lastCsv.complete, 'aria-label': '下载补全结果', onClick: () => download('complete') }, '下载补全结果 CSV'),
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: !lastCsv.qcc, 'aria-label': '下载 QCC 补全结果', onClick: () => download('qcc') }, '下载 QCC 补全结果 CSV'),
            h('button', { type: 'button', className: 'dcAgentButton', disabled: !lastCsv.review, 'aria-label': '下载待核验清单', onClick: () => download('review') }, '下载待核验清单 CSV'),
          ),
        );
      } else {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '上传 CSV / XLSX / XLS / JSON，或粘贴数据。原始明细仅在本机 Host 与同源工作台处理，不进入模型上下文。'),
          h('input', {
            type: 'file',
            accept: '.csv,.json,.xlsx,.xls',
            className: 'dcAgentField',
            'aria-label': '选择数据文件',
            onChange: handleFile,
          }),
          h('textarea', {
            className: 'dcAgentTextarea',
            placeholder: '粘贴 CSV 文本，或 JSON 数组（例如 [{"name":"某公司","amount":"100"}]）…',
            'aria-label': '粘贴数据',
            value: input,
            onInput: (event) => actions.setInput(event.target.value),
          }),
          dataset ? h('div', { className: 'dcAgentChips' },
            h('span', { className: 'dcAgentChip' }, `格式 ${dataset.fmt}`),
            h('span', { className: 'dcAgentChip' }, `${dataset.rowCount} 行`),
            (dataset.headers || []).slice(0, 12).map((name) => h('span', { key: name, className: 'dcAgentChip' }, name)),
            (dataset.headers || []).length > 12 ? h('span', { className: 'dcAgentChip' }, `+${dataset.headers.length - 12} 列`) : null,
          ) : null,
          dataset ? h('label', { className: 'dcAgentRow' },
            h('span', { className: 'dcAgentHint' }, '企业名称字段'),
            h('select', { className: 'dcAgentField', value: nameField, 'aria-label': '企业名称字段映射', onChange: (event) => actions.setNameField(event.target.value) },
              (dataset.headers || []).map((name) => h('option', { key: name, value: name }, name)),
            ),
          ) : null,
          h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy, 'aria-label': '解析数据', onClick: handleParse }, busy ? '解析中…' : '解析数据'),
            hasData ? h('button', { type: 'button', className: 'dcAgentButton', onClick: () => actions.setStep('profile') }, '继续到数据体检') : null,
          ),
        );
      }

      return h('div', {
        className: 'dcAgentOverlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '数据清洗',
        onClick: (event) => {
          if (event.target === event.currentTarget) actions.close();
        },
      },
        h('div', { className: `dcAgentWorkbench${expanded ? ' is-expanded' : ''}` },
          h('header', { className: 'dcAgentWbHeader' },
            h('div', { className: 'dcAgentWbTitle' },
              h('span', { className: 'dcAgentWbIcon', 'aria-hidden': 'true' }, '🧹'),
              h('div', null,
                h('b', null, '数据清洗补全'),
                h('small', null, '本地确定性清洗 · 企查查三域 Host Bridge'),
              ),
            ),
            h('span', {
              className: 'dcAgentQccBadge',
              title: qccRun ? `任务 ${qccRun.runId}` : '仅在明确确认后发起计费调用',
            }, qccRun ? `QCC · ${qccRun.state}` : qccCapabilities ? (qccCapabilities.capabilities?.ready ? 'QCC · 已连接' : 'QCC · 能力不完整') : 'QCC · 待检测'),
            h('span', { className: 'dcAgentJobsPill', 'data-state': jobsPill(jobs).state, title: '后台任务状态' }, jobsPill(jobs).label),
            h('button', {
              className: 'dcAgentWbClose',
              type: 'button',
              'aria-label': expanded ? '收起工作台' : '展开工作台',
              onClick: () => actions.toggleExpanded(),
            }, expanded ? '↘' : '↖'),
            h('button', {
              className: 'dcAgentWbClose',
              type: 'button',
              'aria-label': '关闭',
              onClick: () => {
                stopJobsPolling();
                actions.close();
              },
            }, '✕'),
          ),
          h('nav', { className: 'dcAgentStepper', 'aria-label': '清洗流程' },
            STEPS.map((st) => h('button', {
              key: st.key,
              type: 'button',
              className: `dcAgentStep${step === st.key ? ' is-active' : ''}`,
              'aria-label': st.label,
              'aria-current': step === st.key ? 'step' : undefined,
              onClick: () => actions.setStep(st.key),
            }, `${st.icon} ${st.label}`)),
          ),
          h('div', { className: 'dcAgentWbBody' },
            error ? h('div', { className: 'dcAgentError', role: 'alert' }, error) : null,
            pane,
          ),
        ),
      );
    }

    function apply(ctx) {
      // eslint-disable-next-line no-console
      console.log('[dc-agent] client apply() ran');
      const state = { applied: true, entry: 'sidebar.footer.action', overlay: 'shell.overlay', error: null };
      window.__DC_MVP__ = state;
      try {
        const workbenchStore = createWorkbenchStore();
        ctx.effect(() => installSidebarStyles(), 'data-cleaning-agent: sidebar styles');

        // 工作台：注册到 shell.overlay（与 mcp-connector 同源）。
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'data-cleaning-agent',
          order: 200,
          store: workbenchStore,
        }, WorkbenchOverlay));

        // 左栏：注册到 sidebar.footer.action，order 10 → 排在 MCP连接器（order 0）下方。
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'data-cleaning-agent',
          order: 10,
          store: workbenchStore,
        }, SidebarEntry));

        // M3：三个工具的 tool.call.toolview 富化卡片（keyed by wire name，替代裸 JSON 摘要）。
        // 说明：分三条独立 inject（而非 generator）——测试 shim 对 inject 回调仅执行一次并 push 其返回值。
        const toolviewKeys = ['data_clean_rows', 'data_complete_rows', 'data_profile'];
        for (const key of toolviewKeys) {
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
            name: 'tool.call.toolview',
            key,
            locale: 'conversation',
          }, DataToolCard));
        }

        console.log('[dc-agent] client apply() completed');
      } catch (error) {
        state.applied = false;
        state.error = error instanceof Error ? error.message : String(error);
        console.error('[dc-agent] client apply() failed:', error);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

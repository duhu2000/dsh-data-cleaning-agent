/**
 * M1 · client 半区入口契约测试。
 *
 * 浏览器 provider 在本环境不可用（与 spike2 相同），故用 Node shim 忠实复刻
 * web shell 的静态模块表，验证 `lib/client.js` 的 factory 物化、服务注入与
 * 槽位注册全部正确——这正是 M1 在真实浏览器里渲染「🧹 数据清洗补全」入口、
 * 原生会话业务首页、提示词生成器、能力按钮与右侧工作台的
 * 前置等价物。断言只依赖 DSH 公开契约（`__ModuleLoader__.load`、`require`
 * 表、`ctx.slots.inject/register`、`defineStore`），不依赖构建产物。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

/**
 * 最小 defineStore，忠实复刻 dsh-client-runtime 的 `{ spec, create }` 契约：
 * create() 返回 { actions, getSnapshot, subscribe, store }；actions 以可变
 * draft 调用声明并触发订阅。
 */
function defineStore(decl) {
  return {
    spec: decl,
    create() {
      let state = decl.init();
      const listeners = new Set();
      const actions = {};
      for (const [key, fn] of Object.entries(decl.actions ?? {})) {
        actions[key] = (...params) => {
          const draft = { ...state };
          fn(draft, ...params);
          state = draft;
          for (const listener of listeners) listener(state);
        };
      }
      return {
        actions,
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        store: state,
        clearPersisted: () => {},
      };
    },
  };
}

/** 最小 document shim：仅满足 installSidebarStyles 的 querySelector/createElement/append。 */
function makeDocument() {
  const head = { append() {} };
  const listeners = new Map();
  const createElement = () => ({
    dataset: {},
    textContent: '',
    remove() {},
    setAttribute() {},
    append() {},
  });
  return {
    head,
    createElement,
    createEvent: () => ({
      defaultPrevented: false,
      initCustomEvent(type, _bubbles, cancelable, detail) {
        this.type = type;
        this.cancelable = cancelable;
        this.detail = detail;
      },
      preventDefault() {
        if (this.cancelable) this.defaultPrevented = true;
      },
    }),
    addEventListener: (type, listener) => {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener: (type, listener) => { listeners.get(type)?.delete(listener); },
    dispatchEvent: (event) => {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return !event.defaultPrevented;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

/** 渲染 shim：组件是函数组件（返回 React 元素），用 useStore 读 store 快照。 */
function render(component, props, storeInstance) {
  const useStore = (selector) => selector(storeInstance.getSnapshot());
  return component({ ...props, useStore, actions: storeInstance.actions });
}

/** 把一个 createElement 元素树拍平成 {type, props, children[]} 以利断言。 */
function flattenElement(el) {
  if (el === null || el === undefined) return el;
  const props = el.props ?? {};
  // createElement(type, props, ...children)：rest 参数有值时用 rest，否则退回 props.children。
  const rest = el.children;
  let children;
  if (Array.isArray(rest) && rest.length > 0) {
    children = rest;
  } else if (props.children !== undefined) {
    children = Array.isArray(props.children) ? props.children : [props.children];
  } else {
    children = [];
  }
  return { type: el.type, props, children };
}

/** 测试专用：展开由 createElement 产生的嵌套函数组件，不改变生产 React 调用语义。 */
function expandElementTree(el) {
  if (el === null || el === undefined) return el;
  if (typeof el !== 'object') return el;
  if (Array.isArray(el)) return el.map(expandElementTree);
  if (typeof el.type === 'function') return expandElementTree(el.type(el.props ?? {}));
  const flat = flattenElement(el);
  flat.children = (flat.children ?? []).map(expandElementTree);
  return flat;
}

/** 深度优先查找首个满足 predicate 的节点（处理 createElement 中 .map 产生的嵌套数组）。 */
function findNode(node, predicate) {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNode(item, predicate);
      if (found) return found;
    }
    return null;
  }
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

/** 收集所有匹配 predicate 的节点（处理嵌套数组）。 */
function collectNodes(node, predicate, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectNodes(item, predicate, out);
    return;
  }
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) collectNodes(child, predicate, out);
}

/**
 * 在 window/document shim 下加载 client bundle，返回 { requireShim, exports }。
 * 调用方需在 window shim 存续期间调用 factory/apply（bundle 顶层引用 window/document）。
 */
function loadClient() {
  let registration = null;
  const listeners = new Map();
  const windowShim = {
    __ModuleLoader__: { load: (reg) => { registration = reg; } },
    location: { origin: 'http://127.0.0.1:43140' },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    addEventListener: (type, listener) => {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener: (type, listener) => { listeners.get(type)?.delete(listener); },
    dispatchEvent: (event) => {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
  globalThis.window = windowShim;
  globalThis.document = makeDocument();

  const requireTable = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props, jsx: true }) },
    react: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (initial) => [initial, () => {}],
      useEffect: (effect) => effect(),
    },
    'react-dom': { createPortal: () => { throw new Error('unused'); } },
    '@deepseek-ai/dsh-client-ui-primitives': { Button: 'Button' },
    '@deepseek-ai/dsh-client-runtime/client': { defineStore },
  };
  const calls = { storeRequire: 0 };
  const requireShim = (id) => {
    if (id === '@deepseek-ai/dsh-client-store') {
      calls.storeRequire += 1;
      const err = new Error(`Cannot find module '${id}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    if (!(id in requireTable)) throw new Error(`unexpected require: ${id}`);
    return requireTable[id];
  };

  new Function(source)();
  if (!registration) throw new Error('bundle 未通过 window.__ModuleLoader__.load 注册');
  const exports = registration.factory(requireShim);
  return { registration, requireShim, calls, exports };
}

function cleanupGlobals() {
  delete globalThis.window;
  delete globalThis.document;
}

test('client bundle 注册 id 正确且服务注入与 mcp-connector 对齐', () => {
  let loaded;
  try {
    loaded = loadClient();
  } finally {
    cleanupGlobals();
  }
  const { registration, calls, exports } = loaded;
  assert.equal(registration.id, 'dsh-data-cleaning-agent');
  assert.deepEqual(
    exports.inject,
    ['slots', 'sessions', 'workspaces', 'conversation'],
    'inject 服务与 mcp-connector 对齐'
  );
  assert.equal(calls.storeRequire, 1, '必须尝试首选 @deepseek-ai/dsh-client-store（再回退 runtime/client）');
  assert.equal(typeof exports.apply, 'function');
});

test('apply() 注册顶部入口、composer 下方能力、提示词生成器、会话头入口与右侧工作台', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;

    const slots = new Map(); // name -> [{options, component}]
    const ctx = {
      effect: (fn) => { fn(); return () => {}; },
      slots: {
        inject: (name, cb) => {
          const list = slots.get(name) ?? [];
          list.push(cb());
          slots.set(name, list);
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };

    exports.apply(ctx);

    assert.ok(slots.has('shell.overlay'), '必须注入 shell.overlay');
    assert.ok(slots.has('sidebar.footer.action'), '必须注入 sidebar.footer.action');
    assert.ok(slots.has('conversation.input.dock'), '必须注入原生 composer 独立 dock');
    assert.ok(slots.has('conversation.input.overlay'), '必须注入提示词生成浮层');
    assert.equal(slots.has('conversation.input.left'), false, '能力按钮不得再放在输入框内部工具行');
    assert.ok(slots.has('conversation.session.header.actions'), '必须注入原生会话头动作');
    assert.ok(slots.has('tool.call.toolview'), '必须注入 tool.call.toolview（M3 三工具富化卡片）');

    const toolviews = slots.get('tool.call.toolview');
    assert.equal(toolviews.length, 3, 'tool.call.toolview 必须注册 3 个 keyed 入口');
    assert.deepEqual(
      toolviews.map((r) => r.options.key).sort(),
      ['data_clean_rows', 'data_complete_rows', 'data_profile'].sort(),
      '三个工具 wire 名逐一 keyed'
    );
    for (const r of toolviews) {
      assert.equal(r.options.name, 'tool.call.toolview');
      assert.equal(r.options.locale, 'conversation', 'locale 必须为 conversation 命名空间');
      assert.equal(typeof r.component, 'function');
    }

    const overlay = slots.get('shell.overlay')[0];
    assert.equal(overlay.options.name, 'shell.overlay');
    assert.equal(overlay.options.id, 'data-cleaning-agent');
    assert.equal(overlay.options.order, 200);

    const footer = slots.get('sidebar.footer.action')[0];
    assert.equal(footer.options.name, 'sidebar.footer.action');
    assert.equal(footer.options.id, 'data-cleaning-agent');
    assert.equal(footer.options.order, 10, 'footer 只作为 Portal 生命周期和降级入口');
    assert.equal(typeof footer.options.inject, 'function', '入口必须可启动 DSH 原生会话');

    const capabilities = slots.get('conversation.input.dock')[0];
    assert.equal(capabilities.options.id, 'data-cleaning-agent-capabilities');
    assert.equal(capabilities.options.order, 110);
    assert.equal(capabilities.options.store, undefined, 'session scope 不得复用 root scope 的 store handle');

    const prompt = slots.get('conversation.input.overlay')[0];
    assert.equal(prompt.options.id, 'data-cleaning-agent-prompt-generator');
    assert.equal(prompt.options.order, 110);
    assert.equal(typeof prompt.options.inject, 'function');

    const header = slots.get('conversation.session.header.actions')[0];
    assert.equal(header.options.id, 'data-cleaning-agent-workbench');
    assert.equal(header.options.order, 110);
    assert.equal(header.options.store, undefined, '会话头同样通过事件桥打开 root 工作台');

    assert.ok(footer.options.store && typeof footer.options.store.create === 'function', 'store 为 defineStore 句柄');
    assert.equal(typeof overlay.component, 'function');
    assert.equal(typeof footer.component, 'function');
  } finally {
    cleanupGlobals();
  }
});

test('入口按钮：wide 显示「🧹 数据清洗补全」，点击只启动中央业务会话', async () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;

    let footerReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => {
          if (name === 'sidebar.footer.action') footerReg = cb();
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    assert.ok(footerReg, 'footer 注册回调必须执行');

    const { options, component } = footerReg;
    const instance = options.store.create();

    let started = 0;
    const wideEl = flattenElement(render(component, {
      wide: true,
      startSession: async () => { started += 1; return 'session-cleaning-1'; },
    }, instance));
    assert.equal(wideEl.type, 'Button');
    assert.equal(wideEl.props['aria-label'], '数据清洗补全');
    assert.equal(wideEl.props['aria-haspopup'], undefined);
    assert.equal(wideEl.props['aria-expanded'], undefined);
    assert.deepEqual(wideEl.children, ['🧹 数据清洗补全']);

    await wideEl.props.onClick();
    assert.equal(instance.getSnapshot().open, false, '初始业务页不应强制展开右侧工作台');
    assert.equal(instance.getSnapshot().step, 'upload');
    assert.equal(instance.getSnapshot().activeSessionId, 'session-cleaning-1');
    assert.equal(started, 1);

    const narrowEl = flattenElement(render(component, { wide: false }, instance));
    assert.deepEqual(narrowEl.children, ['🧹']);
    assert.equal(narrowEl.props['aria-expanded'], undefined);
  } finally {
    cleanupGlobals();
  }
});

test('入口注入使用 DSH 工作区/会话/输入机打开中央原生会话并预填提示词', async () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let footerReg = null;
    const calls = { workspace: null, draft: null, opened: null };
    const ctx = {
      effect: () => () => {},
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: ['old'] }], recentWorkspaceId: 'ws-1' }) },
        connectWorkspace: async (workspaceId) => { calls.workspace = workspaceId; return 'session-cleaning-2'; },
      },
      sessions: {
        list: { getSnapshot: () => ({ current: 'old' }) },
        open: (sessionId) => { calls.opened = sessionId; },
      },
      get: (name) => name === 'conversation' ? {
        input: { shell: (sessionId) => ({ setDraft: (text) => { calls.draft = { sessionId, text }; } }) },
      } : undefined,
      slots: {
        inject: (name, cb) => { if (name === 'sidebar.footer.action') footerReg = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const { startSession } = footerReg.options.inject();
    const sessionId = await startSession();
    assert.equal(sessionId, 'session-cleaning-2');
    assert.equal(calls.workspace, 'ws-1');
    assert.equal(calls.opened, 'session-cleaning-2');
    assert.equal(calls.draft.sessionId, 'session-cleaning-2');
    assert.match(calls.draft.text, /提示词生成/);
  } finally {
    cleanupGlobals();
  }
});

test('alpha.2 兼容 Bridge 使用 uiWorkspace.connectWorkspace，不依赖纯 workspaces controller', async () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let footerReg = null;
    const calls = { workspace: null, fallbackCreates: 0, draft: null, opened: null };
    const conversation = {
      input: { shell: (sessionId) => ({ setDraft: (text) => { calls.draft = { sessionId, text }; } }) },
    };
    const uiWorkspace = {
      connectWorkspace: async (workspaceId) => {
        calls.workspace = workspaceId;
        return 'session-alpha-2';
      },
    };
    const ctx = {
      effect: () => () => {},
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-alpha', sessionIds: [] }] }) },
      },
      sessions: {
        list: { getSnapshot: () => ({ current: undefined }) },
        create: async () => { calls.fallbackCreates += 1; return 'unexpected'; },
        open: (sessionId) => { calls.opened = sessionId; },
      },
      get: (name) => ({ uiWorkspace, conversation })[name],
      slots: {
        inject: (name, cb) => { if (name === 'sidebar.footer.action') footerReg = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const sessionId = await footerReg.options.inject().startSession();
    assert.equal(sessionId, 'session-alpha-2');
    assert.equal(calls.workspace, 'ws-alpha');
    assert.equal(calls.fallbackCreates, 0);
    assert.equal(calls.opened, 'session-alpha-2');
    assert.equal(calls.draft.sessionId, 'session-alpha-2');
  } finally {
    cleanupGlobals();
  }
});

test('原生 composer 下方渲染五个 Mockup 能力按钮并定位右侧工作台步骤', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let capabilityReg = null;
    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => {
          if (name === 'conversation.input.dock') capabilityReg = cb();
          if (name === 'shell.overlay') overlayReg = cb();
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    exports.__testing.markCleaningSession('session-3');
    const instance = overlayReg.options.store.create();
    render(overlayReg.component, {}, instance); // 挂载 root scope 事件桥（关闭态返回 null）。
    let bar = expandElementTree(render(capabilityReg.component, {
      sessionId: 'session-3',
      session: { composerPhase: 'blank', openState: 'open' },
    }, instance));
    const buttons = [];
    collectNodes(bar, (n) => n.props && ['上传清洗', '质量体检', '匹配核验', '字段补全', '任务历史'].includes(n.props['aria-label']), buttons);
    assert.equal(buttons.length, 5);
    const review = buttons.find((button) => button.props['aria-label'] === '匹配核验');
    review.props.onClick();
    assert.equal(instance.getSnapshot().open, true);
    assert.equal(instance.getSnapshot().step, 'match');
    assert.equal(instance.getSnapshot().activeSessionId, 'session-3');
  } finally {
    cleanupGlobals();
  }
});

test('blank 清洗会话渲染业务首页，普通会话不注入业务内容', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let dockReg = null;
    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => {
          if (name === 'conversation.input.dock') dockReg = cb();
          if (name === 'shell.overlay') overlayReg = cb();
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const store = overlayReg.options.store.create();
    assert.equal(render(dockReg.component, {
      sessionId: 'ordinary-session',
      session: { composerPhase: 'blank', openState: 'open' },
    }, store), null, '普通会话不应出现业务首页');

    exports.__testing.markCleaningSession('cleaning-home');
    const home = expandElementTree(render(dockReg.component, {
      sessionId: 'cleaning-home',
      session: { composerPhase: 'blank', openState: 'open' },
    }, store));
    assert.ok(findNode(home, (n) => n.props?.['aria-label'] === '数据清洗补全产品介绍'));
    assert.ok(findNode(home, (n) => n.children?.includes('把企业名单变成可核验、可回写的标准数据')));
    assert.ok(findNode(home, (n) => n.props?.['aria-label'] === '数据清洗补全工作流'));
    for (const label of ['任务设置', '上传数据', '规则确认', '质量体检', '数据匹配', '清洗补全', '下载数据']) {
      assert.ok(findNode(home, (n) => n.children?.includes(label)), `中央业务首页缺少流程：${label}`);
    }
  } finally {
    cleanupGlobals();
  }
});

test('会话归属为单一显式激活态，点击新会话或其它智能体入口后可立即撤销', () => {
  let loaded;
  try {
    loaded = loadClient();
    const {
      clearCleaningDraft,
      deactivateCleaningSession,
      installSessionOwnershipBridge,
      isCleaningSession,
      isKnownCleaningDraft,
      markCleaningSession,
    } = loaded.exports.__testing;
    let draft = '请帮我清洗并补全企业名单。可点击输入框左上角「提示词生成」录入名单、上传 Excel 或图片，也可直接修改本段任务说明后开始。';
    const ctx = {
      get: (name) => name === 'conversation' ? {
        input: { shell: () => ({ snapshot: { draft }, setDraft: (value) => { draft = value; } }) },
      } : undefined,
    };
    const ownButton = {
      getAttribute: () => '数据清洗补全',
      textContent: '数据清洗补全',
      closest: (selector) => selector.startsWith('.dcAgentLauncher') ? ownButton : ownButton,
    };
    const genericButton = {
      getAttribute: () => '新建会话',
      textContent: '新建会话',
      closest: (selector) => selector.startsWith('.dcAgentLauncher') ? null : genericButton,
    };
    assert.equal(clearCleaningDraft(ctx, 'stale-session', true), true);
    assert.equal(draft, '', '升级后遗留的默认清洗文案必须清空');
    draft = '用户正在编辑的其它任务';
    assert.equal(clearCleaningDraft(ctx, 'ordinary-session', true), false);
    assert.equal(draft, '用户正在编辑的其它任务', '初始化不得清空用户自写草稿');
    const generatedDraft = '请执行一项企业名单数据清洗补全任务。 输入来源：手工录入。 企查查连接、套餐额度和费用均由当前用户自己的账号承担。 提供结果和待复核清单的导出。';
    assert.equal(isKnownCleaningDraft(generatedDraft), true);
    draft = generatedDraft;
    assert.equal(clearCleaningDraft(ctx, 'generated-session', true), true);
    assert.equal(draft, '', '刷新后必须清理插件向导生成的完整任务描述');
    const executionDraft = '请执行已在「数据清洗补全工作台」确认的企业数据任务。\n\n安全任务凭证：dcq-test\n\n请调用 data_cleaning_qcc_run。';
    assert.equal(isKnownCleaningDraft(executionDraft), true, '未发送的可编辑执行说明也属于插件草稿');
    assert.equal(isKnownCleaningDraft('用户要求清洗企业名单'), false, '普通用户文案不得被识别为插件草稿');
    const release = installSessionOwnershipBridge(ctx);

    assert.equal(isCleaningSession('ordinary-session'), false);
    markCleaningSession('cleaning-owned');
    draft = '清洗子系统草稿';
    assert.equal(isCleaningSession('cleaning-owned'), true);
    document.dispatchEvent({ type: 'click', target: ownButton });
    assert.equal(isCleaningSession('cleaning-owned'), true, '点击自身入口不得撤销清洗子系统');
    document.dispatchEvent({ type: 'click', target: genericButton });
    assert.equal(isCleaningSession('cleaning-owned'), false, '新会话必须恢复为无清洗内容的默认首页');
    assert.equal(draft, '', '退出子系统必须清空复用空白会话中的清洗草稿');

    markCleaningSession('cleaning-second');
    assert.equal(deactivateCleaningSession('another-session'), false);
    assert.equal(isCleaningSession('cleaning-second'), true);
    assert.equal(deactivateCleaningSession(), true);
    assert.equal(isCleaningSession('cleaning-second'), false);
    release();
  } finally {
    cleanupGlobals();
  }
});

test('会话归属 Bridge 在 DSH 异步恢复草稿后仅清理插件默认文案', () => {
  let loaded;
  const OriginalMutationObserver = globalThis.MutationObserver;
  let observerCallback = null;
  let disconnected = false;
  try {
    globalThis.MutationObserver = class MutationObserver {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    };
    loaded = loadClient();
    document.documentElement = {};
    const { installSessionOwnershipBridge } = loaded.exports.__testing;
    let draft = '';
    const ctx = {
      sessions: { list: { getSnapshot: () => ({ current: 'restored-session' }) } },
      get: (name) => name === 'conversation' ? {
        input: { shell: () => ({ snapshot: { draft }, setDraft: (value) => { draft = value; } }) },
      } : undefined,
    };
    const release = installSessionOwnershipBridge(ctx);
    draft = '请帮我清洗并补全企业名单。可点击输入框左上角「提示词生成」录入名单、上传 Excel 或图片，也可直接修改本段任务说明后开始。';
    observerCallback?.([]);
    assert.equal(draft, '', '异步恢复的默认清洗文案必须被清除');
    assert.equal(disconnected, true, '成功清理后应停止观察，避免常驻监听');
    release();
  } finally {
    if (OriginalMutationObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = OriginalMutationObserver;
    cleanupGlobals();
  }
});

test('提示词生成器注册在 input.overlay，且只对清洗会话显示触发器', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let promptReg = null;
    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => {
          if (name === 'conversation.input.overlay') promptReg = cb();
          if (name === 'shell.overlay') overlayReg = cb();
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const store = overlayReg.options.store.create();
    assert.equal(render(promptReg.component, { sessionId: 'ordinary', inputActions: {} }, store), null);
    exports.__testing.markCleaningSession('cleaning-prompt');
    const trigger = flattenElement(render(promptReg.component, {
      sessionId: 'cleaning-prompt',
      inputActions: { setDraft() {} },
    }, store));
    assert.ok(findNode(trigger, (n) => n.props?.['aria-label'] === '打开提示词生成'));
  } finally {
    cleanupGlobals();
  }
});

test('T4 提示词向导采用数据来源、匹配规则、清洗与补全、确认描述四步', () => {
  for (const label of ['数据来源', '匹配规则', '清洗与补全', '确认描述']) {
    assert.match(source, new RegExp(`'${label}'`));
  }
  assert.match(source, /WORKBENCH_DRAFT_EVENT/);
  assert.match(source, /requestWorkbenchDraft/);
  assert.match(source, /回填到对话框/);
  assert.match(source, /回填本身不会调用企查查 MCP/);
});

test('T3 自动字段映射、文本名单数据集与质量摘要均为确定性纯函数', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { entriesToDataset, guessMappings, plainEntityListDataset, qualitySummaryFor, resultFieldLabel } = loaded.exports.__testing;
    const parsed = entriesToDataset(['甲公司', '91320594088140947F']);
    assert.equal(parsed.rowCount, 2);
    assert.deepEqual(parsed.headers, ['主体标识']);
    assert.equal(parsed.rows[0].主体标识, '甲公司');
    assert.equal(parsed.rows[1].主体标识, '91320594088140947F');
    const pasted = plainEntityListDataset('深圳奥雅设计股份有限公司\n\n星际量子（北京）科技有限公司');
    assert.equal(pasted.rowCount, 2, '无表头的换行名单不得把第一家企业当成表头');
    assert.deepEqual(pasted.rows.map((row) => row.主体标识), ['深圳奥雅设计股份有限公司', '星际量子（北京）科技有限公司']);
    assert.equal(plainEntityListDataset('企业名称\n甲公司'), null, '显式表头仍应交给 CSV 解析器');
    assert.equal(resultFieldLabel('credit_no'), '统一社会信用代码');
    assert.equal(resultFieldLabel('qcc_match_status'), '匹配状态');
    const mappings = guessMappings(['企业名称', '统一社会信用代码', '联系电话']);
    assert.deepEqual(mappings.map((item) => item.targetField), ['company_name', 'credit_no', 'phone']);
    assert.deepEqual(qualitySummaryFor([
      { 企业名称: '甲公司', 统一社会信用代码: '91320594088140947F', 联系电话: '13800138000' },
      { 企业名称: '甲公司', 统一社会信用代码: 'BAD', 联系电话: 'BAD' },
      { 企业名称: '', 统一社会信用代码: '', 联系电话: '' },
    ], mappings), {
      total: 3, valid: 2, missingAnchor: 1, duplicates: 0,
      invalidCreditNo: 1, invalidPhone: 1, emptyFields: 3,
    });
  } finally {
    cleanupGlobals();
  }
});

test('仅本地清洗目标跳过企查查匹配页，统计卡拒绝渲染对象值', () => {
  assert.match(source, /const requiresQcc = objectives\.includes\('validate_identity'\) \|\| objectives\.includes\('complete_fields'\)/);
  assert.match(source, /requiresQcc \? '下一步：匹配核验' : '下一步：本地清洗补全'/);
  assert.match(source, /return '—';[\s\S]*?displayStatValue\(value\)/);
});

test('任务描述生成包含主体、清洗项、补全字段、消歧与客户自有 QCC 费用边界', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { buildTaskPrompt, extractPromptEntries } = loaded.exports.__testing;
    assert.deepEqual(extractPromptEntries({
      headers: ['公司名称', '统一社会信用代码'],
      rows: [{ 公司名称: '示例科技有限公司', 统一社会信用代码: '91320000TEST' }],
    }), ['示例科技有限公司 | 91320000TEST']);
    const prompt = buildTaskPrompt({
      mode: 'excel',
      fileName: '企业名单.xlsx',
      entries: ['示例科技有限公司 | 91320000TEST'],
      cleaningKeys: ['clean_name', 'deduplicate'],
      enrichmentKeys: ['credit_no', 'legal_rep', 'risk_summary'],
      anchorKeys: ['company_name', 'credit_no'],
    });
    assert.match(prompt, /企业名单\.xlsx/);
    assert.match(prompt, /示例科技有限公司/);
    assert.match(prompt, /名称补全与规范、重复企业去重/);
    assert.match(prompt, /统一社会信用代码、法定代表人、风险摘要/);
    assert.match(prompt, /存在多个候选必须暂停/);
    assert.match(prompt, /当前用户自己的账号承担/);
  } finally {
    cleanupGlobals();
  }
});

test('图片接入 Bridge 仅在能力存在时创建 draft image 并加入当前会话', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let promptReg = null;
    const calls = { files: null, ids: null };
    const conversation = {
      createDraftImages: (files) => {
        calls.files = files;
        return [{ id: 'draft-image-1' }];
      },
      releaseDraftImages: () => { throw new Error('success path must not release'); },
      input: { shell: () => ({ addImages: (ids) => { calls.ids = ids; return true; } }) },
    };
    const ctx = {
      effect: () => () => {},
      get: (name) => name === 'conversation' ? conversation : undefined,
      slots: {
        inject: (name, cb) => { if (name === 'conversation.input.overlay') promptReg = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const file = { name: '名单.png', type: 'image/png' };
    assert.equal(promptReg.options.inject().attachImages('cleaning-image', [file]), 1);
    assert.deepEqual(calls.files, [file]);
    assert.deepEqual(calls.ids, ['draft-image-1']);
  } finally {
    cleanupGlobals();
  }
});

test('提示词生成器解析出的完整表格通过事件桥进入 root 工作台且不自动拉开右栏', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => { if (name === 'shell.overlay') overlayReg = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const store = overlayReg.options.store.create();
    render(overlayReg.component, {}, store);
    const event = document.createEvent('CustomEvent');
    event.initCustomEvent('dsh:data-cleaning-workbench-dataset', false, true, {
      sessionId: 'cleaning-excel',
      result: {
        fmt: 'xlsx',
        headers: ['企业名称', '统一社会信用代码'],
        rowCount: 2,
        rows: [
          { 企业名称: '甲公司', 统一社会信用代码: 'A' },
          { 企业名称: '乙公司', 统一社会信用代码: 'B' },
        ],
      },
    });
    document.dispatchEvent(event);
    assert.equal(store.getSnapshot().dataset.rowCount, 2);
    assert.equal(store.getSnapshot().nameField, '企业名称');
    assert.equal(store.getSnapshot().activeSessionId, 'cleaning-excel');
    assert.equal(store.getSnapshot().open, false);
  } finally {
    cleanupGlobals();
  }
});

test('UI 位置契约：能力使用 input.dock 并只移动自身 cell，提示词使用官方 overlay', () => {
  assert.match(source, /ctx\.slots\.inject\('conversation\.input\.dock'/);
  assert.match(source, /ctx\.slots\.inject\('conversation\.input\.overlay'/);
  assert.doesNotMatch(source, /ctx\.slots\.inject\('conversation\.input\.left'/);
  assert.match(source, /\[data-slot="conversation\.input\.dock"\]:has\(\.dcAgentExperience\)/);
  assert.match(source, /\[data-composer-card\]:has\(\.dcAgentPromptTrigger\)/);
  assert.match(source, /rewriteHeroChrome/);
});

test('顶部入口实现只依赖 sidebar.workspaces data-slot Portal，并保留 footer 降级', () => {
  assert.match(source, /SIDEBAR_WORKSPACES_SELECTOR = '\[data-slot="sidebar\.workspaces"\]'/);
  assert.match(source, /reactDom\.createPortal/);
  assert.match(source, /if \(!topMount \|\| typeof reactDom\.createPortal !== 'function'\) return launcher/);
  assert.doesNotMatch(source, /\[data-slot="sidebar\.footer\.action"\]\s*\{[\s\S]*?display:\s*flex\s*!important/);
});

test('M3 toolview：DataToolCard 把三工具摘要渲染为可读卡片（状态 + 正文）', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;

    const slots = new Map();
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => {
          const list = slots.get(name) ?? [];
          list.push(cb());
          slots.set(name, list);
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);

    const byKey = new Map(slots.get('tool.call.toolview').map((r) => [r.options.key, r.component]));
    const Card = byKey.get('data_clean_rows');
    assert.ok(Card, '必须拿到 data_clean_rows 的 toolview 组件');

    const store = (() => {
      // 复用 overlay store：footer/overlay 共用一个 defineStore 句柄。
      const overlay = slots.get('shell.overlay')[0];
      return overlay.options.store;
    })();
    const instance = store.create();

    // settled ok：从 block.content 文本块提取摘要，替代裸 JSON。
    const okEl = flattenElement(render(Card, {
      toolName: 'data_clean_rows',
      block: {
        kind: 'tool-result',
        isError: false,
        content: [{ type: 'text', text: 'cleaned 10 rows: kept 8, dropped 2 (missing 1, bad-amount 1, duplicate 0)' }],
      },
    }, instance));
    assert.equal(okEl.type, 'div');
    assert.equal(okEl.props.className, 'dcAgentToolCard');
    assert.equal(okEl.props['data-state'], 'ok');
    const okTitle = findNode(okEl, (n) => n.props && n.props.className === 'dcAgentToolCardTitle');
    assert.equal(okTitle.children[0], '数据清洗');
    const okBody = findNode(okEl, (n) => n.props && n.props.className === 'dcAgentToolCardBody');
    assert.equal(okBody.children[0], 'cleaned 10 rows: kept 8, dropped 2 (missing 1, bad-amount 1, duplicate 0)');

    // error：摘要降级为 error.name: error.code。
    const errEl = flattenElement(render(Card, {
      toolName: 'data_complete_rows',
      block: { kind: 'tool-result', isError: true, error: { name: 'QccNotAvailable', code: 'QCC_OFF' }, content: [] },
    }, instance));
    assert.equal(errEl.props['data-state'], 'error');
    const errBody = findNode(errEl, (n) => n.props && n.props.className === 'dcAgentToolCardBody');
    assert.equal(errBody.children[0], 'QccNotAvailable: QCC_OFF');

    // running：未 settled（无 kind）→ 运行中。
    const runEl = flattenElement(render(Card, { toolName: 'data_profile', block: { argsRaw: {} } }, instance));
    assert.equal(runEl.props['data-state'], 'running');
  } finally {
    cleanupGlobals();
  }
});

test('M3 jobs pill：工作台 header 渲染后台任务状态位，jobs 列表驱动', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;

    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => {
          if (name === 'shell.overlay') overlayReg = cb();
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    assert.ok(overlayReg, 'overlay 注册回调必须执行');

    const instance = overlayReg.options.store.create();
    instance.actions.open();

    // 无任务：idle + 「无后台任务」。
    let panel = flattenElement(render(overlayReg.component, {}, instance));
    let pill = findNode(panel, (n) => n.props && n.props.className === 'dcAgentJobsPill');
    assert.ok(pill, 'header 必须渲染 jobs 状态 pill');
    assert.equal(pill.props['data-state'], 'idle');
    assert.equal(pill.children[0], '无后台任务');

    // 有运行中任务：running + 「运行中」。
    instance.actions.setJobs([{ id: 'task-1', state: 'running' }]);
    panel = flattenElement(render(overlayReg.component, {}, instance));
    pill = findNode(panel, (n) => n.props && n.props.className === 'dcAgentJobsPill');
    assert.equal(pill.props['data-state'], 'running');
    assert.equal(pill.children[0], '运行中');
  } finally {
    cleanupGlobals();
  }
});

test('工作台：关闭返回 null，打开渲染 v2 五步 stepper + QCC 安全状态，关闭按钮调用 actions.close', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;

    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => {
          if (name === 'shell.overlay') overlayReg = cb();
          return () => {};
        },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    assert.ok(overlayReg, 'overlay 注册回调必须执行');

    const { options, component } = overlayReg;
    const instance = options.store.create();

    assert.equal(render(component, {}, instance), null, '关闭状态不渲染');

    instance.actions.open();
    const panel = flattenElement(render(component, {}, instance));
    const drawer = findNode(panel, (n) => n.type === 'aside' && n.props && n.props.className.includes('dcAgentWorkbench'));
    assert.ok(drawer, '必须在 overlay 中渲染右侧 aside 工作台');
    assert.equal(drawer.props.role, 'dialog');
    assert.equal(drawer.props['aria-modal'], 'false', '桌面工作台为非模态，中央会话保持可操作');
    assert.equal(drawer.props['aria-label'], '数据清洗补全工作台');
    assert.match(source, /body:has\(\.dcAgentWorkbench\) \[data-conversation-scroll\]/, '桌面工作台打开时必须使用 DSH 稳定标记为中央会话让出空间');
    assert.match(source, /padding-right: min\(460px, 42vw\)/, '桌面让位宽度必须与工作台宽度保持一致');

    // 五步核心工作流；质量体检和历史是横向能力。
    const stepButtons = [];
    collectNodes(panel, (n) => n.props && n.props['aria-label'] && ['上传数据', '规则确认', '数据匹配', '清洗补全', '下载数据'].includes(n.props['aria-label']), stepButtons);
    assert.equal(stepButtons.length, 5, '必须渲染五步 stepper');

    // 未确认计费前只显示待检测，不触发调用。
    const qccBadge = findNode(panel, (n) => n.props && n.props.title === '仅在当前用户确认使用自己的企查查账号后调用');
    assert.ok(qccBadge, '必须显示 QCC 安全状态位');
    assert.equal(qccBadge.children[0], 'QCC · 待检测');

    const expandButton = findNode(panel, (n) => n.props && n.props['aria-label'] === '展开工作台');
    assert.ok(expandButton, '必须支持按 Mockup 展开工作台');
    expandButton.props.onClick();
    assert.equal(instance.getSnapshot().expanded, true);

    const closeButton = findNode(panel, (n) => n.props && n.props['aria-label'] === '关闭');
    assert.ok(closeButton, '必须有关闭按钮');
    closeButton.props.onClick();
    assert.equal(instance.getSnapshot().open, false);
  } finally {
    cleanupGlobals();
  }
});

test('工作台关闭态 guard 位于所有 store hooks 之后，避免 React #310', () => {
  const componentStart = source.indexOf('function WorkbenchDrawer(props)');
  const componentEnd = source.indexOf('function apply(ctx)', componentStart);
  const componentSource = source.slice(componentStart, componentEnd);
  const guardIndex = componentSource.indexOf('if (!open) return null;');
  const lastStoreHookIndex = componentSource.indexOf('const activeSessionId = useStore((state) => state.activeSessionId);');

  assert.ok(componentStart >= 0 && componentEnd > componentStart, '必须定位到 WorkbenchDrawer');
  assert.ok(lastStoreHookIndex >= 0, '必须定位到最后一个 store hook');
  assert.ok(guardIndex > lastStoreHookIndex, '关闭态 guard 必须在全部 store hooks 之后');
});

test('中央业务首页以独立 React 元素渲染，避免 hero 切换破坏 Hooks 顺序', () => {
  const componentStart = source.indexOf('function DataCleaningExperience(props)');
  const componentEnd = source.indexOf('function extractPromptEntries', componentStart);
  const componentSource = source.slice(componentStart, componentEnd);
  assert.match(componentSource, /hero \? h\(ProductHome, \{ sessionId \}\) : null/);
  assert.doesNotMatch(componentSource, /hero \? ProductHome\(/);
});

test('清洗 hero 在第三方全局标题与尽调 dock 存在时仍保持会话级隔离，并可逆恢复', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { rewriteHeroChrome } = loaded.exports.__testing;
    const headline = {
      dataset: {},
      textContent: '访前尽调智能体',
      style: { display: '' },
    };
    const foreignModes = { parentElement: null };
    const foreignDock = { parentElement: null, style: { display: '' } };
    const ownDock = { parentElement: null };
    const foreignPrompt = { parentElement: null, style: { display: '' } };
    const composerStack = {
      querySelectorAll: (selector) => selector === '[aria-label="尽调类型"], .qccDock'
        ? [foreignModes, foreignPrompt]
        : [],
    };
    foreignModes.parentElement = foreignDock;
    foreignDock.parentElement = composerStack;
    ownDock.parentElement = composerStack;
    foreignPrompt.parentElement = ownDock;
    const hero = {
      querySelectorAll: (selector) => selector === 'span' ? [headline] : [],
      querySelector: (selector) => selector === '[class*="headlineText"]' ? headline : null,
    };
    const marker = {
      dataset: { sessionId: 'cleaning-collision' },
      parentElement: ownDock,
      closest: (selector) => selector === '[data-phase="hero"]' ? hero : null,
    };
    globalThis.document = {
      querySelectorAll: (selector) => selector === '.dcAgentExperience' ? [marker] : [],
    };

    const restore = rewriteHeroChrome('cleaning-collision', true);
    assert.equal(headline.textContent, '数据清洗补全智能体');
    assert.equal(foreignDock.style.display, 'none');
    assert.equal(foreignPrompt.style.display, 'none');

    restore();
    assert.equal(headline.textContent, '访前尽调智能体');
    assert.equal(foreignDock.style.display, '');
    assert.equal(foreignPrompt.style.display, '');
  } finally {
    cleanupGlobals();
  }
});

test('同一会话并发创建只产生一个 Host taskId，后续写操作保持串行', async () => {
  let loaded;
  const previousFetch = globalThis.fetch;
  let createCalls = 0;
  try {
    globalThis.fetch = async () => {
      createCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        ok: true,
        status: 200,
        json: async () => ({ task: {
          id: 'dcw-race-safe', revision: 0, title: '竞态测试',
          objectives: [], fieldSelection: [], mappings: [],
        } }),
      };
    };
    loaded = loadClient();
    const { ensureWorkflowTask, queueWorkflowOperation } = loaded.exports.__testing;
    const actions = new Proxy({}, { get: () => () => {} });
    const tasks = await Promise.all([
      ensureWorkflowTask(actions, 'session-race', { title: '任务 A' }),
      ensureWorkflowTask(actions, 'session-race', { title: '任务 B' }),
    ]);
    assert.equal(createCalls, 1);
    assert.deepEqual(tasks.map((task) => task.id), ['dcw-race-safe', 'dcw-race-safe']);

    const order = [];
    await Promise.all([
      queueWorkflowOperation('session-queue', async () => {
        order.push('first:start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('first:end');
      }),
      queueWorkflowOperation('session-queue', async () => { order.push('second'); }),
    ]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  } finally {
    globalThis.fetch = previousFetch;
    cleanupGlobals();
  }
});

test('已完成任务再录入名单时自动创建新 taskId', async () => {
  let loaded;
  const previousFetch = globalThis.fetch;
  let createCalls = 0;
  try {
    globalThis.fetch = async () => {
      createCalls += 1;
      const sequence = createCalls;
      return {
        ok: true,
        status: 201,
        json: async () => ({ task: {
          id: `dcw-fresh-${sequence}`,
          revision: 0,
          state: sequence === 1 ? 'completed' : 'draft',
          title: `任务 ${sequence}`,
          objectives: [], fieldSelection: [], mappings: [],
        } }),
      };
    };
    loaded = loadClient();
    const { ensureEditableWorkflowTask, ensureWorkflowTask } = loaded.exports.__testing;
    const actions = new Proxy({}, { get: () => () => {} });
    const completed = await ensureWorkflowTask(actions, 'session-fresh');
    const editable = await ensureEditableWorkflowTask(actions, 'session-fresh', { title: '新任务' });
    assert.equal(completed.id, 'dcw-fresh-1');
    assert.equal(editable.id, 'dcw-fresh-2');
    assert.equal(editable.state, 'draft');
    assert.equal(createCalls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    cleanupGlobals();
  }
});

test('上传解析进入 taskId runtime，字段映射在规则确认页完成', () => {
  const applyParsedStart = source.indexOf('function applyParsed(result, actions, taskId');
  const applyParsedEnd = source.indexOf('/** 右侧非模态工作台', applyParsedStart);
  const applyParsedSource = source.slice(applyParsedStart, applyParsedEnd);
  assert.doesNotMatch(applyParsedSource, /setStep\('profile'\)/, '解析后必须留在上传映射页供用户确认字段');
  assert.match(applyParsedSource, /runtimeFor\(taskId\)/);
  assert.match(source, /actions\.setStep\('rules'\)/);
  assert.match(source, /required: nameField \? \[nameField\] : \[\]/);
  assert.match(source, /dedupeOn: nameField \|\| null/);
  assert.match(source, /options: localCleanOptions/);
  assert.match(source, /\/api\/workflow\/tasks\/\$\{encodeURIComponent\(latest\.id\)\}\/actions\/\$\{action\}/);
  assert.match(source, /workflowAction\(actions, activeSessionId, current, 'rules'/);
  assert.match(source, /current = await performProfile\(current\)/, '规则确认后必须直接生成质量体检并推进 Host 阶段');
  assert.match(source, /prepareEditableQccCommand/);
  assert.match(source, /setSessionDraft\(activeSessionId, command\.prompt\)/);
  assert.doesNotMatch(source, /const runQcc[\s\S]{0,900}workflowAction\(actions, activeSessionId, cachedTask, 'match-start'/);
  assert.doesNotMatch(source, /let session = \{ rows:/, '不得继续使用跨任务的模块级原始数据 session');
});

test('T3 匹配核验页使用基础企业 G5 Bridge、调用估算和用户自有 QCC 账号确认门', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => { if (name === 'shell.overlay') overlayReg = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const instance = overlayReg.options.store.create();
    instance.actions.open();
    instance.actions.setStep('match');
    let panel = flattenElement(render(overlayReg.component, {}, instance));

    assert.ok(findNode(panel, (n) => n.children && n.children.includes('企查查基础企业能力')));
    assert.ok(findNode(panel, (n) => n.children && n.children.includes('估算调用量')), '必须先估算调用量');

    instance.actions.setQccEstimate({ uniqueCompanies: 1, tools: ['a'], estimatedCalls: 2, maxCalls: 500, withinLimit: true });
    panel = flattenElement(render(overlayReg.component, {}, instance));
    const confirm = findNode(panel, (n) => n.props && n.props['aria-label'] === '确认使用当前用户的企查查账号额度');
    assert.ok(confirm, '估算后必须显示用户自有 QCC 账号确认复选框');
    assert.equal(confirm.props.checked, false);
    assert.match(source, /额度或费用由该账号自行承担/, '必须明确费用由当前用户连接的 QCC 账号承担');
    assert.match(source, /\/data-cleaning\/api\/g5\/commands/);
    assert.match(source, /sessionConversation\.send\(prompt\)/, '候选确认与显式重试仍必须通过 Agent-owned 工具');
    assert.match(source, /shell\.setDraft\(prompt\)/, '初次匹配必须先回填可编辑任务说明');
    assert.match(source, /生成可编辑任务说明/);
    assert.match(source, /data-cleaning\/api\/g5\/commands\/\$\{encodeURIComponent\(commandId\)\}/);
    assert.doesNotMatch(source, /const runQcc[\s\S]{0,1800}\/data-cleaning\/api\/g5\/enrich/, '工作台不得在 Code Mode 下直接调用动态 MCP');
    assert.doesNotMatch(source.slice(source.indexOf("step === 'match'"), source.indexOf("step === 'enrich'")), /风险信息 · 38/);
    assert.doesNotMatch(source, /确认企查查付费调用/, '不得使用可能暗示插件开发者代付的旧文案');
  } finally {
    cleanupGlobals();
  }
});

test('T8 下载页使用 Host 耐久 CSV/XLSX 制品并支持最近任务 taskId 恢复', () => {
  let loaded;
  try {
    loaded = loadClient();
    let overlayReg = null;
    const ctx = {
      effect: () => () => {},
      slots: {
        inject: (name, cb) => { if (name === 'shell.overlay') overlayReg = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    loaded.exports.apply(ctx);
    const instance = overlayReg.options.store.create();
    instance.actions.open();
    instance.actions.setStep('download');
    instance.actions.setWorkflowTask({
      id: 'dcw-test-artifacts', state: 'completed', stage: 'download', revision: 8,
      source: { rowCount: 2 },
      enrichmentSummary: { completed: 2, reviewRequired: 1 },
      matchSummary: { reviewRequired: 1 },
      artifacts: [
        { id: 'dca-test-xlsx', kind: 'complete', format: 'xlsx', fileName: '结果.xlsx', rowCount: 2 },
        { id: 'dca-test-review', kind: 'review', format: 'csv', fileName: '异常.csv', rowCount: 1 },
      ],
    });
    const panel = flattenElement(render(overlayReg.component, {}, instance));
    assert.ok(findNode(panel, (node) => node.props?.['aria-label'] === '下载 结果.xlsx'));
    assert.ok(findNode(panel, (node) => node.children?.includes('清洗补全结果 XLSX · 2 行')));
    assert.ok(findNode(panel, (node) => node.children?.includes('异常清单 CSV · 1 行')));
    const recoveredEnriched = findNode(panel, (node) => node.props?.className === 'dcAgentCard'
      && findNode(node, (child) => child.children?.includes('匹配补全')));
    const recoveredReview = findNode(panel, (node) => node.props?.className === 'dcAgentCard'
      && findNode(node, (child) => child.children?.includes('待核验')));
    assert.ok(findNode(recoveredEnriched, (node) => node.type === 'b' && node.children?.includes(2)), '重启恢复后应显示 Host 持久化补全计数');
    assert.ok(findNode(recoveredReview, (node) => node.type === 'b' && node.children?.includes(1)), '重启恢复后应显示 Host 持久化待核验计数');
    assert.match(source, /requestWorkbenchOpen\(task\.stage \|\| 'upload', sessionId, task\)/);
    assert.match(source, /detail\.task\?\.id/);
    assert.match(source, /\/artifacts\/\$\{encodeURIComponent\(artifact\.id\)\}/);
    assert.doesNotMatch(source, /browser-download:/, '不得继续登记不可恢复的浏览器伪制品引用');
  } finally {
    cleanupGlobals();
  }
});

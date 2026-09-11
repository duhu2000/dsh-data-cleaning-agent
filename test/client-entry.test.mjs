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
test('共享实控人字段在浏览器目录、别名推荐与原列回填中保持一致', async () => {
  try {
    const { ACTUAL_CONTROLLER_GROUP } = await import('qcc-field-contracts');
    const api = loadClient().exports.__testing;
    for (const f of ACTUAL_CONTROLLER_GROUP.fields) {
      for (const alias of [f.id,f.label,...f.aliases]) {
        assert.deepEqual(api.guessMappings([alias]),[{sourceField:alias,targetField:f.id}]);
      }
    }
    const headers=['企业名称','企业实控人名称（自然人请填写姓名）'];
    const result=api.projectCompletionResult({headers,mappings:api.guessMappings(headers),
      fieldSelection:['actual_controller_name'],rows:[{企业名称:'合成测试有限公司',[headers[1]]:'',actual_controller_name:'合成甲',qcc_match_status:'enriched'}]});
    assert.equal(result.rows[0][headers[1]],'合成甲');
    assert.equal(result.headers.includes('actual_controller_name'),false);
  } finally {cleanupGlobals();}
});
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

/**
 * 最小 defineStore，忠实复刻 dsh-client-runtime 的 `{ spec, create }` 契约：
 * create() 返回 { actions, getSnapshot, subscribe, store }；actions 以可变
 * draft 调用声明并触发订阅。
 */
function sessionFixture(exports, sessionId) {
  exports.__testing.installSessionWorkbench({});
  const store = document[Symbol.for('dsh.data-cleaning.session-workbench')].controller.storeFor(sessionId);
  return { options: { store: { create: () => store } }, component: exports.__testing.WorkbenchContent };
}

function contentFixture(exports) {
  return { options: { store: exports.__testing.createWorkbenchStore() }, component: exports.__testing.WorkbenchContent };
}

test('optional provider arrival/removal does not unload business state or read an ungranted service', () => {
  try {
    const { exports } = loadClient();
    let activate, providerCleanup, registrations=0;
    const release = exports.__testing.installSessionWorkbench({
      get betterSidebar() { assert.fail('Root cannot access an un-injected Cordis service'); },
      inject(deps,callback) {
        assert.deepEqual(deps,['betterSidebar']); activate=callback;
        return {dispose:()=>providerCleanup?.()};
      },
    });
    const controller = document[Symbol.for('dsh.data-cleaning.session-workbench')].controller;
    const business = controller.storeFor('s1');
    business.actions.setInput('保留名单');
    assert.equal(controller.open('s1','upload'),false);
    assert.match(business.getSnapshot().error,/安装或升级/);
    const service = { features:['targetedOpen','stateSubscription'],
      registerTab() { registrations++; return ()=>registrations--; },
      subscribeState:()=>()=>{},getSnapshot:()=>({sessionId:'s1'}),isTabEnabled:()=>true,openTab:()=>{} };
    activate({betterSidebar:service,effect:fn=>{providerCleanup=fn();}});
    assert.equal(controller.open('s1','history'),true);
    providerCleanup();
    assert.equal(registrations,0);
    assert.equal(controller.open('s1','upload'),false);
    assert.equal(business.getSnapshot().input,'保留名单');
    release();
  } finally { cleanupGlobals(); }
});

test('Session controller shares one descriptor, isolates stores and survives Tab close without task writes', () => {
  const previousFetch = globalThis.fetch;
  try {
    const { exports } = loadClient();
    let registered = 0, removed = 0, subscribed = 0, opens = 0;
    const hostTabs = new Set();
    let collapsed = false;
    const service = {
      features: ['targetedOpen','stateSubscription'],
      registerTab(descriptor) { assert.equal(descriptor.single,true); registered++; return ()=>removed++; },
      subscribeState() { subscribed++; return ()=>subscribed--; },
      getSnapshot: ()=>({sessionId:'s1'}),
      isTabEnabled: ()=>true,
      openTab(seed,scope) { assert.equal(seed.type,'dsh-data-cleaning-agent:workbench'); assert.ok(scope.sessionId); hostTabs.add(scope.sessionId + ':' + seed.type); collapsed = false; opens++; },
    };
    globalThis.fetch = () => assert.fail('Shortcuts and Tab lifecycle must not create, cancel or delete tasks');
    const release1 = exports.__testing.installSessionWorkbench({betterSidebar:service});
    const release2 = exports.__testing.installSessionWorkbench({betterSidebar:service});
    const controller = document[Symbol.for('dsh.data-cleaning.session-workbench')].controller;
    const first = controller.storeFor('s1'), second = controller.storeFor('s2');
    first.actions.setInput('甲企业'); second.actions.setInput('乙企业');
    first.actions.setWorkflowTask({id:'dcw-kept',state:'enriching'});
    for (const step of ['upload','rules','match','enrich','history']) {
      controller.open('s1',step); controller.open('s1',step);
      assert.equal(first.getSnapshot().step,step);
    }
    assert.equal(registered,2); assert.equal(opens,10);
    assert.equal(hostTabs.size, 1, '重复流程入口复用 Session 单例 Tab');
    hostTabs.clear(); // 模拟宿主 Tab X：仅移除容器，不销毁业务 store。
    controller.open('s1', 'history');
    assert.equal(hostTabs.size, 1);
    assert.equal(controller.storeFor('s1'), first);
    collapsed = true; // 宿主收起不改变插件业务状态。
    controller.open('s1', 'history');
    assert.equal(collapsed, false);
    assert.equal(hostTabs.size, 1);
    assert.equal(first.getSnapshot().workflowTask.id, 'dcw-kept');
    assert.equal(second.getSnapshot().input,'乙企业');
    assert.equal(second.getSnapshot().open,false);
    assert.equal(first.getSnapshot().workflowTask.id,'dcw-kept');
    release1(); release1();
    assert.equal(removed,0,'one materialized scope leaving cannot dispose other Session tabs');
    release2(); release2();
    assert.equal(removed,2); assert.equal(subscribed,0);
    assert.equal(first.getSnapshot().workflowTask.state,'enriching','unload does not mutate Host task state');
    assert.equal(controller.open('s1','upload'),false);
  } finally { globalThis.fetch=previousFetch; cleanupGlobals(); }
});

test('预览链接复用当前 Session 的侧栏 Tab，下载和外域链接不拦截', () => {
  const previousLocation = globalThis.location;
  try {
    const { exports } = loadClient();
    globalThis.location = { href: 'http://127.0.0.1:3080/', origin: 'http://127.0.0.1:3080' };
    const opens = [];
    const tabs = new Map();
    const service = { features: ['targetedOpen', 'stateSubscription'],
      registerTab: descriptor => { tabs.set(descriptor.id, descriptor); return () => tabs.delete(descriptor.id); },
      subscribeState: () => () => {}, getSnapshot: () => ({ sessionId: 's-preview' }),
      isTabEnabled: () => true, openTab: (seed, scope) => opens.push({ seed, scope }) };
    const release = exports.__testing.installSessionWorkbench({ betterSidebar: service });
    const click = href => {
      const event = { type: 'click', button: 0, defaultPrevented: false,
        target: { closest: () => ({ href }) }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const path = '/data-cleaning/api/workflow/tasks/dcw-test/artifacts/dca-test';
    assert.equal(click(path + '?preview=1'), true);
    assert.equal(opens[0].seed.type, 'dsh-data-cleaning-agent:artifact-preview');
    assert.equal(opens[0].scope.sessionId, 's-preview');
    assert.equal(click(path), false);
    assert.equal(click('https://example.com' + path + '?preview=1'), false);
    assert.equal(click('/other?preview=1'), false);
    release();
    assert.equal(click(path + '?preview=1'), false);
  } finally { globalThis.location = previousLocation; cleanupGlobals(); }
});

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
  const shared = globalThis.document?.[Symbol.for('dsh.data-cleaning.session-workbench')];
  if (shared) { shared.references = 1; shared.release(); }
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

    assert.equal(slots.has('shell.overlay'), false, '禁止注入私有工作台 overlay');
    assert.ok(slots.has('sidebar.footer.action'), '必须注入 sidebar.footer.action');
    assert.ok(slots.has('conversation.input.dock'), '必须注入原生 composer 独立 dock');
    assert.ok(slots.has('conversation.input.overlay'), '必须注入提示词生成浮层');
    assert.equal(slots.has('conversation.input.left'), false, '能力按钮不得再放在输入框内部工具行');
    assert.ok(slots.has('conversation.session.header.actions'), '必须注入原生会话头动作');
    assert.equal(slots.has('conversation.hero.brand.mark'), false, '业务 LOGO 不得占用全局单例品牌槽位');
    assert.ok(slots.has('tool.call.toolview'), '必须注入 tool.call.toolview（模型工具富化卡片）');

    const toolviews = slots.get('tool.call.toolview');
    assert.equal(toolviews.length, 5, 'tool.call.toolview 包括 QCC 结果文件入口');
    assert.deepEqual(
      toolviews.map((r) => r.options.key).sort(),
      ['data_clean_rows', 'data_complete_rows', 'data_profile', 'data_cleaning_extract_image_companies', 'data_cleaning_qcc_run'].sort(),
      '五个工具 wire 名逐一 keyed'
    );
    for (const r of toolviews) {
      assert.equal(r.options.name, 'tool.call.toolview');
      assert.equal(r.options.locale, 'conversation', 'locale 必须为 conversation 命名空间');
      assert.equal(typeof r.component, 'function');
    }

    const overlay = contentFixture(exports);

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

test('入口按钮：数据库图标与业务名称同排，点击只启动中央业务会话', async () => {
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
    const wideTree = expandElementTree(wideEl);
    assert.ok(findNode(wideTree, (n) => n.type === 'svg' && n.props.className === 'dcAgentDatabaseLogo'));
    assert.ok(findNode(wideTree, (n) => n.type === 'span' && n.children?.includes('数据清洗补全')));

    await wideEl.props.onClick();
    assert.equal(instance.getSnapshot().open, false, '初始业务页不应强制展开右侧工作台');
    assert.equal(instance.getSnapshot().step, 'upload');
    assert.equal(instance.getSnapshot().activeSessionId, 'session-cleaning-1');
    assert.equal(started, 1);

    const narrowEl = flattenElement(render(component, { wide: false }, instance));
    const narrowTree = expandElementTree(narrowEl);
    assert.ok(findNode(narrowTree, (n) => n.type === 'svg'));
    assert.equal(findNode(narrowTree, (n) => n.type === 'span' && n.children?.includes('数据清洗补全')), null);
    assert.equal(narrowEl.props['aria-expanded'], undefined);
  } finally {
    cleanupGlobals();
  }
});

test('入口注入使用 sessions.create 显式创建带前缀的独立会话并预填提示词', async () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let footerReg = null;
    const calls = { create: null, draft: null, opened: null };
    const ctx = {
      effect: () => () => {},
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: '/synthetic/customer', sessionIds: ['old'] }], recentWorkspaceId: 'ws-1' }) },
      },
      sessions: {
        list: { getSnapshot: () => ({ current: 'old' }) },
        create: async (opts) => { calls.create = opts; return opts.sessionId; },
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
    assert.equal(calls.create.workspaceId, 'ws-1');
    assert.equal(Object.hasOwn(calls.create, 'cwd'), false);
    assert.match(sessionId, /^session-dsh-data-cleaning-agent-[0-9a-f-]{36}$/);
    assert.equal(calls.opened, sessionId);
    assert.equal(calls.draft.sessionId, sessionId);
    assert.match(calls.draft.text, /提示词生成/);
  } finally {
    cleanupGlobals();
  }
});

test('不再依赖 workspaces/uiWorkspace.connectWorkspace，直接创建独立会话', async () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let footerReg = null;
    const calls = { create: null, draft: null, opened: null };
    const conversation = {
      input: { shell: (sessionId) => ({ setDraft: (text) => { calls.draft = { sessionId, text }; } }) },
    };
    const ctx = {
      effect: () => () => {},
      workspaces: {
        // 刻意不提供 connectWorkspace，验证独立会话创建不再依赖它
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-alpha', path: '/synthetic/supplier', sessionIds: [] }] }) },
      },
      sessions: {
        list: { getSnapshot: () => ({ current: undefined }) },
        create: async (opts) => { calls.create = opts; return opts.sessionId; },
        open: (sessionId) => { calls.opened = sessionId; },
      },
      get: (name) => ({ conversation })[name],
      slots: {
        inject: (name, cb) => { if (name === 'sidebar.footer.action') footerReg = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    exports.apply(ctx);
    const sessionId = await footerReg.options.inject().startSession();
    assert.equal(calls.create.workspaceId, 'ws-alpha');
    assert.equal(Object.hasOwn(calls.create, 'cwd'), false);
    assert.match(sessionId, /^session-dsh-data-cleaning-agent-/);
    assert.equal(calls.opened, sessionId);
    assert.equal(calls.draft.sessionId, sessionId);
  } finally {
    cleanupGlobals();
  }
});

test('原生 DSH Hero 工作区门：cwd-only 被禁用，workspaceId 创建解除工作区禁用条件', async () => {
  try {
    const loaded = loadClient();
    let entry;
    const workspace = { workspaceId: 'ws-live', path: '/synthetic/live', title: '工作区', sessionIds: [] };
    let current;
    let draft = '';
    const ctx = {
      effect: () => () => {},
      workspaces: { list: { getSnapshot: () => ({ phase: 'ready', items: [workspace] }) } },
      sessions: {
        list: { getSnapshot: () => ({ current }) },
        create: async (opts) => {
          if (opts.workspaceId === workspace.workspaceId) workspace.sessionIds.push(opts.sessionId);
          return opts.sessionId;
        },
        open: (id) => { current = id; },
      },
      get: () => ({ input: { shell: () => ({ setDraft: (text) => { draft = text; } }) } }),
      slots: {
        inject: (name, cb) => { if (name === 'sidebar.footer.action') entry = cb(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    };
    loaded.exports.apply(ctx);
    // 直接取本机 DSH 真实禁用表达式；CI 使用经源码核对的同一表达式。
    const dshPath = '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js';
    const fallback = 'sessionId === void 0 || hero && chipTitle === void 0';
    const expression = existsSync(dshPath)
      ? readFileSync(dshPath, 'utf8').match(/const inert = (sessionId === void 0[^;]+);/)[1] : fallback;
    const inert = new Function('sessionId', 'hero', 'chipTitle', 'return ' + expression);
    assert.equal(inert('cwd-only-session', true, undefined), true, '复现0.8.4禁用发送');
    const id = await entry.options.inject().startSession();
    const chipTitle = workspace.sessionIds.includes(id) ? workspace.title : undefined;
    assert.equal(inert(id, true, chipTitle), false);
    assert.ok(draft.trim().length > 0);
    assert.equal(current, id);
  } finally { cleanupGlobals(); }
});

test('新会话 Bridge：不复用空白清洗会话，失败/并发/卸载及其它入口保持隔离', async () => {
  try {
    const loaded = loadClient();
    const { markCleaningSession, isCleaningSession, installSessionOwnershipBridge } = loaded.exports.__testing;
    let current = 'cleaning-session';
    let notify;
    let draft = '用户编辑过的清洗草稿';
    let creates = 0;
    let originalCalls = 0;
    let rejectCreate = false;
    let resolveCreate;
    const original = function () { originalCalls++; };
    const ctx = {
      workspaces: {
        startSession: original,
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws', sessionIds: ['cleaning-session'] }] }) },
      },
      sessions: {
        list: { getSnapshot: () => ({ current }), subscribe: (fn) => { notify = fn; return () => {}; } },
        create: (opts) => {
          creates++;
          assert.equal(opts.workspaceId, 'ws');
          assert.equal(Object.hasOwn(opts, 'sessionId'), false, '普通会话由Host分配ID');
          if (rejectCreate) return Promise.reject(new Error('synthetic create failure'));
          return new Promise((resolve) => { resolveCreate = resolve; });
        },
        open: (id) => { current = id; notify(); },
      },
      get: () => ({ input: { shell: () => ({ snapshot: { draft }, setDraft: (text) => { draft = text; } }) } }),
    };
    markCleaningSession(current);
    const release = installSessionOwnershipBridge(ctx);
    rejectCreate = true;
    ctx.workspaces.startSession();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(current, 'cleaning-session');
    assert.equal(isCleaningSession(current), true);
    assert.equal(draft, '用户编辑过的清洗草稿');
    rejectCreate = false;
    ctx.workspaces.startSession();
    ctx.workspaces.startSession();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(creates, 2, '连续点击合并同一次创建');
    resolveCreate('ordinary-session');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(current, 'ordinary-session');
    assert.equal(isCleaningSession(current), false);
    ctx.workspaces.startSession();
    assert.equal(originalCalls, 1, '普通会话仍走原生动作');
    current = 'cleaning-session';
    markCleaningSession(current);
    ctx.workspaces.startSession();
    await new Promise((resolve) => setImmediate(resolve));
    ctx.sessions.open('other-agent-session');
    resolveCreate('late-ordinary-session');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(current, 'other-agent-session', '晚到的创建结果不抢其它智能体页面');
    release();
    assert.equal(ctx.workspaces.startSession, original);
  } finally { cleanupGlobals(); }
});

test('rc.1 New Session bridge binds optional uiWorkspace lifecycle', async () => {
  try {
    const { exports } = loadClient();
    let current = 'cleaning-session', notify, cleanup, disposed = false;
    const original = () => {};
    const navigation = { startSession: original };
    const ctx = {
      workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws', sessionIds: [current] }] }) } },
      sessions: {
        list: { getSnapshot: () => ({ current }), subscribe: fn => { notify = fn; return () => {}; } },
        create: async () => 'normal-session', open: id => { current = id; notify(); },
      },
      inject: (keys, callback) => {
        assert.deepEqual(Array.from(keys), ['uiWorkspace']);
        callback({ ...ctx, uiWorkspace: navigation, effect: fn => { cleanup = fn(); } });
        return { dispose: () => { disposed = true; cleanup(); } };
      },
    };
    exports.__testing.markCleaningSession(current);
    const release = exports.__testing.installSessionOwnershipBridge(ctx);
    navigation.startSession();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(current, 'normal-session');
    assert.equal(exports.__testing.isCleaningSession(current), false);
    release();
    assert.equal(disposed, true);
    assert.equal(navigation.startSession, original);
  } finally { cleanupGlobals(); }
});

test('完整清单显示13行、跨页可达最后一行，下载不受页码限制且中文表头安全', async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  try {
    const loaded = loadClient();
    const { DatasetReview, reviewColumns, reviewCsv } = loaded.exports.__testing;
    const react = loaded.requireShim('react');
    let page = 0;
    react.useState = () => [page, (value) => { page = value; }];
    const rows = Array.from({ length: 45 }, (_, index) => ({ 企业名称: `测试企业${index + 1}`, credit_no: String(910000000000000000n + BigInt(index)) }));
    rows[44].额外字段 = '最后一行的字段';
    const draw = (values, expectedCount = values.length) => DatasetReview({
      rows: values, headers: ['企业名称', 'credit_no'], title: '图片识别原始名单', expectedCount,
      onError: (error) => assert.fail(error),
    });
    let tree = draw(rows.slice(0, 13));
    let body = findNode(tree, (n) => n.type === 'tbody');
    const displayed = [];
    collectNodes(body, (n) => n.type === 'tr', displayed);
    assert.equal(displayed.length, 13, '13条必须全部显示，不能只显示5条');
    tree = draw(rows);
    findNode(tree, (n) => n.children?.includes('下一页')).props.onClick();
    tree = draw(rows);
    findNode(tree, (n) => n.children?.includes('下一页')).props.onClick();
    tree = draw(rows);
    assert.ok(findNode(tree, (n) => n.children?.includes('测试企业45')));
    assert.ok(findNode(tree, (n) => n.type === 'th' && n.children?.includes('额外字段')));
    assert.equal(findNode(tree, (n) => n.children?.includes('下一页')).props.disabled, true);
    let exported;
    let clicked = false;
    URL.createObjectURL = (blob) => { exported = blob; return 'blob:review-test'; };
    URL.revokeObjectURL = () => {};
    document.createElement = () => ({ click: () => { clicked = true; } });
    findNode(tree, (n) => n.type === 'button' && n.props?.['aria-label'] === '下载全部 45 条 CSV').props.onClick();
    assert.equal(clicked, true);
    const csv = await exported.text();
    assert.match(csv, /统一社会信用代码/);
    assert.match(csv, /测试企业1"/);
    assert.match(csv, /测试企业45/);
    assert.match(csv, /'910000000000000000/);
    findNode(tree, (n) => n.type === 'button' && n.props?.['aria-label'] === '下载原值 JSON').props.onClick();
    assert.deepEqual(JSON.parse(await exported.text()), rows);
    const safe = reviewCsv([{ 企业名称: '=1+1', credit_no: '00123' }], ['企业名称', 'credit_no']);
    assert.match(safe, /'=1\+1/);
    assert.match(safe, /'00123/);
    assert.deepEqual(reviewColumns(rows, ['企业名称']), ['企业名称', 'credit_no', '额外字段']);
    tree = draw(rows.slice(0, 5), 13);
    assert.equal(findNode(tree, (n) => n.type === 'button' && n.props?.['aria-label'] === '下载全部 5 条 CSV').props.disabled, true);
    assert.ok(findNode(tree, (n) => n.children?.some((text) => typeof text === 'string' && text.includes('完整清单尚未就绪'))));
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    cleanupGlobals();
  }
});

test('原生 composer 下方渲染五个 Mockup 能力按钮并定位右侧工作台步骤', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let capabilityReg = null;
    let overlayReg = sessionFixture(loaded.exports, 'session-3');
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
    collectNodes(bar, (n) => n.props && ['导入名单', '质量体检', '匹配核验', '字段补全', '任务历史'].includes(n.props['aria-label']), buttons);
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
    let overlayReg = contentFixture(loaded.exports);
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
    assert.ok(findNode(home, (n) => n.props?.className === 'dcAgentHomeSummary'));
    assert.equal(findNode(home, (n) => n.props?.['aria-label'] === '数据清洗补全产品介绍'), null);
    assert.equal(findNode(home, (n) => n.props?.['aria-label'] === '数据清洗补全工作流'), null);
    assert.equal(findNode(home, (n) => n.children?.includes('最近任务')), null);
  } finally {
    cleanupGlobals();
  }
});

test('会话归属只在实际切换成功后撤销，失败点击保留清洗界面与草稿', () => {
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
    let current = 'cleaning-owned';
    let selected;
    const ctx = {
      sessions: { list: {
        getSnapshot: () => ({ current }),
        subscribe: (listener) => { selected = listener; return () => { selected = null; }; },
      } },
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
    const imageDraft = '请识别我刚刚在向导中安全暂存的企业名单图片。\n安全图片凭证：dci-test\n请调用 data_cleaning_extract_image_companies。';
    assert.equal(isKnownCleaningDraft(imageDraft), true, '未发送的图片识别说明也属于插件草稿');
    assert.equal(isKnownCleaningDraft('用户要求清洗企业名单'), false, '普通用户文案不得被识别为插件草稿');
    const release = installSessionOwnershipBridge(ctx);

    assert.equal(isCleaningSession('ordinary-session'), false);
    markCleaningSession('cleaning-owned');
    draft = '清洗子系统草稿';
    assert.equal(isCleaningSession('cleaning-owned'), true);
    document.dispatchEvent({ type: 'click', target: ownButton });
    assert.equal(isCleaningSession('cleaning-owned'), true, '点击自身入口不得撤销清洗子系统');
    document.dispatchEvent({ type: 'click', target: genericButton });
    assert.equal(isCleaningSession('cleaning-owned'), true, '点击不代表切换成功');
    assert.equal(draft, '清洗子系统草稿', '失败导航不应丢失用户草稿');
    selected();
    assert.equal(isCleaningSession('cleaning-owned'), true, '同会话列表刷新不代表切换');
    current = 'ordinary-session';
    selected();
    assert.equal(isCleaningSession('cleaning-owned'), false, '新会话必须恢复为无清洗内容的默认首页');
    assert.equal(draft, '清洗子系统草稿', '退出后也保留用户自写草稿');

    markCleaningSession('cleaning-second');
    assert.equal(deactivateCleaningSession('another-session'), false);
    assert.equal(isCleaningSession('cleaning-second'), true);
    assert.equal(deactivateCleaningSession(), true);
    assert.equal(isCleaningSession('cleaning-second'), false);
    current = 'cleaning-third';
    markCleaningSession(current);
    draft = generatedDraft;
    current = undefined;
    selected();
    assert.equal(isCleaningSession('cleaning-third'), false, '清除选中会话时也应退出');
    assert.equal(draft, '', '成功退出只清理插件默认草稿');
    release();
    assert.equal(selected, null);
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
    let overlayReg = contentFixture(loaded.exports);
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

test('智能映射覆盖全目录、别名和多义推荐，重复字段不抢占、未知列不冒充企业', async () => {
  try {
    const { guessMappings, mappingRecommendations, mergeRecommendedMappings } = loadClient().exports.__testing;
    const { QCC_FIELD_CATALOG } = await import('../lib/qcc-field-catalog.js');
    for (const field of QCC_FIELD_CATALOG.flatMap((group) => group.fields)) {
      assert.deepEqual(guessMappings([field.label]), [{ sourceField: field.label, targetField: field.id }]);
      assert.deepEqual(guessMappings([field.id]), [{ sourceField: field.id, targetField: field.id }]);
    }
    const headers = ['企业名称', '法定代表人', '法定代表人（重复列 2）', '统一社会信用代码', '地址', '网址', '联系电话', '注册资本', '开业时间'];
    const hints = mappingRecommendations(headers);
    assert.deepEqual(guessMappings(headers).map((item) => item.targetField), ['company_name', 'credit_no', 'phone', 'reg_capital']);
    assert.equal(hints[1].conflict, true);
    assert.equal(hints[2].conflict, true);
    assert.deepEqual(hints[4].candidates.map(([id]) => id), ['registered_address', 'mailing_address', 'invoice_address']);
    assert.equal(hints[5].candidates[0][0], 'contact_official_website');
    assert.equal(hints[8].candidates[0][0], 'establish_date');
    assert.equal(hints[8].automatic, false, '开业不必然等于成立，不能偷偷替换语义');
    assert.deepEqual(guessMappings([' ＬＥＧＡＬ＿ＲＥＰ ', '成立时间', '公司全称']).map((item) => item.targetField), ['legal_rep', 'establish_date', 'company_name']);
    assert.deepEqual(guessMappings(['金额', '一级行业', '二级行业', '负责人']), []);
    assert.equal(guessMappings(['主体标识'])[0].targetField, 'company_name');
    const selected = [{ sourceField: '地址', targetField: 'mailing_address' }, { sourceField: '法定代表人（重复列 2）', targetField: 'legal_rep' }];
    const merged = mergeRecommendedMappings(headers, selected);
    assert.deepEqual(merged.slice(0, 2), selected);
    assert.equal(new Set(merged.map((item) => item.targetField)).size, merged.length);
    assert.deepEqual(mappingRecommendations(['官网'], [['company_name', '企业名称']])[0].candidates, [], '只推荐当前 Host 支持的字段');
  } finally { cleanupGlobals(); }
});

test('受益人和主营业务收入只推荐，映射搜索展示可见列表并保持原选择', () => {
  try {
    const loaded = loadClient();
    const api = loaded.exports.__testing;
    const hints = api.mappingRecommendations(['受益人', '主营业务收入']);
    assert.deepEqual(hints.map(row => row.candidates[0][0]), ['beneficial_owner_first_name', 'financial_total_revenue']);
    assert.ok(hints.every(row => !row.automatic));
    assert.match(hints[1].reason, /口径不同/);
    assert.deepEqual(api.guessMappings(['受益人', '主营业务收入']), []);
    assert.deepEqual(api.mappingRecommendations(['主营业务收入'], [['company_name', '企业名称']])[0].candidates, []);
    let query = '营业', category = '', cursor = 0;
    loaded.requireShim('react').useState = () => cursor++ === 0
      ? [query, v => { query = v; }] : [category, v => { category = v; }];
    const changes = [];
    const draw = () => {
      cursor = 0;
      return api.MappingPicker({ sourceField: '主营业务收入',
        mappings: [{ sourceField: '主营业务收入', targetField: 'company_name' }],
        groups: [['company', '工商', [['company_name', '企业名称']]], ['finance', '财务', [['financial_total_revenue', '营业总收入']]]],
        recommendation: hints[1], onChange: (...args) => changes.push(args) });
    };
    let tree = draw();
    const details = findNode(tree, n => n.type === 'details');
    const panel = findNode(details, n => n.props?.className === 'dcAgentMappingPickerPanel');
    const filters = findNode(panel, n => n.props?.className === 'dcAgentMappingPickerFilters');
    const list = findNode(panel, n => n.props?.role === 'radiogroup');
    assert.deepEqual(details.children.map(n => n.type), ['summary', 'div']);
    assert.deepEqual(filters.children.map(n => n.type), ['input', 'select']);
    assert.equal(panel.children[1].props.role, 'radiogroup');
    assert.ok(findNode(list, n => n.props?.className === 'dcAgentMappingCurrentNotice').children[0].includes('当前选择：企业名称'));
    assert.ok(findNode(list, n => n.type === 'input' && n.props?.value === 'financial_total_revenue'));
    assert.equal(findNode(list, n => n.props?.['data-mapping-group'] === 'company'), null);
    query = '主营业务';
    assert.ok(findNode(draw(), n => n.type === 'input' && n.props?.value === 'financial_total_revenue'));
    query = '工商';
    tree = draw();
    assert.ok(findNode(tree, n => n.props?.['data-mapping-group'] === 'company'));
    assert.equal(findNode(tree, n => n.type === 'input' && n.props?.value === 'company_name').props.checked, true, 'dimension search exposes the whole matching group and preserves the selection');
    category = 'company';
    query = '主营业务';
    tree = draw();
    assert.equal(findNode(tree, n => n.type === 'input' && n.props?.value === 'financial_total_revenue'), null);
    assert.ok(findNode(tree, n => n.props?.role === 'status').children[0].includes('无匹配字段'));
    assert.deepEqual(changes, []);
  } finally { cleanupGlobals(); }
});

test('工作台预览与 Host 导出共用相同原列补空算法', async () => {
  try {
    const clientProjection = loadClient().exports.__testing.projectCompletionResult;
    const { projectCompletionResult } = await import('../lib/engine.js');
    assert.equal(clientProjection.toString().replace(/\s+/g, ''), projectCompletionResult.toString().replace(/\s+/g, ''));
    const input = { headers: ['企业名称', '法人'], mappings: [{ sourceField: '法人', targetField: 'legal_rep' }], fieldSelection: ['legal_rep'],
      rows: [{ 企业名称: '甲', 法人: '', legal_rep: '张三', qcc_match_status: 'enriched' }] };
    assert.deepEqual(clientProjection(input), projectCompletionResult(input));
    assert.equal(clientProjection(input).rows[0].法人, '张三');
  } finally { cleanupGlobals(); }
});

test('银行模板表头：确认映射驱动范围，重复输出共用字段，不支持列不冒充', () => {
  try {
    const api = loadClient().exports.__testing;
    const headers = ['公司名称','统一社会信用代码','注册号','企业类型','经营范围','注册资本','核准日期 YYYY-MM-DD','法定代表人','成立日期','企业状态','所属省份','所属市','所属区县','所属行业','注册地址','企业划型','主营业务','法定代表人（重复列 2）','邮编','主营业务收入','注册资本（重复列 2）','从业人数','实际控制人'];
    let mappings = api.guessMappings(headers);
    assert.equal(mappings.length, 9);
    assert.equal(mappings.find(m => m.sourceField.startsWith('核准日期')).targetField, 'approval_date');
    const hints = api.mappingRecommendations(headers);
    for (const name of ['所属省份','所属市','所属区县','企业划型','主营业务','邮编','从业人数']) {
      assert.deepEqual(hints.find(h => h.sourceField === name).candidates, []);
    }
    const initial = api.mappedOutputFields(mappings);
    for (const [sourceField,targetField] of [['注册资本','reg_capital'],['注册资本（重复列 2）','reg_capital'],['法定代表人','legal_rep'],['法定代表人（重复列 2）','legal_rep'],['企业状态','reg_status'],['所属行业','industry_category']]) {
      mappings = api.updateColumnMapping(mappings, sourceField, targetField);
    }
    assert.equal(mappings.length, 15);
    const selected = api.syncMappedSelection(api.guessMappings(headers), mappings, initial);
    assert.equal(selected.length, 13);
    const row = Object.fromEntries(headers.map(h => [h, '']));
    row['公司名称'] = '合成测试企业';
    const result = api.projectCompletionResult({headers, mappings, fieldSelection:selected, rows:[{...row,legal_rep:'合成甲',reg_capital:'100万元',qcc_match_status:'enriched'}]});
    assert.equal(result.rows[0]['法定代表人（重复列 2）'], '合成甲');
    assert.equal(result.rows[0]['注册资本（重复列 2）'], '100万元');
    assert.equal(result.headers.includes('legal_rep'),false);
    assert.equal(result.rows[0]['主营业务收入'],'');
    const prompt = api.buildTaskPrompt({mode:'excel', headers, mappings, entries:['合成测试企业'], enrichmentKeys:selected});
    assert.match(prompt,/仅补已确认原列的空白/);
    assert.match(prompt,/暂不补全的原列/);
    assert.match(prompt,/额外新增字段：无/);
  } finally { cleanupGlobals(); }
});

test('人工映射支持多原列写回，并自动同步补全范围', () => {
  try {
    const loaded = loadClient();
    let overlay = contentFixture(loaded.exports);
    loaded.exports.apply({ effect: () => () => {}, slots: {
      inject: (name, callback) => { if (name === 'shell.overlay') overlay = callback(); return () => {}; },
      register: (options, component) => ({ options, component }),
    } });
    const store = overlay.options.store.create();
    store.actions.setFieldSelection(['credit_no']);
    store.actions.setMappings([{ sourceField: 'A', targetField: 'legal_rep' }]);
    store.actions.setMapping('B', 'legal_rep');
    assert.deepEqual(store.getSnapshot().mappings, [{ sourceField: 'A', targetField: 'legal_rep' }, { sourceField: 'B', targetField: 'legal_rep' }]);
    store.actions.setMapping('A', '');
    store.actions.setMapping('B', 'legal_rep');
    assert.deepEqual(store.getSnapshot().mappings, [{ sourceField: 'B', targetField: 'legal_rep' }]);
    assert.deepEqual(store.getSnapshot().fieldSelection, ['credit_no', 'legal_rep']);
  } finally { cleanupGlobals(); }
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
      enrichmentKeys: ['credit_no', 'legal_rep', 'qcc_industry'],
      anchorKeys: ['company_name', 'credit_no'],
    });
    assert.match(prompt, /企业名单\.xlsx/);
    assert.match(prompt, /示例科技有限公司/);
    assert.match(prompt, /名称补全与规范、重复企业去重/);
    assert.match(prompt, /统一社会信用代码、法定代表人、企查查行业/);
    assert.match(prompt, /存在多个候选必须暂停/);
    assert.match(prompt, /当前用户自己的账号承担/);
    const imagePrompt = buildTaskPrompt({
      mode: 'image',
      fileName: '企业名单.png',
      imageCommandId: 'dci-one-turn',
      imageState: 'prepared',
      cleaningKeys: ['clean_name'],
      enrichmentKeys: ['credit_no', 'legal_rep'],
      anchorKeys: ['company_name', 'credit_no'],
    });
    assert.match(imagePrompt, /企查查智能文档解析/);
    assert.match(imagePrompt, /安全图片凭证：dci-one-turn/);
    assert.match(imagePrompt, /统一社会信用代码、法定代表人/);
    assert.match(imagePrompt, /只调用一次 data_cleaning_extract_image_companies/);
    assert.doesNotMatch(imagePrompt, /```json|schemaVersion/);
  } finally {
    cleanupGlobals();
  }
});

test('图片接入 Bridge 创建 draft image、加入会话并把官方缩略图描述交给向导', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let promptReg = null;
    const calls = { files: null, ids: null, removed: null, released: null };
    const conversation = {
      createDraftImages: (files) => {
        calls.files = files;
        return [{ id: 'draft-image-1', previewUrl: 'blob:preview-1' }];
      },
      releaseDraftImages: () => { throw new Error('success path must not release'); },
      releaseDraftImage: (id) => { calls.released = id; },
      input: { shell: () => ({
        addImages: (ids) => { calls.ids = ids; return true; },
        removeImage: (id) => { calls.removed = id; return true; },
      }) },
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
    assert.deepEqual(promptReg.options.inject().attachImages('cleaning-image', [file]), [
      { id: 'draft-image-1', previewUrl: 'blob:preview-1' },
    ]);
    assert.deepEqual(calls.files, [file]);
    assert.deepEqual(calls.ids, ['draft-image-1']);
    assert.equal(promptReg.options.inject().removeImage('cleaning-image', { id: 'draft-image-1' }), true);
    assert.equal(calls.removed, 'draft-image-1');
    assert.equal(calls.released, 'draft-image-1');
  } finally {
    cleanupGlobals();
  }
});

test('图片剪贴板兼容 files 与仅 items，忽略文本和空文件且不重复取图', () => {
  try {
    const { imageFilesFromTransfer } = loadClient().exports.__testing;
    const image = { name: '截图.png', type: 'image/png' };
    const items = [{ kind: 'file', type: 'image/png', getAsFile: () => image }];
    assert.deepEqual(imageFilesFromTransfer({ files: [], items }), [image]);
    assert.deepEqual(imageFilesFromTransfer({ files: [image], items }), [image]);
    assert.deepEqual(imageFilesFromTransfer({ items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => { throw Error('must not read'); } },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
    ] }), []);
    assert.deepEqual(imageFilesFromTransfer(null), []);
  } finally { cleanupGlobals(); }
});

test('图片向导支持 Composer 粘贴、拖入、缩略图/放大与一次性完整任务指令', () => {
  assert.match(source, /window\.addEventListener\?\.\('paste', handleWindowPaste, true\)/);
  assert.match(source, /textarea, \[contenteditable="true"\], \[role="textbox"\]/);
  assert.match(source, /dcAgentPromptImageThumb/);
  assert.match(source, /dcAgentImageLightbox/);
  assert.match(source, /data_cleaning_extract_image_companies/);
  assert.match(source, /\/data-cleaning\/api\/images\/commands/);
  assert.match(source, /imageCommand\?\.state === 'prepared'[\s\S]{0,300}removeImage\(sessionId, imageAttachment\)[\s\S]{0,300}setImageAttachment\(null\)/);
  assert.match(source, /imageCommandId: imageCommand\?\.commandId/);
  assert.doesNotMatch(source, /setDraft\(imageCommand\.prompt\)/);
  assert.match(source, /mode === 'image' && !imageCommand/);
  assert.match(source, /qcc-document-mcp/);
  assert.match(source, /可直接在此粘贴图片，或拖入 \/ 选择 PNG、JPEG、WebP/);
});

for (const intake of ['file', 'clipboard-items', 'wizard-text-paste', 'workbench-image']) test(`图片向导 ${intake} 未连 OCR 时保留预览并可完成四步回填`, async () => {
  const previousFetch = globalThis.fetch;
  const effects = [];
  try {
    const loaded = loadClient();
    const react = loaded.requireShim('react');
    const states = [];
    let cursor = 0;
    react.useState = (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    };
    react.useEffect = (effect) => { effects.push(effect); };
    let prompt;
    loaded.exports.apply({
      effect: () => () => {},
      slots: {
        inject: (name, callback) => { if (name === 'conversation.input.overlay') prompt = callback(); return () => {}; },
        register: (options, component) => ({ options, component }),
      },
    });
    loaded.exports.__testing.markCleaningSession('image-feedback');
    const requests = [];
    globalThis.fetch = async (path, options) => {
      requests.push({ path, options });
      return { ok: true, json: async () => ({ ok: true, command: {
        commandId: 'dci-test', state: 'prepared', providerReady: false,
        providerIssue: { code: 'DC_IMAGE_LOCAL_DOCUMENT_PROVIDER_REQUIRED', message: '请配置本地 qcc-document-mcp。' },
      } }) };
    };
    const removed = [];
    let draft = '';
    let inputPhase = 'idle';
    const props = {
      sessionId: 'image-feedback', inputActions: { setDraft: (value) => { draft = value; } },
      getInputSnapshot: () => ({ phase: inputPhase, draft }),
      attachImages: async () => [{ id: 'preview-test', previewUrl: 'blob:preview-test' }],
      removeImage: (_session, image) => { removed.push(image.id); },
    };
    document.addEventListener('dsh:data-cleaning-workbench-prepare', event => {
      event.preventDefault();
      event.detail.resolve({ commandId: 'dci-test', state: 'prepared',
        prompt: loaded.exports.__testing.buildTaskPrompt(event.detail.config) });
    });
    const renderPrompt = () => { cursor = 0; effects.length = 0; return prompt.component(props); };
    let tree = renderPrompt();
    const file = { name: '截图.png', type: 'image/png', size: 8, arrayBuffer: async () => new Uint8Array([137,80,78,71,13,10,26,10]).buffer };
    if (intake === 'wizard-text-paste') {
      findNode(tree, (n) => n.props?.['aria-label'] === '打开提示词生成').props.onClick();
      tree = renderPrompt();
    }
    if (intake === 'workbench-image') {
      const cleanup = effects.map((effect) => effect());
      try {
        assert.equal(loaded.exports.__testing.requestPromptImage('other-session', file), false);
        assert.equal(loaded.exports.__testing.requestPromptImage('image-feedback', file), true);
        await new Promise((resolve) => setImmediate(resolve));
      } finally { for (const stop of cleanup) if (typeof stop === 'function') stop(); }
    } else if (intake === 'clipboard-items' || intake === 'wizard-text-paste') {
      const cleanup = effects.map((effect) => effect());
      let prevented = false;
      try {
        window.dispatchEvent({ type: 'paste', clipboardData: { files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
          target: { closest: (selector) => selector === '.dcAgentWorkbenchContent' ? null : ({}) }, preventDefault: () => { prevented = true; }, stopImmediatePropagation() {} });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(prevented, true);
      } finally { for (const stop of cleanup) if (typeof stop === 'function') stop(); }
    } else {
      findNode(tree, (n) => n.props?.['aria-label'] === '打开提示词生成').props.onClick();
      tree = renderPrompt();
      findNode(tree, (n) => n.props?.role === 'tab' && n.children?.includes('上传图片识别')).props.onClick();
      tree = renderPrompt();
      await findNode(tree, (n) => n.type === 'input' && n.props?.type === 'file').props.onChange({ target: { files: [file], value: '' } });
    }
    tree = renderPrompt();
    assert.ok(findNode(tree, (n) => n.type === 'img' && n.props?.src?.startsWith('data:image/png;base64,')));
    assert.ok(findNode(tree, (n) => n.props?.role === 'status' && n.children?.some((child) => String(child).includes('图片已载入'))));
    assert.deepEqual(removed, [], '连接缺失不能移除缩略图');
    for (let step = 1; step <= 3; step++) {
      findNode(tree, (n) => n.type === 'button' && n.children?.includes('下一步')).props.onClick();
      tree = renderPrompt();
      assert.ok(findNode(tree, (n) => n.props?.['aria-current'] === 'step' && n.props?.key === String(step + 1)));
    }
    inputPhase = 'submitting';
    findNode(tree, (n) => n.type === 'button' && n.children?.includes('回填到对话框')).props.onClick();
    assert.equal(draft, '', '输入机提交中不得回填或释放附件');
    assert.deepEqual(removed, []);
    tree = renderPrompt();
    assert.ok(findNode(tree, (n) => n.children?.some((child) => typeof child === 'string' && child.includes('当前对话正在提交'))));
    inputPhase = 'idle';
    await findNode(tree, (n) => n.type === 'button' && n.children?.includes('回填到对话框')).props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(draft, /dci-test/);
    assert.match(draft, /补全/);
    assert.deepEqual(removed, ['preview-test'], '只在回填时释放模型附件');
    tree = renderPrompt();
    findNode(tree, (n) => n.props?.['aria-label'] === '打开提示词生成').props.onClick();
    tree = renderPrompt();
    assert.ok(findNode(tree, (n) => n.type === 'img' && n.props?.src?.startsWith('data:image/png;base64,')), '重新打开向导保留独立缩略图');
    assert.ok(findNode(tree, (n) => n.props?.['aria-label'] === '放大查看 截图.png'));
    assert.equal(findNode(tree, (n) => n.type === 'input' && n.props?.type === 'file'), null, '已选图片不显示未选择文件');
    assert.equal(requests.length, 1, '选图与回填只暂存一次，不执行 OCR');
  } finally { globalThis.fetch = previousFetch; cleanupGlobals(); }
});

test('图片路径不能作为企业名单回填，正常公司名称不受影响', () => {
  try {
    const loaded = loadClient();
    const { isImagePathEntry } = loaded.exports.__testing;
    for (const path of ['/private/var/tmp/modlens-dsh-paste/p-123/paste.png', '/Users/qcc/Downloads/截图.jpeg',
      'file:///Users/qcc/Downloads/image.webp', 'C:\\Users\\qcc\\image.png']) assert.equal(isImagePathEntry(path), true, path);
    assert.equal(isImagePathEntry('深圳奥雅设计股份有限公司'), false);
    assert.equal(isImagePathEntry('91110108MA01LUR06B'), false);
    const react = loaded.requireShim('react');
    const states = [];
    let cursor = 0;
    react.useState = (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    };
    let prompt;
    loaded.exports.apply({ effect: () => () => {}, slots: {
      inject: (name, cb) => { if (name === 'conversation.input.overlay') prompt = cb(); return () => {}; },
      register: (options, component) => ({ options, component }),
    } });
    loaded.exports.__testing.markCleaningSession('path-guard');
    const draw = () => {
      cursor = 0;
      return prompt.component({ sessionId: 'path-guard', inputActions: { setDraft: () => assert.fail('路径不得回填') } });
    };
    let tree = draw();
    findNode(tree, (n) => n.props?.['aria-label'] === '打开提示词生成').props.onClick();
    tree = draw();
    findNode(tree, (n) => n.type === 'textarea').props.onChange({ target: { value: '/private/tmp/paste.png' } });
    tree = draw();
    findNode(tree, (n) => n.children?.includes('下一步')).props.onClick();
    tree = draw();
    assert.ok(findNode(tree, (n) => n.children?.some((child) => typeof child === 'string' && child.includes('检测到图片文件路径'))));
    assert.ok(findNode(tree, (n) => n.props?.['aria-current'] === 'step' && n.props?.key === '1'));
  } finally { cleanupGlobals(); }
});

test('工作台图片文件转交同会话向导，接收失败保留工作台', async () => {
  const previousFetch = globalThis.fetch;
  try {
    const loaded = loadClient();
    let overlay = contentFixture(loaded.exports);
    loaded.exports.apply({ effect: () => () => {}, slots: {
      inject: (name, cb) => { if (name === 'shell.overlay') overlay = cb(); return () => {}; },
      register: (options, component) => ({ options, component }),
    } });
    const store = overlay.options.store.create();
    store.actions.setActiveSession('drawer-image');
    store.actions.open();
    globalThis.fetch = () => assert.fail('图片不能进入表格 API');
    const draw = () => flattenElement(render(overlay.component, {}, store));
    let tree = draw();
    let picker = findNode(tree, (n) => n.props?.['aria-label'] === '选择数据文件');
    assert.match(picker.props.accept, /image\/png/);
    const file = { name: '名单.png', type: 'image/png' };
    await picker.props.onChange({ target: { files: [file], value: '' } });
    assert.equal(store.getSnapshot().open, true, '没有同会话向导时不能静默关闭');
    let received;
    document.addEventListener('dsh:data-cleaning-prompt-image', (event) => {
      received = event.detail;
      event.preventDefault();
    });
    tree = draw();
    picker = findNode(tree, (n) => n.props?.['aria-label'] === '选择数据文件');
    await picker.props.onChange({ target: { files: [file], value: '' } });
    assert.equal(received.sessionId, 'drawer-image');
    assert.equal(received.file, file);
    assert.equal(store.getSnapshot().open, false);
  } finally { globalThis.fetch = previousFetch; cleanupGlobals(); }
});

test('提示词生成器解析出的完整表格通过事件桥进入 root 工作台且不自动拉开右栏', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let overlayReg = sessionFixture(loaded.exports, 'cleaning-excel');
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
    store.actions.open();
    const panel = render(overlayReg.component, {}, store);
    const review = findNode(panel, (n) => n.type === exports.__testing.DatasetReview);
    assert.equal(review.props.rows.length, 2, '工作台传入完整runtime而非展示摘要');
    assert.equal(review.props.expectedCount, 2);
  } finally {
    cleanupGlobals();
  }
});

test('UI 位置契约：菜单挂载在输入框后，向导触发器仍用官方 overlay', () => {
  assert.match(source, /ctx\.slots\.inject\('conversation\.input\.dock'/);
  assert.match(source, /ctx\.slots\.inject\('conversation\.input\.overlay'/);
  assert.doesNotMatch(source, /ctx\.slots\.inject\('conversation\.input\.left'/);
  assert.match(source, /parent.insertBefore\(mount, branch.nextSibling\)/);
  assert.doesNotMatch(source, /order: 20;/);
  assert.match(source, /\[data-composer-card\]:has\(\.dcAgentPromptTrigger\)/);
  assert.match(source, /rewriteHeroChrome/);
});

test('菜单 DOM Bridge：嵌套槽位只追加自身容器，幂等且卸载恢复', () => {
  const previousObserver = globalThis.MutationObserver;
  try {
    const { exports } = loadClient();
    class Element {
      children = [];
      parentElement = null;
      append(node) { node.remove(); node.parentElement = this; this.children.push(node); }
      remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
        this.parentElement = null;
      }
      contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
      get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
      insertBefore(node, before) {
        node.remove(); node.parentElement = this;
        const index = this.children.indexOf(before);
        this.children.splice(index < 0 ? this.children.length : index, 0, node);
      }
    }
    const seat = new Element(), stack = new Element(), shared = new Element(), wrapper = new Element();
    const marker = new Element(), foreign = new Element(), input = new Element(), card = new Element();
    seat.append(stack); stack.append(shared); shared.append(wrapper); wrapper.append(marker); shared.append(foreign);
    stack.append(input); input.append(card);
    seat.querySelector = () => card;
    marker.closest = () => seat;
    document.createElement = () => new Element();
    let sync, disconnected = false, mount;
    globalThis.MutationObserver = class {
      constructor(callback) { sync = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    };
    const dispose = exports.__testing.installCapabilityMount(marker, (value) => { mount = value; });
    assert.deepEqual(stack.children, [shared, input, mount]);
    sync(); sync();
    assert.equal(stack.children.length, 3);
    assert.deepEqual(shared.children, [wrapper, foreign]);
    dispose();
    assert.ok(disconnected);
    assert.deepEqual(stack.children, [shared, input]);
    assert.ok(shared.contains(marker));
  } finally { globalThis.MutationObserver = previousObserver; cleanupGlobals(); }
});

test('流程导航拒绝跳过导入、规则与匹配，历史制品无需重新上传即可下载', () => {
  try {
    const { exports } = loadClient();
    const issue = exports.__testing.workflowNavigationIssue;
    assert.equal(issue('history', null, false), null);
    assert.match(issue('match', null, false), /载入并核对/);
    assert.match(issue('match', { state: 'uploaded' }, true), /确认字段映射/);
    assert.match(issue('match', { state: 'rules_confirmed' }, true), /生成质量体检/);
    assert.equal(issue('match', { state: 'diagnosed' }, true), null);
    assert.match(issue('enrich', { state: 'diagnosed', fieldSelection: ['credit_no'] }, true), /确认企业/);
    assert.equal(issue('enrich', { state: 'diagnosed', fieldSelection: [] }, true), null);
    assert.equal(issue('enrich', { state: 'diagnosed', objectives: ['deduplicate'], fieldSelection: ['credit_no'] }, true), null, '本地清洗不能因保留默认字段选择被错误阻断');
    assert.match(issue('enrich', { state: 'diagnosed', objectives: ['validate_identity'], fieldSelection: [] }, true), /确认企业/);
    assert.equal(issue('download', { artifacts: [{ id: 'saved' }] }, false), null);
    assert.match(issue('download', { state: 'matched' }, true), /先完成/);
    const local = { state: 'diagnosed', objectives: ['deduplicate'] };
    assert.equal(issue('download', local, true, {}, null, true), null);
    assert.match(issue('download', local, true, {}, null, false), /先完成/);
    assert.match(issue('download', { ...local, objectives: ['complete_fields'] }, true, {}, null, true), /先完成/);
    assert.equal(issue('download', { state: 'export_ready' }, true), null);
  } finally { cleanupGlobals(); }
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
    const url = '/data-cleaning/api/workflow/tasks/dcw-test/artifacts/a-test';
    const qccCard = byKey.get('data_cleaning_qcc_run')({ toolName: 'data_cleaning_qcc_run',
      block: { kind: 'result', content: [{ type: 'text', text: '[预览](' + url + '?preview=1) [下载](' + url + ') [恶意](javascript:alert)' }] } });
    assert.equal(findNode(qccCard, node => node.type === 'a' && node.props.href === url)?.children[0], '下载');
    assert.equal(findNode(qccCard, node => node.type === 'a' && node.props.href === url + '?preview=1')?.props.target, '_blank');
    assert.equal(findNode(qccCard, node => node.type === 'a' && node.props.href.startsWith('javascript:')), null);

    const store = (() => {
      // 复用 overlay store：footer/overlay 共用一个 defineStore 句柄。
      const overlay = contentFixture(exports);
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

test('工作台 header 仅保留标题和控制按钮，状态集中在进度卡', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;

    let overlayReg = contentFixture(loaded.exports);
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
    assert.ok(!pill, 'header 不重复展示状态');

    // 有运行中任务：running + 「运行中」。
    instance.actions.setJobs([{ id: 'unrelated', state: 'completed' }]);
    instance.actions.setWorkflowTask({ id: 'dcw-current', state: 'matching', source: { rowCount: 28, type: 'xlsx' }, fieldSelection: [] });
    panel = flattenElement(render(overlayReg.component, {}, instance));
    pill = findNode(panel, (n) => n.props && n.props.className === 'dcAgentJobsPill');
    assert.ok(!pill);
    const header = findNode(panel, n => n.props?.className === 'dcAgentWbHeader');
    assert.ok(!JSON.stringify(header).includes('dcw-current'));
    assert.ok(!JSON.stringify(header).includes('dcAgentQccBadge'));
    assert.ok(JSON.stringify(panel).includes('匹配中'), '进度区保留真实任务状态');
    assert.ok(!JSON.stringify(panel).includes('已补全 undefined'));
    instance.actions.setWorkflowTask({ id: 'dcw-current', state: 'completed', revision: 5, source: {rowCount:28} });
    assert.equal(instance.getSnapshot().workflowTasks[0].state,'completed');
    instance.actions.setWorkflowTasks([{id:'dcw-current',state:'diagnosed',revision:2}]);
    assert.equal(instance.getSnapshot().workflowTasks[0].state,'completed');
  } finally {
    cleanupGlobals();
  }
});

test('Session Tab 内容：五步导航，无容器控制和中央让位', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;

    let overlayReg = contentFixture(loaded.exports);
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

    assert.ok(render(component, {}, instance), '内容挂载由 Host Tab 管理');

    instance.actions.open();
    const panel = flattenElement(render(component, {}, instance));
    const drawer = findNode(panel, n => n.props?.className === 'dcAgentWorkbenchContent');
    assert.ok(drawer);
    assert.equal(drawer.props['aria-label'], '数据清洗补全工作台');
    assert.doesNotMatch(source, /dc-agent-workbench-reserve|installWorkbenchSizing|preferredWidth|toggleExpanded|shell\.overlay/);
    // 五步核心工作流；质量体检和历史是横向能力。
    const stepButtons = [];
    collectNodes(panel, (n) => n.props && n.props['aria-label'] && ['导入与核验', '规则与体检', '主体匹配', '字段补全', '结果下载'].includes(n.props['aria-label']), stepButtons);
    assert.equal(stepButtons.length, 5, '必须渲染五步 stepper');
    assert.equal(findNode(panel, n => n.props?.role === 'separator'), null);
    assert.equal(stepButtons.filter(button => button.props['aria-current'] === 'step').length, 1);
    for (const button of stepButtons) {
      const children = button.children.flat(Infinity);
      assert.equal(children.length, 2, '阶段仅展示图标和短标题，无序号、描述或状态');
      assert.equal(children[0].props.className, 'dcAgentStepIcon');
      assert.equal(children[1].props.className, 'dcAgentStepLabel');
      assert.equal(children[1].children[0], button.props['aria-label']);
      assert.equal(button.props.title, button.props['aria-label'], '截断时仍能读取完整标题');
      const icon = findNode(expandElementTree(children[0]), n => n.type === 'svg');
      assert.ok(icon, '每个阶段都有线性 SVG 图标');
      assert.equal(icon.props['aria-hidden'], true);
      assert.ok(findNode(icon, n => n.type === 'path').props.d);
    }

    // 顶部移除技术状态徽章；计费确认逻辑不受展示精简影响。
    const qccBadge = findNode(panel, (n) => n.props && n.props.title === '仅在当前用户确认使用自己的企查查账号后调用');
    assert.ok(!qccBadge, '顶部不显示冗余 QCC 状态位');

    assert.equal(findNode(panel, n => n.props?.['aria-label'] === '展开工作台'), null);
    assert.equal(findNode(panel, n => n.props?.['aria-label'] === '关闭'), null);
  } finally {
    cleanupGlobals();
  }
});

test('工作台关闭态 guard 位于所有 store hooks 之后，避免 React #310', () => {
  const componentStart = source.indexOf('function WorkbenchContent(props)');
  const componentEnd = source.indexOf('function apply(ctx)', componentStart);
  const componentSource = source.slice(componentStart, componentEnd);
  const guardIndex = componentSource.indexOf('if (!open) return null;');
  const lastStoreHookIndex = componentSource.indexOf('const activeSessionId = useStore((state) => state.activeSessionId);');

  assert.ok(componentStart >= 0 && componentEnd > componentStart, '必须定位到 WorkbenchContent');
  assert.ok(lastStoreHookIndex >= 0, '必须定位到最后一个 store hook');
  assert.equal(guardIndex, -1, 'Tab 关闭由 Host 卸载，内容不得再按私有 open flag 隐藏');
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

test('字段搜索支持维度、中文字段及工具名，不改变原始目录', () => {
  try {
    const { visibleCatalogFields, DatabaseLogo } = loadClient().exports.__testing;
    const fields = Object.freeze([Object.freeze(['credit_no', '统一社会信用代码']), Object.freeze(['national_industry', '国标行业'])]);
    const group = Object.freeze(['registration', '企业工商信息', fields, 'get_company_registration_info']);
    assert.equal(visibleCatalogFields(group, ''), fields);
    assert.equal(visibleCatalogFields(group, ' 工商 '), fields);
    assert.equal(visibleCatalogFields(group, 'GET_COMPANY_REGISTRATION'), fields);
    assert.deepEqual(visibleCatalogFields(group, '行业'), [fields[1]]);
    assert.deepEqual(visibleCatalogFields(group, 'CREDIT_NO'), [fields[0]]);
    assert.deepEqual(visibleCatalogFields(group, '不存在'), []);
    assert.equal(fields.length, 2);
    const logo = DatabaseLogo({ size: 26 });
    assert.equal(logo.type, 'svg');
    assert.equal(logo.props.width, 26);
    assert.equal(logo.props['aria-hidden'], true);
    assert.equal(logo.props.stroke, 'currentColor');
  } finally { cleanupGlobals(); }
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

test('导入状态以完整数据集为准，不以原生文件选择框或粘贴框是否为空判断', () => {
  try {
    const { intakeState } = loadClient().exports.__testing;
    const dataset = { rowCount: 23 };
    const rows = Array.from({ length: 23 }, () => ({ 企业名称: '合成企业' }));
    assert.deepEqual(intakeState(dataset, rows, '', { fileName: '测试名单.xlsx' }), { available: true, pendingText: false, fileName: '测试名单.xlsx', count: 23 });
    assert.equal(intakeState(dataset, rows, '新企业', {}).pendingText, true);
    assert.equal(intakeState(dataset, [], '', {}).available, false, '仅恢复元数据不能冒充已恢复全部明细');
    assert.equal(intakeState(dataset, rows.slice(0, 5), '', {}).available, false);
    assert.equal(intakeState(null, [], '', {}).available, false);
  } finally { cleanupGlobals(); }
});

test('上传解析进入 taskId runtime，字段映射在规则确认页完成', () => {
  const applyParsedStart = source.indexOf('function applyParsed(result, actions, taskId');
  const applyParsedEnd = source.indexOf('function WorkbenchContent', applyParsedStart);
  const applyParsedSource = source.slice(applyParsedStart, applyParsedEnd);
  assert.doesNotMatch(applyParsedSource, /setStep\('profile'\)/, '解析后必须留在上传映射页供用户确认字段');
  assert.match(applyParsedSource, /runtimeFor\(taskId\)/);
  assert.match(source, /actions\.setStep\('rules'\)/);
  assert.match(source, /const \[intakeEditorOpen, setIntakeEditorOpen\] = react\.useState\(\(\) => dataset == null\)/);
  assert.match(source, /const showIntakeEditor = !dataset \|\| intakeEditorOpen/);
  assert.match(source, /setIntakeEditorOpen\(dataset == null\)/, '成功导入后必须收起来源输入，数据缺失时重新展开');
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

test('T3 匹配核验页直接生成说明，不依赖手动检测估算或额度勾选', () => {
  let loaded;
  try {
    loaded = loadClient();
    const { exports } = loaded;
    let overlayReg = contentFixture(loaded.exports);
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
    instance.actions.setDataset({ rowCount: 1, headers: ['name'], preview: [] });
    instance.actions.setWorkflowTask({ id: 'dcw-match-test', state: 'diagnosed' });
    let panel = flattenElement(render(overlayReg.component, {}, instance));

    assert.ok(findNode(panel, (n) => n.children && n.children.includes('准备任务说明')));
    assert.equal(findNode(panel, (n) => n.children && n.children.includes('估算调用量')), null);
    assert.equal(findNode(panel, (n) => n.children && n.children.includes('检测企查查连接')), null);
    const generate = findNode(panel, (n) => n.children && n.children.includes('生成可编辑任务说明'));
    assert.ok(generate);
    assert.equal(Boolean(generate.props.disabled), false, '不需要先生成估算或勾选即可生成草稿');

    instance.actions.setQccEstimate({ uniqueCompanies: 1, tools: ['a'], estimatedCalls: 2, maxCalls: 500, withinLimit: true });
    panel = flattenElement(render(overlayReg.component, {}, instance));
    const confirm = findNode(panel, (n) => n.props && n.props['aria-label'] === '确认使用当前用户的企查查账号额度');
    assert.equal(confirm, null, '草稿阶段不要求确认实际查询');
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

test('规则页展示 40/58 两批字段并支持按工具维度全选与清空', () => {
  let loaded;
  try {
    loaded = loadClient();
    let overlayReg = contentFixture(loaded.exports);
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
    instance.actions.setStep('rules');
    instance.actions.setDataset({ rowCount: 1, headers: ['name'], preview: [] });
    const panel = flattenElement(render(overlayReg.component, {}, instance));
    assert.ok(findNode(panel, (n) => n.children && n.children.includes('第一批 40')));
    assert.ok(findNode(panel, (n) => n.children && n.children.includes('第二批 58')));
    const selectAllButtons = [];
    collectNodes(panel, (n) => n.type === 'button' && n.children?.includes('全选'), selectAllButtons);
    const clearButtons = [];
    collectNodes(panel, (n) => n.type === 'button' && n.children?.includes('清空'), clearButtons);
    assert.equal(selectAllButtons.length, 11);
    assert.equal(clearButtons.length, 11);
  } finally {
    cleanupGlobals();
  }
});

test('T8 下载页使用 Host 耐久 CSV/XLSX 制品并支持最近任务 taskId 恢复', () => {
  let loaded;
  try {
    loaded = loadClient();
    let overlayReg = contentFixture(loaded.exports);
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
        { id: 'dca-test-report', kind: 'report', format: 'xlsx', fileName: '任务结果报告.xlsx', rowCount: 2 },
        { id: 'dca-test-review', kind: 'review', format: 'csv', fileName: '异常.csv', rowCount: 1 },
      ],
    });
    const panel = flattenElement(render(overlayReg.component, {}, instance));
    assert.ok(findNode(panel, (node) => node.props?.['aria-label'] === '下载 结果.xlsx'));
    assert.ok(findNode(panel, (node) => node.children?.includes('下载清洗补全结果 XLSX · 2 行')));
    assert.ok(!findNode(panel, (node) => node.children?.includes('异常清单 CSV · 1 行')));
    const summary = findNode(panel, node => node.props?.className === 'dcAgentResultSummary');
    const reportLink = findNode(summary, node => node.type === 'a' && node.children?.includes('下载任务结果报告'));
    assert.equal(reportLink?.props.href, '/data-cleaning/api/workflow/tasks/dcw-test-artifacts/artifacts/dca-test-report');
    assert.equal(reportLink.props.download, '任务结果报告.xlsx');
    const resultList = findNode(panel, node => node.props?.className === 'dcAgentArtifactList');
    assert.ok(!findNode(resultList, node => node.props?.href?.includes('dca-test-report')), '报告不占结果预览栏');
    assert.ok(!findNode(resultList, node => node.children?.includes('任务结果报告.xlsx')));
    const fileCard = findNode(panel, node => node.props?.className === 'dcAgentCard'
      && findNode(node, child => child.props?.['aria-label'] === '下载 结果.xlsx'));
    assert.ok(findNode(fileCard, node => node.type === 'a' && node.children?.includes('预览 / 打开')), '同一文件的预览和下载在同一卡片');
    const recoveredEnriched = findNode(panel, (node) => node.props?.className === 'dcAgentCard'
      && findNode(node, (child) => child.children?.includes('匹配补全')));
    const recoveredReview = findNode(panel, (node) => node.props?.className === 'dcAgentCard'
      && findNode(node, (child) => child.children?.includes('待核验')));
    assert.ok(findNode(recoveredEnriched, (node) => node.type === 'b' && node.children?.includes(2)), '重启恢复后应显示 Host 持久化补全计数');
    assert.ok(findNode(recoveredReview, (node) => node.type === 'b' && node.children?.includes(1)), '重启恢复后应显示 Host 持久化待核验计数');
    assert.match(source, /resumeWorkflowTask\(task\)/);
    assert.match(source, /detail\.task\?\.id/);
    assert.match(source, /\/artifacts\/\$\{encodeURIComponent\(artifact\.id\)\}/);
    assert.doesNotMatch(source, /browser-download:/, '不得继续登记不可恢复的浏览器伪制品引用');
  } finally {
    cleanupGlobals();
  }
});
test('独立清洗会话在刷新及切换回来后恢复归属，保留已生成草稿', () => {
  try {
    const { exports } = loadClient();
    const bridge = exports.__testing;
    const sessionId = 'session-dsh-data-cleaning-agent-12345678-1234-4123-8123-123456789012';
    let current = sessionId, selected, draft = '请执行已在「数据清洗补全工作台」确认的企业数据任务。安全任务凭证：dcq-test data_cleaning_qcc_run';
    const ctx = {
      sessions: { list: { getSnapshot: () => ({ current }), subscribe: fn => { selected = fn; return () => {}; } } },
      get: () => ({ input: { shell: id => ({ snapshot: { draft: id === sessionId ? draft : '' }, setDraft: text => { if (id === sessionId) draft = text; } }) } }),
    };
    const release = bridge.installSessionOwnershipBridge(ctx);
    assert.equal(bridge.isCleaningSession(sessionId), true);
    const original = draft;
    current = 'other-agent'; selected();
    assert.equal(bridge.isCleaningSession(sessionId), false);
    assert.equal(draft, original);
    current = sessionId; selected();
    assert.equal(bridge.isCleaningSession(sessionId), true);
    assert.equal(draft, original);
    release();
  } finally { cleanupGlobals(); }
});

test('点击已选清洗会话的侧栏入口只重开工作台，不创建新会话或覆盖草稿', async () => {
  try {
    const { exports } = loadClient();
    const current = 'session-dsh-data-cleaning-agent-12345678-1234-4123-8123-123456789012';
    let entry, opened = 0;
    document.addEventListener('dsh:data-cleaning-workbench-open', event => {
      assert.equal(event.detail.sessionId, current); opened++; event.preventDefault();
    });
    exports.apply({
      effect: () => () => {},
      workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
      sessions: { list: { getSnapshot: () => ({ current }) }, create: () => { throw new Error('must not create'); } },
      get: () => { throw new Error('must not overwrite draft'); },
      slots: {
        inject: (name, cb) => { if (name === 'sidebar.footer.action') entry = cb(); },
        register: (options, component) => ({ options, component }),
      },
    });
    assert.equal(await entry.options.inject().startSession(), current);
    assert.equal(opened, 1);
  } finally { cleanupGlobals(); }
});

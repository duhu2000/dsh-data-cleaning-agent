/**
 * M1 · client 半区入口契约测试。
 *
 * 浏览器 provider 在本环境不可用（与 spike2 相同），故用 Node shim 忠实复刻
 * web shell 的静态模块表，验证 `lib/client.js` 的 factory 物化、服务注入与
 * 槽位注册全部正确——这正是 M1 在真实浏览器里渲染「🧹 数据清洗」入口的
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
  const windowShim = {
    __ModuleLoader__: { load: (reg) => { registration = reg; } },
    location: { origin: 'http://127.0.0.1:43140' },
  };
  globalThis.window = windowShim;
  globalThis.document = makeDocument();

  const requireTable = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props, jsx: true }) },
    react: { createElement: (type, props, ...children) => ({ type, props, children }) },
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

test('apply() 注册 shell.overlay(order 200) 与 sidebar.footer.action(order 10)', () => {
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
    assert.equal(footer.options.order, 10, 'order 10 → 排在 MCP连接器 order 0 下方');

    assert.ok(footer.options.store && typeof footer.options.store.create === 'function', 'store 为 defineStore 句柄');
    assert.equal(typeof overlay.component, 'function');
    assert.equal(typeof footer.component, 'function');
  } finally {
    cleanupGlobals();
  }
});

test('入口按钮：wide 显示「🧹 数据清洗」，点击调用 actions.open', () => {
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

    const wideEl = flattenElement(render(component, { wide: true }, instance));
    assert.equal(wideEl.type, 'Button');
    assert.equal(wideEl.props['aria-label'], '数据清洗');
    assert.equal(wideEl.props['aria-haspopup'], 'dialog');
    assert.equal(wideEl.props['aria-expanded'], false);
    assert.deepEqual(wideEl.children, ['🧹 数据清洗']);

    wideEl.props.onClick();
    assert.equal(instance.getSnapshot().open, true);

    const narrowEl = flattenElement(render(component, { wide: false }, instance));
    assert.deepEqual(narrowEl.children, ['🧹']);
    assert.equal(narrowEl.props['aria-expanded'], true);
  } finally {
    cleanupGlobals();
  }
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

test('工作台：关闭返回 null，打开渲染 Mockup 四步 stepper + QCC 安全状态，关闭按钮调用 actions.close', () => {
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
    assert.equal(panel.props.role, 'dialog');
    assert.equal(panel.props['aria-modal'], 'true');
    assert.equal(panel.props['aria-label'], '数据清洗');

    // 四步 stepper：上传与映射 / 数据体检 / 匹配核验 / 补全与导出（对齐原始 Mockup）。
    const stepButtons = [];
    collectNodes(panel, (n) => n.props && n.props['aria-label'] && ['上传与映射', '数据体检', '匹配核验', '补全与导出'].includes(n.props['aria-label']), stepButtons);
    assert.equal(stepButtons.length, 4, '必须渲染四步 stepper');

    // 未确认计费前只显示待检测，不触发调用。
    const qccBadge = findNode(panel, (n) => n.props && n.props.title === '仅在明确确认后发起计费调用');
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

test('P1.4 匹配核验页提供三域选择、调用估算和显式付费确认门', () => {
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
    instance.actions.setStep('review');
    let panel = flattenElement(render(overlayReg.component, {}, instance));

    for (const label of ['风险信息 · 38', '知识产权 · 18', '经营信息 · 35']) {
      assert.ok(findNode(panel, (n) => n.props && n.props['aria-label'] === label), `缺少域选择：${label}`);
    }
    assert.ok(findNode(panel, (n) => n.children && n.children.includes('估算调用量')), '必须先估算调用量');

    instance.actions.toggleDomain('risk');
    assert.deepEqual(instance.getSnapshot().selectedDomains, ['risk']);
    instance.actions.setQccEstimate({ uniqueCompanies: 1, tools: ['a'], estimatedCalls: 2, maxCalls: 500, withinLimit: true });
    panel = flattenElement(render(overlayReg.component, {}, instance));
    const confirm = findNode(panel, (n) => n.props && n.props['aria-label'] === '确认企查查付费调用');
    assert.ok(confirm, '估算后必须显示独立付费确认复选框');
    assert.equal(confirm.props.checked, false);
  } finally {
    cleanupGlobals();
  }
});

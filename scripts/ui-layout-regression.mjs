// Isolated real-React/Chromium fixture. No live DSH session or QCC requests.
// DCQ_UI_DEPS points to a node_modules containing react/react-dom/esbuild.
// DCQ_PLAYWRIGHT points to the playwright package directory.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const deps = resolve(process.env.DCQ_UI_DEPS || 'node_modules');
const { build } = await import(pathToFileURL(join(deps, 'esbuild/lib/main.js')));
const { chromium } = await import(pathToFileURL(join(resolve(process.env.DCQ_PLAYWRIGHT || join(deps, 'playwright')), 'index.mjs')));
const bundled = await build({ stdin: { contents: `
  import * as React from 'react'; import * as DOM from 'react-dom';
  import {createRoot} from 'react-dom/client';
  window.React=React; window.ReactDOM=DOM; window.createRoot=createRoot;`,
  resolveDir: resolve(deps, '..') }, bundle: true, write: false, format: 'iife' });
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const out = resolve('_scratch/ui-layout');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.DCQ_CHROME ? { executablePath: process.env.DCQ_CHROME } : {}) });
const results = [];
try {
  for (const colorScheme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [1024, 768], [390, 700], [320, 700], [900, 500]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Real origin for relative fetch; all traffic fulfilled locally, no live DSH/QCC.
    let fixtureTask = null;
    let parseCalls = 0;
    let oldHost = false;
    let fixtureCommand = null;
    const unexpectedRequests = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== 'dcq-ui.test') { unexpectedRequests.push(request.url()); return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
      if (url.pathname === '/data-cleaning/api/g5/capabilities') return route.fulfill({ json: oldHost ? { paidCallConfirmationRequired: true } : { workflowExecutionVersion: 1 } });
      const base = '/data-cleaning/api/workflow/tasks';
      if (url.pathname === '/data-cleaning/api/g5/commands' && request.method() === 'POST') {
        const input = request.postDataJSON();
        assert.equal(input.workflowOwned, true);
        assert.equal(input.expectedRevision, fixtureTask.revision);
        assert.deepEqual(input.fieldSelection, fixtureTask.fieldSelection);
        fixtureCommand = { commandId: 'dcq-ui-fixture', taskId: fixtureTask.id, state: 'prepared', prompt: '请执行已在「数据清洗补全工作台」确认的企业数据任务。安全任务凭证：dcq-ui-fixture。调用 data_cleaning_qcc_run，生成新的 XLSX。' };
        return route.fulfill({ json: { command: fixtureCommand } });
      }
      if (url.pathname === '/data-cleaning/api/g5/commands/dcq-ui-fixture') return route.fulfill({ json: { command: fixtureCommand } });
      if (url.pathname === base + '/dcw-ui-fixture' && request.method() === 'GET') return route.fulfill({ json: { task: fixtureTask } });
      if (url.pathname === '/data-cleaning/api/mvp/parse') {
        parseCalls++;
        const data = request.postDataJSON();
        if (data.filename === 'broken.xlsx') return route.fulfill({ json: { ok: false, message: '测试文件无法解析' } });
        if (data.filename === 'bank-template.xlsx') {
          const headers = ['公司名称','统一社会信用代码','注册号','企业类型','经营范围','注册资本','核准日期 YYYY-MM-DD','法定代表人','成立日期','企业状态','所属省份','所属市','所属区县','所属行业','注册地址','企业划型','主营业务','法定代表人（重复列 2）','邮编','主营业务收入','注册资本（重复列 2）','从业人数','实际控制人'];
          const rows = [Object.fromEntries(headers.map((key, i) => [key, i === 0 ? '合成测试企业' : '']))];
          return route.fulfill({ json: { ok: true, fmt: 'xlsx', headers, rows, preview: rows, rowCount: 1 } });
        }
        assert.equal(Buffer.from(data.content, 'base64').toString(), 'synthetic-xlsx-fixture');
        const rows = Array.from({ length: 23 }, (_, i) => ({ 企业名称: `合成企业${i + 1}` }));
        return route.fulfill({ json: { ok: true, fmt: 'xlsx', headers: ['企业名称'], rowCount: 23, rows, preview: rows.slice(0, 5) } });
      }
      if (url.pathname === base && request.method() === 'GET') return route.fulfill({ json: { tasks: fixtureTask ? [fixtureTask] : [] } });
      if (url.pathname.startsWith(base) && ['POST', 'PATCH'].includes(request.method())) {
        const data = request.postDataJSON() || {};
        fixtureTask = { id: 'dcw-ui-fixture', state: 'draft', stage: 'upload', artifacts: [], ...fixtureTask, ...data, revision: (fixtureTask?.revision || 0) + 1 };
        if (url.pathname.endsWith('/actions/upload')) fixtureTask.state = 'uploaded';
        if (url.pathname.endsWith('/actions/rules')) fixtureTask.state = 'rules_confirmed';
        if (url.pathname.endsWith('/actions/quality')) { fixtureTask.state = 'diagnosed'; fixtureTask.stage = 'match'; }
        return route.fulfill({ json: { task: fixtureTask } });
      }
      if (url.pathname === '/data-cleaning/api/workflow/contract') return route.fulfill({ json: { contract: {} } });
      if (url.pathname === '/data-cleaning/api/mvp/jobs') return route.fulfill({ json: { jobs: [] } });
      unexpectedRequests.push(request.url());
      return route.abort();
    });
    await page.goto('http://dcq-ui.test/');
    await page.setContent(`<html style="color-scheme:${colorScheme}"><head><style>
      body { margin:0; font:14px system-ui; background:light-dark(#fff,#161b23); color:light-dark(#172033,#edf2fa) }
      #app { min-height:100vh }
      .fixtureLayout { display:flex; min-width:0 }
      .fixtureConversation { flex:1; min-width:0 }
      .fixtureSidebar { width:min(460px,100vw); height:100vh; flex:none; display:flex; flex-direction:column; border-left:1px solid #8886 }
      .fixtureSidebar[data-open=false] { display:none }
      .fixtureTabBody { flex:1; min-height:0; min-width:0 }
      @media(max-width:760px) { .fixtureLayout { flex-direction:column } .fixtureSidebar { width:100%; } } [data-conversation-scroll] { box-sizing:border-box; padding:24px 12px; min-height:100vh }
      [data-composer-seat] { max-width:800px; margin:0 auto }
      .fixture_composerStack { display:flex; flex-direction:column; gap:8px }
      [data-composer-card] { position:relative; box-sizing:border-box; border:1px solid #8886; border-radius:20px; padding:16px; background:light-dark(#fff,#161b23) }
      #native { width:100%; height:100px; box-sizing:border-box; border:0; resize:none; background:transparent; color:inherit }
      .nativeActions { display:flex; justify-content:space-between } h1 { text-align:center; font-size:24px }
      .fixture_headline { display:grid; grid-template-columns:34px auto auto; justify-content:center; align-items:center; gap:10px; margin:24px 0 }
      .fixture_fishHitbox { grid-area:1/1; display:inline-flex }
      .fixture_headlineText { grid-area:1/2; font-size:26px; font-weight:600 }
      .fixture_previewBadge { grid-area:1/3 }
    </style></head><body><div id="app"></div></body></html>`);
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await page.evaluate(() => { window.__ModuleLoader__ = { load: (registration) => { window.registration = registration; } }; });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      const R = window.React, h = R.createElement;
      const defineStore = (spec) => ({ create() {
        let state = spec.init(); const listeners = new Set();
        const actions = Object.fromEntries(Object.entries(spec.actions).map(([key, fn]) => [key, (...args) => {
          state = { ...state }; fn(state, ...args); listeners.forEach((cb) => cb());
        }]));
        return { actions, getSnapshot: () => state, subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); } };
      } });
      const modules = { react: R, 'react-dom': window.ReactDOM,
        '@deepseek-ai/dsh-client-ui-primitives': {
          Button: (props) => h('button', props),
          IconDownloadOutline16: (props) => h('svg', { ...props, width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true },
            h('path', { d: 'M8 2v8m-3-3 3 3 3-3M3 13h10', fill: 'none', stroke: 'currentColor' })),
        },
        '@deepseek-ai/dsh-client-store': { defineStore } };
      const plugin = window.registration.factory((name) => modules[name]);
      const slots = {};
      const states = new Map(), hostListeners = new Set();
      const descriptors = new Map();
      let activeSession = 'fixture', revision = 0;
      const emit = () => { revision++; hostListeners.forEach(fn => fn()); };
      const stateFor = id => {
        if (!states.has(id)) states.set(id, { tab: null, state: { panelOpen:false, splits: {kind:'leaf',tabs:[]}, floats:[] } });
        return states.get(id);
      };
      const sidebar = {
        features:['targetedOpen','stateSubscription'],
        registerTab(value) { descriptors.set(value.id, value); return () => descriptors.delete(value.id); },
        isTabEnabled: () => true,
        getSnapshot: () => ({sessionId:activeSession, state:stateFor(activeSession).state}),
        subscribeState(fn) { hostListeners.add(fn); return () => hostListeners.delete(fn); },
        openTab(seed,scope) {
          const entry = stateFor(scope.sessionId);
          if (!entry.tab) {
            entry.tab = {id:'tab-' + scope.sessionId, type:seed.type};
            entry.state = {...entry.state, splits:{kind:'leaf',tabs:[entry.tab]}};
          }
          emit();
        },
      };
      window.hostCloseTab = () => { const entry = stateFor(activeSession); entry.tab = null; entry.state = {...entry.state,splits:{kind:'leaf',tabs:[]}}; emit(); };
      window.hostCollapse = () => { const entry = stateFor(activeSession); entry.state = {...entry.state,panelOpen:false}; emit(); };
      window.hostTabCount = () => stateFor(activeSession).tab ? 1 : 0;
      plugin.apply({ conversation:{input:{shell:()=>({setDraft:prompt=>{window.writeDraft?.(prompt);return true;}})}}, sessions:{open:()=>{}},
        inject(deps,callback) {
          if (deps.join() === 'uiWorkspace') return {dispose(){}}; // Provider absent in this layout-only fixture.
          if (deps.join() !== 'betterSidebar') throw new Error('Unexpected optional provider');
          let cleanup;
          callback({betterSidebar:sidebar,effect:fn=>{cleanup=fn();}});
          return {dispose:()=>cleanup?.()};
        },
        effect: (fn) => fn(), slots: {
        inject: (name, fn) => { slots[name] = fn(); },
        register: (options, component) => ({ options, component }),
      } });
      window.plugin = plugin;
      plugin.__testing.markCleaningSession('fixture');
      const store = document[Symbol.for('dsh.data-cleaning.session-workbench')].controller.storeFor('fixture');
      window.store = store;
      const Experience = slots['conversation.input.dock'].component;
      // DSH materializes session slots separately from the root workbench.
      const sessionPlugin = window.registration.factory((name) => modules[name]);
      const sessionSlots = {};
      sessionPlugin.apply({ effect: fn => fn(), slots: {
        inject: (name, fn) => { sessionSlots[name] = fn(); },
        register: (options, component) => ({ options, component }),
      } });
      sessionPlugin.__testing.markCleaningSession('fixture');
      const Prompt = sessionSlots['conversation.input.overlay'].component;
      function HostTab({ sessionId, setDraft }) {
        R.useSyncExternalStore(fn => { hostListeners.add(fn); return () => hostListeners.delete(fn); }, () => revision);
        const entry = stateFor(sessionId);
        const descriptor = descriptors.get(entry.tab?.type);
        if (!entry.tab || !descriptor) return null;
        if (!entry.store) entry.store = { reduce(fn) { entry.state=fn(entry.state); emit(); } };
        return h('aside', {className:'fixtureSidebar','data-open':entry.state.panelOpen},
          h('div', null, 'Host: 数据清洗补全', h('button', {onClick:window.hostCloseTab,'aria-label':'Host 关闭 Tab'}, '×')),
          h('div', {className:'fixtureTabBody'}, h(descriptor.component,{scope:{sessionId},tab:entry.tab,store:entry.store,visible:entry.state.panelOpen})));
      }
      function App({ sessionId = 'fixture', phase = 'blank' }) {
        const [draft, setDraft] = R.useState('');
        window.writeDraft = setDraft;
        return h('div', { className:'fixtureLayout' }, h('div', { 'data-conversation-scroll': '', className:'fixtureConversation' },
          h('div', { 'data-composer-seat': '', 'data-phase': phase === 'blank' ? 'hero' : 'active' },
            h('div', { className: 'fixture_composerStack' },
              h('div', { className: 'fixture_headline' },
                h('span', { className: 'fixture_fishHitbox' }, h('svg', { width: 34, height: 34, 'data-native-logo': true })),
                h('span', { className: 'fixture_headlineText' }, '探索未至之境'),
                h('span', { className: 'fixture_previewBadge' }, '预览版')),
              h('div', { 'data-slot': 'conversation.input.dock' },
                h('div', null, h(Experience, { sessionId, session: { composerPhase: phase } })),
                h('div', { id: 'foreign' }, '其他插件槽位')),
              h('div', { id: 'inputBranch' }, h('div', { 'data-composer-card': true },
                h('textarea', { id: 'native', value: draft, onChange: (event) => setDraft(event.target.value) }),
                h('div', { className: 'nativeActions' }, h('span', null, 'Workspace Write'), h('button', { disabled: !draft }, '发送')),
                h(Prompt, { sessionId, inputActions: { setDraft } })))),
          ),
          ), h(HostTab, { sessionId, setDraft }));
      }
      window.root = window.createRoot(document.getElementById('app'));
      window.show = (sessionId = 'fixture', phase = 'blank') => { activeSession = sessionId; emit(); window.root.render(h(App, { sessionId, phase })); };
      window.show();
    });
    await page.locator('.dcAgentCapabilityMount .dcAgentCapabilities').waitFor();
    const card = await page.locator('[data-composer-card]').boundingBox();
    const menu = await page.locator('.dcAgentCapabilityMount').boundingBox();
    assert.ok(menu.y >= card.y + card.height, 'menu must sit below native composer');
    assert.equal(await page.locator('.dcAgentProductHome').count(), 0);
    await page.locator('.dcAgentHeroLogo').waitFor();
    const logo = await page.locator('.dcAgentHeroLogo').boundingBox();
    const title = await page.locator('[data-dc-agent-hero-title]').boundingBox();
    assert.ok(logo.x + logo.width <= title.x, 'database logo is left of title');
    assert.ok(Math.abs(logo.y + logo.height / 2 - title.y - title.height / 2) < 2, 'logo and name vertically centered in one row');
    assert.equal(await page.locator('.fixture_fishHitbox').isVisible(), false);
    await page.screenshot({ path: join(out, `landing-${colorScheme}-${width}x${height}.png`) });
    await page.getByRole('button', { name: '打开提示词生成' }).click();
    const dialog = page.getByRole('dialog', { name: '数据清洗补全任务生成器' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '3 清洗与补全' }).click();
    assert.equal(await dialog.locator('.dcAgentPromptFieldGrid input[type="checkbox"]').count(), 136);
    const credit = dialog.getByRole('checkbox', { name: '统一社会信用代码', exact: true });
    await credit.uncheck();
    assert.equal(await credit.isChecked(), false);
    await credit.check();
    assert.equal(await credit.isChecked(), true);
    const selectedCount = await dialog.locator('.dcAgentPromptFieldGrid input:checked').count();
    await dialog.getByRole('searchbox', { name: '查找补全字段' }).fill('实控人');
    assert.equal(await dialog.locator('.dcAgentPromptFieldGrid input').count(), 4);
    assert.equal(await dialog.getByRole('checkbox', { name: '实际控制人名称', exact: true }).count(), 1);
    await dialog.getByRole('searchbox', { name: '查找补全字段' }).fill('行业');
    assert.equal(await dialog.locator('.dcAgentPromptFieldGrid input').count(), 3);
    assert.equal(await dialog.getByRole('checkbox', { name: '进出口行业种类', exact: true }).count(), 1);
    await dialog.getByRole('searchbox', { name: '查找补全字段' }).fill('不存在的字段');
    assert.equal(await dialog.locator('.dcAgentPromptFieldGrid input').count(), 0);
    await dialog.getByRole('searchbox', { name: '查找补全字段' }).fill('');
    assert.equal(await dialog.locator('.dcAgentPromptFieldGrid input:checked').count(), selectedCount, 'search preserves all selections');
    assert.equal(await dialog.locator('.dcAgentPromptAction.is-primary').evaluate(el => getComputedStyle(el).backgroundColor), colorScheme === 'light' ? 'rgb(8, 117, 209)' : 'rgb(130, 195, 255)');
    const box = await dialog.boundingBox();
    assert.ok(box.y >= 0 && box.x >= 0 && box.y + box.height <= height + 1 && box.x + box.width <= width + 1);
    const next = await dialog.getByRole('button', { name: '下一步', exact: true }).boundingBox();
    assert.ok(next.y + next.height <= height, 'footer remains visible with all fields');
    assert.ok(await dialog.locator('.dcAgentPromptBody').evaluate((el) => el.scrollHeight > el.clientHeight), 'body scrolls');
    await dialog.getByRole('button', { name: '下一步', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭提示词生成');
    await page.screenshot({ path: join(out, `wizard-${colorScheme}-${width}x${height}.png`) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '打开提示词生成' }).click();
    await dialog.getByRole('button', { name: '1 数据来源' }).click();
    await dialog.locator('textarea').fill('示例企业甲有限公司\n示例企业乙有限公司');
    await dialog.getByRole('button', { name: '下一步', exact: true }).click();
    await dialog.getByRole('button', { name: '下一步', exact: true }).click();
    await dialog.getByRole('button', { name: '下一步', exact: true }).click();
    await dialog.getByRole('button', { name: '回填到对话框' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement.id === 'native');
    assert.ok((await page.locator('#native').inputValue()).includes('示例企业乙有限公司'));
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true);
    const nativeSendStyle = await page.getByRole('button', { name: '发送', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
    await page.getByRole('button', { name: '任务历史', exact: true }).click();
    const drawer = page.getByRole('region', { name: '数据清洗补全工作台' });
    assert.equal(await drawer.getByRole('navigation', { name: '清洗流程' }).count(), 0);
    await drawer.getByRole('button', { name: '当前任务', exact: true }).click();
    assert.equal(await drawer.getByRole('navigation', { name: '清洗流程' }).getByRole('button').count(), 5);
    const stageNav = drawer.getByRole('navigation', { name: '清洗流程' });
    async function assertStageNavigation(mode) {
      const layout = await stageNav.evaluate(nav => {
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const workbench = nav.closest('.dcAgentWorkbenchContent');
        return { nav: rect(nav), scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth,
          workbenchWidth: workbench.clientWidth,
          buttons: Array.from(nav.children, button => {
            const icon = button.querySelector('.dcAgentStepIcon');
            const label = button.querySelector('.dcAgentStepLabel');
            return { ...rect(button), icon: rect(icon), label: rect(label),
              text: button.textContent, name: button.getAttribute('aria-label'),
              labelWhiteSpace: getComputedStyle(label).whiteSpace,
              children: button.children.length, svgCount: icon.querySelectorAll('svg').length,
              separator: getComputedStyle(button).borderRightWidth,
              active: button.getAttribute('aria-current') === 'step',
              underline: getComputedStyle(button, '::after').backgroundColor,
              underlineHeight: getComputedStyle(button, '::after').height };
          }) };
      });
      assert.ok(layout.scrollWidth <= layout.clientWidth, `phase menu must not scroll: ${mode}`);
      assert.equal(layout.buttons.filter(b => b.active).length, 1);
      for (const [index, button] of layout.buttons.entries()) {
        assert.ok(Math.abs(button.width - layout.nav.width / 5) <= 1);
        assert.ok(Math.abs(button.y - layout.buttons[0].y) <= 1, 'single row');
        assert.ok(button.x >= layout.nav.x - 1 && button.x + button.width <= layout.nav.x + layout.nav.width + 1);
        assert.ok(button.icon.y + button.icon.height <= button.label.y, 'icon above label');
        assert.equal(button.text, button.name, 'no descriptions or numeric prefixes');
        assert.equal(button.children, 2);
        assert.equal(button.svgCount, 1);
        assert.equal(button.labelWhiteSpace, layout.workbenchWidth <= 520 ? 'normal' : 'nowrap');
        assert.equal(button.separator, index === 4 ? '0px' : '1px');
        if (button.active) {
          assert.equal(button.underlineHeight, '3px');
          assert.equal(button.underline, colorScheme === 'light' ? 'rgb(8, 117, 209)' : 'rgb(130, 195, 255)');
        }
      }
      // Long future labels truncate or line-clamp inside their cell instead of stretching the grid.
      const stress = await stageNav.evaluate(nav => {
        const label = nav.querySelector('.dcAgentStepLabel');
        const original = label.textContent;
        label.textContent = '超长阶段标题'.repeat(8);
        const result = { ellipsis: getComputedStyle(label).textOverflow,
          whiteSpace: getComputedStyle(label).whiteSpace,
          fits: nav.scrollWidth <= nav.clientWidth,
          truncated: label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight };
        label.textContent = original;
        return result;
      });
      assert.deepEqual(stress, { ellipsis: 'ellipsis', whiteSpace: layout.workbenchWidth <= 520 ? 'normal' : 'nowrap', fits: true, truncated: true });
      await stageNav.screenshot({ path: join(out, `stage-menu-${colorScheme}-${width}x${height}-${mode}.png`) });
    }
    await assertStageNavigation('normal');
    await page.waitForFunction(() => window.store.getSnapshot().workflowTask?.state === 'diagnosed');
    assert.equal(await drawer.locator('.dcAgentError').count(), 0, 'fixture Host metadata successfully loaded');
    await stageNav.getByRole('button', { name: '导入与核验', exact: true }).click();
    assert.equal(await drawer.locator('.dcAgentTable th').first().evaluate(el => getComputedStyle(el).backgroundColor), colorScheme === 'light' ? 'rgb(242, 249, 252)' : 'rgb(23, 44, 59)');
    // File bytes are a synthetic Host fixture; this checks input/remount wiring,
    // not XLSX decoding (covered separately by engine tests).
    const picker = drawer.getByLabel('选择数据文件', { exact: true });
    const file = { name: '测试名单.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('synthetic-xlsx-fixture') };
    await picker.setInputFiles(file);
    await drawer.getByRole('heading', { name: '已解析 23 条数据', exact: true }).waitFor();
    await page.waitForFunction(() => !window.store.getSnapshot().busy);
    assert.equal(parseCalls, 1);
    assert.deepEqual(await page.evaluate(() => window.store.getSnapshot().workflowTask.fieldSelection), ['company_name'], 'uploaded columns define the saved completion scope, not the old default five');
    assert.equal(await drawer.getByRole('button', { name: '解析数据', exact: true }).isDisabled(), true);
    assert.ok((await drawer.getByLabel('当前导入数据').textContent()).includes('测试名单.xlsx'));
    assert.equal(await picker.inputValue(), '', 'native chooser reset permits selecting the same file; status comes from dataset');
    await drawer.getByRole('button', { name: '已核对清单，下一步：字段映射与规则' }).click();
    await drawer.getByRole('button', { name: '导入与核验', exact: true }).click();
    assert.equal(await drawer.getByRole('heading', { name: '已解析 23 条数据', exact: true }).count(), 1);
    assert.equal(await drawer.locator('.dcAgentError').count(), 0);
    await picker.setInputFiles({ ...file, name: 'broken.xlsx' });
    await page.waitForFunction(() => !window.store.getSnapshot().busy && Boolean(window.store.getSnapshot().error));
    assert.equal(await drawer.getByRole('heading', { name: '已解析 23 条数据', exact: true }).count(), 1, 'failed replacement preserves loaded data');
    await picker.setInputFiles(file);
    await page.waitForFunction(() => !window.store.getSnapshot().busy && !window.store.getSnapshot().error);
    assert.equal(parseCalls, 3, 'same file can be selected again after reset');
    await drawer.getByRole('textbox', { name: '粘贴数据', exact: true }).fill('待解析的新名单');
    assert.equal(await drawer.getByRole('button', { name: '已核对清单，下一步：字段映射与规则' }).isDisabled(), true);
    await drawer.getByRole('button', { name: '解析数据', exact: true }).click();
    await page.waitForFunction(() => !window.store.getSnapshot().busy && window.store.getSnapshot().dataset?.rowCount === 1);
    assert.equal(await drawer.getByRole('textbox', { name: '粘贴数据', exact: true }).inputValue(), '');
    assert.equal(parseCalls, 3, 'plain entity list is parsed locally');
    await picker.setInputFiles(file);
    await page.waitForFunction(() => !window.store.getSnapshot().busy && window.store.getSnapshot().dataset?.rowCount === 23);
    const datasetReview = drawer.locator('.dcAgentDatasetPreview[aria-label="导入原始清单"]');
    assert.equal(await datasetReview.count(), 1, 'imported data uses the dedicated dataset surface');
    const assertDatasetLayout = async (expectedMode) => {
      const layout = await datasetReview.evaluate(section => {
        const rect = el => { const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width }; };
        const workbench = section.closest('.dcAgentWorkbenchContent');
        const tableViewport = section.querySelector('.dcAgentPreviewTable');
        const pagination = section.querySelector('.dcAgentDatasetPagination');
        const downloads = section.querySelector('.dcAgentDatasetDownloads');
        const footer = section.querySelector('.dcAgentDatasetFooter');
        const indexCell = section.querySelector('.dcAgentTable th:first-child');
        return {
          workbenchWidth: workbench.clientWidth,
          section: rect(section), tableViewport: rect(tableViewport), pagination: rect(pagination), downloads: rect(downloads),
          indexWidth: rect(indexCell).width,
          tableOverflow: getComputedStyle(tableViewport).overflow,
          footerFits: footer.scrollWidth <= footer.clientWidth + 1,
          sectionFits: section.scrollWidth <= section.clientWidth + 1,
        };
      });
      assert.equal(layout.tableOverflow, 'auto');
      assert.ok(layout.indexWidth >= 71 && layout.indexWidth <= 73, 'dataset index column stays compact');
      assert.ok(layout.tableViewport.left >= layout.section.left - 1 && layout.tableViewport.right <= layout.section.right + 1, 'dataset table stays inside its section');
      assert.ok(layout.footerFits && layout.sectionFits, 'dataset controls do not overflow');
      if (expectedMode === 'row') {
        assert.ok(Math.abs(layout.pagination.top - layout.downloads.top) <= 1, 'pagination and downloads share one footer row');
      } else {
        assert.ok(layout.downloads.top >= layout.pagination.bottom, 'narrow dataset footer stacks by action group');
      }
      return layout;
    };
    await assertDatasetLayout((await datasetReview.evaluate(section => section.closest('.dcAgentWorkbenchContent').clientWidth)) <= 520 ? 'stacked' : 'row');
    if (width >= 1200) {
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '728px'; });
      assert.ok((await assertDatasetLayout('row')).workbenchWidth > 520);
      await datasetReview.screenshot({ path: join(out, `imported-${colorScheme}-${width}x${height}-host-wide.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.removeProperty('width'); });
    }
    await page.screenshot({ path: join(out, `imported-${colorScheme}-${width}x${height}.png`) });
    await drawer.locator('.dcAgentWbBody').evaluate(body => { body.scrollTop = body.scrollHeight; });
    await drawer.getByRole('button', { name: '规则与体检', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dcAgentWbBody')?.scrollTop === 0);
    const bodyRhythm = await drawer.locator('.dcAgentWbBody').evaluate(body => {
      const children = Array.from(body.children);
      return {
        display: getComputedStyle(body).display,
        gap: getComputedStyle(body).gap,
        adjacentGaps: children.slice(1).map((child, index) => child.getBoundingClientRect().top - children[index].getBoundingClientRect().bottom),
      };
    });
    assert.equal(bodyRhythm.display, 'flex');
    assert.equal(bodyRhythm.gap, '14px');
    assert.ok(bodyRhythm.adjacentGaps.every(gap => gap >= 13), 'top-level workbench regions keep visual separation');
    const singleMappingSection = drawer.locator('.dcAgentMappingSection[aria-label="字段映射"]');
    assert.equal(await singleMappingSection.count(), 1, 'field mapping uses the dedicated structured surface');
    const assertMappingSectionLayout = async (expectedMode) => {
      const layout = await singleMappingSection.evaluate(section => {
        const rect = el => { const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }; };
        const workbench = section.closest('.dcAgentWorkbenchContent');
        const header = section.querySelector('.dcAgentMappingHeader');
        const headerCopy = header.firstElementChild;
        const progress = section.querySelector('.dcAgentMappingProgress');
        const toolbar = section.querySelector('.dcAgentMappingToolbar');
        const legend = section.querySelector('.dcAgentMappingLegend');
        const auto = section.querySelector('.dcAgentMappingAuto');
        const listHead = section.querySelector('.dcAgentMappingListHead');
        const row = section.querySelector('.dcAgentMappingSummary');
        return {
          workbenchWidth: workbench.clientWidth,
          sectionFits: section.scrollWidth <= section.clientWidth + 1,
          headerCopy: rect(headerCopy), progress: rect(progress), toolbar: rect(toolbar), legend: rect(legend), auto: rect(auto),
          listHeadDisplay: getComputedStyle(listHead).display,
          rowColumns: getComputedStyle(row).gridTemplateColumns.trim().split(/\s+/).length,
        };
      });
      assert.equal(layout.sectionFits, true, 'field mapping surface does not overflow');
      if (expectedMode === 'row') {
        assert.ok(Math.abs(layout.headerCopy.top - layout.progress.top) <= 1, 'mapping progress shares the header row');
        assert.ok(Math.abs((layout.legend.top + layout.legend.bottom) - (layout.auto.top + layout.auto.bottom)) <= 2, 'mapping legend and action align on the toolbar row');
        assert.notEqual(layout.listHeadDisplay, 'none');
        assert.equal(layout.rowColumns, 3);
      } else {
        assert.ok(layout.progress.top >= layout.headerCopy.bottom, 'mapping progress stacks below header copy');
        assert.ok(layout.auto.top >= layout.legend.bottom, 'mapping action stacks below legend');
        assert.equal(layout.listHeadDisplay, 'none');
        assert.equal(layout.rowColumns, 1);
      }
      return layout;
    };
    const mappingMode = (await singleMappingSection.evaluate(section => section.closest('.dcAgentWorkbenchContent').clientWidth)) <= 520 ? 'stacked' : 'row';
    await assertMappingSectionLayout(mappingMode);
    await singleMappingSection.screenshot({ path: join(out, `mapping-section-${colorScheme}-${width}x${height}.png`) });
    if (width >= 1200) {
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '728px'; });
      assert.ok((await assertMappingSectionLayout('row')).workbenchWidth > 520);
      await singleMappingSection.screenshot({ path: join(out, `mapping-section-${colorScheme}-${width}x${height}-host-wide.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.removeProperty('width'); });
    }
    await page.evaluate(() => {
      window.store.actions.setProfile({ rowCount: 1, columnCount: 2, columns: [
        { name: '企业名称', present: 1, missing: 0, distinct: 1 },
        { name: '统一社会信用代码', present: 1, missing: 0, distinct: 1 },
      ] });
      window.store.actions.setStep('profile');
    });
    const profileSurface = drawer.locator('.dcAgentProfileSurface[aria-label="质量体检报告"]');
    const profileLayout = await profileSurface.evaluate(surface => {
      const rect = el => { const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width }; };
      const tableWrap = surface.querySelector('.dcAgentProfileTableWrap');
      const actions = surface.querySelector('.dcAgentProfileActions');
      const button = actions.querySelector('button');
      return {
        surface: rect(surface), tableWrap: rect(tableWrap), actions: rect(actions), button: rect(button),
        display: getComputedStyle(surface).display,
        tableOverflow: getComputedStyle(tableWrap).overflow,
        fits: surface.scrollWidth <= surface.clientWidth + 1,
      };
    });
    assert.equal(profileLayout.display, 'flex');
    assert.equal(profileLayout.tableOverflow, 'auto');
    assert.equal(profileLayout.fits, true, 'quality report stays inside the workbench');
    assert.ok(profileLayout.tableWrap.left >= profileLayout.surface.left && profileLayout.tableWrap.right <= profileLayout.surface.right + 1, 'quality table stays inside the report');
    assert.ok(profileLayout.button.right <= profileLayout.actions.right + 1 && profileLayout.button.right >= profileLayout.actions.right - 1, 'quality report action aligns right');
    assert.equal(await drawer.getByRole('button', { name: '质量体检报告', exact: true }).getAttribute('aria-pressed'), 'true');
    await profileSurface.screenshot({ path: join(out, `profile-${colorScheme}-${width}x${height}.png`) });
    if (width >= 1200) {
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '728px'; });
      await profileSurface.screenshot({ path: join(out, `profile-${colorScheme}-${width}x${height}-host-wide.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.removeProperty('width'); });
    }
    await drawer.getByRole('button', { name: '字段映射与规则', exact: true }).click();
    await drawer.locator('.dcAgentExtraFields > summary').click();
    const fieldSearch = drawer.getByRole('searchbox', { name: '查找补全字段' });
    await fieldSearch.fill('实控人');
    assert.equal(await drawer.locator('.dcAgentFieldGroup input').count(), 4);
    await fieldSearch.fill('行业');
    assert.equal(await drawer.locator('.dcAgentFieldGroup input').count(), 3);
    await fieldSearch.fill('');
    assert.equal(await drawer.locator('.dcAgentFieldGroup input').count(), 136);
    await drawer.getByRole('button', { name: '导入与核验', exact: true }).click();
    const beforeNavigation = await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask));
    for (const name of ['主体匹配', '字段补全', '结果下载', '导入与核验']) {
      await stageNav.getByRole('button', { name, exact: true }).click();
      assert.equal(await stageNav.getByRole('button', { name, exact: true }).getAttribute('aria-current'), 'step');
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask)), beforeNavigation, 'navigation does not mutate or execute Host task');
    const taskBeforeHostChanges = await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask));
    assert.equal(await drawer.getByRole('separator').count(), 0);
    assert.equal(await drawer.getByRole('button',{name:'展开工作台'}).count(),0);
    await page.evaluate(() => window.hostCollapse());
    await drawer.waitFor({state:'hidden'});
    await page.locator('.dcAgentCapabilityMount').getByRole('button',{name:'导入名单'}).click();
    await drawer.waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => window.hostTabCount()),1);
    await page.evaluate(() => window.hostCloseTab());
    await drawer.waitFor({state:'detached'});
    await page.locator('.dcAgentCapabilityMount').getByRole('button',{name:'导入名单'}).click();
    await drawer.waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask)),taskBeforeHostChanges);
    assert.equal(await page.locator('[data-conversation-scroll]').evaluate(el=>getComputedStyle(el).paddingRight),'12px');
    await assertStageNavigation('host-singleton-tab');
    if (width > 760) {
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width='320px'; });
      await assertStageNavigation('host-320px');
      await page.locator('.fixtureSidebar').evaluate((el,value) => { el.style.width=value+'px'; }, Math.min(760,width-420));
      await assertStageNavigation('host-wide');
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.removeProperty('width'); });
    }
    // User-reported mapping fixture: full catalog, ambiguity, duplicate targets and manual override.
    await page.evaluate(() => {
      const headers = ['企业名称', '法定代表人', '法定代表人（重复列 2）', '统一社会信用代码', '地址', '网址', '联系电话', '注册资本', '开业时间'];
      window.store.actions.setDataset({ headers, rowCount: 2, preview: [] });
      window.store.actions.setMappings(window.plugin.__testing.guessMappings(headers));
      window.store.actions.setStep('rules');
    });
    assert.equal(await drawer.locator('.dcAgentMappingRow').count(), 9);
    await drawer.getByLabel('法定代表人 推荐映射', { exact: true }).getByRole('button', { name: '推荐：法定代表人', exact: true }).click();
    await drawer.getByLabel('法定代表人（重复列 2） 推荐映射', { exact: true }).getByRole('button').click();
    assert.equal(await drawer.getByLabel('法定代表人（重复列 2） 当前映射',{exact:true}).locator('.dcAgentMappingValue').textContent(),'法定代表人');
    await drawer.getByLabel('地址 推荐映射', { exact: true }).getByRole('button', { name: '推荐：注册地址', exact: true }).click();
    await drawer.getByLabel('网址 推荐映射', { exact: true }).getByRole('button').click();
    await drawer.getByLabel('开业时间 推荐映射', { exact: true }).getByRole('button').click();
    await drawer.getByLabel('地址 当前映射', { exact: true }).click();
    await drawer.getByLabel('地址 搜索映射字段', { exact: true }).fill('通信');
    const addressMappingRow = drawer.locator('.dcAgentMappingRow:has(.dcAgentMappingSource[title="地址"])');
    const assertExpandedMappingLayout = async (expectedMode) => {
      const layout = await addressMappingRow.evaluate(row => {
        const rect = el => { const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width }; };
        const panel = row.querySelector('.dcAgentMappingPickerPanel');
        const search = row.querySelector('input');
        const category = row.querySelector('select:not([size])');
        const options = row.querySelector('.dcAgentMappingOptionGroups');
        return {
          workbenchWidth: row.closest('.dcAgentWorkbenchContent').clientWidth,
          open: row.querySelector('details').open,
          row: rect(row), panel: rect(panel), search: rect(search), category: rect(category), options: rect(options),
          panelFits: panel.scrollWidth <= panel.clientWidth + 1,
        };
      });
      assert.equal(layout.open, true);
      assert.ok(Math.abs(layout.panel.width - layout.row.width) <= 1, 'expanded mapping panel uses the full mapping row');
      assert.equal(layout.panelFits, true, 'expanded mapping controls do not overflow');
      assert.ok(layout.options.left >= layout.panel.left && layout.options.right <= layout.panel.right + 1, 'mapping options stay inside the expanded panel');
      if (expectedMode === 'row') assert.ok(Math.abs(layout.search.top - layout.category.top) <= 1, 'mapping search and category share one toolbar row');
      else assert.ok(layout.category.top >= layout.search.bottom, 'narrow mapping filters stack');
      return layout;
    };
    await assertExpandedMappingLayout((await addressMappingRow.evaluate(row => row.closest('.dcAgentWorkbenchContent').clientWidth)) <= 520 ? 'stacked' : 'row');
    if (width >= 1200) {
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '728px'; });
      assert.ok((await assertExpandedMappingLayout('row')).workbenchWidth > 520);
      await addressMappingRow.screenshot({ path: join(out, `mapping-picker-open-${colorScheme}-${width}x${height}-host-wide.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.removeProperty('width'); });
    }
    const addressOptions = drawer.getByRole('radiogroup', { name: '地址 字段映射', exact: true });
    assert.equal(await drawer.getByLabel('地址 当前映射', { exact: true }).locator('.dcAgentMappingValue').textContent(), '注册地址', 'filter must preserve current value');
    await addressOptions.locator('input[type="radio"][value="mailing_address"]').check();
    assert.equal(await drawer.getByLabel('地址 当前映射', { exact: true }).locator('.dcAgentMappingValue').textContent(), '通信地址');
    await drawer.getByRole('button', { name: '补充自动映射（保留已有选择）' }).click();
    assert.equal(await drawer.getByLabel('地址 当前映射', { exact: true }).locator('.dcAgentMappingValue').textContent(), '通信地址');
    await drawer.getByLabel('地址 当前映射', { exact: true }).click();
    await drawer.getByLabel('地址 搜索映射字段', { exact: true }).fill('不存在的字段');
    assert.equal(await drawer.getByLabel('地址 当前映射', { exact: true }).locator('.dcAgentMappingValue').textContent(), '通信地址');
    await drawer.getByLabel('地址 搜索映射字段', { exact: true }).press('Escape');
    assert.equal(await drawer.getByLabel('地址 当前映射', { exact: true }).evaluate(el => document.activeElement === el), true);
    assert.equal(await page.evaluate(() => {
      const state=window.store.getSnapshot();
      return ['legal_rep','mailing_address','contact_official_website','establish_date'].every(id=>state.fieldSelection.includes(id)) && !state.fieldSelection.includes('registered_address');
    }), true, 'mapping changes update output scope without retaining replaced fields');
    await drawer.getByLabel('地址 当前映射', { exact: true }).click();
    await drawer.getByLabel('地址 搜索映射字段', { exact: true }).fill('');
    assert.ok(await drawer.locator('.dcAgentMappingRow').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1)), 'mapping picker fits narrow panel');
    const narrowMappingLayout = await drawer.evaluate(root => {
      const workbench = root.closest('.dcAgentWorkbenchContent') || root.querySelector('.dcAgentWorkbenchContent');
      const row = root.querySelector('.dcAgentMappingSummary');
      const rules = root.querySelector('.dcAgentRulesGrid');
      return {
        workbenchWidth: workbench.clientWidth,
        columns: getComputedStyle(row).gridTemplateColumns.trim().split(/\s+/).length,
        rulesColumns: getComputedStyle(rules).gridTemplateColumns.trim().split(/\s+/).length,
      };
    });
    if (narrowMappingLayout.workbenchWidth <= 520) {
      assert.equal(narrowMappingLayout.columns, 1, 'mapping row becomes one column at narrow workbench width');
      assert.equal(narrowMappingLayout.rulesColumns, 1, 'mapping list becomes one column at narrow workbench width');
    }
    await page.screenshot({ path: join(out, `mapping-${colorScheme}-${width}x${height}.png`) });
    await page.screenshot({ path: join(out, `workbench-${colorScheme}-${width}x${height}.png`) });
    await page.evaluate(() => {
      const snapshot = window.store.getSnapshot();
      document.dispatchEvent(new CustomEvent('dsh:data-cleaning-workbench-open', { detail: {
        sessionId: snapshot.activeSessionId, step: 'match',
        task: { ...snapshot.workflowTask, id: 'dcw-ui-fixture', state: 'diagnosed', fieldSelection: snapshot.fieldSelection, mappings: snapshot.mappings },
      } }));
    });
    const generateDescription = drawer.getByRole('button', { name: '生成可编辑任务说明', exact: true });
    assert.equal(await generateDescription.isEnabled(), true);
    assert.equal(await drawer.getByRole('button', { name: '检测企查查连接', exact: true }).count(), 0);
    assert.equal(await drawer.getByRole('button', { name: '估算调用量', exact: true }).count(), 0);
    assert.equal(await drawer.getByRole('checkbox').count(), 0);
    const matchSurface = drawer.locator('.dcAgentMatchSurface[aria-label="主体匹配执行准备"]');
    const assertMatchLayout = async (expectedMode) => {
      const layout = await matchSurface.evaluate(surface => {
        const rect = el => { const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width }; };
        const content = surface.querySelector('.dcAgentMatchContent');
        const blocks = Array.from(content.children, rect);
        const actions = surface.querySelector('.dcAgentMatchActions');
        const button = actions.querySelector('button');
        return {
          workbenchWidth: surface.closest('.dcAgentWorkbenchContent').clientWidth,
          surface: rect(surface), content: rect(content), blocks, actions: rect(actions), button: rect(button),
          columns: getComputedStyle(content).gridTemplateColumns.trim().split(/\s+/).length,
          fits: surface.scrollWidth <= surface.clientWidth + 1,
        };
      });
      assert.equal(layout.fits, true, 'match preparation stays inside the workbench');
      assert.ok(layout.button.right <= layout.actions.right + 1 && layout.button.right >= layout.actions.right - 1, 'match action aligns right');
      if (expectedMode === 'row') {
        assert.equal(layout.columns, 2);
        assert.ok(Math.abs(layout.blocks[0].top - layout.blocks[1].top) <= 1, 'match preparation blocks share one row');
      } else {
        assert.equal(layout.columns, 1);
        assert.ok(layout.blocks[1].top >= layout.blocks[0].bottom, 'match preparation blocks stack in narrow workbench');
      }
      return layout;
    };
    await assertMatchLayout((await matchSurface.evaluate(surface => surface.closest('.dcAgentWorkbenchContent').clientWidth)) <= 640 ? 'stacked' : 'row');
    await generateDescription.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, `match-${colorScheme}-${width}x${height}.png`) });
    if (width >= 1200) {
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '576px'; });
      assert.equal((await assertMatchLayout('stacked')).workbenchWidth, 576);
      await page.screenshot({ path: join(out, `match-${colorScheme}-${width}x${height}-host-default.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '728px'; });
      assert.ok((await assertMatchLayout('row')).workbenchWidth > 640);
      await page.screenshot({ path: join(out, `match-${colorScheme}-${width}x${height}-host-wide.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.removeProperty('width'); });
    }
    oldHost = true;
    await generateDescription.click();
    await drawer.getByText('页面与 Host 版本不一致。请保存任务后升级并完整重启 DSH；当前 Host 不支持自动生成结果文件。', { exact: true }).waitFor();
    assert.equal(unexpectedRequests.length, 0, 'old Host preflight must not stage or execute a QCC command');
    oldHost = false;
    await page.evaluate(() => window.hostCloseTab());
    await page.screenshot({ path: join(out, `home-${colorScheme}-${width}x${height}.png`) });
    await page.evaluate(() => window.show('fixture', 'active'));
    await page.waitForFunction(() => document.querySelector('.dcAgentCapabilityMount'));
    await page.locator('.dcAgentHeroLogo').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.fixture_headlineText').textContent(), '探索未至之境');
    assert.equal(await page.locator('.fixture_fishHitbox').isVisible(), true);
    assert.equal(await page.locator('.dcAgentCapabilityMount').count(), 1);
    await page.getByRole('button', { name: '打开提示词生成' }).click();
    await dialog.waitFor();
    await dialog.getByRole('tab', { name: '上传本地文件' }).click();
    await dialog.locator('input[type=file]').setInputFiles({name:'bank-template.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic-bank-fixture')});
    await dialog.getByText('原表空白单元格：22 个。', {exact:false}).waitFor();
    const sheetViewport = dialog.locator('.dcAgentPreviewTable');
    const sheetLayout = await sheetViewport.evaluate(el => {
      const header = el.querySelector('th');
      const before = header.getBoundingClientRect().left;
      el.scrollLeft = 180;
      return { overflow: el.scrollWidth > el.clientWidth, moved: header.getBoundingClientRect().left < before,
        sticky: getComputedStyle(header).position, wrap: getComputedStyle(header).whiteSpace };
    });
    assert.equal(sheetLayout.overflow, true, '多列保留宽度并横向滚动');
    assert.equal(sheetLayout.moved, true);
    assert.equal(sheetLayout.sticky, 'sticky');
    assert.equal(sheetLayout.wrap, 'nowrap');
    const pinned = await sheetViewport.evaluate(el => {
      const body = el.querySelector('tbody');
      const clones = Array.from({length:30}, () => body.firstElementChild.cloneNode(true));
      clones.forEach(row => body.append(row));
      const top = el.querySelector('th').getBoundingClientRect().top;
      el.scrollTop = 180;
      const held = el.scrollTop > 0 && Math.abs(el.querySelector('th').getBoundingClientRect().top - top) < 2;
      clones.forEach(row => row.remove());
      el.scrollTop = 0;
      return held;
    });
    assert.equal(pinned, true, '纵向滚动时表头固定');
    await sheetViewport.evaluate(el => { el.scrollLeft = 0; });
    await page.screenshot({path:join(out,`spreadsheet-${colorScheme}-${width}x${height}.png`)});
    assert.equal(await dialog.locator('input[type=file]').evaluate(el=>el.files[0]?.name), 'bank-template.xlsx');
    await dialog.getByRole('button', {name:'下一步',exact:true}).click();
    assert.equal(await dialog.locator('.dcAgentMappingRow').count(),23);
    assert.equal(await dialog.locator('[data-status=confirmed]').count(),9);
    const choose = async (sourceField, targetField) => {
      const row = dialog.locator('.dcAgentMappingRow').filter({has:page.getByTitle(sourceField,{exact:true})});
      await row.locator('summary').click();
      await row.getByRole('combobox', {name: sourceField + ' 映射大类', exact:true}).selectOption('company_registration');
      await row.getByRole('textbox').fill('');
      await row.locator(`input[type="radio"][value="${targetField}"]`).check();
    };
    for (const [column,field] of [['注册资本','reg_capital'],['注册资本（重复列 2）','reg_capital'],['法定代表人','legal_rep'],['法定代表人（重复列 2）','legal_rep'],['企业状态','reg_status'],['所属行业','industry_category']]) await choose(column,field);
    assert.equal(await dialog.locator('[data-status=confirmed]').count(),15);
    assert.equal(await dialog.locator('[data-status=unmatched]').count(),7);
    assert.equal(await dialog.locator('[data-status=review]').count(),1);
    const revenueRow = dialog.locator('.dcAgentMappingRow').filter({has:page.getByTitle('主营业务收入',{exact:true})});
    await revenueRow.locator('summary').click();
    await revenueRow.getByRole('textbox').fill('营业');
    const revenueList = revenueRow.getByRole('radiogroup');
    assert.equal(await revenueList.locator('input[value=financial_total_revenue]').count(),1);
    assert.equal(await revenueList.isVisible(),true);
    await revenueRow.getByRole('combobox').selectOption('company_registration');
    assert.equal(await revenueList.locator('input[value=financial_total_revenue]').count(),0);
    await revenueRow.getByRole('combobox').selectOption('');
    assert.equal(await revenueList.locator('input[value=financial_total_revenue]').count(),1);
    await revenueRow.getByRole('textbox').fill('工商');
    const registrationGroup = revenueList.locator('[data-mapping-group="company_registration"]');
    assert.equal(await registrationGroup.count(), 1, 'dimension name search exposes the matching group');
    assert.ok(await registrationGroup.locator('input[type="radio"]').count() > 10, 'dimension search exposes all group children');
    await page.screenshot({path:join(out,`mapping-search-${colorScheme}-${width}x${height}.png`)});
    await revenueRow.locator('summary').click();
    await page.screenshot({path:join(out,`bank-mapping-${colorScheme}-${width}x${height}.png`)});
    await dialog.getByRole('button',{name:'下一步',exact:true}).click();
    await dialog.getByText('已按确认映射选择 13 个原列补全字段', {exact:false}).waitFor();
    assert.equal(await dialog.locator('.dcAgentExtraFields').evaluate(el=>el.open),false);
    await dialog.getByRole('button',{name:'下一步',exact:true}).click();
    assert.match(await dialog.locator('.dcAgentPromptPreview').textContent(),/额外新增字段：无/);
    await dialog.getByRole('button',{name:'回填到对话框'}).click();
    await page.waitForFunction(()=>window.store.getSnapshot().workflowTask?.mappings?.length===15 && window.store.getSnapshot().workflowTask?.fieldSelection?.length===13);
    assert.equal(await page.evaluate(()=>new Set(window.store.getSnapshot().fieldSelection).size),13);
    await dialog.waitFor({ state: 'detached' });
    assert.match(await page.locator('#native').inputValue(), /安全任务凭证：dcq-/);
    // Simulate the Agent-owned tool completing while the drawer is closed.
    fixtureTask = { ...fixtureTask, state: 'completed', stage: 'download', qccRunId: 'g5-ui-fixture',
      artifacts: [{ id: 'dca-ui-fixture', kind: 'complete', format: 'xlsx', fileName: '清洗补全结果.xlsx', rowCount: 1 }] };
    fixtureCommand = { ...fixtureCommand, state: 'completed',
      run: { runId: 'g5-ui-fixture', rows: [{ 公司名称: '合成测试企业' }], summary: { totalRows: 1, enriched: 1 } } };
    await page.waitForFunction(() => window.store.getSnapshot().workflowTask?.state === 'completed');
    await drawer.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.store.getSnapshot().open), true, '执行后自动打开工作台');
    await drawer.getByRole('button', {name: '结果下载', exact: true}).click();
    await drawer.getByRole('button', {name: '下载 清洗补全结果.xlsx', exact: true}).waitFor();
    const resultGridLayout = await drawer.locator('.dcAgentGrid').evaluate(grid => {
      const cards = Array.from(grid.children, card => card.getBoundingClientRect());
      return { width: grid.getBoundingClientRect().width, workbenchWidth: grid.closest('.dcAgentWorkbenchContent').clientWidth,
        cardWidths: cards.map(card => card.width), cardTops: cards.map(card => card.top) };
    });
    if (resultGridLayout.workbenchWidth <= 520) {
      assert.ok(Math.abs(resultGridLayout.cardWidths.at(-1) - resultGridLayout.width) <= 1, 'odd final result metric spans the narrow grid');
    } else {
      assert.ok(resultGridLayout.cardTops.every(top => Math.abs(top - resultGridLayout.cardTops[0]) <= 1), 'five result metrics share one wide row');
    }
    await page.screenshot({ path: join(out, `results-${colorScheme}-${width}x${height}.png`) });
    if (width >= 1200) {
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '576px'; });
      const defaultHostResultLayout = await drawer.locator('.dcAgentGrid').evaluate(grid => {
        const cards = Array.from(grid.children, card => card.getBoundingClientRect());
        return { workbenchWidth: grid.closest('.dcAgentWorkbenchContent').clientWidth,
          cardTops: cards.map(card => card.top) };
      });
      assert.equal(defaultHostResultLayout.workbenchWidth, 576);
      assert.ok(defaultHostResultLayout.cardTops.every(top => Math.abs(top - defaultHostResultLayout.cardTops[0]) <= 1), 'five result metrics share one 576px row');
      await page.screenshot({ path: join(out, `results-${colorScheme}-${width}x${height}-host-default.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.width = '728px'; });
      const wideResultLayout = await drawer.locator('.dcAgentGrid').evaluate(grid => {
        const cards = Array.from(grid.children, card => card.getBoundingClientRect());
        return { workbenchWidth: grid.closest('.dcAgentWorkbenchContent').clientWidth,
          cardTops: cards.map(card => card.top) };
      });
      assert.ok(wideResultLayout.workbenchWidth > 520);
      assert.ok(wideResultLayout.cardTops.every(top => Math.abs(top - wideResultLayout.cardTops[0]) <= 1), 'five result metrics share one 728px row');
      await page.screenshot({ path: join(out, `results-${colorScheme}-${width}x${height}-host-wide.png`) });
      await page.locator('.fixtureSidebar').evaluate(el => { el.style.removeProperty('width'); });
    }
    assert.equal(await drawer.locator('.dcAgentWbHeader, .dcAgentWbActions, .dcAgentWbClose').count(),0, 'content has no duplicate Host header controls');
    const artifactLayout = await drawer.locator('.dcAgentArtifactList').evaluate(el => {
      const link = el.querySelector('a');
      link.textContent = '预览 / 打开：' + '企业数据清洗补全结果长文件名'.repeat(8) + '.xlsx';
      const a = link.getBoundingClientRect();
      const b = el.querySelector('button').getBoundingClientRect();
      return { separated: b.top >= a.bottom + 8, fits: el.scrollWidth <= el.clientWidth + 1 };
    });
    assert.equal(artifactLayout.separated, true, '长文件名预览与下载按钮分行留白');
    assert.equal(artifactLayout.fits, true, '文件操作不超出工作台宽度');
    await page.evaluate(() => window.hostCloseTab());
    await page.getByRole('button', { name: '打开提示词生成' }).click();
    await dialog.waitFor();
    await page.evaluate(() => window.show('ordinary'));
    await page.locator('.dcAgentCapabilityMount').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('[data-conversation-scroll]')?.style.getPropertyValue('--dc-agent-workbench-reserve') === '');
    assert.equal(await page.locator('[data-conversation-scroll]').evaluate(el => el.style.getPropertyValue('--dc-agent-workbench-reserve')), '');
    assert.equal(await page.locator('.dcAgentPromptTrigger').count(), 0);
    assert.equal(await page.locator('.dcAgentPromptBackdrop').count(), 0);
    assert.equal(await page.locator('#foreign').count(), 1);
    assert.equal(await page.locator('[data-dc-agent-hero-row]').count(), 0);
    assert.equal(await page.locator('.fixture_previewBadge').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), nativeSendStyle);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, [], 'all requests stay inside isolated fixture contract');
    results.push({ colorScheme, width, height, pass: true });
    await page.close();
  }
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

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
    const unexpectedRequests = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== 'dcq-ui.test') { unexpectedRequests.push(request.url()); return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
      const base = '/data-cleaning/api/workflow/tasks';
      if (url.pathname === base && request.method() === 'GET') return route.fulfill({ json: { tasks: fixtureTask ? [fixtureTask] : [] } });
      if (url.pathname.startsWith(base) && ['POST', 'PATCH'].includes(request.method())) {
        const data = request.postDataJSON() || {};
        fixtureTask = { id: 'dcw-ui-fixture', state: 'draft', stage: 'upload', artifacts: [], ...fixtureTask, ...data, revision: (fixtureTask?.revision || 0) + 1 };
        if (url.pathname.endsWith('/actions/upload')) fixtureTask.state = 'uploaded';
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
      #app { min-height:100vh } [data-conversation-scroll] { box-sizing:border-box; padding:24px 12px; min-height:100vh }
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
        '@deepseek-ai/dsh-client-ui-primitives': { Button: (props) => h('button', props) },
        '@deepseek-ai/dsh-client-store': { defineStore } };
      const plugin = window.registration.factory((name) => modules[name]);
      const slots = {};
      plugin.apply({ effect: (fn) => fn(), slots: {
        inject: (name, fn) => { slots[name] = fn(); },
        register: (options, component) => ({ options, component }),
      } });
      window.plugin = plugin;
      plugin.__testing.markCleaningSession('fixture');
      const store = slots['shell.overlay'].options.store.create();
      window.store = store;
      const Experience = slots['conversation.input.dock'].component;
      const Prompt = slots['conversation.input.overlay'].component;
      const Drawer = slots['shell.overlay'].component;
      const useStore = (pick) => R.useSyncExternalStore(store.subscribe, () => pick(store.getSnapshot()));
      function App({ sessionId = 'fixture', phase = 'blank' }) {
        const [draft, setDraft] = R.useState('');
        return h('div', { 'data-conversation-scroll': '' },
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
          h(Drawer, { useStore, actions: store.actions }));
      }
      window.root = window.createRoot(document.getElementById('app'));
      window.show = (sessionId = 'fixture', phase = 'blank') => window.root.render(h(App, { sessionId, phase }));
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
    assert.equal(await dialog.locator('.dcAgentPromptFieldGrid input[type="checkbox"]').count(), 128);
    const credit = dialog.getByRole('checkbox', { name: '统一社会信用代码', exact: true });
    await credit.uncheck();
    assert.equal(await credit.isChecked(), false);
    await credit.check();
    assert.equal(await credit.isChecked(), true);
    const selectedCount = await dialog.locator('.dcAgentPromptFieldGrid input:checked').count();
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
    const drawer = page.getByRole('dialog', { name: '数据清洗补全工作台' });
    assert.equal(await drawer.getByRole('navigation', { name: '清洗流程' }).count(), 0);
    await drawer.getByRole('button', { name: '当前任务', exact: true }).click();
    assert.equal(await drawer.getByRole('navigation', { name: '清洗流程' }).getByRole('button').count(), 5);
    const stageNav = drawer.getByRole('navigation', { name: '清洗流程' });
    async function assertStageNavigation(mode) {
      const layout = await stageNav.evaluate(nav => {
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        return { nav: rect(nav), scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth,
          buttons: Array.from(nav.children, button => {
            const icon = button.querySelector('.dcAgentStepIcon');
            const label = button.querySelector('.dcAgentStepLabel');
            return { ...rect(button), icon: rect(icon), label: rect(label),
              text: button.textContent, name: button.getAttribute('aria-label'),
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
        assert.equal(button.separator, index === 4 ? '0px' : '1px');
        if (button.active) {
          assert.equal(button.underlineHeight, '3px');
          assert.equal(button.underline, colorScheme === 'light' ? 'rgb(8, 117, 209)' : 'rgb(130, 195, 255)');
        }
      }
      // Long future labels truncate inside their cell instead of stretching the grid.
      const stress = await stageNav.evaluate(nav => {
        const label = nav.querySelector('.dcAgentStepLabel');
        const original = label.textContent;
        label.textContent = '超长阶段标题'.repeat(8);
        const result = { ellipsis: getComputedStyle(label).textOverflow,
          fits: nav.scrollWidth <= nav.clientWidth, truncated: label.scrollWidth > label.clientWidth };
        label.textContent = original;
        return result;
      });
      assert.deepEqual(stress, { ellipsis: 'ellipsis', fits: true, truncated: true });
      await stageNav.screenshot({ path: join(out, `stage-menu-${colorScheme}-${width}x${height}-${mode}.png`) });
    }
    await assertStageNavigation('normal');
    await page.waitForFunction(() => window.store.getSnapshot().workflowTask?.state === 'uploaded');
    assert.equal(await drawer.locator('.dcAgentError').count(), 0, 'fixture Host metadata successfully loaded');
    assert.equal(await drawer.locator('.dcAgentTable th').first().evaluate(el => getComputedStyle(el).backgroundColor), colorScheme === 'light' ? 'rgb(242, 249, 252)' : 'rgb(23, 44, 59)');
    await drawer.getByRole('button', { name: '规则与体检', exact: true }).click();
    const fieldSearch = drawer.getByRole('searchbox', { name: '查找补全字段' });
    await fieldSearch.fill('行业');
    assert.equal(await drawer.locator('.dcAgentFieldGroup input').count(), 3);
    await fieldSearch.fill('');
    assert.equal(await drawer.locator('.dcAgentFieldGroup input').count(), 128);
    await drawer.getByRole('button', { name: '导入与核验', exact: true }).click();
    const beforeNavigation = await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask));
    for (const name of ['主体匹配', '字段补全', '结果下载', '导入与核验']) {
      await stageNav.getByRole('button', { name, exact: true }).click();
      assert.equal(await stageNav.getByRole('button', { name, exact: true }).getAttribute('aria-current'), 'step');
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask)), beforeNavigation, 'navigation does not mutate or execute Host task');
    if (width > 760) {
      const separator = drawer.getByRole('separator', { name: '调整工作台宽度' });
      const panelWidth = async () => Math.round((await drawer.boundingBox()).width);
      const assertNoOverlap = async () => {
        const inputBox = await page.locator('[data-composer-card]').boundingBox();
        const panelBox = await drawer.boundingBox();
        assert.ok(inputBox.x + inputBox.width <= panelBox.x + 1, 'resizing must reserve the actual panel width');
      };
      const initialWidth = await panelWidth();
      const taskBeforeResize = await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask));
      let grip = await separator.boundingBox();
      await page.mouse.move(grip.x + 3, grip.y + 100);
      await page.mouse.down();
      await page.mouse.move(grip.x - 80, grip.y + 100, { steps: 8 });
      await assertNoOverlap();
      await page.mouse.up();
      const manualWidth = await panelWidth();
      assert.ok(manualWidth > initialWidth, 'dragging left expands continuously');
      await separator.focus();
      await page.keyboard.press('Home');
      assert.equal(await panelWidth(), 320);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await panelWidth(), 336);
      await page.keyboard.press('Shift+ArrowLeft');
      assert.equal(await panelWidth(), 384);
      await page.keyboard.press('End');
      assert.equal(await panelWidth(), width - 420);
      await assertNoOverlap();
      assert.equal(Number(await separator.getAttribute('aria-valuenow')), await panelWidth());
      grip = await separator.boundingBox();
      await page.mouse.move(grip.x + 3, grip.y + 100);
      await page.mouse.down();
      await page.mouse.move(grip.x + 65, grip.y + 100);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await drawer.count(), 1, 'Escape during drag cancels resize, not the drawer');
      assert.equal(await panelWidth(), width - 420);
      await separator.dblclick();
      assert.equal(await panelWidth(), initialWidth, 'double click restores default');
      await separator.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');
      await drawer.getByRole('button', { name: '展开工作台' }).click();
      await drawer.getByRole('button', { name: '收起工作台' }).click();
      assert.equal(await panelWidth(), 336, 'collapse restores manual preference');
      await drawer.getByRole('button', { name: '关闭', exact: true }).click();
      assert.equal(await page.locator('[data-conversation-scroll]').evaluate(el => el.style.getPropertyValue('--dc-agent-workbench-reserve')), '');
      await page.getByRole('button', { name: '任务历史', exact: true }).click();
      await drawer.getByRole('button', { name: '当前任务', exact: true }).click();
      assert.equal(await panelWidth(), 336, 'reopening preserves width, not a new task');
      await page.setViewportSize({ width: 390, height: 700 });
      assert.equal(await separator.isVisible(), false);
      assert.equal(await panelWidth(), 390);
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => Math.round(document.querySelector('.dcAgentWorkbench').getBoundingClientRect().width) === 336);
      assert.equal(await panelWidth(), 336);
      assert.equal(await page.evaluate(() => JSON.stringify(window.store.getSnapshot().workflowTask)), taskBeforeResize);
      // Host sidebar changes available canvas width without a window resize.
      await page.locator('[data-conversation-scroll]').evaluate(el => {
        el.style.marginLeft = '240px'; el.style.width = 'calc(100% - 240px)';
      });
      if (width - 240 < 740) {
        await page.waitForFunction(() => document.querySelector('.dcAgentWorkbench').dataset.narrow === 'true');
        assert.equal(await separator.isVisible(), false);
      } else {
        await page.waitForFunction(expected => Number(document.querySelector('.dcAgentResizeHandle').getAttribute('aria-valuemax')) === expected, width - 660);
        await separator.focus(); await page.keyboard.press('End');
        assert.equal(await panelWidth(), width - 660);
        await assertNoOverlap();
      }
      await page.locator('[data-conversation-scroll]').evaluate(el => {
        el.style.removeProperty('margin-left'); el.style.removeProperty('width');
      });
      await page.waitForFunction(() => document.querySelector('.dcAgentWorkbench').dataset.narrow === 'false');
      await separator.dblclick();
      await assertStageNavigation('resized-default');
      for (const expanded of [false, true]) {
        if (expanded) await drawer.getByRole('button', { name: '展开工作台' }).click();
        if (expanded) await assertStageNavigation('expanded');
        const menuClippedLeft = await page.locator('.dcAgentCapabilities').evaluate(el => {
          el.scrollLeft = 0;
          return el.firstElementChild.getBoundingClientRect().left < el.getBoundingClientRect().left - 1;
        });
        assert.equal(menuClippedLeft, false, 'narrow desktop menu must scroll from first item, not clip centered overflow');
        const nativeBox = await page.locator('[data-composer-card]').boundingBox();
        const drawerBox = await drawer.boundingBox();
        assert.ok(nativeBox.x + nativeBox.width <= drawerBox.x + 1, JSON.stringify({ reason: 'drawer overlap', width, height, expanded, nativeBox, drawerBox }));
      }
      const expandedWidth = await panelWidth();
      grip = await separator.boundingBox();
      await page.mouse.move(grip.x + 3, grip.y + 100); await page.mouse.down();
      await page.mouse.move(grip.x + 55, grip.y + 100, { steps: 5 }); await page.mouse.up();
      assert.ok(await panelWidth() < expandedWidth);
      assert.equal(await drawer.getByRole('button', { name: '展开工作台' }).count(), 1, 'drag from expanded returns to manual mode');
      for (const cancellation of ['pointercancel', 'blur']) {
        const savedWidth = await panelWidth();
        grip = await separator.boundingBox();
        await page.mouse.move(grip.x + 3, grip.y + 100); await page.mouse.down();
        await page.mouse.move(grip.x + 30, grip.y + 100);
        if (cancellation === 'pointercancel') await separator.dispatchEvent('pointercancel');
        else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.mouse.up();
        assert.equal(await panelWidth(), savedWidth, `${cancellation} restores the starting width`);
      }
      await assertNoOverlap();
      await separator.hover();
    } else {
      assert.equal(await drawer.getByRole('separator', { name: '调整工作台宽度' }).isVisible(), false);
    }
    await page.screenshot({ path: join(out, `workbench-${colorScheme}-${width}x${height}.png`) });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await page.screenshot({ path: join(out, `home-${colorScheme}-${width}x${height}.png`) });
    await page.evaluate(() => window.show('fixture', 'active'));
    await page.waitForFunction(() => document.querySelector('.dcAgentCapabilityMount'));
    await page.locator('.dcAgentHeroLogo').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.fixture_headlineText').textContent(), '探索未至之境');
    assert.equal(await page.locator('.fixture_fishHitbox').isVisible(), true);
    assert.equal(await page.locator('.dcAgentCapabilityMount').count(), 1);
    await page.getByRole('button', { name: '打开提示词生成' }).click();
    await dialog.waitFor();
    await page.evaluate(() => window.show('ordinary'));
    await page.locator('.dcAgentCapabilityMount').waitFor({ state: 'detached' });
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

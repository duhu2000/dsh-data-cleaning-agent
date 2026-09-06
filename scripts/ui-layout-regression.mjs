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
  for (const colorScheme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [1024, 768], [390, 700], [900, 500]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/data-cleaning/**', (route) => route.fulfill({ json: { tasks: [], jobs: [], contract: {} } }));
    await page.goto('about:blank');
    await page.setContent(`<html style="color-scheme:${colorScheme}"><head><style>
      body { margin:0; font:14px system-ui; background:light-dark(#fff,#161b23); color:light-dark(#172033,#edf2fa) }
      #app { min-height:100vh } [data-conversation-scroll] { box-sizing:border-box; padding:24px 12px; min-height:100vh }
      [data-composer-seat] { max-width:800px; margin:0 auto }
      .fixture_composerStack { display:flex; flex-direction:column; gap:8px }
      [data-composer-card] { position:relative; box-sizing:border-box; border:1px solid #8886; border-radius:20px; padding:16px; background:light-dark(#fff,#161b23) }
      #native { width:100%; height:100px; box-sizing:border-box; border:0; resize:none; background:transparent; color:inherit }
      .nativeActions { display:flex; justify-content:space-between } h1 { text-align:center; font-size:24px }
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
              h('h1', null, sessionId === 'fixture' ? '数据清洗补全智能体' : '普通会话'),
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
    await page.screenshot({ path: join(out, `landing-${colorScheme}-${width}x${height}.png`) });
    await page.getByRole('button', { name: '打开提示词生成' }).click();
    const dialog = page.getByRole('dialog', { name: '数据清洗补全任务生成器' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '3 清洗与补全' }).click();
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
    await page.getByRole('button', { name: '任务历史', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '数据清洗补全工作台' });
    assert.equal(await drawer.getByRole('navigation', { name: '清洗流程' }).count(), 0);
    await drawer.getByRole('button', { name: '当前任务', exact: true }).click();
    assert.equal(await drawer.getByRole('navigation', { name: '清洗流程' }).getByRole('button').count(), 5);
    if (width > 760) {
      for (const expanded of [false, true]) {
        if (expanded) await drawer.getByRole('button', { name: '展开工作台' }).click();
        const nativeBox = await page.locator('[data-composer-card]').boundingBox();
        const drawerBox = await drawer.boundingBox();
        assert.ok(nativeBox.x + nativeBox.width <= drawerBox.x + 1, JSON.stringify({ reason: 'drawer overlap', width, height, expanded, nativeBox, drawerBox }));
      }
    }
    await page.screenshot({ path: join(out, `workbench-${colorScheme}-${width}x${height}.png`) });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await page.screenshot({ path: join(out, `home-${colorScheme}-${width}x${height}.png`) });
    await page.evaluate(() => window.show('fixture', 'active'));
    await page.waitForFunction(() => document.querySelector('.dcAgentCapabilityMount'));
    assert.equal(await page.locator('.dcAgentCapabilityMount').count(), 1);
    await page.getByRole('button', { name: '打开提示词生成' }).click();
    await dialog.waitFor();
    await page.evaluate(() => window.show('ordinary'));
    await page.locator('.dcAgentCapabilityMount').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.dcAgentPromptTrigger').count(), 0);
    assert.equal(await page.locator('.dcAgentPromptBackdrop').count(), 0);
    assert.equal(await page.locator('#foreign').count(), 1);
    assert.deepEqual(errors, []);
    results.push({ colorScheme, width, height, pass: true });
    await page.close();
  }
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

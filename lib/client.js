/**
 * Client 半区（M1 入口 + M2 工作台）。
 *
 * 通过 `window.__ModuleLoader__.load({id, factory})` 注册为惰性 CJS 工厂，
 * 与 dsh-mcp-connector@0.2.32（生产 profile 中已实测的「MCP连接器」）同构：
 *   - `react` / `react-dom` / `@deepseek-ai/dsh-client-ui-primitives` 由 web shell 静态模块表提供，
 *     第三方 bundle 无需打包 React、无需构建步骤。
 *   - `defineStore` 首选 `@deepseek-ai/dsh-client-store`，回退 `@deepseek-ai/dsh-client-runtime/client`。
 *   - `sidebar.footer.action` 仅托管入口生命周期和降级渲染；实际入口 Portal 到
 *     `sidebar.workspaces` 前，位于「新会话」与「工作区」之间。
 *   - DSH 原生会话保持在中间，能力入口使用 `conversation.input.dock` 并通过稳定
 *     `data-composer-seat/card` 将自有菜单 Portal 到输入框下方；工作台使用 Better Sidebar Session 单例 Tab。
 *   - 提示词生成器使用 `conversation.input.overlay`，只对本插件创建的会话生效。
 *     Hero 标题没有公开替换槽位，故以可恢复、精确文本匹配的 DOM Bridge 对齐业务首页。
 *
 * v2 工作台把上传、规则、匹配、补全、下载正式绑定到 Host taskId 工作流；原始行只保留
 * 在浏览器内按 taskId 隔离的 runtime 中，Host 仅持久化任务元数据、摘要与制品引用。
 * 当前业务闭环使用基础企业 G5 Bridge；历史、人员、招投标域仍按产品决策延期。
 */
window.__ModuleLoader__.load({
  id: 'dsh-data-cleaning-agent',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const reactDom = require('react-dom');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const {
      Button,
      IconArchiveOutline20,
      IconChecklistOutline14,
      IconCloseOutline16,
      IconDownloadOutline16,
      IconFullscreenOutline16,
      IconPaperclipOutline16,
      IconSearchOutline16,
    } = primitives;

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

    // 同一数据库图形用于入口、业务首页和工作台；不注册 root/single 品牌槽位。
    const DATABASE_PATH = 'M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0';
    function DatabaseLogo({ size = 20 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false, className: 'dcAgentDatabaseLogo' },
      h('path', { d: DATABASE_PATH }));
    }

    // 阶段只展示线性图标和短标题；说明、状态与操作保留在内容区。
    const STAGE_ICON_PATHS = {
      upload: 'M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6',
      check: 'M9 6h11M9 12h11M9 18h11M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2',
      search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
      database: DATABASE_PATH,
      table: 'M4 3h16v18H4zM4 8h16M4 13h16M4 17h16M10 8v13',
    };
    function StageIcon({ kind }) {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false }, h('path', { d: STAGE_ICON_PATHS[kind] }));
    }

    // 搜索仅改变可见字段，绝不清除已选字段或改变 Host 的字段目录。
    function visibleCatalogFields(group, query) {
      const needle = String(query || '').trim().toLowerCase();
      const [, label, fields, tool] = group;
      if (!needle || `${label} ${tool || ''}`.toLowerCase().includes(needle)) return fields;
      return fields.filter(([id, fieldLabel]) => `${id} ${fieldLabel} ${(MAPPING_ALIASES[id] || []).join(' ')}`.toLowerCase().includes(needle));
    }

    /** 客户端所需服务：与 mcp-connector 对齐（槽位 + 会话/工作区/输入机）。 */
    const inject = ['slots', 'sessions', 'workspaces', 'conversation'];

    const UI_STYLE_ID = 'dsh-data-cleaning-agent-ui';
    const SIDEBAR_WORKSPACES_SELECTOR = '[data-slot="sidebar.workspaces"]';
    const TOP_MOUNT_SELECTOR = '[data-data-cleaning-top-mount="true"]';
    const stylesCss = `
/* QCC-blue candidate tokens from shared DSH-UX-001; never theme the global shell. */
:where(.dcAgentTopMount, .dcAgentLauncher, .dcAgentExperience, .dcAgentCapabilityMount,
 .dcAgentWorkbenchContent, .dcAgentPromptBackdrop, .dcAgentPromptPanel, .dcAgentPromptLayer,
 .dcAgentToolCard, [data-dc-agent-hero-row="true"]) {
  --dc-action: light-dark(#0875d1, #82c3ff);
  --dc-hover: light-dark(#0666b7, #acd7ff);
  --dc-on-action: light-dark(#fff, #101820);
  --dc-selected: light-dark(#e6f4ff, #173449);
  --dc-surface: light-dark(#fff, #18232e);
  --dc-page: light-dark(#f6f8fa, #101820);
  --dc-table-head: light-dark(#f2f9fc, #172c3b);
  --dc-text: light-dark(#202c3b, #e7eef6);
  --dc-muted: light-dark(#626f80, #a2b1c2);
  --dc-border: light-dark(#dce4ec, #344657);
  --dc-success: light-dark(#12805c, #78d8b3);
  --dc-success-bg: light-dark(#edf8f2, #193a30);
  --dc-review: light-dark(#946000, #f3c66c);
  accent-color: var(--dc-action);
}
.dcAgentLauncherContent { display: inline-flex; align-items: center; gap: 8px; }
.dcAgentDatabaseLogo { display: block; flex: none; color: var(--dc-action); }
[data-dc-agent-hero-row="true"] { display: flex; align-items: center; justify-content: center; gap: 12px; }
[data-dc-agent-hero-title="true"] { min-width: 0; font-size: 28px; line-height: 1.3; color: var(--dc-text); }
.dcAgentHeroLogo { width: 48px; height: 48px; border-radius: 12px; background: var(--dc-selected); color: var(--dc-action); display: grid; place-items: center; flex: none; }

.dcAgentTopMount {
  flex: none;
  min-width: 0;
  width: 100%;
}

.dcAgentTopEntry {
  box-sizing: border-box;
  width: 100%;
  padding-right: var(--dsh-sidebar-inline-padding, 12px);
}

.dcAgentLauncher {
  flex: none;
  box-sizing: border-box;
  width: 100%;
  height: 42px;
  margin: 0 0 8px;
  padding: 0 10px 0 8px;
  justify-content: flex-start;
  min-width: 0;
  overflow: hidden;
  border-radius: 12px;
  white-space: nowrap;
}
.dcAgentLauncher[data-wide="false"] {
  width: 36px;
  height: 36px;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
}
.dcAgentTopEntry[data-wide="false"] {
  width: 36px;
  padding-right: 0;
}
.dcAgentWorkbenchContent {
  box-sizing: border-box; display: flex; flex-direction: column;
  width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden;
  background: var(--dc-surface); color: var(--dc-text);
  container-type: inline-size;
}
@container (max-width: 520px) {
  .dcAgentRulesGrid, .dcAgentMappingRow { grid-template-columns: 1fr; }
  .dcAgentMappingRow > b { display: none; }
  .dcAgentCandidate { grid-template-columns: 1fr; }
}
.dcAgentCapabilities {
  display: flex;
  justify-content: safe center;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 780px);
  box-sizing: border-box;
  margin: 0 auto;
  padding: 2px 16px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.dcAgentCapabilities::-webkit-scrollbar { display: none; }
.dcAgentCapability {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  min-width: 108px;
  min-height: 54px;
  padding: 7px 12px;
  flex-direction: column;
  justify-content: center;
  border: 1px solid var(--dc-border);
  border-radius: 12px;
  background: var(--dc-surface);
  color: var(--dc-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentCapability:hover,
.dcAgentCapability:focus-visible,
.dcAgentCapability.is-active {
  border-color: var(--dc-border);
  background: var(--dc-selected);
  color: var(--dc-action);
}
.dcAgentCapability svg { flex: 0 0 auto; }

/* 原生 input.dock 保留轻量简介；菜单独立 Portal 到 composer 后，不重排共享 slot。 */

.dcAgentExperience {
  width: 100%;
  box-sizing: border-box;
}
.dcAgentCapabilityMount { width: 100%; padding: 8px 0; flex: none; }
.dcAgentHomeSummary { margin: 0 20px 8px; text-align: center; color: var(--dc-muted); font-size: 13px; line-height: 20px; }
.dcAgentPromptBackdrop { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 16px; box-sizing: border-box; background: rgba(8, 15, 28, .36); pointer-events: auto; }
body:has(.dcAgentPromptBackdrop) { overflow: hidden; }


/* input.overlay 是 DSH 官方浮层锚点；给触发器让出输入卡片顶部空间。 */
[data-composer-card]:has(.dcAgentPromptTrigger) {
  padding-top: 48px;
}
.dcAgentPromptLayer {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}
.dcAgentPromptTrigger {
  position: absolute;
  top: 10px;
  left: 16px;
  min-height: 28px;
  padding: 3px 10px;
  border: 1px solid var(--dc-border);
  border-radius: 999px;
  background: var(--dc-selected);
  color: var(--dc-action);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  pointer-events: auto;
}
.dcAgentPromptPanel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(860px, 100%);
  max-height: calc(100dvh - 32px);
  box-sizing: border-box;
  overflow: hidden;
  padding: 16px;
  border: 1px solid var(--dc-border);
  border-radius: 12px;
  background: var(--dc-surface);
  color: var(--dc-text);
  box-shadow: light-dark(0 18px 48px rgba(33,55,88,.20), 0 20px 54px rgba(0,0,0,.40));
  pointer-events: auto;
}
.dcAgentPromptBody { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 2px; }
.dcAgentPromptHead, .dcAgentPromptActions { flex: none; }
.dcAgentPromptActions { border-top: 1px solid var(--dc-border); padding-top: 12px; }
.dcAgentPromptHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.dcAgentPromptHead h3 { margin: 0; font-size: 16px; line-height: 22px; }
.dcAgentPromptHead p { margin: 3px 0 0; color: var(--dc-muted); font-size: 12px; line-height: 17px; }
.dcAgentPromptClose {
  width: 28px;
  height: 28px;
  flex: none;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dcAgentPromptClose:hover { background: var(--dc-page); }
.dcAgentPromptTabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dcAgentPromptTab,
.dcAgentPromptChoice {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid var(--dc-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentPromptTab.is-active,
.dcAgentPromptChoice.is-selected {
  border-color: var(--dc-action);
  background: var(--dc-selected);
  color: var(--dc-action);
}
.dcAgentPromptField { display: grid; gap: 6px; margin: 10px 0; }
.dcAgentPromptField > span { font-size: 12px; font-weight: 600; }
.dcAgentPromptText {
  box-sizing: border-box;
  width: 100%;
  min-height: 104px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: var(--dc-page);
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 20px;
}
.dcAgentPromptFile {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px dashed light-dark(#b9c5d8, #43516a);
  border-radius: 8px;
  color: var(--dc-muted);
  font-size: 12px;
}
.dcAgentPromptFile input { max-width: 100%; }
.dcAgentPromptImageDrop {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px dashed light-dark(#b9c5d8, #43516a);
  border-radius: 12px;
  background: var(--dc-page);
  outline: none;
}
.dcAgentPromptImageDrop.is-active {
  border-color: var(--dc-action);
  background: var(--dc-selected);
}
.dcAgentPromptImageDrop > p {
  margin: 0;
  color: var(--dc-muted);
  font-size: 12px;
  line-height: 17px;
}
.dcAgentPromptImagePreview {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.dcAgentPromptImageThumb {
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: var(--dc-page);
  cursor: zoom-in;
}
.dcAgentPromptImageThumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dcAgentPromptImageMeta { min-width: 0; flex: 1 1 auto; }
.dcAgentPromptImageMeta b,
.dcAgentPromptImageMeta small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcAgentPromptImageMeta small { margin-top: 3px; color: var(--dc-muted); }
.dcAgentPromptImageRemove {
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentImageLightbox {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: grid;
  place-items: center;
  padding: 32px;
  border: 0;
  background: rgba(8, 12, 20, .76);
  cursor: zoom-out;
  pointer-events: auto;
}
.dcAgentImageLightbox img {
  display: block;
  max-width: min(1100px, 92vw);
  max-height: 88vh;
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, .4);
}
.dcAgentPromptGroup { margin-top: 12px; }
.dcAgentPromptGroup > b { display: block; margin-bottom: 7px; font-size: 12px; }
.dcAgentPromptChoices { display: flex; flex-wrap: wrap; gap: 6px; }
.dcAgentPromptChoice input { margin: 0; }
.dcAgentPromptNote {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dc-page);
  color: var(--dc-muted);
  font-size: 12px;
  line-height: 17px;
}
.dcAgentPromptError { margin: 8px 0 0; color: light-dark(#b42318, #ff8d86); font-size: 12px; }
.dcAgentPromptActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dcAgentPromptAction {
  min-height: 34px;
  padding: 6px 13px;
  border: 1px solid var(--dc-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentPromptAction.is-primary { border-color: var(--dc-action); background: var(--dc-action); color: var(--dc-on-action); }
.dcAgentPromptAction:disabled { opacity: .5; cursor: default; }

.dcAgentHeaderAction {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: var(--dc-surface);
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentHeaderAction:hover,
.dcAgentHeaderAction:focus-visible {
  border-color: var(--dc-action);
  color: var(--dc-action);
}

.dcAgentStepper {
  display: grid;
  grid-template-columns: repeat(var(--dc-stage-count, 5), minmax(0, 1fr));
  min-width: 0;
  border-bottom: 1px solid var(--dc-border);
  background: var(--dc-surface);
}

.dcAgentStep {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 4px;
  border: 0;
  border-right: 1px solid var(--dc-border);
  border-radius: 0;
  background: transparent;
  color: var(--dc-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.dcAgentStep:last-child { border-right: 0; }
.dcAgentStep:hover { background: var(--dc-page); }
.dcAgentStep.is-active {
  color: var(--dc-action);
  background: var(--dc-selected);
}
.dcAgentStep.is-active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--dc-action);
}
.dcAgentStepIcon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
}
.dcAgentStepIcon svg { display: block; }
.dcAgentStepLabel {
  display: block;
  width: 100%;
  min-width: 0;
  line-height: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dcAgentWbBody {
  flex: 1 1 auto;
  overflow: auto;
  padding: 18px;
}

.dcAgentPane { display: flex; flex-direction: column; gap: 14px; }
.dcAgentHint { margin: 0; color: var(--dc-muted); font-size: 13px; line-height: 1.6; }

.dcAgentTextarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 132px;
  padding: 12px;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: var(--dc-surface);
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
  border: 1px solid var(--dc-border);
  border-radius: 6px;
  font-size: 12px;
  background: var(--dc-surface);
  color: inherit;
}

.dcAgentButton {
  padding: 9px 16px;
  border: 1px solid var(--dc-border);
  border-radius: 6px;
  background: var(--dc-surface);
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dcAgentButton:hover, .dcAgentButton:focus-visible { border-color: var(--dc-action); }
.dcAgentButton.is-primary {
  border-color: transparent;
  color: var(--dc-on-action);
  background: var(--dc-action);
}
.dcAgentButton.is-primary:hover, .dcAgentButton.is-primary:focus-visible { background: var(--dc-hover); }
.dcAgentButton:disabled { opacity: 0.5; cursor: not-allowed; }

.dcAgentGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.dcAgentCard {
  padding: 12px 14px;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: var(--dc-page);
}
.dcAgentCard span { display: block; color: var(--dc-muted); font-size: 12px; }
.dcAgentCard b { display: block; margin-top: 3px; font-size: 18px; }
.dcAgentCard b.is-good { color: var(--dc-success); }
.dcAgentCard b.is-warn { color: var(--dc-review); }
.dcAgentCard b.is-bad { color: light-dark(#d2454f, #ff838b); }

.dcAgentTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.dcAgentTable th, .dcAgentTable td {
  padding: 7px 9px;
  text-align: left;
  border-bottom: 1px solid var(--dc-border);
}
.dcAgentTable th { color: var(--dc-muted); font-weight: 600; }
.dcAgentTable td.num { font-variant-numeric: tabular-nums; }
.dcAgentTableWrap { max-width: 100%; overflow-x: auto; }
.dcAgentTableWrap .dcAgentTable { min-width: 720px; table-layout: auto; }
.dcAgentTableWrap .dcAgentTable th,
.dcAgentTableWrap .dcAgentTable td { min-width: 112px; white-space: nowrap; }
.dcAgentTableWrap .dcAgentTable th:first-child,
.dcAgentTableWrap .dcAgentTable td:first-child { min-width: 190px; }

.dcAgentError {
  padding: 10px 12px;
  border: 1px solid light-dark(#ffd6d8, #5b2f33);
  border-radius: 6px;
  background: light-dark(#fff0f0, #351d21);
  color: light-dark(#d2454f, #ff838b);
  font-size: 12px;
}

.dcAgentChips { display: flex; flex-wrap: wrap; gap: 6px; }
.dcAgentChip {
  padding: 4px 10px;
  border: 1px solid var(--dc-border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--dc-muted);
}
.dcAgentChip.is-selected {
  color: var(--dc-action);
  border-color: var(--dc-action);
  background: var(--dc-selected);
}
.dcAgentCheck { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.dcAgentSection {
  padding: 14px;
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: var(--dc-page);
}
.dcAgentSection h3 { margin: 0 0 8px; font-size: 13px; }
.dcAgentCandidate {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(120px, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--dc-border);
}
.dcAgentCandidate:last-child { border-bottom: 0; }
.dcAgentCandidate small { color: var(--dc-muted); }
.dcAgentProgress { height: 8px; overflow: hidden; border-radius: 99px; background: light-dark(#e8edf5, #293240); }
.dcAgentProgress > span { display: block; height: 100%; background: var(--dc-action); }

/* M3 · overlay 头部 jobs 状态 pill（轮询 /mvp/jobs，不接计费遥测）。 */
.dcAgentJobsPill {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid var(--dc-border);
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  color: var(--dc-muted);
}
.dcAgentJobsPill[data-state='running'] {
  color: var(--dc-action);
  border-color: var(--dc-action);
  background: var(--dc-selected);
}
.dcAgentJobsPill[data-state='completed'] {
  color: var(--dc-success);
  border-color: var(--dc-success);
  background: var(--dc-success-bg);
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
  border: 1px solid var(--dc-border);
  border-radius: 8px;
  background: var(--dc-page);
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
  font-size: 12px;
  color: var(--dc-muted);
  border: 1px solid var(--dc-border);
}
.dcAgentToolCardState.is-ok { color: var(--dc-success); }
.dcAgentToolCardState.is-error { color: light-dark(#d2454f, #ff838b); }
.dcAgentToolCardState.is-running { color: var(--dc-action); }
.dcAgentToolCardState.is-stopped { color: var(--dc-muted); }
.dcAgentToolCardBody {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dc-text);
}
.dcAgentHistoryTask { border: 1px solid var(--dc-border); border-radius: 6px; background: var(--dc-surface); color: inherit; font: inherit; cursor: pointer; }
.dcAgentWizardNav { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
.dcAgentWizardStep { display: flex; align-items: center; gap: 6px; padding: 7px; border: 1px solid var(--dc-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.dcAgentWizardStep b { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--dc-border); color: var(--dc-muted); }
.dcAgentWizardStep.is-active { border-color: var(--dc-action); background: var(--dc-selected); color: var(--dc-action); }
.dcAgentWizardStep.is-active b { background: var(--dc-action); color: var(--dc-on-action); }
.dcAgentWizardPane { min-height: 230px; }
.dcAgentWizardPane h4 { margin: 0 0 3px; font-size: 14px; }
.dcAgentWizardPane > p { margin: 0 0 12px; color: var(--dc-muted); font-size: 12px; line-height: 17px; }
.dcAgentPromptRules { display: grid; gap: 8px; margin-top: 14px; }
.dcAgentPromptRules label { font-size: 12px; }
.dcAgentPromptPreview { max-height: 260px; overflow: auto; margin: 10px 0 0; padding: 12px; border-radius: 8px; background: var(--dc-page); white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 12px; line-height: 18px; }
.dcAgentFormField { display: grid; gap: 6px; font-size: 12px; font-weight: 600; }
.dcAgentMappingRow { display: grid; grid-template-columns: minmax(0, 1fr) 24px minmax(180px, 1fr); align-items: center; gap: 8px; margin-top: 7px; font-size: 12px; }
.dcAgentMappingRow > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcAgentMappingRow > b { text-align: center; color: light-dark(#8792a3, #8290a5); }
.dcAgentMappingPicker summary { cursor: pointer; overflow-wrap: anywhere; }
.dcAgentMappingPicker[open] { padding: 8px; border: 1px solid var(--dc-border); border-radius: 8px; }
.dcAgentMappingPicker input, .dcAgentMappingPicker select { width: 100%; margin-top: 8px; max-width: 100%; min-width: 0; }
.dcAgentMappingRow .dcAgentButton { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.dcAgentMappingRow small { display: block; margin: 4px 0; overflow-wrap: anywhere; }
.dcAgentMappingStatus[data-status="confirmed"] { color: light-dark(#15803d, #86efac); }
.dcAgentMappingStatus[data-status="review"] { color: light-dark(#a16207, #fcd34d); }
.dcAgentMappingStatus[data-status="unmatched"] { color: light-dark(#b91c1c, #fca5a5); }
.dcAgentRulesGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.dcAgentFieldGroup { display: grid; gap: 7px; margin-top: 12px; }
.dcAgentFieldGroupHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.dcAgentFieldGroupHead > div:first-child { display: grid; gap: 2px; min-width: 0; }
.dcAgentFieldGroupHead b { font-size: 12px; }
.dcAgentFieldGroupActions { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.dcAgentFieldAction {
  padding: 2px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dc-action);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentFieldAction:hover, .dcAgentFieldAction:focus-visible { background: var(--dc-selected); }
.dcAgentPreviewTable { margin-top: 12px; overflow: auto; border: 1px solid var(--dc-border); border-radius: 8px; }
    .dcAgentArtifactList { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; min-width: 0; }
    .dcAgentArtifactList > .dcAgentButton { display: inline-flex; align-items: center; box-sizing: border-box; max-width: 100%; min-width: 0; height: auto; white-space: normal; overflow-wrap: anywhere; line-height: 1.5; text-decoration: none; }
    .dcAgentArtifactList > a.dcAgentButton { flex-basis: 100%; }
    .dcAgentPreviewTable { min-width: 0; max-width: 100%; scrollbar-gutter: stable; }
.dcAgentPreviewTable > .dcAgentTable {
  width: max-content; min-width: 100%; max-width: none;
  table-layout: auto; border-collapse: separate; border-spacing: 0;
}
.dcAgentPreviewTable > .dcAgentTable th,
.dcAgentPreviewTable > .dcAgentTable td {
  min-width: 140px; max-width: none; white-space: nowrap;
  word-break: normal; overflow-wrap: normal;
  border-right: 1px solid var(--dc-border);
}
.dcAgentPreviewTable > .dcAgentTable th:first-child,
.dcAgentPreviewTable > .dcAgentTable td:first-child { min-width: 64px; }
.dcAgentPreviewTable > .dcAgentTable th {
  position: sticky; top: 0; z-index: 2; background: var(--dc-table-head);
}
.dcAgentHistoryTask { display: block; width: 100%; padding: 10px; text-align: left; }
.dcAgentHistoryTask h3 { margin: 0; font-size: 12px; }
@media (max-width: 760px) {
  .dcAgentQccBadge, .dcAgentJobsPill { display: none; }
  .dcAgentCandidate { grid-template-columns: 1fr; }
  .dcAgentCapabilities { justify-content: flex-start; padding-inline: 12px; }
  .dcAgentCapability { min-width: 92px; }
  .dcAgentPromptBackdrop { padding: 0; }
  .dcAgentPromptPanel { width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .dcAgentWizardNav { grid-template-columns: repeat(2, 1fr); }
  .dcAgentRulesGrid { grid-template-columns: 1fr; }
  .dcAgentMappingRow { grid-template-columns: 1fr; }
  .dcAgentMappingRow > b { display: none; }
}
@media (min-width: 761px) and (max-width: 1040px) {
  .dcAgentQccBadge, .dcAgentJobsPill { display: none; }
}
@media (max-width: 360px) {
  .dcAgentStep { font-size: 11px; padding: 10px 3px; gap: 6px; }
  .dcAgentStepIcon { width: 26px; height: 26px; }
  .dcAgentStepIcon svg { width: 18px; height: 18px; }
}
/* Distinct levels: management tabs → compact task steps → working content. */
.dcAgentManagement, .dcAgentStepper { flex: none; }
.dcAgentWorkbenchContent, .dcAgentPromptPanel { font-size: 14px; line-height: 1.5; }
.dcAgentManagement { display: flex; gap: 24px; padding: 0 18px; border-bottom: 1px solid var(--dc-border); }
.dcAgentManagement .dcAgentButton { border: 0; border-bottom: 3px solid transparent; border-radius: 0; padding: 10px 0; background: transparent; }
.dcAgentManagement .dcAgentButton[aria-pressed="true"] { border-bottom-color: var(--dc-action); color: var(--dc-action); font-weight: 600; }
.dcAgentCapability { border-radius: 8px; }
.dcAgentWbBody { min-height: 0; }
.dcAgentTable th { background: var(--dc-table-head); color: var(--dc-text); }
.dcAgentTable th, .dcAgentTable td { height: 44px; box-sizing: border-box; font-size: 13px; }
.dcAgentTable tbody tr:hover { background: var(--dc-selected); }
.dcAgentSection, .dcAgentCard { background: var(--dc-surface); }
.dcAgentFieldGroup { background: var(--dc-page); padding: 12px; border-radius: 8px; }
.dcAgentPromptFieldGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 10px; }
.dcAgentPromptFieldGrid .dcAgentPromptChoice { border: 0; border-radius: 4px; min-width: 0; align-items: flex-start; font-size: 13px; }
.dcAgentFieldGroup .dcAgentChips { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.dcAgentFieldGroup .dcAgentChip { border-radius: 4px; }
.dcAgentPromptText, .dcAgentTextarea, .dcAgentField { font-size: 14px; }
.dcAgentPromptTrigger { border-radius: 6px; }
.dcAgentPromptAction.is-primary:hover:not(:disabled) { background: var(--dc-hover); }
:is(.dcAgentWorkbenchContent, .dcAgentPromptPanel, .dcAgentCapabilities, .dcAgentPromptLayer) :is(button, input, select, textarea, summary):focus-visible,
.dcAgentLauncher:focus-visible { outline: 2px solid var(--dc-action); outline-offset: 2px; }
@media (max-width: 760px) {
  [data-dc-agent-hero-title="true"] { font-size: 20px; }
  .dcAgentHeroLogo { width: 40px; height: 40px; border-radius: 8px; }
  .dcAgentPromptText, .dcAgentTextarea, .dcAgentField { font-size: 16px; }
  .dcAgentPromptFieldGrid { grid-template-columns: 1fr; }
}

`;

    /** 安装入口、会话能力按钮与右侧工作台样式。 */
    function installUiStyles() {
      if (document.querySelector(`style[data-plugin="${UI_STYLE_ID}"]`) !== null) return () => {};
      const style = document.createElement('style');
      style.dataset.plugin = UI_STYLE_ID;
      style.textContent = stylesCss;
      document.head.append(style);
      return () => { style.remove(); };
    }

    // 原始数据不进入 Host storageDomain 或模型上下文；只在当前页面按 taskId 隔离。
    const runtimeTasks = new Map();
    const workflowTaskBySession = new Map();
    const workflowTaskCreationBySession = new Map();
    const workflowOperationBySession = new Map();

    function runtimeFor(taskId, create = true) {
      const key = String(taskId || 'unassigned');
      if (!runtimeTasks.has(key) && create) {
        runtimeTasks.set(key, {
          rows: [],
          headers: [],
          source: null,
          lastCsv: { clean: null, complete: null, qcc: null, review: null },
          resultRows: { clean: null, complete: null, qcc: null },
        });
      }
      return runtimeTasks.get(key) ?? null;
    }

    function moveRuntime(fromId, toId) {
      const from = runtimeFor(fromId, false);
      if (!from || !toId || String(fromId) === String(toId)) return runtimeFor(toId);
      const target = runtimeFor(toId);
      target.rows = from.rows;
      target.sourceRows = from.sourceRows;
      target.headers = from.headers;
      target.source = from.source;
      target.lastCsv = from.lastCsv;
      target.resultRows = from.resultRows;
      runtimeTasks.delete(String(fromId || 'unassigned'));
      return target;
    }

    const STEPS = [
      { key: 'upload', label: '导入与核验', icon: 'upload' },
      { key: 'rules', label: '规则与体检', icon: 'check' },
      { key: 'match', label: '主体匹配', icon: 'search' },
      { key: 'enrich', label: '字段补全', icon: 'database' },
      { key: 'download', label: '结果下载', icon: 'table' },
    ];

    const CAPABILITIES = [
      { key: 'upload', label: '导入名单', icon: IconPaperclipOutline16, fallback: '＋' },
      { key: 'profile', label: '质量体检', icon: IconChecklistOutline14, fallback: '✓' },
      { key: 'match', label: '匹配核验', icon: IconSearchOutline16, fallback: '⌕' },
      { key: 'enrich', label: '字段补全', icon: DatabaseLogo, fallback: '▦' },
      { key: 'history', label: '任务历史', icon: IconArchiveOutline20, fallback: '◷' },
    ];

    const CLEANING_OPTIONS = [
      ['clean_name', '名称补全与规范'],
      ['deduplicate', '重复企业去重'],
      ['validate_identity', '主体标识校验'],
      ['complete_fields', '补全所选企业字段'],
    ];
    const SELF_RISK_FIELD_OPTIONS = [
      ['dishonest', '失信信息'], ['judgment_debtor', '被执行人'], ['consumption_restriction', '限制高消费'],
      ['terminated_case', '终本案件'], ['judicial_document', '裁判文书'], ['case_filing', '立案信息'],
      ['hearing_announcement', '开庭公告'], ['court_announcement', '法院公告'], ['service_notice', '送达公告'],
      ['bankruptcy_reorganization', '破产重整'], ['equity_freeze', '股权冻结'], ['judicial_auction', '司法拍卖'],
      ['valuation_inquiry', '询价评估'], ['pre_litigation_mediation', '诉前调解'], ['exit_restriction', '限制出境'],
      ['administrative_penalty', '行政处罚'], ['operating_exception', '经营异常'], ['serious_violation', '严重违法'],
      ['environmental_penalty', '环保处罚'], ['abnormal_taxpayer', '税务非正常户'], ['tax_arrears', '欠税公告'],
      ['tax_violation', '税收违法'], ['disciplinary_list', '惩戒名单'], ['default_matter', '违约事项'],
      ['guarantee', '担保信息'], ['equity_pledge_registration', '股权出质'], ['stock_pledge', '股权质押'],
      ['chattel_mortgage', '动产抵押'], ['land_mortgage', '土地抵押'], ['simple_cancellation', '简易注销'],
      ['cancellation_filing', '注销备案'], ['liquidation', '清算信息'], ['labor_arbitration', '劳动仲裁'],
      ['public_notice', '公示催告'], ['property_reward_notice', '财产悬赏公告'],
    ];
    const RELATED_RISK_FIELD_OPTIONS = [
      ['dishonest', '失信被执行人'], ['judgment_debtor', '被执行人'], ['consumption_restriction', '限制高消费'],
      ['serious_violation', '严重违法'], ['tax_violation', '税收违法'], ['administrative_penalty', '行政处罚'],
      ['bankruptcy_reorganization', '破产重整'], ['terminated_case', '终本案件'], ['equity_freeze', '股权冻结'],
      ['tax_arrears', '欠税公告'], ['operating_exception', '经营异常'],
    ];
    const RELATED_RISK_KEY_FIELD_OPTIONS = [
      ['dishonest', '失信被执行人'], ['serious_violation', '严重违法'], ['bankruptcy_reorganization', '破产重整'],
      ['tax_violation', '税收违法'], ['judgment_debtor', '被执行人'], ['terminated_case', '终本案件'],
      ['equity_freeze', '股权冻结'],
    ];
    const FIELD_GROUP_ORDER = ['company_registration', 'contact_info', 'actual_controller', 'beneficial_owners', 'company_profile', 'financial_data', 'tax_invoice_info', 'listing_info', 'import_export_credit', 'company_risk_scan', 'company_related_risk_scan'];
    const FIELD_GROUPS = [
      ['beneficial_owners', '受益所有人', [['beneficial_owner_first_name', '受益所有人名称（首条）']], 'get_beneficial_owners'],
      ['financial_data', '财务数据', [['financial_total_revenue', '营业总收入'], ['financial_total_profit', '利润总额'], ['financial_total_assets', '总资产']], 'get_financial_data'],
      // Shared contract mirror: checked against qcc-field-contracts in tests.
      ['actual_controller', '实际控制人', [
        ['actual_controller_name', '实际控制人名称'],
        ['actual_controller_direct_ratio', '实控人直接持股比例'],
        ['actual_controller_total_ratio', '实控人总持股比例'],
        ['actual_controller_voting_ratio', '实控人表决权比例'],
      ], 'get_actual_controller'],
      ['company_registration', '企业工商信息', [
        ['company_name', '企业名称'], ['credit_no', '统一社会信用代码'], ['reg_no', '注册号'],
        ['org_no', '组织机构代码'], ['tax_no', '纳税人识别号'], ['reg_status', '登记状态'],
        ['legal_rep', '法定代表人'], ['reg_capital', '注册资本'],
        ['paid_capital', '实缴资本'], ['establish_date', '成立日期'], ['company_type', '企业类型'],
        ['approval_date', '核准日期'], ['registration_authority', '登记机关'],
        ['taxpayer_qualification', '纳税人资质'], ['payment_line_no', '支付系统行号'],
        ['import_export_company_code', '进出口企业代码'], ['short_name', '企业简称'], ['english_name', '英文名'],
        ['registered_address', '注册地址'], ['mailing_address', '通信地址'], ['region', '所属地区'],
        ['business_scope', '经营范围'], ['industry_category', '国标行业'],
        ['operating_period', '营业期限'], ['company_size', '人员规模'], ['insured_count', '参保人数'],
        ['branch_insured_count', '分支机构参保人数'],
      ], 'get_company_registration_info'],
      ['company_profile', '企业简介', [
        ['qcc_industry', '企查查行业'], ['company_profile', '企业简介'],
        ['industry_chain_overview', '产业链概览'],
      ], 'get_company_profile'],
      ['contact_info', '联系方式', [
        ['contact_preferred_phone', '首选联系电话'], ['contact_phone_invalid_flag', '首选电话无效标记'],
        ['contact_phone_tags', '首选电话标签'], ['contact_preferred_email', '首选邮箱'],
        ['contact_official_website', '官方网站'], ['contact_official_website_icp', '官网 ICP 备案'],
      ], 'get_contact_info'],
      ['listing_info', '上市信息', [
        ['listing_date', '上市日期'], ['listing_short_name', '股票简称'], ['listing_stock_code', '股票代码'],
        ['listing_exchange', '上市交易所'], ['listing_board', '上市板块'], ['listing_former_short_name', '上市曾用名'],
        ['listing_total_market_value', '总市值'], ['listing_total_shares', '总股本'], ['listing_predicted_pe', '预测市盈率'],
        ['listing_float_market_value', '流通值'], ['listing_float_shares', '流通股'], ['listing_pb_ratio', '市净率'],
        ['listing_eps', 'EPS'], ['listing_voting_rights_difference', '表决权差异'],
        ['listing_registration_based', '是否注册制'],
      ], 'get_listing_info'],
      ['tax_invoice_info', '税务开票信息', [
        ['tax_company_name', '税务主体名称'], ['tax_identification_no', '税务纳税人识别号'],
        ['tax_company_type', '税务企业类型'], ['tax_business_status', '税务经营状态'],
        ['invoice_address', '开票地址'], ['invoice_phone', '开票联系电话'],
        ['invoice_bank', '开户行'], ['invoice_bank_account', '开户行账号'],
      ], 'get_tax_invoice_info'],
      ['import_export_credit', '进出口信用', [
        ['import_export_credit_no', '进出口统一社会信用代码'], ['import_export_customs', '所在地海关'],
        ['import_export_admin_division', '进出口行政区划'], ['import_export_address', '进出口备案地址'],
        ['import_export_economic_area', '经济区划'], ['import_export_trade_type', '经营类别'],
        ['import_export_statistical_economic_area', '统计经济区划'], ['import_export_industry', '进出口行业种类'],
        ['import_export_ecommerce_type', '跨境贸易电子商务类型'], ['import_export_credit_grade', '海关信用等级'],
        ['import_export_filing_date', '进出口备案日期'],
      ], 'get_import_export_credit'],
      ['company_risk_scan', '企业自身风险扫描', [
        ['risk_recorded_factor_count', '风险有记录因子数'], ['risk_no_record_factor_count', '风险无记录因子数'],
        ['risk_hit_summary', '企业自身风险命中摘要'],
        ...SELF_RISK_FIELD_OPTIONS.map(([id, label]) => [`risk_${id}_count`, `${label}条目数`]),
      ], 'get_company_risk_scan'],
      ['company_related_risk_scan', '企业关联风险扫描', [
        ['related_risk_party_count', '有风险关联方数'], ['related_risk_summary', '企业关联风险摘要'],
        ...RELATED_RISK_FIELD_OPTIONS.map(([id, label]) => [`related_risk_${id}_count`, `关联风险-${label}条目数`]),
        ...RELATED_RISK_KEY_FIELD_OPTIONS.map(([id, label]) => [`related_risk_${id}_party_count`, `关联风险-${label}命中关联方数`]),
      ], 'get_company_related_risk_scan'],
    ];
    FIELD_GROUPS.sort((a, b) => FIELD_GROUP_ORDER.indexOf(a[0]) - FIELD_GROUP_ORDER.indexOf(b[0]));
    const ENRICHMENT_OPTIONS = FIELD_GROUPS.flatMap(([, , fields]) => fields);
    const INPUT_ONLY_MAPPING_OPTIONS = [['phone', '联系电话']];
    const RESULT_FIELD_LABELS = new Map([
      ...ENRICHMENT_OPTIONS,
      ...INPUT_ONLY_MAPPING_OPTIONS,
      ['biz_status', '经营状态'],
      ['risk_tags', '风险标签'],
      ['qcc_match_status', '匹配状态'],
      ['qcc_source', '数据来源'],
      ['qcc_field_issues', '字段补全待核验原因'],
      ['qcc_error', '错误原因'],
      ['match_status', '匹配状态'],
      ['input_company', '原始企业名称'],
      ['candidate_company', '候选企业名称'],
    ]);
    const MATCH_ANCHOR_OPTIONS = [
      ['company_name', '企业名称'], ['credit_no', '统一社会信用代码'], ['reg_no', '注册号'],
    ];
    const DEFAULT_CLEANING_KEYS = ['clean_name', 'deduplicate', 'validate_identity', 'complete_fields'];
    const DEFAULT_ENRICHMENT_KEYS = ['credit_no', 'legal_rep', 'reg_capital', 'establish_date', 'reg_status'];
    const DEFAULT_SESSION_PROMPT = '请帮我清洗并补全企业名单。可点击输入框左上角「提示词生成」录入名单、上传 Excel 或图片，也可直接修改本段任务说明后开始。';
    const CLEANING_SESSION_STORAGE_KEYS = [
      'dsh.data-cleaning-agent.active-session.v2',
      'dsh.data-cleaning-agent.sessions.v1',
    ];
    const CLEANING_SESSION_EVENT = 'dsh:data-cleaning-session-ownership';
    let activeCleaningSessionId = null;
    const TASK_BINDINGS_KEY = 'dsh.data-cleaning-agent.task-bindings.v1';
    const ownedSessionId = (id) => /^session-dsh-data-cleaning-agent-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
    function readTaskBindings() {
      try {
        const value = JSON.parse(window.localStorage?.getItem(TASK_BINDINGS_KEY) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch { return {}; }
    }
    function bindTask(sessionId, taskId) {
      if (!ownedSessionId(sessionId)) return;
      try {
        const bindings = readTaskBindings();
        delete bindings[sessionId];
        bindings[sessionId] = taskId;
        window.localStorage?.setItem(TASK_BINDINGS_KEY, JSON.stringify(Object.fromEntries(Object.entries(bindings).slice(-200))));
      } catch {}
    }

    try {
      // 旧版本持久化过 sessionId；但 DSH 会复用空白新会话，无法仅凭 ID 判断入口来源。
      // 清除旧的无前缀归属标记；新的独立会话前缀可安全恢复，不认领其它智能体会话。
      for (const key of CLEANING_SESSION_STORAGE_KEYS) window.sessionStorage?.removeItem(key);
    } catch (_error) {
      // sessionStorage 可能被禁用；内存态不受影响。
    }

    function isCleaningSession(sessionId) {
      return typeof sessionId === 'string' && sessionId === activeCleaningSessionId;
    }

    function markCleaningSession(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId) return;
      activeCleaningSessionId = sessionId;
      if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent(CLEANING_SESSION_EVENT, { detail: { sessionId, active: true } }));
      }
    }

    function isKnownCleaningDraft(value) {
      if (value === DEFAULT_SESSION_PROMPT) return true;
      if (typeof value !== 'string') return false;
      const wizardDraft = value.startsWith('请执行一项企业名单数据清洗补全任务。')
        && value.includes('企查查连接、套餐额度和费用均由当前用户自己的账号承担。')
        && value.includes('提供结果和待复核清单的导出。');
      const executionDraft = value.startsWith('请执行已在「数据清洗补全工作台」确认的企业数据任务。')
        && value.includes('安全任务凭证：dcq-')
        && value.includes('data_cleaning_qcc_run');
      const imageDraft = value.startsWith('请识别我刚刚在向导中安全暂存的企业名单图片')
        && value.includes('安全图片凭证：dci-')
        && value.includes('data_cleaning_extract_image_companies');
      return wizardDraft || executionDraft || imageDraft;
    }

    function clearCleaningDraft(ctx, sessionId, onlyDefault = false) {
      if (!sessionId) return false;
      const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation;
      const shell = conversation?.input?.shell?.(sessionId);
      if (!shell || typeof shell.setDraft !== 'function') return false;
      if (onlyDefault && !isKnownCleaningDraft(shell.snapshot?.draft)) return false;
      shell.setDraft('');
      return true;
    }

    function deactivateCleaningSession(sessionId = activeCleaningSessionId) {
      if (!activeCleaningSessionId || (sessionId && sessionId !== activeCleaningSessionId)) return false;
      const previousSessionId = activeCleaningSessionId;
      activeCleaningSessionId = null;
      if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent(CLEANING_SESSION_EVENT, {
          detail: { sessionId: previousSessionId, active: false },
        }));
      }
      return true;
    }

    function useCleaningSession(sessionId) {
      const [markedSessionId, setMarkedSessionId] = react.useState(
        isCleaningSession(sessionId) ? sessionId : null,
      );
      react.useEffect(() => {
        const handleMarked = (event) => {
          const detail = event?.detail ?? {};
          setMarkedSessionId(detail.active === true && detail.sessionId === sessionId ? sessionId : null);
        };
        window.addEventListener?.(CLEANING_SESSION_EVENT, handleMarked);
        return () => window.removeEventListener?.(CLEANING_SESSION_EVENT, handleMarked);
      }, [sessionId]);
      // DSH 可能复用同一个 slot component 切换会话；状态必须绑定具体 sessionId，
      // 避免从清洗会话切回普通会话后仍残留业务首页与提示词入口。
      return markedSessionId === sessionId && isCleaningSession(sessionId);
    }

    /**
     * 以实际会话选择提交作为退出条件；点击其它入口但创建失败时，保留清洗首页、
     * 面板和用户草稿。新版本入口始终创建独立会话，不再依赖 DOM 文案推测导航。
     */
    function installSessionOwnershipBridge(ctx) {
      const releaseNewSessionBridge = installNewSessionBridge(ctx);
      let staleDraftObserver = null;
      let staleDraftObserverTimer = null;
      const clearStaleDefaultDraft = () => {
        if (activeCleaningSessionId) return false;
        const currentSessionId = ctx.sessions?.list?.getSnapshot?.()?.current;
        const cleared = clearCleaningDraft(ctx, currentSessionId, true);
        if (cleared && staleDraftObserver) {
          staleDraftObserver.disconnect();
          staleDraftObserver = null;
        }
        return cleared;
      };
      const leaveSubsystem = () => {
        const sessionId = activeCleaningSessionId;
        if (sessionId && !ownedSessionId(sessionId)) clearCleaningDraft(ctx, sessionId, true);
        deactivateCleaningSession(sessionId);
      };
      // Only our independently-created native session namespace may regain ownership.
      const initialSession = ctx.sessions?.list?.getSnapshot?.()?.current;
      if (ownedSessionId(initialSession)) markCleaningSession(initialSession);
      clearStaleDefaultDraft();
      // DSH 会在插件 apply() 之后异步恢复 composer draft。在首屏稳定期内
      // 监听 DOM 变化并仅清理完全匹配本插件默认文案，或同时命中
      // 提示词向导固定首尾与费用声明签名的草稿；不触碰用户自写内容。
      if (typeof MutationObserver === 'function' && document.documentElement) {
        staleDraftObserver = new MutationObserver(clearStaleDefaultDraft);
        staleDraftObserver.observe(document.documentElement, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        staleDraftObserverTimer = setTimeout(() => {
          staleDraftObserver?.disconnect();
          staleDraftObserver = null;
          staleDraftObserverTimer = null;
        }, 10_000);
      }
      const unsubscribe = ctx.sessions?.list?.subscribe?.((snapshot) => {
        // Store subscriptions may signal without a payload; read authoritative state.
        const selected = ctx.sessions?.list?.getSnapshot?.() ?? snapshot;
        if (!selected) return;
        const nextSessionId = selected.current;
        if (activeCleaningSessionId && nextSessionId !== activeCleaningSessionId) {
          leaveSubsystem();
        }
        if (!activeCleaningSessionId && ownedSessionId(nextSessionId)) {
          markCleaningSession(nextSessionId);
        } else if (!activeCleaningSessionId) {
          clearStaleDefaultDraft();
        }
      });
      return () => {
        releaseNewSessionBridge();
        staleDraftObserver?.disconnect();
        if (staleDraftObserverTimer !== null) clearTimeout(staleDraftObserverTimer);
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }

    function optionLabels(options, keys) {
      const selected = new Set(Array.isArray(keys) ? keys : []);
      return options.filter(([key]) => selected.has(key)).map(([, label]) => label);
    }

    /** 纯函数：把向导选择转换成可编辑、可审计的自然语言任务描述。 */
    function buildTaskPrompt(config = {}) {
      const mode = config.mode ?? 'text';
      const cleanLabels = optionLabels(CLEANING_OPTIONS, config.cleaningKeys);
      const enrichLabels = optionLabels(ENRICHMENT_OPTIONS, config.enrichmentKeys);
      const anchorLabels = optionLabels(MATCH_ANCHOR_OPTIONS, config.anchorKeys);
      const entries = Array.isArray(config.entries)
        ? config.entries.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [];
      const entryCount = Number.isFinite(config.entryCount) ? config.entryCount : entries.length;
      const source = mode === 'image'
        ? config.imageState === 'completed'
          ? `图片${config.fileName ? `「${config.fileName}」` : ''}，已由企查查智能文档解析识别并人工核验 ${entryCount} 条主体标识`
          : `图片${config.fileName ? `「${config.fileName}」` : ''}，已安全暂存在本机 Host，等待企查查智能文档解析识别`
        : mode === 'excel'
          ? `本地表格${config.fileName ? `「${config.fileName}」` : ''}，已解析 ${entryCount} 条主体标识，完整数据已载入数据清洗补全工作台`
          : `手工录入，共 ${entryCount} 条主体标识`;
      const lines = [
        '请执行一项企业名单数据清洗补全任务。',
        `输入来源：${source}。`,
      ];
      if (mode === 'image' && config.imageCommandId && config.imageState !== 'completed') {
        lines.push('请先通过企查查智能文档解析提取图片中的企业全称、18 位统一社会信用代码或注册号；模糊字符不得猜测。识别结果回传数据清洗补全工作台供我核验，然后沿用本任务已经选择的匹配规则、清洗要求和补全字段。');
        lines.push(`安全图片凭证：${config.imageCommandId}。请只调用一次 data_cleaning_extract_image_companies，参数只传 commandId；该高层工具会在 Host 内调用 qcc-document-mcp 的 parse_document / get_parse_result，不要直接调用底层 mcp__qcc-document* 工具。`);
      }
      if (entries.length) {
        lines.push(`${mode === 'excel' ? '主体预览' : '待处理主体'}：\n${entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}`);
      }
      lines.push(`清洗要求：${cleanLabels.length ? cleanLabels.join('、') : '仅解析，不自动修改'}。`);
      lines.push(`需要补全的字段 / 维度：${enrichLabels.length ? enrichLabels.join('、') : '不调用外部补全，仅输出本地清洗结果'}。`);
      if (mode === 'excel' && config.headers?.length) {
        const pairs = config.mappings || [];
        lines.push(`原表共 ${config.headers.length} 列。新文件原列补空映射：${pairs.map((item) => `「${item.sourceField}」←${resultFieldLabel(item.targetField)}`).join('；') || '暂无'}。`);
        const skipped = config.headers.filter((header) => !pairs.some((item) => item.sourceField === header));
        if (skipped.length) lines.push(`暂不补全的原列：${skipped.join('、')}；保留原值，不猜测或用相近指标替代。`);
        const added = (config.enrichmentKeys || []).filter((id) => !pairs.some((item) => item.targetField === id));
        lines.push(`仅补已确认原列的空白单元格，保留非空值（含 0）。多个原列可共用一个补全字段，查询按主体与工具去重。额外新增字段：${added.map(resultFieldLabel).join('、') || '无'}。`);
      }
      lines.push(`处理规则：优先使用${anchorLabels.length ? anchorLabels.join('、') : '企业名称、统一社会信用代码或注册号'}精确匹配；${config.matchRules?.manualReviewAmbiguous === false ? '精确匹配失败时直接输出未匹配记录' : '精确匹配失败时再进入模糊候选，存在多个候选必须暂停并让我确认，不得默认选择第一项'}。`);
      lines.push('发送即确认执行工作台已配置的范围，不再重复确认额度或写回。企查查连接、套餐额度和费用均由当前用户自己的账号承担。缺失或无权限字段请留空并标记原因，不得编造。');
      lines.push('交付方式：Host 自动生成新的清洗补全结果 XLSX，在工作台下载。不得修改上传源文件，不索要本地路径，不使用 Bash 或另行编写导出脚本。');
      lines.push('完成后保留来源原值、标准主体、匹配状态与字段来源，并提供结果和待复核清单的导出。');
      return lines.join('\n\n');
    }

    function entriesToDataset(entries) {
      // 文本向导允许企业名称和信用代码混输。统一为一个检索锚点列，避免 G5 Bridge
      // 只能选择单一 nameField 时遗漏信用代码行；QCC entity lookup 对两者均可检索。
      const rows = (Array.isArray(entries) ? entries : [])
        .map((value) => ({ 主体标识: String(value ?? '').trim() }))
        .filter((row) => row.主体标识);
      return {
        ok: true,
        fmt: 'text',
        headers: ['主体标识'],
        rowCount: rows.length,
        rows,
        preview: rows.slice(0, 5),
      };
    }

    /**
     * 工作台粘贴区兼容「每行一个企业名称 / 信用代码」。
     * 无分隔符且首行不是显式表头时，不得把第一家企业误当 CSV 表头。
     */
    function plainEntityListDataset(text) {
      const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length || lines.some((line) => /[,\t;]/.test(line))) return null;
      const explicitHeader = /^(?:name|company|company_name|credit_no|creditcode|unified_credit_code|主体标识|企业名称|公司名称|单位名称|统一社会信用代码|信用代码|注册号)$/i;
      if (explicitHeader.test(lines[0])) return null;
      return entriesToDataset(lines);
    }

    function resultFieldLabel(key) {
      return RESULT_FIELD_LABELS.get(String(key ?? '')) ?? String(key ?? '');
    }

    const MAPPING_ALIASES = {
      beneficial_owner_first_name: ['首条受益所有人名称'],
      actual_controller_name: ['实控人', '实际控制人', '企业实控人名称', '企业实际控制人', '企业实控人名称（自然人请填写姓名）'],
      actual_controller_direct_ratio: ['实际控制人直接持股比例'],
      actual_controller_total_ratio: ['实际控制人总持股比例'],
      actual_controller_voting_ratio: ['实际控制人表决权比例'],
      company_name: ['name', 'company', '公司名称', '单位名称', '企业全称', '公司全称', '主体标识'],
      credit_no: ['creditCode', 'unified_credit_code', '信用代码', '社会信用代码', '统一信用代码', 'USCC'],
      reg_no: ['registration_no', '工商注册号'],
      legal_rep: ['法定代表', '法人代表', 'legalRepresentative', 'legal_person'],
      reg_capital: ['注册资金'], establish_date: ['成立时间', '企业成立日期', 'establishmentDate'],
      reg_status: ['工商登记状态'], registered_address: ['企业注册地址', '公司注册地址'],
      phone: ['mobile', 'tel', 'telephone', '电话', '手机号码', '手机号'],
      contact_official_website: ['官网', '企业官网', '官方网站地址'],
      contact_preferred_email: ['首选电子邮箱'],
    };
    // 语义不完全等同：只推荐，绝不冒充精确匹配或发起调用。
    const MAPPING_HINTS = {
      受益人: ['beneficial_owner_first_name'], 受益所有人: ['beneficial_owner_first_name'], 受益所有人名称: ['beneficial_owner_first_name'], UBO: ['beneficial_owner_first_name'],
      主营业务收入: ['financial_total_revenue'],
      地址: ['registered_address', 'mailing_address', 'invoice_address'],
      address: ['registered_address', 'mailing_address'],
      企业地址: ['registered_address', 'mailing_address'], 公司地址: ['registered_address', 'mailing_address'],
      网址: ['contact_official_website'], website: ['contact_official_website'],
      开业时间: ['establish_date'], 开业日期: ['establish_date'],
      企业状态: ['reg_status'], 所属行业: ['industry_category', 'qcc_industry'],
      行业: ['industry_category', 'qcc_industry'],
      法人: ['legal_rep'], 邮箱: ['contact_preferred_email'], email: ['contact_preferred_email'],
    };
    function normalizeMappingLabel(value) {
      return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s_\-·]/g, '');
    }
    function mappingRecommendations(headers, fields = [...ENRICHMENT_OPTIONS, ...INPUT_ONLY_MAPPING_OPTIONS]) {
      const rows = (Array.isArray(headers) ? headers : []).map((sourceField) => {
        const label = normalizeMappingLabel(String(sourceField).replace(/（重复列 \d+）$/, '').replace(/\s*YYYY[-/]MM[-/]DD\s*$/i, ''));
        let candidates = fields.filter(([id, name]) => [id, name].some((value) => normalizeMappingLabel(value) === label));
        let reason = '标准字段名匹配';
        if (!candidates.length) {
          candidates = fields.filter(([id]) => (MAPPING_ALIASES[id] || []).some((value) => normalizeMappingLabel(value) === label));
          reason = '常用别名匹配';
        }
        const exact = candidates.length === 1;
        if (!candidates.length) {
          const hints = Object.entries(MAPPING_HINTS).find(([key]) => normalizeMappingLabel(key) === label)?.[1] || [];
          candidates = hints.flatMap((key) => fields.filter(([id]) => id === key));
          reason = candidates.length ? '含义需确认，点击推荐后采用' : '未识别表头，请手动选择';
          if (candidates.length && label === normalizeMappingLabel('主营业务收入')) reason = '主营业务收入与营业总收入口径不同；确认接受该口径后采用';
          if (candidates.length && label === normalizeMappingLabel('受益人')) reason = '受益人含义需确认；仅取首条受益所有人，不代表唯一或最大受益人';
        }
        return { sourceField: String(sourceField), candidates, automatic: exact, reason };
      });
      for (const row of rows) {
        if (row.automatic && rows.filter((other) => other.automatic && other.candidates[0][0] === row.candidates[0][0]).length > 1) {
          row.conflict = true;
          row.reason = '多列推荐同一字段，请选择其中一列；其他列保留原值';
        }
      }
      return rows.map((row) => ({ ...row, automatic: row.automatic && !row.conflict }));
    }
    function guessMappings(headers, fields) {
      return mappingRecommendations(headers, fields).filter((row) => row.automatic)
        .map((row) => ({ sourceField: row.sourceField, targetField: row.candidates[0][0] }));
    }
    function mergeRecommendedMappings(headers, mappings, fields) {
      const output = [...mappings];
      for (const item of guessMappings(headers, fields)) {
        if (!output.some((current) => current.sourceField === item.sourceField || current.targetField === item.targetField)) output.push(item);
      }
      return output;
    }

    const isAnchorField = (id) => ['company_name', 'credit_no', 'reg_no'].includes(id);
    function mappedOutputFields(mappings) {
      return [...new Set(mappings.map((item) => item.targetField))].filter((id) => ENRICHMENT_OPTIONS.some(([key]) => key === id));
    }
    function syncMappedSelection(previous, next, selected) {
      const old = new Set(mappedOutputFields(previous));
      return [...new Set([...selected.filter((id) => !old.has(id)), ...mappedOutputFields(next)])];
    }
    function updateColumnMapping(mappings, sourceField, targetField) {
      if (isAnchorField(targetField) && mappings.some((item) => item.sourceField !== sourceField && item.targetField === targetField)) return mappings;
      return [...mappings.filter((item) => item.sourceField !== sourceField), ...(targetField ? [{ sourceField, targetField }] : [])];
    }

    function MappingPicker({ sourceField, mappings, groups, recommendation, onChange }) {
      const [query, setQuery] = react.useState('');
      const [category, setCategory] = react.useState('');
      const value = mappings.find((item) => item.sourceField === sourceField)?.targetField || '';
      const occupied = (id) => isAnchorField(id) && mappings.some((item) => item.sourceField !== sourceField && item.targetField === id);
      const fields = groups.flatMap(([, , items]) => items);
      const label = fields.find(([id]) => id === value)?.[1] || '不参与匹配 / 补全';
      const matches = (id, name) => normalizeMappingLabel([id, name, ...(MAPPING_ALIASES[id] || []), ...Object.entries(MAPPING_HINTS).filter(([, ids]) => ids.includes(id)).map(([hint]) => hint)].join(' ')).includes(normalizeMappingLabel(query));
      const filteredGroups = groups.filter(([id]) => !category || id === category)
        .map(([id, title, items]) => [id, title, items.filter(([key, name]) => matches(key, name))])
        .filter(([, , items]) => items.length);
      const filteredFields = filteredGroups.flatMap(([, , items]) => items);
      const hiddenSelection = value && !filteredFields.some(([id]) => id === value);
      return h('div', { className: 'dcAgentMappingRow' },
        h('span', { title: sourceField }, sourceField), h('b', { 'aria-hidden': 'true' }, '→'),
        h('div', { style: { minWidth: 0 } },
          h('details', { className: 'dcAgentMappingPicker', onKeyDown: (event) => {
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.preventDefault(); event.stopPropagation();
              event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus();
            }
          } },
            h('summary', { className: 'dcAgentField', 'aria-label': `${sourceField} 当前映射` }, label),
            h('input', { className: 'dcAgentField', value: query, placeholder: '模糊搜索字段名称 / 英文键 / 别名', 'aria-label': `${sourceField} 搜索映射字段`, onChange: (event) => setQuery(event.target.value) }),
            h('select', { className: 'dcAgentField', value: category, 'aria-label': `${sourceField} 映射大类`, onChange: (event) => setCategory(event.target.value) },
              h('option', { value: '' }, '全部维度'),
              groups.map(([id, title]) => h('option', { key: id, value: id }, title))),
            h('select', { className: 'dcAgentField', size: 8, style: { height: 'auto', minHeight: '180px' }, value, 'aria-label': `${sourceField} 字段映射`, onChange: (event) => {
              onChange(sourceField, event.target.value);
              const details = event.currentTarget.closest('details');
              if (details) { details.open = false; details.querySelector('summary')?.focus(); }
            } },
              h('option', { value: '' }, '不参与匹配 / 补全'),
              hiddenSelection ? h('option', { value, disabled: true }, `当前选择：${label}（不符合筛选，保持不变）`) : null,
              filteredGroups.map(([id, title, items]) => h('optgroup', { key: id, label: title }, items.map(([key, name]) =>
                h('option', { key, value: key, disabled: occupied(key) }, `${name}${occupied(key) ? '（已被其他列使用）' : ''}`)))),
            ),
            h('p', { className: 'dcAgentHint', role: 'status' }, filteredFields.length ? `匹配 ${filteredFields.length} 个字段；选择后采用。` : '无匹配字段；当前选择保持不变。'),
          ),
          value === 'beneficial_owner_first_name' || value.startsWith('financial_') ? h('p', { className: 'dcAgentHint' }, value === 'beneficial_owner_first_name' ? '仅取返回首条受益所有人，不代表唯一或最大受益人。' : '取返回首个报告期，不跨期补值；报告期保留在结果取值说明中。') : null,
          h('small', { className: 'dcAgentMappingStatus', 'data-status': value ? 'confirmed' : recommendation.candidates.length ? 'review' : 'unmatched',
            style: { display: 'block', padding: '6px 0' } },
            value ? `${recommendation.automatic && recommendation.candidates[0]?.[0] === value ? '自动通过' : '已确认'}：${label}；可手动调整` : recommendation.candidates.length ? `待人工确认：${recommendation.conflict ? '重复列可确认使用同一补全字段；主体标识只选一列' : recommendation.reason}` : '未匹配：保留原列，可手动选择字段'),
          !value && recommendation.candidates.length ? h('div', { className: 'dcAgentRow', 'aria-label': `${sourceField} 推荐映射` }, recommendation.candidates.map(([id, name]) =>
            h('button', { key: id, type: 'button', className: 'dcAgentButton', disabled: occupied(id), onClick: () => onChange(sourceField, id) }, `推荐：${name}${occupied(id) ? '（已占用）' : ''}`))) : null,
        ),
      );
    }

    function projectCompletionResult({ rows = [], headers = [], mappings = [], fieldSelection = [] } = {}) {
      const sourceHeaders = [...new Set(headers)];
      const selected = [...new Set(fieldSelection)];
      const pairs = mappings.filter((item) => sourceHeaders.includes(item.sourceField) && selected.includes(item.targetField)
        && mappings.filter((other) => other.sourceField === item.sourceField).length === 1);
      const hidden = new Set(pairs.filter((item) => item.sourceField !== item.targetField && !sourceHeaders.includes(item.targetField)).map((item) => item.targetField));
      const blank = (value) => value == null || (typeof value === 'string' && value.trim() === '');
      const output = rows.map((row) => {
        const next = { ...row };
        const status = row.qcc_match_status;
        if (!status || ['enriched', 'exact'].includes(status)) {
          for (const { sourceField, targetField } of pairs) {
            if (blank(row[sourceField]) && !blank(row[targetField])) next[sourceField] = row[targetField];
          }
        }
        for (const key of hidden) delete next[key];
        return next;
      });
      return {
        rows: output,
        headers: [...new Set([...sourceHeaders, ...selected, ...output.flatMap((row) => Object.keys(row))])].filter((key) => !hidden.has(key)),
      };
    }

    function qualitySummaryFor(rows, mappings) {
      const list = Array.isArray(rows) ? rows : [];
      const anchors = (Array.isArray(mappings) ? mappings : []).filter((mapping) => ['company_name', 'credit_no', 'reg_no'].includes(mapping.targetField));
      const signatures = new Set();
      let missingAnchor = 0;
      let duplicates = 0;
      let invalidCreditNo = 0;
      let invalidPhone = 0;
      let emptyFields = 0;
      const creditSource = mappings?.find((mapping) => mapping.targetField === 'credit_no')?.sourceField;
      const phoneSource = mappings?.find((mapping) => mapping.targetField === 'phone')?.sourceField;
      for (const row of list) {
        const values = anchors.map((mapping) => String(row?.[mapping.sourceField] ?? '').trim()).filter(Boolean);
        if (!values.length) missingAnchor += 1;
        const signature = values.join('|').toUpperCase();
        if (signature && signatures.has(signature)) duplicates += 1;
        if (signature) signatures.add(signature);
        const credit = creditSource ? String(row?.[creditSource] ?? '').trim() : '';
        if (credit && !/^[0-9A-Z]{18}$/.test(credit)) invalidCreditNo += 1;
        const phone = phoneSource ? String(row?.[phoneSource] ?? '').replace(/[\s-]/g, '') : '';
        if (phone && !/^(?:\+?86)?(?:1\d{10}|0\d{9,11})$/.test(phone)) invalidPhone += 1;
        emptyFields += Object.values(row ?? {}).filter((value) => String(value ?? '').trim() === '').length;
      }
      return {
        total: list.length,
        valid: Math.max(0, list.length - missingAnchor),
        missingAnchor,
        duplicates,
        invalidCreditNo,
        invalidPhone,
        emptyFields,
      };
    }

    /** 同源 Host API；保留旧 api(path, body) 调用，同时为工作流开放 PATCH。 */
    async function requestJson(path, method = 'GET', body) {
      const res = await fetch(path, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const payload = await res.json();
      if (res.ok === false || payload?.ok === false) {
        const error = new Error(payload?.message || payload?.error || `Host request failed (${res.status})`);
        error.code = payload?.code;
        throw error;
      }
      return payload;
    }

    async function api(path, body) {
      return requestJson(path, body === undefined ? 'GET' : 'POST', body);
    }

    async function waitForQccCommand(commandId, attempts = 180, onStatus, isActive = () => true) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (!isActive()) return null;
        const response = await api(`/data-cleaning/api/g5/commands/${encodeURIComponent(commandId)}`);
        if (!isActive()) return null;
        const command = response?.command;
        await onStatus?.(command);
        if (command?.state === 'completed' || command?.state === 'failed') return command;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const error = new Error('等待智能体执行企查查任务超时；可稍后从任务历史恢复结果。');
      error.code = 'QCC_COMMAND_TIMEOUT';
      throw error;
    }

    function workflowDisplayName(task) {
      if (task.title && !task.title.startsWith('企业数据清洗补全任务')) return task.title;
      const base = task.source?.fileName?.replace(/\.[^.]+$/, '') || (task.source?.type === 'image' ? '图片名单' : '粘贴名单');
      const date = task.createdAt ? new Date(task.createdAt) : null;
      const time = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : '';
      return `${base}｜${task.source?.rowCount ?? 0} 条${time ? '｜' + time : ''}`;
    }
    function cacheWorkflowTask(actions, sessionId, task) {
      if (!task) return null;
      if (sessionId) workflowTaskBySession.set(String(sessionId), task);
      bindTask(sessionId, task.id);
      actions.setWorkflowTask(task);
      if (task.title) actions.setTaskTitle(task.title);
      if (Array.isArray(task.objectives)) actions.setObjectives(task.objectives);
      if (Array.isArray(task.mappings)) actions.setMappings(task.mappings);
      if (Array.isArray(task.fieldSelection)) actions.setFieldSelection(task.fieldSelection);
      for (const [key, value] of Object.entries(task.matchRules || {})) actions.setMatchRule(key, value);
      return task;
    }

    async function createWorkflowTask(actions, sessionId, draft = {}) {
      const key = String(sessionId || 'unassigned');
      let pending = workflowTaskCreationBySession.get(key);
      if (!pending) {
        pending = requestJson('/data-cleaning/api/workflow/tasks', 'POST', {
          title: draft.title || '企业数据清洗补全任务',
          objectives: draft.objectives || DEFAULT_CLEANING_KEYS,
          fieldSelection: draft.fieldSelection || DEFAULT_ENRICHMENT_KEYS,
          mappings: draft.mappings || [],
          matchRules: draft.matchRules,
        });
        workflowTaskCreationBySession.set(key, pending);
        const clearPending = () => {
          if (workflowTaskCreationBySession.get(key) === pending) workflowTaskCreationBySession.delete(key);
        };
        pending.then(clearPending, clearPending);
      }
      const response = await pending;
      moveRuntime(`session:${key}`, response.task.id);
      return cacheWorkflowTask(actions, sessionId, response.task);
    }

    async function ensureWorkflowTask(actions, sessionId, draft = {}, restoreStage = true) {
      const key = String(sessionId || 'unassigned');
      const cached = workflowTaskBySession.get(key);
      if (cached) return cacheWorkflowTask(actions, sessionId, cached);
      const saved = readTaskBindings()[key];
      if (ownedSessionId(key) && /^dcw-[a-zA-Z0-9-]+$/.test(saved || '')) {
        const response = await requestJson(`/data-cleaning/api/workflow/tasks/${encodeURIComponent(saved)}`);
        const task = cacheWorkflowTask(actions, sessionId, response.task);
        if (restoreStage) actions.setStep(task.stage || 'upload');
        return task;
      }
      return createWorkflowTask(actions, sessionId, draft);
    }

    const EDITABLE_WORKFLOW_STATES = new Set(['draft', 'uploaded', 'parse_failed']);

    /**
     * 完成 / 已确认规则的任务不能就地改写。用户再次录入名单时，
     * 在同一清洗会话内自动创建新 taskId，避免把新名单写入旧任务。
     */
    async function ensureEditableWorkflowTask(actions, sessionId, draft = {}, preferredTask) {
      const key = String(sessionId || 'unassigned');
      const current = workflowTaskBySession.get(key) ?? preferredTask ?? null;
      if (!current) return createWorkflowTask(actions, sessionId, draft);
      if (EDITABLE_WORKFLOW_STATES.has(current.state)) return cacheWorkflowTask(actions, sessionId, current);
      workflowTaskBySession.delete(key);
      actions.resetRunForNewDataset?.();
      return createWorkflowTask(actions, sessionId, draft);
    }

    /** 同一会话的 Host 写操作串行化，确保 expectedRevision 不因 UI 事件竞态失效。 */
    function queueWorkflowOperation(sessionId, operation) {
      const key = String(sessionId || 'unassigned');
      const previous = workflowOperationBySession.get(key) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(operation);
      workflowOperationBySession.set(key, next);
      const clear = () => {
        if (workflowOperationBySession.get(key) === next) workflowOperationBySession.delete(key);
      };
      next.then(clear, clear);
      return next;
    }

    async function updateWorkflowTask(actions, sessionId, task, input) {
      const latest = workflowTaskBySession.get(String(sessionId || 'unassigned')) ?? task;
      if (!latest) return ensureWorkflowTask(actions, sessionId, input);
      const response = await requestJson(`/data-cleaning/api/workflow/tasks/${encodeURIComponent(latest.id)}`, 'PATCH', {
        ...input,
        expectedRevision: latest.revision,
      });
      return cacheWorkflowTask(actions, sessionId, response.task);
    }

    async function workflowAction(actions, sessionId, task, action, input = {}) {
      const latest = workflowTaskBySession.get(String(sessionId || 'unassigned')) ?? task;
      if (!latest) throw new Error('请先创建数据清洗补全任务。');
      const response = await requestJson(`/data-cleaning/api/workflow/tasks/${encodeURIComponent(latest.id)}/actions/${action}`, 'POST', {
        ...input,
        expectedRevision: latest.revision,
      });
      return cacheWorkflowTask(actions, sessionId, response.task);
    }

    async function stageConfirmedWorkflow(actions, sessionId, expected = null) {
      const host = await requestJson('/data-cleaning/api/g5/capabilities');
      if (host?.workflowExecutionVersion !== 1) throw new Error('页面与 Host 版本不一致。请保存任务后升级并完整重启 DSH；当前 Host 不支持自动生成结果文件。');
      let task = await ensureWorkflowTask(actions, sessionId);
      if (expected) {
        const sameSet = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
        if (!sameSet(task.fieldSelection, expected.enrichmentKeys)
          || (expected.mode === 'excel' && (task.source?.fileName !== expected.fileName
            || task.source?.rowCount !== expected.entryCount
            || JSON.stringify(task.mappings) !== JSON.stringify(expected.mappings)))) {
          throw new Error('工作台保存的范围与向导不一致，请重试确认；未生成执行凭证。');
        }
      }
      const runtime = runtimeFor(task.id, false);
      if (!task.fieldSelection?.length) throw new Error('当前未选择企查查补全字段。请在规则页选择补全字段，或使用工作台本地清洗与结果导出；不会发起企查查调用。');
      if (!runtime?.rows?.length) throw new Error('Host 名单尚未载入，请先解析数据。');
      if (task.state === 'uploaded') task = await workflowAction(actions, sessionId, task, 'rules', {
        objectives: task.objectives, fieldSelection: task.fieldSelection, mappings: task.mappings, matchRules: task.matchRules,
      });
      if (task.state === 'rules_confirmed') task = await workflowAction(actions, sessionId, task, 'quality', {
        summary: qualitySummaryFor(runtime.rows, task.mappings),
      });
      const response = await requestJson('/data-cleaning/api/g5/commands', 'POST', {
        kind: 'enrich', workflowOwned: true, expectedRevision: task.revision, taskId: task.id,
        rows: runtime.rows, headers: runtime.headers, fieldSelection: task.fieldSelection,
      });
      if (!response.command?.commandId || !response.command?.prompt) throw new Error('Host 未返回执行凭证；未发送任务。');
      return response.command;
    }

    async function refreshHostedTask(actions, sessionId, taskId, run, navigate = true) {
      const response = await requestJson(`/data-cleaning/api/workflow/tasks/${encodeURIComponent(taskId)}`);
      const selectedTask = workflowTaskBySession.get(String(sessionId));
      if (selectedTask && selectedTask.id !== taskId) return response.task;
      if (selectedTask && selectedTask.revision > response.task.revision) return selectedTask;
      workflowTaskBySession.set(String(sessionId), response.task);
      bindTask(sessionId, taskId);
      if (isCleaningSession(sessionId)) {
        if (!run && response.task.qccRunId && ['review_required', 'partial'].includes(response.task.state)) {
          try { run = await requestJson(`/data-cleaning/api/g5/run/${encodeURIComponent(response.task.qccRunId)}`); }
          catch { actions.setError('Host 中的候选或重试数据已失效。已有结果仍可下载；重新查询需新建任务，不会自动重复扣量。'); }
        }
        if (!isCleaningSession(sessionId) || workflowTaskBySession.get(String(sessionId))?.id !== taskId) return response.task;
        cacheWorkflowTask(actions, sessionId, response.task);
        if (run) {
          actions.setQccRun(run);
          const runtime = runtimeFor(taskId);
          runtime.resultRows.qcc = run.rows;
          if (!runtime.rows.length) { runtime.rows = run.rows; runtime.headers = response.task.source?.headers || run.headers || []; }
        }
        if (navigate) actions.setStep(response.task.stage || 'upload');
      }
      return response.task;
    }
    let commandWatchGeneration = 0;
    function watchHostedCommand(actions, sessionId, command) {
      const generation = commandWatchGeneration;
      const isActive = () => generation === commandWatchGeneration;
      let openedForExecution = false;
      const ownerVisible = () => typeof document === 'undefined' || [...document.querySelectorAll('.dcAgentExperience')].some(node => node.dataset.sessionId === sessionId);
      void waitForQccCommand(command.commandId, 1800, async (status) => {
        if (!status || status.state === 'prepared') return;
        await refreshHostedTask(actions, sessionId, command.taskId, null, true).catch(() => {});
        if (!openedForExecution && ownerVisible() && isCleaningSession(sessionId) && workflowTaskBySession.get(String(sessionId))?.id === command.taskId) {
          openedForExecution = true;
          openWorkbench(actions, workflowTaskBySession.get(String(sessionId))?.stage || 'match', sessionId);
        }
        if (isCleaningSession(sessionId) && workflowTaskBySession.get(String(sessionId))?.id === command.taskId) actions.setCommandProgress?.({ taskId: command.taskId, ...status.progress });
      }, isActive).then(async (completed) => {
        if (!completed || !isActive()) return;
        await refreshHostedTask(actions, sessionId, command.taskId, completed.run);
        if (completed.state === 'failed') throw new Error(completed.error?.message || 'Host 执行失败，请在工作台查看状态。');
      }).catch((error) => {
        if (isActive() && isCleaningSession(sessionId)) actions.setError(error.message || String(error));
      });
    }

    /** 工作台 store：入口按钮与工作台共享 open，并保存当前 taskId 的可持久化 UI 元数据。 */
    function createWorkbenchStore() {
      return defineStore({
        init: () => ({
          open: false,
          step: 'upload',
          busy: false,
          error: null,
          input: '',
          workflowContract: null,
          workflowTask: null,
          workflowTasks: [],
          taskTitle: '企业数据清洗补全任务',
          mappings: [],
          objectives: [...DEFAULT_CLEANING_KEYS],
          fieldSelection: [...DEFAULT_ENRICHMENT_KEYS],
          matchRules: { normalizeNames: true, preferCreditNo: true, deduplicate: true, manualReviewAmbiguous: true },
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
          activeSessionId: null,
          jobs: [],        // 后台任务列表（/mvp/jobs 轮询），仅用于状态 pill，不接计费遥测
        }),
        actions: {
          open: (draft) => { draft.open = true; },
          openAt: (draft, step, sessionId) => {
            draft.open = true;
            if (step) draft.step = step;
            if (sessionId) draft.activeSessionId = sessionId;
          },
          close: (draft) => { draft.open = false; },
          setStep: (draft, step) => { draft.step = step; },
          setActiveSession: (draft, sessionId) => { draft.activeSessionId = sessionId ?? null; },
          setBusy: (draft, busy) => { draft.busy = busy; },
          setError: (draft, error) => { draft.error = error; },
          setInput: (draft, input) => { draft.input = input; },
          setWorkflowContract: (draft, value) => { draft.workflowContract = value; },
          setCommandProgress: (draft, value) => { draft.commandProgress = value; },
          setWorkflowTask: (draft, value) => {
            draft.workflowTask = value ?? null;
            if (value) draft.workflowTasks = [value, ...(draft.workflowTasks || []).filter(task => task.id !== value.id)];
          },
          setWorkflowTasks: (draft, value) => {
            const cached = new Map((draft.workflowTasks || []).map(task => [task.id, task]));
            draft.workflowTasks = (Array.isArray(value) ? value : []).map(task =>
              (cached.get(task.id)?.revision ?? -1) > (task.revision ?? -1) ? cached.get(task.id) : task);
          },
          setTaskTitle: (draft, value) => { draft.taskTitle = String(value ?? ''); },
          setMappings: (draft, value) => {
            const next = Array.isArray(value) ? value : [];
            draft.fieldSelection = syncMappedSelection(draft.mappings, next, draft.fieldSelection);
            draft.mappings = next;
          },
          setMapping: (draft, sourceField, targetField) => {
            const mappings = updateColumnMapping(draft.mappings, sourceField, targetField);
            draft.fieldSelection = syncMappedSelection(draft.mappings, mappings, draft.fieldSelection);
            draft.mappings = mappings;
          },
          setObjectives: (draft, value) => { draft.objectives = Array.isArray(value) ? value : []; },
          toggleObjective: (draft, value) => {
            const selected = new Set(draft.objectives);
            if (selected.has(value)) selected.delete(value); else selected.add(value);
            draft.objectives = [...selected];
          },
          setFieldSelection: (draft, value) => { draft.fieldSelection = Array.isArray(value) ? value : []; },
          toggleField: (draft, value) => {
            const selected = new Set(draft.fieldSelection);
            if (selected.has(value)) selected.delete(value); else selected.add(value);
            draft.fieldSelection = [...selected];
          },
          setMatchRule: (draft, key, value) => { draft.matchRules = { ...draft.matchRules, [key]: Boolean(value) }; },
          resetWorkflow: (draft) => {
            draft.step = 'upload';
            draft.workflowTask = null;
            draft.taskTitle = '企业数据清洗补全任务';
            draft.mappings = [];
            draft.objectives = [...DEFAULT_CLEANING_KEYS];
            draft.fieldSelection = [...DEFAULT_ENRICHMENT_KEYS];
            draft.matchRules = { normalizeNames: true, preferCreditNo: true, deduplicate: true, manualReviewAmbiguous: true };
            draft.dataset = null;
            draft.profile = null;
            draft.clean = null;
            draft.complete = null;
            draft.qccEstimate = null;
            draft.qccRun = null;
            draft.paidConfirmed = false;
            draft.error = null;
          },
          resetRunForNewDataset: (draft) => {
            draft.profile = null;
            draft.clean = null;
            draft.complete = null;
            draft.qccEstimate = null;
            draft.qccRun = null;
            draft.paidConfirmed = false;
            draft.error = null;
          },
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

    /**
     * DSH 当前没有公开的「新会话与工作区之间」list slot。和 MCP连接器一样，
     * footer slot 只托管生命周期；真实入口只依赖稳定 data-slot Portal 到工作区前。
     */
    function ensureTopLauncherMount() {
      const workspaceSlot = document.querySelector(SIDEBAR_WORKSPACES_SELECTOR);
      const parent = workspaceSlot && workspaceSlot.parentElement;
      if (!workspaceSlot || !parent) return null;
      let mount = parent.querySelector(TOP_MOUNT_SELECTOR);
      if (!mount) {
        mount = document.createElement('div');
        mount.dataset.dataCleaningTopMount = 'true';
        mount.className = 'dcAgentTopMount';
      }
      // 不与 MCP连接器各自的 MutationObserver 争抢「紧邻工作区」位置：首次挂载后
      // 保持稳定顺序。MCP连接器会占据紧邻工作区的位置，本入口自然位于它上方。
      if (mount.parentElement !== parent) parent.insertBefore(mount, workspaceSlot);
      return mount;
    }

    // rc/alpha 兼容边界：原生 startSession 会复用工作区内的空白会话。
    // 只在清洗会话激活时替换此动作，创建普通会话；不改 connectWorkspace 或全局点击。
    function installNewSessionBridge(ctx, navigation) {
      if (!navigation && typeof ctx.inject === 'function') {
        const legacy = typeof ctx.workspaces?.startSession === 'function'
          ? installNewSessionBridge(ctx, ctx.workspaces) : () => {};
        const fiber = ctx.inject(['uiWorkspace'], scope => {
          scope.effect(() => installNewSessionBridge(scope, scope.uiWorkspace), 'data-cleaning-agent: native new session');
        });
        return () => { legacy(); fiber?.dispose?.(); };
      }
      const workspaces = ctx.workspaces;
      navigation = navigation || workspaces;
      const original = navigation?.startSession;
      if (typeof original !== 'function' || typeof ctx.sessions?.create !== 'function') return () => {};
      const ownDescriptor = Object.getOwnPropertyDescriptor(navigation, 'startSession');
      let pending = null;
      let disposed = false;
      const wrapped = function (workspaceId) {
        if (disposed) return original.call(this, workspaceId);
        const current = ctx.sessions.list.getSnapshot().current;
        if (!isCleaningSession(current)) return original.call(this, workspaceId);
        if (pending) return;
        const snapshot = workspaces.list.getSnapshot();
        const target = workspaceId
          ?? snapshot.items.find((item) => item.sessionIds?.includes(current))?.workspaceId
          ?? snapshot.recentWorkspaceId;
        if (!target) return original.call(this, workspaceId);
        pending = Promise.resolve().then(() => ctx.sessions.create({ workspaceId: target }))
          .then((sessionId) => {
            // 用户在等待期间转往其它智能体时不抢回页面；成功导航才撤销业务归属。
            if (!disposed && isCleaningSession(current) && ctx.sessions.list.getSnapshot().current === current) {
              ctx.sessions.open(sessionId);
            }
          }).catch((error) => {
            console.warn('[dc-agent] new session failed; current draft retained:', error instanceof Error ? error.message : String(error));
          }).finally(() => { pending = null; });
      };
      try { navigation.startSession = wrapped; }
      catch (_error) { console.warn('[dc-agent] New Session compatibility bridge unavailable'); return () => {}; }
      return () => {
        disposed = true;
        if (navigation.startSession !== wrapped) return;
        if (ownDescriptor) Object.defineProperty(navigation, 'startSession', ownDescriptor);
        else delete navigation.startSession;
      };
    }

    const CLEANING_SESSION_ID_PREFIX = 'session-dsh-data-cleaning-agent-';
    const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    function createCleaningSessionId() {
      if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new Error('当前浏览器不支持安全会话标识生成，请使用最新版浏览器');
      }
      return `${CLEANING_SESSION_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
    }

    /** 使用 DSH 原生工作区、会话和输入机打开中央对话，不构造第二套聊天界面。 */
    async function startCleaningSession(ctx) {
      const workspace = ctx.workspaces.list.getSnapshot();
      const current = ctx.sessions.list.getSnapshot().current;
      if (ownedSessionId(current)) {
        markCleaningSession(current);
        requestWorkbenchOpen(workflowTaskBySession.get(String(current))?.stage || 'upload', current);
        return current;
      }
      const items = Array.isArray(workspace.items) ? workspace.items : [];
      const currentWorkspace = current === undefined
        ? undefined
        : items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(current));
      const recentWorkspace = items.find((item) => item.workspaceId === workspace.recentWorkspaceId);
      const targetWorkspace = currentWorkspace ?? recentWorkspace ?? items[0];
      if (!targetWorkspace?.workspaceId) {
        throw new Error('请先选择一个工作空间，再打开数据清洗补全智能体');
      }
      // 单一会话所有权：与招投标入口一致，显式创建带前缀的独立原生会话，绝不复用空白会话。
      // connectWorkspace 会把「招投标」尚为空白的工作台会话复用为清洗会话，
      // 使同一会话同时被招投标与清洗两个插件认领，进而争夺 Hero 标题与右侧工作台面板。
      // 原生 Hero 通过 workspace.sessionIds 判断输入是否可用。仅 cwd 会导致
      // chipTitle 缺失、inert=true；必须关联工作区，空白复用由 New Session Bridge 隔离。
      if (typeof ctx.sessions.create !== 'function') {
        throw new Error('当前 DSH 版本没有可用的独立会话创建能力');
      }
      const requestedId = createCleaningSessionId();
      const sessionId = await ctx.sessions.create({ workspaceId: targetWorkspace.workspaceId, sessionId: requestedId });
      if (sessionId !== requestedId) {
        throw new Error('当前 DSH 版本不支持独立会话创建，请升级 DSH 后再打开数据清洗补全智能体');
      }
      const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation;
      if (!conversation) throw new Error('DSH 对话服务尚未就绪，请稍后重试');
      conversation.input.shell(sessionId).setDraft(DEFAULT_SESSION_PROMPT);
      ctx.sessions.open(sessionId);
      markCleaningSession(sessionId);
      return sessionId;
    }

    /**
     * 图片接入兼容 Bridge。返回官方 ComposerAttachment，供向导复用其 previewUrl
     * 显示 64px 缩略图；失败会释放浏览器临时对象，不假设 alpha 实验 API 稳定。
     */
    function attachPromptImages(ctx, sessionId, files) {
      const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation;
      if (!conversation || typeof conversation.createDraftImages !== 'function') {
        throw new Error('当前 DSH 版本不支持从插件附加图片，请使用输入框原生“＋”按钮上传。');
      }
      const shell = conversation.input?.shell?.(sessionId);
      if (!shell || typeof shell.addImages !== 'function') {
        throw new Error('当前会话的图片输入能力尚未就绪，请稍后重试。');
      }
      const images = conversation.createDraftImages(files);
      if (!shell.addImages(images.map((image) => image.id))) {
        conversation.releaseDraftImages?.(images);
        throw new Error('图片未能加入当前对话，请检查格式或数量限制。');
      }
      return images;
    }

    function removePromptImage(ctx, sessionId, attachment) {
      const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation;
      const id = attachment?.id;
      if (!conversation || !id) return false;
      const shell = conversation.input?.shell?.(sessionId);
      shell?.removeImage?.(id);
      conversation.releaseDraftImage?.(id);
      return true;
    }

    async function sendQccAgentCommand(ctx, sessionId, prompt) {
      const scoped = typeof ctx.sessions?.scope === 'function' ? ctx.sessions.scope(sessionId) : null;
      const sessionConversation = scoped?.get?.('conversation');
      if (!sessionConversation || typeof sessionConversation.send !== 'function') {
        throw new Error('当前 DSH 版本没有可用的 Session conversation.send 能力');
      }
      await sessionConversation.send(prompt);
    }

    function setQccAgentDraft(ctx, sessionId, prompt) {
      const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation;
      const shell = conversation?.input?.shell?.(sessionId);
      if (!shell || typeof shell.setDraft !== 'function') {
        throw new Error('当前 DSH 版本没有可用的会话草稿回填能力');
      }
      const accepted = shell.setDraft(prompt);
      if (accepted === false) throw new Error('任务说明未能回填到当前对话框');
      ctx.sessions?.open?.(sessionId);
      return true;
    }

    function capabilityIcon(item, size = 16) {
      return typeof item.icon === 'function'
        ? h(item.icon, { size, 'aria-hidden': 'true' })
        : h('span', { 'aria-hidden': 'true' }, item.fallback);
    }

    function openWorkbench(actions, step, sessionId) {
      actions.openAt(step, sessionId);
      sessionWorkbenchController?.open(sessionId, step);
    }

    const WORKBENCH_OPEN_EVENT = 'dsh:data-cleaning-workbench-open';
    const WORKBENCH_DATASET_EVENT = 'dsh:data-cleaning-workbench-dataset';
    const WORKBENCH_DRAFT_EVENT = 'dsh:data-cleaning-workbench-draft';
    const WORKBENCH_PREPARE_EVENT = 'dsh:data-cleaning-workbench-prepare';

    // session scope 不能复用 root scope 的 store handle。DSH 当前会分别物化 root/session
    // 插槽组件，因此以 document 事件跨 scope 通知；闭包引用仅作为无 DOM 测试降级。
    let sessionWorkbenchController = null;

    /** 从 composer/header 请求指定 Session 的唯一工作台 Tab。 */
    function requestWorkbenchOpen(step, sessionId, task = null) {
      if (typeof document !== 'undefined'
        && typeof document.createEvent === 'function'
        && typeof document.dispatchEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_OPEN_EVENT, false, true, { step, sessionId, task });
        if (!document.dispatchEvent(event)) return;
      }
      sessionWorkbenchController?.open(sessionId, step);
    }

    function requestPreparedWorkflow(sessionId, config) {
      return new Promise((resolve, reject) => {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_PREPARE_EVENT, false, true, { sessionId, config, resolve, reject });
        if (document.dispatchEvent(event)) reject(new Error('工作台尚未就绪，请稍后重试。'));
      });
    }

    /** 完整表格交给 Session 业务控制器，不把整表塞进模型上下文。 */
    function requestWorkbenchDataset(result, sessionId, source) {
      if (typeof document !== 'undefined'
        && typeof document.createEvent === 'function'
        && typeof document.dispatchEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_DATASET_EVENT, false, true, { result, sessionId, source });
        if (!document.dispatchEvent(event)) return;
      }
      if (sessionWorkbenchController?.actionsFor(sessionId)) {
        applyParsed(result, sessionWorkbenchController?.actionsFor(sessionId), `session:${sessionId || 'unassigned'}`, source);
        sessionWorkbenchController?.actionsFor(sessionId).setActiveSession(sessionId);
      }
    }

    /** 提示词向导只提交可持久化的任务设置；名单明细仍通过 dataset 事件进入 task runtime。 */
    function requestWorkbenchDraft(draft, sessionId) {
      if (typeof document !== 'undefined'
        && typeof document.createEvent === 'function'
        && typeof document.dispatchEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_DRAFT_EVENT, false, true, { draft, sessionId });
        if (!document.dispatchEvent(event)) return;
      }
      if (sessionWorkbenchController?.actionsFor(sessionId)) {
        sessionWorkbenchController?.actionsFor(sessionId).setTaskTitle(draft.title);
        sessionWorkbenchController?.actionsFor(sessionId).setObjectives(draft.objectives);
        if (draft.mappings) sessionWorkbenchController?.actionsFor(sessionId).setMappings(draft.mappings);
        sessionWorkbenchController?.actionsFor(sessionId).setFieldSelection(draft.fieldSelection);
      }
    }

    /** 左栏入口按钮：公开 footer 托管，真实按钮 Portal 到「新会话 / 工作区」之间。 */
    function SidebarEntry(props) {
      const { wide, useStore, actions, startSession } = props;
      useStore((state) => state.open);
      const [topMount, setTopMount] = react.useState(null);

      react.useEffect(() => {
        let disposed = false;
        const ownedMounts = new Set();
        const syncMount = () => {
          if (disposed) return;
          const mount = ensureTopLauncherMount();
          if (mount) ownedMounts.add(mount);
          setTopMount((current) => current === mount ? current : mount);
        };
        syncMount();
        let observer = null;
        if (typeof window.MutationObserver === 'function' && document.body) {
          observer = new window.MutationObserver(syncMount);
          observer.observe(document.body, { childList: true, subtree: true });
        }
        return () => {
          disposed = true;
          if (observer) observer.disconnect();
          for (const mount of ownedMounts) mount.remove();
        };
      }, []);

      const launcher = react.createElement(Button, {
        variant: 'ghost',
        className: 'dcAgentLauncher',
        'data-wide': wide,
        'aria-label': '数据清洗补全',
        onClick: async () => {
          try {
            if (typeof startSession === 'function') {
              const sessionId = await startSession();
              actions.setActiveSession(sessionId);
            }
          } catch (error) {
            actions.setError(error instanceof Error ? error.message : String(error));
            console.error('[dc-agent] open failed:', error);
          }
        },
        children: h('span', { className: 'dcAgentLauncherContent' }, h(DatabaseLogo), wide ? h('span', null, '数据清洗补全') : null),
      });
      if (!topMount || typeof reactDom.createPortal !== 'function') return launcher;
      return reactDom.createPortal(h('div', {
        className: 'dcAgentTopEntry',
        'data-wide': wide,
      }, launcher), topMount);
    }

    /** 快捷菜单只切换同一工作台视图，由自有 Portal 挂载在原生 composer 下方。 */
    function CapabilityBar(props) {
      const { sessionId } = props;
      return h('div', { className: 'dcAgentCapabilities', 'aria-label': '数据清洗补全智能体能力' },
        CAPABILITIES.map((item) => h('button', {
          key: item.key,
          type: 'button',
          className: 'dcAgentCapability',
          'aria-label': item.label,
          title: item.label,
          onClick: () => requestWorkbenchOpen(item.key, sessionId),
        },
          capabilityIcon(item),
          h('span', { className: 'dcAgentCapabilityLabel' }, item.label),
        )),
      );
    }

    const WORKFLOW_STATE_LABELS = {
      draft: '待上传', uploaded: '待确认规则', rules_confirmed: '规则已确认', diagnosed: '体检完成',
      matching: '匹配中', review_required: '待人工核验', matched: '匹配完成', enriching: '补全中',
      export_ready: '可下载', completed: '已完成', partial: '处理结束（需核验）', failed: '执行失败',
      authorization_required: '待连接企查查', cancelled: '已取消', parse_failed: '解析失败',
    };

    function ProductHome() {
      return h('p', { className: 'dcAgentHomeSummary' },
        '导入企业名单或图片，核验主体、补全字段，并导出可追溯结果。');
    }

    function workflowNavigationIssue(step, task, hasData, profile, qccRun, hasLocalResult = false) {
      if (['upload', 'history'].includes(step)) return null;
      if (step === 'download' && task?.artifacts?.length) return null;
      if (!hasData) return '请先在「导入与核验」载入并核对完整名单。';
      if (step === 'rules') return null;
      if (!task || ['draft', 'uploaded'].includes(task.state)) return '请先在「规则与体检」确认字段映射和处理规则。';
      if (step === 'profile') return null;
      if (!profile && task.state === 'rules_confirmed') return '请先生成质量体检报告，再推进主体匹配。';
      const requiresQcc = Array.isArray(task.objectives)
        ? task.objectives.some((key) => ['validate_identity', 'complete_fields'].includes(key))
        : Boolean(task.fieldSelection?.length);
      if (step === 'enrich' && requiresQcc && !['matched', 'enriching', 'export_ready', 'completed', 'partial'].includes(task.state)) {
        return '请先在「主体匹配」确认企业；多候选需要人工核验。';
      }
      if (step === 'download' && !requiresQcc && hasLocalResult && ['rules_confirmed', 'diagnosed'].includes(task.state)) return null;
      if (step === 'download' && !['export_ready', 'completed', 'partial'].includes(task.state) && !['completed', 'partial'].includes(qccRun?.state)) {
        return '请先完成清洗或字段补全。原始清单可在「导入与核验」下载。';
      }
      return null;
    }

    // 只新增自己的 Portal 容器，不移动 DSH/其他插件拥有的 DOM。
    function installCapabilityMount(marker, onMount) {
      const owned = new Set();
      const sync = () => {
        const seat = marker?.closest?.('[data-composer-seat]');
        const card = seat?.querySelector?.('[data-composer-card]');
        if (!card) { onMount(null); return; }
        let branch = card;
        while (branch.parentElement && branch.parentElement !== seat && !branch.parentElement.contains(marker)) {
          branch = branch.parentElement;
        }
        const parent = branch.parentElement;
        if (!parent?.contains(marker) || branch.contains(marker)) { onMount(null); return; }
        let mount = [...owned].find((node) => node.parentElement === parent);
        if (!mount) {
          for (const node of owned) node.remove();
          owned.clear();
          mount = document.createElement('div');
          mount.className = 'dcAgentCapabilityMount';
          owned.add(mount);
        }
        if (branch.nextSibling !== mount) parent.insertBefore(mount, branch.nextSibling);
        onMount(mount);
      };
      sync();
      const observer = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null;
      observer?.observe(marker.closest('[data-composer-seat]') || marker, { childList: true, subtree: true });
      return () => { observer?.disconnect(); for (const node of owned) node.remove(); };
    }

    function PromptDialog({ sessionId, onClose, children }) {
      react.useEffect(() => {
        const panel = [...(document.querySelectorAll?.('.dcAgentPromptPanel') || [])]
          .find((node) => node.dataset.sessionId === sessionId);
        if (!panel) return undefined;
        const previous = document.activeElement;
        const focusable = () => [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')]
          .filter((node) => node.getClientRects().length);
        (focusable()[0] || panel).focus();
        const keydown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key !== 'Tab') return;
          const nodes = focusable();
          const first = nodes[0] || panel, last = nodes[nodes.length - 1] || panel;
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
            event.preventDefault(); first.focus();
          }
        };
        panel.addEventListener('keydown', keydown);
        return () => {
          panel.removeEventListener('keydown', keydown);
          if (panel.contains(document.activeElement) && previous?.isConnected) previous.focus();
        };
      }, [sessionId]);
      const dialog = h('div', { className: 'dcAgentPromptBackdrop' },
        h('section', { className: 'dcAgentPromptPanel', role: 'dialog', 'aria-modal': 'true',
          'aria-label': '数据清洗补全任务生成器', 'data-session-id': sessionId, tabIndex: -1 }, children));
      return document.body && typeof reactDom.createPortal === 'function'
        ? reactDom.createPortal(dialog, document.body) : dialog;
    }

    function ImagePreview({ src, alt, onClose, sessionId }) {
      react.useEffect(() => () => {
        const panel = [...(document.querySelectorAll?.('.dcAgentPromptPanel') || [])]
          .find((node) => node.dataset.sessionId === sessionId);
        panel?.querySelector('.dcAgentPromptImageThumb')?.focus();
      }, [sessionId]);
      const view = h('button', { type: 'button', className: 'dcAgentImageLightbox',
        'aria-label': '关闭图片预览', onClick: onClose, autoFocus: true,
        onKeyDown: (event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key === 'Tab') event.preventDefault();
        },
      }, h('img', { src, alt }));
      return document.body && typeof reactDom.createPortal === 'function' ? reactDom.createPortal(view, document.body) : view;
    }
    /**
     * DSH 当前只公开 hero brand.mark，没有 headline slot。这里仅在本插件会话且 blank hero
     * 阶段替换标题，并在卸载时恢复，避免污染普通会话。
     *
     * 某些第三方插件会全局改写 hero headline、向所有会话注入自己的 dock。清洗会话必须
     * 仍然保持自己的标题和单一业务入口，因此用 headline class 作为最后降级，并只隐藏与
     * 当前清洗 hero 同一 composer stack 内、带明确「尽调类型」aria 标签的已知外来 dock。
     * 所有变更均记录原值并在会话离开 / 组件卸载时恢复。
     */
    function rewriteHeroChrome(sessionId, enabled) {
      if (!enabled || typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return () => {};
      const marker = [...document.querySelectorAll('.dcAgentExperience')]
        .find((element) => element?.dataset?.sessionId === sessionId);
      const hero = marker?.closest?.('[data-phase="hero"]');
      if (!hero) return () => {};
      const changedTitles = new Map();
      const changedBadges = new Map();
      const changedMarks = new Map();
      const changedRows = new Map();
      const ownedLogos = new Map();
      const hiddenForeignDocks = new Map();
      const composerStack = marker?.parentElement?.parentElement;
      // 单一会话所有权由入口的 enabled 参数（useCleaningSession(sessionId) && composerPhase==='blank'）
      // 与 React effect 生命周期共同保证：非清洗会话不会挂载，会话切换即走 cleanup 让位。
      // 有界同步：每次 fix 的 DOM 变更计入校正预算，达到上限即断开观察器，杜绝与其它插件互相改写的死循环。
      const MAX_HERO_CORRECTIONS = 8;
      let corrections = 0;
      let observer = null;

      const fix = () => {
        let mutated = false;
        const spans = [...hero.querySelectorAll('span')];
        const title = spans.find((element) => element.dataset?.dcAgentHeroTitle === 'true')
          ?? spans.find((element) => ['探索未至之境', 'Into the Unknown'].includes(element.textContent?.trim()))
          ?? hero.querySelector?.('[class*="headlineText"]');
        const badge = spans.find((element) => element.dataset?.dcAgentHeroBadge === 'true')
          ?? spans.find((element) => ['预览版', 'Preview'].includes(element.textContent?.trim()));
        if (title) {
          if (!changedTitles.has(title)) changedTitles.set(title, title.textContent ?? '');
          title.dataset.dcAgentHeroTitle = 'true';
          if (title.textContent !== '数据清洗补全智能体') { title.textContent = '数据清洗补全智能体'; mutated = true; }
          // 只适配本会话已确认的 DSH headline；未知宿主结构保留原状。
          const row = title.parentElement;
          const nativeMark = row?.querySelector?.('[class*="fishHitbox"]');
          if (nativeMark && typeof document.createElementNS === 'function') {
            if (!changedRows.has(row)) changedRows.set(row, row.getAttribute('data-dc-agent-hero-row'));
            row.setAttribute('data-dc-agent-hero-row', 'true');
            if (!changedMarks.has(nativeMark)) changedMarks.set(nativeMark, nativeMark.style.display);
            nativeMark.style.display = 'none';
            if (!ownedLogos.get(row)?.isConnected) {
              const logo = document.createElement('span');
              logo.className = 'dcAgentHeroLogo';
              logo.setAttribute('aria-hidden', 'true');
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '26', height: '26', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false' })) svg.setAttribute(name, value);
              const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              path.setAttribute('d', DATABASE_PATH);
              svg.appendChild(path);
              logo.appendChild(svg);
              row.insertBefore(logo, title);
              ownedLogos.set(row, logo);
              mutated = true;
            }
          }
        }
        if (badge) {
          if (!changedBadges.has(badge)) changedBadges.set(badge, badge.style?.display ?? '');
          badge.dataset.dcAgentHeroBadge = 'true';
          if (badge.style && badge.style.display !== 'none') { badge.style.display = 'none'; mutated = true; }
        }

        const foreignSurfaces = composerStack?.querySelectorAll?.('[aria-label="尽调类型"], .qccDock') ?? [];
        for (const foreignSurface of foreignSurfaces) {
          let hideTarget = foreignSurface;
          while (hideTarget?.parentElement
            && hideTarget.parentElement !== composerStack
            && hideTarget.parentElement !== marker.parentElement) {
            hideTarget = hideTarget.parentElement;
          }
          // DSH 的 list slot 可能把多个插件放进同一个 data-slot 容器。此时只能隐藏
          // 对方自己的根节点，不能隐藏共享 slot；独立 host 则隐藏其直接容器。
          if ((hideTarget?.parentElement === composerStack || hideTarget?.parentElement === marker.parentElement)
            && !hideTarget.contains?.(marker)) {
            if (!hiddenForeignDocks.has(hideTarget)) hiddenForeignDocks.set(hideTarget, hideTarget.style?.display ?? '');
            if (hideTarget.style && hideTarget.style.display !== 'none') { hideTarget.style.display = 'none'; mutated = true; }
          }
        }
        if (mutated) {
          corrections += 1;
          if (corrections >= MAX_HERO_CORRECTIONS && observer) {
            observer.disconnect();
            observer = null;
          }
        }
      };

      fix();
      observer = typeof MutationObserver === 'function' ? new MutationObserver(fix) : null;
      observer?.observe?.(hero, { childList: true, subtree: true });
      return () => {
        observer?.disconnect?.();
        for (const logo of ownedLogos.values()) logo.remove();
        for (const [mark, originalDisplay] of changedMarks) mark.style.display = originalDisplay;
        for (const [row, originalValue] of changedRows) {
          if (originalValue === null) row.removeAttribute('data-dc-agent-hero-row');
          else row.setAttribute('data-dc-agent-hero-row', originalValue);
        }
        for (const [title, originalText] of changedTitles) {
          if (title.textContent === '数据清洗补全智能体') title.textContent = originalText;
          delete title.dataset.dcAgentHeroTitle;
        }
        for (const [badge, originalDisplay] of changedBadges) {
          if (badge.style) badge.style.display = originalDisplay;
          delete badge.dataset.dcAgentHeroBadge;
        }
        for (const [foreignDock, originalDisplay] of hiddenForeignDocks) {
          if (foreignDock.style) foreignDock.style.display = originalDisplay;
        }
      };
    }

    function DataCleaningExperience(props) {
      const { sessionId, session: ownerSession } = props;
      const enabled = useCleaningSession(sessionId);
      const [dependencyMessage, setDependencyMessage] = react.useState('');
      react.useEffect(() => {
        const listener = event => { if (event.detail?.sessionId === sessionId) setDependencyMessage(event.detail.message || ''); };
        document.addEventListener(DEPENDENCY_EVENT, listener);
        return () => document.removeEventListener(DEPENDENCY_EVENT, listener);
      }, [sessionId]);
      const hero = ownerSession?.composerPhase === 'blank';
      const [menuMount, setMenuMount] = react.useState(null);
      react.useEffect(() => {
        if (!enabled) return undefined;
        const marker = [...document.querySelectorAll('.dcAgentExperience')]
          .find((node) => node.dataset.sessionId === sessionId);
        return marker ? installCapabilityMount(marker, (mount) => setMenuMount((current) => current === mount ? current : mount)) : undefined;
      }, [enabled, sessionId, hero]);
      react.useEffect(
        () => rewriteHeroChrome(sessionId, enabled && hero),
        [sessionId, enabled, hero, ownerSession?.openState]
      );
      if (!enabled) return null;
      return h('div', {
        className: `dcAgentExperience${hero ? ' is-home' : ''}`,
        'data-session-id': sessionId,
      },
        dependencyMessage ? h('p', { className: 'dcAgentError', role: 'alert' }, dependencyMessage) : null,
        menuMount ? reactDom.createPortal(h(CapabilityBar, { sessionId }), menuMount) : h(CapabilityBar, { sessionId }),
        hero ? h(ProductHome, { sessionId }) : null,
      );
    }

    function extractPromptEntries(result) {
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const headers = Array.isArray(result?.headers) && result.headers.length
        ? result.headers
        : rows.length ? Object.keys(rows[0]) : [];
      const nameField = headers.find((name) => /^(name|company|company_name|企业名称|公司名称)$/i.test(name))
        ?? headers.find((name) => /企业|公司|名称|name/i.test(name));
      const creditField = headers.find((name) => /^(credit_no|creditCode|unified_credit_code|统一社会信用代码|信用代码)$/i.test(name))
        ?? headers.find((name) => /信用.*代码|credit/i.test(name));
      return rows.map((row) => {
        const name = nameField ? String(row?.[nameField] ?? '').trim() : '';
        const credit = creditField ? String(row?.[creditField] ?? '').trim() : '';
        return [name, credit].filter(Boolean).join(' | ');
      }).filter(Boolean).slice(0, 50);
    }

    function imageFilesFromTransfer(transfer) {
      const files = Array.from(transfer?.files || []).filter((file) => String(file?.type ?? '').startsWith('image/'));
      // Safari/Chromium clipboard implementations may expose screenshots only as items.
      if (files.length) return files;
      return Array.from(transfer?.items || [])
        .filter((item) => item.kind === 'file' && String(item.type ?? '').startsWith('image/'))
        .map((item) => item.getAsFile?.())
        .filter(Boolean);
    }

    function isImagePathEntry(value) {
      return /^(?:file:\/\/|\/|[a-z]:[\\/])/i.test(String(value).trim().replace(/^["']/, ''))
        && /\.(?:png|jpe?g|webp|gif|heic|bmp)(?:["']|\s)*$/i.test(String(value));
    }

    function requestPromptImage(sessionId, file = null) {
      if (!sessionId || typeof document.createEvent !== 'function') return false;
      const event = document.createEvent('CustomEvent');
      event.initCustomEvent('dsh:data-cleaning-prompt-image', false, true, { sessionId, file });
      return !document.dispatchEvent(event);
    }

    async function imageFileBase64(file) {
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('图片文件不可读。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    }

    async function stagePromptImage(file) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(file?.type ?? ''))) {
        throw new Error('仅支持 PNG、JPEG 或 WebP 图片。');
      }
      if (Number(file?.size ?? 0) > 8 * 1024 * 1024) throw new Error('图片不能超过 8 MiB。');
      return api('/data-cleaning/api/images/commands', {
        fileName: file.name,
        mimeType: file.type,
        content: await imageFileBase64(file),
      });
    }

    function PromptGenerator(props) {
      const { sessionId, inputActions, attachImages, removeImage, getInputSnapshot } = props;
      const enabled = useCleaningSession(sessionId);
      const [open, setOpen] = react.useState(false);
      const [wizardStep, setWizardStep] = react.useState(1);
      const [mode, setMode] = react.useState('text');
      const [rawText, setRawText] = react.useState('');
      const [entries, setEntries] = react.useState([]);
      const [entryCount, setEntryCount] = react.useState(0);
      const [spreadsheetFileName, setSpreadsheetFileName] = react.useState('');
      const [spreadsheetData, setSpreadsheetData] = react.useState(null);
      const [spreadsheetMappings, setSpreadsheetMappings] = react.useState([]);
      const [imageFileName, setImageFileName] = react.useState('');
      const [imageSizeBytes, setImageSizeBytes] = react.useState(0);
      const [imageAttachment, setImageAttachment] = react.useState(null);
      const [imageCommand, setImageCommand] = react.useState(null);
      const [imageDropActive, setImageDropActive] = react.useState(false);
      const [imageLightbox, setImageLightbox] = react.useState(false);
      const [cleaningKeys, setCleaningKeys] = react.useState(DEFAULT_CLEANING_KEYS);
      const [enrichmentKeys, setEnrichmentKeys] = react.useState(DEFAULT_ENRICHMENT_KEYS);
      const [fieldQuery, setFieldQuery] = react.useState('');
      const [anchorKeys, setAnchorKeys] = react.useState(['company_name', 'credit_no']);
      const [matchRules, setPromptMatchRules] = react.useState({
        normalizeNames: true,
        preferCreditNo: true,
        deduplicate: true,
        manualReviewAmbiguous: true,
      });
      const [busy, setBusy] = react.useState(false);
      const [error, setError] = react.useState(null);

      react.useEffect(() => {
        const commandId = imageCommand?.commandId;
        if (!commandId || ['completed', 'failed'].includes(imageCommand?.state)) return undefined;
        let disposed = false;
        let timer = null;
        const poll = async () => {
          try {
            const response = await api(`/data-cleaning/api/images/commands/${encodeURIComponent(commandId)}`);
            if (disposed) return;
            const command = response?.command;
            if (!command) return;
            setImageCommand((current) => current?.commandId === commandId ? { ...current, ...command } : current);
            if (command.state === 'completed') {
              const recognized = Array.isArray(command.result?.entries) ? command.result.entries : [];
              setEntries(recognized);
              setEntryCount(recognized.length);
              requestWorkbenchDataset(entriesToDataset(recognized), sessionId, {
                type: 'image', fileName: imageFileName, sizeBytes: imageSizeBytes,
              });
              setError(null);
              setOpen(false);
              requestWorkbenchOpen('upload', sessionId);
              return;
            }
            if (command.state === 'failed') {
              setError(command.error?.message || '图片识别失败，请换用清晰图片或文本/Excel 名单。');
              setOpen(true);
              return;
            }
            timer = setTimeout(poll, 1000);
          } catch (pollError) {
            if (!disposed) {
              setError(pollError instanceof Error ? pollError.message : String(pollError));
              setOpen(true);
            }
          }
        };
        timer = setTimeout(poll, 800);
        return () => {
          disposed = true;
          if (timer !== null) clearTimeout(timer);
        };
      }, [imageCommand?.commandId, imageCommand?.state, imageFileName, imageSizeBytes, sessionId]);

      const discardCurrentImage = () => {
        if (imageAttachment && typeof removeImage === 'function') removeImage(sessionId, imageAttachment);
        if (imageCommand?.commandId && imageCommand.state !== 'running') {
          requestJson(`/data-cleaning/api/images/commands/${encodeURIComponent(imageCommand.commandId)}`, 'DELETE').catch(() => {});
        }
        setImageAttachment(null);
        setImageCommand(null);
        setImageFileName('');
        setImageSizeBytes(0);
        setEntries([]);
        setEntryCount(0);
        setImageLightbox(false);
      };
      const setSourceMode = (nextMode) => {
        if (mode === 'image' && nextMode !== 'image') {
          if (imageCommand?.state === 'running') {
            setError('图片正在识别，请等待完成后再切换数据来源。');
            return;
          }
          discardCurrentImage();
        }
        setMode(nextMode);
        setError(null);
      };
      const toggle = (setter, values, key) => setter(values.includes(key)
        ? values.filter((item) => item !== key)
        : [...values, key]);
      const handleImageFile = async (file) => {
        if (!file || busy) return;
        setBusy(true);
        setError(null);
        let attached = null;
        try {
          if (typeof attachImages !== 'function') throw new Error('当前 DSH 没有可用的图片接入 Bridge。');
          const images = await attachImages(sessionId, [file]);
          attached = Array.isArray(images) ? images[0] : null;
          if (!attached?.id) throw new Error('图片未能加入当前对话。');
          const staged = await stagePromptImage(file);
          if (imageAttachment && typeof removeImage === 'function') removeImage(sessionId, imageAttachment);
          if (imageCommand?.commandId) {
            requestJson(`/data-cleaning/api/images/commands/${encodeURIComponent(imageCommand.commandId)}`, 'DELETE').catch(() => {});
          }
          setImageAttachment(attached);
          setImageFileName(file.name);
          setImageSizeBytes(Number(file.size ?? 0));
          setImageCommand(staged.command);
          setEntries([]);
          setEntryCount(0);
        } catch (fileError) {
          if (attached && typeof removeImage === 'function') removeImage(sessionId, attached);
          throw fileError;
        } finally {
          setBusy(false);
        }
      };
      const handleFile = async (event) => {
        const file = event.target?.files?.[0];
        if (!file || busy) return;
        if (mode === 'image') {
          try { await handleImageFile(file); }
          catch (fileError) { setError(fileError instanceof Error ? fileError.message : String(fileError)); }
          finally { if (event.target) event.target.value = ''; }
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const result = await parseFile(file);
          if (!result || result.ok === false) throw new Error(result?.message || result?.error || '表格解析失败');
          const extracted = extractPromptEntries(result);
          if (!extracted.length) throw new Error('未识别到企业名称或统一社会信用代码列，请检查表头。');
          setEntries(extracted);
          setEntryCount(Number.isFinite(result.rowCount) ? result.rowCount : (Array.isArray(result.rows) ? result.rows.length : extracted.length));
          setSpreadsheetFileName(file.name);
          setSpreadsheetData(result);
          const suggested = guessMappings(result.headers || []);
          setSpreadsheetMappings(suggested);
          setEnrichmentKeys(mappedOutputFields(suggested));
          setAnchorKeys(suggested.filter((item) => isAnchorField(item.targetField)).map((item) => item.targetField));
          requestWorkbenchDataset(result, sessionId, {
            type: result.fmt || 'xlsx', fileName: file.name, sizeBytes: file.size || 0,
          });
        } catch (fileError) {
          setSpreadsheetData(null); setSpreadsheetMappings([]); setSpreadsheetFileName(''); setEntries([]); setEntryCount(0);
          setError(fileError instanceof Error ? fileError.message : String(fileError));
        } finally {
          setBusy(false);
        }
      };
      const selectedEntries = () => mode === 'text'
        ? rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : entries;
      const validateSource = () => {
        const values = selectedEntries();
        if (mode === 'text' && !values.length) return '请先录入企业名称或统一社会信用代码，每行一条。';
        if (mode === 'text' && values.some(isImagePathEntry)) return '检测到图片文件路径，不是企业名单。请切换「上传图片识别」，重新选择或粘贴图片。';
        if (mode === 'excel' && !values.length) return '请先上传并解析 Excel / CSV / JSON 文件。';
        if (mode === 'image' && !imageCommand) return '请先选择、粘贴或拖入一张包含企业名单的图片。';
        if (mode === 'image' && imageCommand?.state === 'failed') return imageCommand.error?.message || '图片识别失败，请重新选择图片。';
        if (mode === 'image' && imageCommand?.state === 'running') return '图片正在通过企查查智能文档解析识别，请稍候。';
        if (mode === 'image' && imageCommand?.state === 'completed' && !values.length) return '图片中未提取到可核验的企业名称或统一社会信用代码。';
        return null;
      };
      const promptConfig = () => ({
        mode,
        entries: selectedEntries(),
        entryCount: mode === 'excel' ? entryCount : selectedEntries().length,
        fileName: mode === 'image' ? imageFileName : spreadsheetFileName,
        cleaningKeys,
        enrichmentKeys,
        anchorKeys,
        matchRules,
        ...(mode === 'excel' ? { headers: spreadsheetData?.headers || [], mappings: spreadsheetMappings } : {}),
        imageCommandId: imageCommand?.commandId ?? '',
        imageState: imageCommand?.state ?? null,
      });
      const generatePrompt = async () => {
        const sourceError = validateSource();
        if (sourceError) { setError(sourceError); return; }
        if (!anchorKeys.length) { setError('请至少选择一个企业主体匹配主键。'); return; }
        if (!cleaningKeys.length) { setError('请至少选择一个清洗或补全目标。'); return; }
        if (!inputActions || typeof inputActions.setDraft !== 'function') {
          setError('当前会话输入机尚未就绪，请稍后重试。');
          return;
        }
        const inputSnapshot = getInputSnapshot?.(sessionId);
        if (['adjudicating', 'submitting'].includes(inputSnapshot?.phase)) {
          setError('当前对话正在提交，请等待完成后再回填。图片与字段选择已保留。');
          return;
        }
        const config = promptConfig();
        if (mode === 'image' && imageCommand?.state === 'prepared' && imageAttachment && typeof removeImage === 'function') {
          // qcc-document-mcp 只读取 Host 暂存文件；发送前释放原生附件，文本模型不会收到图片。
          removeImage(sessionId, imageAttachment);
          setImageAttachment(null);
        }
        if (mode === 'text') {
          requestWorkbenchDataset(entriesToDataset(config.entries), sessionId, { type: 'text', fileName: '' });
        } else if (mode === 'excel' && spreadsheetData) {
          requestWorkbenchDataset(spreadsheetData, sessionId, { type: spreadsheetData.fmt || 'xlsx', fileName: spreadsheetFileName });
        }
        requestWorkbenchDraft({
          title: `企业数据清洗补全任务 · ${config.entryCount || '待解析'} 条`,
          objectives: cleaningKeys,
          fieldSelection: enrichmentKeys,
          matchRules,
          ...(mode === 'excel' ? { mappings: spreadsheetMappings } : {}),
          source: { type: mode === 'excel' ? 'xlsx' : mode, fileName: config.fileName || '', rowCount: config.entryCount || 0 },
        }, sessionId);
        setBusy(true);
        try {
          let prompt = buildTaskPrompt(config);
          if (mode !== 'image' || imageCommand?.state === 'completed') {
            const command = await requestPreparedWorkflow(sessionId, config);
            prompt = command.prompt + '\n\n' + buildTaskPrompt(config);
          }
          inputActions.setDraft(prompt);
          const updatedInput = getInputSnapshot?.(sessionId);
          if (updatedInput && updatedInput.draft !== prompt) throw new Error('当前对话尚未接收任务说明，请稍后重试回填。');
        } catch (draftError) {
          setError(draftError instanceof Error ? draftError.message : String(draftError));
          return;
        } finally { setBusy(false); }
        setError(null);
        setOpen(false);
        setTimeout(() => {
          if (typeof document === 'undefined' || !isCleaningSession(sessionId)) return;
          const marker = [...(document.querySelectorAll?.('.dcAgentExperience') || [])]
            .find((node) => node.dataset.sessionId === sessionId);
          marker?.closest?.('[data-composer-seat]')?.querySelector?.('textarea, [contenteditable="true"], [role="textbox"]')?.focus();
        }, 0);
        setWizardStep(1);
      };

      const nextWizard = () => {
        if (wizardStep === 1) {
          const sourceError = validateSource();
          if (sourceError) { setError(sourceError); return; }
        }
        if (wizardStep === 2 && !anchorKeys.length) { setError('请至少选择一个匹配主键。'); return; }
        if (wizardStep === 3 && !cleaningKeys.length) { setError('请至少选择一个清洗或补全目标。'); return; }
        if (wizardStep < 4) { setError(null); setWizardStep(wizardStep + 1); return; }
        generatePrompt();
      };

      const acceptImageFiles = async (files) => {
        const file = [...(files || [])].find((candidate) => String(candidate?.type ?? '').startsWith('image/'));
        if (!file) { setError('剪贴板或拖入内容中没有可用图片。'); return; }
        try { await handleImageFile(file); }
        catch (imageError) { setError(imageError instanceof Error ? imageError.message : String(imageError)); }
      };
      const removeCurrentImage = async () => {
        if (busy) return;
        discardCurrentImage();
        setError(null);
      };

      // 在数据清洗会话中从 window 捕获阶段接管 Composer 图片粘贴，早于
      // document 级视觉兼容插件。向导未打开时会自动进入图片模式；只消费包含
      // 图片且目标为原生 Composer 的事件，不影响文字粘贴、右侧工作台或其他会话。
      react.useEffect(() => {
        if (!enabled) return undefined;
        const handleWindowPaste = (event) => {
          const files = imageFilesFromTransfer(event.clipboardData);
          const hasImage = files.length > 0;
          if (!hasImage) return;
          const target = event.target;
          const inComposer = !open && !target?.closest?.('.dcAgentWorkbenchContent')
            && Boolean(target?.closest?.('textarea, [contenteditable="true"], [role="textbox"]'));
          const inSourceStep = open && wizardStep === 1 && Boolean(target?.closest?.('.dcAgentPromptPanel'));
          if (!inComposer && !inSourceStep) return;
          event.preventDefault();
          event.stopImmediatePropagation?.();
          if (busy || imageCommand?.state === 'running') return;
          setMode('image');
          setWizardStep(1);
          setOpen(true);
          setError(null);
          acceptImageFiles(files);
        };
        window.addEventListener?.('paste', handleWindowPaste, true);
        return () => window.removeEventListener?.('paste', handleWindowPaste, true);
      }, [enabled, open, wizardStep, mode, busy, sessionId, imageCommand, imageAttachment]);

      // 右侧工作台共用此图片入口；仅由当前会话确认接收，不把图片交给表格解析器。
      react.useEffect(() => {
        if (!enabled) return undefined;
        const receiveNewTask = (event) => {
          if (event.detail?.sessionId !== sessionId || busy || imageCommand?.state === 'running') return;
          event.preventDefault();
          discardCurrentImage();
          setMode('text'); setRawText(''); setEntries([]); setEntryCount(0); setSpreadsheetFileName('');
          setSpreadsheetData(null); setSpreadsheetMappings([]);
          setCleaningKeys(DEFAULT_CLEANING_KEYS); setEnrichmentKeys(DEFAULT_ENRICHMENT_KEYS);
          setAnchorKeys(['company_name', 'credit_no']);
          setPromptMatchRules({ normalizeNames: true, preferCreditNo: true, deduplicate: true, manualReviewAmbiguous: true });
          setWizardStep(1); setOpen(true); setError(null);
        };
        const receiveImage = (event) => {
          if (event.detail?.sessionId !== sessionId || busy || imageCommand?.state === 'running') return;
          event.preventDefault();
          setMode('image');
          setWizardStep(1);
          setOpen(true);
          setError(null);
          if (event.detail.file) acceptImageFiles([event.detail.file]);
        };
        document.addEventListener('dsh:data-cleaning-prompt-image', receiveImage);
        document.addEventListener('dsh:data-cleaning-prompt-new', receiveNewTask);
        return () => {
          document.removeEventListener('dsh:data-cleaning-prompt-image', receiveImage);
          document.removeEventListener('dsh:data-cleaning-prompt-new', receiveNewTask);
        };
      }, [enabled, sessionId, busy, imageCommand, imageAttachment]);

      if (!enabled) return null;

      const choice = (options, values, setter) => options.map(([key, label]) => h('label', {
        key,
        className: `dcAgentPromptChoice${values.includes(key) ? ' is-selected' : ''}`,
      },
        h('input', {
          type: 'checkbox',
          checked: values.includes(key),
          onChange: () => toggle(setter, values, key),
        }),
        label,
      ));
      const setPromptFieldGroup = (fields, enabledGroup) => {
        const groupIds = new Set(fields.map(([id]) => id));
        const selected = new Set(enrichmentKeys);
        for (const id of groupIds) {
          if (enabledGroup || (mode === 'excel' && mappedOutputFields(spreadsheetMappings).includes(id))) selected.add(id); else selected.delete(id);
        }
        const catalogOrder = FIELD_GROUPS.flatMap(([, , groupFields]) => groupFields.map(([id]) => id));
        setEnrichmentKeys(catalogOrder.filter((id) => selected.has(id)));
      };

      return h('div', { className: 'dcAgentPromptLayer' },
        h('button', {
          type: 'button',
          className: 'dcAgentPromptTrigger',
          'aria-label': '打开提示词生成',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        }, '✨ 提示词生成'),
        open ? h(PromptDialog, { sessionId, onClose: () => setOpen(false) },
          h('div', { className: 'dcAgentPromptHead' },
            h('div', null,
              h('h3', null, '生成数据清洗补全任务'),
              h('p', null, '录入主体、选择清洗动作与补全维度，生成后仍可在对话框中人工修改。'),
            ),
            h('button', { type: 'button', className: 'dcAgentPromptClose', 'aria-label': '关闭提示词生成', onClick: () => setOpen(false) }, '✕'),
          ),
          h('div', { className: 'dcAgentPromptBody' },
          h('nav', { className: 'dcAgentWizardNav', 'aria-label': '任务设置步骤' },
            [['1', '数据来源'], ['2', '匹配规则'], ['3', '清洗与补全'], ['4', '确认描述']].map(([index, label]) => h('button', {
              key: index,
              type: 'button',
              className: `dcAgentWizardStep${wizardStep === Number(index) ? ' is-active' : ''}`,
              'aria-current': wizardStep === Number(index) ? 'step' : undefined,
              onClick: () => setWizardStep(Number(index)),
            }, h('b', null, index), h('span', null, label))),
          ),
          wizardStep === 1 ? h('div', { className: 'dcAgentWizardPane' },
            h('h4', null, '先告诉我数据从哪里来'),
            h('p', null, '企业名称、统一社会信用代码、注册号任一项都可作为匹配起点。'),
            h('div', { className: 'dcAgentPromptTabs', role: 'tablist', 'aria-label': '名单录入方式' },
              [['text', '粘贴企业名单'], ['excel', '上传本地文件'], ['image', '上传图片识别']].map(([key, label]) => h('button', {
                key, type: 'button', role: 'tab', 'aria-selected': mode === key,
                className: `dcAgentPromptTab${mode === key ? ' is-active' : ''}`,
                onClick: () => setSourceMode(key),
              }, label)),
            ),
            mode === 'text' ? h('label', { className: 'dcAgentPromptField' },
              h('span', null, '企业名称或统一社会信用代码（每行一条）'),
              h('textarea', {
                className: 'dcAgentPromptText', value: rawText,
                placeholder: '企查查科技股份有限公司\n9132…\n某某信息技术（上海）有限公司',
                onChange: (event) => setRawText(event.target.value),
              }),
            ) : mode === 'image' ? h('div', {
              className: `dcAgentPromptImageDrop${imageDropActive ? ' is-active' : ''}`,
              tabIndex: 0,
              role: 'group',
              'aria-label': '粘贴、拖入或选择企业名单图片',
              onPaste: (event) => {
                const files = imageFilesFromTransfer(event.clipboardData);
                if (files?.length) {
                  event.preventDefault();
                  acceptImageFiles(files);
                }
              },
              onDragOver: (event) => { event.preventDefault(); setImageDropActive(true); },
              onDragLeave: () => setImageDropActive(false),
              onDrop: (event) => {
                event.preventDefault();
                setImageDropActive(false);
                acceptImageFiles(imageFilesFromTransfer(event.dataTransfer));
              },
            },
              h('p', null, '可直接在此粘贴图片，或拖入 / 选择 PNG、JPEG、WebP。图片会在对话框显示缩略图，点击可放大。'),
              imageAttachment ? h('div', { className: 'dcAgentPromptImagePreview' },
                h('button', {
                  type: 'button', className: 'dcAgentPromptImageThumb',
                  'aria-label': `放大查看 ${imageFileName}`,
                  onClick: () => setImageLightbox(true),
                }, imageAttachment.previewUrl ? h('img', { src: imageAttachment.previewUrl, alt: imageFileName }) : '图片'),
                h('div', { className: 'dcAgentPromptImageMeta' },
                  h('b', null, imageFileName),
                  h('small', null, imageCommand?.state === 'completed'
                    ? `已识别 ${entryCount} 条，下一步逐条核验`
                    : imageCommand?.state === 'running'
                      ? '识别中…'
                      : imageCommand?.state === 'failed'
                        ? '识别失败，可移除后重试'
                        : '已暂存，可继续选择匹配规则和补全字段'),
                ),
                h('button', { type: 'button', className: 'dcAgentPromptImageRemove', disabled: busy || imageCommand?.state === 'running', onClick: removeCurrentImage }, '移除'),
              ) : h('label', { className: 'dcAgentPromptFile' },
                h('span', null, '选择包含企业名单的图片'),
                h('input', {
                  type: 'file', accept: 'image/png,image/jpeg,image/webp',
                  disabled: busy, onChange: handleFile,
                }),
              ),
              imageCommand?.state === 'completed' && entries.length ? h('div', { className: 'dcAgentPromptChoices' },
                entries.slice(0, 12).map((entry, index) => h('span', { key: `${entry}-${index}`, className: 'dcAgentPromptChoice is-selected' }, `${index + 1}. ${entry}`)),
                entries.length > 12 ? h('span', { className: 'dcAgentPromptChoice' }, `另 ${entries.length - 12} 条`) : null,
              ) : null,
            ) : h('label', { className: 'dcAgentPromptFile' },
              h('span', null, mode === 'image' ? '选择包含企业名单的图片' : '选择 CSV / XLSX / JSON 名单'),
              h('input', {
                type: 'file', accept: mode === 'image' ? 'image/png,image/jpeg,image/webp' : '.xlsx,.xls,.csv,.json',
                disabled: busy, onChange: handleFile,
              }),
              (mode === 'excel' ? spreadsheetFileName : imageFileName)
                ? h('b', null, `${mode === 'excel' ? spreadsheetFileName : imageFileName}${mode === 'excel' ? ` · ${entryCount} 条` : ' · 已附加'}`)
                : null,
            ),
            mode === 'excel' && spreadsheetData ? h(DatasetReview, {
              rows: spreadsheetData.rows || [], headers: spreadsheetData.headers || [],
              title: `已载入：${spreadsheetFileName} · ${entryCount} 条 / ${spreadsheetData.headers?.length || 0} 列`,
              expectedCount: entryCount, onError: setError,
            }) : null,
            mode === 'excel' && spreadsheetData ? h('p', { className: 'dcAgentHint' },
              `原表空白单元格：${(spreadsheetData.rows || []).reduce((n, row) => n + (spreadsheetData.headers || []).filter((key) => row[key] == null || String(row[key]).trim() === '').length, 0)} 个。下一步确认原列映射；文件已保存在本次任务中。`) : null,
          ) : null,
          wizardStep === 2 ? h('div', { className: 'dcAgentWizardPane' },
            h('h4', null, '确认匹配规则'),
            h('p', null, '强标识优先；名称定位不明确时生成候选，不自动写回。'),
            mode === 'excel' ? h('div', null,
              h('p', { className: 'dcAgentHint' }, '绿色＝自动通过 / 已确认；黄色＝待人工确认；红色＝未匹配。这里是原列与字段的映射，不是企业查询结果。确认映射即选入补全范围，无需再重复勾选。'),
              mappingRecommendations(spreadsheetData?.headers || []).map((recommendation) => h(MappingPicker, {
                key: recommendation.sourceField, sourceField: recommendation.sourceField, mappings: spreadsheetMappings,
                groups: [...FIELD_GROUPS, ['input-only', '输入校验字段', INPUT_ONLY_MAPPING_OPTIONS]], recommendation,
                onChange: (sourceField, targetField) => {
                  const next = updateColumnMapping(spreadsheetMappings, sourceField, targetField);
                  setEnrichmentKeys(syncMappedSelection(spreadsheetMappings, next, enrichmentKeys));
                  setSpreadsheetMappings(next);
                  setAnchorKeys(next.filter((item) => isAnchorField(item.targetField)).map((item) => item.targetField));
                },
              })),
            ) : h('div', { className: 'dcAgentPromptChoices' }, choice(MATCH_ANCHOR_OPTIONS, anchorKeys, setAnchorKeys)),
            h('div', { className: 'dcAgentPromptRules' },
              [['normalizeNames', '匹配前统一企业名称格式'], ['preferCreditNo', '有信用代码时优先精确匹配'], ['deduplicate', '匹配前合并重复主体'], ['manualReviewAmbiguous', '多候选必须人工确认']].map(([key, label]) => h('label', { key },
                h('input', { type: 'checkbox', checked: matchRules[key], onChange: (event) => setPromptMatchRules({ ...matchRules, [key]: event.target.checked }) }), label,
              )),
            ),
          ) : null,
          wizardStep === 3 ? h('div', { className: 'dcAgentWizardPane' },
            h('h4', null, '选择清洗目标和补全字段'),
            h('p', null, `共 ${ENRICHMENT_OPTIONS.length} 个一企一行字段。最终可用字段以当前用户连接的 QCC MCP 能力为准。`),
            mode === 'excel' ? h('p', { className: 'dcAgentHint' }, `已按确认映射选择 ${mappedOutputFields(spreadsheetMappings).length} 个原列补全字段，无需重复选择。以下仅用于追加原表之外的字段；默认只补空白、保留原值。`) : null,
            h('div', { className: 'dcAgentPromptGroup' },
              h('b', null, '清洗目标'),
              h('div', { className: 'dcAgentPromptChoices' }, choice(CLEANING_OPTIONS, cleaningKeys, setCleaningKeys)),
            ),
            h('details', { className: 'dcAgentExtraFields', open: mode !== 'excel' },
            h('summary', null, `可选：追加补全字段（共 ${ENRICHMENT_OPTIONS.length} 项）`),
            h('label', { className: 'dcAgentPromptField' },
              h('span', null, `查找补全字段 · 已选 ${enrichmentKeys.length}`),
              h('input', { type: 'search', className: 'dcAgentField', value: fieldQuery, 'aria-label': '查找补全字段',
                placeholder: '搜索维度、字段或工具名称', onChange: (event) => setFieldQuery(event.target.value) })),
            !FIELD_GROUPS.some((group) => visibleCatalogFields(group, fieldQuery).length) ? h('p', { className: 'dcAgentHint', role: 'status' }, '没有匹配的字段；已选字段保持不变。') : null,
            FIELD_GROUPS.filter((group) => visibleCatalogFields(group, fieldQuery).length).map(([groupId, label, fields, sourceTool]) => h('div', { className: 'dcAgentPromptGroup dcAgentFieldGroup', key: groupId },
              h('div', { className: 'dcAgentFieldGroupHead' },
                h('div', null,
                  h('b', null, `${label} · ${fields.filter(([id]) => enrichmentKeys.includes(id)).length}/${fields.length}`),
                  sourceTool ? h('small', { className: 'dcAgentHint' }, `来源：${sourceTool}`) : null,
                ),
                h('div', { className: 'dcAgentFieldGroupActions' },
                  h('button', { type: 'button', className: 'dcAgentFieldAction', title: '选中本维度全部字段，不受搜索过滤影响', onClick: () => setPromptFieldGroup(fields, true) }, '全选'),
                  h('button', { type: 'button', className: 'dcAgentFieldAction', title: '清空本维度全部字段，不受搜索过滤影响', onClick: () => setPromptFieldGroup(fields, false) }, '清空'),
                ),
              ),
              h('div', { className: 'dcAgentPromptFieldGrid' }, visibleCatalogFields([groupId, label, fields, sourceTool], fieldQuery).map(([id, fieldLabel]) => h('label', {
                key: id, className: `dcAgentPromptChoice${enrichmentKeys.includes(id) ? ' is-selected' : ''}`,
              }, h('input', { type: 'checkbox', checked: enrichmentKeys.includes(id), disabled: mode === 'excel' && mappedOutputFields(spreadsheetMappings).includes(id),
                onChange: (event) => setEnrichmentKeys((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((key) => key !== id)),
              }), fieldLabel))),
            )),
            ),
          ) : null,
          wizardStep === 4 ? h('div', { className: 'dcAgentWizardPane' },
            h('h4', null, '确认任务描述'),
            h('p', null, '回填后仍可在对话框继续编辑；回填本身不会调用企查查 MCP。'),
            h('pre', { className: 'dcAgentPromptPreview' }, buildTaskPrompt(promptConfig())),
          ) : null,
          h('p', { className: 'dcAgentPromptNote' }, '向导只生成任务描述并保存任务设置。只有你在任务中明确确认后，才会使用当前客户自己的企查查 MCP 连接、账号和额度。'),
          mode === 'image' && imageCommand?.state === 'prepared' && imageCommand?.providerIssue
            ? h('p', { className: 'dcAgentPromptNote', role: 'status' }, `图片已载入，可继续选择规则和字段；暂存有效期 15 分钟。${imageCommand.providerIssue.message}`)
            : null,
          error ? h('p', { className: 'dcAgentPromptError', role: 'alert' }, error) : null,
          ),
          h('div', { className: 'dcAgentPromptActions' },
            h('button', { type: 'button', className: 'dcAgentPromptAction', disabled: wizardStep === 1, onClick: () => setWizardStep(Math.max(1, wizardStep - 1)) }, '上一步'),
            h('button', { type: 'button', className: 'dcAgentPromptAction is-primary', disabled: busy || imageCommand?.state === 'running', onClick: nextWizard }, busy
              ? '处理中…'
              : wizardStep === 1 && mode === 'image' && imageCommand?.state === 'running'
                  ? '图片识别中…'
                  : wizardStep === 4 ? '回填到对话框' : '下一步'),
          ),
        ) : null,
        imageLightbox && imageAttachment?.previewUrl ? h(ImagePreview, {
          src: imageAttachment.previewUrl, alt: imageFileName, sessionId, onClose: () => setImageLightbox(false),
        }) : null,
      );
    }

    /** 会话头部的可恢复入口：关闭右栏后仍可从当前会话再次打开。 */
    function WorkbenchHeaderEntry(props) {
      const { sessionId } = props;
      const enabled = useCleaningSession(sessionId);
      if (!enabled) return null;
      return h('button', {
        type: 'button',
        className: 'dcAgentHeaderAction',
        'aria-label': '打开数据清洗补全工作台',
        title: '打开数据清洗补全工作台',
        onClick: () => requestWorkbenchOpen(null, sessionId),
      },
        h(DatabaseLogo, { size: 16 }),
        h('span', null, '清洗补全工作台'),
      );
    }

    /** 模型工具 tool.call.toolview 卡片元数据（wire 名 → 展示文案）。 */
    const TOOL_VIEW_META = {
      data_cleaning_qcc_run: { icon: '🧩', label: '企查查清洗补全结果', hint: '已处理包含未匹配或失败；不等于已补全。' },
      data_clean_rows: { icon: '🧹', label: '数据清洗', hint: '去重 · 剔除非法金额 · 缺失补 0' },
      data_complete_rows: { icon: '🧩', label: '数据补全', hint: '名称 / 金额 / 手机号归一' },
      data_profile: { icon: '🩺', label: '数据体检', hint: '缺失率 · 去重值 · 金额分布' },
      data_cleaning_extract_image_companies: { icon: '🖼️', label: '图片名单识别', hint: 'OCR · 企业名称 / 信用代码提取 · 人工核验' },
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
        toolName === 'data_cleaning_qcc_run' ? h('div', { className: 'dcAgentArtifactList' },
          [...summary.matchAll(/\[([^\]]+)\]\(((?:https?:\/\/[a-zA-Z0-9.:[\]-]+)?\/data-cleaning\/api\/workflow\/tasks\/[a-zA-Z0-9%_-]+\/artifacts\/[a-zA-Z0-9%_-]+(?:\?preview=1)?)\)/g)].filter(match => match[2].startsWith('/') || (typeof location !== 'undefined' && new URL(match[2]).origin === location.origin)).map((match, index) =>
            h('a', { key: index, className: 'dcAgentButton', href: match[2], target: '_blank', rel: 'noopener noreferrer' }, match[1]))) : null,
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
    async function loadWorkflowTasks(actions) {
      try {
        const response = await requestJson('/data-cleaning/api/workflow/tasks');
        actions.setWorkflowTasks(response.tasks || []);
        return response.tasks || [];
      } catch (_error) {
        return [];
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
    function intakeState(dataset, sourceRows, input, source) {
      const count = Number(dataset?.rowCount || 0);
      const available = count > 0 && Array.isArray(sourceRows) && sourceRows.length === count;
      return {
        available,
        pendingText: Boolean(String(input ?? '').trim()),
        fileName: source?.fileName || (source?.type === 'image' ? '图片识别名单' : '粘贴 / 向导导入名单'),
        count,
      };
    }

    async function parseText(text, actions) {
      const trimmed = (text ?? '').trim();
      if (!trimmed) {
        actions.setError('请粘贴或上传数据后再解析。');
        return;
      }
      if (trimmed.startsWith('[')) {
        try {
          const rows = JSON.parse(trimmed);
          const list = Array.isArray(rows) ? rows : [];
          const headers = list.length ? Object.keys(list[0]) : [];
          return { ok: true, fmt: 'json', headers, rowCount: list.length, rows: list, preview: list.slice(0, 5) };
        } catch (error) {
          actions.setError(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      const entityList = plainEntityListDataset(trimmed);
      if (entityList) return entityList;
      return api('/data-cleaning/api/mvp/parse', { filename: 'data.csv', content: trimmed });
    }

    /** 解析成功进入 taskId runtime；不把整表写入 Host store。 */
    function applyParsed(result, actions, taskId = 'unassigned', source = {}) {
      const runtime = runtimeFor(taskId);
      runtime.rows = Array.isArray(result.rows) ? result.rows : [];
      runtime.sourceRows = runtime.rows;
      runtime.headers = Array.isArray(result.headers) ? result.headers : [];
      runtime.source = {
        type: source.type || result.fmt || 'csv',
        fileName: source.fileName || '',
        sizeBytes: source.sizeBytes || 0,
      };
      const mappings = guessMappings(runtime.headers);
      const guessedNameField = mappings.find((mapping) => mapping.targetField === 'company_name')?.sourceField
        ?? mappings.find((mapping) => mapping.targetField === 'credit_no')?.sourceField
        ?? mappings.find((mapping) => mapping.targetField === 'reg_no')?.sourceField
        ?? runtime.headers[0]
        ?? 'name';
      actions.setNameField(guessedNameField);
      actions.setMappings(mappings);
      if (result.fmt !== 'text') actions.setFieldSelection(mappedOutputFields(mappings));
      actions.setDataset({
        fmt: result.fmt ?? 'csv',
        headers: runtime.headers,
        rowCount: typeof result.rowCount === 'number' ? result.rowCount : runtime.rows.length,
        preview: Array.isArray(result.preview) ? result.preview : runtime.rows.slice(0, 5),
      });
      return runtime;
    }

    async function persistParsedWorkflow(actions, sessionId, result, source = {}, task) {
      const importedMappings = guessMappings(result.headers || []);
      const importedDraft = { mappings: importedMappings,
        fieldSelection: result.fmt === 'text' ? DEFAULT_ENRICHMENT_KEYS : mappedOutputFields(importedMappings) };
      let current = await ensureEditableWorkflowTask(actions, sessionId, importedDraft, task);
      const stagingKey = `session:${sessionId || 'unassigned'}`;
      moveRuntime(stagingKey, current.id);
      // handleParse 可能先把新数据写入旧 task runtime。无论是否新建 taskId，
      // 都以本次解析结果覆盖目标 runtime，避免复用已完成任务的一行旧数据。
      const target = runtimeFor(current.id);
      target.rows = Array.isArray(result.rows) ? result.rows : [];
      target.sourceRows = target.rows;
      target.headers = Array.isArray(result.headers) ? result.headers : [];
      target.source = {
        type: source.type || result.fmt || 'csv',
        fileName: source.fileName || '',
        sizeBytes: source.sizeBytes || 0,
      };
      if (['draft', 'uploaded', 'parse_failed'].includes(current.state)) {
        current = await workflowAction(actions, sessionId, current, 'upload', {
          source: {
            type: source.type || result.fmt || 'csv',
            fileName: source.fileName || '',
            rowCount: typeof result.rowCount === 'number' ? result.rowCount : (result.rows || []).length,
            columnCount: Array.isArray(result.headers) ? result.headers.length : 0,
            headers: Array.isArray(result.headers) ? result.headers : [],
            sizeBytes: source.sizeBytes || 0,
          },
        });
      }
      if (current.state === 'uploaded') current = await updateWorkflowTask(actions, sessionId, current, importedDraft);
      return current;
    }

    function reviewColumns(rows, headers = []) {
      return [...new Set([...headers, ...rows.flatMap((row) => Object.keys(row || {}))])];
    }

    function reviewCsv(rows, headers) {
      const cell = (value) => {
        let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        // 保留长编号的文本形式，阻止外部 OCR/企业字段成为 Excel 公式。
        if (/^[\s]*[=+@-]/.test(text) || /^\d{15,}$/.test(text) || /^0\d+/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      };
      return '\uFEFF' + [headers.map((key) => cell(resultFieldLabel(key))).join(','),
        ...rows.map((row) => headers.map((key) => cell(row?.[key])).join(','))].join('\r\n');
    }

    /** 页内查看和核验下载均使用完整 rows，不使用 store 的五行摘要。 */
    function DatasetReview({ rows, headers, title, expectedCount, onError }) {
      const [page, setPage] = react.useState(0);
      const pageSize = 20;
      const total = rows.length;
      const columns = reviewColumns(rows, headers);
      const currentPage = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
      const start = currentPage * pageSize;
      const download = (format) => {
        try {
          const content = format === 'csv' ? reviewCsv(rows, columns) : JSON.stringify(rows, null, 2);
          const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = title + '.' + format;
          try { anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
        } catch (error) { onError?.(error instanceof Error ? error.message : String(error)); }
      };
      const complete = expectedCount == null || expectedCount === total;
      return h('section', { className: 'dcAgentSection', 'aria-label': title },
        h('h3', null, title),
        h('p', { className: 'dcAgentHint', role: 'status' }, complete
          ? `共 ${total} 条，当前显示 ${total ? start + 1 : 0}–${Math.min(start + pageSize, total)} 条；共 ${columns.length} 列，可横向滚动。`
          : `完整清单尚未就绪：预期 ${expectedCount} 条，当前载入 ${total} 条。请等待同步；刷新后若仍缺失，请重新上传源文件。`),
        h('div', { className: 'dcAgentPreviewTable', tabIndex: 0, role: 'region', 'aria-label': '表格预览，可横向和纵向滚动，表头固定', style: { overflow: 'auto', maxHeight: '420px' } },
          h('table', { className: 'dcAgentTable' },
            h('thead', null, h('tr', null, h('th', null, '序号'), columns.map((key) => h('th', { key }, resultFieldLabel(key))))),
            h('tbody', null, rows.slice(start, start + pageSize).map((row, index) => h('tr', { key: start + index },
              h('td', null, String(start + index + 1)),
              columns.map((key) => h('td', { key }, row?.[key] == null ? '' : typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key]))),
            ))),
          ),
        ),
        h('div', { className: 'dcAgentRow' },
          h('button', { type: 'button', className: 'dcAgentButton', disabled: currentPage === 0, onClick: () => setPage(currentPage - 1) }, '上一页'),
          h('span', null, `第 ${currentPage + 1} / ${Math.max(1, Math.ceil(total / pageSize))} 页`),
          h('button', { type: 'button', className: 'dcAgentButton', disabled: start + pageSize >= total, onClick: () => setPage(currentPage + 1) }, '下一页'),
        ),
        h('div', { className: 'dcAgentRow' },
          h('button', { type: 'button', className: 'dcAgentButton', disabled: !complete || !total, onClick: () => download('csv') }, `下载全部 ${total} 条 CSV`),
          h('button', { type: 'button', className: 'dcAgentButton', disabled: !complete || !total, onClick: () => download('json') }, '下载原值 JSON'),
        ),
        h('p', { className: 'dcAgentHint' }, '下载包含全部行，不受分页影响。CSV 对公式及长编号作文本保护；JSON 保留原值。仅导出当前清单，不触发企查查调用。'),
      );
    }

    /** Session Tab 业务内容；尺寸、停靠、关闭均由 Better Sidebar 宿主管理。 */
    function WorkbenchContent(props) {
      const { useStore, actions } = props;
      const visible = props.visible !== false;
      const sendSessionCommand = props.sendSessionCommand;
      const setSessionDraft = props.setSessionDraft;
      const open = useStore((state) => state.open);
      const step = useStore((state) => state.step);
      const busy = useStore((state) => state.busy);
      const error = useStore((state) => state.error);
      const input = useStore((state) => state.input);
      const workflowContract = useStore((state) => state.workflowContract);
      const workflowTask = useStore((state) => state.workflowTask);
      const workflowTasks = useStore((state) => state.workflowTasks);
      const taskTitle = useStore((state) => state.taskTitle);
      const mappings = useStore((state) => state.mappings);
      const objectives = useStore((state) => state.objectives);
      const fieldSelection = useStore((state) => state.fieldSelection);
      const matchRules = useStore((state) => state.matchRules);
      const dataset = useStore((state) => state.dataset);
      const profile = useStore((state) => state.profile);
      const clean = useStore((state) => state.clean);
      const complete = useStore((state) => state.complete);
      const nameField = useStore((state) => state.nameField);
      const selectedDomains = useStore((state) => state.selectedDomains);
      const qccCapabilities = useStore((state) => state.qccCapabilities);
      const qccRun = useStore((state) => state.qccRun);
      const commandProgress = useStore((state) => state.commandProgress);
      const paidConfirmed = useStore((state) => state.paidConfirmed);
      const activeSessionId = useStore((state) => state.activeSessionId);
      const [fieldQuery, setFieldQuery] = react.useState('');

      react.useEffect(() => {
        if (!open || !visible) return undefined;
        let disposed = false;
        requestJson('/data-cleaning/api/workflow/contract').then((response) => {
          if (!disposed) actions.setWorkflowContract(response.contract);
        }).catch(() => {});
        loadWorkflowTasks(actions);
        if (activeSessionId) {
          queueWorkflowOperation(activeSessionId, async () => {
            const key = String(activeSessionId);
            const saved = ownedSessionId(key) ? readTaskBindings()[key] : null;
            const taskId = workflowTaskBySession.get(key)?.id || (/^dcw-[a-zA-Z0-9-]+$/.test(saved || '') ? saved : null);
            if (taskId) await refreshHostedTask(actions, activeSessionId, taskId, null, false);
          }).catch((taskError) => {
            if (!disposed) actions.setError(taskError instanceof Error ? taskError.message : String(taskError));
          });
        }
        return () => { disposed = true; };
      }, [open, visible, activeSessionId, actions]);

      // Reopening during execution follows Host metadata, even when the original
      // command watcher was lost on page reload. This performs no QCC calls.
      react.useEffect(() => {
        if (!open || !visible || !workflowTask?.id || !['matching', 'enriching'].includes(workflowTask.state)) return undefined;
        let disposed = false, timer;
        const poll = async () => {
          try {
            const task = await refreshHostedTask(actions, activeSessionId, workflowTask.id, null, false);
            if (disposed) return;
            if (['matching', 'enriching'].includes(task.state)) timer = setTimeout(poll, 2000);
            else if (step === 'match' || step === 'enrich') actions.setStep(task.stage || step);
          } catch (error) { if (!disposed) actions.setError(error.message); }
        };
        timer = setTimeout(poll, 2000);
        return () => { disposed = true; clearTimeout(timer); };
      }, [open, visible, workflowTask?.id, workflowTask?.state, activeSessionId, step, actions]);

      // Host 决定 Tab 挂载/可见性；内容不再按私有 open flag 隐藏。

      const hasData = dataset !== null && dataset.rowCount > 0;
      const requiresQcc = objectives.includes('validate_identity') || objectives.includes('complete_fields');
      const cachedTask = workflowTaskBySession.get(String(activeSessionId || 'unassigned')) ?? workflowTask;
      const runtimeKey = cachedTask?.id ?? `session:${activeSessionId || 'unassigned'}`;
      const runtime = runtimeFor(runtimeKey);
      const stagedSource = runtimeFor(`session:${activeSessionId || 'unassigned'}`, false);
      const sourceRows = stagedSource?.sourceRows ?? runtime.sourceRows ?? runtime.rows;
      const intake = intakeState(dataset, sourceRows, input, runtime.source || stagedSource?.source || cachedTask?.source);
      const lastCsv = runtime.lastCsv;
      const fieldByPattern = (pattern) => runtime.headers.find((field) => pattern.test(field)) ?? null;
      const phoneField = fieldByPattern(/^(phone|mobile|tel|telephone|联系电话|手机号码|手机号)$/i);
      const amountField = fieldByPattern(/^(amount|price|金额|注册资本)$/i);
      const localCleanOptions = {
        required: nameField ? [nameField] : [],
        dedupeOn: nameField || null,
        phoneField,
        amountField,
      };
      const localCompleteOptions = {
        phoneField,
        amountField,
        // 企业名称不能由占位符补全；缺失值交给人工/QCC 匹配队列处理。
        fillableName: false,
      };

      const handleParse = async () => {
        if (busy) return;
        if (!intake.pendingText) {
          if (intake.available) actions.setError(null);
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const result = await parseText(input, actions);
          if (result && result.ok !== false) {
            applyParsed(result, actions, runtimeKey, { type: result.fmt || 'csv' });
            await persistParsedWorkflow(actions, activeSessionId, result, { type: result.fmt || 'csv' }, cachedTask);
            actions.setInput('');
          } else if (result) {
            actions.setError(result.message || result.error || '解析失败，已导入的数据保持不变。');
          }
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const openImageIntake = (file = null) => {
        if (!requestPromptImage(activeSessionId, file)) {
          actions.setError('图片入口尚未就绪或正在处理图片，请回到当前清洗会话稍后重试。');
          return false;
        }
        actions.close();
        return true;
      };
      const handleFile = async (event) => {
        if (busy) return;
        const file = event.target && event.target.files && event.target.files[0];
        if (!file) return;
        if (String(file.type ?? '').startsWith('image/')) {
          openImageIntake(file);
          event.target.value = '';
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const result = await parseFile(file);
          if (result && result.ok !== false) {
            applyParsed(result, actions, runtimeKey, { type: result.fmt || 'csv', fileName: file.name, sizeBytes: file.size || 0 });
            await persistParsedWorkflow(actions, activeSessionId, result, { type: result.fmt || 'csv', fileName: file.name, sizeBytes: file.size || 0 }, cachedTask);
            actions.setInput('');
          }
          else actions.setError((result && (result.message || result.error)) || '解析失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          event.target.value = '';
          actions.setBusy(false);
        }
      };

      const performProfile = async (task) => {
        const r = await api('/data-cleaning/api/mvp/profile', {
          rows: runtime.rows,
          headers: runtime.headers,
          options: { amountField },
        });
        if (!r || r.ok === false) throw new Error((r && (r.message || r.error)) || '体检失败');
        const quality = qualitySummaryFor(runtime.rows, mappings);
        actions.setProfile({ ...(r.summary ?? r), workflowSummary: quality });
        return workflowAction(actions, activeSessionId, task, 'quality', { summary: quality });
      };

      const runProfile = async () => {
        if (busy || !runtime.rows.length) {
          if (!runtime.rows.length) actions.setError('请先上传并解析数据。');
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          await performProfile(cachedTask);
          actions.setStep(requiresQcc ? 'match' : 'enrich');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const runClean = async () => {
        if (busy || !runtime.rows.length) {
          if (!runtime.rows.length) actions.setError('请先上传并解析数据。');
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/mvp/clean', {
            rows: runtime.rows,
            headers: runtime.headers,
            options: localCleanOptions,
          });
          if (r && r.ok !== false) {
            actions.setClean(r.summary ?? r);
            lastCsv.clean = { csv: r.csv ?? '', name: r.downloadName ?? 'cleaned.csv' };
            runtime.resultRows.clean = Array.isArray(r.rows) ? r.rows : null;
            if (Array.isArray(r.headers) && r.headers.length) runtime.headers = r.headers;
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
        if (busy || !runtime.rows.length) {
          if (!runtime.rows.length) actions.setError('请先上传并解析数据。');
          return;
        }
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/mvp/complete', {
            rows: runtime.rows,
            headers: runtime.headers,
            options: localCompleteOptions,
          });
          if (r && r.ok !== false) {
            actions.setComplete(r.summary ?? r);
            lastCsv.complete = { csv: r.csv ?? '', name: r.downloadName ?? 'completed.csv' };
            runtime.resultRows.complete = Array.isArray(r.rows) ? r.rows : null;
            if (Array.isArray(r.headers) && r.headers.length) runtime.headers = r.headers;
          } else {
            actions.setError((r && (r.message || r.error)) || '补全失败');
          }
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const applyQccRun = async (run) => {
        actions.setQccRun(run);
        runtime.rows = Array.isArray(run.rows) ? run.rows : runtime.rows;
        runtime.resultRows.qcc = Array.isArray(run.rows) ? run.rows : null;
        lastCsv.qcc = { csv: run.csv ?? '', name: run.downloadName ?? 'qcc-enriched.csv' };
        if (run.reviewCsv) lastCsv.review = { csv: run.reviewCsv, name: run.reviewDownloadName ?? 'qcc-review.csv' };
        const summary = run.summary ?? {};
        const reviewRequired = Number(summary.ambiguous ?? run.reviewQueue?.length ?? 0);
        const currentTask = workflowTaskBySession.get(String(activeSessionId || 'unassigned')) ?? cachedTask;
        let current = currentTask;
        if (currentTask?.qccRunId === run.runId && ['completed', 'partial', 'review_required', 'export_ready'].includes(currentTask.state)) {
          actions.setStep(currentTask.stage || 'download');
          return currentTask;
        }
        // partial 表示上一轮仍有失败项。重试成功后可直接重进 enrichment，
        // 无需伪造一次新的 match 转换；若重试产生候选，再回到人工核验。
        if (currentTask?.state !== 'partial' || reviewRequired > 0) {
          current = await workflowAction(actions, activeSessionId, currentTask, 'match', {
            qccRunId: run.runId,
            summary: {
              total: Number(summary.totalRows ?? runtime.rows.length),
              exact: Number(summary.enriched ?? 0) + Number(summary.fieldReview ?? 0),
              candidate: reviewRequired,
              confirmed: 0,
              unresolved: Number(summary.unresolved ?? summary.missingName ?? 0),
              failed: Number(summary.failed ?? 0),
              reviewRequired,
            },
          });
        }
        if (reviewRequired > 0) {
          actions.setStep('match');
          return current;
        }
        current = await workflowAction(actions, activeSessionId, current, 'enrich-start', { fieldSelection });
        current = await workflowAction(actions, activeSessionId, current, 'enrichment', {
          qccRunId: run.runId,
          summary: {
            total: Number(summary.totalRows ?? runtime.rows.length),
            completed: Number(summary.enriched ?? 0),
            unchanged: Number(summary.unresolved ?? 0) + Number(summary.missingName ?? 0),
            failed: Number(summary.failed ?? 0),
            reviewRequired: Number(summary.fieldReview ?? 0),
            callsUsed: Array.isArray(run.audit) ? run.audit.length : 0,
          },
        });
        actions.setStep(current.stage === 'download' ? 'download' : 'enrich');
        return current;
      };

      const executePreparedQccCommand = async (payload) => {
        if (!activeSessionId || typeof sendSessionCommand !== 'function') {
          throw new Error('当前会话无法提交数据清洗补全企查查任务');
        }
        const latest = workflowTaskBySession.get(String(activeSessionId)) ?? cachedTask;
        const prepared = await api('/data-cleaning/api/g5/commands', {
          ...payload, workflowOwned: true, expectedRevision: latest.revision,
          ...(payload.kind === 'enrich' ? {} : { confirmPaidCalls: true }),
        });
        const command = prepared?.command;
        if (!command?.commandId || !command?.prompt) throw new Error('Host 未返回有效的企查查任务命令');
        await sendSessionCommand(activeSessionId, command.prompt);
        const completedCommand = await waitForQccCommand(command.commandId);
        await refreshHostedTask(actions, activeSessionId, command.taskId, completedCommand.run);
        if (completedCommand.state === 'failed') {
          const commandError = new Error(completedCommand.error?.message || '智能体企查查任务执行失败');
          commandError.code = completedCommand.error?.code;
          throw commandError;
        }
        if (!completedCommand.run) throw new Error('智能体企查查任务完成但结果已失效');
        return completedCommand.run;
      };

      const prepareEditableQccCommand = async () => {
        if (!activeSessionId || typeof setSessionDraft !== 'function') {
          throw new Error('当前会话无法回填可编辑的数据清洗补全任务说明');
        }
        const command = await queueWorkflowOperation(activeSessionId, () => stageConfirmedWorkflow(actions, activeSessionId));
        setSessionDraft(activeSessionId, command.prompt);
        actions.close();
        watchHostedCommand(actions, activeSessionId, command);
        return command;
      };

      const runQcc = async () => {
        if (busy || !cachedTask?.id || !hasData) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          await prepareEditableQccCommand({
            kind: 'enrich',
            taskId: cachedTask.id,
            rows: runtime.rows,
            headers: runtime.headers,
            nameField,
            fieldSelection,
            includeRisk: false,
            concurrency: 2,
          });
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
          const task = workflowTaskBySession.get(String(activeSessionId || 'unassigned')) ?? cachedTask;
          const r = await executePreparedQccCommand({
            kind: 'resolve',
            taskId: task.id,
            runId: qccRun.runId,
            companyName: item.companyName,
            selectedCreditNo: candidate.creditNo,
          });
          await applyQccRun(r);
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
          const task = workflowTaskBySession.get(String(activeSessionId || 'unassigned')) ?? cachedTask;
          const r = await executePreparedQccCommand({
            kind: 'retry',
            taskId: task.id,
            runId: qccRun.runId,
            companyNames: names,
          });
          await applyQccRun(r);
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const saveTaskSettings = async () => {
        actions.setBusy(true);
        actions.setError(null);
        try {
          const current = await ensureWorkflowTask(actions, activeSessionId, {
            title: taskTitle, objectives, fieldSelection, mappings, matchRules,
          });
          await updateWorkflowTask(actions, activeSessionId, current, {
            title: taskTitle, objectives, fieldSelection, mappings, matchRules,
          });
        } catch (saveError) {
          actions.setError(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
          actions.setBusy(false);
        }
      };

      const confirmRuleSettings = async () => {
        if (!hasData) { actions.setError('请先上传并解析数据。'); return; }
        const anchorMappings = mappings.filter((mapping) => ['company_name', 'credit_no', 'reg_no'].includes(mapping.targetField));
        if (!anchorMappings.length) { actions.setError('请至少映射企业名称、统一社会信用代码或注册号。'); return; }
        if (!objectives.length) { actions.setError('请至少选择一个清洗或补全目标。'); return; }
        actions.setBusy(true);
        actions.setError(null);
        try {
          let current = await ensureWorkflowTask(actions, activeSessionId, {
            title: taskTitle, objectives, fieldSelection, mappings, matchRules,
          });
          if (current.state === 'draft') {
            current = await workflowAction(actions, activeSessionId, current, 'upload', {
              source: {
                type: runtime.source?.type || dataset.fmt || 'csv',
                fileName: runtime.source?.fileName || '',
                rowCount: dataset.rowCount,
                columnCount: dataset.headers?.length || 0,
                headers: dataset.headers || [],
                sizeBytes: runtime.source?.sizeBytes || 0,
              },
            });
          }
          current = await updateWorkflowTask(actions, activeSessionId, current, {
            title: taskTitle, objectives, fieldSelection, mappings, matchRules,
          });
          current = await workflowAction(actions, activeSessionId, current, 'rules', {
            objectives, fieldSelection, mappings, matchRules,
          });
          current = await performProfile(current);
          const primary = mappings.find((mapping) => mapping.targetField === 'company_name')
            ?? mappings.find((mapping) => mapping.targetField === 'credit_no')
            ?? mappings.find((mapping) => mapping.targetField === 'reg_no');
          if (primary) actions.setNameField(primary.sourceField);
          actions.setStep('profile');
        } catch (ruleError) {
          actions.setError(ruleError instanceof Error ? ruleError.message : String(ruleError));
        } finally {
          actions.setBusy(false);
        }
      };

      const resumeWorkflowTask = async (task) => {
        try {
          workflowTaskBySession.set(String(activeSessionId), task);
          task = await refreshHostedTask(actions, activeSessionId, task.id);
          if (task.qccRunId) {
            try {
              const response = await api(`/data-cleaning/api/g5/run/${encodeURIComponent(task.qccRunId)}`);
              actions.setQccRun(response);
            } catch { /* Expired run data does not prevent persisted artifact downloads. */ }
          }
        } catch (error) { actions.setError(error.message); return; }
        workflowTaskBySession.set(String(activeSessionId || 'unassigned'), task);
        actions.setWorkflowTask(task);
        actions.setTaskTitle(task.title);
        actions.setMappings(task.mappings || []);
        actions.setObjectives(task.objectives || []);
        actions.setFieldSelection(task.fieldSelection || []);
        for (const [key, value] of Object.entries(task.matchRules || {})) actions.setMatchRule(key, value);
        actions.setStep(task.stage || 'upload');
        if (!runtimeFor(task.id, false)?.rows?.length && task.source?.rowCount && !(task.artifacts || []).length) {
          actions.setDataset(null);
          actions.setError('已恢复任务元数据。出于隐私保护，原始企业名单未持久化；继续处理前请重新上传源文件。');
        }
      };

      const startNewWorkflow = () => {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent('dsh:data-cleaning-prompt-new', false, true, { sessionId: activeSessionId });
        if (document.dispatchEvent(event)) {
          actions.setError('当前会话的任务向导尚未就绪或正在解析图片，请稍后重试。');
          return;
        }
        if (cachedTask?.id) runtimeTasks.delete(String(cachedTask.id));
        runtimeTasks.delete(`session:${activeSessionId || 'unassigned'}`);
        runtimeTasks.delete('unassigned');
        workflowTaskBySession.delete(String(activeSessionId || 'unassigned'));
        actions.resetWorkflow();
        actions.close();
      };

      const exportRows = () => runtime.resultRows.qcc
        ?? runtime.resultRows.complete
        ?? runtime.resultRows.clean
        ?? (runtime.rows.length ? runtime.rows : null);

      const createArtifactBundle = async () => {
        let latest = workflowTaskBySession.get(String(activeSessionId || 'unassigned')) ?? cachedTask;
        if (!latest) throw new Error('请先创建并执行数据清洗补全任务。');
        if (Array.isArray(latest.artifacts) && latest.artifacts.length) return latest;
        const rows = exportRows();
        if (!rows?.length) throw new Error('当前页面没有可导出的明细。若任务来自历史记录，请重新上传源文件并继续处理。');
        const response = await requestJson(`/data-cleaning/api/workflow/tasks/${encodeURIComponent(latest.id)}/artifacts`, 'POST', {
          expectedRevision: latest.revision,
          headers: runtime.headers,
          rows,
          baseName: latest.title || taskTitle,
          summary: {
            total: rows.length,
            completed: rows.length,
            unchanged: 0,
            failed: 0,
          },
        });
        latest = cacheWorkflowTask(actions, activeSessionId, response.task);
        loadWorkflowTasks(actions);
        return latest;
      };

      const downloadArtifact = async (artifact) => {
        if (!artifact || busy) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const latest = workflowTaskBySession.get(String(activeSessionId || 'unassigned')) ?? cachedTask;
          const response = await fetch(`/data-cleaning/api/workflow/tasks/${encodeURIComponent(latest.id)}/artifacts/${encodeURIComponent(artifact.id)}`, {
            method: 'GET', credentials: 'same-origin', headers: { accept: artifact.mediaType || 'application/octet-stream' },
          });
          if (!response.ok) {
            let payload = null;
            try { payload = await response.json(); } catch {}
            throw new Error(payload?.message || `下载失败（HTTP ${response.status}）`);
          }
          const blob = await response.blob();
          const href = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.download = artifact.fileName || `export.${artifact.format || 'bin'}`;
          anchor.click();
          URL.revokeObjectURL(href);
        } catch (downloadError) {
          actions.setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
        } finally {
          actions.setBusy(false);
        }
      };

      const createAndDownload = async (kind, format) => {
        if (busy) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const latest = await createArtifactBundle();
          const artifact = (latest.artifacts || []).find((item) => item.kind === kind && item.format === format);
          if (!artifact) throw new Error('Host 未生成所选格式的制品。');
          actions.setBusy(false);
          await downloadArtifact(artifact);
        } catch (downloadError) {
          actions.setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
          actions.setBusy(false);
        }
      };

      const displayStatValue = (value) => {
        if (typeof value === 'string' || typeof value === 'number') return value;
        if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
        return '—';
      };
      // 浏览器运行时只保留当前会话的原始明细；进程重启后，已完成任务应从
      // Host 持久化摘要恢复计数，不能因 qccRun 仅存在于内存而显示“—”。
      const qccEnrichedCount = qccRun
        ? qccRun.summary?.enriched ?? 0
        : cachedTask?.enrichmentSummary?.completed;
      const qccReviewCount = qccRun
        ? (qccRun.summary?.ambiguous ?? 0) + (qccRun.summary?.fieldReview ?? 0)
        : cachedTask?.enrichmentSummary?.reviewRequired
          ?? cachedTask?.matchSummary?.reviewRequired;
      const qccFailedCount = qccRun?.summary?.failed ?? cachedTask?.enrichmentSummary?.failed ?? cachedTask?.matchSummary?.failed ?? 0;
      const stat = (label, value, tone) => h('div', { className: 'dcAgentCard' },
        h('span', null, label),
        h('b', { className: tone ? `is-${tone}` : null }, displayStatValue(value))
      );
      const uiFieldGroups = Array.isArray(workflowContract?.fieldCatalog)
        ? workflowContract.fieldCatalog.map((group) => [group.id, group.label, (group.fields || []).map((field) => [field.id, field.label]), group.sourceTool])
        : FIELD_GROUPS;
      const inputOnlyMappingFields = Array.isArray(workflowContract?.inputOnlyMappingFields)
        ? workflowContract.inputOnlyMappingFields.map((field) => [field.id, field.label])
        : INPUT_ONLY_MAPPING_OPTIONS;
      const targetFields = [...uiFieldGroups.flatMap(([, , fields]) => fields), ...inputOnlyMappingFields];
      const mappingHints = mappingRecommendations(dataset?.headers || [], targetFields);
      const setWorkbenchFieldGroup = (fields, enabledGroup) => {
        const selected = new Set(fieldSelection);
        for (const [id] of fields) {
          if (enabledGroup || mappedOutputFields(mappings).includes(id)) selected.add(id); else selected.delete(id);
        }
        const catalogOrder = uiFieldGroups.flatMap(([, , groupFields]) => groupFields.map(([id]) => id));
        actions.setFieldSelection(catalogOrder.filter((id) => selected.has(id)));
      };

      let pane;
      if (step === 'history') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '查看当前 Host 的数据清洗补全任务。Host 只保存任务元数据和摘要，不保存原始企业名单。'),
          h('div', { className: 'dcAgentRow' },
            h('button', {
              type: 'button',
              className: 'dcAgentButton',
              disabled: busy,
              'aria-label': '刷新任务历史',
              onClick: () => loadWorkflowTasks(actions),
            }, '刷新任务'),
            h('button', {
              type: 'button',
              className: 'dcAgentButton is-primary',
              onClick: startNewWorkflow,
            }, '新建清洗任务'),
          ),
          workflowTasks.length ? h('div', { className: 'dcAgentPane', 'aria-label': '任务历史列表' },
            workflowTasks.map((task) => h('button', { key: task.id, type: 'button', className: 'dcAgentHistoryTask', onClick: () => resumeWorkflowTask(task) },
              h('h3', null, workflowDisplayName(task)),
              h('div', { className: 'dcAgentRow' },
                h('span', { className: 'dcAgentJobsPill', 'data-state': task.state ?? 'idle' }, WORKFLOW_STATE_LABELS[task.state] ?? task.state ?? '未知'),
                h('span', { className: 'dcAgentHint' }, `${task.source?.rowCount ?? 0} 行 · ${task.updatedAt ? new Date(task.updatedAt).toLocaleString() : ''}`),
              ),
            )),
          ) : h('section', { className: 'dcAgentSection' },
            h('h3', null, '暂无后台任务'),
            h('p', { className: 'dcAgentHint' }, '上传企业名单并开始处理后，任务状态会显示在这里。'),
          ),
        );
      } else if (step === 'rules') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '确认任务名称、字段映射、匹配规则和输出字段。保存草稿不会调用企查查；确认规则后才可进入质量体检。'),
          h('label', { className: 'dcAgentFormField' },
            h('span', null, '任务名称'),
            h('input', { className: 'dcAgentField', value: taskTitle, maxLength: 120, onChange: (event) => actions.setTaskTitle(event.target.value) }),
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '字段映射'),
            h('p', { className: 'dcAgentHint' }, '至少映射企业名称、统一社会信用代码或注册号其中一项。未映射列会原样保留，但不参与匹配。'),
            h('p', { className: 'dcAgentHint' }, `已映射 ${mappings.length} / ${dataset?.headers?.length || 0} 列。绿色＝通过；黄色＝待确认；红色＝未匹配。确认映射自动选入补全范围，不调用模型或企查查。多个原列可确认使用同一补全字段，主体匹配标识只选一列。`),
            h('button', { type: 'button', className: 'dcAgentButton', onClick: () => actions.setMappings(mergeRecommendedMappings(dataset?.headers || [], mappings, targetFields)) }, '补充自动映射（保留已有选择）'),
            mappingHints.map((recommendation, index) => h(MappingPicker, {
              key: `${index}:${recommendation.sourceField}`, sourceField: recommendation.sourceField,
              mappings, groups: [...uiFieldGroups, ['input-only', '输入校验字段', inputOnlyMappingFields]],
              recommendation, onChange: actions.setMapping,
            })),
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '任务目标'),
            h('div', { className: 'dcAgentChips' }, CLEANING_OPTIONS.map(([key, label]) => h('label', { key, className: `dcAgentChip${objectives.includes(key) ? ' is-selected' : ''}` },
              h('input', { type: 'checkbox', checked: objectives.includes(key), onChange: () => actions.toggleObjective(key) }), ` ${label}`,
            ))),
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '匹配规则'),
            h('div', { className: 'dcAgentRulesGrid' },
              [['normalizeNames', '匹配前规范企业名称'], ['preferCreditNo', '信用代码优先精确匹配'], ['deduplicate', '重复主体合并处理'], ['manualReviewAmbiguous', '多候选必须人工确认']].map(([key, label]) => h('label', { key, className: 'dcAgentCheck' },
                h('input', { type: 'checkbox', checked: matchRules[key], onChange: (event) => actions.setMatchRule(key, event.target.checked) }), label,
              )),
            ),
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, `补全范围 · 已选 ${fieldSelection.length}（映射自动带入 ${mappedOutputFields(mappings).length}）`),
            h('p', { className: 'dcAgentHint' }, '已映射字段无需重复勾选；如需取消，请调整上方映射。以下可选目录用于追加字段。'),
            h('p', { className: 'dcAgentHint' }, '补全结果优先填入已映射原列的空白单元格，保留非空原值；没有对应映射列的已选字段新增列。重复或多义列请先确认映射。'),
            h('details', { className: 'dcAgentExtraFields' },
            h('summary', null, `可选：追加补全字段（共 ${targetFields.filter(([id]) => id !== 'phone').length} 项）`),
            h('div', { className: 'dcAgentRow', 'aria-label': '补全字段批次概览' },
              h('span', { className: 'dcAgentChip' }, '基础字段 30'),
              h('span', { className: 'dcAgentChip' }, '第一批 40'),
              h('span', { className: 'dcAgentChip' }, '第二批 58'),
            ),
            h('label', { className: 'dcAgentPromptField' }, h('span', null, '查找补全字段'),
              h('input', { type: 'search', className: 'dcAgentField', value: fieldQuery, 'aria-label': '查找补全字段',
                placeholder: '搜索维度、字段或工具名称', onChange: (event) => setFieldQuery(event.target.value) })),
            !uiFieldGroups.some((group) => visibleCatalogFields(group, fieldQuery).length) ? h('p', { className: 'dcAgentHint', role: 'status' }, '没有匹配的字段；已选字段保持不变。') : null,
            uiFieldGroups.filter((group) => visibleCatalogFields(group, fieldQuery).length).map(([groupId, label, fields, sourceTool]) => h('div', { key: groupId, className: 'dcAgentFieldGroup' },
              h('div', { className: 'dcAgentFieldGroupHead' },
                h('div', null,
                  h('b', null, `${label} · ${fields.filter(([id]) => fieldSelection.includes(id)).length}/${fields.length}`),
                  sourceTool ? h('small', { className: 'dcAgentHint' }, `来源：${sourceTool}`) : null,
                ),
                h('div', { className: 'dcAgentFieldGroupActions' },
                  h('button', { type: 'button', className: 'dcAgentFieldAction', title: '选中本维度全部字段，不受搜索过滤影响', onClick: () => setWorkbenchFieldGroup(fields, true) }, '全选'),
                  h('button', { type: 'button', className: 'dcAgentFieldAction', title: '清空本维度全部字段，不受搜索过滤影响', onClick: () => setWorkbenchFieldGroup(fields, false) }, '清空'),
                ),
              ),
              h('div', { className: 'dcAgentChips' }, visibleCatalogFields([groupId, label, fields, sourceTool], fieldQuery).map(([key, fieldLabel]) => h('label', { key, className: `dcAgentChip${fieldSelection.includes(key) ? ' is-selected' : ''}` },
                h('input', { type: 'checkbox', checked: fieldSelection.includes(key), disabled: mappedOutputFields(mappings).includes(key), onChange: () => actions.toggleField(key) }), ` ${fieldLabel}`,
              ))),
            )),
            ),
          ),
          h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton', disabled: busy, onClick: saveTaskSettings }, '保存草稿'),
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !hasData, 'aria-label': '确认规则并运行质量体检', onClick: confirmRuleSettings }, busy ? '保存中…' : '确认规则并运行质量体检'),
          ),
        );
      } else if (step === 'profile') {
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
              h('button', {
                type: 'button',
                className: 'dcAgentButton is-primary',
                disabled: busy,
                onClick: () => actions.setStep(requiresQcc ? 'match' : 'enrich'),
              }, requiresQcc ? '下一步：匹配核验' : '下一步：本地清洗补全'),
            ),
          ) : h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !hasData, 'aria-label': '生成体检报告', onClick: runProfile }, busy ? '体检中…' : '生成体检报告'),
          ),
        );
      } else if (step === 'match') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '通过当前用户连接的企查查 MCP 定位企业主体，并按已选维度补全一企一行字段。多候选始终由人工选择；界面不生成虚构置信度。'),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '匹配依据'),
            h('div', { className: 'dcAgentChips' }, mappings.filter((mapping) => ['company_name', 'credit_no', 'reg_no'].includes(mapping.targetField)).map((mapping) => h('span', { key: mapping.sourceField, className: 'dcAgentChip' }, `${mapping.sourceField} → ${resultFieldLabel(mapping.targetField)}`))),
            h('p', { className: 'dcAgentHint' }, '统一社会信用代码等强标识优先；名称匹配不明确时进入人工核验队列。'),
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '准备任务说明'),
            h('p', { className: 'dcAgentHint' }, `已导入 ${dataset?.rowCount ?? runtime.rows.length} 条记录，已选择 ${fieldSelection.length} 个补全字段。Host 自动检查所需工具并计算去重主体与调用上界。`),
            h('p', { className: 'dcAgentHint' }, '回填后可修改；点击发送才开始查询，使用你已连接的企查查 MCP 账号及额度。'),
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !hasData || !cachedTask?.id, onClick: runQcc }, busy ? '检查并生成中…' : '生成可编辑任务说明'),
            ),
          ),
          qccRun ? h('section', { className: 'dcAgentSection' },
            h('h3', null, `任务 ${qccRun.runId} · ${qccRun.state}`),
            ((qccRun.reviewQueue || []).length || (qccRun.errors || []).some((item) => item.error?.retryable)) ? h('label', { className: 'dcAgentCheck' },
              h('input', { type: 'checkbox', checked: paidConfirmed, 'aria-label': '确认候选或重试的企查查调用', onChange: (event) => actions.setPaidConfirmed(event.target.checked) }),
              '确认主体或重试会继续查询，使用当前连接的企查查账号；额度或费用由该账号自行承担。',
            ) : null,
            h('div', { className: 'dcAgentGrid' },
              stat('已补全', qccRun.summary?.enriched ?? 0, 'good'),
              stat('待核验', (qccRun.summary?.ambiguous ?? 0) + (qccRun.summary?.fieldReview ?? 0), (qccRun.summary?.ambiguous || qccRun.summary?.fieldReview) > 0 ? 'warn' : null),
              stat('未匹配', qccRun.summary?.unresolved ?? 0, (qccRun.summary?.unresolved ?? 0) > 0 ? 'warn' : null),
              stat('失败', qccRun.summary?.failed ?? 0, (qccRun.summary?.failed ?? 0) > 0 ? 'bad' : null),
            ),
            Array.isArray(qccRun.rows) && qccRun.rows.length ? h(DatasetReview, {
              key: qccRun.runId, ...projectCompletionResult({ rows: qccRun.rows, headers: runtime.headers, mappings: cachedTask?.mappings || mappings, fieldSelection: cachedTask?.fieldSelection || fieldSelection }),
              title: '企查查匹配补全结果', expectedCount: qccRun.summary?.totalRows,
              onError: actions.setError,
            }) : null,
            (qccRun.reviewQueue || []).map((item) => h('div', { key: item.companyName, className: 'dcAgentSection' },
              h('h3', null, `待核验：${item.companyName}`),
              item.candidates.map((candidate) => h('div', { key: candidate.creditNo, className: 'dcAgentCandidate' },
                h('div', null, h('b', null, candidate.companyName || '未命名候选'), h('small', null, candidate.creditNo)),
                h('small', null, `${candidate.status || '状态未知'} · ${(candidate.legalRep || []).join('、') || '法人未知'}`),
                h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !paidConfirmed, onClick: () => resolveCandidate(item, candidate) }, '确认此主体'),
              )),
            )),
            (qccRun.errors || []).some((item) => item.error?.retryable) ? h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !paidConfirmed, onClick: retryFailures }, '重试可恢复失败项') : null,
          ) : null,
        );
      } else if (step === 'enrich') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '执行本地确定性清洗并核对本任务所选补全字段。外部字段以当前用户企查查 MCP 的真实返回为准，缺失值不会被编造。'),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, `已选补全字段 · ${fieldSelection.length}`),
            h('div', { className: 'dcAgentChips' }, fieldSelection.map((id) => h('span', { className: 'dcAgentChip', key: id }, resultFieldLabel(id)))),
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '本地清洗预处理'),
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !hasData, 'aria-label': '执行清洗', onClick: runClean }, busy ? '处理中…' : '执行确定性清洗'),
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !hasData, 'aria-label': '执行补全', onClick: runComplete }, busy ? '处理中…' : '本地规则补全'),
            ),
            clean ? h('div', { className: 'dcAgentGrid' },
              stat('总数', clean.total), stat('保留', clean.kept, 'good'), stat('剔除', clean.dropped, 'bad'),
              stat('缺失关键字段', clean.badMissing, clean.badMissing > 0 ? 'bad' : null),
              stat('重复', clean.badDuplicate, clean.badDuplicate > 0 ? 'warn' : null),
            ) : null,
          ),
          h('div', { className: 'dcAgentGrid' },
            stat('输入行数', dataset ? dataset.rowCount : '—'),
            stat('清洗保留', clean ? clean.kept : '—', clean && clean.kept > 0 ? 'good' : null),
            stat('本地补全', complete ? complete.completed : '—', complete && complete.completed > 0 ? 'good' : null),
            stat('QCC 已补全', qccEnrichedCount, qccEnrichedCount > 0 ? 'good' : null),
            stat('待核验', qccReviewCount, qccReviewCount > 0 ? 'warn' : null),
          ),
          h('div', { className: 'dcAgentRow' }, h('button', { type: 'button', className: 'dcAgentButton is-primary', onClick: () => actions.setStep('download') }, '进入下载数据')),
        );
      } else if (step === 'download') {
        const availableArtifacts = (cachedTask?.artifacts || []).filter(artifact => artifact.kind !== 'review' || artifact.rowCount > 0);
        const canCreateArtifacts = Boolean(exportRows()?.length) && ['rules_confirmed', 'diagnosed', 'export_ready', 'partial'].includes(cachedTask?.state);
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '结果文件由 Host 保存；有失败、未匹配或待核验记录时展示异常清单。任务或插件重启后，可从任务历史继续下载；无需再次调用企查查。'),
          h('div', { className: 'dcAgentGrid' },
            stat('输入行数', dataset ? dataset.rowCount : workflowTask?.source?.rowCount ?? '—'),
            stat('匹配补全', qccEnrichedCount, qccEnrichedCount > 0 ? 'good' : null),
            stat('待核验', qccReviewCount, qccReviewCount > 0 ? 'warn' : null),
            stat('任务状态', WORKFLOW_STATE_LABELS[cachedTask?.state] || cachedTask?.state || '进行中'),
            stat('失败', qccFailedCount, qccFailedCount > 0 ? 'bad' : null),
          ),
          availableArtifacts.length ? h('div', { className: 'dcAgentArtifactList' },
            availableArtifacts.filter(artifact => artifact.format === 'xlsx').map(artifact => h('a', {
              key: 'preview-' + artifact.id, className: 'dcAgentButton',
              href: `/data-cleaning/api/workflow/tasks/${encodeURIComponent(cachedTask.id)}/artifacts/${encodeURIComponent(artifact.id)}?preview=1`,
              target: '_blank', rel: 'noopener noreferrer',
            }, `预览 / 打开：${artifact.fileName}`)),
            availableArtifacts.map((artifact) => h('button', {
              key: artifact.id,
              type: 'button',
              className: `dcAgentButton${artifact.kind === 'complete' && artifact.format === 'xlsx' ? ' is-primary' : ''}`,
              disabled: busy,
              onClick: () => downloadArtifact(artifact),
              'aria-label': `下载 ${artifact.fileName}`,
            }, `${artifact.kind === 'review' ? '异常清单' : '清洗补全结果'} ${String(artifact.format).toUpperCase()} · ${artifact.rowCount} 行`)),
          ) : h('div', null,
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !canCreateArtifacts, onClick: () => createAndDownload('complete', 'xlsx') }, '生成并下载结果 XLSX'),
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !canCreateArtifacts, onClick: () => createAndDownload('complete', 'csv') }, '生成并下载结果 CSV'),
              qccReviewCount > 0 ? h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !canCreateArtifacts, onClick: () => createAndDownload('review', 'xlsx') }, '生成并下载异常清单 XLSX') : null,
              qccReviewCount > 0 ? h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !canCreateArtifacts, onClick: () => createAndDownload('review', 'csv') }, '生成并下载异常清单 CSV') : null,
            ),
            !canCreateArtifacts ? h('p', { className: 'dcAgentHint' }, '请先完成规则确认与清洗补全；历史任务若尚未生成制品，需要重新上传源文件。') : null,
          ),
        );
      } else {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '上传 CSV / XLSX / XLS / JSON，或粘贴数据。也可选择图片，通过企查查智能文档解析提取名单后继续清洗补全。'),
          dataset ? h('section', { className: 'dcAgentSection', 'aria-label': '当前导入数据', role: 'status' },
            h('h3', null, intake.available ? `已解析 ${intake.count} 条数据` : '已保存导入摘要'),
            h('p', { className: 'dcAgentHint', style: { overflowWrap: 'anywhere' } }, `当前来源：${intake.fileName}`),
            h('p', { className: 'dcAgentHint' }, intake.available
              ? '文件选择后已自动解析，无需再次点击解析。核对下方名单后可直接进入规则与体检；重新选择文件会替换当前导入数据。'
              : '当前页面没有完整原始数据。请重新导入原文件；历史下载制品仍可从任务历史获取。'),
          ) : null,
          h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton', disabled: busy,
              onClick: (event) => event.currentTarget.nextElementSibling?.click() },
            dataset ? '重新选择文件（自动解析）' : '选择文件（自动解析）'),
            h('input', {
            type: 'file',
            accept: '.csv,.json,.xlsx,.xls,image/png,image/jpeg,image/webp',
            className: 'dcAgentField',
            style: { display: 'none' },
            disabled: busy,
            'aria-label': '选择数据文件',
            onChange: handleFile,
          })),
          h('button', { type: 'button', className: 'dcAgentButton', disabled: busy,
            onClick: () => openImageIntake() }, '图片识别（粘贴 / 选择）'),
          h('textarea', {
            className: 'dcAgentTextarea',
            placeholder: '粘贴 CSV 文本，或 JSON 数组（例如 [{"name":"某公司","amount":"100"}]）…',
            'aria-label': '粘贴数据',
            value: input,
            disabled: busy,
            onPaste: (event) => {
              const files = imageFilesFromTransfer(event.clipboardData);
              if (files.length && openImageIntake(files[0])) {
                event.preventDefault();
                event.stopPropagation?.();
              }
            },
            onInput: (event) => { actions.setInput(event.target.value); actions.setError(null); },
          }),
          dataset ? h('div', { className: 'dcAgentChips' },
            h('span', { className: 'dcAgentChip' }, `格式 ${dataset.fmt}`),
            h('span', { className: 'dcAgentChip' }, `${dataset.rowCount} 行`),
            (dataset.headers || []).slice(0, 12).map((name) => h('span', { key: name, className: 'dcAgentChip' }, name)),
            (dataset.headers || []).length > 12 ? h('span', { className: 'dcAgentChip' }, `+${dataset.headers.length - 12} 列`) : null,
          ) : null,
          dataset ? h(DatasetReview, {
            key: runtimeKey, rows: sourceRows, headers: dataset.headers || [],
            expectedCount: dataset.rowCount,
            title: runtime.source?.type === 'image' ? '图片识别原始名单（尚未匹配）' : '导入原始清单',
            onError: actions.setError,
          }) : null,
          hasData ? h('p', { className: 'dcAgentHint' }, '请核对完整名单。识别清单不代表已完成企查查匹配。核对后进入「规则与体检」，确认规则生成质量体检；再进入「主体匹配」直接生成可编辑任务说明。Host 自动检查工具和调用范围，回填中央对话框后点击发送才开始查询。') : null,
          h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !intake.pendingText, 'aria-label': '解析数据', onClick: handleParse }, busy ? '解析中…' : '解析粘贴内容'),
            intake.pendingText && hasData ? h('p', { className: 'dcAgentHint', role: 'status' }, '有尚未解析的新粘贴内容，请先解析或清空后再继续。') : null,
            hasData ? h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !intake.available || intake.pendingText, onClick: () => { actions.setError(null); actions.setStep('rules'); } }, '已核对清单，下一步：字段映射与规则') : null,
          ),
        );
      }

      return h('section', {
        className: 'dcAgentWorkbenchContent',
        'data-dsh-plugin': 'data-cleaning-agent',
        'aria-label': '数据清洗补全工作台',
        'data-session-id': activeSessionId ?? undefined,
      },
          h('nav', { className: 'dcAgentManagement', 'aria-label': '工作台管理' },
            h('button', { type: 'button', className: 'dcAgentButton', 'aria-pressed': step !== 'history',
              onClick: () => actions.setStep(cachedTask?.stage || 'upload') }, '当前任务'),
            h('button', { type: 'button', className: 'dcAgentButton', 'aria-pressed': step === 'history',
              onClick: () => actions.setStep('history') }, '任务历史'),
          ),
          step !== 'history' ? h('nav', { className: 'dcAgentStepper', 'aria-label': '清洗流程',
            style: { '--dc-stage-count': STEPS.length } },
            STEPS.map((st) => h('button', {
              key: st.key,
              type: 'button',
              className: `dcAgentStep${(step === 'profile' ? 'rules' : step) === st.key ? ' is-active' : ''}`,
              'aria-label': st.label,
              title: st.label,
              'aria-current': (step === 'profile' ? 'rules' : step) === st.key ? 'step' : undefined,
              onClick: () => actions.setStep(st.key),
            }, h('span', { className: 'dcAgentStepIcon' }, h(StageIcon, { kind: st.icon })),
            h('span', { className: 'dcAgentStepLabel' }, st.label))),
          ) : null,
          h('div', { className: 'dcAgentWbBody' },
            cachedTask && step !== 'history' ? h('section', { className: 'dcAgentSection', 'aria-label': '当前任务进展', 'aria-live': 'polite' },
              h('b', null, WORKFLOW_STATE_LABELS[cachedTask.state] || cachedTask.state),
              h('h3', null, workflowDisplayName(cachedTask)),
              h('details', null, h('summary', null, '任务详情'), h('p', { className: 'dcAgentHint' }, `任务编号：${cachedTask.id}`)),
              h('p', null, `${cachedTask.source?.type === 'image' ? '图片识别' : cachedTask.source?.type === 'text' ? '粘贴名单' : '上传表格'} · ${cachedTask.source?.fileName || ''} · ${cachedTask.source?.rowCount || 0} 条 · ${cachedTask.fieldSelection?.length || 0} 个补全字段`),
              commandProgress?.taskId === cachedTask.id && Number.isFinite(commandProgress.totalUnique) ? h('p', null, `已处理主体 ${commandProgress.completedUnique}/${commandProgress.totalUnique}（去重后，含未匹配或失败，不代表补全成功）`) : null,
              commandProgress?.taskId === cachedTask.id && Number.isFinite(commandProgress.totalUnique) && commandProgress.totalUnique > 0 ? h('progress', {
                max: commandProgress.totalUnique, value: Math.min(commandProgress.totalUnique, Math.max(0, commandProgress.completedUnique || 0)),
                'aria-label': '主体处理进度', style: { width: '100%', accentColor: cachedTask.state === 'completed' ? '#16845b' : cachedTask.state === 'failed' ? '#c62828' : cachedTask.state === 'partial' ? '#a66a00' : '#087dcc' },
              }) : null,
              h('p', { style: { color: qccFailedCount > 0 ? '#c62828' : Number(qccReviewCount) > 0 ? '#a66a00' : qccEnrichedCount > 0 ? '#16845b' : 'inherit' } },
                Number.isFinite(qccEnrichedCount) ? `已处理并补全 ${qccEnrichedCount} 条 · 待核验 ${Number.isFinite(qccReviewCount) ? qccReviewCount : '统计中'} 条 · 失败 ${qccFailedCount} 条（按输入行统计；未披露字段保留空白）` : '结果统计中，处理结束后展示补全与待核验数量'),
            ) : null,
            error ? h('div', { className: 'dcAgentError', role: 'alert' }, error) : null,
            step !== 'history' ? h('details', { className: 'dcAgentSection' },
              h('summary', null, '使用说明与任务流程'),
              h('p', { className: 'dcAgentHint' }, '导入与核验 → 规则与体检 → 主体匹配 → 字段补全 → 结果下载。菜单只切换视图，不启动调用；按页面主按钮逐步确认。'),
              h('p', { className: 'dcAgentHint' }, '支持文本、Excel、JSON 和图片名单。原值保留、多候选人工核验；企查查调用使用当前用户自己的连接与额度。'),
            ) : null,
            ['rules', 'profile'].includes(step) ? h('nav', { className: 'dcAgentRow', 'aria-label': '规则与体检视图' },
              h('button', { type: 'button', className: 'dcAgentButton', 'aria-pressed': step === 'rules', onClick: () => actions.setStep('rules') }, '字段映射与规则'),
              h('button', { type: 'button', className: 'dcAgentButton', 'aria-pressed': step === 'profile', onClick: () => actions.setStep('profile') }, '质量体检报告'),
            ) : null,
            workflowNavigationIssue(step, cachedTask, hasData, profile, qccRun, Boolean((clean || complete) && exportRows()?.length))
              ? h('section', { className: 'dcAgentSection', role: 'status' },
                  h('p', null, workflowNavigationIssue(step, cachedTask, hasData, profile, qccRun, Boolean((clean || complete) && exportRows()?.length))),
                  h('button', { type: 'button', className: 'dcAgentButton',
                    onClick: () => actions.setStep(!hasData ? 'upload' : !cachedTask || ['draft', 'uploaded'].includes(cachedTask.state) ? 'rules' : cachedTask.state === 'rules_confirmed' ? 'profile' : step === 'download' ? 'enrich' : 'match') }, '前往前置步骤'))
              : pane,
          ),
      );
    }

    // BEGIN generated Better Sidebar adapter (source: lib/better-sidebar-adapter.js)
    /** Public Better Sidebar seam. No business task creation, cancellation or geometry. */
    const CLEANING_TAB_ID = 'dsh-data-cleaning-agent:workbench';
    const SIDEBAR_DEPENDENCY_MESSAGE = '交互工作台暂不可用；基础清洗、规则补全、画像工具和原生会话仍可使用。启用工作台请安装或升级兼容的 dsh-better-sidebar 并重启 DSH（需要 targetedOpen 和 stateSubscription 能力），然后重新点击流程按钮。现有任务和文件不会删除。';

    function sidebarCompatibility(service) {
      const methods = ['registerTab', 'openTab', 'isTabEnabled', 'getSnapshot', 'subscribeState'];
      return Boolean(service && methods.every(key => typeof service[key] === 'function')
        && ['targetedOpen', 'stateSubscription'].every(key => service.features?.includes(key)));
    }

    function contains(node, id) {
      if (!node) return false;
      return node.kind === 'leaf' ? node.tabs.some(tab => tab.id === id)
        : node.children.some(child => contains(child, id));
    }

    function revealCleaningTab(state, id) {
      if (state.floats?.some(item => item.tab.id === id)) return state;
      if (contains(state.bottomSplits, id)) return state.bottomOpen ? state : { ...state, bottomOpen: true };
      if (contains(state.splits, id)) return state.panelOpen ? state : { ...state, panelOpen: true };
      return state;
    }

    /** One adapter per plugin activation. Session navigation survives closing its Tab. */
    function createCleaningSidebarAdapter(service, { component, icon, onUnavailable = () => {} }) {
      const targets = new Map();
      const destinations = new Map();
      const pending = new Set();
      let disposed = false;
      const compatible = sidebarCompatibility(service);
      const applyPending = sessionId => {
        if (disposed || service.getSnapshot().sessionId !== sessionId || !pending.has(sessionId)) return;
        const target = targets.get(sessionId);
        if (!target) return;
        pending.delete(sessionId);
        target.navigate(destinations.get(sessionId));
        target.store.reduce(state => revealCleaningTab(state, target.tabId));
      };
      const unregister = compatible ? service.registerTab({
        id: CLEANING_TAB_ID, title: '数据清洗补全', icon, order: 30, single: true, component,
      }) : () => {};
      const unsubscribe = compatible ? service.subscribeState(() => {
        const sessionId = service.getSnapshot().sessionId;
        if (sessionId) applyPending(sessionId);
      }) : () => {};
      return {
        compatible,
        open(scope, destination = 'upload') {
          if (disposed) return false;
          if (!compatible || !service.isTabEnabled(CLEANING_TAB_ID)) {
            onUnavailable(compatible ? '请在 Better Sidebar 设置中启用「数据清洗补全」Tab。' : SIDEBAR_DEPENDENCY_MESSAGE);
            return false;
          }
          if (!scope?.sessionId) throw new Error('A target Session is required');
          destinations.set(scope.sessionId, destination);
          pending.add(scope.sessionId);
          service.openTab({ type: CLEANING_TAB_ID }, scope);
          applyPending(scope.sessionId);
          return true;
        },
        attach(scope, target) {
          if (disposed) return () => {};
          targets.set(scope.sessionId, target);
          // Without a pending shortcut, preserve the Session business store's current view.
          // Closing/reopening a Tab must not rewind an in-progress task to an older shortcut.
          applyPending(scope.sessionId);
          return () => { if (targets.get(scope.sessionId) === target) targets.delete(scope.sessionId); };
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          unsubscribe(); unregister();
          targets.clear(); pending.clear(); destinations.clear();
        },
      };
    }

    // END generated Better Sidebar adapter

    // A shared owner across materialized root/Session factories, never a shared UI store.
    const CONTROLLER_KEY = Symbol.for('dsh.data-cleaning.session-workbench');
    const DEPENDENCY_EVENT = 'dsh:data-cleaning-sidebar-dependency';
    function installSessionWorkbench(ctx) {
      const host = typeof document === 'undefined' ? window : document;
      if (host[CONTROLLER_KEY]) {
        const shared = host[CONTROLLER_KEY];
        shared.references += 1;
        sessionWorkbenchController = shared.controller;
        let released = false;
        return () => { if (!released) { released = true; shared.release(); } };
      }
      let disposed = false;
      const instances = new Map();
      const spec = createWorkbenchStore();
      const instanceFor = sessionId => {
        if (!sessionId) throw new Error('请先打开数据清洗会话。');
        if (!instances.has(sessionId)) {
          const instance = spec.create(sessionId);
          instance.actions.setActiveSession(sessionId);
          instances.set(sessionId, instance);
        }
        return instances.get(sessionId);
      };
      let openingSession = null;
      const notify = message => {
        if (openingSession) instanceFor(openingSession).actions.setError(message);
        if (typeof document?.dispatchEvent === 'function') {
          const event = document.createEvent('CustomEvent');
          event.initCustomEvent(DEPENDENCY_EVENT, false, false, { sessionId: openingSession, message });
          document.dispatchEvent(event);
        }
      };
      let adapter;
      function SessionWorkbenchTab(props) {
        const instance = instanceFor(props.scope.sessionId);
        const useStore = pick => react.useSyncExternalStore(instance.subscribe,
          () => pick(instance.getSnapshot()), () => pick(instance.getSnapshot()));
        react.useEffect(() => {
          instance.actions.openAt(null, props.scope.sessionId);
          return adapter.attach(props.scope, { tabId: props.tab.id, store: props.store,
            navigate: destination => instance.actions.setStep(destination || instance.getSnapshot().step) });
        }, [instance, props.scope.sessionId, props.tab.id, props.store]);
        return h(WorkbenchContent, { useStore, actions: instance.actions, visible: props.visible,
          sendSessionCommand: (sessionId, prompt) => sendQccAgentCommand(ctx, sessionId, prompt),
          setSessionDraft: (sessionId, prompt) => setQccAgentDraft(ctx, sessionId, prompt) });
      }
      const adapterOptions = { component: SessionWorkbenchTab, icon: size => h(DatabaseLogo, { size }), onUnavailable: notify };
      adapter = createCleaningSidebarAdapter(null, adapterOptions);
      const connectProvider = service => {
        if (disposed) return () => {};
        const next = createCleaningSidebarAdapter(service, adapterOptions);
        adapter.dispose();
        adapter = next;
        return () => {
          next.dispose();
          if (!disposed && adapter === next) adapter = createCleaningSidebarAdapter(null, adapterOptions);
        };
      };
      // Optional child injection grants Cordis service access and follows provider removal.
      // Core conversation / Host tools remain loaded when Better Sidebar is absent.
      const providerFiber = typeof ctx.inject === 'function'
        ? ctx.inject(['betterSidebar'], providerContext => {
            providerContext.effect(() => connectProvider(providerContext.betterSidebar), 'data-cleaning-agent: sidebar provider');
          })
        : null;
      const disconnectFixture = typeof ctx.inject !== 'function' ? connectProvider(ctx.betterSidebar) : () => {};
      const controller = {
        storeFor: instanceFor,
        actionsFor: sessionId => instanceFor(sessionId).actions,
        open(sessionId, step) {
          if (disposed || !sessionId) return false;
          const instance = instanceFor(sessionId);
          instance.actions.openAt(step, sessionId);
          const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions;
          const summary = sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
          openingSession = sessionId;
          try { return adapter.open({ sessionId, ...(summary?.cwd ? { cwd: summary.cwd } : {}) },
            step || instance.getSnapshot().step); }
          finally { openingSession = null; }
        },
      };
      sessionWorkbenchController = controller;
      const listeners = {
        [WORKBENCH_OPEN_EVENT]: event => {
          const detail = event.detail || {};
          const actions = controller.actionsFor(detail.sessionId);
          if (detail.task?.id) cacheWorkflowTask(actions, detail.sessionId, detail.task);
          controller.open(detail.sessionId, detail.step);
        },
        [WORKBENCH_DATASET_EVENT]: event => {
          const { sessionId, result, source } = event.detail;
          const actions = controller.actionsFor(sessionId);
          if (!result) return;
          applyParsed(result, actions, `session:${sessionId}`, source);
          void queueWorkflowOperation(sessionId, () => persistParsedWorkflow(actions, sessionId, result, source))
            .catch(error => { if (!disposed) actions.setError(error.message || String(error)); });
        },
        [WORKBENCH_DRAFT_EVENT]: event => {
          const { sessionId, draft = {} } = event.detail;
          const actions = controller.actionsFor(sessionId);
          if (draft.title) actions.setTaskTitle(draft.title);
          if (draft.objectives) actions.setObjectives(draft.objectives);
          if (draft.mappings) actions.setMappings(draft.mappings);
          if (draft.fieldSelection) actions.setFieldSelection(draft.fieldSelection);
          for (const [key, value] of Object.entries(draft.matchRules || {})) actions.setMatchRule(key, value);
          void queueWorkflowOperation(sessionId, async () => {
            const task = await ensureEditableWorkflowTask(actions, sessionId, draft);
            return updateWorkflowTask(actions, sessionId, task, draft);
          }).catch(error => { if (!disposed) actions.setError(error.message || String(error)); });
        },
        [WORKBENCH_PREPARE_EVENT]: event => {
          const { sessionId, config, resolve, reject } = event.detail;
          const actions = controller.actionsFor(sessionId);
          queueWorkflowOperation(sessionId, () => stageConfirmedWorkflow(actions, sessionId, config))
            .then(command => { if (!disposed) watchHostedCommand(actions, sessionId, command); resolve(command); }, reject);
        },
      };
      const bindings = Object.entries(listeners).map(([name, handler]) => {
        const listener = event => {
          if (disposed || event.defaultPrevented || !event.detail?.sessionId) return;
          event.preventDefault();
          handler(event);
        };
        host.addEventListener?.(name, listener);
        return () => host.removeEventListener?.(name, listener);
      });
      const shared = { controller, references: 1, release() {
        if (--shared.references > 0) return;
        disposed = true;
        commandWatchGeneration += 1;
        for (const remove of bindings) remove();
        adapter.dispose();
        disconnectFixture();
        void providerFiber?.dispose();
        instances.clear();
        if (host[CONTROLLER_KEY] === shared) delete host[CONTROLLER_KEY];
        if (sessionWorkbenchController === controller) sessionWorkbenchController = null;
      } };
      host[CONTROLLER_KEY] = shared;
      let released = false;
      return () => { if (!released) { released = true; shared.release(); } };
    }

    function apply(ctx) {
      // eslint-disable-next-line no-console
      console.log('[dc-agent] client apply() ran');
      const state = {
        applied: true,
        entry: 'sidebar.workspaces:before(portal)',
        lifecycleSlot: 'sidebar.footer.action',
        capabilitySlot: 'conversation.input.dock',
        promptSlot: 'conversation.input.overlay',
        heroTitleBridge: 'exact-text/reversible',
        headerSlot: 'conversation.session.header.actions',
        workbench: 'better-sidebar:session-singleton',
        error: null,
      };
      window.__DC_MVP__ = state;
      try {
        const workbenchStore = createWorkbenchStore();
        ctx.effect(() => installUiStyles(), 'data-cleaning-agent: UI styles');
        ctx.effect(() => installSessionOwnershipBridge(ctx), 'data-cleaning-agent: session ownership');

        ctx.effect(() => installSessionWorkbench(ctx), 'data-cleaning-agent: Session workbench');

        // 左栏：footer 只托管生命周期和 Portal 降级；实际入口显示在工作区列表前。
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'data-cleaning-agent',
          order: 10,
          store: workbenchStore,
          inject: () => ({ startSession: () => startCleaningSession(ctx) }),
        }, SidebarEntry));

        // dock 托管会话生命周期；菜单 Portal 到输入框后，不重排共享槽位。
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'data-cleaning-agent-capabilities',
          order: 110,
        }, DataCleaningExperience));

        // 输入框左上角提示词生成器：文本 / Excel / 图片 → 可编辑任务描述。
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'data-cleaning-agent-prompt-generator',
          order: 110,
          inject: () => ({
            attachImages: (sessionId, files) => attachPromptImages(ctx, sessionId, files),
            removeImage: (sessionId, attachment) => removePromptImage(ctx, sessionId, attachment),
            getInputSnapshot: (sessionId) => {
              const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation;
              return conversation?.input?.shell?.(sessionId)?.snapshot;
            },
          }),
        }, PromptGenerator));

        // 会话头部恢复入口：用户关闭右栏后可随时重新打开当前任务工作台。
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'data-cleaning-agent-workbench',
          order: 110,
        }, WorkbenchHeaderEntry));

        // 模型工具的 tool.call.toolview 富化卡片（keyed by wire name，替代裸 JSON 摘要）。
        // 说明：分三条独立 inject（而非 generator）——测试 shim 对 inject 回调仅执行一次并 push 其返回值。
        const toolviewKeys = ['data_clean_rows', 'data_complete_rows', 'data_profile', 'data_cleaning_extract_image_companies', 'data_cleaning_qcc_run'];
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
    // 测试用纯函数，不构成 Host / DSH 稳定 API。
    exports.__testing = {
      createWorkbenchStore,
      WorkbenchContent,
      installSessionWorkbench,
      DatabaseLogo,
      visibleCatalogFields,
      installCapabilityMount,
      PromptDialog,
      ProductHome,
      workflowNavigationIssue,
      buildTaskPrompt,
      DatasetReview,
      reviewColumns,
      reviewCsv,
      clearCleaningDraft,
      entriesToDataset,
      extractPromptEntries,
      imageFilesFromTransfer,
      isImagePathEntry,
      requestPromptImage,
      guessMappings,
      intakeState,
      projectCompletionResult,
      mappingRecommendations,
      mappedOutputFields,
      syncMappedSelection,
      updateColumnMapping,
      mergeRecommendedMappings,
      MappingPicker,
      deactivateCleaningSession,
      installSessionOwnershipBridge,
      installNewSessionBridge,
      isCleaningSession,
      isKnownCleaningDraft,
      markCleaningSession,
      qualitySummaryFor,
      plainEntityListDataset,
      resultFieldLabel,
      rewriteHeroChrome,
      ensureWorkflowTask,
      ensureEditableWorkflowTask,
      queueWorkflowOperation,
    };
    return module.exports;
  },
});

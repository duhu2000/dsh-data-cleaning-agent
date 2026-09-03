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
 *     `data-slot` 排到输入框下方；右侧非模态工作台使用 `shell.overlay`。
 *   - 提示词生成器使用 `conversation.input.overlay`，只对本插件创建的会话生效。
 *     Hero 标题没有公开替换槽位，故以可恢复、精确文本匹配的 DOM Bridge 对齐业务首页。
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
    const reactDom = require('react-dom');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const {
      Button,
      IconArchiveOutline20,
      IconChecklistOutline14,
      IconCloseOutline16,
      IconDataOutline16,
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

    /** 客户端所需服务：与 mcp-connector 对齐（槽位 + 会话/工作区/输入机）。 */
    const inject = ['slots', 'sessions', 'workspaces', 'conversation'];

    const UI_STYLE_ID = 'dsh-data-cleaning-agent-ui';
    const SIDEBAR_WORKSPACES_SELECTOR = '[data-slot="sidebar.workspaces"]';
    const TOP_MOUNT_SELECTOR = '[data-data-cleaning-top-mount="true"]';
    const stylesCss = `
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

.dcAgentOverlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  pointer-events: none;
  background: transparent;
}

.dcAgentWorkbench {
  display: flex;
  flex-direction: column;
  width: min(510px, calc(100vw - 72px));
  height: 100vh;
  border: 1px solid light-dark(#d5dae4, #2a3038);
  border-radius: 12px 0 0 12px;
  background: light-dark(#ffffff, #161b23);
  color: light-dark(#172033, #edf2fa);
  box-shadow: light-dark(-10px 0 32px rgba(33, 55, 88, .12), -12px 0 40px rgba(0, 0, 0, .32));
  overflow: hidden;
  pointer-events: auto;
}
.dcAgentWorkbench.is-expanded { width: min(980px, calc(100vw - 72px)); }

.dcAgentCapabilities {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 780px);
  box-sizing: border-box;
  margin: 0 auto;
  padding: 2px 16px 0;
  overflow-x: auto;
  scrollbar-width: none;
  transform: translateX(var(--dc-agent-workbench-shift, 0px));
  transition: transform 160ms ease;
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
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 12px;
  background: light-dark(rgba(255,255,255,.86), rgba(22,27,35,.86));
  color: light-dark(#5d687a, #aab5c7);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentCapability:hover,
.dcAgentCapability:focus-visible,
.dcAgentCapability.is-active {
  border-color: light-dark(#c9d9f8, #365681);
  background: light-dark(#edf4ff, #172841);
  color: light-dark(#1556cf, #8cb3ff);
}
.dcAgentCapability svg { flex: 0 0 auto; }

/* DSH 官方 input.dock 默认在 composer 上方；只把本插件自己的 cell 排到下方。 */
[data-slot="conversation.input.dock"]:has(.dcAgentExperience) {
  order: 20;
}

.dcAgentExperience {
  width: 100%;
  box-sizing: border-box;
}

.dcAgentProductHome {
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 780px);
  box-sizing: border-box;
  margin: 10px auto 0;
  padding: 16px 18px;
  border: 1px solid light-dark(#e4e8f0, #303947);
  border-radius: 16px;
  background: light-dark(rgba(255,255,255,.82), rgba(20,25,33,.86));
  box-shadow: light-dark(0 10px 30px rgba(42,75,120,.06), 0 14px 34px rgba(0,0,0,.14));
}
.dcAgentProductHome h2 {
  margin: 0;
  color: light-dark(#172033, #edf2fa);
  font-size: 16px;
  line-height: 24px;
}
.dcAgentProductHome > p {
  margin: 4px 0 12px;
  color: light-dark(#697386, #aab5c7);
  font-size: 12px;
  line-height: 18px;
}
.dcAgentHomeFlow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.dcAgentHomeStep {
  min-width: 0;
  padding: 9px 8px;
  border-radius: 10px;
  background: light-dark(#f4f7fc, #1c2330);
  color: light-dark(#33415a, #c9d4e5);
  font-size: 12px;
  line-height: 18px;
}
.dcAgentHomeStep b {
  display: block;
  margin-bottom: 2px;
  color: light-dark(#1556cf, #8cb3ff);
  font-size: 11px;
}
.dcAgentHomeTrust {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.dcAgentHomeTrust span {
  padding: 3px 8px;
  border: 1px solid light-dark(#dce4f1, #344052);
  border-radius: 999px;
  color: light-dark(#59677c, #b1bdd0);
  font-size: 11px;
}

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
  border: 1px solid light-dark(#c9d9f8, #365681);
  border-radius: 999px;
  background: light-dark(#edf4ff, #172841);
  color: light-dark(#1556cf, #8cb3ff);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  pointer-events: auto;
}
.dcAgentPromptPanel {
  position: absolute;
  top: 44px;
  left: 16px;
  width: min(660px, calc(100vw - 120px));
  max-height: min(68vh, 660px);
  box-sizing: border-box;
  overflow: auto;
  padding: 16px;
  border: 1px solid light-dark(#d5dae4, #303947);
  border-radius: 16px;
  background: light-dark(#ffffff, #161b23);
  color: light-dark(#172033, #edf2fa);
  box-shadow: light-dark(0 18px 48px rgba(33,55,88,.20), 0 20px 54px rgba(0,0,0,.40));
  pointer-events: auto;
}
.dcAgentPromptHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.dcAgentPromptHead h3 { margin: 0; font-size: 16px; line-height: 22px; }
.dcAgentPromptHead p { margin: 3px 0 0; color: light-dark(#697386, #aab5c7); font-size: 11px; line-height: 17px; }
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
.dcAgentPromptClose:hover { background: light-dark(#f1f4f8, #222a36); }
.dcAgentPromptTabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dcAgentPromptTab,
.dcAgentPromptChoice {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid light-dark(#d9dee8, #394352);
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentPromptTab.is-active,
.dcAgentPromptChoice.is-selected {
  border-color: light-dark(#2869e6, #6d9eff);
  background: light-dark(#edf4ff, #172841);
  color: light-dark(#1556cf, #8cb3ff);
}
.dcAgentPromptField { display: grid; gap: 6px; margin: 10px 0; }
.dcAgentPromptField > span { font-size: 12px; font-weight: 600; }
.dcAgentPromptText {
  box-sizing: border-box;
  width: 100%;
  min-height: 104px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid light-dark(#d9dee8, #394352);
  border-radius: 10px;
  background: light-dark(#fbfcfe, #11171f);
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
  border-radius: 10px;
  color: light-dark(#59677c, #b1bdd0);
  font-size: 12px;
}
.dcAgentPromptFile input { max-width: 100%; }
.dcAgentPromptGroup { margin-top: 12px; }
.dcAgentPromptGroup > b { display: block; margin-bottom: 7px; font-size: 12px; }
.dcAgentPromptChoices { display: flex; flex-wrap: wrap; gap: 6px; }
.dcAgentPromptChoice input { margin: 0; }
.dcAgentPromptNote {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: light-dark(#f6f8fb, #1c2330);
  color: light-dark(#697386, #aab5c7);
  font-size: 11px;
  line-height: 17px;
}
.dcAgentPromptError { margin: 8px 0 0; color: light-dark(#b42318, #ff8d86); font-size: 11px; }
.dcAgentPromptActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dcAgentPromptAction {
  min-height: 34px;
  padding: 6px 13px;
  border: 1px solid light-dark(#d9dee8, #394352);
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentPromptAction.is-primary { border-color: #2869e6; background: #2869e6; color: white; }
.dcAgentPromptAction:disabled { opacity: .5; cursor: default; }

.dcAgentHeaderAction {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid light-dark(#d9dee8, #394352);
  border-radius: 8px;
  background: light-dark(#ffffff, #191f28);
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dcAgentHeaderAction:hover,
.dcAgentHeaderAction:focus-visible {
  border-color: light-dark(#2869e6, #6d9eff);
  color: light-dark(#1556cf, #8cb3ff);
}

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
  .dcAgentOverlay { background: rgba(8, 10, 14, 0.22); pointer-events: auto; }
  .dcAgentStepper { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dcAgentQccBadge { display: none; }
  .dcAgentCandidate { grid-template-columns: 1fr; }
  .dcAgentCapabilities { justify-content: flex-start; padding-inline: 12px; }
  .dcAgentCapability { min-width: 92px; }
  .dcAgentPromptPanel { left: 8px; width: calc(100vw - 88px); max-height: 72vh; }
  .dcAgentHomeFlow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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

    // 会话级数据（不进 store，避免大快照膨胀）。原始行仅用于后端往返，不进模型上下文。
    let session = { rows: [], headers: [] };
    let lastCsv = { clean: null, complete: null, qcc: null, review: null };

    const STEPS = [
      { key: 'upload', label: '上传与映射', icon: '📄' },
      { key: 'profile', label: '数据体检', icon: '🩺' },
      { key: 'review', label: '匹配核验', icon: '🔎' },
      { key: 'enrich', label: '补全与导出', icon: '⬇️' },
    ];

    const CAPABILITIES = [
      { key: 'upload', label: '上传清洗', icon: IconPaperclipOutline16, fallback: '＋' },
      { key: 'profile', label: '质量体检', icon: IconChecklistOutline14, fallback: '✓' },
      { key: 'review', label: '匹配核验', icon: IconSearchOutline16, fallback: '⌕' },
      { key: 'enrich', label: '字段补全', icon: IconDataOutline16, fallback: '▦' },
      { key: 'history', label: '任务历史', icon: IconArchiveOutline20, fallback: '◷' },
    ];

    const CLEANING_OPTIONS = [
      ['normalize_name', '规范企业名称'],
      ['complete_name', '补全 / 修正旧名称'],
      ['verify_credit', '校验 / 补全信用代码'],
      ['deduplicate', '重复企业去重'],
      ['manual_review', '模糊候选人工确认'],
    ];
    const ENRICHMENT_OPTIONS = [
      ['credit_no', '统一社会信用代码'],
      ['legal_rep', '法定代表人'],
      ['reg_capital', '注册资本'],
      ['establish_date', '成立日期'],
      ['reg_status', '登记 / 经营状态'],
      ['panorama', '企业全景与联系方式'],
      ['ownership', '股权与对外投资'],
      ['governance', '主要人员与变更年报'],
      ['risk', '风险信息'],
      ['ipr', '知识产权'],
      ['operation', '经营信息'],
    ];
    const DEFAULT_CLEANING_KEYS = ['normalize_name', 'complete_name', 'verify_credit', 'deduplicate', 'manual_review'];
    const DEFAULT_ENRICHMENT_KEYS = ['credit_no', 'legal_rep', 'reg_capital', 'establish_date', 'reg_status'];
    const DEFAULT_SESSION_PROMPT = '请帮我清洗并补全企业名单。可点击输入框左上角「提示词生成」录入名单、上传 Excel 或图片，也可直接修改本段任务说明后开始。';
    const CLEANING_SESSION_STORAGE_KEY = 'dsh.data-cleaning-agent.sessions.v1';
    const CLEANING_SESSION_EVENT = 'dsh:data-cleaning-session-marked';
    const cleaningSessionIds = new Set();

    try {
      const stored = window.sessionStorage?.getItem(CLEANING_SESSION_STORAGE_KEY);
      for (const id of JSON.parse(stored || '[]')) {
        if (typeof id === 'string' && id) cleaningSessionIds.add(id);
      }
    } catch (_error) {
      // sessionStorage 可能被禁用；当前页面内的 Set 仍可工作。
    }

    function isCleaningSession(sessionId) {
      return typeof sessionId === 'string' && cleaningSessionIds.has(sessionId);
    }

    function markCleaningSession(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId) return;
      cleaningSessionIds.add(sessionId);
      try {
        window.sessionStorage?.setItem(CLEANING_SESSION_STORAGE_KEY, JSON.stringify([...cleaningSessionIds].slice(-20)));
      } catch (_error) {
        // 不因浏览器存储策略阻断会话。
      }
      if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent(CLEANING_SESSION_EVENT, { detail: { sessionId } }));
      }
    }

    function useCleaningSession(sessionId) {
      const [markedSessionId, setMarkedSessionId] = react.useState(
        isCleaningSession(sessionId) ? sessionId : null,
      );
      react.useEffect(() => {
        const handleMarked = (event) => {
          if (event?.detail?.sessionId === sessionId) setMarkedSessionId(sessionId);
        };
        window.addEventListener?.(CLEANING_SESSION_EVENT, handleMarked);
        return () => window.removeEventListener?.(CLEANING_SESSION_EVENT, handleMarked);
      }, [sessionId]);
      // DSH 可能复用同一个 slot component 切换会话；状态必须绑定具体 sessionId，
      // 避免从清洗会话切回普通会话后仍残留业务首页与提示词入口。
      return markedSessionId === sessionId || isCleaningSession(sessionId);
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
      const entries = Array.isArray(config.entries)
        ? config.entries.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [];
      const entryCount = Number.isFinite(config.entryCount) ? config.entryCount : entries.length;
      const source = mode === 'image'
        ? `已附加图片${config.fileName ? `「${config.fileName}」` : ''}`
        : mode === 'excel'
          ? `本地表格${config.fileName ? `「${config.fileName}」` : ''}，已解析 ${entryCount} 条主体标识，完整数据已载入数据清洗补全工作台`
          : `手工录入，共 ${entryCount} 条主体标识`;
      const lines = [
        '请执行一项企业名单数据清洗补全任务。',
        `输入来源：${source}。`,
      ];
      if (mode === 'image') {
        lines.push('请先使用当前已连接且可用的企查查智能文档解析 MCP 能力，从图片中提取企业全称或统一社会信用代码；若该能力未连接或不可用，请先提示我改用文本或 Excel。');
      }
      if (entries.length) {
        lines.push(`${mode === 'excel' ? '主体预览' : '待处理主体'}：\n${entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}`);
      }
      lines.push(`清洗要求：${cleanLabels.length ? cleanLabels.join('、') : '仅解析，不自动修改'}。`);
      lines.push(`需要补全的字段 / 维度：${enrichLabels.length ? enrichLabels.join('、') : '不调用外部补全，仅输出本地清洗结果'}。`);
      lines.push('处理规则：企业全称、统一社会信用代码或注册号优先精确匹配；精确匹配失败时再进入模糊候选，存在多个候选必须暂停并让我确认，不得默认选择第一项。');
      lines.push('请先生成数据质量体检与匹配摘要，经我确认后再执行需要消耗额度的企查查 MCP 调用；企查查连接、套餐额度和费用均由当前用户自己的账号承担。缺失或无权限字段请留空并标记原因，不得编造。');
      lines.push('完成后保留来源原值、标准主体、匹配状态与字段来源，并提供结果和待复核清单的导出。');
      return lines.join('\n\n');
    }

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
          toggleExpanded: (draft) => { draft.expanded = !draft.expanded; },
          setStep: (draft, step) => { draft.step = step; },
          setActiveSession: (draft, sessionId) => { draft.activeSessionId = sessionId ?? null; },
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

    /** 使用 DSH 原生工作区、会话和输入机打开中央对话，不构造第二套聊天界面。 */
    async function startCleaningSession(ctx) {
      const workspace = ctx.workspaces.list.getSnapshot();
      const current = ctx.sessions.list.getSnapshot().current;
      const items = Array.isArray(workspace.items) ? workspace.items : [];
      const currentWorkspaceId = current === undefined
        ? undefined
        : items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(current))?.workspaceId;
      const targetWorkspaceId = currentWorkspaceId ?? workspace.recentWorkspaceId ?? items[0]?.workspaceId;
      if (targetWorkspaceId === undefined) {
        throw new Error('请先选择一个工作空间，再打开数据清洗补全智能体');
      }
      // rc.2 暴露 workspaces.connectWorkspace；alpha.2 把同一导航策略迁移到
      // uiWorkspace.connectWorkspace，纯 workspaces controller 不再带该方法。
      // 只在检测到真实方法后调用，避免把 alpha 实验面当成稳定契约。
      const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace;
      const connectWorkspace = typeof ctx.workspaces.connectWorkspace === 'function'
        ? ctx.workspaces.connectWorkspace.bind(ctx.workspaces)
        : typeof uiWorkspace?.connectWorkspace === 'function'
          ? uiWorkspace.connectWorkspace.bind(uiWorkspace)
          : null;
      const sessionId = connectWorkspace
        ? await connectWorkspace(targetWorkspaceId)
        : typeof ctx.sessions.create === 'function'
          ? await ctx.sessions.create({ workspaceId: targetWorkspaceId })
          : null;
      if (!sessionId) throw new Error('当前 DSH 版本没有可用的工作区会话创建能力');
      const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation;
      if (!conversation) throw new Error('DSH 对话服务尚未就绪，请稍后重试');
      markCleaningSession(sessionId);
      conversation.input.shell(sessionId).setDraft(DEFAULT_SESSION_PROMPT);
      ctx.sessions.open(sessionId);
      return sessionId;
    }

    /**
     * 图片接入兼容 Bridge。仅在运行时同时探测到 createDraftImages / input.shell.addImages
     * 时使用；失败会释放浏览器临时对象，不假设 alpha 实验 API 稳定。
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
      return images.length;
    }

    function capabilityIcon(item, size = 16) {
      return typeof item.icon === 'function'
        ? h(item.icon, { size, 'aria-hidden': 'true' })
        : h('span', { 'aria-hidden': 'true' }, item.fallback);
    }

    function openWorkbench(actions, step, sessionId) {
      actions.openAt(step, sessionId);
      startJobsPolling(actions);
    }

    const WORKBENCH_OPEN_EVENT = 'dsh:data-cleaning-workbench-open';
    const WORKBENCH_DATASET_EVENT = 'dsh:data-cleaning-workbench-dataset';

    // session scope 不能复用 root scope 的 store handle。DSH 当前会分别物化 root/session
    // 插槽组件，因此以 document 事件跨 scope 通知；闭包引用仅作为无 DOM 测试降级。
    let rootWorkbenchActions = null;

    /** 从 session scope 的 composer/header 触发 root scope 工作台。 */
    function requestWorkbenchOpen(step, sessionId) {
      if (typeof document !== 'undefined'
        && typeof document.createEvent === 'function'
        && typeof document.dispatchEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_OPEN_EVENT, false, true, { step, sessionId });
        if (!document.dispatchEvent(event)) return;
      }
      if (rootWorkbenchActions) openWorkbench(rootWorkbenchActions, step, sessionId);
    }

    /** 把提示词生成器解析出的完整表格交给 root 工作台，不把整表塞进模型上下文。 */
    function requestWorkbenchDataset(result, sessionId) {
      if (typeof document !== 'undefined'
        && typeof document.createEvent === 'function'
        && typeof document.dispatchEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_DATASET_EVENT, false, true, { result, sessionId });
        if (!document.dispatchEvent(event)) return;
      }
      if (rootWorkbenchActions) {
        applyParsed(result, rootWorkbenchActions);
        rootWorkbenchActions.setActiveSession(sessionId);
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
        children: wide ? '🧹 数据清洗补全' : '🧹',
      });
      if (!topMount || typeof reactDom.createPortal !== 'function') return launcher;
      return reactDom.createPortal(h('div', {
        className: 'dcAgentTopEntry',
        'data-wide': wide,
      }, launcher), topMount);
    }

    /** Mockup 五能力入口：由 input.dock 承载，并在 CSS 中排到原生 composer 下方。 */
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

    function ProductHome() {
      const flow = [
        ['01', '录入名单', '文本、Excel 或图片'],
        ['02', '质量体检', '缺失、重复与格式诊断'],
        ['03', '主体匹配', '精确优先，多候选复核'],
        ['04', '补全导出', '按需选字段，保留来源'],
      ];
      return h('section', { className: 'dcAgentProductHome', 'aria-label': '数据清洗补全产品介绍' },
        h('h2', null, '把企业名单变成可核验、可回写的标准数据'),
        h('p', null, '面向销售线索、客户尽调、供应商管理与 CRM / ERP 数据治理，先本地体检清洗，再按需使用当前用户连接的企查查 MCP 补全。'),
        h('div', { className: 'dcAgentHomeFlow', 'aria-label': '数据清洗补全工作流' },
          flow.map(([index, title, hint]) => h('div', { className: 'dcAgentHomeStep', key: index },
            h('b', null, index),
            h('span', null, title),
            h('small', { style: { display: 'block', opacity: .72 } }, hint),
          )),
        ),
        h('div', { className: 'dcAgentHomeTrust' },
          h('span', null, '本地解析与确定性清洗'),
          h('span', null, '匹配候选人工确认'),
          h('span', null, '客户自带企查查连接与额度'),
          h('span', null, '结果与待复核清单可导出'),
        ),
      );
    }

    /**
     * DSH 当前只公开 hero brand.mark，没有 headline slot。这里仅在本插件会话且 blank hero
     * 阶段精确替换原生中英文标题，并在卸载时恢复，避免污染普通会话。
     */
    function rewriteHeroChrome(sessionId, enabled) {
      if (!enabled || typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return () => {};
      const marker = [...document.querySelectorAll('.dcAgentExperience')]
        .find((element) => element?.dataset?.sessionId === sessionId);
      const hero = marker?.closest?.('[data-phase="hero"]');
      if (!hero) return () => {};
      const spans = [...hero.querySelectorAll('span')];
      const title = spans.find((element) => ['探索未至之境', 'Into the Unknown'].includes(element.textContent?.trim()))
        ?? spans.find((element) => element.dataset?.dcAgentHeroTitle === 'true');
      const badge = spans.find((element) => ['预览版', 'Preview'].includes(element.textContent?.trim()))
        ?? spans.find((element) => element.dataset?.dcAgentHeroBadge === 'true');
      if (title) {
        title.dataset.dcAgentHeroTitle = 'true';
        title.dataset.dcAgentOriginalText ??= title.textContent ?? '';
        title.textContent = '数据清洗补全智能体';
      }
      if (badge) {
        badge.dataset.dcAgentHeroBadge = 'true';
        badge.dataset.dcAgentOriginalDisplay ??= badge.style?.display ?? '';
        if (badge.style) badge.style.display = 'none';
      }
      return () => {
        if (title?.dataset?.dcAgentOriginalText !== undefined) {
          title.textContent = title.dataset.dcAgentOriginalText;
          delete title.dataset.dcAgentOriginalText;
          delete title.dataset.dcAgentHeroTitle;
        }
        if (badge?.dataset?.dcAgentOriginalDisplay !== undefined) {
          if (badge.style) badge.style.display = badge.dataset.dcAgentOriginalDisplay;
          delete badge.dataset.dcAgentOriginalDisplay;
          delete badge.dataset.dcAgentHeroBadge;
        }
      };
    }

    function DataCleaningExperience(props) {
      const { sessionId, session: ownerSession } = props;
      const enabled = useCleaningSession(sessionId);
      const hero = ownerSession?.composerPhase === 'blank';
      react.useEffect(
        () => rewriteHeroChrome(sessionId, enabled && hero),
        [sessionId, enabled, hero, ownerSession?.openState]
      );
      if (!enabled) return null;
      return h('div', {
        className: `dcAgentExperience${hero ? ' is-home' : ''}`,
        'data-session-id': sessionId,
      },
        CapabilityBar({ sessionId }),
        hero ? ProductHome() : null,
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

    function PromptGenerator(props) {
      const { sessionId, inputActions, attachImages } = props;
      const enabled = useCleaningSession(sessionId);
      const [open, setOpen] = react.useState(false);
      const [mode, setMode] = react.useState('text');
      const [rawText, setRawText] = react.useState('');
      const [entries, setEntries] = react.useState([]);
      const [entryCount, setEntryCount] = react.useState(0);
      const [spreadsheetFileName, setSpreadsheetFileName] = react.useState('');
      const [imageFileName, setImageFileName] = react.useState('');
      const [imageAttached, setImageAttached] = react.useState(false);
      const [cleaningKeys, setCleaningKeys] = react.useState(DEFAULT_CLEANING_KEYS);
      const [enrichmentKeys, setEnrichmentKeys] = react.useState(DEFAULT_ENRICHMENT_KEYS);
      const [busy, setBusy] = react.useState(false);
      const [error, setError] = react.useState(null);

      if (!enabled) return null;

      const setSourceMode = (nextMode) => {
        setMode(nextMode);
        setError(null);
      };
      const toggle = (setter, values, key) => setter(values.includes(key)
        ? values.filter((item) => item !== key)
        : [...values, key]);
      const handleFile = async (event) => {
        const file = event.target?.files?.[0];
        if (!file || busy) return;
        setBusy(true);
        setError(null);
        try {
          if (mode === 'image') {
            if (typeof attachImages !== 'function') throw new Error('当前 DSH 没有可用的图片接入 Bridge。');
            await attachImages(sessionId, [file]);
            setImageFileName(file.name);
            setImageAttached(true);
          } else {
            const result = await parseFile(file);
            if (!result || result.ok === false) throw new Error(result?.message || result?.error || '表格解析失败');
            const extracted = extractPromptEntries(result);
            if (!extracted.length) throw new Error('未识别到企业名称或统一社会信用代码列，请检查表头。');
            setEntries(extracted);
            setEntryCount(Number.isFinite(result.rowCount) ? result.rowCount : (Array.isArray(result.rows) ? result.rows.length : extracted.length));
            setSpreadsheetFileName(file.name);
            requestWorkbenchDataset(result, sessionId);
          }
        } catch (fileError) {
          setError(fileError instanceof Error ? fileError.message : String(fileError));
        } finally {
          setBusy(false);
          if (event.target) event.target.value = '';
        }
      };
      const generatePrompt = () => {
        const manualEntries = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const selectedEntries = mode === 'text' ? manualEntries : entries;
        if (mode === 'text' && !selectedEntries.length) {
          setError('请先录入企业名称或统一社会信用代码，每行一条。');
          return;
        }
        if (mode === 'excel' && !selectedEntries.length) {
          setError('请先上传并解析 Excel / CSV / JSON 文件。');
          return;
        }
        if (mode === 'image' && !imageAttached) {
          setError('请先选择并附加一张包含企业名单的图片。');
          return;
        }
        if (!inputActions || typeof inputActions.setDraft !== 'function') {
          setError('当前会话输入机尚未就绪，请稍后重试。');
          return;
        }
        inputActions.setDraft(buildTaskPrompt({
          mode,
          entries: selectedEntries,
          entryCount: mode === 'excel' ? entryCount : selectedEntries.length,
          fileName: mode === 'image' ? imageFileName : spreadsheetFileName,
          cleaningKeys,
          enrichmentKeys,
        }));
        setError(null);
        setOpen(false);
      };

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

      return h('div', { className: 'dcAgentPromptLayer' },
        h('button', {
          type: 'button',
          className: 'dcAgentPromptTrigger',
          'aria-label': '打开提示词生成',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        }, '✨ 提示词生成'),
        open ? h('section', {
          className: 'dcAgentPromptPanel',
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': '数据清洗补全任务生成器',
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            }
          },
        },
          h('div', { className: 'dcAgentPromptHead' },
            h('div', null,
              h('h3', null, '生成数据清洗补全任务'),
              h('p', null, '录入主体、选择清洗动作与补全维度，生成后仍可在对话框中人工修改。'),
            ),
            h('button', { type: 'button', className: 'dcAgentPromptClose', 'aria-label': '关闭提示词生成', onClick: () => setOpen(false) }, '✕'),
          ),
          h('div', { className: 'dcAgentPromptTabs', role: 'tablist', 'aria-label': '名单录入方式' },
            [['text', '粘贴名单'], ['excel', '上传 Excel'], ['image', '上传图片']].map(([key, label]) => h('button', {
              key,
              type: 'button',
              role: 'tab',
              'aria-selected': mode === key,
              className: `dcAgentPromptTab${mode === key ? ' is-active' : ''}`,
              onClick: () => setSourceMode(key),
            }, label)),
          ),
          mode === 'text' ? h('label', { className: 'dcAgentPromptField' },
            h('span', null, '企业名称或统一社会信用代码（每行一条）'),
            h('textarea', {
              className: 'dcAgentPromptText',
              value: rawText,
              placeholder: '企查查科技股份有限公司\n9132…\n某某信息技术（上海）有限公司',
              onChange: (event) => setRawText(event.target.value),
            }),
          ) : h('label', { className: 'dcAgentPromptFile' },
            h('span', null, mode === 'image' ? '选择企业名单图片' : '选择 Excel / CSV / JSON 名单'),
            h('input', {
              type: 'file',
              accept: mode === 'image' ? 'image/png,image/jpeg,image/webp' : '.xlsx,.xls,.csv,.json',
              disabled: busy,
              onChange: handleFile,
            }),
            (mode === 'excel' ? spreadsheetFileName : imageFileName)
              ? h('b', null, `${mode === 'excel' ? spreadsheetFileName : imageFileName}${mode === 'excel' ? ` · ${entryCount} 条` : ' · 已附加'}`)
              : null,
          ),
          h('div', { className: 'dcAgentPromptGroup' },
            h('b', null, '需要执行哪些清洗？'),
            h('div', { className: 'dcAgentPromptChoices' }, choice(CLEANING_OPTIONS, cleaningKeys, setCleaningKeys)),
          ),
          h('div', { className: 'dcAgentPromptGroup' },
            h('b', null, '需要补全哪些字段 / 维度？'),
            h('div', { className: 'dcAgentPromptChoices' }, choice(ENRICHMENT_OPTIONS, enrichmentKeys, setEnrichmentKeys)),
          ),
          h('p', { className: 'dcAgentPromptNote' }, '图片模式只负责把图片附加到当前对话，并生成“优先调用已连接的企查查智能文档解析 MCP”的任务要求；插件不会虚构或硬编码未验证的工具名。企查查调用使用当前客户自己的连接、账号与额度。'),
          error ? h('p', { className: 'dcAgentPromptError', role: 'alert' }, error) : null,
          h('div', { className: 'dcAgentPromptActions' },
            h('button', { type: 'button', className: 'dcAgentPromptAction', onClick: () => setOpen(false) }, '取消'),
            h('button', { type: 'button', className: 'dcAgentPromptAction is-primary', disabled: busy, onClick: generatePrompt }, busy ? '处理中…' : '生成并回填'),
          ),
        ) : null,
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
        typeof IconDataOutline16 === 'function'
          ? h(IconDataOutline16, { size: 16, 'aria-hidden': 'true' })
          : h('span', { 'aria-hidden': 'true' }, '▦'),
        h('span', null, '清洗补全工作台'),
      );
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
    }

    /** 右侧非模态工作台：中央区域始终保留 DSH 原生会话。 */
    function WorkbenchDrawer(props) {
      const { useStore, actions } = props;
      const open = useStore((state) => state.open);
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
      const activeSessionId = useStore((state) => state.activeSessionId);

      react.useEffect(() => {
        rootWorkbenchActions = actions;
        const handleOpen = (event) => {
          event?.preventDefault?.();
          const detail = event?.detail ?? {};
          openWorkbench(actions, detail.step ?? null, detail.sessionId ?? null);
        };
        const handleDataset = (event) => {
          event?.preventDefault?.();
          const detail = event?.detail ?? {};
          if (detail.result) applyParsed(detail.result, actions);
          if (detail.sessionId) actions.setActiveSession(detail.sessionId);
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener(WORKBENCH_OPEN_EVENT, handleOpen);
          document.addEventListener(WORKBENCH_DATASET_EVENT, handleDataset);
        }
        return () => {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener(WORKBENCH_OPEN_EVENT, handleOpen);
            document.removeEventListener(WORKBENCH_DATASET_EVENT, handleDataset);
          }
          stopJobsPolling();
          if (rootWorkbenchActions === actions) rootWorkbenchActions = null;
        };
      }, [actions]);

      // 非模态右栏会覆盖 Host 的中央画布；按实际重叠量把 composer 能力栏左移，
      // 保证 Mockup 中的五个入口在窄桌面视口仍可见、可点击。展开态专注工作台，
      // 不强行挤压到不足一栏的剩余区域。
      react.useEffect(() => {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return undefined;
        const reset = () => {
          for (const bar of document.querySelectorAll('.dcAgentCapabilities')) {
            bar.style?.removeProperty('--dc-agent-workbench-shift');
          }
        };
        if (!open || expanded) {
          reset();
          return reset;
        }
        const align = () => {
          const drawer = document.querySelector('.dcAgentWorkbench');
          if (!drawer) return;
          const drawerRect = drawer.getBoundingClientRect();
          for (const bar of document.querySelectorAll('.dcAgentCapabilities')) {
            const barRect = bar.getBoundingClientRect();
            const overlap = Math.max(0, barRect.right - drawerRect.left + 8);
            const leftRoom = Math.max(0, barRect.left - 88);
            const shift = Math.min(overlap, leftRoom);
            bar.style?.setProperty('--dc-agent-workbench-shift', `${-shift}px`);
          }
        };
        const view = document.defaultView;
        const frameId = typeof view?.requestAnimationFrame === 'function'
          ? view.requestAnimationFrame(align)
          : null;
        view?.addEventListener?.('resize', align);
        align();
        return () => {
          if (frameId !== null) view?.cancelAnimationFrame?.(frameId);
          view?.removeEventListener?.('resize', align);
          reset();
        };
      }, [open, expanded]);

      // DSH 的 useStore 基于 React hooks；所有订阅必须在每次渲染时以相同顺序调用。
      // 把关闭态 guard 放在全部 useStore 之后，避免首次关闭、随后打开时触发
      // React #310（Rendered more hooks than during the previous render）。
      if (!open) return null;

      const hasData = dataset !== null && dataset.rowCount > 0;
      const fieldByPattern = (pattern) => session.headers.find((field) => pattern.test(field)) ?? null;
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
          const r = await api('/data-cleaning/api/mvp/profile', {
            rows: session.rows,
            headers: session.headers,
            options: { amountField },
          });
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
          const r = await api('/data-cleaning/api/mvp/clean', {
            rows: session.rows,
            headers: session.headers,
            options: localCleanOptions,
          });
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
          const r = await api('/data-cleaning/api/mvp/complete', {
            rows: session.rows,
            headers: session.headers,
            options: localCompleteOptions,
          });
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
      if (step === 'history') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '查看当前 Host 的数据清洗后台任务。任务数据仅在本机保存，不进入模型上下文。'),
          h('div', { className: 'dcAgentRow' },
            h('button', {
              type: 'button',
              className: 'dcAgentButton',
              disabled: busy,
              'aria-label': '刷新任务历史',
              onClick: () => pollJobsOnce(actions),
            }, '刷新任务'),
            h('button', {
              type: 'button',
              className: 'dcAgentButton is-primary',
              onClick: () => actions.setStep('upload'),
            }, '新建清洗任务'),
          ),
          jobs.length ? h('div', { className: 'dcAgentPane', 'aria-label': '任务历史列表' },
            jobs.map((job) => h('section', { key: job.id, className: 'dcAgentSection' },
              h('h3', null, job.name || job.id || '数据清洗任务'),
              h('div', { className: 'dcAgentRow' },
                h('span', { className: 'dcAgentJobsPill', 'data-state': job.state ?? 'idle' }, JOB_STATE_LABEL[job.state] ?? job.state ?? '未知'),
                h('span', { className: 'dcAgentHint' }, job.createdAt ? new Date(job.createdAt).toLocaleString() : ''),
              ),
            )),
          ) : h('section', { className: 'dcAgentSection' },
            h('h3', null, '暂无后台任务'),
            h('p', { className: 'dcAgentHint' }, '上传企业名单并开始处理后，任务状态会显示在这里。'),
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
                h('input', { type: 'checkbox', checked: paidConfirmed, 'aria-label': '确认使用当前用户的企查查账号额度', onChange: (event) => actions.setPaidConfirmed(event.target.checked) }),
                '我已核对企业数量、所选域及调用上界，并确认使用自己连接的企查查 MCP 账号；额度或费用由该账号自行承担',
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
        'data-dsh-plugin': 'data-cleaning-agent',
        onClick: (event) => {
          if (event.target === event.currentTarget) {
            stopJobsPolling();
            actions.close();
          }
        },
      },
        h('aside', {
          className: `dcAgentWorkbench${expanded ? ' is-expanded' : ''}`,
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': '数据清洗补全工作台',
          'data-session-id': activeSessionId ?? undefined,
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              stopJobsPolling();
              actions.close();
            }
          },
        },
          h('header', { className: 'dcAgentWbHeader' },
            h('div', { className: 'dcAgentWbTitle' },
              h('span', { className: 'dcAgentWbIcon', 'aria-hidden': 'true' }, '🧹'),
              h('div', null,
                h('b', null, '数据清洗补全'),
                h('small', null, '本地确定性清洗 · 可选企查查 MCP 补全'),
              ),
            ),
            h('span', {
              className: 'dcAgentQccBadge',
              title: qccRun ? `任务 ${qccRun.runId}` : '仅在当前用户确认使用自己的企查查账号后调用',
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
      const state = {
        applied: true,
        entry: 'sidebar.workspaces:before(portal)',
        lifecycleSlot: 'sidebar.footer.action',
        capabilitySlot: 'conversation.input.dock',
        promptSlot: 'conversation.input.overlay',
        heroTitleBridge: 'exact-text/reversible',
        headerSlot: 'conversation.session.header.actions',
        overlay: 'shell.overlay',
        error: null,
      };
      window.__DC_MVP__ = state;
      try {
        const workbenchStore = createWorkbenchStore();
        ctx.effect(() => installUiStyles(), 'data-cleaning-agent: UI styles');

        // 右侧工作台：additive overlay，不替换 DSH 单占位 details 面板。
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'data-cleaning-agent',
          order: 200,
          store: workbenchStore,
        }, WorkbenchDrawer));

        // 左栏：footer 只托管生命周期和 Portal 降级；实际入口显示在工作区列表前。
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'data-cleaning-agent',
          order: 10,
          store: workbenchStore,
          inject: () => ({ startSession: () => startCleaningSession(ctx) }),
        }, SidebarEntry));

        // 独立 dock 行：对齐 Mockup 的五个能力 ICON，CSS 只把本 cell 排到输入框下方。
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
          inject: () => ({ attachImages: (sessionId, files) => attachPromptImages(ctx, sessionId, files) }),
        }, PromptGenerator));

        // 会话头部恢复入口：用户关闭右栏后可随时重新打开当前任务工作台。
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'data-cleaning-agent-workbench',
          order: 110,
        }, WorkbenchHeaderEntry));

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
    // 测试用纯函数，不构成 Host / DSH 稳定 API。
    exports.__testing = { buildTaskPrompt, extractPromptEntries, markCleaningSession };
    return module.exports;
  },
});

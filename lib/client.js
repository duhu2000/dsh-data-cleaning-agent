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
  max-width: 980px;
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
  grid-template-columns: repeat(7, minmax(0, 1fr));
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
.dcAgentHomeHero { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.dcAgentHomeHero p { margin: 5px 0 0; color: light-dark(#697386, #aab5c7); font-size: 12px; line-height: 18px; }
.dcAgentHomeEyebrow { display: block; margin-bottom: 4px; color: light-dark(#2869e6, #8cb3ff); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.dcAgentHomeActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dcAgentHomeActions button,
.dcAgentHomeRecent button,
.dcAgentHistoryTask { border: 1px solid light-dark(#dce4f1, #344052); border-radius: 9px; background: light-dark(#fff, #1b222e); color: inherit; font: inherit; cursor: pointer; }
.dcAgentHomeActions button { padding: 6px 9px; font-size: 11px; }
.dcAgentHomeRecent { display: grid; gap: 6px; margin-top: 12px; }
.dcAgentHomeRecent > b { font-size: 12px; }
.dcAgentHomeRecent button { display: flex; justify-content: space-between; gap: 12px; padding: 7px 9px; text-align: left; font-size: 11px; }
.dcAgentHomeRecent small { color: light-dark(#697386, #aab5c7); }
.dcAgentWizardNav { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
.dcAgentWizardStep { display: flex; align-items: center; gap: 6px; padding: 7px; border: 1px solid light-dark(#d9dee8, #394352); border-radius: 9px; background: transparent; color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
.dcAgentWizardStep b { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: light-dark(#eef1f6, #252e3b); color: light-dark(#607088, #b9c6da); }
.dcAgentWizardStep.is-active { border-color: #2869e6; background: light-dark(#edf4ff, #172841); color: light-dark(#1556cf, #8cb3ff); }
.dcAgentWizardStep.is-active b { background: #2869e6; color: white; }
.dcAgentWizardPane { min-height: 230px; }
.dcAgentWizardPane h4 { margin: 0 0 3px; font-size: 14px; }
.dcAgentWizardPane > p { margin: 0 0 12px; color: light-dark(#697386, #aab5c7); font-size: 11px; line-height: 17px; }
.dcAgentPromptRules { display: grid; gap: 8px; margin-top: 14px; }
.dcAgentPromptRules label { font-size: 12px; }
.dcAgentPromptPreview { max-height: 260px; overflow: auto; margin: 10px 0 0; padding: 12px; border-radius: 10px; background: light-dark(#f6f8fb, #11171f); white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 11px; line-height: 18px; }
.dcAgentFormField { display: grid; gap: 6px; font-size: 12px; font-weight: 600; }
.dcAgentMappingRow { display: grid; grid-template-columns: minmax(0, 1fr) 24px minmax(180px, 1fr); align-items: center; gap: 8px; margin-top: 7px; font-size: 12px; }
.dcAgentMappingRow > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcAgentMappingRow > b { text-align: center; color: light-dark(#8792a3, #8290a5); }
.dcAgentRulesGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.dcAgentFieldGroup { display: grid; gap: 7px; margin-top: 12px; }
.dcAgentFieldGroup > b { font-size: 12px; }
.dcAgentPreviewTable { margin-top: 12px; overflow: auto; border: 1px solid light-dark(#e4e8f0, #303947); border-radius: 10px; }
.dcAgentHistoryTask { display: block; width: 100%; padding: 10px; text-align: left; }
.dcAgentHistoryTask h3 { margin: 0; font-size: 12px; }
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
  .dcAgentHomeHero { align-items: flex-start; flex-direction: column; }
  .dcAgentWizardNav { grid-template-columns: repeat(2, 1fr); }
  .dcAgentRulesGrid { grid-template-columns: 1fr; }
  .dcAgentMappingRow { grid-template-columns: 1fr; }
  .dcAgentMappingRow > b { display: none; }
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
      target.headers = from.headers;
      target.source = from.source;
      target.lastCsv = from.lastCsv;
      target.resultRows = from.resultRows;
      runtimeTasks.delete(String(fromId || 'unassigned'));
      return target;
    }

    const STEPS = [
      { key: 'upload', label: '上传数据', icon: '📄' },
      { key: 'rules', label: '规则确认', icon: '⚙' },
      { key: 'match', label: '数据匹配', icon: '🔎' },
      { key: 'enrich', label: '清洗补全', icon: '▦' },
      { key: 'download', label: '下载数据', icon: '⬇️' },
    ];

    const CAPABILITIES = [
      { key: 'upload', label: '上传清洗', icon: IconPaperclipOutline16, fallback: '＋' },
      { key: 'profile', label: '质量体检', icon: IconChecklistOutline14, fallback: '✓' },
      { key: 'match', label: '匹配核验', icon: IconSearchOutline16, fallback: '⌕' },
      { key: 'enrich', label: '字段补全', icon: IconDataOutline16, fallback: '▦' },
      { key: 'history', label: '任务历史', icon: IconArchiveOutline20, fallback: '◷' },
    ];

    const CLEANING_OPTIONS = [
      ['clean_name', '名称补全与规范'],
      ['deduplicate', '重复企业去重'],
      ['validate_identity', '主体标识校验'],
      ['complete_fields', '补全所选企业字段'],
    ];
    const FIELD_GROUPS = [
      ['identity', '基础工商信息', [
        ['company_name', '企业名称'], ['credit_no', '统一社会信用代码'], ['reg_no', '注册号'],
        ['reg_status', '登记状态'], ['legal_rep', '法定代表人'], ['reg_capital', '注册资本'],
        ['paid_capital', '实缴资本'], ['establish_date', '成立日期'], ['company_type', '企业类型'],
        ['registration_authority', '登记机关'], ['former_name', '曾用名'], ['english_name', '英文名'],
      ]],
      ['contact', '地址与联系方式', [
        ['registered_address', '注册地址'], ['province', '省份地区'], ['city', '城市'],
        ['district', '区县'], ['phone', '电话'], ['email', '邮箱'], ['website', '官网'],
      ]],
      ['operation', '经营信息', [
        ['business_scope', '经营范围'], ['industry_category', '国标行业'], ['industry_large', '一级行业'],
        ['industry_middle', '二级行业'], ['operating_period', '营业期限'], ['company_size', '企业规模'],
        ['company_profile', '企业简介'],
      ]],
      ['risk', '风险摘要', [
        ['risk_summary', '风险摘要'], ['operating_exception', '经营异常摘要'], ['administrative_penalty', '行政处罚摘要'],
      ]],
      ['ipr', '知识产权摘要', [
        ['trademark_summary', '商标摘要'], ['patent_summary', '专利摘要'], ['software_copyright_summary', '软件著作权摘要'],
      ]],
    ];
    const ENRICHMENT_OPTIONS = FIELD_GROUPS.flatMap(([, , fields]) => fields);
    const MATCH_ANCHOR_OPTIONS = [
      ['company_name', '企业名称'], ['credit_no', '统一社会信用代码'], ['reg_no', '注册号'],
    ];
    const DEFAULT_CLEANING_KEYS = ['clean_name', 'deduplicate', 'validate_identity', 'complete_fields'];
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
      const anchorLabels = optionLabels(MATCH_ANCHOR_OPTIONS, config.anchorKeys);
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
      lines.push(`处理规则：优先使用${anchorLabels.length ? anchorLabels.join('、') : '企业名称、统一社会信用代码或注册号'}精确匹配；${config.matchRules?.manualReviewAmbiguous === false ? '精确匹配失败时直接输出未匹配记录' : '精确匹配失败时再进入模糊候选，存在多个候选必须暂停并让我确认，不得默认选择第一项'}。`);
      lines.push('请先生成数据质量体检与匹配摘要，经我确认后再执行需要消耗额度的企查查 MCP 调用；企查查连接、套餐额度和费用均由当前用户自己的账号承担。缺失或无权限字段请留空并标记原因，不得编造。');
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

    const MAPPING_PATTERNS = [
      ['company_name', /^(name|company|company_name|企业名称|公司名称|单位名称)$/i],
      ['credit_no', /^(credit_no|creditCode|unified_credit_code|统一社会信用代码|信用代码)$/i],
      ['reg_no', /^(reg_no|registration_no|注册号)$/i],
      ['phone', /^(phone|mobile|tel|telephone|联系电话|手机号码|手机号)$/i],
      ['province', /^(province|省份|省份地区)$/i],
      ['registered_address', /^(address|registered_address|注册地址|企业地址|公司地址)$/i],
    ];

    function guessMappings(headers) {
      const output = [];
      const usedTargets = new Set();
      for (const sourceField of Array.isArray(headers) ? headers : []) {
        const match = MAPPING_PATTERNS.find(([targetField, pattern]) => !usedTargets.has(targetField) && pattern.test(String(sourceField)));
        if (match) {
          output.push({ sourceField: String(sourceField), targetField: match[0] });
          usedTargets.add(match[0]);
        }
      }
      if (!output.length && Array.isArray(headers) && headers[0]) {
        output.push({ sourceField: String(headers[0]), targetField: 'company_name' });
      }
      return output;
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

    function cacheWorkflowTask(actions, sessionId, task) {
      if (!task) return null;
      if (sessionId) workflowTaskBySession.set(String(sessionId), task);
      actions.setWorkflowTask(task);
      if (task.title) actions.setTaskTitle(task.title);
      if (Array.isArray(task.objectives)) actions.setObjectives(task.objectives);
      if (Array.isArray(task.fieldSelection)) actions.setFieldSelection(task.fieldSelection);
      if (Array.isArray(task.mappings) && task.mappings.length) actions.setMappings(task.mappings);
      return task;
    }

    async function ensureWorkflowTask(actions, sessionId, draft = {}) {
      const key = String(sessionId || 'unassigned');
      const cached = workflowTaskBySession.get(key);
      if (cached) return cacheWorkflowTask(actions, sessionId, cached);
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

    /** 工作台 store：入口按钮与工作台共享 open，并保存当前 taskId 的可持久化 UI 元数据。 */
    function createWorkbenchStore() {
      return defineStore({
        init: () => ({
          open: false,
          expanded: false,
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
          toggleExpanded: (draft) => { draft.expanded = !draft.expanded; },
          setStep: (draft, step) => { draft.step = step; },
          setActiveSession: (draft, sessionId) => { draft.activeSessionId = sessionId ?? null; },
          setBusy: (draft, busy) => { draft.busy = busy; },
          setError: (draft, error) => { draft.error = error; },
          setInput: (draft, input) => { draft.input = input; },
          setWorkflowContract: (draft, value) => { draft.workflowContract = value; },
          setWorkflowTask: (draft, value) => { draft.workflowTask = value ?? null; },
          setWorkflowTasks: (draft, value) => { draft.workflowTasks = Array.isArray(value) ? value : []; },
          setTaskTitle: (draft, value) => { draft.taskTitle = String(value ?? ''); },
          setMappings: (draft, value) => { draft.mappings = Array.isArray(value) ? value : []; },
          setMapping: (draft, sourceField, targetField) => {
            const mappings = draft.mappings.filter((item) => item.sourceField !== sourceField && item.targetField !== targetField);
            if (targetField) mappings.push({ sourceField, targetField });
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
    const WORKBENCH_DRAFT_EVENT = 'dsh:data-cleaning-workbench-draft';

    // session scope 不能复用 root scope 的 store handle。DSH 当前会分别物化 root/session
    // 插槽组件，因此以 document 事件跨 scope 通知；闭包引用仅作为无 DOM 测试降级。
    let rootWorkbenchActions = null;

    /** 从 session scope 的 composer/header 触发 root scope 工作台。 */
    function requestWorkbenchOpen(step, sessionId, task = null) {
      if (typeof document !== 'undefined'
        && typeof document.createEvent === 'function'
        && typeof document.dispatchEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_OPEN_EVENT, false, true, { step, sessionId, task });
        if (!document.dispatchEvent(event)) return;
      }
      if (rootWorkbenchActions) openWorkbench(rootWorkbenchActions, step, sessionId);
    }

    /** 把提示词生成器解析出的完整表格交给 root 工作台，不把整表塞进模型上下文。 */
    function requestWorkbenchDataset(result, sessionId, source) {
      if (typeof document !== 'undefined'
        && typeof document.createEvent === 'function'
        && typeof document.dispatchEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(WORKBENCH_DATASET_EVENT, false, true, { result, sessionId, source });
        if (!document.dispatchEvent(event)) return;
      }
      if (rootWorkbenchActions) {
        applyParsed(result, rootWorkbenchActions, `session:${sessionId || 'unassigned'}`, source);
        rootWorkbenchActions.setActiveSession(sessionId);
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
      if (rootWorkbenchActions) {
        rootWorkbenchActions.setTaskTitle(draft.title);
        rootWorkbenchActions.setObjectives(draft.objectives);
        rootWorkbenchActions.setFieldSelection(draft.fieldSelection);
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

    const WORKFLOW_STATE_LABELS = {
      draft: '待上传', uploaded: '待确认规则', rules_confirmed: '规则已确认', diagnosed: '体检完成',
      matching: '匹配中', review_required: '待人工核验', matched: '匹配完成', enriching: '补全中',
      export_ready: '可下载', completed: '已完成', partial: '部分完成', failed: '失败',
      authorization_required: '待连接企查查', cancelled: '已取消', parse_failed: '解析失败',
    };

    function ProductHome(props = {}) {
      const { sessionId } = props;
      const [recentTasks, setRecentTasks] = react.useState([]);
      const flow = [
        ['01', '任务设置', '提示词向导明确目标'],
        ['02', '上传数据', '文本、Excel、JSON 或图片'],
        ['03', '规则确认', '字段映射与匹配主键'],
        ['04', '质量体检', '缺失、重复与格式诊断'],
        ['05', '数据匹配', '精确优先，多候选复核'],
        ['06', '清洗补全', '按需选择当前企业字段'],
        ['07', '下载数据', '保留原值、依据与状态'],
      ];
      react.useEffect(() => {
        let disposed = false;
        requestJson('/data-cleaning/api/workflow/tasks').then((response) => {
          if (!disposed) setRecentTasks((response.tasks || []).slice(0, 3));
        }).catch(() => {});
        return () => { disposed = true; };
      }, [sessionId]);
      return h('section', { className: 'dcAgentProductHome', 'aria-label': '数据清洗补全产品介绍' },
        h('div', { className: 'dcAgentHomeHero' },
          h('div', null,
            h('span', { className: 'dcAgentHomeEyebrow' }, '企业主数据治理工作台'),
            h('h2', null, '把企业名单变成可核验、可回写的标准数据'),
            h('p', null, '面向销售线索、客户尽调、供应商管理与 CRM / ERP 数据治理，先确认任务和规则，再按需使用当前用户连接的企查查 MCP。'),
          ),
          h('button', { type: 'button', className: 'dcAgentButton is-primary', onClick: () => requestWorkbenchOpen('upload', sessionId) }, '开始新任务'),
        ),
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
        h('div', { className: 'dcAgentHomeActions' },
          h('button', { type: 'button', onClick: () => requestWorkbenchOpen('profile', sessionId) }, '🩺 查看质量体检'),
          h('button', { type: 'button', onClick: () => requestWorkbenchOpen('match', sessionId) }, '🔎 进入匹配核验'),
          h('button', { type: 'button', onClick: () => requestWorkbenchOpen('history', sessionId) }, '◷ 查看任务历史'),
        ),
        recentTasks.length ? h('div', { className: 'dcAgentHomeRecent', 'aria-label': '最近任务' },
          h('b', null, '最近任务'),
          recentTasks.map((task) => h('button', {
            key: task.id,
            type: 'button',
            onClick: () => requestWorkbenchOpen(task.stage || 'upload', sessionId, task),
          },
            h('span', null, task.title || '未命名任务'),
            h('small', null, WORKFLOW_STATE_LABELS[task.state] || task.state),
          )),
        ) : null,
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
        h(CapabilityBar, { sessionId }),
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

    function PromptGenerator(props) {
      const { sessionId, inputActions, attachImages } = props;
      const enabled = useCleaningSession(sessionId);
      const [open, setOpen] = react.useState(false);
      const [wizardStep, setWizardStep] = react.useState(1);
      const [mode, setMode] = react.useState('text');
      const [rawText, setRawText] = react.useState('');
      const [entries, setEntries] = react.useState([]);
      const [entryCount, setEntryCount] = react.useState(0);
      const [spreadsheetFileName, setSpreadsheetFileName] = react.useState('');
      const [imageFileName, setImageFileName] = react.useState('');
      const [imageAttached, setImageAttached] = react.useState(false);
      const [cleaningKeys, setCleaningKeys] = react.useState(DEFAULT_CLEANING_KEYS);
      const [enrichmentKeys, setEnrichmentKeys] = react.useState(DEFAULT_ENRICHMENT_KEYS);
      const [anchorKeys, setAnchorKeys] = react.useState(['company_name', 'credit_no']);
      const [matchRules, setPromptMatchRules] = react.useState({
        normalizeNames: true,
        preferCreditNo: true,
        deduplicate: true,
        manualReviewAmbiguous: true,
      });
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
            requestWorkbenchDataset(result, sessionId, {
              type: result.fmt || 'xlsx', fileName: file.name, sizeBytes: file.size || 0,
            });
          }
        } catch (fileError) {
          setError(fileError instanceof Error ? fileError.message : String(fileError));
        } finally {
          setBusy(false);
          if (event.target) event.target.value = '';
        }
      };
      const selectedEntries = () => mode === 'text'
        ? rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : entries;
      const validateSource = () => {
        const values = selectedEntries();
        if (mode === 'text' && !values.length) return '请先录入企业名称或统一社会信用代码，每行一条。';
        if (mode === 'excel' && !values.length) return '请先上传并解析 Excel / CSV / JSON 文件。';
        if (mode === 'image' && !imageAttached) return '请先选择并附加一张包含企业名单的图片。';
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
      });
      const generatePrompt = () => {
        const sourceError = validateSource();
        if (sourceError) { setError(sourceError); return; }
        if (!anchorKeys.length) { setError('请至少选择一个企业主体匹配主键。'); return; }
        if (!cleaningKeys.length) { setError('请至少选择一个清洗或补全目标。'); return; }
        if (!inputActions || typeof inputActions.setDraft !== 'function') {
          setError('当前会话输入机尚未就绪，请稍后重试。');
          return;
        }
        const config = promptConfig();
        inputActions.setDraft(buildTaskPrompt(config));
        if (mode === 'text') {
          requestWorkbenchDataset(entriesToDataset(config.entries), sessionId, { type: 'text', fileName: '' });
        }
        requestWorkbenchDraft({
          title: `企业数据清洗补全任务 · ${config.entryCount || '待解析'} 条`,
          objectives: cleaningKeys,
          fieldSelection: enrichmentKeys,
          matchRules,
          source: { type: mode === 'excel' ? 'xlsx' : mode, fileName: config.fileName || '', rowCount: config.entryCount || 0 },
        }, sessionId);
        setError(null);
        setOpen(false);
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
          ) : null,
          wizardStep === 2 ? h('div', { className: 'dcAgentWizardPane' },
            h('h4', null, '确认匹配规则'),
            h('p', null, '强标识优先；名称定位不明确时生成候选，不自动写回。'),
            h('div', { className: 'dcAgentPromptChoices' }, choice(MATCH_ANCHOR_OPTIONS, anchorKeys, setAnchorKeys)),
            h('div', { className: 'dcAgentPromptRules' },
              [['normalizeNames', '匹配前统一企业名称格式'], ['preferCreditNo', '有信用代码时优先精确匹配'], ['deduplicate', '匹配前合并重复主体'], ['manualReviewAmbiguous', '多候选必须人工确认']].map(([key, label]) => h('label', { key },
                h('input', { type: 'checkbox', checked: matchRules[key], onChange: (event) => setPromptMatchRules({ ...matchRules, [key]: event.target.checked }) }), label,
              )),
            ),
          ) : null,
          wizardStep === 3 ? h('div', { className: 'dcAgentWizardPane' },
            h('h4', null, '选择清洗目标和补全字段'),
            h('p', null, '仅展示当前企业数据范围；最终可用字段以当前用户连接能力为准。'),
            h('div', { className: 'dcAgentPromptGroup' },
              h('b', null, '清洗目标'),
              h('div', { className: 'dcAgentPromptChoices' }, choice(CLEANING_OPTIONS, cleaningKeys, setCleaningKeys)),
            ),
            FIELD_GROUPS.map(([groupId, label, fields]) => h('div', { className: 'dcAgentPromptGroup', key: groupId },
              h('b', null, label),
              h('div', { className: 'dcAgentPromptChoices' }, choice(fields, enrichmentKeys, setEnrichmentKeys)),
            )),
          ) : null,
          wizardStep === 4 ? h('div', { className: 'dcAgentWizardPane' },
            h('h4', null, '确认任务描述'),
            h('p', null, '回填后仍可在对话框继续编辑；回填本身不会调用企查查 MCP。'),
            h('pre', { className: 'dcAgentPromptPreview' }, buildTaskPrompt(promptConfig())),
          ) : null,
          h('p', { className: 'dcAgentPromptNote' }, '向导只生成任务描述并保存任务设置。只有你在任务中明确确认后，才会使用当前客户自己的企查查 MCP 连接、账号和额度。'),
          error ? h('p', { className: 'dcAgentPromptError', role: 'alert' }, error) : null,
          h('div', { className: 'dcAgentPromptActions' },
            h('button', { type: 'button', className: 'dcAgentPromptAction', disabled: wizardStep === 1, onClick: () => setWizardStep(Math.max(1, wizardStep - 1)) }, '上一步'),
            h('button', { type: 'button', className: 'dcAgentPromptAction is-primary', disabled: busy, onClick: nextWizard }, busy ? '处理中…' : wizardStep === 4 ? '回填到对话框' : '下一步'),
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
      return api('/data-cleaning/api/mvp/parse', { filename: 'data.csv', content: trimmed });
    }

    /** 解析成功进入 taskId runtime；不把整表写入 Host store。 */
    function applyParsed(result, actions, taskId = 'unassigned', source = {}) {
      const runtime = runtimeFor(taskId);
      runtime.rows = Array.isArray(result.rows) ? result.rows : [];
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
      actions.setDataset({
        fmt: result.fmt ?? 'csv',
        headers: runtime.headers,
        rowCount: typeof result.rowCount === 'number' ? result.rowCount : runtime.rows.length,
        preview: Array.isArray(result.preview) ? result.preview : runtime.rows.slice(0, 5),
      });
      return runtime;
    }

    async function persistParsedWorkflow(actions, sessionId, result, source = {}, task) {
      let current = task ?? await ensureWorkflowTask(actions, sessionId);
      const stagingKey = `session:${sessionId || 'unassigned'}`;
      moveRuntime(stagingKey, current.id);
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
      return current;
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
          if (detail.task?.id) {
            workflowTaskBySession.set(String(detail.sessionId || 'unassigned'), detail.task);
            actions.setWorkflowTask(detail.task);
            actions.setTaskTitle(detail.task.title);
            actions.setMappings(detail.task.mappings || []);
            actions.setObjectives(detail.task.objectives || []);
            actions.setFieldSelection(detail.task.fieldSelection || []);
            for (const [key, value] of Object.entries(detail.task.matchRules || {})) actions.setMatchRule(key, value);
          }
          openWorkbench(actions, detail.step ?? null, detail.sessionId ?? null);
        };
        const handleDataset = (event) => {
          event?.preventDefault?.();
          const detail = event?.detail ?? {};
          if (detail.result) applyParsed(detail.result, actions, `session:${detail.sessionId || 'unassigned'}`, detail.source);
          if (detail.sessionId) actions.setActiveSession(detail.sessionId);
          if (detail.result) {
            void queueWorkflowOperation(detail.sessionId, () => (
              persistParsedWorkflow(actions, detail.sessionId, detail.result, detail.source)
            )).catch((eventError) => {
              actions.setError(eventError instanceof Error ? eventError.message : String(eventError));
            });
          }
        };
        const handleDraft = (event) => {
          event?.preventDefault?.();
          const detail = event?.detail ?? {};
          const draft = detail.draft ?? {};
          if (detail.sessionId) actions.setActiveSession(detail.sessionId);
          if (draft.title) actions.setTaskTitle(draft.title);
          if (draft.objectives) actions.setObjectives(draft.objectives);
          if (draft.fieldSelection) actions.setFieldSelection(draft.fieldSelection);
          for (const [key, value] of Object.entries(draft.matchRules || {})) actions.setMatchRule(key, value);
          void queueWorkflowOperation(detail.sessionId, async () => {
            const task = await ensureWorkflowTask(actions, detail.sessionId, draft);
            return updateWorkflowTask(actions, detail.sessionId, task, draft);
          }).catch((eventError) => actions.setError(eventError instanceof Error ? eventError.message : String(eventError)));
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener(WORKBENCH_OPEN_EVENT, handleOpen);
          document.addEventListener(WORKBENCH_DATASET_EVENT, handleDataset);
          document.addEventListener(WORKBENCH_DRAFT_EVENT, handleDraft);
        }
        return () => {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener(WORKBENCH_OPEN_EVENT, handleOpen);
            document.removeEventListener(WORKBENCH_DATASET_EVENT, handleDataset);
            document.removeEventListener(WORKBENCH_DRAFT_EVENT, handleDraft);
          }
          stopJobsPolling();
          if (rootWorkbenchActions === actions) rootWorkbenchActions = null;
        };
      }, [actions]);

      react.useEffect(() => {
        if (!open) return undefined;
        let disposed = false;
        requestJson('/data-cleaning/api/workflow/contract').then((response) => {
          if (!disposed) actions.setWorkflowContract(response.contract);
        }).catch(() => {});
        loadWorkflowTasks(actions);
        if (activeSessionId && !workflowTaskBySession.has(String(activeSessionId))) {
          queueWorkflowOperation(activeSessionId, () => ensureWorkflowTask(actions, activeSessionId)).catch((taskError) => {
            if (!disposed) actions.setError(taskError instanceof Error ? taskError.message : String(taskError));
          });
        }
        return () => { disposed = true; };
      }, [open, activeSessionId, actions]);

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
      const cachedTask = workflowTaskBySession.get(String(activeSessionId || 'unassigned')) ?? workflowTask;
      const runtimeKey = cachedTask?.id ?? `session:${activeSessionId || 'unassigned'}`;
      const runtime = runtimeFor(runtimeKey);
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
        actions.setBusy(true);
        actions.setError(null);
        try {
          const result = await parseText(input, actions);
          if (result) {
            applyParsed(result, actions, runtimeKey, { type: result.fmt || 'csv' });
            await persistParsedWorkflow(actions, activeSessionId, result, { type: result.fmt || 'csv' }, cachedTask);
          }
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
          if (result && result.ok !== false) {
            applyParsed(result, actions, runtimeKey, { type: result.fmt || 'csv', fileName: file.name, sizeBytes: file.size || 0 });
            await persistParsedWorkflow(actions, activeSessionId, result, { type: result.fmt || 'csv', fileName: file.name, sizeBytes: file.size || 0 }, cachedTask);
          }
          else actions.setError((result && (result.message || result.error)) || '解析失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
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
          actions.setStep('match');
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

      const loadQccCapabilities = async () => {
        if (busy) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          const r = await api('/data-cleaning/api/g5/capabilities');
          if (r && r.ok !== false) actions.setQccCapabilities(r);
          else actions.setError((r && (r.message || r.error)) || '企查查能力检测失败');
        } catch (err) {
          actions.setError(err instanceof Error ? err.message : String(err));
        } finally {
          actions.setBusy(false);
        }
      };

      const estimateQcc = async () => {
        const uniqueCompanies = new Set(runtime.rows.map((row) => String(row?.[nameField] ?? '').trim()).filter(Boolean)).size;
        actions.setQccEstimate({
          uniqueCompanies,
          tools: ['主体查询', '工商信息'],
          estimatedCalls: uniqueCompanies * 2,
          maxCalls: 200,
          withinLimit: runtime.rows.length <= 100,
          estimateType: 'upper-bound',
        });
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
        // partial 表示上一轮仍有失败项。重试成功后可直接重进 enrichment，
        // 无需伪造一次新的 match 转换；若重试产生候选，再回到人工核验。
        if (currentTask?.state !== 'partial' || reviewRequired > 0) {
          current = await workflowAction(actions, activeSessionId, currentTask, 'match', {
            qccRunId: run.runId,
            summary: {
              total: Number(summary.totalRows ?? runtime.rows.length),
              exact: Number(summary.enriched ?? 0),
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
            reviewRequired: 0,
            callsUsed: Array.isArray(run.audit) ? run.audit.length : 0,
          },
        });
        actions.setStep(current.stage === 'download' ? 'download' : 'enrich');
        return current;
      };

      const runQcc = async () => {
        if (busy || !qccEstimate || !paidConfirmed || !qccEstimate.withinLimit) return;
        actions.setBusy(true);
        actions.setError(null);
        try {
          await workflowAction(actions, activeSessionId, cachedTask, 'match-start');
          const key = `g5-ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const r = await api('/data-cleaning/api/g5/enrich', {
            rows: runtime.rows,
            headers: runtime.headers,
            nameField,
            includeRisk: false,
            concurrency: 2,
            confirmPaidCalls: true,
            idempotencyKey: key,
          });
          if (r && r.ok !== false) await applyQccRun(r);
          else actions.setError((r && (r.message || r.error)) || '企业匹配补全失败');
        } catch (err) {
          if (['QCC_NOT_CONNECTED', 'QCC_TOOL_UNAVAILABLE', 'QCC_AUTH_REQUIRED'].includes(err?.code)) {
            try { await workflowAction(actions, activeSessionId, cachedTask, 'authorization-required'); } catch (_workflowError) {}
          }
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
          const r = await api('/data-cleaning/api/g5/resolve', {
            runId: qccRun.runId,
            companyName: item.companyName,
            selectedCreditNo: candidate.creditNo,
            confirmPaidCalls: true,
            idempotencyKey: `g5-resolve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          });
          if (r && r.ok !== false) await applyQccRun(r);
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
          const r = await api('/data-cleaning/api/g5/retry', {
            runId: qccRun.runId,
            companyNames: names,
            confirmPaidCalls: true,
            idempotencyKey: `g5-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          });
          if (r && r.ok !== false) await applyQccRun(r);
          else actions.setError((r && (r.message || r.error)) || '失败项重试失败');
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

      const resumeWorkflowTask = (task) => {
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
        if (cachedTask?.id) runtimeTasks.delete(String(cachedTask.id));
        runtimeTasks.delete('unassigned');
        workflowTaskBySession.delete(String(activeSessionId || 'unassigned'));
        actions.resetWorkflow();
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

      const stat = (label, value, tone) => h('div', { className: 'dcAgentCard' },
        h('span', null, label),
        h('b', { className: tone ? `is-${tone}` : null }, value)
      );
      const uiFieldGroups = Array.isArray(workflowContract?.fieldCatalog)
        ? workflowContract.fieldCatalog.map((group) => [group.id, group.label, (group.fields || []).map((field) => [field.id, field.label])])
        : FIELD_GROUPS;
      const targetFields = uiFieldGroups.flatMap(([, , fields]) => fields);

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
              h('h3', null, task.title || task.id || '数据清洗任务'),
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
            (dataset?.headers || []).map((sourceField) => h('label', { className: 'dcAgentMappingRow', key: sourceField },
              h('span', { title: sourceField }, sourceField),
              h('b', { 'aria-hidden': 'true' }, '→'),
              h('select', {
                className: 'dcAgentField',
                value: mappings.find((mapping) => mapping.sourceField === sourceField)?.targetField || '',
                'aria-label': `${sourceField} 字段映射`,
                onChange: (event) => actions.setMapping(sourceField, event.target.value),
              },
                h('option', { value: '' }, '不参与匹配 / 补全'),
                targetFields.map(([id, label]) => h('option', { key: id, value: id }, label)),
              ),
            )),
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
            h('h3', null, `输出字段 · 已选 ${fieldSelection.length}`),
            uiFieldGroups.map(([groupId, label, fields]) => h('div', { key: groupId, className: 'dcAgentFieldGroup' },
              h('b', null, label),
              h('div', { className: 'dcAgentChips' }, fields.map(([key, fieldLabel]) => h('label', { key, className: `dcAgentChip${fieldSelection.includes(key) ? ' is-selected' : ''}` },
                h('input', { type: 'checkbox', checked: fieldSelection.includes(key), onChange: () => actions.toggleField(key) }), ` ${fieldLabel}`,
              ))),
            )),
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
              h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy, onClick: () => actions.setStep('match') }, '下一步：匹配核验'),
            ),
          ) : h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !hasData, 'aria-label': '生成体检报告', onClick: runProfile }, busy ? '体检中…' : '生成体检报告'),
          ),
        );
      } else if (step === 'match') {
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '通过当前用户连接的企查查 MCP 定位企业主体并补全基础工商字段。多候选始终由人工选择；界面不生成虚构置信度。'),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '匹配依据'),
            h('div', { className: 'dcAgentChips' }, mappings.filter((mapping) => ['company_name', 'credit_no', 'reg_no'].includes(mapping.targetField)).map((mapping) => h('span', { key: mapping.sourceField, className: 'dcAgentChip' }, `${mapping.sourceField} → ${ENRICHMENT_OPTIONS.find(([id]) => id === mapping.targetField)?.[1] || mapping.targetField}`))),
            h('p', { className: 'dcAgentHint' }, '统一社会信用代码等强标识优先；名称匹配不明确时进入人工核验队列。'),
          ),
          h('section', { className: 'dcAgentSection' },
            h('h3', null, '企查查基础企业能力'),
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy, onClick: loadQccCapabilities }, busy ? '检测中…' : '检测企查查连接'),
              qccCapabilities ? h('span', { className: 'dcAgentHint' }, qccCapabilities.capabilities?.ready ? '主体查询与工商信息工具已就绪' : '连接未就绪或基础工具不完整') : null,
            ),
            h('div', { className: 'dcAgentRow' },
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !runtime.rows.length, onClick: estimateQcc }, '估算调用量'),
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
                '我已核对企业数量和调用上界，并确认使用自己连接的企查查 MCP 账号；额度或费用由该账号自行承担',
              ),
              h('div', { className: 'dcAgentRow' },
                h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy || !paidConfirmed || !qccEstimate.withinLimit, onClick: runQcc }, busy ? '执行中…' : '开始主体匹配'),
              ),
            ) : null,
          ),
          qccRun ? h('section', { className: 'dcAgentSection' },
            h('h3', null, `任务 ${qccRun.runId} · ${qccRun.state}`),
            h('div', { className: 'dcAgentGrid' },
              stat('已补全', qccRun.summary?.enriched ?? 0, 'good'),
              stat('待核验', qccRun.summary?.ambiguous ?? 0, (qccRun.summary?.ambiguous ?? 0) > 0 ? 'warn' : null),
              stat('未匹配', qccRun.summary?.unresolved ?? 0, (qccRun.summary?.unresolved ?? 0) > 0 ? 'warn' : null),
              stat('失败', qccRun.summary?.failed ?? 0, (qccRun.summary?.failed ?? 0) > 0 ? 'bad' : null),
            ),
            Array.isArray(qccRun.rows) && qccRun.rows.length ? h('div', { className: 'dcAgentTableWrap' },
              h('table', { className: 'dcAgentTable', 'aria-label': '匹配补全结果预览' },
                h('thead', null, h('tr', null,
                  Object.keys(qccRun.rows[0] || {}).slice(0, 6).map((key) => h('th', { key }, key)),
                )),
                h('tbody', null, qccRun.rows.slice(0, 8).map((row, index) => h('tr', { key: `${index}-${row?.qcc_credit_no || row?.credit_no || ''}` },
                  Object.keys(qccRun.rows[0] || {}).slice(0, 6).map((key) => h('td', { key }, String(row?.[key] ?? ''))),
                ))),
              ),
              h('p', { className: 'dcAgentHint' }, `显示前 ${Math.min(8, qccRun.rows.length)} 行；完整结果在下载阶段生成耐久制品。`),
            ) : null,
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
            h('div', { className: 'dcAgentChips' }, fieldSelection.map((id) => h('span', { className: 'dcAgentChip', key: id }, ENRICHMENT_OPTIONS.find(([fieldId]) => fieldId === id)?.[1] || id))),
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
            stat('QCC 已补全', qccRun ? qccRun.summary?.enriched ?? 0 : '—', qccRun && qccRun.summary?.enriched > 0 ? 'good' : null),
            stat('待核验', qccRun ? qccRun.summary?.ambiguous ?? 0 : '—', qccRun && qccRun.summary?.ambiguous > 0 ? 'warn' : null),
          ),
          h('div', { className: 'dcAgentRow' }, h('button', { type: 'button', className: 'dcAgentButton is-primary', onClick: () => actions.setStep('download') }, '进入下载数据')),
        );
      } else if (step === 'download') {
        const availableArtifacts = cachedTask?.artifacts || [];
        const canCreateArtifacts = Boolean(exportRows()?.length) && ['rules_confirmed', 'diagnosed', 'export_ready', 'partial'].includes(cachedTask?.state);
        pane = h('div', { className: 'dcAgentPane' },
          h('p', { className: 'dcAgentHint' }, '结果与异常清单由 Host 生成 CSV/XLSX 四件套并耐久保存。任务或插件重启后，可从任务历史继续下载；无需再次调用企查查。'),
          h('div', { className: 'dcAgentGrid' },
            stat('输入行数', dataset ? dataset.rowCount : workflowTask?.source?.rowCount ?? '—'),
            stat('匹配补全', qccRun ? qccRun.summary?.enriched ?? 0 : '—', qccRun && qccRun.summary?.enriched > 0 ? 'good' : null),
            stat('待核验', qccRun ? qccRun.summary?.ambiguous ?? 0 : '—', qccRun && qccRun.summary?.ambiguous > 0 ? 'warn' : null),
            stat('任务状态', WORKFLOW_STATE_LABELS[cachedTask?.state] || cachedTask?.state || '进行中'),
          ),
          availableArtifacts.length ? h('div', { className: 'dcAgentArtifactList' },
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
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !canCreateArtifacts, onClick: () => createAndDownload('review', 'xlsx') }, '生成并下载异常清单 XLSX'),
              h('button', { type: 'button', className: 'dcAgentButton', disabled: busy || !canCreateArtifacts, onClick: () => createAndDownload('review', 'csv') }, '生成并下载异常清单 CSV'),
            ),
            !canCreateArtifacts ? h('p', { className: 'dcAgentHint' }, '请先完成规则确认与清洗补全；历史任务若尚未生成制品，需要重新上传源文件。') : null,
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
          dataset ? h('div', { className: 'dcAgentPreviewTable', 'aria-label': '数据预览' },
            h('table', { className: 'dcAgentTable' },
              h('thead', null, h('tr', null, (dataset.headers || []).slice(0, 8).map((name) => h('th', { key: name }, name)))),
              h('tbody', null, (dataset.preview || []).slice(0, 5).map((row, index) => h('tr', { key: index }, (dataset.headers || []).slice(0, 8).map((name) => h('td', { key: name }, String(row?.[name] ?? '')))))),
            ),
          ) : null,
          h('div', { className: 'dcAgentRow' },
            h('button', { type: 'button', className: 'dcAgentButton is-primary', disabled: busy, 'aria-label': '解析数据', onClick: handleParse }, busy ? '解析中…' : '解析数据'),
            hasData ? h('button', { type: 'button', className: 'dcAgentButton', onClick: () => actions.setStep('rules') }, '下一步：字段映射与规则') : null,
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
                h('small', null, cachedTask ? `${WORKFLOW_STATE_LABELS[cachedTask.state] || cachedTask.state} · ${cachedTask.id.slice(0, 18)}` : '正在创建 Host taskId…'),
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
    exports.__testing = {
      buildTaskPrompt,
      entriesToDataset,
      extractPromptEntries,
      guessMappings,
      markCleaningSession,
      qualitySummaryFor,
      ensureWorkflowTask,
      queueWorkflowOperation,
    };
    return module.exports;
  },
});

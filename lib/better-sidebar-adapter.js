/** Public Better Sidebar seam. No business task creation, cancellation or geometry. */
export const CLEANING_TAB_ID = 'dsh-data-cleaning-agent:workbench';
export const SIDEBAR_DEPENDENCY_MESSAGE = '请安装或升级兼容的 dsh-better-sidebar 并重启 DSH（需要 targetedOpen 和 stateSubscription 能力），然后重新点击流程按钮。现有任务和文件不会删除。';

export function sidebarCompatibility(service) {
  const methods = ['registerTab', 'openTab', 'isTabEnabled', 'getSnapshot', 'subscribeState'];
  return Boolean(service && methods.every(key => typeof service[key] === 'function')
    && ['targetedOpen', 'stateSubscription'].every(key => service.features?.includes(key)));
}

function contains(node, id) {
  if (!node) return false;
  return node.kind === 'leaf' ? node.tabs.some(tab => tab.id === id)
    : node.children.some(child => contains(child, id));
}

export function revealCleaningTab(state, id) {
  if (state.floats?.some(item => item.tab.id === id)) return state;
  if (contains(state.bottomSplits, id)) return state.bottomOpen ? state : { ...state, bottomOpen: true };
  if (contains(state.splits, id)) return state.panelOpen ? state : { ...state, panelOpen: true };
  return state;
}

/** One adapter per plugin activation. Session navigation survives closing its Tab. */
export function createCleaningSidebarAdapter(service, { component, icon, onUnavailable = () => {} }) {
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

/**
 * Client 半区（Spike #2 已实测的 Host↔Client 契约）：
 * 通过 `window.__ModuleLoader__.load({id, factory})` 注册为惰性 CJS 工厂。
 * materialize 后 `apply(ctx)` 拉取 host seam 并把结果放到 `window.__DC_MVP__`，
 * 证明 client bundle 被扫描进 `__DSH_BOOT__` 并真实执行。
 */
window.__ModuleLoader__.load({
  id: 'dsh-data-cleaning-agent',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const inject = [];

    function apply(ctx) {
      // eslint-disable-next-line no-console
      console.log('[dc-agent] client apply() ran');
      const state = { applied: true, seam: null, error: null };
      window.__DC_MVP__ = state;

      fetch('/data-cleaning/api/mvp/seam')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`seam HTTP ${r.status}`))))
        .then((data) => {
          state.seam = data;
          console.log('[dc-agent] client seam fetched:', data?.marker);
        })
        .catch((error) => {
          state.error = error instanceof Error ? error.message : String(error);
          console.warn('[dc-agent] client seam fetch failed:', state.error);
        });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

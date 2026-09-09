import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCleaningSidebarAdapter, CLEANING_TAB_ID, revealCleaningTab } from '../lib/better-sidebar-adapter.js';

function fixture() {
  let listener, descriptor, current = 's1', count = 0, registered = true;
  const tabs = new Map();
  const service = {
    features: ['targetedOpen', 'stateSubscription'],
    registerTab(value) { descriptor = value; return () => { registered = false; }; },
    isTabEnabled: () => true,
    getSnapshot: () => ({ sessionId: current }),
    subscribeState(fn) { listener = fn; return () => { listener = null; }; },
    openTab(seed, scope) { tabs.set(scope.sessionId, seed.type); count++; },
  };
  const adapter = createCleaningSidebarAdapter(service, { component: () => null });
  let state = { splits: {kind:'leaf',tabs:[{id:CLEANING_TAB_ID}]}, bottomSplits:{kind:'leaf',tabs:[]}, floats:[], panelOpen:false, bottomOpen:false };
  let view;
  const target = {tabId:CLEANING_TAB_ID, navigate(value) {view=value;}, store:{reduce(fn){state=fn(state);}}};
  return {adapter, service, target, tabs, get descriptor(){return descriptor;}, get state(){return state;},get view(){return view;},get registered(){return registered;},get subscribed(){return !!listener;},get count(){return count;},switch(id){current=id;listener?.();}};
}
test('singleton registration, five idempotent destinations and no task operations', () => {
  const f=fixture(); f.adapter.attach({sessionId:'s1'},f.target);
  assert.equal(f.descriptor.single,true);
  for(const view of ['upload','rules','match','enrich','history']) {
    f.adapter.open({sessionId:'s1',cwd:'/workspace'},view);
    f.adapter.open({sessionId:'s1',cwd:'/workspace'},view);
    assert.equal(f.view,view); assert.equal(f.tabs.size,1);
  }
  assert.equal(f.state.panelOpen,true);
});
test('inactive Session reveal waits; no geometry changes in current Session', () => {
  const f=fixture(); f.adapter.attach({sessionId:'s2'},f.target);
  f.adapter.open({sessionId:'s2'},'history'); assert.equal(f.state.panelOpen,false);
  f.switch('s2'); assert.equal(f.view,'history'); assert.equal(f.state.panelOpen,true);
});
test('host collapse and tab detach retain navigation; reopen restores', () => {
  const f=fixture(); const detach=f.adapter.attach({sessionId:'s1'},f.target);
  f.adapter.open({sessionId:'s1'},'match');
  detach(); f.adapter.attach({sessionId:'s1'},f.target);
  assert.equal(f.view,'match');
  f.target.navigate('enrich'); // internal progress, not an entry request
  detach(); f.adapter.attach({sessionId:'s1'},f.target);
  assert.equal(f.view,'enrich', 'Host reopen cannot rewind internal navigation');
});
test('unload disposes descriptor, subscription and pending reveal', () => {
  const f=fixture(); f.adapter.open({sessionId:'s2'},'history'); f.adapter.dispose(); f.adapter.dispose();
  assert.equal(f.registered,false); assert.equal(f.subscribed,false);
  assert.equal(f.adapter.open({sessionId:'s1'}),false);
});
test('missing provider gives actionable fallback without private drawer', () => {
  let message; const adapter=createCleaningSidebarAdapter(null,{component:()=>null,onUnavailable:m=>message=m});
  assert.equal(adapter.open({sessionId:'s1'}),false); assert.match(message,/安装或升级/);
});
test('reveal respects bottom docking and floating geometry', () => {
  const f=fixture(); const s={...f.state, splits:{kind:'leaf',tabs:[]},bottomSplits:{kind:'leaf',tabs:[{id:CLEANING_TAB_ID}]}};
  assert.equal(revealCleaningTab(s,CLEANING_TAB_ID).bottomOpen,true);
  const floating={...s,floats:[{tab:{id:CLEANING_TAB_ID}}]};
  assert.equal(revealCleaningTab(floating,CLEANING_TAB_ID),floating);
});

test('client embeds exact tested adapter and has no private workbench geometry', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url),'utf8');
  const adapter = readFileSync(new URL('../lib/better-sidebar-adapter.js', import.meta.url),'utf8');
  const expected = adapter.replace(/^export /gm,'').split('\n').map(line=>line ? '    '+line : '').join('\n');
  assert.ok(client.includes(expected), 'ModuleLoader must execute the tested adapter');
  assert.doesNotMatch(client,/shell\.overlay|dcAgentOverlay|dcAgentResizeHandle|preferredWidth|toggleExpanded|dc-agent-workbench-reserve|dc-agent-panel-width|dc-agent-workbench-shift/);
  assert.match(client,/installSessionWorkbench\(ctx\)/);
});

test('outdated provider and disabled Tab produce actionable messages', () => {
  const f=fixture(); let message;
  f.service.features=[];
  const old=createCleaningSidebarAdapter(f.service,{component:()=>null,onUnavailable:value=>message=value});
  assert.equal(old.open({sessionId:'s1'}),false); assert.match(message,/升级/);
  f.service.isTabEnabled=()=>false;
  assert.equal(f.adapter.open({sessionId:'s1'}),false);
  assert.equal(f.count,0);
});

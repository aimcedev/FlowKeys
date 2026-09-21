// Run: node test/flowTempoTransitions.node.mjs
import assert from 'node:assert/strict';
import { FlowTempoTransitions } from '../js/flow-rail/flowTempoTransitions.js?v=1';
function rig() {
  const calls = [];
  const mod = (id, active = false, tempo = true) => ({ instanceId: id, isTempoBased: tempo, isActive: active,
    toggle(on) { this.isActive = on; calls.push([id, on]); }, resetPhase() { calls.push([id, 'reset']); } });
  const a = mod('a'), b = mod('b'), pad = mod('pad', false, false);
  const app = { uiManager: { currentMode: 'flow' }, _getActiveSongMode: () => 'flow', pendingModuleActivations: [],
    moduleInstances: new Map([['a', a], ['b', b], ['pad', pad]]),
    engine: { physicalSustainDown: false, broadcastCurrentState() {}, clock: { isRunning: false,
      restartFromZero() { this.isRunning = true; calls.push(['clock', 'restart']); }, stop() { this.isRunning = false; calls.push(['clock', 'stop']); } } },
    _getModuleCard() {}, _getModuleEl() {} };
  const t = new FlowTempoTransitions(app);
  const pedal = down => { app.engine.physicalSustainDown = down; t.onStateChange({ sustainDown: down }); };
  const start = () => { t.request('a', true); pedal(true); pedal(false); };
  return { app, t, a, b, calls, pedal, start };
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS', name); }
test('Entry with pedal up waits for a full press/release and starts on beat one', () => {
  const {t,a,pedal,app,calls} = rig();t.request('a',true);
  assert.equal(t.status().state,'entry'); assert.equal(a.isActive,false);
  pedal(false); assert.equal(a.isActive,false);pedal(true); assert.equal(a.isActive,false);
  pedal(false);assert.equal(a.isActive,true);assert.equal(app.engine.clock.isRunning,true);
  assert.deepEqual(calls,[['a',true],['a','reset'],['clock','restart']]);assert.equal(t.status().state,'playing');
});
test('Entry while sustain is held commits on the upcoming release', () => {
  const {t,a,pedal}=rig();pedal(true);t.request('a',true);pedal(false);assert.equal(a.isActive,true);
});
test('Groove survives repeated source input and repeated sustain releases', () => {
  const {t,a,pedal,start,calls}=rig();start();const n=calls.length;
  for(let i=0;i<4;i++){t.request('a',true);pedal(true);pedal(false);}
  assert.equal(a.isActive,true);assert.equal(calls.length,n);
});
test('Exit stays audible until the next real release', () => {
  const {t,a,pedal,start,app}=rig();start();t.request('a',false);
  assert.equal(t.status().state,'exit');assert.equal(t.status().inGroove,true);pedal(false);assert.equal(a.isActive,true);
  pedal(true);pedal(false);assert.equal(a.isActive,false);assert.equal(app.engine.clock.isRunning,false);assert.equal(t.status().state,'free');
});
test('Reversing before entry or exit cancels the queued change', () => {
  const {t,a,pedal,start}=rig();t.request('a',true);t.request('a',false);pedal(true);pedal(false);assert.equal(a.isActive,false);
  start();t.request('a',false);t.request('a',true);pedal(true);pedal(false);assert.equal(a.isActive,true);assert.equal(t.pending.size,0);
});
test('Adding/removing sounds within a groove is bar aligned', () => {
  const {t,a,b,pedal,start,calls}=rig();start();t.request('b',true);pedal(true);pedal(false);assert.equal(b.isActive,false);
  assert.equal(t.status().state,'queued');t.onBar();assert.equal(b.isActive,true);
  t.request('a',false);assert.equal(a.isActive,true);t.onBar();assert.equal(a.isActive,false);assert.equal(b.isActive,true);
  assert.equal(calls.filter(c=>c[0]==='clock'&&c[1]==='restart').length,1);
});
test('Simultaneous off/on batch preserves clock phase without an exit', () => {
  const {t,a,b,start,calls}=rig();start();t.beginUpdate();t.request('a',false);t.request('b',true);t.endUpdate();
  assert.equal(t.wait,'bar');t.onBar();assert.equal(a.isActive,false);assert.equal(b.isActive,true);
  assert.equal(calls.filter(c=>c[0]==='clock').length,1);
});
test('Panic/lifecycle clear cannot reactivate an armed module', () => {
  const {t,a,pedal}=rig();t.request('a',true);pedal(true);t.clear();pedal(false);t.onBar();assert.equal(a.isActive,false);
});
test('Manual override/removal cancels pending changes', () => {
  const {t,a,pedal}=rig();t.request('a',true);t.cancelModule('a');pedal(true);pedal(false);assert.equal(a.isActive,false);
});
test('Non-tempo modules and other scene modes retain existing routing', () => {
  const {t,app}=rig();assert.equal(t.request('pad',true),false);
  app._getActiveSongMode=()=> 'sync';assert.equal(t.request('a',true),false);
  app._getActiveSongMode=()=> 'trigger';assert.equal(t.request('a',true),false);
  app._getActiveSongMode=()=> 'flow';app.uiManager.currentMode='edit';assert.equal(t.request('a',true),false);
});
test('Mapping feedback reports actual on/off while entry/exit are armed', () => {
  const {t,start}=rig(),m={target:{kind:'param',moduleId:'a',control:'toggle'}};
  t.request('a',true);assert.equal(t.mappingStatus(m).on,false);assert.equal(t.mappingStatus(m).pending,true);
  start();t.request('a',false);assert.equal(t.mappingStatus(m).on,true);assert.match(t.mappingStatus(m).timing,/Exit armed/);
});
console.log(`${passed}/${passed} passed`);

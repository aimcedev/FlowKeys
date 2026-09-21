/**
 * Manual browser regression checks. Run in an isolated browser with no MIDI ports:
 * const { runAll } = await import('/test/flowLandscape.js'); await runAll();
 * Uses temporary Flow fixtures and restores the view and controller afterward.
 */
import { buildDefaultFlowRail, cloneFlowRail, makePoint, sanitizeFlowRail } from '../js/flow-rail/flowRailState.js?v=3';
import { landscapeLayout, ribbonPoints, ribbonValue } from '../js/flow-rail/flowLandscapeGeometry.js?v=4';
import { FlowRailEngine } from '../js/flow-rail/flowRailEngine.js?v=6';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 320)); await frame(); };
const fixture = () => ({ id: 'flow-test', target: { kind: 'ccOut', channel: 1, cc: 11 }, curve: 'linear', points: [makePoint(0, 0), makePoint(127, 127)] });

export async function runAll() {
  const results = [];
  async function test(name, action) {
    try { await action(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
  }
  await test('New and explicitly empty setups have no checkpoints; saved names survive', () => {
    assert(buildDefaultFlowRail().checkpoints.length === 0, 'Default stages remain');
    assert(sanitizeFlowRail({ checkpoints: [] }).checkpoints.length === 0, 'Empty checkpoints replaced');
    const checkpoints = [{ id: 'old', cc: 68, name: 'BLOOM', kind: 'major' }, { id: 'blank', cc: 90, name: '', kind: 'major' }];
    assert(JSON.stringify(sanitizeFlowRail({ checkpoints }).checkpoints) === JSON.stringify(checkpoints), 'Saved checkpoints altered');
  });
  await test('Ribbon editing coordinates round-trip at minimum, midpoint, maximum', () => {
    const m = fixture();
    const lay = landscapeLayout(800, 500, [m]);
    const pts = ribbonPoints(m, lay, {});
    for (const cc of [0, 64, 127]) assert(Math.abs(ribbonValue(pts[cc].x, m, lay, {}) - cc) < 0.001, `Value mismatch at ${cc}`);
  });
  await test('Editing a point cannot move another mapping’s lane', () => {
    const a = fixture(), b = { ...fixture(), id: 'second' };
    const before = landscapeLayout(800, 500, [a, b]);
    a.points[0].cc = 70;
    const after = landscapeLayout(800, 500, [a, b]);
    assert(before.lanes.get(b.id).center === after.lanes.get(b.id).center, 'Lane shifted');
  });
  await test('Existing MIDI values and event crossings remain immediate and deduplicated', () => {
    const sent = [], events = [];
    const engine = new FlowRailEngine({ uiManager: { currentMode: 'flow' }, midi: { sendCC: (...args) => sent.push(args) }, midiActions: { handle: action => events.push(action) } });
    engine.load({ mappings: [fixture(), { id: 'event', target: { kind: 'event', action: 'nextSection' }, cc: 64 }] });
    for (const cc of [0, 64, 64, 127, 0]) engine.setCc(cc);
    assert(JSON.stringify(sent.map(item => item[2])) === '[0,64,127,0]', 'CC values or dedup changed');
    assert(events.length === 2, 'Forward/reverse crossings changed');
  });
  const app = window.app, c = app.flowRail;
  const presentation = c.view.presentation;
  const deckState = { expanded: new Set(c.view._expandedGroups), anchors: new Map(c.view._deckAnchors), remembered: new Map(c.view._rememberedCards), active: c.view._activeGroupId };
  const saved = { rail: cloneFlowRail(c.engine.rail), cc: c.engine.cc, configure: c.isConfigure, selected: c.selectedId, point: c.selectedPointId, persist: c.persist, sendCC: app.midi.sendCC };
  let writes = 0;
  c.persist = () => { writes++; };
  app.midi.sendCC = () => {};
  try {
    c.view.setPresentation('fan');
    c.engine.load({ mappings: [fixture()] });
    c.engine.setCc(64, { apply: false }); c.editor.refresh(); c.view.resize(); await settle();
    await test('Background and ribbon selection never change Flow position', async () => {
      const rect = c.view.canvas.getBoundingClientRect(), lay = c.view.layout();
      c.editor._onPointerDown({ clientX: rect.left + 2, clientY: rect.top + 2, button: 0 });
      assert(c.engine.cc === 64 && c.editor._drag === null, 'Background scrubbed');
      c.editor._onPointerDown({ clientX: rect.left + lay.lanes.get('flow-test').center, clientY: rect.top + c.view.ccToY(100), button: 0 });
      assert(c.engine.cc === 64 && c.selectedId === 'flow-test' && c.editor._drag === null, 'Selection scrubbed');
      await frame();
    });
    await test('Shape preserves selection and position; only selected handles are editable', async () => {
      c.setConfigure(true); await settle();
      const rect = c.view.canvas.getBoundingClientRect(), p = c.view.trajectoryPoints(c.engine.rail.mappings[0])[127];
      const hit = c.view.hitTest(rect.left + p.x, rect.top + p.y);
      assert(hit.type === 'handle', 'Selected handle cannot be hit');
      c.setConfigure(false);
      assert(c.engine.cc === 64 && c.selectedId === 'flow-test', 'Shape reset selection/CC');
      assert(c.view.hitTest(rect.left + p.x, rect.top + p.y).type !== 'handle', 'Performance exposes handles');
    });
    await test('Slider updates CC, endpoints remain visible, sound focus survives MIDI', async () => {
      c.view.setPresentation('fan');
      for (const cc of [0, 64, 127]) {
        c.view.slider.value = cc; c.view.slider.dispatchEvent(new Event('input')); await frame();
        assert(c.engine.cc === cc, 'Slider did not apply CC');
        assert(c.view.position.textContent === `${Math.round(cc / 127 * 100)}%`, 'Position display incorrect');
        const rect = c.view.position.getBoundingClientRect();
        assert(rect.top >= 0 && rect.bottom <= innerHeight, 'Position clipped');
      }
      const button = document.querySelector('.flow-sound'); button.focus();
      c.engine.setCc(32); await frame();
      assert(document.activeElement === button, 'MIDI update lost focus');
    });
    await test('Point edits persist without changing the Flow position', () => {
      c.setConfigure(true);
      const m = c.engine.rail.mappings[0], cc = c.engine.cc;
      c.editor._commitInspector(m.id, 'pointVal', '80', m.points[1].id);
      assert(m.points[1].value === 80 && writes > 0, 'Point not saved');
      assert(c.engine.cc === cc, 'Point edit moved Flow');
      assert(cloneFlowRail(c.engine.rail).mappings[0].points[1].value === 80, 'Point lost on serialization');
    });
    await test('Drawing is idle after rapid input settles', async () => {
      for (let i = 0; i < 512; i++) c.engine.setCc(i % 128, { apply: false });
      await settle();
      assert(c.view._rafId === null, 'Draw loop remains active');
    });
  } finally {
    c.persist = saved.persist; app.midi.sendCC = saved.sendCC;
    c.engine.load(saved.rail); c.engine.setCc(saved.cc, { apply: false });
    c.selectedId = saved.selected; c.selectedPointId = saved.point;
    c.view.setSelection(saved.selected); c.setConfigure(saved.configure); c.view.presentation = presentation;
    c.view._expandedGroups = deckState.expanded; c.view._deckAnchors = deckState.anchors;
    c.view._rememberedCards = deckState.remembered; c.view._activeGroupId = deckState.active;
    c.view._transition = null; c.view.requestDraw(); c.editor.refresh();
  }
  console.table(results);
  return results;
}

/**
 * Node.js runner for DynamicIntelligence tests.
 * Run: node test/dynIntel.node.mjs
 */

// performance.now() polyfill for older Node
import { performance } from 'perf_hooks';
if (!globalThis.performance) globalThis.performance = performance;

let DynamicIntelligence;
try {
  ({ DynamicIntelligence } = await import('../js/engine/dynamicIntelligence.js'));
} catch (e) {
  console.warn('DynamicIntelligence tests skipped: js/engine/dynamicIntelligence.js is not present in this app.');
  process.exit(0);
}

// ── helpers ───────────────────────────────────────────────────────────────────

let failures = 0;

function assert(label, cond, detail = '') {
  const mark = cond ? '✓' : '✗';
  const line = `  ${mark} ${label}${detail ? '  →  ' + detail : ''}`;
  if (cond) {
    console.log(line);
  } else {
    console.error(line);
    failures++;
  }
}

function feedNotes(di, { count, velocity, note = 60, intervalMs = 150 }, startNow) {
  let now = startNow;
  for (let i = 0; i < count; i++) {
    now += intervalMs;
    di.feed(velocity, now, note);
  }
  return now;
}

function advanceTicks(di, { totalMs, dtMs = 16 }, startNow) {
  let now = startNow;
  const midiHistory = [];
  for (let elapsed = 0; elapsed < totalMs; elapsed += dtMs) {
    now += dtMs;
    di.tick(now);
    midiHistory.push(di.getMidiValue());
  }
  return { now, midiHistory };
}

function section(name) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('─'.repeat(60));
}

// ── T1: Baseline convergence ───────────────────────────────────────────────────
section('T1: Baseline — hard playing converges to MIDI ~50 range');
{
  const di = new DynamicIntelligence();
  di.configure('driven', 'medium', 0, 127, false);
  let now = 0;
  di.tick(now);
  di.onPedalDown();
  for (let i = 0; i < 40; i++) {
    now += 150; di.feed(80, now, 60);
    now += 16;  di.tick(now);
  }
  const midi = di.getMidiValue();
  console.log(`  _emaLevel=${di._emaLevel.toFixed(3)}  _output=${di._output.toFixed(3)}  MIDI=${midi}`);
  assert('MIDI 40–65 after 40 hard notes (vel=80)', midi >= 40 && midi <= 65, `got ${midi}`);
  assert('_heldNoteCount ≥ 40', di._heldNoteCount >= 40, `got ${di._heldNoteCount}`);
}

// ── T2: Drop detection resets _heldRecent ─────────────────────────────────────
section('T2: Drop detection — _heldRecent resets on dramatic soft note');
{
  const di = new DynamicIntelligence();
  di.configure('driven', 'medium', 0, 127, false);
  let now = 0;
  di.tick(now);
  di.onPedalDown();
  now = feedNotes(di, { count: 30, velocity: 80 }, now);

  console.log(`  After 30 hard notes:`);
  console.log(`    _heldEma=${di._heldEma.toFixed(3)}`);
  console.log(`    _heldNoteCount=${di._heldNoteCount}`);
  console.log(`    _heldRecent=[${di._heldRecent.map(v => v.toFixed(3)).join(', ')}]`);

  assert('_heldRecent all > 0.55 (hard notes)', di._heldRecent.every(v => v > 0.55),
    `[${di._heldRecent.map(v=>v.toFixed(3)).join(', ')}]`);

  // One soft note
  now += 50;
  di.feed(20, now, 60);

  console.log(`  After 1st soft note (vel=20):`);
  console.log(`    _heldRecent=[${di._heldRecent.map(v => v.toFixed(3)).join(', ')}]`);

  const cacheHasOnlySoft = di._heldRecent.length <= 1 && di._heldRecent.every(v => v < 0.20);
  assert('_heldRecent reset to 1 soft entry after dramatic drop',
    cacheHasOnlySoft,
    `length=${di._heldRecent.length}, values=[${di._heldRecent.map(v=>v.toFixed(3)).join(', ')}]`);

  // 3 more soft notes to fill cache
  now = feedNotes(di, { count: 3, velocity: 20, intervalMs: 10 }, now);
  console.log(`  After 4 soft notes total:`);
  console.log(`    _heldRecent=[${di._heldRecent.map(v => v.toFixed(3)).join(', ')}]`);
  assert('All 4 cache entries are soft (< 0.20)', di._heldRecent.every(v => v < 0.20),
    `[${di._heldRecent.map(v=>v.toFixed(3)).join(', ')}]`);
}

// ── T3: Lift commit magnitude ─────────────────────────────────────────────────
section('T3: Lift commit — _emaLevel drops substantially');
{
  const di = new DynamicIntelligence();
  di.configure('driven', 'medium', 0, 127, false);
  let now = 0;
  di.tick(now);
  di.onPedalDown();
  now = feedNotes(di, { count: 40, velocity: 80 }, now);

  const emaHard = di._emaLevel;
  console.log(`  After 40 hard notes: _emaLevel=${emaHard.toFixed(3)}`);

  now = feedNotes(di, { count: 4, velocity: 20, intervalMs: 10 }, now);
  const commitTarget = di._heldRecent.reduce((a, b) => a + b, 0) / (di._heldRecent.length || 1);
  console.log(`  commitTarget from _heldRecent: ${commitTarget.toFixed(3)}`);
  console.log(`  _heldRecent: [${di._heldRecent.map(v=>v.toFixed(3)).join(', ')}]`);

  di.onPedalLift();

  const emaAfter = di._emaLevel;
  const pctDrop = ((emaHard - emaAfter) / emaHard * 100).toFixed(0);
  console.log(`  _emaLevel after lift: ${emaAfter.toFixed(3)}  (dropped ${pctDrop}% from ${emaHard.toFixed(3)})`);

  assert('_emaLevel dropped ≥40%', emaAfter < emaHard * 0.60,
    `${emaHard.toFixed(3)} → ${emaAfter.toFixed(3)}`);
  assert('_emaLevel < 0.35', emaAfter < 0.35, `got ${emaAfter.toFixed(3)}`);
}

// ── T4: Output snap fires ─────────────────────────────────────────────────────
section('T4: Output snap — _output jumps at lift for large drops');
{
  const di = new DynamicIntelligence();
  di.configure('driven', 'medium', 0, 127, false);
  let now = 0;
  di.tick(now);
  // Interleave ticks with feeds so dt never exceeds the 2000ms reset threshold
  di.onPedalDown();
  for (let i = 0; i < 40; i++) {
    now += 150; di.feed(80, now, 60);
    now += 16;  di.tick(now);
  }
  // Run extra ticks so _output fully converges to the EMA target
  ({ now } = advanceTicks(di, { totalMs: 500 }, now));

  const outputBefore = di._output;
  const midiBefore   = di.getMidiValue();
  console.log(`  Before lift: _output=${outputBefore.toFixed(3)}  MIDI=${midiBefore}`);

  now = feedNotes(di, { count: 4, velocity: 20, intervalMs: 10 }, now);
  di.onPedalLift();

  const outputAfter = di._output;
  const midiAfter   = di.getMidiValue();
  const snapDrop = outputBefore - outputAfter;
  console.log(`  After snap:  _output=${outputAfter.toFixed(3)}  MIDI=${midiAfter}  snap=${snapDrop.toFixed(3)}`);

  assert('Output snaps ≥0.05 at lift', snapDrop >= 0.05,
    `only moved ${snapDrop.toFixed(3)}`);
  assert('MIDI drops by >5 at lift', midiAfter < midiBefore - 5,
    `${midiBefore} → ${midiAfter}`);
}

// ── T5: Adaptive smoothing ────────────────────────────────────────────────────
section('T5: Adaptive smoothing — fast decay for large gaps');
{
  const di = new DynamicIntelligence();
  di.configure('driven', 'medium', 0, 127, false);
  let now = 0;
  di.tick(now);  // prime _lastTick

  // Manually seed a large downward gap
  di._emaLevel = 0.18;   // driven target = 0.0324
  di._output   = 0.50;   // gap = -0.468

  now += 16;
  di.tick(now);

  const drop1Frame = 0.50 - di._output;
  const expectedFast = (0.468 * 0.26).toFixed(4);
  const expectedSlow = (0.468 * 0.065).toFixed(4);
  console.log(`  Gap = -0.468`);
  console.log(`  Drop in 1 frame: ${drop1Frame.toFixed(4)}  (fast-mode expected ~${expectedFast}, slow-mode ~${expectedSlow})`);

  assert('Fast decay fires (drop > 0.08 per frame)', drop1Frame > 0.08,
    `got ${drop1Frame.toFixed(4)} — adaptive smoothing may not be active`);

  ({ now } = advanceTicks(di, { totalMs: 200 }, now));
  const midi200 = di.getMidiValue();
  console.log(`  After 200ms: MIDI=${midi200}  _output=${di._output.toFixed(3)}`);
  assert('MIDI < 15 after 200ms of fast smoothing', midi200 < 15, `got ${midi200}`);
}

// ── T6: Full chorus→verse scenario ───────────────────────────────────────────
section('T6: Full transition — chorus→verse reaches target within 500ms');
{
  const di = new DynamicIntelligence();
  di.configure('driven', 'medium', 0, 127, false);
  let now = 0;
  di.tick(now);

  // Phase 1: 6-second chorus hold
  di.onPedalDown();
  for (let i = 0; i < 40; i++) {
    now += 150; di.feed(80, now, 60);
    now += 16;  di.tick(now);
  }
  const midiChorus = di.getMidiValue();
  console.log(`  Phase 1 done. MIDI=${midiChorus}  _emaLevel=${di._emaLevel.toFixed(3)}`);

  // Phase 2: soft chord while pedal held
  now = feedNotes(di, { count: 4, velocity: 20, intervalMs: 10 }, now);
  console.log(`  After soft chord: _heldRecent=[${di._heldRecent.map(v=>v.toFixed(3)).join(', ')}]`);

  // Phase 3: pedal lift
  di.onPedalLift();
  const midiAtLift   = di.getMidiValue();
  const outputAtLift = di._output;
  console.log(`  At lift:   MIDI=${midiAtLift}  _output=${outputAtLift.toFixed(3)}  _emaLevel=${di._emaLevel.toFixed(3)}`);
  console.log(`  Drop at lift: ${midiChorus - midiAtLift} MIDI units`);

  // Phase 4: syncopated re-press
  di.onPedalDown();

  // Phase 5: 500ms of frames
  const { midiHistory } = advanceTicks(di, { totalMs: 500 }, now);
  const at100 = midiHistory[Math.floor(100 / 16)] ?? midiHistory.at(-1);
  const at300 = midiHistory[Math.floor(300 / 16)] ?? midiHistory.at(-1);
  const at500 = midiHistory.at(-1);

  console.log(`  100ms: MIDI=${at100}`);
  console.log(`  300ms: MIDI=${at300}`);
  console.log(`  500ms: MIDI=${at500}`);

  assert(`Drop ≥10 units at lift`, midiChorus - midiAtLift >= 10,
    `only ${midiChorus - midiAtLift} units (${midiChorus}→${midiAtLift})`);
  assert('MIDI drops >20 units from chorus within 100ms', at100 < midiChorus - 20,
    `chorus=${midiChorus}, at 100ms=${at100}`);
  assert('MIDI < 20 at 500ms', at500 < 20, `got ${at500}`);
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
if (failures === 0) {
  console.log('  All tests passed ✓');
} else {
  console.error(`  ${failures} test(s) FAILED ✗`);
  process.exitCode = 1;
}
console.log('═'.repeat(60));

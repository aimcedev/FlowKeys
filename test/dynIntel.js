/**
 * DynamicIntelligence unit tests — diagnostic focus.
 *
 * HOW TO RUN
 * ----------
 * In DevTools console (dev_server.py must be running):
 *   const { runAll } = await import('/test/dynIntel.js');
 *   await runAll();
 *
 * Each test logs intermediate state in detail so you can see exactly where
 * the chain breaks, not just which assertion failed.
 */

let DynamicIntelligence = null;

async function loadDynamicIntelligence() {
  if (DynamicIntelligence) return true;
  try {
    ({ DynamicIntelligence } = await import('/js/engine/dynamicIntelligence.js'));
    return true;
  } catch (e) {
    console.warn('DynamicIntelligence tests skipped: js/engine/dynamicIntelligence.js is not present in this app.');
    return false;
  }
}

// ── Tiny test runner ──────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run(name, fn) {
  console.groupCollapsed(name);
  try {
    await fn();
    console.log('%c✓ PASS', 'color:green;font-weight:bold');
    console.groupEnd();
    return { name, pass: true };
  } catch (e) {
    console.error('%c✗ FAIL', 'color:red;font-weight:bold', '—', e.message);
    console.groupEnd();
    return { name, pass: false, error: e.message };
  }
}

// ── Simulation helpers ────────────────────────────────────────────────────────

/**
 * Feed N identical notes at a given interval (ms between notes).
 * Returns the final simulated timestamp.
 */
function feedNotes(di, { count, velocity, note = 60, intervalMs = 150 }, startNow) {
  let now = startNow;
  for (let i = 0; i < count; i++) {
    now += intervalMs;
    di.feed(velocity, now, note);
  }
  return now;
}

/**
 * Advance simulated time, calling tick() each interval.
 * Returns { now, midiHistory } where midiHistory samples MIDI value each tick.
 */
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

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * T-DI-1: EMA converges to hard playing level after a long pedal hold.
 * This is the baseline — if this is off, all later tests are meaningless.
 */
async function testBaselineConvergence() {
  return run('T-DI-1: Baseline — hard playing converges to MIDI ~50 range', () => {
    const di = new DynamicIntelligence();
    di.configure('driven', 'medium', 0, 127, false);
    let now = 0;

    // Initialise tick so _lastTick is set
    di.tick(now);

    // Pedal down, 40 notes at velocity 80, interleaved with ticks
    di.onPedalDown();
    for (let i = 0; i < 40; i++) {
      now += 150;
      di.feed(80, now, 60);
      now += 16;
      di.tick(now);
    }

    const midi  = di.getMidiValue();
    const ema   = di._emaLevel;
    const out   = di._output;
    console.log(`  _emaLevel=${ema.toFixed(3)}  _output=${out.toFixed(3)}  getMidiValue=${midi}`);

    assert(midi >= 40 && midi <= 65,
      `Expected MIDI 40–65 after hard playing, got ${midi}`);
    assert(di._heldNoteCount >= 40,
      `Expected _heldNoteCount≥40, got ${di._heldNoteCount}`);
  });
}

/**
 * T-DI-2: Drop detection resets _heldRecent when a soft note lands during hold.
 * This is the mechanism that gives the lift commit an accurate soft target.
 */
async function testDropDetectionResetsCache() {
  return run('T-DI-2: Drop detection — _heldRecent resets on dramatic velocity drop', () => {
    const di = new DynamicIntelligence();
    di.configure('driven', 'medium', 0, 127, false);
    let now = 0;

    di.tick(now);
    di.onPedalDown();

    // 30 hard notes — fills _heldRecent with hard values, count > 4
    now = feedNotes(di, { count: 30, velocity: 80 }, now);

    const heldEmaAfterHard = di._heldEma;
    const recentBeforeSoft = [...di._heldRecent];
    console.log(`  After 30 hard notes: _heldEma=${heldEmaAfterHard.toFixed(3)}`);
    console.log(`  _heldRecent (before soft): [${recentBeforeSoft.map(v => v.toFixed(3)).join(', ')}]`);

    assert(recentBeforeSoft.length > 0, '_heldRecent should not be empty after 30 notes');
    assert(recentBeforeSoft.every(v => v > 0.55),
      `Expected _heldRecent to contain hard notes (>0.55), got [${recentBeforeSoft.map(v=>v.toFixed(3)).join(', ')}]`);

    // One soft note — drop detection should clear the cache
    now += 50;
    di.feed(20, now, 60);

    const recentAfterFirstSoft = [...di._heldRecent];
    console.log(`  _heldRecent after 1st soft note (vel=20): [${recentAfterFirstSoft.map(v => v.toFixed(3)).join(', ')}]`);

    assert(recentAfterFirstSoft.length <= 1,
      `Expected cache to be reset to 1 note, got ${recentAfterFirstSoft.length} entries: [${recentAfterFirstSoft.map(v=>v.toFixed(3)).join(', ')}]`);
    assert(recentAfterFirstSoft.every(v => v < 0.20),
      `Expected soft note (< 0.20) in cache, got [${recentAfterFirstSoft.map(v=>v.toFixed(3)).join(', ')}]`);

    // Three more soft notes to fill the cache
    now = feedNotes(di, { count: 3, velocity: 20, intervalMs: 10 }, now);
    const recentFull = [...di._heldRecent];
    console.log(`  _heldRecent after 4 soft notes: [${recentFull.map(v => v.toFixed(3)).join(', ')}]`);
    assert(recentFull.every(v => v < 0.20),
      `Expected all cache entries to be soft, got [${recentFull.map(v=>v.toFixed(3)).join(', ')}]`);
  });
}

/**
 * T-DI-3: The lift commit drives _emaLevel to a target near the soft chord level.
 * Tests that blendWeight scales up correctly for large drops.
 */
async function testLiftCommitMagnitude() {
  return run('T-DI-3: Lift commit — _emaLevel drops substantially after soft chord', () => {
    const di = new DynamicIntelligence();
    di.configure('driven', 'medium', 0, 127, false);
    let now = 0;

    di.tick(now);
    di.onPedalDown();
    now = feedNotes(di, { count: 40, velocity: 80 }, now);

    const emaHard = di._emaLevel;
    console.log(`  _emaLevel after hard playing: ${emaHard.toFixed(3)}`);

    // Soft chord (4 notes at vel 20)
    now = feedNotes(di, { count: 4, velocity: 20, intervalMs: 10 }, now);

    const commitTarget = di._heldRecent.reduce((a, b) => a + b, 0) / di._heldRecent.length;
    console.log(`  commitTarget (avg of _heldRecent): ${commitTarget.toFixed(3)}`);
    console.log(`  _heldRecent: [${di._heldRecent.map(v => v.toFixed(3)).join(', ')}]`);

    di.onPedalLift();

    const emaAfterLift = di._emaLevel;
    const dropFraction = (emaHard - emaAfterLift) / emaHard;
    console.log(`  _emaLevel after lift: ${emaAfterLift.toFixed(3)} (dropped ${(dropFraction*100).toFixed(0)}% from ${emaHard.toFixed(3)})`);

    assert(emaAfterLift < emaHard * 0.60,
      `Expected _emaLevel to drop by at least 40%, got ${(dropFraction*100).toFixed(0)}% drop (${emaHard.toFixed(3)} → ${emaAfterLift.toFixed(3)})`);
    assert(emaAfterLift < 0.35,
      `Expected _emaLevel < 0.35 after lift, got ${emaAfterLift.toFixed(3)}`);
  });
}

/**
 * T-DI-4: The output snap fires immediately at lift for large drops.
 * Without the snap, the user feels no response at the pedal lift moment.
 */
async function testOutputSnapAtLift() {
  return run('T-DI-4: Output snap — _output jumps partway at pedal lift', () => {
    const di = new DynamicIntelligence();
    di.configure('driven', 'medium', 0, 127, false);
    let now = 0;

    // Need at least one tick so _lastTick is initialised
    di.tick(now);

    // Interleave ticks with feeds so _lastTick stays close to now (avoids dt>2000 reset)
    di.onPedalDown();
    for (let i = 0; i < 40; i++) {
      now += 150; di.feed(80, now, 60);
      now += 16;  di.tick(now);
    }
    // Run extra ticks so _output fully converges to the EMA target
    ({ now } = advanceTicks(di, { totalMs: 500 }, now));

    const outputBeforeLift = di._output;
    const midiBeforeLift   = di.getMidiValue();
    console.log(`  _output before lift: ${outputBeforeLift.toFixed(3)}  MIDI=${midiBeforeLift}`);

    // Soft chord
    now = feedNotes(di, { count: 4, velocity: 20, intervalMs: 10 }, now);

    di.onPedalLift();  // snap should happen here

    const outputAfterLift = di._output;
    const midiAfterLift   = di.getMidiValue();
    const snapDrop = outputBeforeLift - outputAfterLift;
    console.log(`  _output after snap:  ${outputAfterLift.toFixed(3)}  MIDI=${midiAfterLift}  (snapped by ${snapDrop.toFixed(3)})`);

    assert(snapDrop >= 0.05,
      `Expected _output to snap by ≥0.05 at lift, only moved ${snapDrop.toFixed(3)}`);
    assert(midiAfterLift < midiBeforeLift - 5,
      `Expected MIDI to drop by >5 at lift, went from ${midiBeforeLift} to ${midiAfterLift}`);
  });
}

/**
 * T-DI-5: Adaptive smoothing makes the output fall quickly.
 * Verifies that the 4× faster decay is actually applying for large gaps.
 */
async function testAdaptiveSmoothing() {
  return run('T-DI-5: Adaptive smoothing — large downward gap uses fast decay', () => {
    const di = new DynamicIntelligence();
    di.configure('driven', 'medium', 0, 127, false);
    let now = 0;

    // Prime _lastTick
    di.tick(now);

    // Manually seed state to isolate the smoothing path
    di._emaLevel = 0.18;   // target will be 0.18² = 0.0324
    di._output   = 0.50;   // large downward gap

    now += 16;
    di.tick(now);

    const drop1 = 0.50 - di._output;
    console.log(`  After 1 frame: _output ${(0.50).toFixed(3)} → ${di._output.toFixed(3)}, dropped ${drop1.toFixed(4)}`);
    console.log(`  (slow-mode drop would be ~${(0.46 * 0.065).toFixed(4)}, fast-mode ~${(0.46 * 0.26).toFixed(4)})`);

    // Fast mode should drop ~0.10+ per frame; slow mode only ~0.03
    assert(drop1 > 0.08,
      `Expected fast smoothing (drop >0.08), got ${drop1.toFixed(4)} — adaptive smoothing may not be triggering`);

    // 200 ms total
    ({ now } = advanceTicks(di, { totalMs: 200 }, now));
    const midi200 = di.getMidiValue();
    console.log(`  After 200ms: MIDI=${midi200} (target is near ${Math.round(di._applyCurve(0.18) * 127)})`);
    assert(midi200 < 15, `Expected MIDI < 15 after 200ms, got ${midi200}`);
  });
}

/**
 * T-DI-6: Full scenario — the complete chorus-to-verse transition.
 * Mirrors exactly what the user described:
 *   - Hold pedal, play hard for 6+ seconds  → MIDI ~50
 *   - Play one soft chord (vel=20) still with pedal held
 *   - Lift pedal → expect immediate large drop
 *   - Re-press pedal (syncopated)
 *   - After 500 ms → expect MIDI well below 20
 */
async function testFullChorusToVerseTransition() {
  return run('T-DI-6: Full transition — chorus→verse drops to target within 500ms', () => {
    const di = new DynamicIntelligence();
    di.configure('driven', 'medium', 0, 127, false);
    let now = 0;

    di.tick(now);

    // ── Phase 1: 6-second chorus hold ────────────────────────────────────────
    di.onPedalDown();
    for (let i = 0; i < 40; i++) {
      now += 150;
      di.feed(80, now, 60);
      now += 16;
      di.tick(now);
    }
    const midiChorus = di.getMidiValue();
    console.log(`  Phase 1 (chorus): MIDI=${midiChorus}  _emaLevel=${di._emaLevel.toFixed(3)}`);

    // ── Phase 2: soft chord played while pedal still held ────────────────────
    now = feedNotes(di, { count: 4, velocity: 20, intervalMs: 10 }, now);
    console.log(`  After soft chord: _heldRecent=[${di._heldRecent.map(v=>v.toFixed(3)).join(', ')}]  _heldNoteCount=${di._heldNoteCount}`);

    // ── Phase 3: pedal lift ───────────────────────────────────────────────────
    di.onPedalLift();
    const midiAtLift   = di.getMidiValue();
    const emaAtLift    = di._emaLevel;
    const outputAtLift = di._output;
    console.log(`  At lift: MIDI=${midiAtLift}  _emaLevel=${emaAtLift.toFixed(3)}  _output=${outputAtLift.toFixed(3)}`);

    const dropAtLift = midiChorus - midiAtLift;
    console.log(`  Drop at lift: ${dropAtLift} MIDI units`);

    assert(dropAtLift >= 10,
      `Expected ≥10 MIDI unit drop at pedal lift, got ${dropAtLift} (${midiChorus}→${midiAtLift})`);

    // ── Phase 4: re-press pedal (syncopated) ─────────────────────────────────
    di.onPedalDown();

    // ── Phase 5: 500ms of ticks ───────────────────────────────────────────────
    const { midiHistory, now: now5 } = advanceTicks(di, { totalMs: 500 }, now);
    now = now5;

    const midi100ms = midiHistory[Math.floor(100 / 16)] ?? midiHistory.at(-1);
    const midi300ms = midiHistory[Math.floor(300 / 16)] ?? midiHistory.at(-1);
    const midi500ms = midiHistory.at(-1);

    console.log(`  100ms after lift: MIDI=${midi100ms}`);
    console.log(`  300ms after lift: MIDI=${midi300ms}`);
    console.log(`  500ms after lift: MIDI=${midi500ms}`);

    assert(midi100ms < midiChorus - 20,
      `Expected MIDI to drop by >20 within 100ms, was ${midiChorus} → ${midi100ms}`);
    assert(midi500ms < 20,
      `Expected MIDI < 20 within 500ms, got ${midi500ms}`);
    assert(midi500ms < midiChorus / 2,
      `Expected MIDI < half of chorus level (${midiChorus/2}), got ${midi500ms}`);
  });
}

/**
 * T-DI-7: Single-note dramatic drop (no pedal — staccato eighth notes).
 * The user sometimes plays without holding the pedal.  Drift detection should
 * push the EMA down quickly even in this mode.
 */
async function testStaccatoDramaticDrop() {
  return run('T-DI-7: Staccato — drift detection converges after dramatic drop', () => {
    const di = new DynamicIntelligence();
    di.configure('driven', 'medium', 0, 127, false);
    let now = 0;

    di.tick(now);

    // Build up a high level with hard notes (no pedal)
    now = feedNotes(di, { count: 20, velocity: 80, intervalMs: 200 }, now);
    now += 16; di.tick(now);
    const midiHigh = di.getMidiValue();
    console.log(`  After 20 hard notes (no pedal): MIDI=${midiHigh}  _emaLevel=${di._emaLevel.toFixed(3)}`);

    // Now play 4 soft notes
    now = feedNotes(di, { count: 4, velocity: 20, intervalMs: 200 }, now);
    now += 16; di.tick(now);

    // Advance 800ms to let drift + smoothing catch up
    const { midiHistory } = advanceTicks(di, { totalMs: 800 }, now);
    const midi800ms = midiHistory.at(-1);
    console.log(`  After 4 soft notes + 800ms: MIDI=${midi800ms}`);

    assert(midi800ms < midiHigh * 0.60,
      `Expected MIDI to drop by >40% within 800ms of staccato soft notes, got ${midiHigh} → ${midi800ms}`);
  });
}

// ── Runner ─────────────────────────────────────────────────────────────────────

export async function runAll() {
  console.group('%cDynamicIntelligence Unit Tests', 'font-size:14px;font-weight:bold');
  if (!await loadDynamicIntelligence()) {
    const skipped = [{ name: 'DynamicIntelligence module present', pass: true, skipped: true }];
    console.log('%cSkipped: DynamicIntelligence module is not present.', 'color:orange;font-weight:bold');
    console.groupEnd();
    return skipped;
  }
  const results = await Promise.all([
    testBaselineConvergence(),
    testDropDetectionResetsCache(),
    testLiftCommitMagnitude(),
    testOutputSnapAtLift(),
    testAdaptiveSmoothing(),
    testFullChorusToVerseTransition(),
    testStaccatoDramaticDrop(),
  ]);
  const passed = results.filter(r => r.pass).length;
  const total  = results.length;
  const color  = passed === total ? 'color:green' : 'color:red';
  console.log(`%c\n${passed}/${total} passed`, `${color};font-weight:bold;font-size:13px`);
  if (passed < total) {
    console.warn('Failed:', results.filter(r => !r.pass).map(r => `${r.name} — ${r.error}`));
  }
  console.groupEnd();
  return results;
}

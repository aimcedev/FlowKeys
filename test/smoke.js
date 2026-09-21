/**
 * Flow Keys smoke test harness — browser-native, no build step.
 *
 * HOW TO RUN
 * ----------
 * 1. Open the app in the browser (dev_server.py running).
 * 2. Open DevTools console.
 * 3. Run:
 *      const { runAll } = await import('/test/smoke.js');
 *      await runAll();
 *
 * Each test prints ✓ or ✗ to the console with a short reason.
 * All tests are read-mostly — they may temporarily alter engine state
 * but restore it before returning.
 */

// ── Tiny assertion helpers ────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run(name, fn) {
  try {
    await fn();
    console.log('%c✓', 'color:green;font-weight:bold', name);
    return { name, pass: true };
  } catch (e) {
    console.error('%c✗', 'color:red;font-weight:bold', name, '—', e.message);
    return { name, pass: false, error: e.message };
  }
}

function syntheticMidiEvent(data) {
  return { data: data instanceof Uint8Array ? data : new Uint8Array(data) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// T1: Malformed MIDI data must not throw or corrupt engine state
async function testMalformedMidi() {
  return run('T1: Malformed MIDI data — null, 1-byte, SysEx', () => {
    const app = window.app;
    assert(app, 'window.app not found — is the app loaded?');
    const engine = app.engine;

    const notesBefore = engine.activeNotes.size;

    // null data
    engine.processMidiMessage({ data: null });
    // 1-byte MIDI clock
    engine.processMidiMessage(syntheticMidiEvent([0xF8]));
    // SysEx start (variable length)
    engine.processMidiMessage(syntheticMidiEvent([0xF0, 0x41, 0x10]));

    assert(engine.activeNotes.size === notesBefore, 'activeNotes changed after malformed input');
  });
}

// T2: Bass module panic resets all state flags
async function testBassPanicFlags() {
  return run('T2: Bass panic() resets all state flags', () => {
    const app = window.app;
    const bass = [...app.moduleInstances.values()].find(m => m.constructor.name === 'BassModule');
    if (!bass) { console.warn('T2: No BassModule found — skipping'); return; }

    // Corrupt flags to a bad state
    bass.waitingForNewStrike = true;
    bass.waitingToTurnOff = true;
    bass.pendingPedalCheck = true;
    bass.waitingForPedalLift = true;
    bass.currentSustainDown = true;

    bass.panic();

    assert(!bass.waitingForNewStrike, 'waitingForNewStrike not cleared');
    assert(!bass.waitingToTurnOff, 'waitingToTurnOff not cleared');
    assert(!bass.pendingPedalCheck, 'pendingPedalCheck not cleared');
    assert(!bass.waitingForPedalLift, 'waitingForPedalLift not cleared');
    assert(!bass.currentSustainDown, 'currentSustainDown not cleared');
    assert(!bass.isActive, 'isActive not cleared');
  });
}

// T3: engine.clearState() wipes note state without stopping clock
async function testClearStateDoesNotStopClock() {
  return run('T3: engine.clearState() wipes note state, clock keeps running', () => {
    const app = window.app;
    const engine = app.engine;
    const wasRunning = engine.clock.isRunning;

    // Inject a synthetic note-on
    engine.activeNotes.set(60, { velocity: 100, timestamp: performance.now() });
    engine.sustainedNotes.add(64);
    engine.sustainDown = true;
    assert(engine.activeNotes.size > 0, 'setup: activeNotes should be non-empty');

    engine.clearState();

    assert(engine.activeNotes.size === 0, 'activeNotes not cleared');
    assert(engine.sustainedNotes.size === 0, 'sustainedNotes not cleared');
    assert(!engine.sustainDown, 'sustainDown not cleared');
    assert(engine.clock.isRunning === wasRunning, 'clock running state changed');
  });
}

// T4: Section change clears engine note state (P0 regression)
async function testSectionChangeClearsNotes() {
  return run('T4: Section change clears engine note state', () => {
    const app = window.app;
    const engine = app.engine;

    // Inject a held note directly into engine state
    engine.activeNotes.set(60, { velocity: 100, timestamp: performance.now() });

    // Save where we were
    const preSongId = app.presetManager.activeSongId;
    const preSectionId = app.presetManager.activeSectionId;

    // applySectionState to the SAME section (minimal side-effects)
    if (preSongId && preSectionId) {
      app.applySectionState(preSongId, preSectionId);
      assert(engine.activeNotes.size === 0, 'activeNotes not cleared after section switch');
    } else {
      // No active section — just verify clearState works
      engine.clearState();
      assert(engine.activeNotes.size === 0, 'activeNotes not cleared');
    }
  });
}

// T5: engine.panic() full path — stops clock, clears state, fires callback
async function testEnginePanic() {
  return run('T5: engine.panic() clears state and fires onStateChange', () => {
    const app = window.app;
    const engine = app.engine;

    engine.activeNotes.set(60, { velocity: 100, timestamp: performance.now() });
    engine.sustainDown = true;

    let callbackFired = false;
    const prev = engine.onStateChangeCallback;
    engine.onStateChangeCallback = (state) => {
      callbackFired = true;
      if (prev) prev(state);
    };

    engine.panic();

    engine.onStateChangeCallback = prev;

    assert(engine.activeNotes.size === 0, 'activeNotes not cleared');
    assert(!engine.sustainDown, 'sustainDown not cleared');
    assert(callbackFired, 'onStateChangeCallback not fired');
    assert(!engine.clock.isRunning, 'clock still running after panic');

    // Restart clock if it was running before (restore)
    // Caller is responsible — panic is destructive by design.
  });
}

// T6: Output disconnect callback is wired
async function testOutputDisconnectCallback() {
  return run('T6: midiManager fires onOutputDisconnect when selected output vanishes', () => {
    const app = window.app;
    const midi = app.midi;

    // Save real state
    const realOutputId = midi.selectedOutputId;
    const realLastName = midi._lastOutputName;
    const realCb = midi._outputDisconnectCb;

    let disconnectFired = false;
    midi.onOutputDisconnect((name) => { disconnectFired = true; });

    // Simulate a state where selected output is set but not in the outputs map
    midi.selectedOutputId = '__fake_id_that_does_not_exist__';
    midi._lastOutputName = 'Fake Device';

    // updateDevices with the real outputs (which won't have the fake ID)
    midi.updateDevices();

    // Restore
    midi.selectedOutputId = realOutputId;
    midi._lastOutputName = realLastName;
    midi._outputDisconnectCb = realCb;

    assert(disconnectFired, 'onOutputDisconnect callback was not fired');
  });
}

// T7: processMidiMessage handles single-byte MIDI clock without corrupting state
async function testMidiClockPassthrough() {
  return run('T7: Single-byte MIDI clock (0xF8) does not corrupt note state', () => {
    const engine = window.app.engine;
    const notesBefore = engine.activeNotes.size;

    // MIDI clock byte — common when DAW is connected and sending clock
    engine.processMidiMessage({ data: new Uint8Array([0xF8]) });

    assert(engine.activeNotes.size === notesBefore, 'note state changed after 0xF8');
  });
}

// T8: Clock Worker error callback is registered
async function testClockWorkerErrorCallback() {
  return run('T8: clock.onWorkerError callback is registered (structural check)', () => {
    const clock = window.app.engine.clock;
    assert(Array.isArray(clock.onWorkerErrorCallbacks), 'onWorkerErrorCallbacks not an array');
    assert(clock.onWorkerErrorCallbacks.length > 0, 'no onWorkerError callbacks registered — app.js wiring missing');
  });
}

// T9: _toggleModuleDirectly toggles without touching DOM event queue
async function testToggleModuleDirectly() {
  return run('T9: _toggleModuleDirectly saves in Edit mode, not Live mode', () => {
    const app = window.app;
    const [instanceId, mod] = [...app.moduleInstances.entries()][0] ?? [];
    if (!mod) { console.warn('T9: No modules found — skipping'); return; }

    const wasSaving = app.saveState;
    const previousMode = app.uiManager?.currentMode;
    let saveCalled = false;
    app.saveState = () => { saveCalled = true; };

    try {
      const was = mod.isActive;
      if (app.uiManager) app.uiManager.currentMode = 'edit';
      app._toggleModuleDirectly(instanceId, !was);
      assert(saveCalled, 'saveState was not called in Edit mode');

      saveCalled = false;
      if (app.uiManager) app.uiManager.currentMode = 'live';
      app._toggleModuleDirectly(instanceId, was);
      assert(!saveCalled, 'saveState was called in Live mode');
    } finally {
      if (app.uiManager) app.uiManager.currentMode = previousMode;
      app.saveState = wasSaving;
    }
  });
}

// T10: Background tab callback is registered on clock
async function testBackgroundCallbackRegistered() {
  return run('T10: clock.onBackground callback is registered (structural check)', () => {
    const clock = window.app.engine.clock;
    assert(Array.isArray(clock.onBackgroundCallbacks), 'onBackgroundCallbacks not an array');
    assert(clock.onBackgroundCallbacks.length > 0, 'no onBackground callbacks registered');
  });
}

async function testApplySectionStateDoesNotAutoSave() {
  return run('T11: Section apply does not auto-save during state load', () => {
    const app = window.app;
    const pm = app.presetManager;
    const snapshot = JSON.stringify({
      songs: pm.songs,
      activeSongId: pm.activeSongId,
      activeSectionId: pm.activeSectionId,
    });
    const originalUpdate = pm.updateSectionState.bind(pm);
    let updateCalls = 0;

    try {
      const song = pm.createSong('Smoke Test Song');
      const first = song.sections[0];
      const nextState = JSON.parse(JSON.stringify(first.state));
      nextState.timeSignature = nextState.timeSignature === '4/4' ? '3/4' : '4/4';
      const second = pm.addSectionToSong(song.id, 'Smoke B', nextState);
      pm.setActiveSection(song.id, first.id);

      pm.updateSectionState = (...args) => {
        updateCalls++;
        return originalUpdate(...args);
      };

      app.applySectionState(song.id, second.id);
      assert(updateCalls === 0, `section state was updated ${updateCalls} time(s) during apply`);
      assert(pm.activeSectionId === second.id, 'destination section was not activated');
    } finally {
      pm.updateSectionState = originalUpdate;
      const restored = JSON.parse(snapshot);
      pm.songs = restored.songs;
      pm.activeSongId = restored.activeSongId;
      pm.activeSectionId = restored.activeSectionId;
      pm.saveToStorage();
      if (pm.activeSongId && pm.activeSectionId) {
        app.applySectionState(pm.activeSongId, pm.activeSectionId);
      }
    }
  });
}

async function testInvalidBpmNormalizes() {
  return run('T12: Invalid BPM input normalizes instead of producing NaN', () => {
    const app = window.app;
    const input = app.ui.masterBpm;
    const previous = app.engine.clock.bpm;

    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    assert(Number.isFinite(app.engine.clock.bpm), 'clock BPM is not finite');
    assert(app.engine.clock.bpm >= 20 && app.engine.clock.bpm <= 300, `clock BPM out of range: ${app.engine.clock.bpm}`);
    assert(input.value !== '' && !Number.isNaN(parseInt(input.value, 10)), 'BPM input did not receive a normalized value');

    app.engine.clock.setBpm(previous);
  });
}

async function testVolumeZeroPersistsInDomRead() {
  return run('T13: Volume 0 is preserved when reading module state', () => {
    const app = window.app;
    const mod = app._currentModules[0];
    assert(mod, 'no module descriptor available');
    const volume = app._getModuleEl(mod.id, 'volume');
    assert(volume, 'volume control not found');

    const previous = volume.value;
    volume.value = '0';
    const data = app._readModuleFromDom(mod);
    volume.value = previous;

    assert(data.config.volume === 0, `expected volume 0, got ${data.config.volume}`);
  });
}

async function testTempoTriggerMappingOpensPopover() {
  return run('T14: tempoTrigger mapping toggles tempo popover', () => {
    const app = window.app;
    const popover = document.getElementById('tempo-popover');
    const trigger = document.getElementById('tempo-trigger-btn');
    assert(popover && trigger, 'tempo trigger or popover missing');

    popover.classList.remove('tempo-popover--open');
    trigger.classList.remove('active');
    app.midiActions.handle('tempoTrigger');
    assert(popover.classList.contains('tempo-popover--open'), 'tempo popover did not open');

    app.midiActions.handle('tempoTrigger');
    assert(!popover.classList.contains('tempo-popover--open'), 'tempo popover did not close');
  });
}

async function testDefaultStateHasModules() {
  return run('T15: Default state includes the standard module lineup', async () => {
    const { buildDefaultState } = await import('/js/state/stateSchema.js');
    const state = buildDefaultState();
    const ids = state.modules.map(m => m.id);
    assert(ids.includes('legacy-bass'), 'default state missing Bass');
    assert(ids.includes('legacy-arp'), 'default state missing Arp');
    assert(ids.includes('legacy-kick'), 'default state missing Kick');
    assert(ids.includes('legacy-snare'), 'default state missing Snare');
    assert(ids.includes('legacy-shaker'), 'default state missing Shaker');
    assert(ids.includes('legacy-pad'), 'default state missing Drone');
  });
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runAll() {
  console.group('Flow Keys Smoke Tests');
  const tests = [
    testMalformedMidi,
    testBassPanicFlags,
    testClearStateDoesNotStopClock,
    testSectionChangeClearsNotes,
    testEnginePanic,
    testOutputDisconnectCallback,
    testMidiClockPassthrough,
    testClockWorkerErrorCallback,
    testToggleModuleDirectly,
    testBackgroundCallbackRegistered,
    testApplySectionStateDoesNotAutoSave,
    testInvalidBpmNormalizes,
    testVolumeZeroPersistsInDomRead,
    testTempoTriggerMappingOpensPopover,
    testDefaultStateHasModules,
  ];
  const results = [];
  for (const test of tests) {
    results.push(await test());
  }
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n${passed}/${total} passed`);
  if (passed < total) {
    console.warn('Failed tests:', results.filter(r => !r.pass).map(r => r.name));
  }
  console.groupEnd();
  return results;
}

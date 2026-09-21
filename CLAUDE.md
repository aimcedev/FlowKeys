# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
python dev_server.py   # Start live-reload server at http://localhost:8000
```

The server watches `*.html`, `css/`, and `js/` for changes and live-reloads the browser. There is no build step — the app is plain ES6 modules served directly. Cache-busting is done manually via query strings on `<script>` and `<link>` tags in `index.html` (e.g. `?v=24`); bump these when making breaking changes to cached files.

There are no tests, no linter, and no package manager. This is intentional.

The `test/` directory has `smoke.js` (browser smoke tests), `dynIntel.js` (browser), and `dynIntel.node.mjs` (Node.js). These are run manually — there is no test runner.

The app also runs as an Electron desktop host (see **Electron Desktop Host** below):

```bash
cd electron && npm start   # launch the desktop app
```

Most development should still happen in the browser with `dev_server.py` — the app is identical in both. Use Electron only to test the native virtual MIDI port. In Electron, edits to renderer code (`index.html`, `css/`, `js/`) take effect on a window reload (Cmd+R); edits to the `electron/` main-process files require a restart.

## Architecture Overview

Flow Keys is a browser-based MIDI performance tool — vanilla JS (no framework), using Web MIDI API, Web Workers, Canvas, and localStorage.

### Entry Points

- `index.html` loads `appUiManager.js` and `app.js` (both `type="module"`)
- `app.js` is the top-level controller: it instantiates every subsystem and wires them together
- `check.mjs` is a stub (just re-imports `app.js`), used for quick syntax checking

### File Layout

```
js/
├── app.js                         # Top-level orchestrator
├── modules/                       # Generator modules (MIDI output)
│   ├── moduleRegistry.js          # Module factory & instantiation
│   ├── bass.js
│   ├── arp.js
│   ├── percussion.js
│   ├── pad.js
│   ├── keyboard.js
│   ├── looper.js
│   └── swell.js
├── engine/
│   ├── performanceEngine.js       # Note state tracking & module routing
│   ├── clock.js                   # Master tempo clock
│   └── clockWorker.js             # Web Worker for timing isolation
├── midi/
│   ├── midiManager.js             # Web MIDI API wrapper
│   ├── midiMapping.js             # MIDI learn & persistence
│   └── midiActionRouter.js        # Routes MIDI targets to app actions
├── tempo/
│   ├── event-classifier.js
│   ├── pulse-engine.js
│   ├── tempo-tracker.js
│   ├── tempo-widget.js            # BPM display, hints, lock button
│   └── tempoController.js         # Clock control & BPM step buttons
├── state/
│   ├── stateSchema.js             # v1→v2 migration, defaults
│   ├── presetManager.js           # Song/section localStorage
│   ├── modulePresets.js           # Built-in drum & arp patterns
│   └── showFileManager.js         # Show file export/import
├── ui/
│   ├── appUiManager.js            # Mode switching, modals, UI state machine
│   ├── modulesGridController.js   # Module card rendering & lifecycle
│   ├── moduleCardBuilder.js       # Card template generation
│   ├── dragDropController.js      # Palette drag-to-add
│   ├── contextMenu.js             # Right-click menus
│   ├── contextActionsController.js # Copy/paste/duplicate/rename actions
│   ├── activityVisualizer.js      # Canvas activity monitor
│   └── presetDropdown.js          # Preset selector UI
├── chord-pads/
│   ├── chordPads.js               # 12 chord pads, playback & smart sustain
│   └── chordPadsPanel.js          # Chord pad UI editor
├── components/
│   ├── sequencer.js               # 16-step velocity grid
│   ├── freqVisualizer.js          # Frequency response display
│   ├── looperVisualizer.js        # Looper waveform display
│   └── noteActivityViz.js         # Note activity meter
└── utils/
    ├── noteUtils.js               # MIDI note/frequency conversions
    ├── midiConstants.js           # CC numbers (sustain, mod wheel, etc.)
    └── easing.js                  # Easing functions for transitions

css/
├── theme.css                      # Dark/light theme CSS variables
├── styles.css                     # Main stylesheet (imports css/styles/*)
├── chord-pads.css
└── styles/                        # Modularized CSS (numbered, loaded via styles.css)
    ├── 01-layout-transport.css
    ├── 02-workspace-modules-sequencer.css
    ├── 03-midi-mapping.css
    ├── 04-responsive.css
    ├── 05-modes-live.css
    ├── 06-modals-toasts-actions.css
    ├── 07-edit-context-midi-targets.css
    ├── 08-tempo-widget.css
    ├── 09-drag-palette-activity.css
    └── 10-presets-context-menu.css
```

### Core Data Flow

```
Physical MIDI keyboard
  → MidiManager (js/midi/midiManager.js)
  → PerformanceEngine (js/engine/performanceEngine.js)
      ├── Pass-through to output (transposed)
      ├── Track state: activeNotes, lowestNote, top-3 highestNotes, sustain
      └── Broadcast processState(state) to all active modules

Chord Pads (js/chord-pads/chordPads.js)
  → injectNotes() → PerformanceEngine (same path as physical keys)

Each module receives state → generates MIDI output on its own channel

Clock (js/engine/clock.js) → Web Worker (js/engine/clockWorker.js)
  → onTick(step, ppq) → tempo-based modules (arp, percussion, looper)
  → onBar / onBeat callbacks → app.js (section sync, deferred toggles)
```

The Web Worker handles timing so the clock doesn't drift when the browser tab is backgrounded.

### Module Interface

Every generator module implements:

| Method | Purpose |
|---|---|
| `processState(state)` | Called on every MIDI input event with current note state |
| `onTick(step, ppq)` | Called on every clock tick (tempo-based modules only) |
| `setConfig(...args)` | Apply channel, note ranges, mode config |
| `setSequence(seq)` | Load a velocity array (0 = off, 1–127 = velocity) |
| `toggle(active)` | Enable/disable output |
| `panic()` | Immediately silence all held notes |
| `setVolumeImmediate(vol)` | Apply volume without ramping |

Modules also expose an `isTempoBased` boolean flag — when `true`, the app starts the clock when the module is active and stops it when no tempo-based modules remain active.

To add a new generator module, implement this interface and register an instance in `js/modules/moduleRegistry.js`, then wire it in `app.js`.

### Module Types

**Legacy fixed modules** — instantiated once on startup with stable IDs (`legacy-bass`, `legacy-arp`, etc.):
- **Bass** (`bass.js`) — tracks lowest held note in a configurable range; plays once per new strike, not on held chords
- **Arp** (`arp.js`) — chord arpeggiation with sequencer; selectable modes (chord/up/down)
- **Percussion** (`percussion.js`) — unified sequencer-driven drum; instantiated three times for kick/snare/shaker
- **Pad** (`pad.js`) — root-fifth drone; key can follow song key or be set absolutely

**Dynamic modules** — can be added, removed, and reordered by the user per song:
- **Keyboard** (`keyboard.js`) — chord duplicator with voicing (inversion, octave shift, filter); mod wheel (CC 1) crossfades between two scene configurations
- **Looper** (`looper.js`) — records for N bars then loops back with quantization; recordings are cached per section ID and restored on section switch
- **Swell** (`swell.js`) — volume envelope and pitch whammy derived from held notes

### Module Registry

`js/modules/moduleRegistry.js` is the factory. It:
- Instantiates all legacy modules on startup with stable IDs
- Wraps each module's MIDI output via `createMidiWrapper()` so note activity can be visualized
- Exposes `createModule(type, id)` for dynamic module instantiation
- Humanizes shaker velocity (±5) — this is intentional, don't remove it

### Percussion Consolidation

`js/modules/kick.js`, `snare.js`, and `shaker.js` are deprecated. All percussion now goes through `js/modules/percussion.js`, instantiated three times with different configs. Don't add new files to the old pattern.

### State Persistence

State is versioned. Current version is **v2**:

```javascript
{
  bpm: 120,
  timeSignature: '4/4',
  theme: 'dark',
  modules: [{ id, type, label, active, config }, ...]
}
```

`js/state/stateSchema.js` handles v1→v2 migration (`migrateState()`). If you change the schema structure, bump the version and add a migration path there — do not break existing localStorage data.

**localStorage keys:**

| Key | Contents |
|---|---|
| `flowKeysPresetsV1` | Songs and sections: `{ songs: [...], activeSongId, activeSectionId }` |
| `flowKeysState` | Master module config (non-section fallback) |
| `flowKeysMidiMap` | MIDI learn mappings: `{ mappings: [...], designedInput }` |
| `flowKeysModulePresets` | User-saved patterns: `{ percussion: {kick, snare, shaker}, arp }` |
| `flowKeysTheme` | `'dark'` or `'light'` |
| `flowKeysShows` | Named show files: `{ [showId]: { name, timestamp, snapshot } }` |

### Two UI Modes

- **EDIT mode:** Module configuration cards, sequencer editing, activity monitor canvas
- **LIVE mode:** Song/section browser for performance; prev/next navigation

`AppUiManager` (`js/ui/appUiManager.js`) is the UI state machine; it owns all mode transitions, modals, drag-and-drop, and the settings drawer. `app.js` delegates all DOM interaction to it.

### Clock Modes

The `Clock` class supports three modes (set via `clock.setMode()`):

- `sync` — free-running metronome, always ticking
- `trigger` — clock starts on note-on, stops on sustain-pedal release
- `flow` — persistent clock managed by `app.js` for performance continuity; starts when a tempo-based module becomes active, stops when none remain active

Clock fires callbacks: `onTick`, `onBar`, `onBeat`, `onBpmChange`, `onStop`.

### Section Transitions

Each song has a `transitionMode` property:

- `trigger` — immediate section switch
- `sync` — queued at next bar boundary
- `flow` — context-aware: sustain-pedal lift for entry/exit, bar-aligned for tempo-to-tempo switches

On section change, `app.js` clears engine note state (preventing ghost notes) then reloads the incoming section's state. Loop recordings are cached per section ID in `_loopCache` and restored transparently.

### Song-Scoped Modules

When modules are added, removed, reordered, or renamed within a song, that change propagates to **all sections** in the same song automatically. This is handled in `app.js` via `PresetManager.propagateModuleAdd/Remove()` — be careful when touching module list operations that they maintain this invariant.

### MIDI Mapping

`js/midi/midiMapping.js` implements MIDI learn: user selects a control in the UI, sends a CC/note from hardware, the mapping is saved. `js/midi/midiActionRouter.js` maps target strings to app handler functions, including: module toggles, transport, BPM up/down, tempo hints, panic, section navigation, song/section/chord-pad targets.

Toggling a module via MIDI uses `_toggleModuleDirectly()` so it bypasses DOM events and doesn't trigger `saveState()`.

### Chord Pads

`js/chord-pads/` is a self-contained subsystem ported from a separate app. 12 fixed pads each store a chord; `chordPads.js` triggers them via `triggerPadDown(index)` / `triggerPadUp(index)`. Notes are injected into the performance engine so all modules react as if played on a physical keyboard. "Smart sustain" mode hard-stops other pads before a new one plays. Pads are transposed by the song key.

### Show File Manager

`js/state/showFileManager.js` handles export/import of the entire app state as a named JSON show file (songs, sections, MIDI mappings, presets). A "Default Show" always exists. Import/export uses the browser File API.

### Tempo Detection Pipeline

`js/tempo/` is a 4-stage pipeline for BPM detection from live playing:
1. `event-classifier.js` — groups and classifies MIDI note timing
2. `pulse-engine.js` — detects pulse grid from classified events
3. `tempo-tracker.js` — derives BPM from the pulse
4. `tempo-widget.js` — UI widget with BPM display, confidence bar, hints, and lock button
5. `tempoController.js` — wires the pipeline to the clock; handles BPM step buttons with hold-repeat

### Sequencer

`js/components/sequencer.js` renders an interactive velocity grid. Grid is 16 steps for 4/4, 12 steps for 3/4 and 6/8. Steps are click-and-drag to set velocity. Time signature changes resize the grid.

### Notable Behaviors to Preserve

- **Bass module strike rule:** Bass only plays when a new keypress occurs after silence (not on held chords); sustain pedal is tracked separately via CC 64.
- **Shaker humanization:** ±5 velocity randomness on shaker is intentional — don't remove it.
- **Tempo widget lock:** When locked, the tempo widget stops updating from live input but the detection pipeline still runs silently.
- **Keyboard module mod wheel:** `js/modules/keyboard.js` uses mod wheel (CC 1) position to crossfade between two scene configurations — it is not a simple note duplicator.
- **Keyboard press-time voicing:** Notes are played immediately at strike time, then re-voiced after a 30 ms chord-settle timeout.
- **Deferred module activation:** A module toggled via MIDI while the clock is running waits until the next bar boundary before activating.
- **Looper loop cache:** Looper recordings survive section switches; `app.js` caches them by section ID in `_loopCache` and restores them when returning to a section.
- **Native MIDI path is feature-detected:** All Electron/native-MIDI behavior is gated on `window.flowKeysNative` and the `MidiManager` native fields (`_nativeOutputActive` etc.). In a browser these are absent/false and the app must behave exactly as before — don't introduce native assumptions into the renderer's default path.

## Electron Desktop Host

`electron/` wraps the unchanged web app (the parent folder) as a desktop app and adds a **native virtual MIDI output port** ("Flow Keys Out") so DAWs see Flow Keys with no IAC Driver setup — something Web MIDI cannot do. The same codebase still runs in a plain browser; all native behavior is feature-detected (see the "Native MIDI path" note above).

**Files (all CommonJS, main-process except where noted):**

| File | Purpose |
|---|---|
| `electron/main.js` | Creates the `BrowserWindow`, serves the app over a custom `app://` standard-scheme origin, grants Web MIDI, wires IPC, sets `backgroundThrottling: false` |
| `electron/preload.js` | Exposes the `window.flowKeysNative` bridge (`createVirtualPort`, `send`) via `contextBridge` |
| `electron/virtualMidi.js` | Owns the native CoreMIDI port (node `midi` package) in the main process |
| `electron/smoke.js` | `npm run smoke` — confirms the native module loads under Electron's ABI |
| `electron/package.json` | `start` / `rebuild` / `smoke` scripts; deps: `midi`, `electron`, `@electron/rebuild` |

**Why a custom `app://` protocol (not `file://`):** ES module imports and the Web Worker clock (`new Worker(new URL(...))`) require a real origin; `file://` breaks both in Chromium. `main.js` registers `app` as a standard+secure scheme and serves files from the project root, stripping cache-busting query strings (`?v=NN`).

**MIDI routing:** A virtual port opened with `Output.openVirtualPort` is a *source* — it appears to DAWs (and to the renderer's own Web MIDI) as an *input*, so the renderer cannot send to it directly. Instead the renderer forwards outgoing bytes over IPC to the main process, which calls `output.sendMessage()`. In `MidiManager`, all sends funnel through `_emit()`, which routes to `_nativeSend` when `VIRTUAL_OUTPUT_ID` is the selected output, else to Web MIDI. `_applyInputListeners()` excludes the virtual port by name to avoid a feedback loop. `app.js` injects the "🎹 Flow Keys Out (Virtual)" option into the output selector and auto-selects it when available.

**Native module ABI:** `midi` is a native addon and must match Electron's ABI (121 for Electron 29, vs 115 for plain Node 20). After changing the Electron version or reinstalling, run `npm run rebuild` (`electron-rebuild -f -w midi`). Virtual ports are macOS/Linux only (Windows has no OS-level virtual MIDI). Packaging (`electron-builder`) is not yet set up.

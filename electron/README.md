# Flow Keys — Electron desktop host

Wraps the existing web app (in the parent folder) as a desktop app and adds a
**native virtual MIDI output port** ("Flow Keys Out") so DAWs see Flow Keys with
no IAC Driver setup.

The web app is unchanged and still runs in a plain browser — all native behavior
is feature-detected via `window.flowKeysNative` and is simply absent in a browser.

## Run

```bash
cd electron
npm start          # launches the desktop app
```

## How it works

- `main.js` serves the parent folder over a custom `app://` standard-scheme
  origin (so ES modules + the Web Worker clock load exactly as in a browser —
  `file://` would break them) and wires up IPC.
- `preload.js` exposes a minimal `window.flowKeysNative` bridge.
- `virtualMidi.js` owns the native CoreMIDI port in the main process. The
  renderer forwards outgoing MIDI bytes to it over IPC (a virtual *source* shows
  up as an *input* on the Web MIDI side, so the renderer can't send to it
  directly — it goes through the main process).
- In the renderer, `MidiManager` routes output to the native port when
  "🎹 Flow Keys Out (Virtual)" is selected; otherwise it uses Web MIDI as before.
  The port is auto-selected on first launch.

## Native module (already done, but for reference)

The `midi` package is a native addon and must match Electron's ABI (121 for
Electron 29, vs 115 for plain Node 20). If you change the Electron version or
reinstall, rebuild it:

```bash
cd electron
npm run rebuild    # electron-rebuild -f -w midi
npm run smoke      # optional: confirms the native module loads (see note)
```

> Note: `npm run smoke` requires Electron to launch its GUI runtime. In a
> headless/sandboxed shell Electron may run in `ELECTRON_RUN_AS_NODE` mode where
> the `app` module is unavailable and smoke.js can't run — that's an environment
> limitation, not a build problem. Just run `npm start` on a normal desktop.

> Heads up: this project's path contains spaces ("Testing Ground May 1").
> node-gyp warns about spaces in paths; the rebuild succeeded here, but if you
> ever hit native-build failures, moving the project to a space-free path is the
> first thing to try.

## Verify it works (on your desktop)

1. `npm start` — the app window opens.
2. Open a DAW (Ableton/Logic/etc.) and look for a MIDI **input** named
   **"Flow Keys Out"** — it should appear with no IAC setup.
3. In Flow Keys, confirm the output selector shows **"🎹 Flow Keys Out (Virtual)"**
   and that it's selected.
4. Play / trigger a module and confirm the DAW receives MIDI on that port.
5. Background the window during playback — timing stays solid
   (`backgroundThrottling: false`).

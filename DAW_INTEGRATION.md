# Flow Keys → DAW Integration — Design Spec

Status: **proposal / for review**. No code written yet. This document specifies how to
make Flow Keys set up cleanly in Ableton Live (primary target) and any other DAW
(secondary), so a new user can go from "launched the app" to "playing through real
instruments" with minimal manual routing.

---

## 1. Problem statement

Flow Keys is a *MIDI generator*: each module emits on its own MIDI channel and is meant
to drive a separate virtual instrument in a DAW. Nothing emits the raw keyboard —
[`performanceEngine.processMidiMessage()`](js/engine/performanceEngine.js#L52) only
updates note state and broadcasts to modules. Live playing reaches the DAW *through* the
Keyboard module and Chord Pads, not as a raw pass-through.

So a working DAW session is **"one instrument track per active module, each listening on a
specific MIDI channel."** Setting that up by hand is the friction we are removing.

### Current per-module channel defaults

These come from [`stateSchema.js`](js/state/stateSchema.js#L27) (`buildDefaultModules` +
`MODULE_TYPE_DEFAULTS`). The constructor defaults inside each module file
(`bass.js`, `arp.js`, …) are effectively **dead** — `applyConfigs()` always overwrites
them via `setConfig()` from saved/default config.

| Module | Default Ch | Drives in DAW | Notes / MIDI |
|---|---|---|---|
| Keyboard (live voicing) | **1** | Main keys/synth | Your playing, re-voiced |
| Chord Pads | **1** | (shares Ch 1) | Injected as if played |
| Bass | **2** | Bass instrument | Lowest held note, E1–E2 |
| Percussion ×3 (kick/snare/shaker) | **3** (shared) | One Drum Rack | Notes 36 / 38 / 55 |
| Pad / Drone | **7** | Pad/drone | Root + fifth |
| Arp | **8** | Pluck/arp | Arpeggiated chord |
| Swell | **9** | Swell/strings | Volume + pitch envelope |
| Looper | **10** | Its own synth | Recorded loop |

Channel is user-editable per card (Ch 1–16; Ch 10 labelled "Drums") in
[`moduleCardBuilder._chanOptions()`](js/ui/moduleCardBuilder.js#L27).

### What the user must do by hand today (the tedium)

In the Electron host, **step 1 is already solved** — the native `Flow Keys Out` port
auto-appears with no IAC setup ([`app.js`](js/app.js#L224),
[`virtualMidi.js`](electron/virtualMidi.js)). What remains, *per module*:

1. Create a MIDI track.
2. Set *MIDI From* → "Flow Keys Out" **and the channel selector to the right number**
   ← the #1 silent-failure trap (wrong channel = no sound, no error).
3. Set *Monitor → In* (or arm the track).
4. Load a fitting instrument.
5. Repeat ×6–10.

### Goals / non-goals

**Goals**
- Cut DAW setup from ~10 manual steps to "open template / press button, then swap sounds."
- One source of truth for the channel map, consumed everywhere.
- Universal baseline that works in *every* DAW; richer automation for Ableton.

**Non-goals (for now)**
- Embedding third-party instruments into generated projects (licensing + format lock-in).
- Two-way transport/clock sync (Flow Keys already has its own clock).
- Windows native virtual port (no OS-level support; IAC-equivalent doesn't exist there).

---

## 2. Foundation (prerequisite for everything else)

### 2.1 Single canonical channel map

Today the defaults live in **three** places that disagree, and a couple collide
unintentionally (Looper sits on Ch 10, which the UI labels "Drums"; channels 4–6 are
unused). Any auto-config is only trustworthy if schema, UI, and generators read **one**
map.

**Proposal:** add `js/state/dawProfile.js` exporting the canonical map, and have
`stateSchema.js` import its channel defaults instead of hard-coding them.

```js
// js/state/dawProfile.js  (proposed)
export const DAW_PROFILE = {
  keyboard:   { ch: 1,  role: 'Keys',   instrument: 'piano/keys' },
  chordpads:  { ch: 1,  role: 'Keys',   instrument: 'piano/keys' }, // shares Ch 1
  bass:       { ch: 2,  role: 'Bass',   instrument: 'bass synth' },
  arp:        { ch: 3,  role: 'Arp',    instrument: 'pluck/arp' },
  pad:        { ch: 4,  role: 'Pad',    instrument: 'pad/drone' },
  swell:      { ch: 5,  role: 'Swell',  instrument: 'strings/swell' },
  looper:     { ch: 6,  role: 'Looper', instrument: 'neutral synth' },
  percussion: { ch: 10, role: 'Drums',  instrument: 'Drum Rack',
                drumNotes: { kick: 36, snare: 38, shaker: 55 } },
};
```

**Two source-of-truth concepts, kept distinct:**

1. **Default channel per module type** — the map above. Consumed by `stateSchema.js` for
   *new* songs/modules only.
2. **Live layout** — a new `app.getDawLayout()` that returns the *currently active*
   modules with their *current* channels (which the user may have customized). Consumed by
   the Setup panel, the `.als` generator, and the SysEx handshake. **Generators and the
   panel must always reflect live config, never the raw defaults.**

```js
// app.getDawLayout()  (proposed shape)
// Groups active modules by channel → one DAW track per distinct channel.
[
  { channel: 1,  label: 'Keys',  types: ['keyboard','chordpads'], instrument: 'piano/keys' },
  { channel: 2,  label: 'Bass',  types: ['bass'],                 instrument: 'bass synth' },
  { channel: 10, label: 'Drums', types: ['percussion'],          instrument: 'Drum Rack',
    drumNotes: [36, 38, 55] },
  // …
]
```

Reads from [`app._currentModules`](js/app.js) (`{id,type,label,active,config.chan}`) +
`app.moduleInstances`. Grouping by channel is what correctly collapses the three
percussion instances into one Drum Rack track and Keyboard+Chord Pads into one Keys track.

**Migration safety:** saved songs persist an explicit `chan` per module, so changing
defaults affects only *new* songs — existing user data is untouched. Recommendation:
**centralize first with current values (zero behavior change), then optionally rationalize
the numbers** (Open Question #1).

### 2.2 In-app "DAW Setup" panel + per-channel Test button

Highest value-per-effort feature, and it works in **every** DAW.

- New panel (lives in [`AppUiManager`](js/ui/appUiManager.js); drawer or modal) showing a
  table driven by `getDawLayout()`: **Channel → Role → Suggested instrument**, plus
  copy-paste setup text and a link to per-DAW instructions.
- A **Test** button per row that fires a short identify phrase on that channel so the user
  watches the correct DAW track light up:
  ```js
  // uses existing midi.sendNoteOn / sendNoteOff (midiManager.js#L204)
  midi.sendNoteOn(ch, 60, 100);  setTimeout(() => midi.sendNoteOff(ch, 60), 300);
  ```
  For the Drums row, fire the actual drum notes (36/38/55) instead of middle C.
- Optional "Test all" that walks channels low→high with a small gap.

This single feature kills the channel-mismatch support burden regardless of DAW.

---

## 3. Ableton Live (primary target)

### 3.1 Phase A — Ableton template (`.als`)  ← recommended first big win

Ship/generate a Live Set where each track is **pre-named, pre-coloured, pre-routed** to
"Flow Keys Out" on the correct channel, Monitor = In, armed, with a **stock-instrument
placeholder** (Drum Rack on the drums channel, etc.). The user opens it and plays; swapping
sounds is optional.

**Format facts (confident):**
- `.als` is **gzip of an XML file**; root element `<Ableton>`, tracks under
  `<LiveSet><Tracks>`, MIDI tracks are `<MidiTrack>`.
- Track name lives in `<Name><EffectiveName Value="…"/></Name>`; colour in
  `<Color Value="N"/>`.
- MIDI input routing (port + channel) and monitor/arm state live in the track's
  `<DeviceChain>` (`MidiInputRouting` `Target` + a channel routing field; a
  `MonitoringEnum`; an arm flag).

**Recommended authoring approach (low-risk): "author once, substitute."**
Rather than synthesising `.als` XML from scratch (the exact tag names and the
`MonitoringEnum`/arm integer values shift between Live versions), **build the template by
hand in Live once**, save it, ungzip it, and use it as a base. The generator then only
**string-substitutes** track *name*, *colour*, and *channel* per `getDawLayout()`. This
keeps us off the fragile parts of the schema. Maintain one base per supported Live major
version (e.g. 11 and 12).

**Two delivery modes:**
- **Static templates** shipped with the app (`templates/ableton/FlowKeys-Live12.als`) —
  covers the default layout, zero code beyond a download link.
- **Dynamic export** — "Export Ableton Set" button reads `getDawLayout()` and writes a set
  matching the *current* song's active modules/channels. In Electron, write via `fs`
  (extend the preload bridge); in the browser, gzip in-page (e.g. `pako` or
  `CompressionStream`) and trigger a File download.

**Instrument placeholders** (stock only): map each role to an Ableton stock device so the
template makes sound immediately — e.g. Keys→a piano rack, Bass→Operator bass, Arp→pluck,
Pad/Swell→Wavetable/Analog, **Drums→Drum Rack** with pads at 36/38/55. Advisory column
already in `DAW_PROFILE`.

**Limitations to state up front:** version-sensitive XML (mitigated by author-once);
stock devices only; one-way scaffold (no live re-sync — re-export to update).

### 3.2 Phase B — Max for Live "Companion" device (the bidirectional "magic button")

A `.amxd` device the user drops on any track. One button auto-builds the whole session via
the Live Object Model, and it can talk back to Flow Keys.

**Device responsibilities (LOM, via `LiveAPI` — confident these exist; verify exact
spellings against the M4L docs for the target Live version):**
- `live_set.call("create_midi_track", index)` per track in the layout.
- Set track `name`, `color`.
- Set `input_routing_type` to the entry matching **"Flow Keys Out"** and
  `input_routing_channel` to **"Ch. N"** (from `available_input_routing_types` /
  `available_input_routing_channels`).
- Set `current_monitoring_state` (In) and `arm`.
- *(Most fragile, make optional)* load a default instrument via the Live `Browser` API
  (`browser.load_item(...)` after navigating `browser.instruments`).

**Trade-offs:** requires Ableton **Suite** (or the M4L add-on), and a Max patch to build
and maintain. Distribution is a single `.amxd`. This is the premium experience layered on
top of the template, not a replacement for it.

### 3.3 Why not a Control Surface (Python) script?

Possible (the Remote Script API can create/modify tracks) but the wrong tool: that API is
built to let a controller *control* Live, the install path is fiddly, and it's
version-sensitive and under-documented. Prefer M4L for automation. Mentioned for
completeness; **not recommended.**

---

## 4. The handshake / config protocol (SysEx)

Needed only for the **bidirectional** paths (M4L companion, and optionally a Reaper
script). The `.als` template and the Setup panel do **not** need it.

Use a DAW-agnostic SysEx message on the non-commercial manufacturer ID `0x7D`. All payload
bytes are 7-bit (0–127); channels (1–16), type IDs, and ASCII name bytes all fit.

```
Flow Keys → DAW   "config announce"
  F0 7D 01 <count> [ <ch> <typeId> <nameLen> <name…> ] × count  F7

DAW → Flow Keys   "request config"   (e.g. M4L button asks Flow Keys to re-send)
  F0 7D 02 F7

DAW → Flow Keys   "ack / ready"
  F0 7D 03 F7
```

`typeId` is a small enum mirroring `DAW_PROFILE` keys (keyboard=1, bass=2, …). The
announce payload is just `getDawLayout()` serialised.

**Implementation notes (important):**
- `midiManager` has **no SysEx send path** today — `sendRawMessage()` only handles ≤2 data
  bytes ([midiManager.js#L217](js/midi/midiManager.js#L217)). Add a thin
  `sendSysEx(bytes)` that calls `_emit(bytes)` directly.
- Over the **native virtual port** (Electron), arbitrary byte arrays already flow through
  `_emit → _nativeSend → output.sendMessage(bytes)`, so SysEx works with no extra
  permission.
- Over **Web MIDI** (browser → IAC), sending SysEx requires
  `navigator.requestMIDIAccess({ sysex: true })`. The current call requests **no** sysex
  ([midiManager.js#L43](js/midi/midiManager.js#L43)); the Electron main already grants the
  `midiSysex` permission. Flip this on only if/when the SysEx paths ship.
- To *receive* DAW→app messages, route SysEx in
  [`processMidiMessage`](js/engine/performanceEngine.js#L52) /
  [`midiActionRouter`](js/midi/midiActionRouter.js) to a new handler.

---

## 5. Other DAWs (secondary)

- **Reaper** — easiest after Ableton. Track templates (`.RTrackTemplate`) are plain text;
  channel-filtered MIDI input is straightforward. Generate from `getDawLayout()` with the
  same author-once-substitute approach. Good second template target.
- **Logic / Cubase / Studio One / Bitwig** — each has its own template format and routing
  model (Logic in particular routes by track/environment rather than a simple per-track
  channel filter). Realistic plan: **the Setup panel + Test tones is the universal answer**
  here; add native templates later only if there's demand.

---

## 6. Touch-points summary (what changes, by file)

| Area | File(s) | Change |
|---|---|---|
| Canonical map | **new** `js/state/dawProfile.js` | Export `DAW_PROFILE` |
| Defaults read from map | `js/state/stateSchema.js` | Import channels from `DAW_PROFILE` |
| Live layout | `js/app.js` | Add `getDawLayout()` (group active modules by channel) |
| Setup panel + Test | `js/ui/appUiManager.js`, `index.html`, `css/styles/*` | New panel; Test uses `midi.sendNoteOn` |
| SysEx send (Phase B) | `js/midi/midiManager.js` | `sendSysEx()`; maybe `requestMIDIAccess({sysex:true})` |
| SysEx receive (Phase B) | `js/engine/performanceEngine.js`, `js/midi/midiActionRouter.js` | Parse `F0 7D …` |
| `.als` export (Phase A, dynamic) | **new** generator + `electron/preload.js`/`main.js` (fs write) | Read layout → gzip → file |
| Static templates | **new** `templates/ableton/*.als`, `templates/reaper/*` | Shipped assets |

---

## 7. Recommended sequencing

1. **Foundation** — `dawProfile.js` + `getDawLayout()` + Setup panel with Test tones.
   Universal, low-risk, unblocks everything. (§2)
2. **Ableton static template** authored-once, shipped as a download. Biggest friction drop
   for the most users. (§3.1)
3. **Dynamic `.als` export** matching the current song. (§3.1)
4. **Reaper template.** (§5)
5. **SysEx protocol + M4L companion** — the premium Ableton-Suite experience. (§4, §3.2)

Front-loads the broad, safe wins; defers the version-sensitive / Suite-gated pieces.

---

## 8. Open questions (need your call)

1. **Rationalise default channels, or keep current?** Centralising is zero-risk either
   way (existing songs store explicit channels). The proposed map (§2.1) is contiguous and
   fixes the Looper-on-"Drums"-Ch-10 oddity, but differs from today's out-of-box numbers.
2. **Static templates, dynamic export, or both?** Static is near-zero code; dynamic matches
   custom layouts but needs gzip + file I/O wiring.
3. **Which Live version(s) to target** for the base template — 12 only, or 11 + 12?
4. **Drums channel:** keep percussion on Ch 3 (current default) or move to Ch 10 to match
   the GM-drums convention and the existing UI label? (Tied to #1.)
5. **Browser parity:** the seamless story assumes the Electron host (native port + fs). How
   much do we invest in the plain-browser path (IAC docs, in-page gzip download)?
6. **M4L scope:** is requiring Ableton Suite acceptable for the "magic button," given the
   template already covers all editions?

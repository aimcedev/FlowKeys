# Module "Mini-Plugin" Redesign — Design Doc

Status: **proposal / not started**
Author: design pass, 2026-05-29
Scope: make the generator module cards feel like a cohesive family of mini-plugins, with real QOL wins along the way. No new dependencies, no build step — stays within the plain-ES6 model.

---

## 1. Diagnosis — why the cards feel "plain"

The cards are *not* short on features. Each already has a real channel strip (vertical fader + dB readout, pan knob, mute/solo, peak meter) built in [`buildCard()`](../js/ui/moduleCardBuilder.js#L431), live meters driven by [`triggerMeter()`](../js/ui/modulesGridController.js#L606), and per-type visualizers (oscilloscope / note-bars / looper).

The flatness comes from three specific things:

1. **Weak identity.** A module's entire personality is a 12px colored dot + an accent color (`--mod-color`, defined per type in [`theme.css`](../css/theme.css#L24)). Bass, Swell, and Looper are structurally identical rectangles. Nothing announces *what instrument this is* at a glance.
2. **One control vocabulary for everything.** Nearly every parameter is a grey `<select>` dropdown (see [`_getModuleContent()`](../js/ui/moduleCardBuilder.js#L37)). Continuous, musical values — Density, Whammy depth, Octave, Attack/Hold/Release, Fade Curve — are buried in identical dropdowns. Nothing feels tactile, and the cards don't visually differentiate.
3. **The hero area is fragmented.** Some cards get Main/Advanced tabs, some get a sequencer, some an oscilloscope, some note-bars, some nothing — with no shared framing. That is what reads as "grab-bag" instead of "a family of plugins."

**Conclusion:** the fix is not *more stuff*. It's a **shared plugin shell** + a **small reusable control-primitive kit**, then a cheap signature touch per module.

---

## 1b. Visual audit (from the current rendered UI)

Observations from a screenshot of EDIT mode with all modules added and toggled off — these sharpen the plan:

1. **The OFF state is lifeless.** With every toggle off there is *zero* color on any card (grey title dots, no accent). But the dormant state is what you look at most while building a rig — cards must carry identity even when inactive, not only via `.module-card.active`.
2. **The palette already has the color language the cards lack.** The left-sidebar tiles show a colored left-edge bar per type (`.palette-tile-bar`); the card drops it entirely. Carrying that bar/color onto the card itself is a near-free cohesion win and ties the two views together.
3. **The channel strip is the loudest, least-informative element.** The tall fader + dB scale dominates every card visually, yet it's identical across all of them and isn't what the module is *about*. It should be present but quieter (narrower, lower contrast, or collapsible) so the module's identity can lead.
4. **Idle = dead black boxes.** Bass and Drone render large empty viz rectangles at rest. The display region (A3) should show something meaningful at idle — Bass's range as a mini-keyboard, Drone's root–fifth as a chord name — instead of a void.
5. **The sequencer cards already look the most alive** purely from their colored step bars (Arp magenta, Kick/Snare/Shaker orange). That's the proof of concept for Phase 4: every card wants a signature colored visual.
6. **The transport bar is the internal quality bar.** The top strip (pill buttons, grouped clusters, color accents, the purple Flow pill) is cohesive and polished. The cards should rise to meet that same level of finish — reuse its pill/segmented styling for the Phase 2 control kit.

---

## 2. Phase 1 — Cohesion shell (foundation, lowest risk)

Mostly layout/CSS work in [`moduleCardBuilder.js`](../js/ui/moduleCardBuilder.js) and [`02-workspace-modules-sequencer.css`](../css/styles/02-workspace-modules-sequencer.css). Does not touch config read/write logic.

### A1. Plugin "faceplate" header
Current header is `drag-handle · dot · title · toggle · ×`. Upgrade it to a tinted header band using the existing `--mod-color`:

- **Per-type SVG glyph** — a small icon set is the single fastest cohesion win:
  | Type | Glyph idea |
  |---|---|
  | bass | bass clef |
  | arp | stairs / lightning |
  | pad | stacked sine waves |
  | percussion | drum circle (kick/snare/shaker variants) |
  | looper | loop arrows |
  | swell | envelope curve |
  | keyboard | piano keys |
- **Output channel → header chip** (e.g. `CH 8`). Today the channel dropdown eats the prime first control row on *every* card (`_chanOptions`). In real plugins the channel is a small badge, not a hero control. Moving it frees real estate and adds cohesion. (Keep the full dropdown reachable — e.g. click the chip to open it, or relocate it to the channel strip.)
- **Title dot → live output LED.** It currently only reflects `active` state via `.module-card.active .module-title-dot` ([CSS](../css/styles/02-workspace-modules-sequencer.css#L571)). Wire it to `triggerMeter` so it flickers on *actual* MIDI output.

### A3. Consistent "display" region
Frame every hero viz (oscilloscope / sequencer / looper / note-bars) in the same bezel with a consistent label + a **live readout**:
- bass/pad/swell scope → `E1 · 41 Hz`
- arp/percussion sequencer → `Step 6/16`
- looper → `2 bars · 00:04`

Cohesion comes from the shared *frame*, not the contents. The bezel can reuse the existing `.freq-viz-container` / `.looper-viz-container` treatment, unified into one class.

---

## 3. Phase 2 — Control-primitive kit (biggest "feel" win)

Add a small set of reusable controls used across *all* cards instead of raw `<select>`s. This is the change that actually makes them *feel* like plugins. It touches [`readModuleFromDom()`](../js/ui/modulesGridController.js#L400) and [`_syncModuleConfigFromDom()`](../js/ui/modulesGridController.js#L451), so a bit more care is needed (each primitive needs a `data-control`-compatible value the existing `val()`/`checked()` readers can pull).

- **Knob** — generalize the existing pan knob (drag + SVG arc) at [`moduleCardBuilder.js:452`](../js/ui/moduleCardBuilder.js#L452) and its drag handler at [`modulesGridController.js:265`](../js/ui/modulesGridController.js#L265) into a reusable component. Use for Density, Whammy depth, Octave shift, etc.
- **Segmented toggle** — for small enums: Mode (Chord/Up), Notes (2/3), Fade Mode (Manual/Auto).
- **Mini horizontal slider** — for ms-times (Attack/Hold/Release) with the value inline. Replaces the `kb-transition-input` number boxes.
- Keep `<select>` only for genuinely long lists (the 0–127 note pickers in [`populateNoteSelects()`](../js/ui/moduleCardBuilder.js#L513), Key Center).

**Implementation note:** define each primitive to read/write via the same `data-control="…"` attribute and expose `.value` (or a `dataset` value, like the pan knob's `data-pan-value`) so the existing DOM-reading code keeps working with minimal change. Add `dblclick`-to-reset for all of them (volume/pan already do this at [`modulesGridController.js:211`](../js/ui/modulesGridController.js#L211)).

---

## 4. Phase 3 — QOL improvements (prioritized by payoff)

1. **Collapse/minimize a card** to header + meter only. With a full rig (8+ modules) the grid is overwhelming; a plugin-style minimize chevron is the highest-value QOL item. Persist collapsed state in module `config` (schema is v2 in [`stateSchema.js`](../js/state/stateSchema.js); a new `config.collapsed` field is additive, no migration needed).
2. **Generic per-module preset / init for *all* types.** Today only arp & percussion have presets ([`buildPresetPanelHtml()`](../js/ui/moduleCardBuilder.js#L17), stored under `flowKeysModulePresets`). A generic "save this module's settings / recall / reset to default" works for every type and is very plugin-like.
3. **A/B settings compare** — generalize the Keyboard module's two-scene crossfade idea into a card-level A/B snapshot toggle. Big for live tweaking.
4. **Hover tooltips / inline help** on cryptic options (Whammy, "Best interval", the curve names in Swell/Keyboard). Cheap, large usability gain.
5. **Bypass vs Off** — a true bypass (keep config live but stop generating) distinct from the on/off toggle.
6. **Copy settings between modules** — verify/clean up the copy-paste in [`contextActionsController.js`](../js/ui/contextActionsController.js) and surface it as a card affordance.

---

## 5. Phase 4 — Per-module signature touches

Cheap, high-identity flourishes once the shell + kit exist:

| Module | Signature touch |
|---|---|
| **Bass** | Big current-note readout over the scope (`E1`); range shown as a mini keyboard strip |
| **Arp** | "Now playing" note chip; pattern-length pips alongside the existing playhead glow |
| **Pad** | Show the actual root–fifth voicing as a chord name (`C–G`) |
| **Percussion** | Tiny drum-face icon so kick/snare/shaker differ visually, not just by color |
| **Looper** | Elapsed/remaining time + bar count on the waveform |
| **Swell** | Draw the *actual* attack/hold/release envelope shape live as the hero viz instead of a generic scope — this is the module's whole identity |
| **Keyboard** | Visualize the two scenes as A↔B with the crossfade position marker tied to the mod wheel |

---

## 6. Recommended sequencing & risk

| Phase | Risk | Files | Payoff |
|---|---|---|---|
| 1 — Cohesion shell | Low (layout/CSS) | `moduleCardBuilder.js`, `02-workspace-modules-sequencer.css`, `theme.css` | Instant "one family" look |
| 2 — Control kit | Medium (config read/write) | `moduleCardBuilder.js`, `modulesGridController.js` | Biggest tactile/feel win |
| 3 — QOL | Low–Medium | grid controller, card builder, `stateSchema.js`, preset manager | Day-to-day usefulness |
| 4 — Signatures | Low | per-module viz components in `js/components/` | Distinct identity per module |

Suggested order: **1 → 2 → 3 → 4** (or 1 → 3 if QOL matters more than feel right now).

## 7. Constraints to respect

- No build step; plain ES6 modules served by `dev_server.py`. Bump `?v=NN` cache-busters in `index.html` when changing cached files.
- Must behave identically in the browser and Electron host; don't introduce native-MIDI assumptions into the default path.
- Module config changes propagate to all sections in a song (`PresetManager.propagate*` in `app.js`) — any new per-module fields must round-trip through `readModuleFromDom` / `setConfig`.
- Keep shaker velocity humanization (±5) and other "Notable Behaviors to Preserve" from `CLAUDE.md` intact.

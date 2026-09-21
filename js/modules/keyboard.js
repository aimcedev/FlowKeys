/**
 * KeyboardModule — duplicates keyboard input to a second MIDI channel with
 * chord-aware voicing (inversion, filter, octave shift, mod wheel).
 *
 * Voicing model: hybrid press-time + debounced chord settle.
 *
 * On note-on:  play the note immediately at its press-time computed position,
 *              then schedule a 30 ms debounced re-voice.  Multiple notes pressed
 *              within that window share one settle event — so simultaneous chord
 *              hits don't sforzando each other.
 *
 * On note-off: release the note at its locked pitch immediately. No re-voice —
 *              this eliminates the "ghost chord on release" artifact.
 *
 * Debounced re-voice: after chord settles, diff old vs new voicing and
 *              re-strike moved notes at ~82% velocity (sounds like a re-strum,
 *              not a fresh full attack).
 */
import { applyEasing } from '../utils/easing.js';
import { SUSTAIN_CC, MOD_WHEEL_CC } from '../utils/midiConstants.js';

export class KeyboardModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;

    this.channel = 5;
    this.octave = 0;
    // 0=root, 1=1st inv, 2=2nd inv, 3=drop2 (open), 4=spread (alternating)
    this.inversion = 0;
    this.filterMode = 'none';
    this.filterCount = 1;
    this.modWheelValue = 0;
    this.transitionMs = 500;
    this.fadeMode = 'auto';  // 'manual' | 'auto'
    this.fadeCurve = 'ease-in'; // see js/utils/easing.js for options
    this.volume = 100;

    // Map: inputNote → outputNote (null = filtered / out of MIDI range)
    this._noteMap = new Map();
    // Notes physically released while sustain pedal is held — still sounding
    this._sustainHeld = new Set();

    this._lastVelocity = 100;
    this._lastState = null;
    this._currentModWheel = 0;
    this._modTransition = null;
    this._reVoiceTimer = null;
    // Set when a scene-change preemptive fade has been started externally so
    // setConfig knows not to restart the transition for the same target.
    this._pendingModWheelTarget = null;
  }

  setConfig(channel, octave, inversion, filterMode, filterCount, modWheelValue, transitionMs, fadeMode, fadeCurve) {
    const oldChannel = this.channel;
    const prevTarget = this.modWheelValue;

    this.channel     = parseInt(channel, 10);
    this.octave      = parseInt(octave, 10);
    this.inversion   = parseInt(inversion, 10);
    this.filterMode  = filterMode || 'none';
    this.filterCount = Math.max(1, parseInt(filterCount, 10) || 1);
    this.transitionMs = Math.max(0, parseInt(transitionMs, 10) || 0);
    this.fadeMode    = fadeMode === 'auto' ? 'auto' : 'manual';
    this.fadeCurve   = fadeCurve || 'ease-in';
    this.modWheelValue = Math.max(0, Math.min(127, parseInt(modWheelValue, 10) || 0));

    if (!this.isActive) return;

    if (oldChannel !== this.channel) {
      this._stopAll(oldChannel);
    }

    if (this.modWheelValue !== prevTarget) {
      if (this._pendingModWheelTarget !== null && this._pendingModWheelTarget === this.modWheelValue) {
        // A preemptive scene-fade transition is already heading to this exact target — let it finish.
        this._pendingModWheelTarget = null;
      } else {
        this._pendingModWheelTarget = null;
        this._startModWheelTransition(this._currentModWheel, this.modWheelValue, this.transitionMs, this.fadeCurve);
      }
    } else {
      this._pendingModWheelTarget = null;
    }

    // Setting change: re-voice held notes immediately
    if (this._noteMap.size > 0 && this._lastState) {
      this._cancelReVoice();
      const { activeNotes, sustainedNotes } = this._lastState;
      this._applyChordVoicing(activeNotes, sustainedNotes);
    }
  }

  toggle(active) {
    this.isActive = active;
    if (active) {
      this._currentModWheel = this.modWheelValue;
      this.midi.sendCC(this.channel, MOD_WHEEL_CC, this._currentModWheel);
    } else {
      this._cancelReVoice();
      this._stopAll();
      if (this._modTransition !== null) {
        cancelAnimationFrame(this._modTransition);
        this._modTransition = null;
      }
      this._pendingModWheelTarget = null;
    }
  }

  /**
   * Immediately send the given mod wheel value and cancel any running transition.
   * Called while the user drags the slider so CC messages stream in real time.
   */
  setModWheelImmediate(val) {
    if (this._modTransition !== null) {
      cancelAnimationFrame(this._modTransition);
      this._modTransition = null;
    }
    this._pendingModWheelTarget = null;
    const clamped = Math.max(0, Math.min(127, Math.round(val)));
    this._currentModWheel = clamped;
    this.modWheelValue = clamped;
    if (this.isActive) this.midi.sendCC(this.channel, MOD_WHEEL_CC, clamped);
  }

  /**
   * Start a mod wheel fade toward targetValue with the given duration, and
   * record the target so setConfig skips restarting the same transition when
   * the scene eventually applies at the bar boundary.
   */
  startPreemptiveTransition(targetValue, durationMs) {
    const target = Math.max(0, Math.min(127, Math.round(parseInt(targetValue, 10) || 0)));
    this._pendingModWheelTarget = target;
    this._startModWheelTransition(this._currentModWheel, target, durationMs, this.fadeCurve);
  }

  processState(state) {
    this._lastState = state;
    if (!this.isActive) return;

    const { latestEvent, activeNotes, sustainedNotes, sustainDown } = state;
    if (!latestEvent) {
      if (this._noteMap.size === 0 && (activeNotes.size > 0 || sustainedNotes.size > 0)) {
        this._applyChordVoicing(activeNotes, sustainedNotes);
      }
      return;
    }

    const cmd = latestEvent.status >> 4;

    if (cmd === 8 || cmd === 9) {
      if (latestEvent.isNoteOn) {
        this._handleNoteOn(latestEvent.note, latestEvent.velocity, activeNotes, sustainedNotes);
      } else {
        this._handleNoteOff(latestEvent.note, sustainDown);
      }
    } else if (cmd === 11 && latestEvent.note === SUSTAIN_CC && !sustainDown) {
      this._handleSustainOff();
    }
  }

  // ── Private event handlers ─────────────────────────────────────────────────

  _handleNoteOn(note, velocity, activeNotes, sustainedNotes) {
    this._lastVelocity = velocity;

    // Re-pressing a sustained note: cut old output so it retriggers cleanly
    if (this._sustainHeld.has(note)) {
      this._sustainHeld.delete(note);
      const oldOut = this._noteMap.get(note);
      if (oldOut != null) this.midi.sendNoteOff(this.channel, oldOut);
      this._noteMap.delete(note);
    }

    // Play immediately at press-time computed position (stable, no stutter)
    const out = this._computeSingleNoteOutput(note, activeNotes, sustainedNotes);
    this._noteMap.set(note, out);
    if (out !== null) this.midi.sendNoteOn(this.channel, out, velocity);

    // Schedule a chord-settle re-voice; resets if more notes arrive within 30 ms
    this._scheduleReVoice();
  }

  _handleNoteOff(note, sustainDown) {
    if (!this._noteMap.has(note)) return;

    if (sustainDown) {
      this._sustainHeld.add(note);
      return;
    }

    // Cancel any pending re-voice — don't re-voice remaining notes on release
    this._cancelReVoice();

    const out = this._noteMap.get(note);
    if (out !== null) this.midi.sendNoteOff(this.channel, out);
    this._noteMap.delete(note);
  }

  _handleSustainOff() {
    this._cancelReVoice();
    for (const note of this._sustainHeld) {
      const out = this._noteMap.get(note);
      if (out !== null) this.midi.sendNoteOff(this.channel, out);
      this._noteMap.delete(note);
    }
    this._sustainHeld.clear();
  }

  // ── Debounced chord-settle re-voice ───────────────────────────────────────

  _scheduleReVoice() {
    if (this._reVoiceTimer !== null) clearTimeout(this._reVoiceTimer);
    this._reVoiceTimer = setTimeout(() => {
      this._reVoiceTimer = null;
      if (this.isActive && this._noteMap.size > 0 && this._lastState) {
        const { activeNotes, sustainedNotes } = this._lastState;
        this._applyChordVoicing(activeNotes, sustainedNotes);
      }
    }, 30);
  }

  _cancelReVoice() {
    if (this._reVoiceTimer !== null) {
      clearTimeout(this._reVoiceTimer);
      this._reVoiceTimer = null;
    }
  }

  // ── Output computation ─────────────────────────────────────────────────────

  /**
   * Compute this note's output based on its position in the current full chord.
   * Called once per note-press; the result is locked until released or re-voiced.
   */
  _computeSingleNoteOutput(note, activeNotes, sustainedNotes) {
    const all = [...new Set([
      ...Array.from(activeNotes.keys()),
      ...sustainedNotes,
    ])].sort((a, b) => a - b);

    const pos = all.indexOf(note);
    const total = all.length;

    if (this.filterMode === 'bottom' && pos < this.filterCount) return null;
    if (this.filterMode === 'top'    && pos >= total - this.filterCount) return null;

    const postFilter = all.filter((_, i) => {
      if (this.filterMode === 'bottom' && i < this.filterCount) return false;
      if (this.filterMode === 'top'    && i >= total - this.filterCount) return false;
      return true;
    });
    const invPos = postFilter.indexOf(note);
    const n = postFilter.length;

    let out = note + this.octave * 12;

    switch (this.inversion) {
      case 1: if (invPos === 0) out += 12; break;
      case 2: if (invPos <= 1) out += 12; break;
      case 3: if (n >= 3 && invPos === n - 2) out -= 12; break;
      case 4: if (invPos % 2 === 1) out += 12; break;
    }

    return (out >= 0 && out <= 127) ? out : null;
  }

  /**
   * Compute the output note for every input note in the current chord.
   * Used for settle re-voice and setConfig re-voice.
   *
   * Inversion modes:
   *   0 — Root:    no change
   *   1 — 1st Inv: lowest note  +12  (3rd becomes bass)
   *   2 — 2nd Inv: two lowest   +12  (5th becomes bass)
   *   3 — Drop 2:  2nd highest  −12  (opens the voicing; needs ≥3 notes)
   *   4 — Spread:  odd-indexed  +12  (alternating low/high, very wide)
   */
  _computeChordMap(activeNotes, sustainedNotes) {
    const all = [...new Set([
      ...Array.from(activeNotes.keys()),
      ...sustainedNotes,
    ])].sort((a, b) => a - b);

    const filtered = all.filter((_, i) => {
      if (this.filterMode === 'bottom' && i < this.filterCount) return false;
      if (this.filterMode === 'top'    && i >= all.length - this.filterCount) return false;
      return true;
    });

    const n = filtered.length;
    const map = new Map();

    for (const note of all) {
      if (!filtered.includes(note)) map.set(note, null);
    }

    filtered.forEach((note, i) => {
      let out = note + this.octave * 12;

      switch (this.inversion) {
        case 1: if (i === 0) out += 12; break;
        case 2: if (i <= 1) out += 12; break;
        case 3: if (n >= 3 && i === n - 2) out -= 12; break;
        case 4: if (i % 2 === 1) out += 12; break;
      }

      map.set(note, (out >= 0 && out <= 127) ? out : null);
    });

    return map;
  }

  /**
   * Diff old voicing against freshly computed one. Sends note-offs for
   * removed/changed notes, note-ons for new/changed. Re-voiced notes
   * get ~82% velocity — audible as a re-strum, not a fresh hard attack.
   */
  _applyChordVoicing(activeNotes, sustainedNotes) {
    const oldMap = this._noteMap;
    const newMap = this._computeChordMap(activeNotes, sustainedNotes);

    for (const [inputNote, oldOut] of oldMap) {
      const newOut = newMap.get(inputNote);
      if (newOut === undefined || newOut !== oldOut) {
        if (oldOut !== null) this.midi.sendNoteOff(this.channel, oldOut);
      }
    }

    this._noteMap = newMap;

    for (const [inputNote, newOut] of newMap) {
      if (newOut === null) continue;
      const oldOut = oldMap.get(inputNote);

      if (oldOut === undefined) {
        this.midi.sendNoteOn(this.channel, newOut, this._lastVelocity);
      } else if (oldOut !== newOut) {
        const vel = Math.max(30, Math.round(this._lastVelocity * 0.82));
        this.midi.sendNoteOn(this.channel, newOut, vel);
      }
    }
  }

  _stopAll(channel = this.channel) {
    for (const [, out] of this._noteMap) {
      if (out !== null) this.midi.sendNoteOff(channel, out);
    }
    this._noteMap.clear();
    this._sustainHeld.clear();
  }

  // ── Mod wheel smooth transition ────────────────────────────────────────────

  _startModWheelTransition(from, to, durationMs, curve = 'ease-in') {
    if (this._modTransition !== null) {
      cancelAnimationFrame(this._modTransition);
      this._modTransition = null;
    }

    if (durationMs <= 0 || from === to) {
      this._currentModWheel = to;
      if (this.isActive) this.midi.sendCC(this.channel, MOD_WHEEL_CC, to);
      return;
    }

    const startTime = performance.now();
    const startVal = from;

    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = applyEasing(t, curve);
      const val = Math.round(startVal + (to - startVal) * eased);

      if (val !== this._currentModWheel) {
        this._currentModWheel = val;
        if (this.isActive) this.midi.sendCC(this.channel, MOD_WHEEL_CC, val);
      }

      if (t < 1) {
        this._modTransition = requestAnimationFrame(tick);
      } else {
        this._modTransition = null;
        this._pendingModWheelTarget = null;
      }
    };

    this._modTransition = requestAnimationFrame(tick);
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  panic() {
    this._cancelReVoice();
    this._stopAll();
    if (this._modTransition !== null) {
      cancelAnimationFrame(this._modTransition);
      this._modTransition = null;
    }
    this._pendingModWheelTarget = null;
    this._currentModWheel = 0;
    this.midi.sendCC(this.channel, MOD_WHEEL_CC, 0);
    this.isActive = false;
  }
}

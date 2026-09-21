/**
 * LooperModule — records keyboard MIDI input for a set number of bars and
 * loops it back seamlessly on a dedicated output channel.
 *
 * State machine:
 *   idle → arm() → armed → (next bar boundary) → recording → (bars full) → playing
 *
 * Sustain edge cases handled:
 *   • Sustain held at record START  → injected as sustainOn at pulse 0
 *   • Notes held at record START    → injected as noteOn at pulse 0
 *   • Sustain held at record END    → sustainOff + all noteOffs injected at loop boundary
 *   • Loop boundary during playback → sustainOff + all noteOffs before restart
 *
 * Pass-through muting:
 *   The module fires onPlaybackActive(true/false) so the app can mute the
 *   engine's pass-through channel while the loop is playing.
 *
 * resetPhase() timing note:
 *   resetPhase() is called from onBar callbacks (which fire BEFORE onTick in
 *   clock._tick()). At that moment, _lastPulse is still T-1. To avoid setting
 *   _playStartPulse one tick early (which causes elapsed=1 on the first
 *   _tickPlayback call, smashing pulse-0 and pulse-1 events together), we set
 *   _pendingSync = true and defer the _playStartPulse assignment to the very
 *   first onTick(step) that fires. This correctly handles both the bar-alignment
 *   activation path AND the flow-mode clock-restart path (where the next step
 *   is 0, not _lastPulse+1).
 */
import { SUSTAIN_CC } from '../utils/midiConstants.js';

export class LooperModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;
    this.isTempoBased = true;

    // Config
    this.channel = 8;
    this.bars = 2;
    this.quantizeDivision = 6; // pulses; 0=off, 3=32nd, 6=16th, 12=8th, 24=quarter

    // Clock timing
    this._ppq = 24;
    this._pulsesPerBar = 96; // default 4/4
    this.volume = 100;

    // State machine
    this._looperState = 'idle'; // 'idle' | 'armed' | 'recording' | 'playing'

    // Recording internals
    this._loopStartPulse = 0;
    this._loopLengthPulses = 0;
    this._recordBuffer = [];    // { pulse, type, note, velocity }
    this._lastPulse = 0;        // most recent clock step seen in onTick
    this._currentSustainDown = false;
    this._currentActiveNotes = new Map();
    this._recSustainDown = false;
    this._recActiveNotes = new Set();

    // Playback internals
    this._playEvents = [];      // quantized, sorted copy of record buffer
    this._playStartPulse = 0;
    this._playEventIdx = 0;
    this._currentLoop = -1;
    this._lastPlayheadPulse = -1;
    this._playActiveNotes = new Set();
    this._playSustainDown = false;
    // _pendingSync: set by resetPhase(); cleared on first onTick after activation.
    // Defers _playStartPulse assignment so elapsed is always 0 on the first playback tick,
    // regardless of whether we were activated from onBar or a clock-restart path.
    this._pendingSync = false;
    // _waitingForBar: set by direct toggle(true) calls when clock is already running.
    // Holds playback until the next bar boundary for a clean musical entry.
    this._waitingForBar = false;

    // Callbacks (registered by the UI layer after instantiation)
    this.onLooperStateChange = null;   // (state: string) => void
    this.onProgress = null;            // (fillFraction: 0-1, headFraction: 0-1) => void
    this.onPlaybackActive = null;      // (active: boolean) => void  — for pass-through mute
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  setConfig(channel, bars, quantizeDivision) {
    this.channel = parseInt(channel, 10);
    this.bars = parseInt(bars, 10);
    this.quantizeDivision = parseInt(quantizeDivision, 10);
  }

  setTimeSignature(sig) {
    const ppq = this._ppq;
    if (sig === '3/4') {
      this._pulsesPerBar = ppq * 3;
    } else if (sig === '6/8') {
      this._pulsesPerBar = (ppq / 2) * 6; // = ppq * 3
    } else {
      this._pulsesPerBar = ppq * 4;
    }
  }

  // Called from onBar (before onTick) when the module is activated via pendingModuleActivations,
  // or from flow-mode before a clock restart. Does NOT set _playStartPulse — that is deferred
  // to the very next onTick via _pendingSync so elapsed is always 0 on the first playback tick.
  resetPhase() {
    if (this._looperState === 'playing') {
      this._silenceAll();
      this._playEventIdx = 0;
      this._currentLoop = 0;
      this._lastPlayheadPulse = -1;
      this._playActiveNotes.clear();
      this._playSustainDown = false;
      this._waitingForBar = false;
      this._pendingSync = true;
    }
  }

  toggle(active) {
    this.isActive = active;
    if (!active) {
      this._silenceAll();
      this._pendingSync = false;
      if (this._looperState !== 'playing') {
        this._fullReset();
      } else {
        this._waitingForBar = false;
        this._notifyPlaybackActive(false);
      }
    } else if (this._looperState === 'playing') {
      // Direct toggle(true) path (only reached when clock is not running, since the
      // UI and MIDI paths both use pendingModuleActivations when the clock is running).
      // Wait for the next bar boundary for a clean musical entry.
      this._waitingForBar = true;
    }
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  panic() {
    this._silenceAll();
    // Abort an in-progress recording cleanly but preserve any completed loop.
    if (this._looperState === 'recording') {
      this._recordBuffer = [];
      this._recActiveNotes.clear();
      this._recSustainDown = false;
      this._setState('idle');
    }
    this._pendingSync = false;
    this._waitingForBar = false;
    this.isActive = false;
  }

  // Returns a snapshot of the current loop if playing, so it can be cached per section.
  getLoopSnapshot() {
    if (this._looperState !== 'playing') return null;
    return {
      playEvents: [...this._playEvents],
      loopLengthPulses: this._loopLengthPulses,
      bars: this.bars,
    };
  }

  // Restores a previously saved loop snapshot and resumes playback.
  restoreLoopSnapshot(snapshot) {
    if (!snapshot?.playEvents?.length || !this.isActive) return;
    this._playEvents = [...snapshot.playEvents];
    this._loopLengthPulses = snapshot.loopLengthPulses;
    this.bars = snapshot.bars;
    // restoreLoopSnapshot is called from onBar, which fires before onTick.
    // _lastPulse is still T-1 at this point; the next onTick will be T.
    // Setting _playStartPulse = T ensures elapsed=0 on that first tick
    // so pulse-0 events fire on the bar boundary, not one pulse late.
    this._playStartPulse = this._lastPulse + 1;
    this._playEventIdx = 0;
    this._currentLoop = 0;
    this._lastPlayheadPulse = -1;
    this._playActiveNotes.clear();
    this._playSustainDown = false;
    this._pendingSync = false;
    this._waitingForBar = false;
    this._looperState = 'playing';
    if (this.onLooperStateChange) this.onLooperStateChange('playing');
    this._notifyPlaybackActive(true);
  }

  // ── Public transport ───────────────────────────────────────────────────────

  /** Primary button: cycles arm → cancel / stop-early / re-arm */
  arm() {
    switch (this._looperState) {
      case 'idle':
        this._setState('armed');
        this._recordBuffer = [];
        this._recActiveNotes.clear();
        this._recSustainDown = false;
        break;

      case 'armed':
        // Cancel arm
        this._setState('idle');
        break;

      case 'recording':
        // Stop early — finish recording with whatever is in the buffer so far
        this._finishRecording();
        break;

      case 'playing':
        // Discard loop and re-arm for a fresh recording
        this._silenceAll();
        this._notifyPlaybackActive(false);
        this._recordBuffer = [];
        this._recActiveNotes.clear();
        this._recSustainDown = false;
        this._pendingSync = false;
        this._waitingForBar = false;
        this._setState('armed');
        break;
    }
  }

  /** Clear / stop button: always returns to idle and silences output */
  clear() {
    this._fullReset();
  }

  // ── MIDI input ─────────────────────────────────────────────────────────────

  processState(state) {
    // Always track sustain / active notes so we can inject them at record start
    this._currentSustainDown = state.sustainDown;
    this._currentActiveNotes = state.activeNotes || new Map();

    if (!this.isActive || this._looperState !== 'recording') return;

    const { latestEvent } = state;
    if (!latestEvent) return;

    const cmd = latestEvent.status >> 4;
    const pulse = this._relPulse();

    if (cmd === 11 && latestEvent.note === SUSTAIN_CC) {
      // Sustain CC
      this._recSustainDown = state.sustainDown;
      this._recordBuffer.push({
        pulse,
        type: state.sustainDown ? 'sustainOn' : 'sustainOff',
        note: SUSTAIN_CC,
        velocity: latestEvent.velocity,
      });

    } else if (cmd === 9 && latestEvent.isNoteOn) {
      this._recordBuffer.push({ pulse, type: 'noteOn', note: latestEvent.note, velocity: latestEvent.velocity });
      this._recActiveNotes.add(latestEvent.note);

    } else if (cmd === 8 || (cmd === 9 && !latestEvent.isNoteOn)) {
      this._recordBuffer.push({ pulse, type: 'noteOff', note: latestEvent.note, velocity: 0 });
      this._recActiveNotes.delete(latestEvent.note);
    }
  }

  // ── Clock tick ─────────────────────────────────────────────────────────────

  onTick(step, ppq, when) {
    this._ppq = ppq;
    this._lastPulse = step;
    if (!this.isActive) return;

    if (this._looperState === 'armed') {
      // Wait for the next bar downbeat
      if (step % this._pulsesPerBar === 0) {
        this._startRecording(step);
      }

    } else if (this._looperState === 'recording') {
      const elapsed = step - this._loopStartPulse;
      const total = this.bars * this._pulsesPerBar;

      if (elapsed >= total) {
        this._finishRecording();
        this._tickPlayback(step, when); // fire pulse-0 events on the same bar-boundary step
      } else {
        if (this.onProgress) this.onProgress(elapsed / total, 0);
      }

    } else if (this._looperState === 'playing') {
      if (this._pendingSync) {
        // First tick after resetPhase() — anchor _playStartPulse to the actual step
        // so elapsed=0 and only pulse-0 events fire. Works whether called from onBar
        // (step T, where _lastPulse was T-1) or after a clock restart (step 0).
        this._playStartPulse = step;
        this._pendingSync = false;
        this._notifyPlaybackActive(true);
        this._tickPlayback(step, when);
      } else if (this._waitingForBar) {
        // Direct toggle(true) path: hold until the next bar boundary.
        if (step % this._pulsesPerBar === 0) {
          this._playStartPulse = step;
          this._playEventIdx = 0;
          this._currentLoop = 0;
          this._lastPlayheadPulse = -1;
          this._playActiveNotes.clear();
          this._playSustainDown = false;
          this._waitingForBar = false;
          this._notifyPlaybackActive(true);
          this._tickPlayback(step, when);
        }
      } else {
        this._tickPlayback(step, when);
      }
    }
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  _startRecording(step) {
    this._loopStartPulse = step;
    this._recordBuffer = [];
    this._recActiveNotes.clear();
    this._recSustainDown = this._currentSustainDown;

    // Inject sustain state at t=0 if pedal is already held
    if (this._currentSustainDown) {
      this._recordBuffer.push({ pulse: 0, type: 'sustainOn', note: SUSTAIN_CC, velocity: 127 });
    }

    // Inject any notes that are currently held at t=0
    for (const [note, info] of this._currentActiveNotes) {
      this._recordBuffer.push({ pulse: 0, type: 'noteOn', note, velocity: info.velocity });
      this._recActiveNotes.add(note);
    }

    this._setState('recording');
  }

  _finishRecording() {
    const loopLen = this.bars * this._pulsesPerBar;

    // Inject cleanup at loop boundary if sustain or notes are still open
    if (this._recSustainDown) {
      this._recordBuffer.push({ pulse: loopLen - 1, type: 'sustainOff', note: SUSTAIN_CC, velocity: 0 });
    }
    for (const note of this._recActiveNotes) {
      this._recordBuffer.push({ pulse: loopLen - 1, type: 'noteOff', note, velocity: 0 });
    }

    // Quantize
    const q = this.quantizeDivision;
    let events = q > 0
      ? this._applyQuantize(this._recordBuffer, q, loopLen)
      : [...this._recordBuffer];

    // Sort: by pulse, then sustainOn < noteOn < noteOff < sustainOff at same pulse
    const typeOrder = { sustainOn: 0, noteOn: 1, noteOff: 2, sustainOff: 3 };
    events.sort((a, b) => a.pulse !== b.pulse
      ? a.pulse - b.pulse
      : (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2));

    this._playEvents = events;
    this._loopLengthPulses = loopLen;
    this._playStartPulse = this._lastPulse;
    this._playEventIdx = 0;
    this._currentLoop = 0;
    this._lastPlayheadPulse = -1;
    this._playActiveNotes.clear();
    this._playSustainDown = false;

    this._setState('playing');
    this._notifyPlaybackActive(true);
  }

  // ── Quantize ───────────────────────────────────────────────────────────────

  _applyQuantize(events, division, loopLen) {
    // Quantize all events, clamping noteOffs so they land after their noteOn
    const quantized = events.map(ev => {
      const qp = Math.round(ev.pulse / division) * division;
      return { ...ev, pulse: Math.max(0, Math.min(qp, loopLen - 1)) };
    });

    // Sort first so the on/off fix-up always sees pairs in order
    quantized.sort((a, b) => a.pulse - b.pulse);

    // Ensure noteOff strictly after noteOn per note
    const lastOnPulse = new Map();
    for (const ev of quantized) {
      if (ev.type === 'noteOn') {
        lastOnPulse.set(ev.note, ev.pulse);
      } else if (ev.type === 'noteOff' && lastOnPulse.has(ev.note)) {
        const onP = lastOnPulse.get(ev.note);
        if (ev.pulse <= onP) {
          ev.pulse = Math.min(onP + division, loopLen - 1);
        }
        lastOnPulse.delete(ev.note);
      }
    }

    return quantized;
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  _tickPlayback(step, when) {
    if (this._loopLengthPulses <= 0) return;
    const totalElapsed = step - this._playStartPulse;
    const loopNum = Math.floor(totalElapsed / this._loopLengthPulses);
    const elapsed = totalElapsed % this._loopLengthPulses;

    // Detect loop wrap
    if (loopNum !== this._currentLoop) {
      this._currentLoop = loopNum;
      this._silenceAll();
      this._playEventIdx = 0;
      this._lastPlayheadPulse = -1;
    }

    const prev = this._lastPlayheadPulse;
    this._lastPlayheadPulse = elapsed;

    // Fire events whose pulse falls in [prev+1, elapsed]
    while (
      this._playEventIdx < this._playEvents.length &&
      this._playEvents[this._playEventIdx].pulse <= elapsed
    ) {
      const ev = this._playEvents[this._playEventIdx];
      if (prev < 0 || ev.pulse > prev) {
        this._fireEvent(ev, when);
      }
      this._playEventIdx++;
    }

    if (this.onProgress) {
      this.onProgress(1, elapsed / this._loopLengthPulses);
    }
  }

  _fireEvent(ev, when) {
    switch (ev.type) {
      case 'noteOn':
        this.midi.sendNoteOn(this.channel, ev.note, ev.velocity, when);
        this._playActiveNotes.add(ev.note);
        break;
      case 'noteOff':
        this.midi.sendNoteOff(this.channel, ev.note, when);
        this._playActiveNotes.delete(ev.note);
        break;
      case 'sustainOn':
        this.midi.sendCC(this.channel, SUSTAIN_CC, 127, when);
        this._playSustainDown = true;
        break;
      case 'sustainOff':
        this.midi.sendCC(this.channel, SUSTAIN_CC, 0, when);
        this._playSustainDown = false;
        break;
    }
  }

  _silenceAll() {
    if (this._playSustainDown) {
      this.midi.sendCC(this.channel, SUSTAIN_CC, 0);
      this._playSustainDown = false;
    }
    for (const note of this._playActiveNotes) {
      this.midi.sendNoteOff(this.channel, note);
    }
    this._playActiveNotes.clear();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _relPulse() {
    return Math.max(0, this._lastPulse - this._loopStartPulse);
  }

  _setState(newState) {
    this._looperState = newState;
    if (this.onLooperStateChange) this.onLooperStateChange(newState);
  }

  _notifyPlaybackActive(active) {
    if (this.onPlaybackActive) this.onPlaybackActive(active);
  }

  _fullReset() {
    if (this._looperState === 'playing') this._notifyPlaybackActive(false);
    this._silenceAll();
    this._looperState = 'idle';
    this._recordBuffer = [];
    this._playEvents = [];
    this._playEventIdx = 0;
    this._recActiveNotes.clear();
    this._recSustainDown = false;
    this._currentLoop = -1;
    this._lastPlayheadPulse = -1;
    this._pendingSync = false;
    this._waitingForBar = false;
    if (this.onLooperStateChange) this.onLooperStateChange('idle');
    if (this.onProgress) this.onProgress(0, 0);
  }
}

import { applyEasing } from '../utils/easing.js';
import { EXPRESSION_CC, MIDI_MAX, PITCH_BEND_CENTER, PITCH_BEND_MAX } from '../utils/midiConstants.js';

export class SwellModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;

    // Config
    this.channel      = 11;
    this.selectMode   = 'top12';  // 'top1' | 'top12' | 'top13'
    this.outMin       = 'E4';
    this.outMax       = 'E5';
    this.density      = 75;
    this.attackMs     = 2000;
    this.holdMs       = 200;
    this.releaseMs    = 600;
    this.curve        = 'ease-in-3';
    this.whammy        = 2;
    this.whammyChance  = 50;
    this.whammySpeed   = 'slow';  // 'slow' | 'medium' | 'fast'
    this.whammyDouble  = 50;      // % chance of a second hit after the first
    this.minIntervalMs = 2000;
    this.vary          = 0;

    // Runtime
    this._phase             = 'idle';  // 'idle' | 'attack' | 'hold' | 'release' | 'repitch'
    this._playingNotes      = [];
    this._repitchKillNotes  = [];      // notes awaiting note-off once repitch fade hits 0
    this._currentExpression = 0;
    this._lastState         = null;
    this._lastVelocity      = 90;
    this._lastSwellTime     = 0;   // performance.now() when the last swell fired
    this._nextCooldown      = 0;   // ms to wait before next swell opportunity
    this._debounceTimer     = null;
    this._envelopeRaf       = null;
    this._whammyRaf         = null;
    this._whammyTimeout     = null;
    this._holdTimeout       = null;
    this.volume = 100;
  }

  setConfig(channel, selectMode, outMin, outMax, density, attackMs, holdMs, releaseMs, curve, whammy, whammyChance, whammySpeed, whammyDouble, autoRate, vary) {
    const oldChannel = this.channel;

    this.channel      = Math.max(1, Math.min(16,   parseInt(channel,      10) || 1));
    this.selectMode   = selectMode || 'top12';
    this.outMin       = outMin  || 'C3';
    this.outMax       = outMax  || 'B5';
    this.density      = Math.max(0,   Math.min(100,  parseInt(density,      10) || 75));
    this.attackMs     = Math.max(100, Math.min(3000, parseInt(attackMs,     10) || 800));
    this.holdMs       = Math.max(0,   Math.min(1000, parseInt(holdMs,       10) || 200));
    this.releaseMs    = Math.max(100, Math.min(2000, parseInt(releaseMs,    10) || 600));
    this.curve        = curve || 'ease-in-3';
    this.whammy        = Math.max(0,   Math.min(3,    parseInt(whammy,       10) || 0));
    this.whammyChance  = Math.max(0,   Math.min(100,  parseInt(whammyChance, 10) || 50));
    this.whammySpeed   = ['slow', 'medium', 'fast'].includes(whammySpeed) ? whammySpeed : 'medium';
    this.whammyDouble  = Math.max(0,   Math.min(100,  parseInt(whammyDouble, 10) || 0));
    const intervalSec  = Math.max(1,   Math.min(32,   parseInt(autoRate,     10) || 4));
    this.minIntervalMs = intervalSec * 1000;
    this.vary          = Math.max(0,   Math.min(100,  parseInt(vary,         10) || 0));

    if (this.isActive && oldChannel !== this.channel) {
      this._sendExpressionOnChannel(oldChannel, 127);
      this._resetPitchBendOnChannel(oldChannel);
    }
  }

  toggle(active) {
    this.isActive = active;
    if (active) {
      this._lastSwellTime = 0;
      this._nextCooldown  = 0;  // fire on first opportunity
    } else {
      this._cutCurrentSwell();
      this._sendExpression(127);
    }
  }

  processState(state) {
    this._lastState = state;
    if (!this.isActive) return;

    const { latestEvent } = state;
    if (!latestEvent?.isNoteOn) return;

    this._lastVelocity = latestEvent.velocity || this._lastVelocity;

    // Debounce 30 ms so simultaneous chord notes settle before picking
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      // Swell running + sustain held: ignore note-ons entirely.
      // Re-articulating within a held chord shouldn't interrupt the swell.
      // onTick still fires _maybeTrigger independently for the auto-rate.
      if (this._phase !== 'idle' && this._lastState?.sustainDown) return;
      if (this._phase !== 'idle') this._maybeRepitch();
      this._maybeTrigger();
    }, 30);
  }

  // Poll for held-chord swells (covers sustain-pedal holds with no new note-ons)
  onTick(step, ppq) {
    if (!this.isActive || !this._lastState) return;
    const { activeNotes, sustainedNotes } = this._lastState;
    if (!(activeNotes?.size > 0) && !(sustainedNotes?.size > 0)) return;
    this._maybeTrigger();
  }

  // Fade expression to 0, swap notes silently, then re-attack on the new chord.
  // Prevents the click artifact from cutting notes mid-expression.
  _maybeRepitch() {
    if (!this._lastState) return;
    // Sustain pedal held = player is staying in the same harmonic space.
    // Don't repitch — let the swell continue naturally over re-articulated notes.
    if (this._lastState.sustainDown) return;
    const { activeNotes, sustainedNotes } = this._lastState;
    const newNotes = this._buildSwellNotes(activeNotes, sustainedNotes);
    if (!newNotes.length) return;

    const currentKey = [...this._playingNotes].sort((a, b) => a - b).join(',');
    const newKey     = [...newNotes].sort((a, b) => a - b).join(',');
    if (currentKey === newKey) return;

    // Cancel the running envelope/whammy — CC11 will silence the notes
    if (this._envelopeRaf   !== null) { cancelAnimationFrame(this._envelopeRaf);   this._envelopeRaf   = null; }
    if (this._whammyRaf     !== null) { cancelAnimationFrame(this._whammyRaf);      this._whammyRaf     = null; }
    if (this._holdTimeout   !== null) { clearTimeout(this._holdTimeout);             this._holdTimeout   = null; }
    if (this._whammyTimeout !== null) { clearTimeout(this._whammyTimeout);           this._whammyTimeout = null; }

    // Accumulate pending note-offs (handles rapid chord changes during a fade)
    this._repitchKillNotes = [...this._repitchKillNotes, ...this._playingNotes];
    this._playingNotes = [];
    this._phase = 'repitch';

    // Fast fade to silence (60 ms), then swap and re-attack
    this._startEnvelope(this._currentExpression, 0, 60, 'ease-in', () => {
      for (const note of this._repitchKillNotes) this.midi.sendNoteOff(this.channel, note);
      this._repitchKillNotes = [];
      this._triggerSwell(newNotes, this._lastVelocity);
    });
  }

  _maybeTrigger() {
    if (!this.isActive || !this._lastState) return;

    const elapsed = performance.now() - this._lastSwellTime;
    if (elapsed < this._nextCooldown) return;

    // Consume the window so rapid ticks/note-ons don't double-fire
    this._lastSwellTime = performance.now();
    this._nextCooldown  = this._randomCooldown();

    if (Math.random() * 100 >= this.density) return;

    const { activeNotes, sustainedNotes } = this._lastState;
    const notes = this._buildSwellNotes(activeNotes, sustainedNotes);
    if (notes.length) this._triggerSwell(notes, this._lastVelocity);
  }

  _randomCooldown() {
    // Actual interval lands randomly between 1× and 2× minIntervalMs
    return this.minIntervalMs + Math.random() * this.minIntervalMs;
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  panic() {
    this._cutCurrentSwell();
    this._sendExpression(127);
    this.isActive = false;
  }

  // ── Note selection ─────────────────────────────────────────────────────────

  // Build the final note list: select → vary → clamp block to output range
  _buildSwellNotes(activeNotes, sustainedNotes) {
    const raw    = this._selectNotes(activeNotes, sustainedNotes);
    const varied = this._applyVary(raw);
    return this._clampBlockToRange(varied);
  }

  _selectNotes(activeNotes, sustainedNotes) {
    const all = [...new Set([
      ...Array.from(activeNotes.keys()),
      ...sustainedNotes,
    ])].sort((a, b) => a - b);  // sorted low → high

    if (!all.length) return [];
    return this._applySelectMode(all, this.selectMode);
  }

  _applySelectMode(all, mode) {
    switch (mode) {
      case 'top1':
        return [all[all.length - 1]];

      case 'top12':
        if (all.length < 2) return [all[all.length - 1]];
        return [all[all.length - 1], all[all.length - 2]];

      case 'top13':
        if (all.length < 3) return all.slice(-Math.min(all.length, 2));
        return [all[all.length - 1], all[all.length - 3]];

      case 'top23':
        // 2nd + 3rd highest — inner high voices, removes the top melody note
        if (all.length < 2) return [all[all.length - 1]];
        if (all.length < 3) return [all[all.length - 2], all[all.length - 1]];
        return [all[all.length - 2], all[all.length - 3]];

      case 'outer':
        // Highest + Lowest — outer voices imply the full chord in just two notes
        if (all.length < 2) return [all[all.length - 1]];
        return [all[all.length - 1], all[0]];

      case 'triad':
        // Top 3 notes — full three-note swell
        return all.slice(-3);

      case 'best2':
        // Chord-aware: find the dyad with the most musically resonant interval
        return this._bestPair(all);

      case 'random': {
        const pool = ['top1', 'top12', 'top13', 'top23', 'outer', 'triad', 'best2'];
        return this._applySelectMode(all, pool[Math.floor(Math.random() * pool.length)]);
      }

      default:
        return [all[all.length - 1]];
    }
  }

  // Score every dyad in the chord and return the most harmonically resonant pair.
  // Interval scoring: major 3rd > minor 3rd / major 6th > minor 6th > 5th > 2nd / m7 > 4th / maj7 > m2 / tritone > unison
  _bestPair(all) {
    if (all.length < 2) return [all[all.length - 1]];

    const SCORE = { 4: 7, 3: 6, 9: 6, 8: 5, 7: 4, 2: 3, 10: 3, 5: 2, 11: 2, 1: 1, 6: 1, 0: 0 };

    let bestScore = -1;
    let bestPair  = [all[all.length - 2], all[all.length - 1]];

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const interval = (all[j] - all[i]) % 12;
        // Tiny tiebreaker: prefer pairs where both notes sit higher in the chord
        const score = (SCORE[interval] ?? 0) + (all[i] + all[j]) * 0.0001;
        if (score > bestScore) { bestScore = score; bestPair = [all[j], all[i]]; }
      }
    }

    return bestPair;
  }

  // Vary: randomly drops to a single note with probability equal to vary%
  _applyVary(notes) {
    if (this.vary === 0 || notes.length <= 1) return notes;
    if (Math.random() * 100 < this.vary) {
      return [notes[Math.floor(Math.random() * notes.length)]];
    }
    return notes;
  }

  // Transpose/clamp a chord block into the output range by shifting octaves as a unit
  _clampBlockToRange(notes) {
    if (!notes || !notes.length) return [];
    const min = this._noteStrToMidi(this.outMin);
    const max = this._noteStrToMidi(this.outMax);
    if (min === null || max === null) return notes;

    const rangeMin = Math.min(min, max);
    const rangeMax = Math.max(min, max);

    const noteMin = Math.min(...notes);
    const noteMax = Math.max(...notes);

    let bestShift = 0;
    let minError = Infinity;

    for (let octave = -5; octave <= 5; octave++) {
      const s = octave * 12;
      const underflow = Math.max(0, rangeMin - (noteMin + s));
      const overflow  = Math.max(0, (noteMax + s) - rangeMax);
      const err = underflow + overflow;

      if (err < minError) {
        minError = err;
        bestShift = s;
      }
    }

    return notes.map(n => Math.max(0, Math.min(127, n + bestShift)));
  }

  _noteStrToMidi(str) {
    if (!str) return null;
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const m = str.match(/^([A-G]#?)(-?\d+)$/);
    if (!m) return null;
    const idx = NAMES.indexOf(m[1]);
    if (idx === -1) return null;
    return (parseInt(m[2], 10) + 1) * 12 + idx;
  }

  // ── Swell lifecycle ────────────────────────────────────────────────────────

  _triggerSwell(notes, velocity) {
    this._cutCurrentSwell();

    this._sendExpression(0);
    this._currentExpression = 0;

    // Strike notes at full velocity — CC11 = 0 means they're silent at first
    this._playingNotes = [...notes];
    const vel = Math.max(1, Math.min(127, velocity || 90));
    for (const note of this._playingNotes) {
      this.midi.sendNoteOn(this.channel, note, vel);
    }

    // Attack: ramp CC11 0 → 127
    this._phase = 'attack';
    this._startEnvelope(0, 127, this.attackMs, this.curve, () => {
      this._phase = 'hold';

      // Whammy fires stochastically: chance determined by whammyChance %
      if (this.whammy > 0 && Math.random() * 100 < this.whammyChance) {
        this._whammyTimeout = setTimeout(() => {
          this._whammyTimeout = null;
          if (this._phase === 'hold' || this._phase === 'release') {
            this._startWhammy();
          }
        }, 50);
      }

      // Begin release after hold time
      this._holdTimeout = setTimeout(() => {
        this._holdTimeout = null;
        if (this._phase !== 'hold') return;

        this._phase = 'release';
        this._startEnvelope(127, 0, this.releaseMs, 'ease-in', () => {
          this._phase = 'idle';
          this._sendNoteOff();
          this._resetPitchBend();
        });
      }, this.holdMs);
    });
  }

  _cutCurrentSwell() {
    if (this._debounceTimer  !== null) { clearTimeout(this._debounceTimer);          this._debounceTimer  = null; }
    if (this._envelopeRaf    !== null) { cancelAnimationFrame(this._envelopeRaf);    this._envelopeRaf    = null; }
    if (this._whammyRaf      !== null) { cancelAnimationFrame(this._whammyRaf);      this._whammyRaf      = null; }
    if (this._holdTimeout    !== null) { clearTimeout(this._holdTimeout);             this._holdTimeout    = null; }
    if (this._whammyTimeout  !== null) { clearTimeout(this._whammyTimeout);           this._whammyTimeout  = null; }

    for (const note of this._repitchKillNotes) this.midi.sendNoteOff(this.channel, note);
    this._repitchKillNotes = [];
    this._sendNoteOff();
    this._resetPitchBend();
    this._phase = 'idle';
  }

  _sendNoteOff() {
    for (const note of this._playingNotes) {
      this.midi.sendNoteOff(this.channel, note);
    }
    this._playingNotes = [];
  }

  // ── CC11 Expression envelope ───────────────────────────────────────────────

  _startEnvelope(from, to, durationMs, curve, onComplete) {
    if (this._envelopeRaf !== null) {
      cancelAnimationFrame(this._envelopeRaf);
      this._envelopeRaf = null;
    }

    if (durationMs <= 0 || from === to) {
      this._currentExpression = to;
      this._sendExpression(to);
      onComplete?.();
      return;
    }

    const startTime = performance.now();

    const tick = (now) => {
      const t     = Math.min(1, (now - startTime) / durationMs);
      const eased = applyEasing(t, curve);
      const val   = Math.round(from + (to - from) * eased);

      if (val !== this._currentExpression) {
        this._currentExpression = val;
        this._sendExpression(val);
      }

      if (t < 1) {
        this._envelopeRaf = requestAnimationFrame(tick);
      } else {
        this._envelopeRaf = null;
        onComplete?.();
      }
    };

    this._envelopeRaf = requestAnimationFrame(tick);
  }

  _sendExpression(val) {
    this.midi.sendCC(this.channel, EXPRESSION_CC, Math.max(0, Math.min(MIDI_MAX, val)));
  }

  _sendExpressionOnChannel(channel, val) {
    this.midi.sendCC(channel, EXPRESSION_CC, Math.max(0, Math.min(MIDI_MAX, val)));
  }

  // ── Whammy pitch bend ──────────────────────────────────────────────────────

  _startWhammy(isSecondHit = false) {
    const DEPTH_CENTS = [0, 25, 75, 150];
    const cents = DEPTH_CENTS[this.whammy] || 0;
    if (!cents) return;

    const bendMax = Math.round(cents * 8191 / 200);
    const SPEEDS  = { slow: [250, 600], medium: [150, 350], fast: [70, 180] };
    const [DIP_MS, RETURN_MS] = SPEEDS[this.whammySpeed] || SPEEDS.medium;
    const TOTAL_MS  = DIP_MS + RETURN_MS;
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;

      if (elapsed >= TOTAL_MS) {
        this._sendPitchBend(0);
        this._whammyRaf = null;
        if (!isSecondHit && Math.random() * 100 < this.whammyDouble) {
          const gap = DIP_MS * 0.4 + Math.random() * DIP_MS * 0.6;
          this._whammyTimeout = setTimeout(() => {
            this._whammyTimeout = null;
            if (this._phase === 'hold' || this._phase === 'release') {
              this._startWhammy(true);
            }
          }, gap);
        }
        return;
      }

      let bend;
      if (elapsed < DIP_MS) {
        const t = elapsed / DIP_MS;
        bend = -Math.round(bendMax * applyEasing(t, 'ease-in'));
      } else {
        const t = (elapsed - DIP_MS) / RETURN_MS;
        bend = -Math.round(bendMax * (1 - applyEasing(t, 'ease-out')));
      }

      this._sendPitchBend(bend);
      this._whammyRaf = requestAnimationFrame(tick);
    };

    this._whammyRaf = requestAnimationFrame(tick);
  }

  _sendPitchBend(bendUnits) {
    const absolute = Math.max(0, Math.min(PITCH_BEND_MAX, bendUnits + PITCH_BEND_CENTER));
    const lsb = absolute & 0x7F;
    const msb = (absolute >> 7) & 0x7F;
    this.midi.sendRawMessage(this.channel, 0xE0, lsb, msb);
  }

  _resetPitchBend() {
    this._sendPitchBend(0);
  }

  _resetPitchBendOnChannel(channel) {
    const absolute = PITCH_BEND_CENTER;
    const lsb = absolute & 0x7F;
    const msb = (absolute >> 7) & 0x7F;
    this.midi.sendRawMessage(channel, 0xE0, lsb, msb);
  }

}

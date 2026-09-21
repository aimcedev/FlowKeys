/**
 * PercussionModule — a single, instantiable sequencer-driven drum module.
 *
 * Replaces the three identical KickModule / SnareModule / ShakerModule classes.
 * The only behavioral difference between those three was velocity humanization
 * on the shaker, exposed here via the optional `humanize` flag in setConfig().
 *
 * Usage:
 *   const kick = new PercussionModule(midi, 'legacy-kick');
 *   kick.setConfig(6, 36);          // channel, note
 *   kick.setSequence([100,0,...]);
 *
 *   const shaker = new PercussionModule(midi, 'legacy-shaker');
 *   shaker.setConfig(5, 55, true);  // humanize = true
 */
import { stepsForTimeSignature } from '../utils/noteUtils.js';

export class PercussionModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;
    this.isTempoBased = true;

    this.channel = 6;
    this.note = 36;
    this.sequence = new Array(16).fill(0);
    this.rate = 16; // 16th notes
    this.humanize = false;
    this.stepsPerBar = 16;
    this._savedSteps = null;
    this._noteOffTimer = null;
    this.volume = 100;
  }

  setConfig(channel, note, humanize = false) {
    this.channel = parseInt(channel, 10);
    this.note = parseInt(note, 10);
    this.humanize = !!humanize;
  }

  setSequence(seq) {
    this.sequence = [...seq];
    this.stepsPerBar = seq.length;
  }

  setTimeSignature(sig) {
    const newSteps = stepsForTimeSignature(sig);
    if (newSteps === this.stepsPerBar) return;
    if (newSteps < this.stepsPerBar) {
      this._savedSteps = this.sequence.slice(newSteps);
      this.sequence = this.sequence.slice(0, newSteps);
    } else {
      const tail = this._savedSteps || new Array(newSteps - this.stepsPerBar).fill(0);
      this.sequence = this.sequence.concat(tail.slice(0, newSteps - this.stepsPerBar));
      this._savedSteps = null;
    }
    this.stepsPerBar = newSteps;
  }

  toggle(active) {
    this.isActive = active;
  }

  resetPhase() {}

  processState(_state) {}

  onTick(step, ppq, when) {
    if (!this.isActive) return;
    const pulsesPerNote = (ppq * 4) / this.rate;
    if (step % pulsesPerNote === 0) {
      const stepIndex = Math.floor(step / pulsesPerNote) % this.stepsPerBar;
      this.playStep(stepIndex, when);
      if (this.onStepCallback) this.onStepCallback(stepIndex);
    }
  }

  onStep(callback) {
    this.onStepCallback = callback;
  }

  playStep(stepIndex, when) {
    const baseVelocity = this.sequence[stepIndex] || 0;
    if (baseVelocity <= 0) return;

    let velocity = baseVelocity;
    if (this.humanize) {
      const variation = Math.floor(Math.random() * 10) - 5;
      velocity = Math.max(1, Math.min(127, baseVelocity + variation));
    }

    const GATE_MS = 50;
    this.midi.sendNoteOn(this.channel, this.note, velocity, when);
    if (this._noteOffTimer) { clearTimeout(this._noteOffTimer); this._noteOffTimer = null; }
    if (when != null) {
      // Schedule the note-off at the same precise timeline as the note-on so the
      // gate length is exact and immune to main-thread jitter.
      this.midi.sendNoteOff(this.channel, this.note, when + GATE_MS);
    } else {
      this._noteOffTimer = setTimeout(() => {
        this.midi.sendNoteOff(this.channel, this.note);
        this._noteOffTimer = null;
      }, GATE_MS);
    }
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  panic() {
    this.isActive = false;
    if (this._noteOffTimer) {
      clearTimeout(this._noteOffTimer);
      this._noteOffTimer = null;
    }
    this.midi.sendNoteOff(this.channel, this.note);
  }
}

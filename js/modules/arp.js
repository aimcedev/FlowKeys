import { stepsForTimeSignature } from '../utils/noteUtils.js';

export class ArpModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;
    this.isTempoBased = true;

    // Config
    this.channel = 3;
    this.rate = 16; // 16th notes to match sequencer grid
    this.numNotes = 2; // Default Top 2
    this.mode = 'chord';

    // Sequencer Data (16 steps)
    this.sequence = new Array(16).fill(0);
    this.stepsPerBar = 16;
    this._savedSteps = null;

    // Notes cache
    this.notesToArp = []; // Sorted lower to higher (or sequence)
    this.currentlyPlayingNotes = [];
    this.arpNoteIdx = 0;
    this._staccatoTimer = null;
    this.volume = 100;
  }

  setConfig(channel, numNotes, mode = 'chord') {
    this.channel = parseInt(channel, 10);
    this.numNotes = parseInt(numNotes, 10);
    this.mode = mode;
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
    if (!this.isActive) {
      clearTimeout(this._staccatoTimer);
      this.stopCurrentNotes();
      this.notesToArp = [];
    }
  }

  resetPhase() {
    this.arpNoteIdx = 0;
  }

  processState(state) {
    if (!this.isActive) return;

    const { highestNotes } = state;

    if (highestNotes.length === 0) {
      // Stop arp
      this.notesToArp = [];
      this.stopCurrentNotes();
      return;
    }

    // Collect top N notes for arp
    // State returns highestNotes sorted highest first. We want them lowest first for arp.
    let arpStack = highestNotes.slice(0, this.numNotes).reverse();
    
    // Check if changed
    const changed = arpStack.length !== this.notesToArp.length ||
      arpStack.some((v, i) => v !== this.notesToArp[i]);
    if (changed) {
      this.notesToArp = arpStack;
    }
  }

  onTick(step, ppq, when) {
    const pulsesPerNote = (ppq * 4) / this.rate;

    if (step % pulsesPerNote === 0) {
      const stepIndex = Math.floor(step / pulsesPerNote) % this.stepsPerBar;
      this.playNextStep(stepIndex, when);

      if (this.onStepCallback) {
        this.onStepCallback(stepIndex);
      }
    }
  }

  onStep(callback) {
    this.onStepCallback = callback;
  }

  playNextStep(stepIndex, when) {
    if (this.notesToArp.length === 0) return;

    const baseVelocity = this.sequence[stepIndex] || 0;
    if (baseVelocity === 0) return;

    // Optional: varied velocity for a more natural feel like Shaker
    const variation = Math.floor(Math.random() * 10) - 5;
    const velocity = Math.max(1, Math.min(127, baseVelocity + variation));

    if (this.mode === 'chord') {
      // Pulse all notes
      this.notesToArp.forEach(note => {
        this.midi.sendNoteOn(this.channel, note, velocity, when);
        this.currentlyPlayingNotes.push(note);
      });
    } else {
      // Simple Up Arp pattern
      // To keep it musical, we advance the note only when we actually play a step
      // We can use a separate counter for noteIdx
      const noteIdx = this.arpNoteIdx % this.notesToArp.length;
      const note = this.notesToArp[noteIdx];

      this.midi.sendNoteOn(this.channel, note, velocity, when);
      this.currentlyPlayingNotes.push(note);

      this.arpNoteIdx++;
    }

    // Use a tight 80ms staccato to keep perfectly in sync with Shaker and clear
    // notes rather than holding them until the next tick. Anchor the gate to the
    // note's scheduled time (`when`), which may be slightly ahead of real time,
    // so the staccato length stays consistent.
    const STACCATO_MS = 80;
    const aheadMs = (when != null) ? Math.max(0, when - performance.now()) : 0;
    if (this._staccatoTimer) clearTimeout(this._staccatoTimer);
    this._staccatoTimer = setTimeout(() => {
      this.stopCurrentNotes();
    }, aheadMs + STACCATO_MS);
  }

  stopCurrentNotes() {
    this.currentlyPlayingNotes.forEach(note => {
      this.midi.sendNoteOff(this.channel, note);
    });
    this.currentlyPlayingNotes = [];
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  panic() {
    clearTimeout(this._staccatoTimer);
    this.stopCurrentNotes();
    this.notesToArp = [];
    this.isActive = false;
    this.arpNoteIdx = 0;
  }
}

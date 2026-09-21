import { isNoteOn, isNoteOff } from '../utils/noteUtils.js';
import { SUSTAIN_CC } from '../utils/midiConstants.js';
import { Clock } from './clock.js';

export class PerformanceEngine {
  constructor(midiManager) {
    this.midi = midiManager;
    this.clock = new Clock();

    // Broadcast clock ticks
    this.clock.onTick((step, ppq, when) => {
      this.modules.forEach(mod => {
        if ((mod.isActive || mod.waitingToTurnOff) && mod.onTick) {
          mod.onTick(step, ppq, when);
        }
      });
    });
    
    // Core state
    this.activeNotes = new Map(); // noteNumber -> { velocity, timestamp }
    this.lowestNote = null;
    this.highestNotes = [];
    this.sustainDown = false;
    this.sustainedNotes = new Set();

    // Physical state (directly from input controller, untransposed)
    this.physicalActiveNotes = new Map(); // noteNumber -> velocity
    this.physicalSustainDown = false;
    
    // UI Callbacks
    this.onStateChangeCallback = null;
    this.onPanicCallbacks = [];
    
    // Configuration
    this.transpose = 0;

    // Module Registrations
    this.modules = [];
    this._suppressClockTrigger = false;
  }

  setTranspose(semitones) {
    const diff = semitones - this.transpose;
    this.transpose = semitones;
    if (diff !== 0 && (this.activeNotes.size > 0 || this.sustainedNotes.size > 0)) {
      const newActive = new Map();
      for (const [note, data] of this.activeNotes) {
        const newNote = Math.max(0, Math.min(127, note + diff));
        newActive.set(newNote, data);
      }
      this.activeNotes = newActive;

      const newSustained = new Set();
      for (const note of this.sustainedNotes) {
        const newNote = Math.max(0, Math.min(127, note + diff));
        newSustained.add(newNote);
      }
      this.sustainedNotes = newSustained;

      this._recalculateNoteExtremes();
      this.broadcastCurrentState();
    }
  }

  registerModule(mod) {
    this.modules.push(mod);
  }

  unregisterModule(instanceId) {
    this.modules = this.modules.filter(m => m.instanceId !== instanceId);
  }

  onStateChange(callback) {
    this.onStateChangeCallback = callback;
  }

  processMidiMessage(event) {
    if (!event.data || event.data.length < 2) return;
    const [status, note, velocity] = event.data;

    // Track physical state first
    const cmd = status >> 4;
    const isCC = cmd === 11;
    if (isCC && note === SUSTAIN_CC) {
      this.physicalSustainDown = velocity >= 64;
    } else if (cmd === 8 || cmd === 9) {
      if (isNoteOn(status, velocity)) {
        this.physicalActiveNotes.set(note, velocity);
      } else if (isNoteOff(status, velocity)) {
        this.physicalActiveNotes.delete(note);
      }
    }

    // Track sustain pedal
    if (isCC && note === SUSTAIN_CC) {
      const newSustainDown = velocity >= 64;
      if (this.sustainDown && !newSustainDown) {
        this.sustainedNotes.clear();
        this._recalculateNoteExtremes();
        if (this.clock.mode === 'trigger' && this.activeNotes.size === 0) {
          this.clock.stop();
        }
      }
      this.sustainDown = newSustainDown;
      this._notifyStateChange(status, note, velocity);
    }

    this._processNoteState(status, note, velocity);
  }

  /**
   * Route external note events (e.g. chord pads) through the engine.
   * Sends MIDI to outputChannel (with engine transpose applied) and updates
   * internal state, so all registered modules receive the same processState
   * calls they would from physical MIDI input.
   */
  injectNotes(events, outputChannel) {
    for (const { status, note, velocity } of events) {
      const cmd = status >> 4;
      if (cmd === 8 || cmd === 9) {
        const transposedNote = Math.max(0, Math.min(127, note + this.transpose));
        this.midi.sendNoteMessage(outputChannel, status, transposedNote, velocity);
      }
      this._processNoteState(status, note, velocity);
    }
  }

  _processNoteState(status, note, velocity) {
    // Update internal state representation if Note Event
    if (this._isNoteEvent(status)) {
      const transposedNote = Math.max(0, Math.min(127, note + this.transpose));
      const isCurrentlyEmpty = this.activeNotes.size === 0 && this.sustainedNotes.size === 0;

      if (isNoteOn(status, velocity)) {
        this.activeNotes.set(transposedNote, { velocity, timestamp: performance.now() });
        this.sustainedNotes.delete(transposedNote);
      } else if (isNoteOff(status, velocity)) {
        this.activeNotes.delete(transposedNote);
        if (this.sustainDown) {
          this.sustainedNotes.add(transposedNote);
        }
      }

      const isEmptyNow = this.activeNotes.size === 0 && this.sustainedNotes.size === 0;

      // Notify clock of trigger events
      if (!this._suppressClockTrigger && (this.clock.mode === 'trigger' || this.clock.mode === 'flow')) {
        if (isCurrentlyEmpty && !isEmptyNow) {
          // First note pressed
          if (!this.clock.isRunning && !(this.clock.mode === 'flow' && this.deferFlowClockStart?.())) {
            this.clock.reset(); // Restart from step 0 immediately
            this.clock.start();
          }
        } else if (isEmptyNow && this.clock.mode === 'trigger') {
          // All notes released — only stop in trigger mode.
          // Flow mode clock persistence is managed by the application.
          this.clock.stop();
        }
      }

      this._recalculateNoteExtremes();

      // Notify visualizer and modules
      this._notifyStateChange(status, transposedNote, velocity);
    }
  }

  _isNoteEvent(status) {
    const cmd = status >> 4;
    return cmd === 8 || cmd === 9;
  }

  _recalculateNoteExtremes() {
    const allNotes = new Set([
      ...Array.from(this.activeNotes.keys()),
      ...this.sustainedNotes
    ]);

    if (allNotes.size === 0) {
      this.lowestNote = null;
      this.highestNotes = [];
      return;
    }

    const notes = Array.from(allNotes).sort((a, b) => a - b);
    this.lowestNote = notes[0];
    
    // Top 3 notes for Arp/Highest analysis
    this.highestNotes = notes.slice(-3).reverse(); // largest first
  }

  _notifyStateChange(status, note, velocity) {
    const state = {
      activeNotes: new Map(this.activeNotes),
      sustainedNotes: new Set(this.sustainedNotes),
      lowestNote: this.lowestNote,
      highestNotes: [...this.highestNotes],
      sustainDown: this.sustainDown,
      latestEvent: { status, note, velocity, isNoteOn: isNoteOn(status, velocity) }
    };

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(state);
    }

    // Broadcast to registered modules
    this.modules.forEach(mod => {
      if ((mod.isActive || mod.waitingToTurnOff) && mod.processState) {
        mod.processState(state);
      }
    });
  }

  // Silence all modules and wipe note-tracking state without stopping the clock
  // or firing the state-change callback. Safe to call from within a tick or a
  // state-change handler (no re-entrancy risk). Used before section switches so
  // surviving modules don't inherit stale held-note state from the old section.
  clearState() {
    this.activeNotes.clear();
    this.sustainedNotes.clear();
    this.lowestNote = null;
    this.highestNotes = [];
    this.sustainDown = false;
    this.modules.forEach(mod => {
      if (mod.panic) mod.panic();
    });
  }

  reapplyPhysicalState() {
    this.sustainDown = this.physicalSustainDown;
    this._suppressClockTrigger = true;
    try {
      for (const [note, velocity] of this.physicalActiveNotes) {
        this._processNoteState(0x90, note, velocity);
      }
    } finally {
      this._suppressClockTrigger = false;
    }
  }

  broadcastCurrentState() {
    const state = {
      activeNotes: new Map(this.activeNotes),
      sustainedNotes: new Set(this.sustainedNotes),
      lowestNote: this.lowestNote,
      highestNotes: [...this.highestNotes],
      sustainDown: this.sustainDown,
      latestEvent: null
    };

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(state);
    }

    this.modules.forEach(mod => {
      if ((mod.isActive || mod.waitingToTurnOff) && mod.processState) {
        mod.processState(state);
      }
    });
  }

  onPanic(callback) { this.onPanicCallbacks.push(callback); }

  panic() {
    this.onPanicCallbacks.forEach(callback => callback());
    this.physicalActiveNotes.clear();
    this.physicalSustainDown = false;
    this.clearState();
    this.clock.stop();
    const state = { activeNotes: new Map(), lowestNote: null, highestNotes: [], sustainDown: false };
    if (this.onStateChangeCallback) this.onStateChangeCallback(state);
  }
}

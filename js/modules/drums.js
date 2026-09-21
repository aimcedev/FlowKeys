import { stepsForTimeSignature } from '../utils/noteUtils.js';

export class DrumsModule {
  constructor(midiManager, instanceId, app) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.app = app;
    this.isActive = false;
    this.isTempoBased = true;

    this.channel = 10;
    this.swing = 0;
    this.humanize = 15;
    this.stepsPerBar = 16;
    this.selectedTrackId = 'kick';
    this.volume = 100;
    this.playingNotes = new Set();

    // Default tracks
    this.tracks = [
      { id: 'kick',      name: 'Kick',        note: 36, seq: [100,0,0,0, 100,0,0,0, 100,0,0,0, 100,0,0,0], muted: false, soloed: false },
      { id: 'snare',     name: 'Snare',       note: 38, seq: [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,0],     muted: false, soloed: false },
      { id: 'closedHat', name: 'Closed Hat',  note: 42, seq: [80,0,80,0, 80,0,80,0, 80,0,80,0, 80,0,80,0], muted: false, soloed: false },
      { id: 'openHat',   name: 'Open Hat',    note: 46, seq: new Array(16).fill(0),                         muted: false, soloed: false },
      { id: 'clap',      name: 'Clap',        note: 39, seq: new Array(16).fill(0),                         muted: false, soloed: false },
    ];

    this._noteOffTimers = new Map();
    this.onStepCallback = null;
  }

  setConfig(channel, swing, humanize) {
    this.channel = parseInt(channel, 10);
    this.swing = parseFloat(swing) || 0;
    this.humanize = parseFloat(humanize) || 0;
  }

  setTracks(tracks) {
    if (!tracks || !Array.isArray(tracks)) return;
    const steps = this.stepsPerBar;
    this.tracks = tracks.map(t => {
      // Normalize each sequence to the current bar length (pad/truncate).
      const seq = [...t.seq];
      if (seq.length < steps) seq.push(...new Array(steps - seq.length).fill(0));
      else if (seq.length > steps) seq.length = steps;
      return {
        id: t.id,
        name: t.name,
        note: parseInt(t.note, 10),
        seq,
        muted: !!t.muted,
        soloed: !!t.soloed
      };
    });
    // Make sure we have at least one track
    if (this.tracks.length === 0) {
      this.tracks.push({
        id: 'kick',
        name: 'Kick',
        note: 36,
        seq: new Array(this.stepsPerBar).fill(0),
        muted: false
      });
    }
    // Make sure selectedTrackId is still valid
    if (!this.tracks.some(t => t.id === this.selectedTrackId)) {
      this.selectedTrackId = this.tracks[0].id;
    }
  }

  setTrackSequence(trackId, seq) {
    const track = this.tracks.find(t => t.id === trackId);
    if (track) {
      track.seq = [...seq];
    }
  }

  addTrack(name, note) {
    if (this.tracks.length >= 12) return null;
    const id = `track-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newTrack = {
      id,
      name: name || `Perc ${this.tracks.length + 1}`,
      note: parseInt(note, 10) || 36,
      seq: new Array(this.stepsPerBar).fill(0),
      muted: false,
      soloed: false
    };
    this.tracks.push(newTrack);
    return newTrack;
  }

  removeTrack(trackId) {
    if (this.tracks.length <= 1) return; // Enforce minimum of 1 track
    this.tracks = this.tracks.filter(t => t.id !== trackId);
    if (this.selectedTrackId === trackId) {
      this.selectedTrackId = this.tracks[0].id;
    }
  }

  muteTrack(trackId, muted) {
    const track = this.tracks.find(t => t.id === trackId);
    if (track) {
      track.muted = !!muted;
    }
  }

  toggle(active) {
    this.isActive = active;
    if (!active) {
      for (const timer of this._noteOffTimers.values()) {
        clearTimeout(timer);
      }
      this._noteOffTimers.clear();
      this.playingNotes.clear();
      // Send note offs to prevent hanging notes
      for (const track of this.tracks) {
        this.midi.sendNoteOff(this.channel, track.note);
      }
    }
  }

  panic() {
    this.isActive = false;
    for (const timer of this._noteOffTimers.values()) {
      clearTimeout(timer);
    }
    this._noteOffTimers.clear();
    this.playingNotes.clear();
    for (const track of this.tracks) {
      this.midi.sendNoteOff(this.channel, track.note);
    }
  }

  setTimeSignature(sig) {
    const newSteps = stepsForTimeSignature(sig);
    if (newSteps === this.stepsPerBar) return;
    for (const track of this.tracks) {
      if (newSteps < this.stepsPerBar) {
        track._savedSteps = track.seq.slice(newSteps);
        track.seq = track.seq.slice(0, newSteps);
      } else {
        const tail = track._savedSteps || new Array(newSteps - this.stepsPerBar).fill(0);
        track.seq = track.seq.concat(tail.slice(0, newSteps - this.stepsPerBar));
        track._savedSteps = null;
      }
    }
    this.stepsPerBar = newSteps;
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  onTick(step, ppq, when) {
    if (!this.isActive) return;
    const rate = 16; // 16th notes
    const pulsesPerNote = (ppq * 4) / rate;
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
    const hasSolo = this.tracks.some(t => t.soloed);
    for (const track of this.tracks) {
      if (hasSolo && !track.soloed) continue;
      if (track.muted) continue;
      const baseVelocity = track.seq[stepIndex] || 0;
      if (baseVelocity <= 0) continue;

      let velocity = baseVelocity;
      if (this.humanize > 0) {
        const range = Math.round((this.humanize / 100) * 15); // 0-15 velocity units
        const variation = Math.floor(Math.random() * (range * 2 + 1)) - range;
        velocity = Math.max(1, Math.min(127, baseVelocity + variation));
      }

      // Check for swing on even 16th steps (index 1, 3, 5, etc.)
      const isEvenStep = (stepIndex % 2 === 1);
      if (this.swing > 0 && isEvenStep) {
        const bpm = (this.app && this.app.engine && this.app.engine.clock) ? this.app.engine.clock.bpm : 120;
        const stepDurationMs = 60000 / bpm / 4; // 16th note duration
        const swingDelayMs = (this.swing / 100) * stepDurationMs;
        if (when != null) {
          // Fold the swing offset into the scheduled timestamp — far more precise
          // than a setTimeout and keeps swung hits exactly relative to the grid.
          this._fireNote(track, velocity, when + swingDelayMs);
        } else {
          setTimeout(() => this._fireNote(track, velocity), swingDelayMs);
        }
      } else {
        this._fireNote(track, velocity, when);
      }
    }
  }

  _fireNote(track, velocity, when) {
    if (!this.isActive) return;
    this.playingNotes.add(track.note);
    this.midi.sendNoteOn(this.channel, track.note, velocity, when);

    if (this._noteOffTimers.has(track.id)) {
      clearTimeout(this._noteOffTimers.get(track.id));
    }
    // Keep the ~50ms gate measured from the note's actual (possibly scheduled-
    // ahead) start so the note-off never races in front of the note-on.
    const aheadMs = (when != null) ? Math.max(0, when - performance.now()) : 0;
    const timer = setTimeout(() => {
      let stillPlaying = false;
      for (const t of this.tracks) {
        if (t.id !== track.id && t.note === track.note && this._noteOffTimers.has(t.id)) {
          stillPlaying = true;
          break;
        }
      }
      if (!stillPlaying) {
        this.playingNotes.delete(track.note);
      }
      this.midi.sendNoteOff(this.channel, track.note);
      this._noteOffTimers.delete(track.id);
    }, aheadMs + 50);
    this._noteOffTimers.set(track.id, timer);
  }
}

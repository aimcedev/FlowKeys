// note-state.js — Active Note State Layer (+ temporal weighting)
// Stateful: consumes normalized noteOn/noteOff/sustain events and answers
// "what is being played right now, and how much does each note matter?".
//
// Time is always passed in (event timestamps, snapshot `now`) — nothing reads
// the clock internally — so the whole thing is deterministic and testable.

export const DEFAULT_TIMING = {
  clusterWindowMs: 90,    // onsets within this of each other = "struck together"
  soloHoldMs: 350,        // an isolated note held this long counts as intentional
  shortNoteMs: 60,        // below this, an isolated note is treated as a blip
  soloMinWeight: 0.3,     // floor weight for a brand-new isolated note
  releasedMemoryMs: 1500, // how long to remember released notes
};

export class NoteState {
  constructor(timing = {}) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.notes = new Map();        // midi -> { midi, velocity, startTime }
    this.sustainHeld = new Set();  // midi notes released but held by sustain pedal
    this.sustainOn = false;
    this.released = [];            // { midi, startTime, endTime }
  }

  handleEvent(evt) {
    switch (evt.type) {
      case 'noteOn':
        // Velocity 0 noteOn is a noteOff by MIDI convention.
        if (evt.velocity === 0) this.noteOff(evt.midiNote, evt.timestamp);
        else this.noteOn(evt.midiNote, evt.velocity, evt.timestamp);
        break;
      case 'noteOff':
        this.noteOff(evt.midiNote, evt.timestamp);
        break;
      case 'sustain':
        this.setSustain(evt.value, evt.timestamp);
        break;
    }
  }

  noteOn(midi, velocity, timestamp) {
    this.sustainHeld.delete(midi);
    this.notes.set(midi, { midi, velocity, startTime: timestamp });
  }

  noteOff(midi, timestamp) {
    const n = this.notes.get(midi);
    if (!n) return;
    if (this.sustainOn) {
      // Pedal down: keep sounding, but mark it as released-when-pedal-lifts.
      this.sustainHeld.add(midi);
      return;
    }
    this.notes.delete(midi);
    this._remember(n, timestamp);
  }

  setSustain(on, timestamp) {
    this.sustainOn = on;
    if (!on) {
      // Pedal up: drop everything that was being held only by the pedal.
      for (const midi of this.sustainHeld) {
        const n = this.notes.get(midi);
        if (n) {
          this.notes.delete(midi);
          this._remember(n, timestamp);
        }
      }
      this.sustainHeld.clear();
    }
  }

  _remember(n, endTime) {
    this.released.push({ midi: n.midi, startTime: n.startTime, endTime });
    const cutoff = endTime - this.timing.releasedMemoryMs;
    this.released = this.released.filter((r) => r.endTime >= cutoff);
  }

  // Weight for a single note: 1 if struck together with the rest of the chord
  // or held a while; lower for a fresh, isolated (likely melodic) note.
  _weightFor(note, now, onsets) {
    const t = this.timing;
    const companions = onsets.filter(
      (o) => o !== note.startTime && Math.abs(o - note.startTime) <= t.clusterWindowMs
    ).length;
    const held = now - note.startTime;

    let w;
    if (companions >= 1) {
      w = 1;
    } else if (held >= t.soloHoldMs) {
      w = 1;
    } else {
      const span = Math.max(1, t.soloHoldMs - t.shortNoteMs);
      const frac = Math.max(0, (held - t.shortNoteMs)) / span;
      w = t.soloMinWeight + (1 - t.soloMinWeight) * Math.min(1, frac);
    }
    // Slight velocity influence.
    w *= 0.75 + 0.25 * (note.velocity / 127);
    return Math.max(0, Math.min(1, w));
  }

  snapshot(now) {
    const active = [...this.notes.values()].sort((a, b) => a.midi - b.midi);
    const onsets = active.map((n) => n.startTime);

    const noteMeta = active.map((n) => ({
      midi: n.midi,
      pc: ((n.midi % 12) + 12) % 12,
      velocity: n.velocity,
      startTime: n.startTime,
      held: now - n.startTime,
      weight: this._weightFor(n, now, onsets),
    }));

    // Aggregate weights per pitch class (max across octaves).
    const weights = {};
    const pcSet = new Set();
    for (const m of noteMeta) {
      pcSet.add(m.pc);
      weights[m.pc] = Math.max(weights[m.pc] ?? 0, m.weight);
    }

    return {
      activeNotes: active.map((n) => n.midi),
      pitchClasses: [...pcSet].sort((a, b) => a - b),
      bassPc: active.length ? ((active[0].midi % 12) + 12) % 12 : null,
      bassMidi: active.length ? active[0].midi : null,
      noteMeta,
      weights,
      sustainOn: this.sustainOn,
    };
  }
}

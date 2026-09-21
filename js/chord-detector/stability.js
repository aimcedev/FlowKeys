// stability.js — chord-change segmentation + anti-flicker.
// Two separated jobs, both time-injected (deterministic / testable):
//
//   Segmentation  — decide WHEN a new chord event begins, from the set of
//                   high-weight (intentional) pitch classes. A fleeting,
//                   low-weight passing note does not change the segment.
//   Anti-flicker  — given that, decide WHETHER to re-display a new name:
//                   confidence threshold + hold/debounce timing.
//
// Usage: feed each fresh engine result + the note-state snapshot + `now`.
// Returns the result that should actually be displayed.

export const DEFAULT_STABILITY = {
  confidenceThreshold: 0.5, // below this, never switch away from current chord
  minWeight: 0.6,           // pitch classes at/above this define the segment
  segmentSwitchMs: 50,      // new note-set struck -> switch quickly
  reinterpretSwitchMs: 220, // same note-set, new interpretation -> switch slowly
};

function segmentSignature(snapshot, minWeight) {
  if (!snapshot) return '';
  const weights = snapshot.weights;
  let pcs;
  if (weights) {
    pcs = Object.keys(weights)
      .map(Number)
      .filter((pc) => weights[pc] >= minWeight);
  } else {
    pcs = snapshot.pitchClasses || [];
  }
  return [...pcs].sort((a, b) => a - b).join(',');
}

export class Stabilizer {
  constructor(opts = {}) {
    this.opts = { ...DEFAULT_STABILITY, ...opts };
    this.displayed = null;     // currently shown result
    this.displayedSince = 0;
    this.displayedSig = '';
    this.pending = null;       // { name, since, result }
  }

  reset() {
    this.displayed = null;
    this.displayedSince = 0;
    this.displayedSig = '';
    this.pending = null;
  }

  _commit(result, now, sig) {
    this.displayed = result;
    this.displayedSince = now;
    this.displayedSig = sig;
    this.pending = null;
    return result;
  }

  update(result, snapshot, now) {
    const sig = segmentSignature(snapshot, this.opts.minWeight);

    // No notes held: clear everything.
    if (!snapshot || !snapshot.pitchClasses || snapshot.pitchClasses.length === 0) {
      this.reset();
      return result; // empty result passes through
    }

    // Notes present but engine recognized nothing: hold whatever we last showed.
    if (!result || result.chordName == null) {
      return this.displayed || result;
    }

    // First chord: show immediately.
    if (this.displayed == null) {
      return this._commit(result, now, sig);
    }

    // Same chord name: refresh fields, keep timing.
    if (result.chordName === this.displayed.chordName) {
      this.displayed = result;
      this.displayedSig = sig;
      this.pending = null;
      return this.displayed;
    }

    // Different name proposed. Don't switch on a low-confidence read.
    if (result.confidence < this.opts.confidenceThreshold) {
      this.pending = null;
      return this.displayed;
    }

    // New segment (the intentional note-set changed) switches fast; a mere
    // re-interpretation of the same note-set must persist longer.
    const newSegment = sig !== this.displayedSig;
    const delay = newSegment ? this.opts.segmentSwitchMs : this.opts.reinterpretSwitchMs;

    if (!this.pending || this.pending.name !== result.chordName) {
      this.pending = { name: result.chordName, since: now, result };
    } else {
      this.pending.result = result;
    }

    if (now - this.pending.since >= delay) {
      return this._commit(result, now, sig);
    }
    return this.displayed;
  }

  debugState() {
    return {
      displayed: this.displayed ? this.displayed.chordName : null,
      displayedSig: this.displayedSig,
      pending: this.pending ? this.pending.name : null,
      pendingSince: this.pending ? this.pending.since : null,
    };
  }
}

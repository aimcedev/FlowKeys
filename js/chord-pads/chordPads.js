// Default pads (ported from Chord Pads app, keys removed — not used in Flow Keys)
const DEFAULT_PADS = [
  { name: '1',   notes: [48, 55, 60, 36, 64] },
  { name: '2',   notes: [50, 57, 55, 62, 65, 57, 38] },
  { name: '1/3', notes: [52, 64, 60, 67, 40, 59] },
  { name: '4',   notes: [53, 60, 65, 67, 69, 41, 48] },
  { name: '5',   notes: [55, 62, 67, 43, 71, 50] },
  { name: '6',   notes: [57, 72, 64, 45, 67, 52] },
  { name: '5/7', notes: [47, 59, 69, 74, 67, 55] },
  { name: '8',   notes: [64, 67, 60, 55, 43, 72, 76] },
  { name: 'b7',  notes: [77, 72, 67, 58, 46, 53, 62] },
  { name: 'b6',  notes: [79, 72, 67, 56, 44, 51, 60] },
  { name: '4/6', notes: [45, 57, 60, 65, 67] },
  { name: '4/5', notes: [53, 41, 67, 71, 60, 48, 62] },
];

export class ChordPads {
  constructor() {
    this.pads = DEFAULT_PADS.map(p => ({ name: p.name, notes: [...p.notes], isActive: false }));
    this.channel = 1;
    this.velocity = 70;
    this.smartSustain = true;
    this.humanizeAmount = 50; // 0–100
    this.keyTranspose = 0;   // semitones from C; updated by app.js on song-key change

    // padIndex → [{ midi, releaseDelay }]
    this.activePadNoteOffs = new Map();
    // padIndex → [timeoutIds]
    this.pendingTimeouts = new Map();

    // Called by ChordPadsPanel whenever pads change (names, notes, add/remove)
    this.onPadsChanged = null;

    // Called with synthetic MIDI events so the performance engine can track
    // chord-pad notes and feed them to modules (Bass, Arp, Keyboard, etc.).
    // Signature: onNoteEvents(events) where events is an array of
    // { status, note, velocity } objects using the raw MIDI byte format.
    this.onNoteEvents = null;
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  triggerPadDown(index) {
    const pad = this.pads[index];
    if (!pad) return;

    if (this.smartSustain) {
      // Hard-stop all other pads before playing the new one
      this.activePadNoteOffs.forEach((_, i) => {
        if (i !== index) this._stopPad(i, true);
      });
    }

    if (pad.notes.length === 0) return;

    pad.isActive = true;

    // Cancel any pending note-on timeouts for this pad (re-trigger)
    this._clearPendingTimeouts(index);

    const humanize = this.humanizeAmount / 100;
    const noteInfos = [];
    const timeoutIds = [];

    const noteOnEvents = [];
    pad.notes.forEach((midiNote, i) => {
      const velJitter = humanize > 0 ? Math.round((Math.random() * 2 - 1) * humanize * 30) : 0;
      const vel = Math.max(1, Math.min(127, this.velocity + velJitter));
      const delay = humanize > 0 ? Math.round(Math.random() * humanize * 30) : 0;
      const releaseDelay = humanize > 0 ? Math.round(Math.random() * humanize * 50) : 0;

      const transposedNote = Math.max(0, Math.min(127, midiNote + this.keyTranspose));
      noteInfos.push({ midi: midiNote, out: transposedNote, releaseDelay, vel });

      if (delay <= 0) {
        noteOnEvents.push({ status: 0x90, note: transposedNote, velocity: vel });
      } else {
        const tid = setTimeout(() => {
          if (this.onNoteEvents) this.onNoteEvents([{ status: 0x90, note: transposedNote, velocity: vel }]);
        }, delay);
        timeoutIds.push(tid);
      }
    });

    // Fire immediate note-ons in a single batch
    if (noteOnEvents.length > 0 && this.onNoteEvents) {
      this.onNoteEvents(noteOnEvents);
    }

    this.pendingTimeouts.set(index, timeoutIds);
    this.activePadNoteOffs.set(index, noteInfos);

    if (this.onPadsChanged) this.onPadsChanged();
  }

  triggerPadUp(index) {
    // In smart sustain (latch) mode, ignore pad up — sustain until new pad pressed
    if (this.smartSustain) return;
    this._stopPad(index, false);
  }

  stopAll() {
    const indices = [...this.activePadNoteOffs.keys()];
    indices.forEach(i => this._stopPad(i, true));
    if (this.onPadsChanged) this.onPadsChanged();
  }

  panic() {
    const noteOffEvents = [];
    this.activePadNoteOffs.forEach((noteInfos, index) => {
      noteInfos.forEach(({ out }) => {
        noteOffEvents.push({ status: 0x80, note: out, velocity: 0 });
      });
      if (this.pads[index]) this.pads[index].isActive = false;
    });
    this.activePadNoteOffs.clear();
    this._clearAllPendingTimeouts();
    if (noteOffEvents.length > 0 && this.onNoteEvents) this.onNoteEvents(noteOffEvents);
    if (this.onPadsChanged) this.onPadsChanged();
  }

  // ── State persistence ──────────────────────────────────────────────────────

  getState() {
    return {
      pads: this.pads.map(p => ({ name: p.name, notes: [...p.notes] })),
      channel: this.channel,
      velocity: this.velocity,
      smartSustain: this.smartSustain,
      humanizeAmount: this.humanizeAmount,
    };
  }

  loadState(state) {
    if (!state) return;
    if (Array.isArray(state.pads) && state.pads.length > 0) {
      this.pads = state.pads.map(p => ({ name: p.name || '?', notes: Array.isArray(p.notes) ? [...p.notes] : [], isActive: false }));
    }
    if (state.channel != null) this.channel = parseInt(state.channel, 10) || 1;
    if (state.velocity != null) this.velocity = parseInt(state.velocity, 10) || 100;
    if (state.smartSustain != null) this.smartSustain = !!state.smartSustain;
    if (state.humanizeAmount != null) this.humanizeAmount = parseInt(state.humanizeAmount, 10);
  }

  // ── Pad editing ────────────────────────────────────────────────────────────

  setPadName(index, name) {
    if (this.pads[index]) {
      this.pads[index].name = name || (index + 1).toString();
      if (this.onPadsChanged) this.onPadsChanged();
    }
  }

  setPadNotes(index, notes) {
    if (this.pads[index]) {
      this.pads[index].notes = notes;
      if (this.onPadsChanged) this.onPadsChanged();
    }
  }

  toggleNoteInPad(padIndex, midiNote) {
    const pad = this.pads[padIndex];
    if (!pad) return;
    const i = pad.notes.indexOf(midiNote);
    if (i === -1) {
      pad.notes.push(midiNote);
    } else {
      pad.notes.splice(i, 1);
    }
    if (this.onPadsChanged) this.onPadsChanged();
  }

  addPad() {
    this.pads.push({ name: (this.pads.length + 1).toString(), notes: [], isActive: false });
    if (this.onPadsChanged) this.onPadsChanged();
  }

  removePad(index) {
    if (this.pads.length <= 1) return;
    this._stopPad(index, true);
    this.pads.splice(index, 1);
    // Re-key activePadNoteOffs above removed index
    const newMap = new Map();
    this.activePadNoteOffs.forEach((v, k) => {
      if (k < index) newMap.set(k, v);
      else if (k > index) newMap.set(k - 1, v);
    });
    this.activePadNoteOffs = newMap;
    if (this.onPadsChanged) this.onPadsChanged();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _stopPad(index, hardStop) {
    const noteInfos = this.activePadNoteOffs.get(index);
    if (!noteInfos) return;

    if (this.pads[index]) this.pads[index].isActive = false;

    const noteOffEvents = [];
    noteInfos.forEach(({ out, releaseDelay }) => {
      const humanize = this.humanizeAmount / 100;
      if (!hardStop && humanize > 0 && releaseDelay > 0) {
        setTimeout(() => {
          if (this.onNoteEvents) this.onNoteEvents([{ status: 0x80, note: out, velocity: 0 }]);
        }, releaseDelay);
      } else {
        noteOffEvents.push({ status: 0x80, note: out, velocity: 0 });
      }
    });

    if (noteOffEvents.length > 0 && this.onNoteEvents) {
      this.onNoteEvents(noteOffEvents);
    }

    this.activePadNoteOffs.delete(index);
  }

  _clearPendingTimeouts(index) {
    const ids = this.pendingTimeouts.get(index);
    if (ids) ids.forEach(id => clearTimeout(id));
    this.pendingTimeouts.delete(index);
  }

  _clearAllPendingTimeouts() {
    this.pendingTimeouts.forEach(ids => ids.forEach(id => clearTimeout(id)));
    this.pendingTimeouts.clear();
  }
}

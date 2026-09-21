import { applyEasing } from '../utils/easing.js';
import { PITCH_BEND_CENTER } from '../utils/midiConstants.js';

// MPE per-note channels — channels 2–16 (15-voice polyphony max)
const MPE_CHANNELS = Array.from({ length: 15 }, (_, i) => i + 2);

export class GlideModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;
    this.isTempoBased = false;

    this.glideMs = 200;
    this.curve = 'ease-out';
    this.pitchBendRange = 24;
    this.volume = 100;

    // channel → { note, targetNote, velocity, rafRef: { id } }
    this._voices = new Map();
    this._freeChannels = [...MPE_CHANNELS];
    this._lastVelocity = 100;
    this._settleTimer = null;
  }

  setConfig(chan, glideMs, curve, pitchBendRange) {
    this.glideMs = Math.max(0, Math.min(3000, parseInt(glideMs, 10) || 200));
    this.curve = curve || 'ease-out';
    const newRange = Math.max(1, Math.min(48, parseInt(pitchBendRange, 10) || 24));
    if (newRange !== this.pitchBendRange) {
      this.pitchBendRange = newRange;
      if (this.isActive) this._initMpeChannels();
    }
  }

  toggle(active) {
    this.isActive = active;
    if (active) {
      this._initMpeChannels();
    } else {
      this._releaseAll();
    }
  }

  processState(state) {
    if (!this.isActive) return;
    const { latestEvent, activeNotes, sustainedNotes } = state;
    if (!latestEvent) return;

    const cmd = latestEvent.status >> 4;
    if (cmd === 9 && latestEvent.isNoteOn) this._lastVelocity = latestEvent.velocity;
    if (cmd !== 8 && cmd !== 9) return;

    if (this._settleTimer !== null) clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      const chord = [...new Set([
        ...Array.from(activeNotes.keys()),
        ...sustainedNotes,
      ])].sort((a, b) => a - b);
      this._onChordChange(chord);
    }, 30);
  }

  onTick() {}
  setSequence() {}

  setVolumeImmediate(vol) {
    this.volume = vol;
    for (const ch of MPE_CHANNELS) this.midi.sendCC(ch, 7, vol);
  }

  panic() {
    if (this._settleTimer !== null) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    this._releaseAll();
    this.isActive = false;
  }

  // ── MPE setup ──────────────────────────────────────────────────────────────

  _initMpeChannels() {
    for (const ch of MPE_CHANNELS) {
      this._setPitchBendRange(ch, this.pitchBendRange);
      this.midi.sendCC(ch, 7, this.volume);
    }
  }

  // Set pitch bend range via RPN 0 (standard MIDI)
  _setPitchBendRange(channel, semitones) {
    this.midi.sendCC(channel, 101, 0);   // RPN MSB = 0
    this.midi.sendCC(channel, 100, 0);   // RPN LSB = 0 (Pitch Bend Range)
    this.midi.sendCC(channel, 6, semitones); // Data Entry MSB = range
    this.midi.sendCC(channel, 38, 0);    // Data Entry LSB = 0
    this.midi.sendCC(channel, 101, 127); // Null RPN
    this.midi.sendCC(channel, 100, 127);
  }

  // ── Chord change ───────────────────────────────────────────────────────────

  _onChordChange(newChord) {
    if (newChord.length === 0) {
      this._releaseAll();
      return;
    }

    // Snap any in-progress glides so voices are at definite pitches
    const allChannels = [...this._voices.keys()];
    for (const ch of allChannels) this._snapToTarget(ch);

    // Re-read voices after snap (notes may have advanced to their targets)
    const oldVoices = [...this._voices.entries()]
      .sort((a, b) => a[1].note - b[1].note)
      .map(([ch, v]) => ({ ch, note: v.note }));

    const newNotes = [...newChord];
    const paired = Math.min(oldVoices.length, newNotes.length);

    // Glide matched voice pairs (position-based voice leading)
    for (let i = 0; i < paired; i++) {
      const { ch, note: fromNote } = oldVoices[i];
      const toNote = newNotes[i];
      if (fromNote !== toNote) this._startGlide(ch, fromNote, toNote, this._lastVelocity);
    }

    // Release extra old voices (chord shrank)
    for (let i = paired; i < oldVoices.length; i++) {
      this._releaseVoice(oldVoices[i].ch);
    }

    // Start new voices for extra notes (chord grew)
    for (let i = paired; i < newNotes.length; i++) {
      const ch = this._freeChannels.shift();
      if (ch === undefined) break;
      this.midi.sendNoteOn(ch, newNotes[i], this._lastVelocity);
      this._voices.set(ch, { note: newNotes[i], targetNote: null, velocity: this._lastVelocity, rafRef: { id: null } });
    }
  }

  // ── Per-voice glide animation ──────────────────────────────────────────────

  _startGlide(channel, fromNote, toNote, velocity) {
    const voice = this._voices.get(channel);
    if (!voice) return;

    const targetBend = Math.round((toNote - fromNote) * 8191 / this.pitchBendRange);
    voice.targetNote = toNote;
    voice.velocity = velocity;

    if (this.glideMs <= 0) {
      this.midi.sendNoteOff(channel, fromNote);
      this.midi.sendNoteOn(channel, toNote, velocity);
      this._sendPitchBend(channel, 0);
      voice.note = toNote;
      voice.targetNote = null;
      return;
    }

    const startTime = performance.now();
    const rafRef = { id: null };
    voice.rafRef = rafRef;

    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / this.glideMs);
      this._sendPitchBend(channel, Math.round(targetBend * applyEasing(t, this.curve)));

      if (t < 1) {
        rafRef.id = requestAnimationFrame(tick);
      } else {
        rafRef.id = null;
        this.midi.sendNoteOff(channel, fromNote);
        this.midi.sendNoteOn(channel, toNote, velocity);
        this._sendPitchBend(channel, 0);
        voice.note = toNote;
        voice.targetNote = null;
      }
    };

    rafRef.id = requestAnimationFrame(tick);
  }

  // Instantly complete any running glide on this channel
  _snapToTarget(channel) {
    const voice = this._voices.get(channel);
    if (!voice) return;
    if (voice.rafRef?.id) { cancelAnimationFrame(voice.rafRef.id); voice.rafRef.id = null; }
    if (voice.targetNote !== null && voice.targetNote !== voice.note) {
      this.midi.sendNoteOff(channel, voice.note);
      this.midi.sendNoteOn(channel, voice.targetNote, voice.velocity);
      this._sendPitchBend(channel, 0);
      voice.note = voice.targetNote;
      voice.targetNote = null;
    }
  }

  _releaseVoice(channel) {
    const voice = this._voices.get(channel);
    if (!voice) return;
    if (voice.rafRef?.id) { cancelAnimationFrame(voice.rafRef.id); voice.rafRef.id = null; }
    this.midi.sendNoteOff(channel, voice.note);
    this._sendPitchBend(channel, 0);
    this._voices.delete(channel);
    this._freeChannels.push(channel);
  }

  _releaseAll() {
    if (this._settleTimer !== null) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    for (const [ch, voice] of this._voices) {
      if (voice.rafRef?.id) cancelAnimationFrame(voice.rafRef.id);
      this.midi.sendNoteOff(ch, voice.note);
      this._sendPitchBend(ch, 0);
    }
    this._voices.clear();
    this._freeChannels = [...MPE_CHANNELS];
  }

  _sendPitchBend(channel, bendUnits) {
    const absolute = Math.max(0, Math.min(16383, PITCH_BEND_CENTER + bendUnits));
    const lsb = absolute & 0x7F;
    const msb = (absolute >> 7) & 0x7F;
    this.midi.sendRawMessage(channel, 0xE0, lsb, msb);
  }
}

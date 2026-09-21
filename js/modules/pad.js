export class PadModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;
    
    this.channel = 4; // Default Ch 4
    this.rootNote = 60; // Default C4
    this.volume = 100;

    // State
    this.playingNotes = []; // The 1-5 notes currently holding
  }

  setConfig(channel, rootNote) {
    const oldChannel = this.channel;
    this.channel = parseInt(channel, 10);
    
    // Calculate new root in the 4th octave roughly (C3-B3 or C4-B4)
    // The dropdown has absolute midi values ranging 60 to 71
    const newRoot = parseInt(rootNote, 10);
    
    if (this.isActive && (oldChannel !== this.channel || newRoot !== this.rootNote)) {
      this.stopPad();
      this.rootNote = newRoot;
      this.playPad();
    } else {
      this.rootNote = newRoot;
    }
  }

  toggle(active) {
    this.isActive = active;
    if (this.isActive) {
      this.playPad();
    } else {
      this.stopPad();
    }
  }

  processState(state) {
    // Pad is static 1-5, so it doesn't really need to listen to live state
    // but having it registered allows it to hear panic or do future intelligent chord detection
  }

  playPad() {
    if (this.playingNotes.length > 0) return;

    // Pad 1-5 voicing: root, fifth
    const root = this.rootNote;
    const fifth = root + 7;

    // Set playingNotes before the sends so the MIDI wrapper's synchronous
    // triggerMeter call reads the correct note list for the visualizer.
    this.playingNotes = [root, fifth];

    this.midi.sendNoteOn(this.channel, root, 80);
    this.midi.sendNoteOn(this.channel, fifth, 80);
  }

  stopPad() {
    const notesToStop = [...this.playingNotes];
    // Clear before the sends so triggerMeter reads an empty list on note-off.
    this.playingNotes = [];
    notesToStop.forEach(note => {
      this.midi.sendNoteOff(this.channel, note);
    });
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  panic() {
    this.stopPad();
    this.isActive = false;
  }
}

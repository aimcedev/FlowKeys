export class BassModule {
  constructor(midiManager, instanceId) {
    this.midi = midiManager;
    this.instanceId = instanceId;
    this.isActive = false;
    
    // Config
    this.channel = 2; // Default Ch 2
    this.inMinNote = 21; // Default A-1
    this.inMaxNote = 59; // Default B2
    this.outMinNote = 28; // Default E1
    this.outMaxNote = 52; // Default E3
    this.volume = 100;


    // State
    this.currentlyPlayingNote = null;
    this.waitingForNewStrike = false;
    this.pendingPedalCheck = false;
    this.waitingForPedalLift = false;
    this.currentSustainDown = false;
    this.waitingToTurnOff = false;
  }

  setConfig(channel, inMinStr, inMaxStr, outMinStr, outMaxStr) {
    this.channel = parseInt(channel, 10);
    this.inMinNote = this.noteStringToMidi(inMinStr || 'A-1');
    this.inMaxNote = this.noteStringToMidi(inMaxStr || 'B2');
    this.outMinNote = this.noteStringToMidi(outMinStr || 'E1');
    this.outMaxNote = this.noteStringToMidi(outMaxStr || 'E3');
  }

  noteStringToMidi(noteStr) {
    // E.g., C2 -> 36, E1 -> 28
    const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
    const match = noteStr.trim().match(/^([A-Ga-g]#?)(-?[0-9])$/);
    if (!match) return 36; // fallback to C2
    const noteName = match[1].toUpperCase();
    const octave = parseInt(match[2], 10);
    return (octave + 1) * 12 + noteMap[noteName];
  }

  toggle(active) {
    if (active) {
      if (!this.isActive) {
        this.waitingToTurnOff = false;
        // Don't play immediately; wait for next strike
        this.waitingForNewStrike = true;
        // We also need to check if the sustain pedal is currently down.
        // This allows us to wait for the pedal lift before picking up new chords.
        this.pendingPedalCheck = true;
      }
      this.isActive = true;
    } else {
      if (this.currentSustainDown && this.currentlyPlayingNote !== null) {
        // Defer effectively turning off the playing note until pedal lift
        this.waitingToTurnOff = true;
        this.isActive = false;
      } else {
        this.isActive = false;
        this.waitingToTurnOff = false;
        this.stopCurrentNote();
        this.pendingPedalCheck = false;
        this.waitingForPedalLift = false;
      }
    }
  }

  processState(state) {
    this.currentSustainDown = state.sustainDown;

    if (this.waitingToTurnOff) {
      if (!state.sustainDown) {
        this.waitingToTurnOff = false;
        this.stopCurrentNote();
        this.pendingPedalCheck = false;
        this.waitingForPedalLift = false;
      }
      return;
    }

    if (!this.isActive) return;

    const { latestEvent, sustainDown } = state;

    // Check pedal state immediately upon turning the module ON
    if (this.pendingPedalCheck) {
      this.pendingPedalCheck = false;
      if (sustainDown) {
        this.waitingForPedalLift = true;
      } else {
        // If the pedal is already lifted when toggled ON (e.g. entering section via pedal lift),
        // we shouldn't wait for a new physical strike because the pedal lift itself was the deliberate trigger.
        this.waitingForNewStrike = false;
      }
    }

    // Handled pedal states during entry
    if (this.waitingForPedalLift) {
      if (!sustainDown) {
        // Pedal was lifted! Clear the wait flag and pick up currently held notes.
        this.waitingForPedalLift = false;
        this.waitingForNewStrike = false;
      } else {
        // Pedal is still being held, wait and don't play anything.
        return;
      }
    }

    // Filter incoming notes based on Input Range
    const allNotes = new Set([
      ...Array.from((state.activeNotes || new Map()).keys()),
      ...(state.sustainedNotes || new Set())
    ]);
    
    const validNotes = Array.from(allNotes).filter(n => n >= this.inMinNote && n <= this.inMaxNote);
    validNotes.sort((a, b) => a - b);
    const expectedLowestNote = validNotes.length > 0 ? validNotes[0] : null;

    // Condition 1: All valid notes released
    if (expectedLowestNote === null) {
      this.stopCurrentNote();
      this.waitingForNewStrike = false;
      return;
    }

    // Condition 2: A note is being played
    // Did it just change to a new lowest valid note?
    const isNewNoteOn = latestEvent && latestEvent.isNoteOn && latestEvent.note === expectedLowestNote;

    if (this.waitingForNewStrike && !isNewNoteOn) {
      // Waiting for a new strike, don't do anything yet
      return;
    }

    // Now we have a valid trigger
    this.waitingForNewStrike = false;

    // Check if lowest note changed from our currently playing note (pre-octave shift)
    const targetBaseNote = expectedLowestNote;

    if (this.currentlyPlayingNote !== null && this.currentlyPlayingNote.orig !== targetBaseNote) {
      // Pedal Latch: If the pedal is actively held, do not shift the current bass note.
      // This allows the player to tinker with melody/arpeggios without triggering new bass notes,
      // and guarantees chord bass note changes happen cleanly ONLY when the pedal is lifted.
      if (sustainDown) {
        return;
      }
      this.stopCurrentNote();
    }

    if (this.currentlyPlayingNote === null && targetBaseNote !== null) {
      let playVel = 100; // default decent velocity
      if (state.activeNotes && state.activeNotes.has(targetBaseNote)) {
        playVel = state.activeNotes.get(targetBaseNote).velocity;
      } else if (latestEvent && latestEvent.isNoteOn) {
        playVel = latestEvent.velocity;
      }
      this.playNote(targetBaseNote, playVel);
    }
  }

  playNote(origNote, velocity) {
    let shiftedNote = origNote;
    
    // Apply Output bounds (Output Min/Max Note constraints)
    // If it's too low, push octaves up until it's >= outMinNote
    while (shiftedNote < this.outMinNote && shiftedNote < 115) {
      shiftedNote += 12;
    }
    // If it's too high, push octaves down until it's <= outMaxNote
    while (shiftedNote > this.outMaxNote && shiftedNote > 12) {
      shiftedNote -= 12;
    }

    // Hard floor just in case
    if (shiftedNote < 12) shiftedNote = origNote;

    this.currentlyPlayingNote = { orig: origNote, out: shiftedNote };
    this.midi.sendNoteOn(this.channel, shiftedNote, velocity);
  }

  stopCurrentNote() {
    if (this.currentlyPlayingNote) {
      this.midi.sendNoteOff(this.channel, this.currentlyPlayingNote.out);
      this.currentlyPlayingNote = null;
    }
  }

  setVolumeImmediate(vol) {
    this.volume = vol;
    this.midi.sendCC(this.channel, 7, this.volume);
  }

  panic() {
    this.stopCurrentNote();
    this.isActive = false;
    this.waitingForNewStrike = false;
    this.waitingToTurnOff = false;
    this.pendingPedalCheck = false;
    this.waitingForPedalLift = false;
    this.currentSustainDown = false;
  }
}

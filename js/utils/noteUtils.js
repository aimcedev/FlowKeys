export const noteToName = (midiNote) => {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteIdx = midiNote % 12;
  return `${notes[noteIdx]}${octave}`;
};

export const noteToFrequency = (midiNote) => {
  // A4 = 440Hz -> MIDI Note 69
  return 440 * Math.pow(2, (midiNote - 69) / 12);
};

export const isNoteOn = (status, velocity) => {
  const cmd = status >> 4;
  return cmd === 9 && velocity > 0;
};

export const isNoteOff = (status, velocity) => {
  const cmd = status >> 4;
  // command 8 is note off, or command 9 with 0 velocity
  return cmd === 8 || (cmd === 9 && velocity === 0);
};

export const stepsForTimeSignature = (sig) => sig === '4/4' ? 16 : 12;

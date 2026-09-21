// pitch.js — pitch-class foundation
// Pure math. No key logic, no DOM, no MIDI. Safe to import anywhere.

// Pitch-class numbering: C=0 .. B=11
export const PITCH_CLASS_COUNT = 12;

// Two name tables. The actual sharp/flat decision lives in note-spelling.js;
// these are the raw fallbacks.
export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Map a note name (sharp or flat spelling) back to a pitch class.
export const NAME_TO_PC = (() => {
  const map = {};
  SHARP_NAMES.forEach((n, pc) => { map[n] = pc; });
  FLAT_NAMES.forEach((n, pc) => { map[n] = pc; });
  // A few common alternates / enharmonics.
  Object.assign(map, { 'Cb': 11, 'B#': 0, 'E#': 5, 'Fb': 4 });
  return map;
})();

// MIDI note 60 = middle C = C4 (pitch class 0).
export function midiToPitchClass(midi) {
  return ((midi % 12) + 12) % 12;
}

export function midiToOctave(midi) {
  // C-1 = MIDI 0 convention (so MIDI 60 -> octave 4).
  return Math.floor(midi / 12) - 1;
}

// Convert a note name like "C", "F#", "Bb" to a pitch class (0-11), or null.
export function nameToPitchClass(name) {
  const pc = NAME_TO_PC[name];
  return pc === undefined ? null : pc;
}

// Unique, sorted set of pitch classes present in a list of MIDI notes.
export function pitchClassesFromMidi(midiNotes) {
  const seen = new Set();
  for (const m of midiNotes) seen.add(midiToPitchClass(m));
  return [...seen].sort((a, b) => a - b);
}

// Interval (0-11) from root pitch class to a target pitch class.
export function intervalFromRoot(pc, rootPc) {
  return (((pc - rootPc) % 12) + 12) % 12;
}

// Given a set of pitch classes and a candidate root, return the sorted set of
// intervals (relative to that root) — this is what we match against chord formulas.
export function intervalsFromRoot(pitchClasses, rootPc) {
  const intervals = new Set();
  for (const pc of pitchClasses) intervals.add(intervalFromRoot(pc, rootPc));
  return [...intervals].sort((a, b) => a - b);
}

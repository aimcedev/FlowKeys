// chord-naming.js — turn a chord candidate into a human-readable name.
// Uses note-spelling for key-aware root + bass letters and the formula's symbol
// for the quality suffix. Examples: C, Cm, Cmaj7, C7, Cm7, Cadd9, Csus4,
// C/E, F/A, Bb, F#dim.

import { spellPitchClass, spellChord } from './note-spelling.js';
import { FORMULA_BY_QUALITY } from './chord-formulas.js';
import { QUALITY_PARTS_MAP } from './nashville.js';

function symbolFor(chord) {
  if (chord.formula && chord.formula.symbol != null) return chord.formula.symbol;
  const f = FORMULA_BY_QUALITY[chord.quality];
  return f ? f.symbol : '';
}

// chord = { rootPc, quality, bassPc|null, isInversion?, formula? }
export function nameChord(chord, key, playedPcs = []) {
  const spelled = spellChord(chord, playedPcs, key);
  const root = spelled.root;
  let name = root + symbolFor(chord);

  const inversion = chord.isInversion ?? (chord.bassPc != null && chord.bassPc !== chord.rootPc);
  if (inversion) {
    name += '/' + spelled.bass;
  }
  return name;
}

// Returns the chord broken into renderable parts (root, qualityLabel,
// extensionLabel, bass) so the UI can apply visual hierarchy without parsing
// the string. Mirrors nashvilleParts() in structure.
export function chordParts(chord, key, playedPcs = []) {
  const spelled = spellChord(chord, playedPcs, key);
  const p = QUALITY_PARTS_MAP[chord.quality] || { qualityLabel: '', extensionLabel: '' };
  const inversion = chord.isInversion ?? (chord.bassPc != null && chord.bassPc !== chord.rootPc);
  return {
    root: spelled.root,
    qualityLabel: p.qualityLabel,
    extensionLabel: p.extensionLabel,
    bass: inversion ? spelled.bass : null,
  };
}

// note-spelling.js — enharmonic policy
// Chooses sharp vs flat spelling for a pitch class based on the current key,
// applied consistently to chord roots, slash-bass notes, and extension labels.
//
// V1 approach: a per-key sharp/flat *preference* derived from the circle of
// fifths (flat keys spell with flats, sharp keys with sharps). This is simpler
// than full per-degree letter-name spelling but satisfies the common cases
// (F -> Bb not A#, E -> D# not Eb, Bb -> Eb not D#). True letter-name spelling
// (e.g. distinguishing G# from Ab by scale degree) is a later refinement.

import { SHARP_NAMES, FLAT_NAMES, nameToPitchClass, intervalFromRoot } from './pitch.js';

// Tonics (by pitch class) whose key signatures use flats.
const MAJOR_FLAT_PCS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'].map(nameToPitchClass));
const MINOR_FLAT_PCS = new Set(['D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab'].map(nameToPitchClass));

// Does the given key prefer flat spelling? Defaults to sharps when no key
// (covers neutral keys C major / A minor too).
export function prefersFlats(key) {
  if (!key || key.tonic == null) return false;
  const tonicPc = typeof key.tonic === 'number' ? key.tonic : nameToPitchClass(key.tonic);
  if (tonicPc == null) return false;
  return key.mode === 'minor' ? MINOR_FLAT_PCS.has(tonicPc) : MAJOR_FLAT_PCS.has(tonicPc);
}

// Spell a single pitch class as a note name string, honoring the key.
export function spellPitchClass(pc, key) {
  const table = prefersFlats(key) ? FLAT_NAMES : SHARP_NAMES;
  return table[((pc % 12) + 12) % 12];
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PCS = [0, 2, 4, 5, 7, 9, 11];

// Candidates for spelling each of the 12 root pitch classes.
const ROOT_SPELLING_CANDIDATES = {
  0: [{ letterIdx: 0, name: 'C' }, { letterIdx: 6, name: 'B#' }],
  1: [{ letterIdx: 0, name: 'C#' }, { letterIdx: 1, name: 'Db' }],
  2: [{ letterIdx: 1, name: 'D' }],
  3: [{ letterIdx: 1, name: 'D#' }, { letterIdx: 2, name: 'Eb' }],
  4: [{ letterIdx: 2, name: 'E' }, { letterIdx: 3, name: 'Fb' }],
  5: [{ letterIdx: 3, name: 'F' }, { letterIdx: 2, name: 'E#' }],
  6: [{ letterIdx: 3, name: 'F#' }, { letterIdx: 4, name: 'Gb' }],
  7: [{ letterIdx: 4, name: 'G' }],
  8: [{ letterIdx: 4, name: 'G#' }, { letterIdx: 5, name: 'Ab' }],
  9: [{ letterIdx: 5, name: 'A' }],
  10: [{ letterIdx: 5, name: 'A#' }, { letterIdx: 6, name: 'Bb' }],
  11: [{ letterIdx: 6, name: 'B' }, { letterIdx: 0, name: 'Cb' }],
};

// Primitive spelling based on degree offset and target pitch class.
export function spellByDegree(rootLetterIdx, rootPc, degree, targetPc) {
  const letterIdx = (rootLetterIdx + (degree - 1)) % 7;
  const letter = LETTERS[letterIdx];
  const naturalPc = NATURAL_PCS[letterIdx];

  let diff = (targetPc - naturalPc) % 12;
  if (diff < -6) diff += 12;
  if (diff > 6) diff -= 12;

  let accidental = '';
  if (diff === 1) accidental = '#';
  else if (diff === 2) accidental = '##';
  else if (diff === -1) accidental = 'b';
  else if (diff === -2) accidental = 'bb';
  else if (diff > 2) accidental = '#'.repeat(diff);
  else if (diff < -2) accidental = 'b'.repeat(-diff);

  return letter + accidental;
}

// Compute the accidental cost penalty for a given note spelling.
function getSpellingCost(name) {
  if (!name) return 0;
  let cost = 0;
  if (name.includes('bb') || name.includes('##')) {
    cost += 100;
  }
  const accidentals = (name.match(/[#b]/g) || []).length;
  cost += accidentals;
  return cost;
}

// Spells the entire recognized chord (root, bass, notes) consistently by degree/fifths.
export function spellChord(chord, playedPcs = [], key = null) {
  if (!chord || !chord.formula) {
    const root = chord && chord.rootPc != null ? spellPitchClass(chord.rootPc, key) : null;
    const bass = chord && chord.bassPc != null ? spellPitchClass(chord.bassPc, key) : null;
    const notes = playedPcs.map(pc => spellPitchClass(pc, key));
    return { root, bass, notes };
  }

  const rootPc = chord.rootPc;
  const bassPc = chord.bassPc;
  const formula = chord.formula;

  // Retrieve possible root candidates
  const candidates = ROOT_SPELLING_CANDIDATES[rootPc] || [
    { letterIdx: 0, name: spellPitchClass(rootPc, key) }
  ];

  let bestSpelling = null;
  let minCost = Infinity;
  const keyPrefersFlats = prefersFlats(key);

  for (const rootCand of candidates) {
    const rootName = rootCand.name;
    const rootLetterIdx = rootCand.letterIdx;

    // Spell all played pitch classes
    const spelledNotes = playedPcs.map(pc => {
      const interval = intervalFromRoot(pc, rootPc);
      const idx = formula.intervals.indexOf(interval);
      if (idx !== -1) {
        const degree = formula.degrees[idx];
        return spellByDegree(rootLetterIdx, rootPc, degree, pc);
      } else {
        return spellPitchClass(pc, key);
      }
    });

    // Spell bass note
    let bassName = null;
    if (bassPc != null) {
      const interval = intervalFromRoot(bassPc, rootPc);
      const idx = formula.intervals.indexOf(interval);
      if (idx !== -1) {
        const degree = formula.degrees[idx];
        bassName = spellByDegree(rootLetterIdx, rootPc, degree, bassPc);
      } else {
        bassName = spellPitchClass(bassPc, key);
      }
    }

    // Cost calculation
    let cost = 0;
    for (const note of spelledNotes) {
      cost += getSpellingCost(note);
    }
    // Include root spelling cost directly in the total cost
    cost += getSpellingCost(rootName);

    // Apply key-axis preference penalty as final tiebreak
    const isFlat = rootName.endsWith('b');
    const isSharp = rootName.endsWith('#');
    if (keyPrefersFlats && isSharp) {
      cost += 0.1;
    } else if (!keyPrefersFlats && isFlat) {
      cost += 0.1;
    }

    if (cost < minCost) {
      minCost = cost;
      bestSpelling = {
        root: rootName,
        bass: bassName,
        notes: spelledNotes,
      };
    }
  }

  return bestSpelling;
}

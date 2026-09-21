// chord-formulas.js — chord interval library (data only)
// Each formula's intervals are semitone offsets from the root (root = 0).
// `essential` lists intervals that strongly identify the quality; the scorer
// penalizes missing essentials heavily and tolerates missing non-essentials
// (e.g. the 5th, or the 9th in an 11/13).
//
// `complexity` is a rough "how exotic is this name" rank used by the simplicity
// term in scoring — lower is simpler/preferred when all else is equal.

export const FORMULAS = [
  // ---- Triads ----
  { quality: 'major',      symbol: '',      intervals: [0, 4, 7],          essential: [0, 4],        complexity: 0, degrees: [1, 3, 5] },
  { quality: 'minor',      symbol: 'm',     intervals: [0, 3, 7],          essential: [0, 3],        complexity: 0, degrees: [1, 3, 5] },
  { quality: 'diminished', symbol: 'dim',   intervals: [0, 3, 6],          essential: [0, 3, 6],     complexity: 2, degrees: [1, 3, 5] },
  { quality: 'augmented',  symbol: 'aug',   intervals: [0, 4, 8],          essential: [0, 4, 8],     complexity: 2, degrees: [1, 3, 5] },
  { quality: 'sus2',       symbol: 'sus2',  intervals: [0, 2, 7],          essential: [0, 2, 7],     complexity: 2, degrees: [1, 2, 5] },
  { quality: 'sus4',       symbol: 'sus4',  intervals: [0, 5, 7],          essential: [0, 5, 7],     complexity: 2, degrees: [1, 4, 5] },
  { quality: 'power5',     symbol: '5',     intervals: [0, 7],             essential: [0, 7],        complexity: 1, degrees: [1, 5] },

  // ---- Sixth / added-note chords ----
  { quality: 'sixth',      symbol: '6',     intervals: [0, 4, 7, 9],       essential: [0, 4, 9],     complexity: 1, degrees: [1, 3, 5, 6] },
  { quality: 'minorSixth', symbol: 'm6',    intervals: [0, 3, 7, 9],       essential: [0, 3, 9],     complexity: 1, degrees: [1, 3, 5, 6] },
  { quality: 'add9',       symbol: 'add9',  intervals: [0, 4, 7, 2],       essential: [0, 4, 2],     complexity: 2, degrees: [1, 3, 5, 9] },
  { quality: 'minorAdd9',  symbol: 'm(add9)', intervals: [0, 3, 7, 2],     essential: [0, 3, 2],     complexity: 2, degrees: [1, 3, 5, 9] },
  { quality: 'add4',       symbol: 'add4',  intervals: [0, 4, 7, 5],       essential: [0, 4, 5],     complexity: 2, degrees: [1, 3, 5, 4] },
  { quality: 'sixNine',    symbol: '6/9',   intervals: [0, 4, 7, 9, 2],    essential: [0, 4, 9, 2],  complexity: 3, degrees: [1, 3, 5, 6, 9] },
  { quality: 'minorSixNine', symbol: 'm6/9', intervals: [0, 3, 7, 9, 2],    essential: [0, 3, 9, 2],  complexity: 3, degrees: [1, 3, 5, 6, 9] },

  // ---- Seventh chords ----
  { quality: 'major7',     symbol: 'maj7',  intervals: [0, 4, 7, 11],      essential: [0, 4, 11],    complexity: 1, degrees: [1, 3, 5, 7] },
  { quality: 'dominant7',  symbol: '7',     intervals: [0, 4, 7, 10],      essential: [0, 4, 10],    complexity: 1, degrees: [1, 3, 5, 7] },
  { quality: 'minor7',     symbol: 'm7',    intervals: [0, 3, 7, 10],      essential: [0, 3, 10],    complexity: 1, degrees: [1, 3, 5, 7] },
  { quality: 'minorMajor7',symbol: 'm(maj7)', intervals: [0, 3, 7, 11],    essential: [0, 3, 11],    complexity: 3, degrees: [1, 3, 5, 7] },
  { quality: 'halfDim7',   symbol: 'm7b5',  intervals: [0, 3, 6, 10],      essential: [0, 3, 6, 10], complexity: 2, degrees: [1, 3, 5, 7] },
  { quality: 'dim7',       symbol: 'dim7',  intervals: [0, 3, 6, 9],       essential: [0, 3, 6, 9],  complexity: 2, degrees: [1, 3, 5, 7] },
  { quality: 'dom7sus4',   symbol: '7sus4', intervals: [0, 5, 7, 10],      essential: [0, 5, 10],    complexity: 2, degrees: [1, 4, 5, 7] },
  { quality: 'dom7b5',     symbol: '7b5',   intervals: [0, 4, 6, 10],      essential: [0, 4, 6, 10], complexity: 3, degrees: [1, 3, 5, 7] },
  { quality: 'dom7s5',     symbol: '7#5',   intervals: [0, 4, 8, 10],      essential: [0, 4, 8, 10], complexity: 3, degrees: [1, 3, 5, 7] },

  // ---- Extended/Altered chords ----
  { quality: 'dominant9',  symbol: '9',     intervals: [0, 4, 7, 10, 2],   essential: [0, 4, 10, 2], complexity: 3, degrees: [1, 3, 5, 7, 9] },
  { quality: 'minor9',     symbol: 'm9',    intervals: [0, 3, 7, 10, 2],   essential: [0, 3, 10, 2], complexity: 3, degrees: [1, 3, 5, 7, 9] },
  { quality: 'major9',     symbol: 'maj9',  intervals: [0, 4, 7, 11, 2],   essential: [0, 4, 11, 2], complexity: 3, degrees: [1, 3, 5, 7, 9] },
  { quality: 'dom9sus4',   symbol: '9sus4', intervals: [0, 5, 7, 10, 2],   essential: [0, 5, 10, 2], complexity: 3, degrees: [1, 4, 5, 7, 9] },
  { quality: 'dom7b9',     symbol: '7b9',   intervals: [0, 4, 7, 10, 1],   essential: [0, 4, 10, 1], complexity: 4, degrees: [1, 3, 5, 7, 9] },
  { quality: 'dom7s9',     symbol: '7#9',   intervals: [0, 4, 7, 10, 3],   essential: [0, 4, 10, 3], complexity: 4, degrees: [1, 3, 5, 7, 9] },
  { quality: 'dominant11', symbol: '11',    intervals: [0, 4, 7, 10, 2, 5],essential: [0, 10, 5],    complexity: 4, degrees: [1, 3, 5, 7, 9, 11] },
  { quality: 'minor11',    symbol: 'm11',   intervals: [0, 3, 7, 10, 2, 5],essential: [0, 3, 10, 5], complexity: 4, degrees: [1, 3, 5, 7, 9, 11] },
  { quality: 'major7s11',  symbol: 'maj7#11',intervals: [0, 4, 7, 11, 6],  essential: [0, 4, 11, 6], complexity: 4, degrees: [1, 3, 5, 7, 11] },
  { quality: 'dominant13', symbol: '13',    intervals: [0, 4, 7, 10, 2, 9],essential: [0, 4, 10, 9], complexity: 4, degrees: [1, 3, 5, 7, 9, 13] },
  { quality: 'minor13',    symbol: 'm13',   intervals: [0, 3, 7, 10, 2, 9],essential: [0, 3, 10, 9], complexity: 4, degrees: [1, 3, 5, 7, 9, 13] },
  { quality: 'major13',    symbol: 'maj13', intervals: [0, 4, 7, 11, 2, 9],essential: [0, 4, 11, 9], complexity: 4, degrees: [1, 3, 5, 7, 9, 13] },
];

// Quick lookup by quality name.
export const FORMULA_BY_QUALITY = (() => {
  const map = {};
  for (const f of FORMULAS) map[f.quality] = f;
  return map;
})();

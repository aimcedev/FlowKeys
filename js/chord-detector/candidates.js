// candidates.js — chord candidate generator
// Given the active pitch classes (and the bass pitch class), produce every
// plausible chord interpretation. We do NOT stop at the first match — scoring.js
// ranks the results. Example: C E G A -> both C6 and Am7/C are emitted.

import { FORMULAS } from './chord-formulas.js';
import { intervalsFromRoot, intervalFromRoot } from './pitch.js';

// allowMissingEssential: how many essential intervals a formula may lack and
// still be offered as a candidate (0 = literal, 1 = smart/forgiving).
export function generateCandidates(pitchClasses, bassPc = null, options = {}) {
  const { allowMissingEssential = 0 } = options;
  const present = new Set(pitchClasses);
  if (present.size === 0) return [];

  const candidates = [];

  for (const rootPc of present) {
    // Intervals of every played pitch class relative to this candidate root.
    const presentIntervals = intervalsFromRoot([...present], rootPc);
    const presentSet = new Set(presentIntervals);

    for (const formula of FORMULAS) {
      const matched = [];
      const missing = [];
      for (const iv of formula.intervals) {
        (presentSet.has(iv) ? matched : missing).push(iv);
      }
      const missingEssential = formula.essential.filter((iv) => !presentSet.has(iv));
      if (missingEssential.length > allowMissingEssential) continue;

      // Need at least the root plus one more matched tone to be a real chord.
      if (matched.length < 2) continue;

      const formulaSet = new Set(formula.intervals);
      const extra = presentIntervals.filter((iv) => !formulaSet.has(iv));

      candidates.push({
        rootPc,
        quality: formula.quality,
        formula,
        bassPc,
        isInversion: bassPc != null && bassPc !== rootPc,
        present: presentIntervals,
        matched,
        missing,
        missingEssential,
        extra,
      });
    }
  }

  return candidates;
}

// Upper-structure candidates: exclude the bass note from the chord pitch-class
// pool, then find chords in the remaining notes. This models the "bass player
// holds root, right hand plays a different chord" situation common in worship
// and band contexts. The bass is not a chord tone — it's a pedal.
export function generateUpperStructureCandidates(pitchClasses, bassPc, options = {}) {
  if (bassPc == null) return [];
  const upperPcs = pitchClasses.filter((pc) => pc !== bassPc);
  if (upperPcs.length < 2) return [];
  // Candidates from the upper notes, with the original bass as the forced slash.
  return generateCandidates(upperPcs, bassPc, options);
}

export { intervalFromRoot };

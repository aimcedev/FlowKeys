// scoring.js — rank chord candidates and select the best.
// Pure: takes candidates + a context object, returns them sorted by score with
// a confidence for the winner. Encodes the spec's bass/key tie-breaks.

import { intervalFromRoot } from './pitch.js';
import { nameToPitchClass } from './pitch.js';

// Tunable weights. Bass alignment is intentionally heavy — it's what makes
// C6 win over Am7/C (C in bass) and Am7 win over C6/A (A in bass).
export const WEIGHTS = {
  matched: 1.0,
  essentialBonus: 0.5,       // added per matched essential interval
  missingEssential: -3.0,    // per missing essential interval
  missingNonEssential: -0.4, // per missing non-essential interval
  extraNote: -1.4,           // per extra note (scaled by its temporal weight)
  rootPosition: 1.0,         // bass == root
  inversion: -0.7,           // bass != root (slash chord)
  cleanInversion: 0.5,       // bonus when slash chord has zero extra notes (clean voicing)
  diatonic: 1.0,             // all chord tones in key scale
  rootInScale: 0.3,          // root is a scale degree
  simplicity: -0.25,         // * formula.complexity
  prevContinuity: 0.5,       // same root as previous chord
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function scaleSetFor(key) {
  if (!key || key.tonic == null) return null;
  const tonicPc = typeof key.tonic === 'number' ? key.tonic : nameToPitchClass(key.tonic);
  if (tonicPc == null) return null;
  const steps = key.mode === 'minor' ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
  return new Set(steps.map((s) => (tonicPc + s) % 12));
}

function scoreCandidate(c, ctx) {
  const W = WEIGHTS;
  const scale = ctx.scaleSet;
  const weights = ctx.weights || null; // pitch class -> temporal weight (0..1)
  let score = 0;
  const weightFor = (iv) => {
    const pc = (c.rootPc + iv) % 12;
    return weights ? (weights[pc] ?? 1) : 1;
  };

  // 1-3. Note coverage. Matched tones contribute by temporal weight, so a
  //    fleeting note adds little even when it happens to fit the chord.
  for (const iv of c.matched) score += weightFor(iv) * W.matched;
  const essentialMatched = c.formula.essential.filter((iv) => !c.missingEssential.includes(iv));
  for (const iv of essentialMatched) score += weightFor(iv) * W.essentialBonus;
  score += c.missingEssential.length * W.missingEssential;
  const missingNonEssential = c.missing.length - c.missingEssential.length;
  score += missingNonEssential * W.missingNonEssential;

  // 4. Extra notes. Skip the bass pc (already charged via inversion weight).
  // Chromatic extras cost 2× — a C-based chord ignoring an F# is a strong signal
  // it's the wrong interpretation.
  let extrasBeyondBass = 0;
  for (const iv of c.extra) {
    const extraPc = (c.rootPc + iv) % 12;
    if (c.isInversion && c.bassPc != null && extraPc === c.bassPc) continue;
    extrasBeyondBass++;
    const chromatic = scale != null && !scale.has(extraPc);
    score += W.extraNote * weightFor(iv) * (chromatic ? 2.0 : 1.0);
  }

  // 5. Bass alignment.
  if (c.isInversion) {
    score += W.inversion;
    // Clean slash chord: all upper notes spell the chord with no unaccounted
    // extras (the bass note excluded). G B D over C bass = G/C, not some muddy guess.
    if (extrasBeyondBass === 0) score += W.cleanInversion;
  } else {
    score += W.rootPosition;
  }

  // 6. Key context.
  if (scale) {
    if (scale.has(c.rootPc)) score += W.rootInScale;
    const tones = c.formula.intervals.map((iv) => (c.rootPc + iv) % 12);
    if (tones.every((pc) => scale.has(pc))) score += W.diatonic;
  }

  // 7. Simplicity.
  score += c.formula.complexity * W.simplicity;

  // Prefer slash chords by penalizing root-position sus/11 structures
  if (ctx.slashSus === 'slash' && ['dom9sus4', 'dom7sus4', 'dominant11'].includes(c.quality)) {
    score -= 2.0;
  }

  // 8. Continuity with the previous chord.
  if (ctx.previousChord && ctx.previousChord.rootPc === c.rootPc) {
    score += W.prevContinuity;
  }

  return score;
}

function fitOf(c) {
  const denom = c.formula.intervals.length + c.extra.length;
  return denom === 0 ? 0 : c.matched.length / denom;
}

export function scoreCandidates(candidates, ctx = {}) {
  const context = { ...ctx, scaleSet: scaleSetFor(ctx.key) };
  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, context) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { ranked: [], confidence: 0 };

  const top = scored[0];
  const second = scored[1];
  const fit = fitOf(top);
  let sep = 1;
  if (second) {
    sep = Math.max(0, Math.min(1, (top.score - second.score) / (Math.abs(top.score) + 3)));
  }
  const confidence = Math.max(0, Math.min(0.99, 0.4 + 0.5 * fit + 0.1 * sep));

  return { ranked: scored, confidence };
}

export { scoreCandidate, intervalFromRoot };

// chord-engine.js — public API. The embeddable core: NO DOM, NO Web MIDI.
// detectChord(activeNotes, options) -> structured result.
//
//   activeNotes: array of MIDI note numbers, OR a note-state snapshot object
//                ({ pitchClasses, bassPc, weights, ... }) for richer scoring.
//   options: {
//     key: { tonic, mode } | null,
//     previousChord: { rootPc, quality } | null,
//     mode: "literal" | "smart",        // "smart" relaxes scoring (V1); alias: smartInference
//     nashvilleStyle: { minorMode, minorSymbol },
//   }

import { pitchClassesFromMidi, midiToPitchClass } from './pitch.js';
import { spellPitchClass, spellChord } from './note-spelling.js';
import { generateCandidates, generateUpperStructureCandidates } from './candidates.js';
import { scoreCandidates } from './scoring.js';
import { nameChord, chordParts } from './chord-naming.js';
import { toNashville, nashvilleParts, DEFAULT_NASHVILLE_STYLE } from './nashville.js';

const EMPTY_RESULT = {
  chordName: null,
  nashville: null,
  confidence: 0,
  bassNote: null,
  root: null,
  quality: null,
  rootPc: null,
  bassPc: null,
  notes: [],
  alternatives: [],
  candidates: [],
};

// Normalize either a MIDI array or a snapshot into a common shape.
function normalizeInput(activeNotes) {
  if (Array.isArray(activeNotes)) {
    const sorted = [...activeNotes].sort((a, b) => a - b);
    const pcs = pitchClassesFromMidi(sorted);
    return {
      pitchClasses: pcs,
      bassPc: sorted.length ? midiToPitchClass(sorted[0]) : null,
      weights: null,
      midiNotes: sorted,
    };
  }
  // Assume a note-state snapshot.
  const midiNotes = (
    activeNotes.noteMeta
      ? activeNotes.noteMeta.map((n) => n.midi)
      : activeNotes.activeNotes || []
  ).slice().sort((a, b) => a - b);
  return {
    pitchClasses: activeNotes.pitchClasses || [],
    bassPc: activeNotes.bassPc ?? null,
    weights: activeNotes.weights || null,
    midiNotes,
  };
}

// A gap of a P5 (7 semitones) or more between the low cluster and the upper
// notes is the register split signal. The low cluster = bass voicing (1-5, 1-5-1).
// When detected, only use the upper notes for chord identification.
const REGISTER_GAP_ST = 7;

function findRegisterSplit(sortedMidi) {
  if (sortedMidi.length < 3) return null;
  // Walk from the bottom up; the last qualifying gap (≥ REGISTER_GAP_ST) that
  // leaves ≥ 2 notes above it defines the bass/treble boundary.
  let splitIdx = -1;
  for (let i = 0; i < sortedMidi.length - 2; i++) {
    if (sortedMidi[i + 1] - sortedMidi[i] >= REGISTER_GAP_ST) splitIdx = i;
  }
  // Require at least 2 bass notes (the 1-5 or 1-5-1 voicing pattern).
  // A single low note alone is not enough to trigger register separation.
  if (splitIdx < 1) return null;
  const bassNotes  = sortedMidi.slice(0, splitIdx + 1);
  const trebleNotes = sortedMidi.slice(splitIdx + 1);
  if (trebleNotes.length < 2) return null;
  return { bassNotes, trebleNotes };
}

function orderFromBass(pitchClasses, bassPc) {
  const ref = bassPc ?? (pitchClasses[0] ?? 0);
  return [...pitchClasses].sort(
    (a, b) => ((a - ref + 12) % 12) - ((b - ref + 12) % 12)
  );
}

export function detectChord(activeNotes, options = {}) {
  const { key = null, previousChord = null, nashvilleStyle = DEFAULT_NASHVILLE_STYLE, slashSus = 'sus' } = options;
  const smart = options.mode === 'smart' || options.smartInference === true;

  const { pitchClasses, bassPc, weights, midiNotes } = normalizeInput(activeNotes);
  if (!pitchClasses.length) return { ...EMPTY_RESULT };

  const candOptions = { allowMissingEssential: smart ? 1 : 0 };

  // Check for a left-hand / right-hand register split (e.g. C+G bass voicing
  // with D+F# chord above). When detected, find the chord from the upper notes
  // only — the low cluster is the bass pedal, not chord tones. When we find
  // a good split, trust it entirely; don't let full-set candidates override it.
  const split = findRegisterSplit(midiNotes || []);
  let allCands;
  if (split) {
    const slashPc   = midiToPitchClass(split.bassNotes[0]);
    const treblePcs = [...new Set(split.trebleNotes.map(midiToPitchClass))];
    // Use treblePcs directly — if the bass pitch class (e.g. C) also appears
    // as a treble note, it CAN be the chord root (C G C E G C = C major, not Em/C).
    // Only when C is absent from the treble set entirely (D/C case) does it
    // become unavailable as a root, naturally preventing false Csus2 matches.
    const splitCands = treblePcs.length >= 2
      ? generateCandidates(pitchClasses, slashPc, candOptions)
      : [];
    // Use split candidates exclusively if any were found. Fall back to normal
    // full-set detection only when the treble doesn't spell any chord at all.
    allCands = splitCands.length > 0
      ? splitCands
      : generateCandidates(pitchClasses, bassPc, candOptions);
  } else {
    const mainCands  = generateCandidates(pitchClasses, bassPc, candOptions);
    const upperCands = generateUpperStructureCandidates(pitchClasses, bassPc, candOptions);
    const mainKeys   = new Set(mainCands.map((c) => `${c.rootPc}-${c.quality}`));
    allCands = [...mainCands, ...upperCands.filter((c) => !mainKeys.has(`${c.rootPc}-${c.quality}`))];
  }

  const { ranked, confidence } = scoreCandidates(allCands, { key, previousChord, weights, slashSus });

  const orderedPcs = orderFromBass(pitchClasses, bassPc);
  const orderedNotesFallback = orderedPcs.map((pc) => spellPitchClass(pc, key));

  if (!ranked.length) {
    // Notes present but no chord recognized — still report the notes.
    return { ...EMPTY_RESULT, notes: orderedNotesFallback, bassPc, bassNote: bassPc == null ? null : spellPitchClass(bassPc, key) };
  }

  const top = ranked[0];
  const chord = {
    rootPc: top.rootPc,
    quality: top.quality,
    bassPc: top.bassPc,
    isInversion: top.isInversion,
    formula: top.formula,
  };

  const spelled = spellChord(chord, orderedPcs, key);

  // Build alternatives: next distinct chord names.
  const primaryName = nameChord(chord, key, pitchClasses);
  const alternatives = [];
  const seen = new Set([primaryName]);
  for (const c of ranked.slice(1)) {
    const n = nameChord(c, key, pitchClasses);
    if (seen.has(n)) continue;
    seen.add(n);
    alternatives.push(n);
    if (alternatives.length >= 3) break;
  }

  // Debug-friendly candidate list (name + score) for the demo panel.
  const candidates = ranked.slice(0, 8).map((c) => ({
    name: nameChord(c, key, pitchClasses),
    quality: c.quality,
    score: Math.round(c.score * 100) / 100,
    isInversion: c.isInversion,
  }));

  return {
    chordName: primaryName,
    nashville: toNashville(chord, key, nashvilleStyle),
    // Structured parts for visual hierarchy rendering — no string parsing needed.
    parts: chordParts(chord, key, pitchClasses),
    nashvilleParts: nashvilleParts(chord, key, nashvilleStyle),
    confidence: Math.round(confidence * 100) / 100,
    bassNote: spelled.bass,
    root: spelled.root,
    quality: top.quality,
    rootPc: top.rootPc,
    bassPc,
    notes: spelled.notes,
    alternatives,
    candidates,
  };
}

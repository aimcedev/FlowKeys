// nashville.js — Nashville Number System conversion (+ style settings)
//
// toNashville(chord, key, style) where:
//   chord = { rootPc, quality, bassPc|null }
//   key   = { tonic, mode }   tonic as note name or pitch class
//   style = { minorMode, minorSymbol }
//
// Examples in C major: C->"1", Dm->"2m", G7->"5⁷", Bb->"♭7", C/E->"1/3", F/A->"4/6".

import { nameToPitchClass, intervalFromRoot } from './pitch.js';

export const DEFAULT_NASHVILLE_STYLE = {
  // "1m"          -> minor tonic chord is 1m (count degrees from the minor tonic)
  // "relative6m"  -> minor key numbered against its relative major (tonic shows as 6m)
  // "majorRelative" -> same as relative6m for minor keys
  minorMode: '1m',
  // "m" -> "2m"   |  "-" -> "2-"
  minorSymbol: 'm',
};

// Map a semitone interval (0-11) above the reference tonic to a scale degree
// number + accidental, using the major scale as the reference frame.
const INTERVAL_TO_DEGREE = {
  0:  { number: 1, accidental: '' },
  1:  { number: 2, accidental: '♭' },
  2:  { number: 2, accidental: '' },
  3:  { number: 3, accidental: '♭' },
  4:  { number: 3, accidental: '' },
  5:  { number: 4, accidental: '' },
  6:  { number: 4, accidental: '♯' },
  7:  { number: 5, accidental: '' },
  8:  { number: 6, accidental: '♭' },
  9:  { number: 6, accidental: '' },
  10: { number: 7, accidental: '♭' },
  11: { number: 7, accidental: '' },
};

function tonicToPc(tonic) {
  return typeof tonic === 'number' ? ((tonic % 12) + 12) % 12 : nameToPitchClass(tonic);
}

// The pitch class that should be numbered as degree "1" for this key + style.
function referencePc(key, style) {
  const tonicPc = tonicToPc(key.tonic);
  if (key.mode === 'minor' && style.minorMode !== '1m') {
    // Number against the relative major (3 semitones up).
    return (tonicPc + 3) % 12;
  }
  return tonicPc;
}

// Nashville quality suffix. Superscripts on dominant extensions match the
// conventional "5⁷" notation; minor uses the configurable symbol.
function qualitySuffix(quality, m) {
  switch (quality) {
    case 'major':       return '';
    case 'minor':       return m;
    case 'diminished':  return '°';
    case 'augmented':   return '+';
    case 'sus2':        return 'sus2';
    case 'sus4':        return 'sus4';
    case 'power5':      return '5';
    case 'sixth':       return '6';
    case 'minorSixth':  return m + '6';
    case 'add9':        return 'add9';
    case 'minorAdd9':   return m + '(add9)';
    case 'add4':        return 'add4';
    case 'sixNine':     return '6/9';
    case 'minorSixNine':return m + '6/9';
    case 'major7':      return 'maj7';
    case 'dominant7':   return '⁷';
    case 'minor7':      return m + '7';
    case 'minorMajor7': return m + '(maj7)';
    case 'halfDim7':    return 'ø7';
    case 'dim7':        return '°7';
    case 'dom7sus4':    return '⁷sus4';
    case 'dom7b5':      return '⁷♭5';
    case 'dom7s5':      return '⁷♯5';
    case 'dominant9':   return '⁹';
    case 'minor9':      return m + '9';
    case 'major9':      return 'maj9';
    case 'dom9sus4':    return '⁹sus4';
    case 'dom7b9':      return '⁷♭9';
    case 'dom7s9':      return '⁷♯9';
    case 'dominant11':  return '¹¹';
    case 'minor11':     return m + '11';
    case 'major7s11':   return 'maj7♯11';
    case 'dominant13':  return '¹³';
    case 'minor13':     return m + '13';
    case 'major13':     return 'maj13';
    default:            return '';
  }
}

// Just the degree token (accidental + number) for a pitch class — used for the
// root and for the slash-bass note.
export function degreeToken(pc, refPc) {
  const interval = intervalFromRoot(pc, refPc);
  const d = INTERVAL_TO_DEGREE[interval];
  return d.accidental + d.number;
}

export function toNashville(chord, key, style = DEFAULT_NASHVILLE_STYLE) {
  if (!key || key.tonic == null) return null;
  const s = { ...DEFAULT_NASHVILLE_STYLE, ...style };
  const refPc = referencePc(key, s);

  const rootToken = degreeToken(chord.rootPc, refPc);
  let out = rootToken + qualitySuffix(chord.quality, s.minorSymbol);

  if (chord.bassPc != null && chord.bassPc !== chord.rootPc) {
    out += '/' + degreeToken(chord.bassPc, refPc);
  }
  return out;
}

// How each quality splits into a basic-quality label + extension label.
// qualityLabel = the chord's fundamental nature (m, dim, +, sus…)
// extensionLabel = what's added on top (7, maj7, (add9)…)
const QUALITY_PARTS_MAP = {
  major:       { qualityLabel: '',     extensionLabel: '' },
  minor:       { qualityLabel: 'm',    extensionLabel: '' },
  diminished:  { qualityLabel: '°',    extensionLabel: '' },
  augmented:   { qualityLabel: '+',    extensionLabel: '' },
  sus2:        { qualityLabel: 'sus2', extensionLabel: '' },
  sus4:        { qualityLabel: 'sus4', extensionLabel: '' },
  power5:      { qualityLabel: '',     extensionLabel: '5' },
  sixth:       { qualityLabel: '',     extensionLabel: '6' },
  minorSixth:  { qualityLabel: 'm',    extensionLabel: '6' },
  add9:        { qualityLabel: '',     extensionLabel: '(add9)' },
  minorAdd9:   { qualityLabel: 'm',    extensionLabel: '(add9)' },
  add4:        { qualityLabel: '',     extensionLabel: 'add4' },
  sixNine:     { qualityLabel: '',     extensionLabel: '6/9' },
  minorSixNine:{ qualityLabel: 'm',    extensionLabel: '6/9' },
  major7:      { qualityLabel: '',     extensionLabel: 'maj7' },
  dominant7:   { qualityLabel: '',     extensionLabel: '7' },
  minor7:      { qualityLabel: 'm',    extensionLabel: '7' },
  minorMajor7: { qualityLabel: 'm',    extensionLabel: '(maj7)' },
  halfDim7:    { qualityLabel: 'ø',    extensionLabel: '7' },
  dim7:        { qualityLabel: '°',    extensionLabel: '7' },
  dom7sus4:    { qualityLabel: '',     extensionLabel: '7sus4' },
  dom7b5:      { qualityLabel: '',     extensionLabel: '7b5' },
  dom7s5:      { qualityLabel: '',     extensionLabel: '7#5' },
  dominant9:   { qualityLabel: '',     extensionLabel: '9' },
  minor9:      { qualityLabel: 'm',    extensionLabel: '9' },
  major9:      { qualityLabel: '',     extensionLabel: 'maj9' },
  dom9sus4:    { qualityLabel: '',     extensionLabel: '9sus4' },
  dom7b9:      { qualityLabel: '',     extensionLabel: '7b9' },
  dom7s9:      { qualityLabel: '',     extensionLabel: '7#9' },
  dominant11:  { qualityLabel: '',     extensionLabel: '11' },
  minor11:     { qualityLabel: 'm',    extensionLabel: '11' },
  major7s11:   { qualityLabel: '',     extensionLabel: 'maj7#11' },
  dominant13:  { qualityLabel: '',     extensionLabel: '13' },
  minor13:     { qualityLabel: 'm',    extensionLabel: '13' },
  major13:     { qualityLabel: '',     extensionLabel: 'maj13' },
};

// Returns the Nashville chord broken into renderable parts so the UI can apply
// different sizes without parsing the string.
export function nashvilleParts(chord, key, style = DEFAULT_NASHVILLE_STYLE) {
  if (!key || key.tonic == null) return null;
  const s = { ...DEFAULT_NASHVILLE_STYLE, ...style };
  const refPc = referencePc(key, s);
  const p = QUALITY_PARTS_MAP[chord.quality] || { qualityLabel: '', extensionLabel: '' };
  const m = s.minorSymbol;
  const qualLabel = p.qualityLabel.replace('m', m);  // respect dash-vs-m setting
  return {
    degree: degreeToken(chord.rootPc, refPc),
    qualityLabel: qualLabel,
    extensionLabel: p.extensionLabel,
    bass: chord.bassPc != null && chord.bassPc !== chord.rootPc
      ? degreeToken(chord.bassPc, refPc)
      : null,
  };
}

export { QUALITY_PARTS_MAP };

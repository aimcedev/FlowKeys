// Sustain and mod-wheel CC numbers are `let` (not `const`) so they can be
// remapped at runtime from Settings → MIDI & Sync. Importers read the live
// binding at event time (all usages are call-time comparisons/sends), so
// setCcConfig() takes effect immediately without re-importing.
export let SUSTAIN_CC   = 64;
export let MOD_WHEEL_CC = 1;

export const EXPRESSION_CC  = 11;
export const MIDI_MAX       = 127;
export const PITCH_BEND_CENTER = 8192;
export const PITCH_BEND_MAX    = 16383;

// ── MIDI System Realtime (single-byte) — used for clock output ──
export const CLOCK_TICK     = 0xF8; // 24 per quarter note
export const CLOCK_START    = 0xFA;
export const CLOCK_CONTINUE = 0xFB;
export const CLOCK_STOP     = 0xFC;

/** Override the sustain / mod-wheel CC numbers (Settings → MIDI & Sync). */
export function setCcConfig({ sustain, modWheel } = {}) {
  if (Number.isFinite(sustain))  SUSTAIN_CC   = sustain;
  if (Number.isFinite(modWheel)) MOD_WHEEL_CC = modWheel;
}

export const DEFAULT_BPM = 120;
export const MIN_BPM = 20;
export const MAX_BPM = 300;

export function normalizeBpm(value, fallback = DEFAULT_BPM) {
  const parsed = Number.parseInt(value, 10);
  const fallbackParsed = Number.parseInt(fallback, 10);
  const safeFallback = Number.isFinite(fallbackParsed) ? fallbackParsed : DEFAULT_BPM;
  const bpm = Number.isFinite(parsed) ? parsed : safeFallback;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

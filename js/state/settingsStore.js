/**
 * settingsStore.js — app-global preferences.
 *
 * These are settings that belong to the *application*, not to any song or
 * section: MIDI clock output, controller CC remapping, and the defaults applied
 * to newly-created songs. They live in their own localStorage key
 * (`flowKeysSettings`) following the same precedent as `flowKeysTheme` /
 * `flowKeysModuleSize`, so song state (`flowKeysState`) needs no migration.
 *
 * Stored shape (v1):
 *   {
 *     clockSend:       { enabled: boolean },
 *     ccRemap:         { sustain: number, modWheel: number },
 *     newSongDefaults: { transitionMode: 'trigger' | 'sync' | 'flow' },
 *   }
 */

const STORAGE_KEY = 'flowKeysSettings';

export const DEFAULT_SETTINGS = {
  clockSend:       { enabled: false },
  ccRemap:         { sustain: 64, modWheel: 1 },
  newSongDefaults: { transitionMode: 'flow' },
  chordDetector: {
    layout: 'both',
    interpretation: 'literal',
    nashvilleMinor: '1m',
    minorSymbol: 'm',
    slashSus: 'sus',
    fontSize: 'normal'
  }
};

/** Deep-merge a stored object over the defaults so new fields appear automatically. */
function mergeDefaults(stored) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    out[key] = { ...DEFAULT_SETTINGS[key], ...(stored?.[key] || {}) };
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return mergeDefaults(raw);
  } catch {
    return mergeDefaults(null);
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Shallow-merge a patch into the stored settings (one group at a time) and
 * persist. Returns the full updated settings object.
 *   updateSettings({ clockSend: { enabled: true } })
 */
export function updateSettings(patch) {
  const current = loadSettings();
  const next = { ...current };
  for (const key of Object.keys(patch)) {
    next[key] = { ...current[key], ...patch[key] };
  }
  saveSettings(next);
  return next;
}

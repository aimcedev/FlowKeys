/**
 * State schema v2: modules-array format.
 *
 * v1 (legacy): flat keys — bassToggle, kickSeq[], etc.
 * v2 (current): { bpm, passChan, inputId, outputId, modules: [...] }
 *
 * migrateState() converts v1 → v2 transparently so existing saved songs load
 * without any user action. buildDefaultState() produces a fresh v2 state.
 */

const DEFAULT_ARP_SEQ   = new Array(16).fill(100);
const DEFAULT_KICK_SEQ  = [100, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, 0, 0, 0, 0, 0];
const DEFAULT_SNARE_SEQ = [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0];
const DEFAULT_SHAKER_SEQ = [60, 100, 60, 100, 60, 100, 60, 100, 60, 100, 60, 100, 60, 100, 60, 100];

// Stable IDs for the six original fixed modules — used as a lookup key when
// applying saved state to the singleton instances in app.js.
export const LEGACY_MODULE_IDS = {
  bass:   'legacy-bass',
  arp:    'legacy-arp',
  kick:   'legacy-kick',
  snare:  'legacy-snare',
  shaker: 'legacy-shaker',
  pad:    'legacy-pad',
};

export function buildDefaultModules() {
  return [
    {
      id: LEGACY_MODULE_IDS.bass,
      type: 'bass',
      label: 'Bass',
      active: false,
      config: { chan: '2', inMin: 'A-1', inMax: 'C#3', outMin: 'E1', outMax: 'E2', volume: 100 },
    },
    {
      id: LEGACY_MODULE_IDS.arp,
      type: 'arp',
      label: 'Arp',
      active: false,
      config: { chan: '8', mode: 'chord', notes: '3', seq: [...DEFAULT_ARP_SEQ], volume: 100 },
    },
    {
      id: LEGACY_MODULE_IDS.kick,
      type: 'percussion',
      label: 'Kick',
      active: false,
      config: { chan: '3', note: '36', seq: [...DEFAULT_KICK_SEQ], volume: 100 },
    },
    {
      id: LEGACY_MODULE_IDS.snare,
      type: 'percussion',
      label: 'Snare',
      active: false,
      config: { chan: '3', note: '38', seq: [...DEFAULT_SNARE_SEQ], volume: 100 },
    },
    {
      id: LEGACY_MODULE_IDS.shaker,
      type: 'percussion',
      label: 'Shaker',
      active: false,
      config: { chan: '3', note: '55', seq: [...DEFAULT_SHAKER_SEQ], volume: 100 },
    },
    {
      id: LEGACY_MODULE_IDS.pad,
      type: 'pad',
      label: 'Drone',
      active: false,
      config: { chan: '7', key: 'song', volume: 100 },
    },
  ];
}

export function buildDefaultState() {
  return {
    bpm: 120,
    timeSignature: '4/4',
    theme: 'dark',
    modules: buildDefaultModules()
  };
}

// Default config shape for dynamically-added module types (used by addModule and reset)
export const MODULE_TYPE_DEFAULTS = {
  bass: { chan: '2', inMin: 'A-1', inMax: 'C#3', outMin: 'E1', outMax: 'E2', volume: 100 },
  arp: { chan: '8', mode: 'chord', notes: '3', seq: [...DEFAULT_ARP_SEQ], volume: 100 },
  percussion: { chan: '3', note: '36', seq: [...DEFAULT_KICK_SEQ], volume: 100 },
  pad: { chan: '7', key: 'song', volume: 100 },
  looper: { chan: '10', bars: '2', quantize: '6', volume: 100 },
  swell:  { chan: '9', selectMode: 'top12', outMin: 'E4', outMax: 'E5',
            density: '75', attackMs: '2000', holdMs: '200', releaseMs: '600',
            curve: 'ease-in-3', whammy: '2', whammyChance: '50',
            whammySpeed: 'slow', whammyDouble: '50', autoRate: '2', vary: '0', volume: 100 },
  keyboard: { chan: '1', octave: '0', inversion: '0', filterMode: 'none', filterCount: '1', modWheel: '0', transitionMs: '0', fadeMode: 'none', fadeCurve: 'linear', volume: 100 },
  glide: { chan: '2', glideMs: '200', curve: 'ease-out', pitchBendRange: '24', volume: 100 },
  drums: {
    chan: '10',
    swing: '0',
    humanize: '15',
    selectedTrackId: 'kick',
    tracks: [
      { id: 'kick',      name: 'Kick',       note: 36, seq: [100,0,0,0, 100,0,0,0, 100,0,0,0, 100,0,0,0], muted: false },
      { id: 'snare',     name: 'Snare',      note: 38, seq: [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,0],     muted: false },
      { id: 'closedHat', name: 'Closed Hat', note: 42, seq: [80,0,80,0, 80,0,80,0, 80,0,80,0, 80,0,80,0], muted: false },
      { id: 'openHat',   name: 'Open Hat',   note: 46, seq: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],         muted: false },
      { id: 'clap',      name: 'Clap',       note: 39, seq: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],         muted: false }
    ],
    volume: 100
  }
};

/** Convert a v1 flat-key state object into the v2 modules-array format. */
export function migrateState(state) {
  if (!state)          return buildDefaultState();
  if (state.modules)   return { timeSignature: '4/4', ...state }; // already v2, ensure field exists

  return {
    inputId:       state.inputId,
    outputId:      state.outputId,
    passChan:      state.passChan,
    bpm:           state.bpm || 120,
    timeSignature: state.timeSignature || '4/4',
    modules: [
      {
        id:     LEGACY_MODULE_IDS.bass,
        type:   'bass',
        label:  'Bass',
        active: state.bassToggle ?? false,
        config: {
          chan:   state.bassChan   ?? '2',
          inMin:  state.bassInMin  ?? 'A-1',
          inMax:  state.bassInMax  ?? 'C#3',
          outMin: state.bassOutMin ?? 'E1',
          outMax: state.bassOutMax ?? 'E2',
          volume: 100,
        }
      },
      {
        id:     LEGACY_MODULE_IDS.arp,
        type:   'arp',
        label:  'Arp',
        active: state.arpToggle ?? false,
        config: {
          chan:  state.arpChan  ?? '8',
          mode:  state.arpMode  ?? 'chord',
          notes: state.arpNotes ?? '3',
          seq:   state.arpSeq   ?? [...DEFAULT_ARP_SEQ],
          volume: 100,
        }
      },
      {
        id:     LEGACY_MODULE_IDS.kick,
        type:   'percussion',
        label:  'Kick',
        active: state.kickToggle ?? false,
        config: {
          chan: state.kickChan ?? '3',
          note: state.kickNote ?? '36',
          seq:  state.kickSeq  ?? [...DEFAULT_KICK_SEQ],
          volume: 100,
        }
      },
      {
        id:     LEGACY_MODULE_IDS.snare,
        type:   'percussion',
        label:  'Snare',
        active: state.snareToggle ?? false,
        config: {
          chan: state.snareChan ?? '3',
          note: state.snareNote ?? '38',
          seq:  state.snareSeq  ?? [...DEFAULT_SNARE_SEQ],
          volume: 100,
        }
      },
      {
        id:     LEGACY_MODULE_IDS.shaker,
        type:   'percussion',
        label:  'Shaker',
        active: state.shakerToggle ?? false,
        config: {
          chan: state.shakerChan ?? '3',
          note: state.shakerNote ?? '55',
          seq:  state.shakerSeq  ?? [...DEFAULT_SHAKER_SEQ],
          volume: 100,
        }
      },
      {
        id:     LEGACY_MODULE_IDS.pad,
        type:   'pad',
        label:  'Drone',
        active: state.padToggle ?? false,
        config: {
          chan: state.padChan ?? '7',
          key:  state.padKey  ?? 'song',
          volume: 100,
        }
      },
    ]
  };
}

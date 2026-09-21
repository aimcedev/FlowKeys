export const BUILTIN_PRESETS = {
  percussion: {
    kick: [
      { id: 'kick-four-on-floor', name: 'Four on Floor',
        seq: [100,0,0,0, 100,0,0,0, 100,0,0,0, 100,0,0,0] },
      { id: 'kick-half-time', name: 'Half Time',
        seq: [100,0,0,0, 0,0,0,0, 0,0,0,0, 100,0,0,0] },
      { id: 'kick-with-pickup', name: 'With Pickup',
        seq: [100,0,0,0, 100,0,0,0, 100,0,0,0, 0,0,100,0] },
      { id: 'kick-offbeat', name: 'Offbeat',
        seq: [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,0] },
    ],
    snare: [
      { id: 'snare-backbeat', name: 'Backbeat (2 & 4)',
        seq: [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,0] },
      { id: 'snare-half-time', name: 'Half Time',
        seq: [0,0,0,0, 0,0,0,0, 100,0,0,0, 0,0,0,0] },
      { id: 'snare-ghost-roll', name: 'Ghost Roll',
        seq: [0,40,0,40, 100,0,40,0, 0,40,0,40, 100,0,40,0] },
      { id: 'snare-every-beat', name: 'Every Beat',
        seq: [100,0,0,0, 100,0,0,0, 100,0,0,0, 100,0,0,0] },
    ],
    shaker: [
      { id: 'shaker-8ths', name: 'Straight 8ths',
        seq: [100,0,100,0, 100,0,100,0, 100,0,100,0, 100,0,100,0] },
      { id: 'shaker-8ths-accented', name: '8ths Accented',
        seq: [100,0,75,0, 100,0,75,0, 100,0,75,0, 100,0,75,0] },
      { id: 'shaker-16ths', name: '16ths',
        seq: [80,60,80,60, 80,60,80,60, 80,60,80,60, 80,60,80,60] },
      { id: 'shaker-offbeat', name: 'Offbeat 8ths',
        seq: [0,100,0,100, 0,100,0,100, 0,100,0,100, 0,100,0,100] },
    ],
  },
  arp: [
    { id: 'arp-straight-8ths', name: 'Straight 8ths',
      seq: [100,0,100,0, 100,0,100,0, 100,0,100,0, 100,0,100,0] },
    { id: 'arp-quarters', name: 'Quarters',
      seq: [100,0,0,0, 100,0,0,0, 100,0,0,0, 100,0,0,0] },
    { id: 'arp-16ths', name: '16ths',
      seq: [80,80,80,80, 80,80,80,80, 80,80,80,80, 80,80,80,80] },
    { id: 'arp-syncopated', name: 'Syncopated',
      seq: [100,0,0,75, 0,100,0,0, 75,0,100,0, 0,75,0,0] },
    { id: 'arp-dotted-8ths', name: 'Dotted 8ths',
      seq: [100,0,0,100, 0,0,100,0, 0,100,0,0, 100,0,0,0] },
    { id: 'arp-up-16ths', name: 'Arp Up 16ths',
      seq: [80,80,80,80, 80,80,80,80, 80,80,80,80, 80,80,80,80], mode: 'up', notes: '3' },
  ],
  drums: [
    {
      id: 'drums-rock-basic',
      name: 'Basic Rock',
      tracks: [
        { id: 'kick',      name: 'Kick',       note: 36, seq: [100,0,0,0, 0,0,0,0, 100,0,0,0, 0,0,0,0], muted: false },
        { id: 'snare',     name: 'Snare',      note: 38, seq: [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,0],     muted: false },
        { id: 'closedHat', name: 'Closed Hat', note: 42, seq: [80,0,80,0, 80,0,80,0, 80,0,80,0, 80,0,80,0], muted: false },
        { id: 'openHat',   name: 'Open Hat',   note: 46, seq: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,100,0],         muted: false },
        { id: 'clap',      name: 'Clap',       note: 39, seq: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],         muted: false }
      ]
    },
    {
      id: 'drums-four-floor',
      name: 'Four on the Floor',
      tracks: [
        { id: 'kick',      name: 'Kick',       note: 36, seq: [100,0,0,0, 100,0,0,0, 100,0,0,0, 100,0,0,0], muted: false },
        { id: 'snare',     name: 'Snare',      note: 38, seq: [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,0],     muted: false },
        { id: 'closedHat', name: 'Closed Hat', note: 42, seq: [80,80,80,80, 80,80,80,80, 80,80,80,80, 80,80,80,80], muted: false },
        { id: 'openHat',   name: 'Open Hat',   note: 46, seq: [0,0,100,0, 0,0,100,0, 0,0,100,0, 0,0,100,0], muted: false },
        { id: 'clap',      name: 'Clap',       note: 39, seq: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],         muted: false }
      ]
    },
    {
      id: 'drums-trap',
      name: 'Trap Beat',
      tracks: [
        { id: 'kick',      name: 'Kick',       note: 36, seq: [100,0,0,0, 0,0,100,0, 0,0,0,0, 0,100,0,0], muted: false },
        { id: 'snare',     name: 'Snare',      note: 38, seq: [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,0],     muted: false },
        { id: 'closedHat', name: 'Closed Hat', note: 42, seq: [80,80,80,120, 80,80,120,80, 80,120,80,80, 120,80,120,120], muted: false },
        { id: 'openHat',   name: 'Open Hat',   note: 46, seq: [0,0,0,0, 0,0,100,0, 0,0,0,0, 0,0,0,0],       muted: false },
        { id: 'clap',      name: 'Clap',       note: 39, seq: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,100,0],       muted: false }
      ]
    }
  ],
};

const STORAGE_KEY = 'flowKeysModulePresets';

const EMPTY_USER_PRESETS = () => ({
  percussion: { kick: [], snare: [], shaker: [] },
  arp: [],
  drums: [],
});

export class ModulePresetManager {
  constructor() {
    this._userPresets = EMPTY_USER_PRESETS();
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Defensive merge — only accept known keys
      if (parsed && typeof parsed === 'object') {
        const p = parsed.percussion;
        if (p && typeof p === 'object') {
          for (const cat of ['kick', 'snare', 'shaker']) {
            if (Array.isArray(p[cat])) this._userPresets.percussion[cat] = p[cat];
          }
        }
        if (Array.isArray(parsed.arp)) this._userPresets.arp = parsed.arp;
        if (Array.isArray(parsed.drums)) this._userPresets.drums = parsed.drums;
      }
    } catch {
      // Corrupt storage — start fresh
      this._userPresets = EMPTY_USER_PRESETS();
    }
  }

  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._userPresets));
  }

  // Returns built-in presets (marked builtin:true) followed by user presets.
  getPresets(type, category = null) {
    if (type === 'arp') {
      return [
        ...BUILTIN_PRESETS.arp.map(p => ({ ...p, builtin: true })),
        ...this._userPresets.arp,
      ];
    }
    if (type === 'drums') {
      return [
        ...BUILTIN_PRESETS.drums.map(p => ({ ...p, builtin: true })),
        ...this._userPresets.drums,
      ];
    }
    if (type === 'percussion' && category) {
      const builtins = BUILTIN_PRESETS.percussion[category] ?? [];
      const user = this._userPresets.percussion[category] ?? [];
      return [
        ...builtins.map(p => ({ ...p, builtin: true })),
        ...user,
      ];
    }
    return [];
  }

  getPreset(type, category, id) {
    return this.getPresets(type, category).find(p => p.id === id) ?? null;
  }

  savePreset(type, category, name, seq, extras = {}) {
    const id = 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const preset = { id, name, seq, ...extras };
    if (type === 'arp') {
      this._userPresets.arp.push(preset);
    } else if (type === 'drums') {
      this._userPresets.drums.push(preset);
    } else if (type === 'percussion' && category) {
      this._userPresets.percussion[category].push(preset);
    }
    this._save();
    return preset;
  }

  deletePreset(type, category, id) {
    // Silently ignore built-in ids
    if (type === 'arp') {
      this._userPresets.arp = this._userPresets.arp.filter(p => p.id !== id);
    } else if (type === 'drums') {
      this._userPresets.drums = this._userPresets.drums.filter(p => p.id !== id);
    } else if (type === 'percussion' && category) {
      this._userPresets.percussion[category] =
        this._userPresets.percussion[category].filter(p => p.id !== id);
    }
    this._save();
  }

  exportUserPresets() {
    const data = JSON.stringify(this._userPresets, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flowkeys-presets-${date}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Merges imported user presets. Skips duplicates by id. Returns { added }.
  importUserPresets(jsonString) {
    const parsed = JSON.parse(jsonString); // throws on invalid JSON
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid preset file');

    let added = 0;

    if (Array.isArray(parsed.arp)) {
      const existingIds = new Set(this._userPresets.arp.map(p => p.id));
      for (const preset of parsed.arp) {
        if (preset.id && !existingIds.has(preset.id) && Array.isArray(preset.seq)) {
          this._userPresets.arp.push(preset);
          existingIds.add(preset.id);
          added++;
        }
      }
    }

    if (Array.isArray(parsed.drums)) {
      const existingIds = new Set(this._userPresets.drums.map(p => p.id));
      for (const preset of parsed.drums) {
        if (preset.id && !existingIds.has(preset.id) && Array.isArray(preset.tracks)) {
          this._userPresets.drums.push(preset);
          existingIds.add(preset.id);
          added++;
        }
      }
    }

    if (parsed.percussion && typeof parsed.percussion === 'object') {
      for (const cat of ['kick', 'snare', 'shaker']) {
        if (!Array.isArray(parsed.percussion[cat])) continue;
        const existingIds = new Set(this._userPresets.percussion[cat].map(p => p.id));
        for (const preset of parsed.percussion[cat]) {
          if (preset.id && !existingIds.has(preset.id) && Array.isArray(preset.seq)) {
            this._userPresets.percussion[cat].push(preset);
            existingIds.add(preset.id);
            added++;
          }
        }
      }
    }

    this._save();
    return { added };
  }
}

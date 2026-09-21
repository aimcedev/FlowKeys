import { loadSettings, updateSettings } from '../state/settingsStore.js';

const APP_VERSION = '0.1.0';

// Every Flow Keys localStorage key — used by Export Everything / Reset to Factory.
const ALL_STORAGE_KEYS = [
  'flowKeysPresetsV1',
  'flowKeysState',
  'flowKeysMidiMap',
  'flowKeysModulePresets',
  'flowKeysTheme',
  'flowKeysShows',
  'flowKeysModuleSize',
  'flowKeysSettings',
];

/**
 * SettingsWindow — the tabbed "full settings" modal.
 *
 * Quick, performance-time MIDI controls stay in the mapping drawer
 * (js/midi/midiMapping.js). This window owns set-once configuration:
 * appearance, MIDI clock out, controller CC remap, new-song defaults, and data
 * management. It reads/writes app-global prefs via settingsStore and calls back
 * into the app (class App) to apply the live effects (clock send, CC remap).
 */
export class SettingsWindow {
  constructor(app) {
    this.app = app;
    this.modal = document.getElementById('settings-modal');
    if (!this.modal) return;

    this._cacheDom();
    this._bindChrome();
    this._bindTabs();
    this._bindControls();
    this.syncFromStore();
  }

  _cacheDom() {
    this.backdrop   = document.getElementById('settings-modal-backdrop');
    this.closeBtn   = document.getElementById('settings-modal-close');
    this.tabs       = [...this.modal.querySelectorAll('.settings-tab')];
    this.panes      = [...this.modal.querySelectorAll('.settings-pane')];

    this.clockSendToggle = document.getElementById('clock-send-toggle');
    this.ccSustainInput  = document.getElementById('cc-sustain-input');
    this.ccModWheelInput = document.getElementById('cc-modwheel-input');
    this.defaultTransition = document.getElementById('default-transition-mode');
    this.exportAllBtn    = document.getElementById('export-all-btn');
    this.resetAppBtn     = document.getElementById('reset-app-btn');
    this.versionLabel    = document.getElementById('app-version');

    this.chordLayoutSel = document.getElementById('chord-setting-layout');
    this.chordFontSizeSel = document.getElementById('chord-setting-font-size');
    this.chordInterpSel = document.getElementById('chord-setting-interp');
    this.chordNvMinorSel = document.getElementById('chord-setting-nv-minor');
    this.chordNvSymbolSel = document.getElementById('chord-setting-nv-symbol');
    this.chordSlashSusSel = document.getElementById('chord-setting-slash-sus');
  }

  // ── Open / close ─────────────────────────────────────────
  _bindChrome() {
    this.closeBtn?.addEventListener('click', () => this.close());
    this.backdrop?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isOpen()) return;
      // Don't close out from under a confirm/prompt dialog stacked on top.
      if (document.getElementById('naming-modal-overlay')?.classList.contains('open')) return;
      this.close();
    });
    if (this.versionLabel) this.versionLabel.textContent = APP_VERSION;
  }

  open() {
    if (!this.modal) return;
    this.syncFromStore();
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
  }

  close() {
    if (!this.modal) return;
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
  }

  toggle() {
    this.isOpen() ? this.close() : this.open();
  }

  isOpen() {
    return !!this.modal && this.modal.classList.contains('open');
  }

  // ── Tabs ─────────────────────────────────────────────────
  _bindTabs() {
    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => this._selectTab(tab.dataset.tab));
    });
  }

  _selectTab(name) {
    this.tabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    this.panes.forEach(p => {
      p.classList.toggle('active', p.dataset.pane === name);
    });
  }

  // ── Controls ─────────────────────────────────────────────
  _bindControls() {
    this.clockSendToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      updateSettings({ clockSend: { enabled } });
      this.app.setClockSendEnabled?.(enabled);
    });

    const commitCc = () => {
      const sustain  = this._clampCc(this.ccSustainInput?.value, 64);
      const modWheel = this._clampCc(this.ccModWheelInput?.value, 1);
      if (this.ccSustainInput)  this.ccSustainInput.value = sustain;
      if (this.ccModWheelInput) this.ccModWheelInput.value = modWheel;
      updateSettings({ ccRemap: { sustain, modWheel } });
      this.app.applyCcRemap?.({ sustain, modWheel });
    };
    this.ccSustainInput?.addEventListener('change', commitCc);
    this.ccModWheelInput?.addEventListener('change', commitCc);

    this.defaultTransition?.addEventListener('change', (e) => {
      updateSettings({ newSongDefaults: { transitionMode: e.target.value } });
    });

    const commitChordSettings = () => {
      const layout = this.chordLayoutSel?.value;
      const fontSize = this.chordFontSizeSel?.value;
      const interpretation = this.chordInterpSel?.value;
      const nashvilleMinor = this.chordNvMinorSel?.value;
      const minorSymbol = this.chordNvSymbolSel?.value;
      const slashSus = this.chordSlashSusSel?.value;

      updateSettings({
        chordDetector: { layout, fontSize, interpretation, nashvilleMinor, minorSymbol, slashSus }
      });

      if (this.app.chordDetector) {
        this.app.chordDetector.updateFromSettings();
      }
    };

    this.chordLayoutSel?.addEventListener('change', commitChordSettings);
    this.chordFontSizeSel?.addEventListener('change', commitChordSettings);
    this.chordInterpSel?.addEventListener('change', commitChordSettings);
    this.chordNvMinorSel?.addEventListener('change', commitChordSettings);
    this.chordNvSymbolSel?.addEventListener('change', commitChordSettings);
    this.chordSlashSusSel?.addEventListener('change', commitChordSettings);

    this.exportAllBtn?.addEventListener('click', () => this._exportEverything());
    this.resetAppBtn?.addEventListener('click', () => this._resetToFactory());
  }

  _clampCc(value, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(127, n));
  }

  /** Reflect stored settings into the controls (called on open). */
  syncFromStore() {
    const s = loadSettings();
    if (this.clockSendToggle) this.clockSendToggle.checked = s.clockSend.enabled;
    if (this.ccSustainInput)  this.ccSustainInput.value  = s.ccRemap.sustain;
    if (this.ccModWheelInput) this.ccModWheelInput.value = s.ccRemap.modWheel;
    if (this.defaultTransition) this.defaultTransition.value = s.newSongDefaults.transitionMode;

    const c = s.chordDetector || {};
    if (this.chordLayoutSel)   this.chordLayoutSel.value   = c.layout || 'both';
    if (this.chordFontSizeSel) this.chordFontSizeSel.value = c.fontSize || 'normal';
    if (this.chordInterpSel)   this.chordInterpSel.value   = c.interpretation || 'literal';
    if (this.chordNvMinorSel)  this.chordNvMinorSel.value  = c.nashvilleMinor || '1m';
    if (this.chordNvSymbolSel) this.chordNvSymbolSel.value = c.minorSymbol || 'm';
    if (this.chordSlashSusSel) this.chordSlashSusSel.value = c.slashSus || 'sus';
  }

  // ── Data management ──────────────────────────────────────
  _exportEverything() {
    const bundle = { app: 'flowKeys', kind: 'full-backup', exportedAt: new Date().toISOString(), data: {} };
    for (const key of ALL_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw !== null) bundle.data[key] = raw;
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `flow-keys-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.app.uiManager?.showToast?.('Exported full backup');
  }

  async _resetToFactory() {
    const ok = await this.app.uiManager?.confirmModal?.(
      'Reset to Factory',
      'This erases ALL Flow Keys data — songs, shows, mappings, presets, and settings. This cannot be undone.'
    );
    if (!ok) return;
    for (const key of ALL_STORAGE_KEYS) localStorage.removeItem(key);
    location.reload();
  }
}

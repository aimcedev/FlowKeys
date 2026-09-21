import { stepsForTimeSignature } from '../utils/noteUtils.js';
import { normalizeBpm } from '../utils/bpm.js';

export class TempoController {
  constructor(app) {
    this.app = app;
    this._bpmSyncing = false;
    this._currentBeatPips = null;
  }

  attachListeners() {
    this.app.ui.masterBpm.addEventListener('change', (e) => {
      const bpm = normalizeBpm(e.target.value, this.app.engine.clock.bpm);
      e.target.value = bpm;
      this.app.engine.clock.setBpm(bpm);
    });

    this.app.ui.masterBpm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.app.ui.masterBpm.blur();
      }
    });

    const stepBpm = (delta) => {
      const current = normalizeBpm(this.app.ui.masterBpm.value, this.app.engine.clock.bpm);
      const next = normalizeBpm(current + delta, current);
      this.app.ui.masterBpm.value = next;
      this.app.engine.clock.setBpm(next);
    };

    let _holdTimeout = null;

    const startHold = (dir) => {
      stepBpm(dir);
      let repeatCount = 0;

      const repeat = () => {
        repeatCount++;
        let amount, interval;
        if (repeatCount > 20)      { amount = 10; interval = 55; }
        else if (repeatCount > 10) { amount = 5;  interval = 80; }
        else if (repeatCount > 5)  { amount = 2;  interval = 110; }
        else                       { amount = 1;  interval = 140; }
        stepBpm(dir * amount);
        _holdTimeout = setTimeout(repeat, interval);
      };

      _holdTimeout = setTimeout(repeat, 360);

      const stop = () => {
        clearTimeout(_holdTimeout);
        _holdTimeout = null;
        document.removeEventListener('mouseup', stop);
        document.removeEventListener('touchend', stop);
      };
      document.addEventListener('mouseup', stop);
      document.addEventListener('touchend', stop);
    };

    const upBtn   = document.getElementById('bpm-up-btn');
    const downBtn = document.getElementById('bpm-down-btn');

    // Physical mouse/touch presses use the hold-to-accelerate path.
    // Programmatic .click() calls (from MIDI mapping) use the click handler below.
    upBtn?.addEventListener('mousedown',  (e) => { if (e.isTrusted) { e.preventDefault(); startHold(1);  } });
    downBtn?.addEventListener('mousedown', (e) => { if (e.isTrusted) { e.preventDefault(); startHold(-1); } });
    upBtn?.addEventListener('click',   (e) => { if (!e.isTrusted) stepBpm(1);  });
    downBtn?.addEventListener('click', (e) => { if (!e.isTrusted) stepBpm(-1); });

    document.getElementById('save-bpm-to-song-btn')?.addEventListener('click', () => {
      this.saveBpmToSong();
    });

    this.app.ui.tapTempoBtn.addEventListener('click', () => {
      this.app.engine.clock.tapTempo();
      this.app.ui.tapTempoBtn.style.transform = 'scale(0.95)';
      setTimeout(() => this.app.ui.tapTempoBtn.style.transform = '', 100);
    });

    if (this.app.ui.liveTapTempoBtn) {
      this.app.ui.liveTapTempoBtn.addEventListener('click', () => {
        this.app.engine.clock.tapTempo();
        this.app.ui.liveTapTempoBtn.style.transform = 'scale(0.95)';
        setTimeout(() => this.app.ui.liveTapTempoBtn.style.transform = '', 100);
      });
    }

    // ── Tempo Lock (popover button + header button both trigger the same toggle) ──
    document.getElementById('tempo-lock-btn')?.addEventListener('click', () => {
      this._toggleTempoLock();
    });
    document.getElementById('tempo-lock-header-btn')?.addEventListener('click', () => {
      this._toggleTempoLock();
    });

    // ── Central BPM sync ─────────────────────────────────────────────────────
    this.app.engine.clock.onBpmChange((newBpm) => {
      if (this._bpmSyncing) return;
      this._syncBpmEverywhere(newBpm);
    });

    // ── Beat indicator (dynamic — pips rebuilt when time sig changes) ────────
    this.app.engine.clock.onBeat((beatInBar) => {
      if (this._currentBeatPips) {
        this._currentBeatPips.forEach((pip, i) => pip.classList.toggle('active', i === beatInBar));
      }
    });
    this.app.engine.clock.onStop(() => {
      if (this._currentBeatPips) {
        this._currentBeatPips.forEach(pip => pip.classList.remove('active'));
      }
    });

    // ── Time Signature selector ───────────────────────────────────────────────
    document.querySelectorAll('.time-sig-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setTimeSignature(btn.dataset.sig));
    });
  }

  /**
   * saveBpmToSong — stamps the current BPM into the song record AND into the
   * saved state of every section in that song.
   */
  saveBpmToSong() {
    const songId = this.app.presetManager.activeSongId;
    if (!songId) {
      this.app.uiManager.showToast('No active song — select a song first', 'error');
      return;
    }

    const bpm = this.app.engine.clock.bpm;
    const timeSignature = this.app.engine.clock.timeSignature;
    const song = this.app.presetManager.getSong(songId);

    this.app.presetManager.updateSongSettings(songId, bpm, timeSignature);

    let updatedCount = 0;
    song.sections.forEach(section => {
      if (section.state) {
        section.state.bpm = bpm;
        section.state.timeSignature = timeSignature;
        updatedCount++;
      }
    });

    this.app.presetManager.saveToStorage();

    const label = updatedCount === 1 ? '1 section' : `${updatedCount} sections`;
    this.app.uiManager.showToast(`BPM ${bpm} saved to "${song.name}" (${label})`);
  }

  /**
   * _syncBpmEverywhere — single source of truth for all BPM side-effects.
   */
  _syncBpmEverywhere(bpm) {
    if (this.app._suppressStatePersistence) {
      this.app.ui.masterBpm.value = bpm;
      return;
    }

    this._bpmSyncing = true;
    this.app.ui.masterBpm.value = bpm;
    if (this.app.presetManager.activeSongId) {
      this.app.presetManager.updateSongSettings(this.app.presetManager.activeSongId, bpm);
    }
    this.app.saveState();
    this._bpmSyncing = false;
  }

  // ── Time Signature ────────────────────────────────────────────────────────

  setTimeSignature(sig, options = {}) {
    const persist = options.persist !== false;

    // 1. Update clock timing math
    this.app.engine.clock.setTimeSignature(sig);

    // 2. Resize all sequencer module arrays (graceful truncate/restore)
    for (const mod of this.app.moduleInstances.values()) {
      if (typeof mod.setTimeSignature === 'function') mod.setTimeSignature(sig);
    }

    // 3. Rebuild sequencer UIs with correct step count
    this._rebuildSequencerUIs(sig);

    // 4. Rebuild beat indicator pips
    this._rebuildBeatPips(sig);

    // 5. Highlight active time sig button
    document.querySelectorAll('.time-sig-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.sig === sig)
    );

    // 6. Update tempo tracker badge + lock tooltip
    const badge = document.getElementById('tempo-timesig-badge');
    if (badge) badge.textContent = sig;
    const lockTitle = sig === '6/8'
      ? 'Lock detected compound beat → convert to quarter-note BPM (×1.5)'
      : 'Lock detected BPM to master clock';
    document.getElementById('tempo-lock-btn')?.setAttribute('title', lockTitle);
    document.getElementById('tempo-lock-header-btn')?.setAttribute('title', lockTitle);

    // 7. Persist
    if (persist) this.app.saveState();
  }

  _rebuildSequencerUIs(sig) {
    const steps = stepsForTimeSignature(sig);
    for (const [id, seqUI] of this.app.sequencers.entries()) {
      const modInstance = this.app.moduleInstances.get(id);
      if (!modInstance) continue;
      seqUI.resize(steps, modInstance.sequence ?? []);
    }
    // Drums use a bespoke multi-row grid; each module already resized its track
    // sequences in setTimeSignature(), so just re-render the grid at the new width.
    for (const [id, modInstance] of this.app.moduleInstances.entries()) {
      if (Array.isArray(modInstance.tracks)) this.app.modulesGrid?.refreshDrumsUI?.(id);
    }
  }

  _rebuildBeatPips(sig) {
    const indicator = document.getElementById('beat-indicator');
    if (!indicator) return;

    indicator.innerHTML = '';
    indicator.className = sig === '6/8' ? 'beat-indicator sig-6-8' : 'beat-indicator';

    let pipCount;
    if (sig === '3/4') pipCount = 3;
    else if (sig === '6/8') pipCount = 6;
    else pipCount = 4;

    for (let i = 0; i < pipCount; i++) {
      const pip = document.createElement('div');
      pip.className = 'beat-pip';
      pip.dataset.beat = i;
      indicator.appendChild(pip);
    }

    const newPips = indicator.querySelectorAll('.beat-pip');
    this._bindBeatPips(newPips);
  }

  _bindBeatPips(pips) {
    this._currentBeatPips = pips;
  }

  _toggleTempoLock() {
    const btn        = document.getElementById('tempo-lock-btn');
    const headerBtn  = document.getElementById('tempo-lock-header-btn');
    const hint       = this.app.tempoWidget.activeHint;

    if (this.app._tempoLocked) {
      this.app._tempoLocked = false;
      this.app.tempoWidget.setLockedBpm(null);
      btn?.classList.remove('active');
      headerBtn?.classList.remove('active');
      const labelEl = btn?.querySelector('.tempo-lock-label');
      if (labelEl) labelEl.textContent = 'Lock';
      if (this.app._preLockBpm != null) {
        this.app.engine.clock.setBpm(this.app._preLockBpm);
        this.app._preLockBpm = null;
      }
      window.appUiManager?.updateTempoTrigger(this.app.tempoWidget.getCurrentBpm(), false, hint);
    } else {
      const detectedBpm = this.app.tempoWidget.getCurrentBpm();
      if (!detectedBpm) return;
      this.app._preLockBpm = this.app.engine.clock.bpm;
      this.app._tempoLocked = true;
      this.app.tempoWidget.setLockedBpm(detectedBpm);
      btn?.classList.add('active');
      headerBtn?.classList.add('active');
      const labelEl = btn?.querySelector('.tempo-lock-label');
      if (labelEl) labelEl.textContent = 'Locked';
      const lockBpm = this.app.engine.clock.timeSignature === '6/8'
        ? detectedBpm * 0.5
        : detectedBpm;
      this.app.engine.clock.setBpm(Math.round(lockBpm));
      window.appUiManager?.updateTempoTrigger(detectedBpm, true, hint);
    }
  }
}

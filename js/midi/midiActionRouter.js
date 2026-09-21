import { LEGACY_MODULE_IDS } from '../state/stateSchema.js';

export class MidiActionRouter {
  constructor(app) {
    this.app = app;
  }

  // Toggle a legacy module by its well-known instance ID.
  // Uses _toggleModuleDirectly so no DOM event is dispatched from within the
  // MIDI message handler. Edit mode still auto-saves the resulting state.
  _toggleLegacyModule(instanceId) {
    const mod = this.app.moduleInstances.get(instanceId);
    if (!mod) return;
    const isPending = this.app.pendingModuleActivations.includes(mod);
    const effectiveActive = mod.isActive || isPending;
    this.app._toggleModuleDirectly(instanceId, !effectiveActive);
  }

  handle(targetId) {
    if (targetId === 'tapTempo') {
      this.app.engine.clock.tapTempo();
    } else if (targetId === 'toggleBass') {
      this._toggleLegacyModule(LEGACY_MODULE_IDS.bass);
    } else if (targetId === 'toggleArp') {
      this._toggleLegacyModule(LEGACY_MODULE_IDS.arp);
    } else if (targetId === 'toggleKick') {
      this._toggleLegacyModule(LEGACY_MODULE_IDS.kick);
    } else if (targetId === 'toggleSnare') {
      this._toggleLegacyModule(LEGACY_MODULE_IDS.snare);
    } else if (targetId === 'toggleShaker') {
      this._toggleLegacyModule(LEGACY_MODULE_IDS.shaker);
    } else if (targetId === 'togglePad') {
      this._toggleLegacyModule(LEGACY_MODULE_IDS.pad);
    } else if (targetId === 'nextSection') {
      let currentSectionId = this.app.presetManager.activeSectionId;
      if (this.app.pendingSectionChange) {
        currentSectionId = this.app.pendingSectionChange.sectionId;
      }
      const nextIds = this.app.presetManager.getNextSectionIds(currentSectionId);
      if (nextIds) {
        this.app.triggerSectionChange(nextIds.songId, nextIds.sectionId);
      }
    } else if (targetId === 'prevSection') {
      let currentSectionId = this.app.presetManager.activeSectionId;
      if (this.app.pendingSectionChange) {
        currentSectionId = this.app.pendingSectionChange.sectionId;
      }
      const prevIds = this.app.presetManager.getPrevSectionIds(currentSectionId);
      if (prevIds) {
        this.app.triggerSectionChange(prevIds.songId, prevIds.sectionId);
      }
    } else if (targetId === 'panic') {
      document.getElementById('panic-button')?.click();
    } else if (targetId === 'toggleLiveEdit') {
      document.getElementById('live-edit-toggle-btn')?.click();
    } else if (targetId === 'toggleFlowConfigure') {
      this.app.flowRail?.toggleConfigure();
    } else if (targetId === 'setModeEdit') {
      this.app.uiManager?.setMode('edit');
    } else if (targetId === 'setModeFlow') {
      this.app.uiManager?.setMode('flow');
    } else if (targetId === 'setModeLive') {
      this.app.uiManager?.setMode('live');
    } else if (targetId === 'saveToSection') {
      const songId = this.app.presetManager.activeSongId;
      const sectionId = this.app.presetManager.activeSectionId;
      if (songId && sectionId) {
        this.app.presetManager.updateSectionState(songId, sectionId, this.app.getCurrentStateData());
        if (this.app.uiManager) this.app.uiManager.showToast('Section updated ✓');
      }
    } else if (targetId === 'tempoHintSlow') {
      this.app.tempoWidget.setHint('slow');
    } else if (targetId === 'tempoHintMedium') {
      this.app.tempoWidget.setHint('medium');
    } else if (targetId === 'tempoHintFast') {
      this.app.tempoWidget.setHint('fast');
    } else if (targetId === 'bpmUp') {
      document.getElementById('bpm-up-btn')?.click();
    } else if (targetId === 'bpmDown') {
      document.getElementById('bpm-down-btn')?.click();
    } else if (targetId === 'tempoReset') {
      this.app.tempoWidget.reset();
    } else if (targetId === 'tempoLock') {
      this.app.tempoController._toggleTempoLock();
    } else if (targetId === 'tempoTrigger') {
      document.getElementById('tempo-trigger-btn')?.click();
    } else if (targetId.startsWith('song:')) {
      const songId = targetId.substring(5);
      const song = this.app.presetManager.getSong(songId);
      if (song) {
        this.app.presetManager.setActiveSong(song.id);
        if (this.app.applySongSettings) this.app.applySongSettings(song);
        if (this.app.uiManager) {
          this.app.uiManager.renderLiveMode();
          this.app.uiManager.updateEditContextBar();
        }
      }
    } else if (targetId.startsWith('section:')) {
      const sectionId = targetId.substring(8);
      for (const song of this.app.presetManager.getSongs()) {
        if (song.sections.some(s => s.id === sectionId)) {
          if (this.app.presetManager.activeSongId !== song.id) {
            this.app.presetManager.setActiveSong(song.id);
            if (this.app.applySongSettings) this.app.applySongSettings(song);
          }
          this.app.triggerSectionChange(song.id, sectionId);
          if (this.app.uiManager) this.app.uiManager.renderLiveMode();
          break;
        }
      }
    } else if (targetId === 'chordPadSustain') {
      this.app.chordPads.smartSustain = !this.app.chordPads.smartSustain;
      const cb = document.getElementById('cp-sustain');
      if (cb) cb.checked = this.app.chordPads.smartSustain;
      if (!this.app.chordPads.smartSustain) this.app.chordPads.stopAll();
    } else if (targetId.startsWith('chordPad:')) {
      const padIdx = parseInt(targetId.substring(9), 10);
      if (!isNaN(padIdx)) this.app.chordPads.triggerPadDown(padIdx);
    }
  }

  syncChordPadMappingTargets() {
    this.app.chordPads.pads.forEach((pad, i) => {
      this.app.midiMapping.targetNames[`chordPad:${i}`] = `Chord Pad ${i + 1}: ${pad.name}`;
    });
  }
}

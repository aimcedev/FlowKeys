import { buildDefaultState, MODULE_TYPE_DEFAULTS } from '../state/stateSchema.js';

export class ContextActionsController {
  constructor(app) {
    this.app = app;
  }

  pasteModuleConfig(instanceId, config) {
    const modDesc = this.app._currentModules.find(m => m.id === instanceId);
    if (!modDesc) return;
    this.app._applyModuleConfigs([{ id: instanceId, type: modDesc.type, active: undefined, config }]);
    this.app.saveState();
    this.app.uiManager.showToast('Config pasted');
  }

  applyModuleConfigToAllSections(instanceId) {
    const modDesc = this.app._currentModules.find(m => m.id === instanceId);
    if (!modDesc) return;
    const full = this.app._readModuleFromDom(modDesc);
    const songId = this.app.presetManager.activeSongId;
    const sectionId = this.app.presetManager.activeSectionId;
    if (!songId || !sectionId) return;
    this.app.presetManager.propagateModuleConfig(songId, sectionId, instanceId, full.config);
    const song = this.app.presetManager.getSong(songId);
    const count = song ? song.sections.length - 1 : 0;
    this.app.uiManager.showToast(`Applied to ${count} other section${count !== 1 ? 's' : ''}`);
  }

  duplicateModule(instanceId) {
    const srcIndex = this.app._currentModules.findIndex(m => m.id === instanceId);
    if (srcIndex === -1) return;
    const srcDesc = this.app._currentModules[srcIndex];
    const srcFull = this.app._readModuleFromDom(srcDesc);

    this.app.addModule(srcDesc.type, srcIndex + 1);

    const newDesc = this.app._currentModules[srcIndex + 1];
    if (newDesc) {
      this.app._applyModuleConfigs([{ id: newDesc.id, type: newDesc.type, active: srcFull.active, config: srcFull.config }]);
      this.app.saveState();
    }
    this.app.uiManager.showToast(`${srcDesc.label} duplicated`);
  }

  resetModuleToDefaults(instanceId) {
    const modDesc = this.app._currentModules.find(m => m.id === instanceId);
    if (!modDesc) return;
    const defaultConfig = MODULE_TYPE_DEFAULTS[modDesc.type] || {};
    // Deep clone so nested defaults (e.g. drums `tracks`) aren't shared by reference.
    const config = structuredClone(defaultConfig);
    if (modDesc.type === 'arp' || modDesc.type === 'percussion') {
      config.seq = new Array(16).fill(0);
    }
    this.app._applyModuleConfigs([{ id: instanceId, type: modDesc.type, active: undefined, config }]);
    this.app.saveState();
    this.app.uiManager.showToast('Reset to defaults');
  }

  startModuleRename(instanceId) {
    const modDesc = this.app._currentModules.find(m => m.id === instanceId);
    if (!modDesc) return;
    const card = this.app._getModuleCard(instanceId);
    const h3 = card?.querySelector('.module-title h3');
    if (!h3) return;
    this.app.uiManager._startInlineEdit(h3, modDesc.label, (newName) => {
      modDesc.label = newName;
      h3.textContent = `${newName} Module`;
      this.app.saveState();
      const songId = this.app.presetManager.activeSongId;
      const sectionId = this.app.presetManager.activeSectionId;
      if (songId && sectionId) {
        this.app.presetManager.propagateModuleRename(songId, sectionId, instanceId, newName);
      }
    });
  }

  startSectionRename(sectionId) {
    const songId = this.app.presetManager.activeSongId;
    const card = document.querySelector(`.section-card[data-midi-target="section:${sectionId}"]`);
    const nameSpan = card?.querySelector('.section-card-name');
    if (!nameSpan) return;
    const song = this.app.presetManager.getSong(songId);
    const section = song?.sections.find(s => s.id === sectionId);
    if (!section) return;
    this.app.uiManager._startInlineEdit(nameSpan, section.name, (newName) => {
      this.app.presetManager.renameSection(songId, sectionId, newName);
      this.app.uiManager.showToast(`Renamed to "${newName}"`);
      this.app.uiManager.renderLiveMode();
    });
  }

  async deleteSectionWithConfirm(sectionId) {
    const songId = this.app.presetManager.activeSongId;
    const song = this.app.presetManager.getSong(songId);
    const section = song?.sections.find(s => s.id === sectionId);
    if (!section) return;
    if (await this.app.uiManager.confirmModal('Delete Section', `Are you sure you want to delete "${section.name}"?`)) {
      this.app.presetManager.deleteSection(songId, sectionId);
      this.app.uiManager.showToast('Section deleted');
      this.app.uiManager.renderLiveMode();
    }
  }

  duplicateSection(sectionId) {
    const songId = this.app.presetManager.activeSongId;
    if (!songId) return;
    const song = this.app.presetManager.getSong(songId);
    const sourceSection = song?.sections.find(s => s.id === sectionId);
    const sourceData = this.app.presetManager.getSectionData(songId, sectionId);
    if (!sourceSection || !sourceData) return;
    const newState = JSON.parse(JSON.stringify(sourceData));
    const newSection = this.app.presetManager.addSectionToSong(songId, `${sourceSection.name} Copy`, newState);
    if (newSection) {
      this.app.uiManager.showToast(`Section duplicated`);
      this.app.uiManager.renderLiveMode();
    }
  }

  startSongRename(songId) {
    const li = document.querySelector(`.song-item[data-midi-target="song:${songId}"]`);
    const titleSpan = li?.querySelector('.song-item-title');
    const song = this.app.presetManager.getSong(songId);
    if (!titleSpan || !song) return;
    this.app.uiManager._startInlineEdit(titleSpan, song.name, (newName) => {
      this.app.presetManager.renameSong(songId, newName);
      this.app.uiManager.showToast(`Renamed to "${newName}"`);
      this.app.uiManager.renderLiveMode();
    });
  }

  duplicateSong(songId) {
    const song = this.app.presetManager.getSong(songId);
    if (!song) return;
    const cloned = JSON.parse(JSON.stringify(song));
    cloned.id = this.app.presetManager.generateId();
    cloned.name = `${song.name} Copy`;
    cloned.sections = cloned.sections.map(s => ({
      ...s,
      id: this.app.presetManager.generateId(),
    }));
    this.app.presetManager.songs.push(cloned);
    this.app.presetManager.saveToStorage();
    this.app.uiManager.showToast(`Song duplicated as "${cloned.name}"`);
    this.app.uiManager.renderLiveMode();
  }

  async deleteSongWithConfirm(songId) {
    const song = this.app.presetManager.getSong(songId);
    if (!song) return;
    if (await this.app.uiManager.confirmModal('Delete Song', `Are you sure you want to delete "${song.name}"?`)) {
      this.app.presetManager.deleteSong(songId);
      this.app.uiManager.showToast('Song deleted');
      this.app.uiManager.renderLiveMode();
    }
  }
}

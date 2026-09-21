import { buildDefaultState, migrateState } from './stateSchema.js';
import { loadSettings } from './settingsStore.js';
import { buildDefaultFlowRail, sanitizeFlowRail } from '../flow-rail/flowRailState.js?v=3';

export class PresetManager {
  constructor() {
    this.storageKey = 'flowKeysPresetsV1';
    this.songs = [];
    this.activeSongId = null;
    this.activeSectionId = null;
    this.loadFromStorage();

    // Create initial default song if none exist
    if (this.songs.length === 0) {
      this.createSong('Default Song');
    }
  }

  loadFromStorage() {
    try {
      const dataStr = localStorage.getItem(this.storageKey);
      if (dataStr) {
        const data = JSON.parse(dataStr);
        let needsSave = false;

        this.songs = (data.songs || []).map(song => {
          const next = {
            ...song,
            bpm: song.bpm || 120,
            timeSignature: song.timeSignature || '4/4',
            transitionMode: song.transitionMode || 'flow',
            key: song.key ?? 0,
            transpose: song.transpose ?? 0,
            sections: (song.sections || []).map(section => {
              if (section.state && !section.state.modules) {
                needsSave = true;
                return { ...section, state: migrateState(section.state) };
              }
              return section;
            })
          };
          if (!song.flowRail) {
            needsSave = true;
            next.flowRail = buildDefaultFlowRail();
          } else {
            next.flowRail = sanitizeFlowRail(song.flowRail);
          }
          return next;
        });

        this.activeSongId = data.activeSongId || (this.songs.length > 0 ? this.songs[0].id : null);
        this.activeSectionId = data.activeSectionId || null;

        // Persist migrated state so we never re-migrate on future loads
        if (needsSave) this.saveToStorage();
      }
    } catch (e) {
      console.warn('Failed to load presets from storage', e);
      this.songs = [];
    }
  }

  saveToStorage() {
    const data = {
      songs: this.songs,
      activeSongId: this.activeSongId,
      activeSectionId: this.activeSectionId
    };
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }

  generateId() {
    return Math.random().toString(36).substring(2, 9);
  }

  getSongs() {
    return this.songs;
  }

  getSong(songId) {
    return this.songs.find(s => s.id === songId);
  }

  createSong(name) {
    const firstSection = {
      id: this.generateId(),
      name: 'Default Section',
      state: buildDefaultState()
    };
    const newSong = {
      id: this.generateId(),
      name: name || `Song ${this.songs.length + 1}`,
      bpm: 120,
      timeSignature: '4/4',
      transitionMode: loadSettings().newSongDefaults.transitionMode,
      key: 0,
      transpose: 0,
      sections: [firstSection],
      flowRail: buildDefaultFlowRail(),
    };
    this.songs.push(newSong);
    if (!this.activeSongId) {
      this.activeSongId = newSong.id;
      this.activeSectionId = firstSection.id;
    }
    this.saveToStorage();
    return newSong;
  }

  deleteSong(songId) {
    const index = this.songs.findIndex(s => s.id === songId);
    if (index !== -1) {
      this.songs.splice(index, 1);
      if (this.songs.length === 0) {
        this.createSong('Default Song');
      } else if (this.activeSongId === songId) {
        this.activeSongId = this.songs[0].id;
        this.activeSectionId = null;
      }
      this.saveToStorage();
      return true;
    }
    return false;
  }

  renameSong(songId, newName) {
    const song = this.getSong(songId);
    if (song && newName && newName.trim() !== '') {
      song.name = newName.trim();
      this.saveToStorage();
      return true;
    }
    return false;
  }

  updateSongSettings(songId, bpm, timeSignature, transitionMode, transpose) {
    const song = this.getSong(songId);
    if (song) {
      if (bpm !== undefined) song.bpm = bpm;
      if (timeSignature !== undefined) song.timeSignature = timeSignature;
      if (transitionMode !== undefined) song.transitionMode = transitionMode;
      if (transpose !== undefined) song.transpose = transpose;
      this.saveToStorage();
      return true;
    }
    return false;
  }

  updateSongKey(songId, key) {
    const song = this.getSong(songId);
    if (song) {
      song.key = key;
      this.saveToStorage();
      return true;
    }
    return false;
  }

  updateSongFlowRail(songId, flowRail) {
    const song = this.getSong(songId);
    if (!song) return false;
    song.flowRail = sanitizeFlowRail(flowRail);
    this.saveToStorage();
    return true;
  }

  pruneFlowRailMappings(songId, moduleId) {
    const song = this.getSong(songId);
    if (!song?.flowRail?.mappings) return false;
    const before = song.flowRail.mappings.length;
    song.flowRail.mappings = song.flowRail.mappings.filter(m => m.target?.moduleId !== moduleId);
    if (song.flowRail.mappings.length !== before) {
      this.saveToStorage();
      return true;
    }
    return false;
  }

  setActiveSong(songId) {
    this.activeSongId = songId;
    this.activeSectionId = null; // reset section when switching songs
    this.saveToStorage();
  }

  addSectionToSong(songId, name, stateData) {
    const song = this.getSong(songId);
    if (!song) return null;

    const newSection = {
      id: this.generateId(),
      name: name || `Section ${song.sections.length + 1}`,
      state: stateData
    };
    song.sections.push(newSection);
    this.saveToStorage();
    return newSection;
  }

  updateSectionState(songId, sectionId, newStateData) {
    const song = this.getSong(songId);
    if (!song) return false;
    const section = song.sections.find(s => s.id === sectionId);
    if (!section) return false;

    section.state = newStateData;
    this.saveToStorage();
    return true;
  }

  renameSection(songId, sectionId, newName) {
    const song = this.getSong(songId);
    if (!song) return false;
    const section = song.sections.find(s => s.id === sectionId);
    if (section && newName && newName.trim() !== '') {
      section.name = newName.trim();
      this.saveToStorage();
      return true;
    }
    return false;
  }

  deleteSection(songId, sectionId) {
    const song = this.getSong(songId);
    if (!song) return;
    song.sections = song.sections.filter(s => s.id !== sectionId);
    if (this.activeSectionId === sectionId) {
      this.activeSectionId = null;
    }
    this.saveToStorage();
  }

  reorderSections(songId, fromIndex, toIndex) {
    const song = this.getSong(songId);
    if (!song) return false;
    if (fromIndex === toIndex) return false;
    if (fromIndex < 0 || fromIndex >= song.sections.length) return false;
    if (toIndex < 0 || toIndex >= song.sections.length) return false;
    const [moved] = song.sections.splice(fromIndex, 1);
    song.sections.splice(toIndex, 0, moved);
    this.saveToStorage();
    return true;
  }

  getSectionData(songId, sectionId) {
    const song = this.getSong(songId);
    if (!song) return null;
    const section = song.sections.find(s => s.id === sectionId);
    return section ? section.state : null;
  }

  setActiveSection(songId, sectionId) {
    this.activeSongId = songId;
    this.activeSectionId = sectionId;
    this.saveToStorage();
  }

  // ── Song-level module propagation ─────────────────────────────────────────
  // When a module is added/removed/reordered/renamed in one section, these
  // methods mirror that structural change to every other section in the song
  // so all sections always share the same module lineup.

  propagateModuleAdd(songId, activeSectionId, moduleEntry, insertIndex) {
    const song = this.getSong(songId);
    if (!song) return;
    for (const section of song.sections) {
      if (section.id === activeSectionId || !section.state?.modules) continue;
      const modules = section.state.modules;
      const idx = Math.min(insertIndex, modules.length);
      // Deep clone config so nested arrays (drums tracks/seq, arp seq) aren't shared across sections.
      modules.splice(idx, 0, { ...moduleEntry, config: structuredClone(moduleEntry.config) });
    }
    this.saveToStorage();
  }

  propagateModuleRemove(songId, activeSectionId, moduleId) {
    const song = this.getSong(songId);
    if (!song) return;
    for (const section of song.sections) {
      if (section.id === activeSectionId || !section.state?.modules) continue;
      section.state.modules = section.state.modules.filter(m => m.id !== moduleId);
    }
    this.saveToStorage();
  }

  propagateModuleReorder(songId, activeSectionId, orderedIds) {
    const song = this.getSong(songId);
    if (!song) return;
    for (const section of song.sections) {
      if (section.id === activeSectionId || !section.state?.modules) continue;
      const moduleMap = new Map(section.state.modules.map(m => [m.id, m]));
      section.state.modules = orderedIds.map(id => moduleMap.get(id)).filter(Boolean);
    }
    this.saveToStorage();
  }

  propagateModuleRename(songId, activeSectionId, moduleId, newLabel) {
    const song = this.getSong(songId);
    if (!song) return;
    for (const section of song.sections) {
      if (section.id === activeSectionId || !section.state?.modules) continue;
      const mod = section.state.modules.find(m => m.id === moduleId);
      if (mod) mod.label = newLabel;
    }
    this.saveToStorage();
  }

  propagateModuleConfig(songId, activeSectionId, moduleId, config) {
    const song = this.getSong(songId);
    if (!song) return;
    for (const section of song.sections) {
      if (section.id === activeSectionId || !section.state?.modules) continue;
      const mod = section.state.modules.find(m => m.id === moduleId);
      if (mod) mod.config = structuredClone(config);
    }
    this.saveToStorage();
  }

  // Helpers for Next / Prev
  getNextSectionIds(fromSectionId = this.activeSectionId) {
    if (!this.activeSongId) return null;
    const song = this.getSong(this.activeSongId);
    if (!song || song.sections.length === 0) return null;

    if (!fromSectionId) {
      return { songId: song.id, sectionId: song.sections[0].id };
    }

    const currentIndex = song.sections.findIndex(s => s.id === fromSectionId);
    if (currentIndex >= 0 && currentIndex < song.sections.length - 1) {
      return { songId: song.id, sectionId: song.sections[currentIndex + 1].id };
    }
    return null; // Don't wrap around
  }

  getPrevSectionIds(fromSectionId = this.activeSectionId) {
    if (!this.activeSongId) return null;
    const song = this.getSong(this.activeSongId);
    if (!song || song.sections.length === 0) return null;

    if (!fromSectionId) {
      return { songId: song.id, sectionId: song.sections[0].id };
    }

    const currentIndex = song.sections.findIndex(s => s.id === fromSectionId);
    if (currentIndex > 0) {
      return { songId: song.id, sectionId: song.sections[currentIndex - 1].id };
    }
    return null; // Don't wrap around
  }
}

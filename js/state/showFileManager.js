import { buildDefaultState, MODULE_TYPE_DEFAULTS } from './stateSchema.js';

// Central registry of localStorage keys that define a complete Flow Keys project/show.
// Adding a new feature to the save system is as simple as adding its key and default builder here.
const SHOW_STATE_KEYS = [
  {
    key: 'flowKeysPresetsV1',
    getDefault: () => ({
      songs: [{
        id: Math.random().toString(36).substring(2, 9),
        name: 'Default Song',
        bpm: 120,
        timeSignature: '4/4',
        transitionMode: 'flow',
        key: 0,
        transpose: 0,
        sections: []
      }],
      activeSongId: null,
      activeSectionId: null
    })
  },
  {
    key: 'flowKeysState',
    getDefault: () => buildDefaultState()
  },
  {
    key: 'flowKeysMidiMap',
    getDefault: () => ({
      mappings: [],
      designatedInput: 'any'
    })
  },
  {
    key: 'flowKeysModulePresets',
    getDefault: () => ({
      percussion: { kick: [], snare: [], shaker: [] },
      arp: []
    })
  }
];

export class ShowFileManager {
  constructor(app) {
    this.app = app;
    this.storageKey = 'flowKeysShows';
    this.activeShowKey = 'flowKeysActiveShowId';
  }

  init() {
    this.migrateIfNeeded();
    this.checkPendingToast();
    this.setupEventListeners();
    this.renderShowsList();
  }

  /**
   * Auto-migrates existing localStorage data into a "Default Show" on first boot.
   * This guarantees that existing users keep all of their songs, sections, and settings.
   */
  migrateIfNeeded() {
    const showsStr = localStorage.getItem(this.storageKey);
    const activeShowId = localStorage.getItem(this.activeShowKey);

    if (!showsStr || !activeShowId) {
      // Check if we have any existing state in localStorage
      let hasExistingData = false;
      const stateData = {};

      for (const { key, getDefault } of SHOW_STATE_KEYS) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            stateData[key] = JSON.parse(val);
            hasExistingData = true;
          } catch (e) {
            stateData[key] = getDefault();
          }
        } else {
          stateData[key] = getDefault();
        }
      }

      const showId = 'show_default';
      const name = 'Default Show';
      const timestamp = new Date().toISOString();

      const shows = [{
        id: showId,
        name: name,
        lastSaved: timestamp
      }];

      localStorage.setItem(this.storageKey, JSON.stringify(shows));
      localStorage.setItem(this.activeShowKey, showId);

      const payload = {
        id: showId,
        name: name,
        lastSaved: timestamp,
        state: stateData
      };

      localStorage.setItem(`fk_show_${showId}`, JSON.stringify(payload));

      // Make sure active keys are saved
      for (const { key } of SHOW_STATE_KEYS) {
        localStorage.setItem(key, JSON.stringify(stateData[key]));
      }
    }
  }

  checkPendingToast() {
    const pending = localStorage.getItem('flowKeysPendingToast');
    if (pending) {
      try {
        const { message, type } = JSON.parse(pending);
        this.app.uiManager.showToast(message, type);
      } catch (e) {}
      localStorage.removeItem('flowKeysPendingToast');
    }
  }

  reloadWithToast(message, type = 'success') {
    localStorage.setItem('flowKeysPendingToast', JSON.stringify({ message, type }));
    window.location.reload();
  }

  getShowsList() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
    } catch (e) {
      return [];
    }
  }

  getActiveShowId() {
    return localStorage.getItem(this.activeShowKey) || 'show_default';
  }

  getActiveShowName() {
    const activeId = this.getActiveShowId();
    const shows = this.getShowsList();
    const activeShow = shows.find(s => s.id === activeId);
    return activeShow ? activeShow.name : 'Default Show';
  }

  saveActiveShow(silent = false) {
    const activeId = this.getActiveShowId();
    const shows = this.getShowsList();
    const showIndex = shows.findIndex(s => s.id === activeId);

    if (showIndex === -1) {
      if (!silent) this.app.uiManager.showToast('Active show metadata not found', 'error');
      return;
    }

    const stateData = {};
    for (const { key, getDefault } of SHOW_STATE_KEYS) {
      const val = localStorage.getItem(key);
      if (val) {
        try {
          stateData[key] = JSON.parse(val);
        } catch (e) {
          stateData[key] = getDefault();
        }
      } else {
        stateData[key] = getDefault();
      }
    }

    const timestamp = new Date().toISOString();
    shows[showIndex].lastSaved = timestamp;
    localStorage.setItem(this.storageKey, JSON.stringify(shows));

    const payload = {
      id: activeId,
      name: shows[showIndex].name,
      lastSaved: timestamp,
      state: stateData
    };

    localStorage.setItem(`fk_show_${activeId}`, JSON.stringify(payload));

    if (!silent) {
      this.app.uiManager.showToast(`Saved active show "${shows[showIndex].name}"`);
    }
    this.renderShowsList();
  }

  async saveShowAs() {
    const name = await this.app.uiManager.promptModal('Save Show As', 'Enter show name...', 'New Show');
    if (!name || name.trim() === '') return;

    const trimmedName = name.trim();
    const shows = this.getShowsList();
    const activeId = this.getActiveShowId();

    // Auto-save the current state of active show first
    this.saveActiveShow(true);

    const newId = 'show_' + Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toISOString();

    const stateData = {};
    for (const { key, getDefault } of SHOW_STATE_KEYS) {
      const val = localStorage.getItem(key);
      if (val) {
        try {
          stateData[key] = JSON.parse(val);
        } catch (e) {
          stateData[key] = getDefault();
        }
      } else {
        stateData[key] = getDefault();
      }
    }

    shows.push({
      id: newId,
      name: trimmedName,
      lastSaved: timestamp
    });

    localStorage.setItem(this.storageKey, JSON.stringify(shows));

    const payload = {
      id: newId,
      name: trimmedName,
      lastSaved: timestamp,
      state: stateData
    };

    localStorage.setItem(`fk_show_${newId}`, JSON.stringify(payload));
    localStorage.setItem(this.activeShowKey, newId);

    // Save state back to localStorage active keys
    for (const { key } of SHOW_STATE_KEYS) {
      localStorage.setItem(key, JSON.stringify(stateData[key]));
    }

    this.reloadWithToast(`Created show "${trimmedName}"`);
  }

  async createNewShow() {
    const name = await this.app.uiManager.promptModal('New Show', 'Enter show name...', 'Untitled Show');
    if (!name || name.trim() === '') return;

    const trimmedName = name.trim();
    const shows = this.getShowsList();

    // Auto-save current active show first
    this.saveActiveShow(true);

    const newId = 'show_' + Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toISOString();

    const stateData = {};
    for (const { key, getDefault } of SHOW_STATE_KEYS) {
      stateData[key] = getDefault();
    }

    // New shows start with just a single keyboard module
    stateData['flowKeysState'] = {
      ...stateData['flowKeysState'],
      modules: [{
        id: `keyboard-${Date.now()}`,
        type: 'keyboard',
        label: 'Keyboard',
        active: false,
        config: { ...MODULE_TYPE_DEFAULTS.keyboard }
      }]
    };

    shows.push({
      id: newId,
      name: trimmedName,
      lastSaved: timestamp
    });

    localStorage.setItem(this.storageKey, JSON.stringify(shows));

    const payload = {
      id: newId,
      name: trimmedName,
      lastSaved: timestamp,
      state: stateData
    };

    localStorage.setItem(`fk_show_${newId}`, JSON.stringify(payload));
    localStorage.setItem(this.activeShowKey, newId);

    for (const { key } of SHOW_STATE_KEYS) {
      localStorage.setItem(key, JSON.stringify(stateData[key]));
    }

    this.reloadWithToast(`Initializing new show "${trimmedName}"...`);
  }

  async loadShow(showId) {
    const activeId = this.getActiveShowId();
    if (showId === activeId) return;

    // Auto-save active show before switching
    this.saveActiveShow(true);

    const shows = this.getShowsList();
    const show = shows.find(s => s.id === showId);
    if (!show) {
      this.app.uiManager.showToast('Show not found', 'error');
      return;
    }

    const payloadStr = localStorage.getItem(`fk_show_${showId}`);
    if (!payloadStr) {
      this.app.uiManager.showToast('Show file payload not found', 'error');
      return;
    }

    try {
      const payload = JSON.parse(payloadStr);

      localStorage.setItem(this.activeShowKey, showId);

      // Write values to actual keys for loading
      for (const { key, getDefault } of SHOW_STATE_KEYS) {
        const val = payload.state[key] || getDefault();
        localStorage.setItem(key, JSON.stringify(val));
      }

      this.reloadWithToast(`Loading show "${show.name}"...`);
    } catch (e) {
      this.app.uiManager.showToast('Failed to load show: corrupt payload', 'error');
    }
  }

  async deleteShow(showId) {
    const activeId = this.getActiveShowId();
    if (showId === activeId) {
      this.app.uiManager.showToast('Cannot delete the currently active show', 'error');
      return;
    }

    const shows = this.getShowsList();
    const show = shows.find(s => s.id === showId);
    if (!show) return;

    const confirmed = await this.app.uiManager.confirmModal(
      'Delete Show',
      `Are you sure you want to delete "${show.name}"? This will delete all of its songs and settings.`
    );
    if (!confirmed) return;

    const updatedShows = shows.filter(s => s.id !== showId);
    localStorage.setItem(this.storageKey, JSON.stringify(updatedShows));
    localStorage.removeItem(`fk_show_${showId}`);

    this.app.uiManager.showToast(`Deleted show "${show.name}"`);
    this.renderShowsList();
  }

  async renameShow(showId) {
    const shows = this.getShowsList();
    const show = shows.find(s => s.id === showId);
    if (!show) return;

    const newName = await this.app.uiManager.promptModal(
      'Rename Show',
      'Enter new name...',
      show.name
    );

    if (!newName || newName.trim() === '' || newName.trim() === show.name) return;

    const trimmedName = newName.trim();
    show.name = trimmedName;
    localStorage.setItem(this.storageKey, JSON.stringify(shows));

    const payloadStr = localStorage.getItem(`fk_show_${showId}`);
    if (payloadStr) {
      try {
        const payload = JSON.parse(payloadStr);
        payload.name = trimmedName;
        localStorage.setItem(`fk_show_${showId}`, JSON.stringify(payload));
      } catch (e) {}
    }

    // If active show was renamed, update UI header immediately
    const activeId = this.getActiveShowId();
    if (showId === activeId) {
      const displayEl = document.getElementById('active-show-name');
      if (displayEl) displayEl.textContent = trimmedName;
    }

    this.app.uiManager.showToast(`Renamed show to "${trimmedName}"`);
    this.renderShowsList();
  }

  exportShow(showId) {
    const shows = this.getShowsList();
    const show = shows.find(s => s.id === showId);
    if (!show) return;

    // If exporting the active show, save it first to ensure file is up to date
    const activeId = this.getActiveShowId();
    if (showId === activeId) {
      this.saveActiveShow(true);
    }

    const payloadStr = localStorage.getItem(`fk_show_${showId}`);
    if (!payloadStr) {
      this.app.uiManager.showToast('Show payload not found', 'error');
      return;
    }

    try {
      const payload = JSON.parse(payloadStr);
      const fileData = {
        type: 'FlowKeysShow',
        version: '1.0',
        payload: payload
      };

      const jsonStr = JSON.stringify(fileData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const filename = `${show.name.toLowerCase().replace(/[^a-z0-9]/gi, '_')}-show.json`;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);

      this.app.uiManager.showToast(`Exported "${show.name}"`);
    } catch (e) {
      this.app.uiManager.showToast('Failed to export show', 'error');
    }
  }

  async importShow(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (importData.type !== 'FlowKeysShow' || !importData.payload || !importData.payload.state) {
        this.app.uiManager.showToast('Invalid file format — not a Flow Keys Show', 'error');
        return;
      }

      const payload = importData.payload;
      const shows = this.getShowsList();

      const newId = 'show_' + Math.random().toString(36).substring(2, 9);
      let showName = payload.name || 'Imported Show';
      let baseName = showName;
      let counter = 1;

      while (shows.some(s => s.name === showName)) {
        showName = `${baseName} (${counter++})`;
      }

      const timestamp = new Date().toISOString();
      shows.push({
        id: newId,
        name: showName,
        lastSaved: timestamp
      });

      localStorage.setItem(this.storageKey, JSON.stringify(shows));

      // Overwrite the imported payload properties to sync with our new ID
      payload.id = newId;
      payload.name = showName;
      payload.lastSaved = timestamp;

      // Polyfill defaults for any missing state keys
      for (const { key, getDefault } of SHOW_STATE_KEYS) {
        if (!payload.state[key]) {
          payload.state[key] = getDefault();
        }
      }

      localStorage.setItem(`fk_show_${newId}`, JSON.stringify(payload));

      this.app.uiManager.showToast(`Imported show "${showName}"`);

      const loadNow = await this.app.uiManager.confirmModal(
        'Load Imported Show',
        `Would you like to load "${showName}" right now?`
      );

      if (loadNow) {
        this.loadShow(newId);
      } else {
        this.renderShowsList();
      }
    } catch (e) {
      this.app.uiManager.showToast('Failed to import show: invalid JSON file', 'error');
    }
  }

  setupEventListeners() {
    const saveBtn = document.getElementById('show-save-btn');
    const saveAsBtn = document.getElementById('show-save-as-btn');
    const newBtn = document.getElementById('show-new-btn');
    const importInput = document.getElementById('import-show-input');

    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveActiveShow());
    }
    if (saveAsBtn) {
      saveAsBtn.addEventListener('click', () => this.saveShowAs());
    }
    if (newBtn) {
      newBtn.addEventListener('click', () => this.createNewShow());
    }
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.importShow(file);
        }
        e.target.value = ''; // Reset file input
      });
    }
  }

  renderShowsList() {
    const activeShowNameEl = document.getElementById('active-show-name');
    if (activeShowNameEl) {
      activeShowNameEl.textContent = this.getActiveShowName();
    }

    const listEl = document.getElementById('local-shows-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    const shows = this.getShowsList();
    const activeId = this.getActiveShowId();

    if (shows.length === 0) {
      listEl.innerHTML = `<li style="padding: 0.75rem; text-align: center; color: var(--text-dim); font-size: 0.8rem;">No shows found</li>`;
      return;
    }

    // Sort shows by last saved timestamp (newest first)
    const sortedShows = [...shows].sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));

    sortedShows.forEach(show => {
      const isActive = show.id === activeId;
      const dateStr = new Date(show.lastSaved).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const li = document.createElement('li');
      li.className = `show-item-row ${isActive ? 'active' : ''}`;
      li.dataset.showId = show.id;

      li.innerHTML = `
        <div class="show-item-info">
          <span class="show-item-name-text">${show.name}</span>
          <span class="show-item-date">Saved ${dateStr}</span>
        </div>
        <div class="show-item-actions">
          <button class="show-action-button rename" title="Rename show">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="show-action-button export" title="Export show file">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          ${!isActive ? `
          <button class="show-action-button delete" title="Delete show">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
          ` : ''}
        </div>
      `;

      // Event listener for loading the show on clicking the info block
      const infoBtn = li.querySelector('.show-item-info');
      infoBtn.addEventListener('click', () => {
        this.loadShow(show.id);
      });

      // Event listener for rename button
      const renameBtn = li.querySelector('.show-action-button.rename');
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameShow(show.id);
      });

      // Event listener for export button
      const exportBtn = li.querySelector('.show-action-button.export');
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.exportShow(show.id);
      });

      // Event listener for delete button (if present)
      const deleteBtn = li.querySelector('.show-action-button.delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteShow(show.id);
        });
      }

      listEl.appendChild(li);
    });
  }
}

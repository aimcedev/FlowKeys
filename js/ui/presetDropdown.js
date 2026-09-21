export class PresetDropdown {
  constructor(app, gridController) {
    this.app = app;
    this.grid = gridController;
    this._panel = null;
    this._subPanel = null;
    this._triggerBtn = null;
    this._currentInstanceId = null;
    this._currentType = null;
    this._activeCategory = null;
    this._hideSubTimeout = null;
    this._build();
  }

  _build() {
    this._panel = document.createElement('div');
    this._panel.className = 'preset-dropdown';
    this._panel.style.display = 'none';
    document.body.appendChild(this._panel);

    this._subPanel = document.createElement('div');
    this._subPanel.className = 'preset-dropdown preset-dropdown--sub';
    this._subPanel.style.display = 'none';
    document.body.appendChild(this._subPanel);

    // Mouse entering the sub-panel cancels any pending hide
    this._subPanel.addEventListener('mouseenter', () => {
      clearTimeout(this._hideSubTimeout);
    });
    this._subPanel.addEventListener('mouseleave', () => {
      this._scheduleHideSub();
    });

    document.addEventListener('mousedown', (e) => {
      if (this._panel.style.display === 'none') return;
      if (this._panel.contains(e.target)) return;
      if (this._subPanel.contains(e.target)) return;
      if (e.target.closest('[data-action="open-preset-menu"]')) return;
      this.close();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._panel.style.display !== 'none') this.close();
    });
  }

  toggle(triggerBtn, instanceId, type) {
    const isOpen = this._panel.style.display !== 'none';
    const isSame = this._currentInstanceId === instanceId;

    if (isOpen) {
      this.close();
      if (isSame) return;
    }

    this._currentInstanceId = instanceId;
    this._currentType = type;
    this._triggerBtn = triggerBtn;

    this._render();
    this._positionPanel(triggerBtn);
    this._panel.style.display = 'block';
    triggerBtn.classList.add('open');
  }

  close() {
    clearTimeout(this._hideSubTimeout);
    this._panel.style.display = 'none';
    this._subPanel.style.display = 'none';
    this._activeCategory = null;
    if (this._triggerBtn) {
      this._triggerBtn.classList.remove('open');
      this._triggerBtn = null;
    }
    this._currentInstanceId = null;
    this._currentType = null;
  }

  _positionPanel(btn) {
    const rect = btn.getBoundingClientRect();
    const W = 190;
    let left = rect.left;
    let top = rect.bottom + 5;

    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (left < 8) left = 8;
    if (top + 280 > window.innerHeight - 8) top = rect.top - 280 - 5;
    if (top < 8) top = 8;

    this._panel.style.left = `${left}px`;
    this._panel.style.top = `${top}px`;
  }

  _render() {
    const { _currentType: type } = this;
    const pm = this.app.modulePresetManager;
    this._panel.innerHTML = '';

    if (type === 'percussion') {
      const CATS = [
        { id: 'kick',   label: 'Kick' },
        { id: 'snare',  label: 'Snare' },
        { id: 'shaker', label: 'Shaker' },
      ];
      for (const cat of CATS) {
        const presets = pm.getPresets('percussion', cat.id);
        const item = document.createElement('div');
        item.className = 'pdrop-item pdrop-item--cat';
        item.dataset.catId = cat.id;
        item.innerHTML = `
          <span class="pdrop-item-label">${cat.label}</span>
          <span class="pdrop-cat-badge">${presets.length}</span>
          <span class="pdrop-flyout-arrow">›</span>`;

        item.addEventListener('mouseenter', () => {
          clearTimeout(this._hideSubTimeout);
          this._activateCategoryItem(item);
          this._showSub(item, cat.id, presets);
        });
        item.addEventListener('mouseleave', () => {
          this._scheduleHideSub();
        });
        this._panel.appendChild(item);
      }
    } else {
      // Flat single-panel list (Arp, Drums, etc.)
      const all = pm.getPresets(type, null);
      const builtins = all.filter(p => p.builtin);
      const user = all.filter(p => !p.builtin);

      for (const p of builtins) {
        this._panel.appendChild(this._makePresetItem(p, type, null));
      }
      if (user.length > 0) {
        this._panel.appendChild(this._makeSep());
        for (const p of user) {
          this._panel.appendChild(this._makePresetItem(p, type, null, true));
        }
      }
    }

    this._panel.appendChild(this._makeSep());
    this._panel.appendChild(this._makeSaveBtn());
  }

  _activateCategoryItem(item) {
    this._panel.querySelectorAll('.pdrop-item--cat').forEach(el => {
      el.classList.remove('pdrop-item--cat-active');
    });
    item.classList.add('pdrop-item--cat-active');
  }

  _showSub(catItemEl, catId, presets) {
    clearTimeout(this._hideSubTimeout);
    this._activeCategory = catId;

    const sub = this._subPanel;
    sub.innerHTML = '';

    const builtins = presets.filter(p => p.builtin);
    const user = presets.filter(p => !p.builtin);

    for (const p of builtins) {
      sub.appendChild(this._makePresetItem(p, 'percussion', catId));
    }
    if (user.length > 0) {
      if (builtins.length > 0) sub.appendChild(this._makeSep());
      for (const p of user) {
        sub.appendChild(this._makePresetItem(p, 'percussion', catId, true));
      }
    }

    // Position to the right of the primary panel
    const primaryRect = this._panel.getBoundingClientRect();
    const itemRect = catItemEl.getBoundingClientRect();
    const subW = 220;
    const subMaxH = 320;

    let left = primaryRect.right + 4;
    let top = itemRect.top - 4; // align near hovered item

    // Flip left if it goes off-screen
    if (left + subW > window.innerWidth - 8) {
      left = primaryRect.left - subW - 4;
    }
    if (left < 8) left = 8;
    if (top + subMaxH > window.innerHeight - 8) top = window.innerHeight - subMaxH - 8;
    if (top < 8) top = 8;

    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
    sub.style.display = 'block';
  }

  _hideSub() {
    this._subPanel.style.display = 'none';
    this._panel.querySelectorAll('.pdrop-item--cat-active').forEach(el => {
      el.classList.remove('pdrop-item--cat-active');
    });
    this._activeCategory = null;
  }

  _scheduleHideSub() {
    clearTimeout(this._hideSubTimeout);
    this._hideSubTimeout = setTimeout(() => this._hideSub(), 160);
  }

  _makePresetItem(preset, type, category, isUser = false) {
    const item = document.createElement('div');
    item.className = isUser ? 'pdrop-item pdrop-item--user' : 'pdrop-item';

    if (isUser) {
      const name = document.createElement('span');
      name.className = 'pdrop-item-name';
      name.textContent = preset.name;
      item.appendChild(name);

      const del = document.createElement('button');
      del.className = 'pdrop-item-delete';
      del.type = 'button';
      del.textContent = '×';
      del.title = 'Delete preset';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.close();
        const ok = await this.app.uiManager.confirmModal(
          `Delete "${preset.name}"?`,
          'This cannot be undone.'
        );
        if (!ok) return;
        this.app.modulePresetManager.deletePreset(type, category, preset.id);
        this.app.uiManager.showToast(`Deleted "${preset.name}"`);
      });
      item.appendChild(del);
    } else {
      item.textContent = preset.name;
    }

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('pdrop-item-delete')) return;
      this.grid._loadPreset(this._currentInstanceId, type, preset);
      this.close();
    });

    return item;
  }

  _makeSep() {
    const sep = document.createElement('div');
    sep.className = 'pdrop-sep';
    return sep;
  }

  _makeSaveBtn() {
    const btn = document.createElement('div');
    btn.className = 'pdrop-save-item';
    btn.innerHTML = `<span class="pdrop-save-icon">+</span><span>Save Current Pattern…</span>`;
    btn.addEventListener('mouseenter', () => this._scheduleHideSub());
    btn.addEventListener('click', () => {
      const instanceId = this._currentInstanceId;
      const type = this._currentType;
      this.close();
      this._save(instanceId, type);
    });
    return btn;
  }

  async _save(instanceId, type) {
    const name = await this.app.uiManager.promptModal('Save Pattern As', 'My Pattern');
    if (!name) return;

    const category = type === 'percussion'
      ? this.grid._defaultPercussionCategory(instanceId)
      : null;

    let seq = null;
    const extras = {};

    if (type === 'drums') {
      const mod = this.app.moduleInstances.get(instanceId);
      if (!mod) return;
      extras.tracks = mod.tracks.map(t => ({
        id: t.id,
        name: t.name,
        note: t.note,
        seq: [...t.seq],
        muted: t.muted
      }));
      seq = []; // dummy empty sequence
    } else {
      seq = this.app.sequencers.get(instanceId)?.getVelocities();
      if (!seq) return;

      if (type === 'arp') {
        const m = this.app._getModuleEl(instanceId, 'mode')?.value;
        const n = this.app._getModuleEl(instanceId, 'notes')?.value;
        if (m) extras.mode = m;
        if (n) extras.notes = n;
      }
    }

    this.app.modulePresetManager.savePreset(type, category, name, seq, extras);
    this.app.uiManager.showToast(`Saved "${name}"`);
  }
}

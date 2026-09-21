export class AppUiManager {
  constructor(app) {
    this.app = app;
    this.presetManager = app.presetManager;

    // Live / Edit / Flow layouts
    this.modeSwitchBtns = document.querySelectorAll('.mode-switch-btn');
    this.liveView = document.getElementById('live-mode-view');
    this.editView = document.getElementById('edit-mode-view');
    this.flowView = document.getElementById('flow-mode-view');
    this.liveEditToggleBtn = document.getElementById('live-edit-toggle-btn');

    // Internal state
    this.isLiveEditMode = false;
    this.currentMode = 'edit'; // By default index.html boots strictly into edit view
    this._sectionDrag     = null; // section card drag state
    this._lockedBpm       = null; // BPM frozen at lock time; persists until unlock
    this._lastDisplayedBpm = null; // last BPM that triggered a pulse animation

    // Live View Elements
    this.songList = document.getElementById('song-list');
    this.addSongBtn = document.getElementById('add-song-btn');
    this.sectionGrid = document.getElementById('section-grid');
    this.currentSongTitle = document.getElementById('current-song-title');
    this.saveStateBtn = document.getElementById('save-current-state-btn');
    this.liveActions = document.getElementById('live-actions');
    this.liveEditToggleBtn = document.getElementById('live-edit-toggle-btn');
    this.clockModeBtns = document.querySelectorAll('.clock-mode-btn');

    this.isLiveEditMode = false;

    // Modal Elements
    this.modalOverlay = document.getElementById('naming-modal-overlay');
    this.modalTitle = document.getElementById('naming-modal-title');
    this.modalSubtitle = document.getElementById('naming-modal-subtitle');
    this.modalInput = document.getElementById('naming-modal-input');
    this.modalCancel = document.getElementById('naming-modal-cancel');
    this.modalSave = document.getElementById('naming-modal-save');

    // Edit Mode Context Bar
    this.editContextBar = document.getElementById('edit-context-bar');
    this.editContextSong = document.getElementById('edit-context-song');
    this.editSaveStatus = document.getElementById('edit-save-status');
    this.editRenameSongBtn = document.getElementById('edit-rename-song-btn');
    this.editDeleteSongBtn = document.getElementById('edit-delete-song-btn');
    this.editAddSongBtn = document.getElementById('edit-add-song-btn');
    this.editSectionsList = document.getElementById('edit-sections-list');
    this.editAddSectionBtn = document.getElementById('edit-add-section-btn');

    // Module badge config
    this.moduleBadges = [
      { key: 'bassToggle', label: 'B', color: 'var(--color-bass)' },
      { key: 'arpToggle', label: 'A', color: 'var(--color-arp)' },
      { key: 'padToggle', label: 'D', color: 'var(--color-pad)' }, // 'D' for Drone
      { key: 'kickToggle', label: 'K', color: 'var(--color-kick)' },
      { key: 'snareToggle', label: 'S', color: 'var(--color-snare)' },
      { key: 'shakerToggle', label: 'Sh', color: 'var(--color-shaker)' },
    ];

    this.init();
  }

  init() {
    this.setupListeners();
    this.renderLiveMode();
  }

  // ── Toast Notification ───────────────────────────────
  showToast(message, type = 'success') {
    // Remove existing toast if present
    const existing = document.querySelector('.fk-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `fk-toast fk-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('fk-toast--visible');
    });

    setTimeout(() => {
      toast.classList.remove('fk-toast--visible');
      const fallback = setTimeout(() => toast.remove(), 400);
      toast.addEventListener('transitionend', () => {
        clearTimeout(fallback);
        toast.remove();
      }, { once: true });
    }, 2000);
  }

  // ── Inline Editing Helpers ───────────────────────────
  _startInlineEdit(element, currentValue, onSave) {
    if (element.querySelector('.inline-edit-input')) return; // already editing

    const originalText = element.textContent;
    element.textContent = '';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit-input';
    input.value = currentValue;
    element.appendChild(input);

    // Auto-select text
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    const commit = () => {
      const newVal = input.value.trim();
      if (newVal && newVal !== currentValue) {
        onSave(newVal);
      } else {
        element.textContent = originalText;
      }
    };

    const onKeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        input.removeEventListener('blur', commit);
        input.removeEventListener('keydown', onKeydown);
        element.textContent = originalText;
      }
    };
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', onKeydown);
  }

  // ── Modal Helpers (kept for confirm dialogs) ─────────
  promptModal(title, placeholder, initialValue = '') {
    return new Promise((resolve) => {
      if (!this.modalOverlay) {
        resolve(prompt(title));
        return;
      }

      this.modalTitle.textContent = title;
      if (this.modalSubtitle) this.modalSubtitle.style.display = 'none';
      this.modalInput.style.display = 'block';
      this.modalInput.placeholder = placeholder || '';
      this.modalInput.value = initialValue;
      this.modalSave.textContent = 'Save';
      this.modalSave.style.background = 'var(--accent-magenta)';
      this.modalOverlay.classList.add('open');
      this.modalInput.focus();
      this.modalInput.select();

      const cleanup = () => {
        this.modalOverlay.classList.remove('open');
        this.modalSave.removeEventListener('click', onSave);
        this.modalCancel.removeEventListener('click', onCancel);
        this.modalInput.removeEventListener('keydown', onKey);
      };

      const onSave = () => { resolve(this.modalInput.value.trim() || null); cleanup(); };
      const onCancel = () => { resolve(null); cleanup(); };

      const onKey = (e) => {
        if (e.key === 'Enter') onSave();
        if (e.key === 'Escape') onCancel();
      };

      this.modalSave.addEventListener('click', onSave);
      this.modalCancel.addEventListener('click', onCancel);
      this.modalInput.addEventListener('keydown', onKey);
    });
  }

  confirmModal(title, subtitle) {
    return new Promise((resolve) => {
      if (!this.modalOverlay) {
        resolve(confirm(`${title}\n${subtitle}`));
        return;
      }

      this.modalTitle.textContent = title;
      if (this.modalSubtitle) {
        this.modalSubtitle.textContent = subtitle || '';
        this.modalSubtitle.style.display = subtitle ? 'block' : 'none';
      }
      this.modalInput.style.display = 'none'; // hide input for confirm
      this.modalSave.textContent = 'Confirm';
      this.modalSave.style.background = 'var(--state-panic)';

      this.modalOverlay.classList.add('open');

      const cleanup = () => {
        this.modalOverlay.classList.remove('open');
        this.modalInput.style.display = 'block';
        this.modalSave.textContent = 'Save';
        this.modalSave.style.background = 'var(--accent-magenta)';
        if (this.modalSubtitle) this.modalSubtitle.style.display = 'none';

        this.modalSave.removeEventListener('click', onSave);
        this.modalCancel.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
      };

      const onSave = () => { resolve(true); cleanup(); };
      const onCancel = () => { resolve(false); cleanup(); };

      const onKey = (e) => {
        if (e.key === 'Enter') onSave();
        if (e.key === 'Escape') onCancel();
      };

      this.modalSave.addEventListener('click', onSave);
      this.modalCancel.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  }

  // ── Event Listeners ──────────────────────────────────
  setupListeners() {
    // Live Edit Layout toggle
    if (this.liveEditToggleBtn) {
      this.liveEditToggleBtn.addEventListener('click', () => {
        this.isLiveEditMode = !this.isLiveEditMode;
        if (this.isLiveEditMode) {
          this.liveView.classList.add('editing-layout');
          this.liveEditToggleBtn.classList.add('unlocked');
          this.liveEditToggleBtn.innerHTML = '<span class="icon-span"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg></span><span class="text-span">UNLOCKED</span>';
        } else {
          this.liveView.classList.remove('editing-layout');
          this.liveEditToggleBtn.classList.remove('unlocked');
          this.liveEditToggleBtn.innerHTML = '<span class="icon-span"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lock-icon"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span><span class="text-span">LOCKED</span>';
        }
        this.renderLiveMode();
      });
    }

    // Mode toggle with crossfade
    this.modeSwitchBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode) this.setMode(mode);
      });
    });

    // Add Song
    if (this.addSongBtn) {
      this.addSongBtn.addEventListener('click', () => {
        const song = this.presetManager.createSong('New Song');
        this.presetManager.setActiveSong(song.id);
        if (this.app.applySongSettings) this.app.applySongSettings(song);
        this.pendingInlineEditSongId = song.id;
        this.renderLiveMode();
      });
    }

    // Save Section
    if (this.saveStateBtn) {
      this.saveStateBtn.addEventListener('click', async () => {
        if (!this.presetManager.activeSongId) return;
        const defaultName = 'New Section';
        const stateData = this.app.getCurrentStateData();
        const newSection = this.presetManager.addSectionToSong(this.presetManager.activeSongId, defaultName, stateData);
        if (newSection) {
          this.pendingInlineEditSectionId = newSection.id;
          this.app.triggerSectionChange(this.presetManager.activeSongId, newSection.id);
          this.renderLiveMode();
        }
      });
    }

    // Clock Mode buttons — save to song and apply immediately
    this.clockModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this._setActiveModeBtn(mode);
        if (this.presetManager.activeSongId) {
          this.presetManager.updateSongSettings(this.presetManager.activeSongId, undefined, undefined, mode);
          this.app.engine.clock.setMode(mode);
        }
      });
    });

    // Edit Context Bar: Change Song Selection
    if (this.editContextSong) {
      this.editContextSong.addEventListener('change', (e) => {
        const newSongId = e.target.value;
        const newSong = this.presetManager.getSong(newSongId);
        if (newSong) {
          this.presetManager.setActiveSong(newSongId);
          if (this.app.applySongSettings) this.app.applySongSettings(newSong);
          this.updateEditContextBar();
          this.renderLiveMode();
        }
      });
    }

    // Edit Mode Naming and Creation buttons
    if (this.editRenameSongBtn) {
      this.editRenameSongBtn.addEventListener('click', async () => {
        const activeSongId = this.presetManager.activeSongId;
        const song = this.presetManager.getSong(activeSongId);
        if (!song) return;
        const newName = await this.promptModal('Rename Song', 'Song Name...', song.name);
        if (newName) {
          this.presetManager.renameSong(activeSongId, newName);
          this.showToast(`Renamed to "${newName}"`);
          this.updateEditContextBar();
        }
      });
    }

    if (this.editDeleteSongBtn) {
      this.editDeleteSongBtn.addEventListener('click', async () => {
        const activeSongId = this.presetManager.activeSongId;
        const song = this.presetManager.getSong(activeSongId);
        if (!song) return;
        if (await this.confirmModal('Delete Song', `Are you sure you want to delete "${song.name}"?`)) {
          this.presetManager.deleteSong(activeSongId);
          this.showToast('Song deleted');
          const newActiveSongId = this.presetManager.activeSongId;
          const newSong = this.presetManager.getSong(newActiveSongId);
          if (newSong) {
            if (this.app.applySongSettings) this.app.applySongSettings(newSong);
          }
          this.updateEditContextBar();
          this.renderLiveMode();
        }
      });
    }

    if (this.editAddSongBtn) {
      this.editAddSongBtn.addEventListener('click', () => {
        const song = this.presetManager.createSong('New Song');
        this.presetManager.setActiveSong(song.id);
        if (this.app.applySongSettings) this.app.applySongSettings(song);
        this.pendingInlineEditSongId = song.id;
        this.updateEditContextBar();
      });
    }

    if (this.editAddSectionBtn) {
      this.editAddSectionBtn.addEventListener('click', () => {
        const activeSongId = this.presetManager.activeSongId;
        if (!activeSongId) return;
        const defaultName = 'New Section';
        const stateData = this.app.getCurrentStateData();
        const newSection = this.presetManager.addSectionToSong(activeSongId, defaultName, stateData);
        if (newSection) {
          this.pendingInlineEditSectionId = newSection.id;
          this.app.triggerSectionChange(activeSongId, newSection.id);
        }
      });
    }

    // Section card drag-and-drop (delegated on section grid)
    this._initSectionDragDrop();

    // Edit Mode vertical drag-and-drop
    this._initEditSectionDragDrop();

    // Tempo tracker popover
    this._initTempoPopover();

    // Module palette drawer (FAB, ≤900px)
    this._initModulePaletteDrawer();

    // Window Resize smooth transitions
    this.setupWindowResizeAnimation();
  }

  // ── Module Palette Drawer (FAB) ──────────────────────────
  _initModulePaletteDrawer() {
    const fab      = document.getElementById('add-module-fab');
    const palette  = document.querySelector('.module-palette');
    const backdrop = document.getElementById('palette-drawer-backdrop');
    if (!fab || !palette || !backdrop) return;

    const open = () => {
      palette.classList.add('drawer-open');
      backdrop.classList.add('visible');
      fab.classList.add('drawer-open');
    };

    const close = () => {
      palette.classList.remove('drawer-open');
      backdrop.classList.remove('visible');
      fab.classList.remove('drawer-open');
    };

    fab.addEventListener('click', () => {
      palette.classList.contains('drawer-open') ? close() : open();
    });

    backdrop.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && palette.classList.contains('drawer-open')) close();
    });

    // Close drawer when a palette tile is dropped (user has selected a module)
    palette.addEventListener('dragend', () => {
      setTimeout(close, 50);
    });
  }

  // ── Tempo Popover ────────────────────────────────────────
  _initTempoPopover() {
    const triggerBtn = document.getElementById('tempo-trigger-btn');
    const popover    = document.getElementById('tempo-popover');
    if (!triggerBtn || !popover) return;

    const positionPopover = () => {
      const headerRect = document.querySelector('header.top-bar')?.getBoundingClientRect();
      const btnRect    = triggerBtn.getBoundingClientRect();
      const container  = document.querySelector('.app-container');
      if (!headerRect || !container) return;
      const containerRect = container.getBoundingClientRect();
      popover.style.top   = (headerRect.bottom - containerRect.top + 8) + 'px';
      
      const popoverWidth = 360;
      let left = (btnRect.left + btnRect.width / 2) - (popoverWidth / 2) - containerRect.left;
      
      // Clamp to screen boundaries with 12px padding
      left = Math.max(12, left);
      if (left + popoverWidth > containerRect.width - 12) {
        left = Math.max(12, containerRect.width - popoverWidth - 12);
      }
      
      popover.style.left  = left + 'px';
      popover.style.right = 'auto';
    };

    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = popover.classList.contains('tempo-popover--open');
      if (!isOpen) positionPopover();
      popover.classList.toggle('tempo-popover--open', !isOpen);
      triggerBtn.classList.toggle('active', !isOpen);

      // Close chord popover if open for UI cleanliness
      document.getElementById('chord-popover')?.classList.remove('chord-popover--open');
      document.getElementById('chord-detector-btn')?.classList.remove('active');
    });

    document.addEventListener('click', (e) => {
      if (!popover.contains(e.target) && e.target !== triggerBtn && !triggerBtn.contains(e.target)) {
        popover.classList.remove('tempo-popover--open');
        triggerBtn.classList.remove('active');
      }
    });

    window.addEventListener('resize', () => {
      if (popover.classList.contains('tempo-popover--open')) positionPopover();
    });
  }

  // ── Update tempo trigger button text/state ───────────────
  // hint: 'slow' | 'medium' | 'fast' | null
  updateTempoTrigger(bpm, locked, hint) {
    const triggerBtn    = document.getElementById('tempo-trigger-btn');
    const bpmSpan       = document.getElementById('tempo-trigger-bpm');
    const hintSpan      = document.getElementById('tempo-trigger-hint');
    const headerLockBtn = document.getElementById('tempo-lock-header-btn');
    if (!triggerBtn || !bpmSpan) return;

    // Capture BPM once when first locking; clear on unlock
    if (locked && bpm != null && this._lockedBpm == null) this._lockedBpm = Math.round(bpm);
    if (!locked) this._lockedBpm = null;

    // Keep lock button lit (handles reset path where bpm becomes null)
    if (headerLockBtn) headerLockBtn.classList.toggle('active', !!locked);

    // Trigger button locked/detecting class
    triggerBtn.classList.toggle('locked', !!locked);
    triggerBtn.classList.toggle('detecting', !locked && bpm != null);

    // Hint label — hidden when locked
    if (hintSpan) {
      const HINT_LABELS = { slow: 'Slow', medium: 'Med', fast: 'Fast' };
      hintSpan.textContent = (hint && !locked) ? (HINT_LABELS[hint] || '') : '';
    }
    triggerBtn.classList.remove('hint-slow', 'hint-medium', 'hint-fast');
    if (hint && !locked) triggerBtn.classList.add(`hint-${hint}`);

    if (locked) {
      // Always show the frozen locked BPM in gold — never replace with '—' after reset
      bpmSpan.textContent = this._lockedBpm ?? '—';
    } else if (bpm != null) {
      const rounded = Math.round(bpm);
      bpmSpan.textContent = rounded;
      // Pulse only when the displayed integer BPM value actually changes
      if (rounded !== this._lastDisplayedBpm) {
        this._lastDisplayedBpm = rounded;
        triggerBtn.classList.remove('pulse');
        void triggerBtn.offsetWidth;
        triggerBtn.classList.add('pulse');
        setTimeout(() => triggerBtn.classList.remove('pulse'), 300);
      }
    } else {
      bpmSpan.textContent = '—';
      this._lastDisplayedBpm = null;
    }
  }

  // ── Slick Resize Animation ─────────────────────────────
  setupWindowResizeAnimation() {
    let isResizing = false;
    let resizeTimeout;

    window.addEventListener('resize', () => {
      if (this.app.settingsWindow?.isOpen() || this.modalOverlay?.classList.contains('open')) return;
      if (!document.startViewTransition) return;

      const grids = [this.sectionGrid, document.querySelector('.modules-grid')].filter(Boolean);
      if (grids.length === 0) return;

      if (!isResizing) {
        isResizing = true;
        // Lock grid widths so they don't visually jump around wildly and jank during drag
        grids.forEach(grid => {
          grid.style.width = `${grid.offsetWidth}px`;
          grid.style.flex = 'none';
        });
      }

      clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(() => {
        document.startViewTransition(() => {
          // Unlock grids to instantly fill the required new layout space, 
          // allowing the View Transition engine to perfectly interpolate the items' flight paths
          grids.forEach(grid => {
            grid.style.width = '';
            grid.style.flex = '';
          });
          isResizing = false;
        });
      }, 250); // wait until they stop dragging completely
    });
  }

  // ── Mode Switching (crossfade) ───────────────────────
  setMode(mode) {
    if (mode !== 'edit' && mode !== 'live' && mode !== 'flow') return;
    const previous = this.currentMode;
    if (previous === mode) return;

    this.currentMode = mode;
    document.getElementById('chord-pads-drawer')?.classList.remove('open');
    document.getElementById('chord-pads-btn')?.classList.remove('active');

    if (previous === 'live' && this.isLiveEditMode) {
      this.isLiveEditMode = false;
      this.liveView.classList.remove('editing-layout');
      if (this.liveEditToggleBtn) {
        this.liveEditToggleBtn.classList.remove('unlocked');
        this.liveEditToggleBtn.innerHTML = '<span class="icon-span"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lock-icon"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span><span class="text-span">LOCKED</span>';
      }
    }

    if (previous === 'edit') this.app.flowRail?.leaveEdit();
    if (previous === 'flow') this.app.flowRail?.leave();

    this._syncModeSwitch(mode);

    const views = { edit: this.editView, live: this.liveView, flow: this.flowView };
    const outgoing = views[previous];
    const incoming = views[mode];
    if (!incoming) return;

    if (outgoing) outgoing.classList.add('mode-exit');

    setTimeout(() => {
      if (outgoing) outgoing.classList.remove('active', 'mode-exit');
      incoming.classList.add('active');
      if (mode === 'live') {
        this.renderLiveMode();
        this.syncLiveModeScroll();
      }
      if (mode === 'edit') {
        this.updateEditContextBar();
        this.app.flowRail?.editPlayhead?.resize();
      }
      if (mode === 'flow') this.app.flowRail?.enter();
    }, 200);
  }

  _syncModeSwitch(mode) {
    this.modeSwitchBtns.forEach(btn => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  syncLiveModeScroll() {
    if (this.presetManager.activeSectionId) {
      const activeEl = document.querySelector(`.section-card[data-section-id="${this.presetManager.activeSectionId}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  // ── Smart DOM Sync (No Full Rebuild) ─────────────────
  syncLiveModeVisuals() {
    // Sync current active song
    if (this.songList) {
      const songs = this.songList.querySelectorAll('.song-item.mappable');
      songs.forEach(li => {
        const targetId = li.dataset.midiTarget;
        if (!targetId) return;
        const id = targetId.split(':')[1];
        if (id === this.presetManager.activeSongId) {
          li.classList.add('active');
        } else {
          li.classList.remove('active');
        }
      });
    }
    // Sync current active/pending section
    if (this.sectionGrid) {
      const cards = this.sectionGrid.querySelectorAll('.section-card.mappable');
      cards.forEach(card => {
        const targetId = card.dataset.midiTarget;
        if (!targetId) return;
        const id = targetId.split(':')[1];
        const isActive = (this.presetManager.activeSectionId === id);
        const isPending = (this.app.pendingSectionChange && this.app.pendingSectionChange.sectionId === id);

        if (isActive) card.classList.add('active');
        else card.classList.remove('active');

        if (isPending) card.classList.add('pending');
        else card.classList.remove('pending');
      });
    }

    // Sync current active/pending section in Edit Mode Arrangement Dashboard too
    if (this.editSectionsList) {
      const cards = this.editSectionsList.querySelectorAll('.edit-section-card');
      cards.forEach(card => {
        const id = card.dataset.sectionId;
        if (!id) return;
        const isActive = (this.presetManager.activeSectionId === id);
        const isPending = (this.app.pendingSectionChange && this.app.pendingSectionChange.sectionId === id);

        if (isActive) card.classList.add('active');
        else card.classList.remove('active');

        if (isPending) card.classList.add('pending');
        else card.classList.remove('pending');
      });
    }
  }

  // ── Edit Mode Context Bar ────────────────────────────
  updateEditContextBar() {
    if (!this.editContextBar) return;

    const songId = this.presetManager.activeSongId;
    const sectionId = this.presetManager.activeSectionId;

    if (!songId) {
      this.editContextBar.style.display = 'none';
      return;
    }

    const song = this.presetManager.getSong(songId);
    if (!song) {
      this.editContextBar.style.display = 'none';
      return;
    }

    // Populate the Song Select dropdown
    this.editContextSong.innerHTML = '';
    this.presetManager.getSongs().forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === song.id) opt.selected = true;
      this.editContextSong.appendChild(opt);
    });

    // Populate vertical sections mini-timeline
    if (this.editSectionsList) {
      this.editSectionsList.innerHTML = '';
      if (song.sections && song.sections.length > 0) {
        song.sections.forEach((sec, index) => {
          const card = document.createElement('div');
          const isActive = (sec.id === sectionId);
          const isPending = (this.app.pendingSectionChange && this.app.pendingSectionChange.sectionId === sec.id);
          card.className = 'edit-section-card' + (isActive ? ' active' : '') + (isPending ? ' pending' : '');
          card.dataset.sectionId = sec.id;
          card.dataset.sectionIndex = String(index);
          if (card.style.hasOwnProperty('viewTransitionName')) {
            card.style.viewTransitionName = `edit-section-${sec.id.replace(/[^a-zA-Z0-9-]/g, "")}`;
          }

          // Drag grip handle
          const grab = document.createElement('div');
          grab.className = 'edit-section-grab';
          grab.innerHTML = `<svg width="8" height="12" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>`;
          card.appendChild(grab);

          // Card info (name + active modules badges)
          const info = document.createElement('div');
          info.className = 'edit-section-info';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'edit-section-name';
          nameSpan.textContent = sec.name;
          info.appendChild(nameSpan);

          const badges = this._buildModuleBadges(sec.state);
          info.appendChild(badges);

          card.appendChild(info);

          // Card hover action buttons
          const actions = document.createElement('div');
          actions.className = 'edit-section-actions';

          const dupBtn = document.createElement('button');
          dupBtn.className = 'edit-sec-action-btn duplicate';
          dupBtn.title = 'Duplicate Section';
          dupBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
          dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.duplicateSection(sec.id);
          });
          actions.appendChild(dupBtn);

          const delBtn = document.createElement('button');
          delBtn.className = 'edit-sec-action-btn delete';
          delBtn.title = 'Delete Section';
          delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.deleteSectionWithConfirm(sec.id);
          });
          actions.appendChild(delBtn);

          card.appendChild(actions);

          // Inline editing double click handler
          const startEditing = () => {
            this._startInlineEdit(nameSpan, sec.name, (newName) => {
              this.presetManager.renameSection(songId, sec.id, newName);
              this.showToast(`Renamed to "${newName}"`);
              this.updateEditContextBar();
              this.renderLiveMode();
            });
          };

          nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startEditing();
          });

          if (this.pendingInlineEditSectionId === sec.id) {
            this.pendingInlineEditSectionId = null;
            setTimeout(() => startEditing(), 10);
          }

          // Card click selects section
          card.addEventListener('click', (e) => {
            if (e.target.closest('.edit-section-grab') || e.target.closest('.edit-section-actions')) return;
            this.app.triggerSectionChange(songId, sec.id);
          });

          this.editSectionsList.appendChild(card);
        });
      } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-sections-msg';
        emptyMsg.style.padding = '1.25rem 0.5rem';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.fontSize = '0.72rem';
        emptyMsg.style.color = 'var(--text-dim)';
        emptyMsg.style.lineHeight = '1.4';
        emptyMsg.textContent = 'No sections in this song. Click "Add Section" below to capture the current active modules & BPM.';
        this.editSectionsList.appendChild(emptyMsg);
      }
    }

    this.editContextBar.style.display = 'flex';

    // Add brief animation to the auto-saved checkmark just to show it updated the UI
    if (this.editSaveStatus) {
      const icon = this.editSaveStatus.querySelector('svg');
      if (icon) {
        icon.style.transform = 'scale(1.2)';
        icon.style.stroke = 'var(--text-primary)';
        icon.style.transition = 'all 0.3s ease';
        setTimeout(() => {
          icon.style.transform = 'scale(1)';
          icon.style.stroke = 'var(--accent-cyan)';
        }, 300);
      }
    }
  }

  // ── Update All Section Badges in Real-Time ────────────
  updateAllSectionBadges() {
    if (!this.editSectionsList) return;
    const activeSongId = this.presetManager.activeSongId;
    if (!activeSongId) return;

    const cards = this.editSectionsList.querySelectorAll('.edit-section-card');
    cards.forEach(card => {
      const sectionId = card.dataset.sectionId;
      if (!sectionId) return;
      const sectionData = this.presetManager.getSectionData(activeSongId, sectionId);
      if (sectionData) {
        const info = card.querySelector('.edit-section-info');
        if (info) {
          // Remove old badges
          const oldBadges = info.querySelector('.section-badges');
          if (oldBadges) oldBadges.remove();

          // Build and append new badges
          const newBadges = this._buildModuleBadges(sectionData);
          info.appendChild(newBadges);
        }
      }
    });
  }

  // ── Calculate Dynamic Module Abbreviations to Resolve Collisions ────
  _calculateDynamicAbbreviations(modules) {
    const items = modules.map(m => {
      const label = m.label || m.type || 'Module';
      const words = label.trim().split(/\s+/);
      const candidates = [];

      // 1. First letter of first word (uppercase)
      const firstLetter = label[0].toUpperCase();
      candidates.push(firstLetter);

      // 2. First letters of words (if > 1 word)
      if (words.length > 1) {
        const wordCaps = words.map(w => w[0].toUpperCase()).join('').substring(0, 2);
        if (wordCaps.length > 1 && !candidates.includes(wordCaps)) {
          candidates.push(wordCaps);
        }
      }

      // 3. First two letters (uppercase, lowercase)
      if (label.length > 1) {
        const twoLetters = label[0].toUpperCase() + label[1].toLowerCase();
        if (!candidates.includes(twoLetters)) {
          candidates.push(twoLetters);
        }
      }

      // 4. First and third letter (uppercase, lowercase)
      if (label.length > 2) {
        const firstThird = label[0].toUpperCase() + label[2].toLowerCase();
        if (!candidates.includes(firstThird)) {
          candidates.push(firstThird);
        }
      }

      return {
        id: m.id,
        label: label,
        candidates: candidates,
        assigned: null
      };
    });

    const used = {};
    const firstLetterCounts = {};
    items.forEach(item => {
      const fl = item.candidates[0];
      firstLetterCounts[fl] = (firstLetterCounts[fl] || 0) + 1;
    });

    // Pass 1: Assign first letters if unique
    items.forEach(item => {
      const fl = item.candidates[0];
      if (firstLetterCounts[fl] === 1) {
        item.assigned = fl;
        used[fl] = true;
      }
    });

    // Pass 2: For remaining items, try to find a unique candidate
    items.forEach(item => {
      if (item.assigned) return;
      for (const cand of item.candidates) {
        if (!used[cand]) {
          item.assigned = cand;
          used[cand] = true;
          return;
        }
      }
      // Pass 3: Fallback to first candidate if all are taken
      item.assigned = item.candidates[0];
    });

    const lookup = {};
    items.forEach(item => {
      lookup[item.id] = item.assigned;
    });
    return lookup;
  }

  // ── Module Badge Builder ─────────────────────────────
  _buildModuleBadges(sectionState) {
    const container = document.createElement('div');
    container.className = 'section-badges';

    if (sectionState && sectionState.modules) {
      // Calculate dynamic abbreviations for collision resolution
      const dynamicAbbrs = this._calculateDynamicAbbreviations(sectionState.modules);

      // v2 format: derive badge from each module entry
      const TYPE_BADGE = {
        bass:     { label: 'B',  color: 'var(--color-bass)' },
        arp:      { label: 'A',  color: 'var(--color-arp)' },
        pad:      { label: 'D',  color: 'var(--color-pad)' }, // 'D' for Drone
        keyboard: { label: 'Kb', color: 'var(--color-keyboard)' },
        swell:    { label: 'Sw', color: 'var(--color-swell)' },
      };
      const PERC_BADGE = {
        'legacy-kick': { label: 'K', color: 'var(--color-kick)' },
        'legacy-snare': { label: 'S', color: 'var(--color-snare)' },
        'legacy-shaker': { label: 'Sh', color: 'var(--color-shaker)' },
      };

      sectionState.modules.forEach(mod => {
        if (!mod.active) return;
        let badge = TYPE_BADGE[mod.type];
        if (!badge && mod.type === 'percussion') {
          badge = PERC_BADGE[mod.id] || { label: mod.label?.[0] ?? 'D', color: 'var(--color-kick)' };
        }
        if (!badge) return;

        // Override label with dynamic abbreviation if available
        const customLabel = dynamicAbbrs[mod.id] || badge.label;

        const dot = document.createElement('span');
        dot.className = 'module-badge';
        dot.textContent = customLabel;
        dot.style.setProperty('--badge-color', badge.color);
        container.appendChild(dot);
      });

    } else if (sectionState) {
      // Legacy v1 flat-format fallback (safety net, should not be reached post-migration)
      this.moduleBadges.forEach(badge => {
        if (sectionState[badge.key]) {
          const dot = document.createElement('span');
          dot.className = 'module-badge';
          dot.textContent = badge.label;
          dot.style.setProperty('--badge-color', badge.color);
          container.appendChild(dot);
        }
      });
    }

    return container;
  }

  // ── Clock Mode Buttons ───────────────────────────────
  _setActiveModeBtn(mode) {
    this.clockModeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  // ── Main Render ──────────────────────────────────────
  renderLiveMode() {
    const songs = this.presetManager.getSongs();
    const activeSongId = this.presetManager.activeSongId;

    // Clean up any mappings for deleted songs/sections
    if (this.app.midiMapping) this.app.midiMapping.cleanupOrphanedMappings();

    // ─── Song List ───
    if (this.songList) {
      this.songList.innerHTML = '';
      if (songs.length === 0) {
        this.songList.innerHTML = '<li class="empty-list">No songs yet.</li>';
      } else {
        songs.forEach(song => {
          const li = document.createElement('li');
          li.className = 'list-item song-item mappable' + (song.id === activeSongId ? ' active' : '');
          li.dataset.midiTarget = `song:${song.id}`;

          const title = document.createElement('span');
          title.className = 'song-item-title';
          title.textContent = song.name;

          // Single click → set active song (or select for MIDI mapping)
          li.addEventListener('click', (e) => {
            // Learn Mode intercept
            if (this.app.midiMapping?.isLearning) {
              if (this.app.midiMapping.handleTargetClick(e, li)) return;
            }
            if (this.presetManager.activeSongId !== song.id) {
              this.presetManager.setActiveSong(song.id);
              if (this.app.applySongSettings) this.app.applySongSettings(song);
              this.renderLiveMode();
            }
          });

          const startSongEditing = () => {
            this._startInlineEdit(title, song.name, (newName) => {
              this.presetManager.renameSong(song.id, newName);
              this.showToast(`Renamed to "${newName}"`);
              this.renderLiveMode();
            });
          };

          // Double-click → inline rename
          li.addEventListener('dblclick', (e) => {
            if (!this.isLiveEditMode) return;
            // Prevent triggering if clicked on item actions like delete button
            if (e.target.closest('.item-actions')) return;
            e.stopPropagation(); // prevent single click bubble
            startSongEditing();
          });

          if (this.pendingInlineEditSongId === song.id) {
            this.pendingInlineEditSongId = null;
            setTimeout(() => startSongEditing(), 10);
          }

          li.appendChild(title);

          if (this.isLiveEditMode) {
            const btnGroup = document.createElement('div');
            btnGroup.className = 'item-actions';

            // Delete btn
            const delBtn = document.createElement('button');
            delBtn.className = 'icon-btn delete-btn';
            delBtn.innerHTML = '&times;';
            delBtn.title = 'Delete Song';
            delBtn.onclick = async (e) => {
              e.stopPropagation();
              if (await this.confirmModal('Delete Song', `Are you sure you want to delete "${song.name}"?`)) {
                this.presetManager.deleteSong(song.id);
                this.showToast('Song deleted');
                const newActiveSongId = this.presetManager.activeSongId;
                const newSong = this.presetManager.getSong(newActiveSongId);
                if (newSong) {
                  if (this.app.applySongSettings) this.app.applySongSettings(newSong);
                }
                this.renderLiveMode();
                this.updateEditContextBar();
              }
            };

            btnGroup.appendChild(delBtn);
            li.appendChild(btnGroup);
          }
          this.songList.appendChild(li);
        });
      }
    }

    // ─── Current Song Context ───
    const activeSong = this.presetManager.getSong(activeSongId);

    if (!activeSong) {
      this.currentSongTitle.textContent = "Select or Create a Song";
      this.liveActions.style.display = 'none';
      if (this.sectionGrid) this.sectionGrid.innerHTML = '<div class="empty-state">No song selected.</div>';
      return;
    }

    this.currentSongTitle.textContent = activeSong.name;
    this.liveActions.style.display = 'flex';
    this._setActiveModeBtn(activeSong.transitionMode || 'flow');

    // ─── Section Grid ───
    if (this.sectionGrid) {
      this.sectionGrid.innerHTML = '';
      if (activeSong.sections.length === 0) {
        this.sectionGrid.innerHTML = '<div class="empty-state">No sections in this song. Save the Edit Mode state as a new section here.</div>';
      } else {
        activeSong.sections.forEach((section, index) => {
          const card = document.createElement('div');
          const isActive = (this.presetManager.activeSectionId === section.id);
          const isPending = (this.app.pendingSectionChange && this.app.pendingSectionChange.sectionId === section.id);
          card.className = 'section-card mappable' + (isActive ? ' active' : '') + (isPending ? ' pending' : '');
          card.dataset.midiTarget = `section:${section.id}`;
          card.style.viewTransitionName = `section-${section.id.replace(/[^a-zA-Z0-9-]/g, "")}`;

          const nameSpan = document.createElement('h3');
          nameSpan.className = 'section-card-name';
          nameSpan.textContent = section.name;

          const startEditing = () => {
            this._startInlineEdit(nameSpan, section.name, (newName) => {
              this.presetManager.renameSection(activeSong.id, section.id, newName);
              this.showToast(`Renamed to "${newName}"`);
              this.renderLiveMode();
            });
          };

          // Double-click → inline rename section
          nameSpan.addEventListener('dblclick', (e) => {
            if (!this.isLiveEditMode) return;
            e.stopPropagation();
            startEditing();
          });

          if (this.pendingInlineEditSectionId === section.id) {
            this.pendingInlineEditSectionId = null;
            // Delay slightly to ensure element is in DOM
            setTimeout(() => startEditing(), 10);
          }

          // Module badges
          const badges = this._buildModuleBadges(section.state);

          const delBtn = document.createElement('button');
          delBtn.className = 'section-delete-btn-top icon-btn';
          delBtn.innerHTML = '&times;';
          delBtn.title = 'Delete Section';
          delBtn.onclick = async (e) => {
            e.stopPropagation();
            if (await this.confirmModal('Delete Section', `Are you sure you want to delete "${section.name}"?`)) {
              this.presetManager.deleteSection(activeSong.id, section.id);
              this.showToast('Section deleted');
              this.renderLiveMode();
            }
          };

          // Drag handle (only visible in live-edit/unlocked mode)
          if (this.isLiveEditMode) {
            const dragHandle = document.createElement('div');
            dragHandle.className = 'section-drag-handle';
            dragHandle.title = 'Drag to reorder';
            dragHandle.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>';
            card.appendChild(dragHandle);
          }

          card.appendChild(nameSpan);
          card.appendChild(badges);
          if (this.isLiveEditMode) {
            card.appendChild(delBtn);
          }

          // Store section index for drag reorder
          card.dataset.sectionIndex = String(index);

          card.addEventListener('click', (e) => {
            // Learn Mode intercept
            if (this.app.midiMapping?.isLearning) {
              if (this.app.midiMapping.handleTargetClick(e, card)) return;
            }
            // Don't trigger section change if drag handle was clicked
            if (e.target.closest('.section-drag-handle')) return;
            this.app.triggerSectionChange(activeSong.id, section.id);
          });

          this.sectionGrid.appendChild(card);
        });
      }
    }

    // Refresh mappable visuals for Learn Mode highlights
    if (this.app.midiMapping?.isLearning) {
      this.app.midiMapping.updateMappableVisuals();
    }

    // Also sync the edit context bar in Edit Mode
    if (this.currentMode === 'edit') {
      this.updateEditContextBar();
    }
  }

  // ── Section Card Drag & Drop ──────────────────────────

  _initSectionDragDrop() {
    if (!this.sectionGrid) return;
    this.sectionGrid.addEventListener('pointerdown', (e) => {
      if (!this.isLiveEditMode) return;
      const handle = e.target.closest('.section-drag-handle');
      if (!handle) return;
      const card = handle.closest('.section-card');
      if (!card) return;
      this._startSectionDrag(e, card);
    });
  }

  _startSectionDrag(e, cardEl) {
    e.preventDefault();
    const rect = cardEl.getBoundingClientRect();

    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('section-drag-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);

    cardEl.classList.add('is-dragging');

    // Cache grid and card rects once — they don't change during the drag
    const cachedGridRect = this.sectionGrid.getBoundingClientRect();
    const cachedCards = [...this.sectionGrid.querySelectorAll('.section-card:not(.is-dragging)')]
      .map(card => ({ card, rect: card.getBoundingClientRect() }));

    this._sectionDrag = {
      sectionIndex: parseInt(cardEl.dataset.sectionIndex, 10),
      cardEl,
      ghost,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      currentTargetCard: null,
      currentTargetIndex: null,
      cachedGridRect,
      cachedCards,
    };

    this._sectionDrag.boundMove = this._onSectionDragMove.bind(this);
    this._sectionDrag.boundUp = this._onSectionDragEnd.bind(this);
    this._sectionDrag.boundCancel = this._cleanupSectionDrag.bind(this);

    document.addEventListener('pointermove', this._sectionDrag.boundMove);
    document.addEventListener('pointerup', this._sectionDrag.boundUp);
    document.addEventListener('pointercancel', this._sectionDrag.boundCancel);
  }

  _onSectionDragMove(e) {
    const d = this._sectionDrag;
    if (!d) return;

    d.ghost.style.left = (e.clientX - d.offsetX) + 'px';
    d.ghost.style.top = (e.clientY - d.offsetY) + 'px';

    const targetCard = this._findSectionDropTarget(e.clientX, e.clientY);
    if (targetCard === d.currentTargetCard) return;

    if (d.currentTargetCard) {
      d.currentTargetCard.classList.remove('is-drop-target');
    }

    d.currentTargetCard = targetCard;

    if (targetCard) {
      targetCard.classList.add('is-drop-target');
      d.currentTargetIndex = parseInt(targetCard.dataset.sectionIndex, 10);
    } else {
      d.currentTargetIndex = null;
    }
  }

  _findSectionDropTarget(clientX, clientY) {
    const { cachedGridRect, cachedCards } = this._sectionDrag;

    if (clientX < cachedGridRect.left || clientX > cachedGridRect.right ||
      clientY < cachedGridRect.top || clientY > cachedGridRect.bottom) {
      return null;
    }

    for (const { card, rect } of cachedCards) {
      if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
        return card;
      }
    }

    // Between cards — return nearest by center distance
    let best = null;
    let bestDist = Infinity;
    for (const { card, rect } of cachedCards) {
      const dist = Math.hypot(clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2));
      if (dist < bestDist) { bestDist = dist; best = card; }
    }
    return best;
  }

  _onSectionDragEnd(e) {
    const d = this._sectionDrag;
    if (!d) return;

    const fromIndex = d.sectionIndex;
    const toIndex = d.currentTargetIndex;

    this._cleanupSectionDrag();

    if (toIndex === null || fromIndex === toIndex) return;

    const activeSongId = this.presetManager.activeSongId;
    if (!activeSongId) return;

    const reordered = this.presetManager.reorderSections(activeSongId, fromIndex, toIndex);
    if (reordered) {
      this.renderLiveMode();
    }
  }

  _cleanupSectionDrag() {
    const d = this._sectionDrag;
    if (!d) return;

    document.removeEventListener('pointermove', d.boundMove);
    document.removeEventListener('pointerup', d.boundUp);
    document.removeEventListener('pointercancel', d.boundCancel);

    d.ghost.remove();

    if (d.currentTargetCard) {
      d.currentTargetCard.classList.remove('is-drop-target');
    }

    d.cardEl.classList.remove('is-dragging');

    this._sectionDrag = null;
  }

  // ── Edit Mode Vertical Section Card Drag & Drop ─────────

  _initEditSectionDragDrop() {
    if (!this.editSectionsList) return;
    this.editSectionsList.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.edit-section-grab');
      if (!handle) return;
      const card = handle.closest('.edit-section-card');
      if (!card) return;
      this._startEditSectionDrag(e, card);
    });
  }

  _startEditSectionDrag(e, cardEl) {
    e.preventDefault();
    const rect = cardEl.getBoundingClientRect();

    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('edit-section-drag-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);

    cardEl.classList.add('is-dragging');

    // Cache list and card rects once — they don't change during the drag
    const cachedListRect = this.editSectionsList.getBoundingClientRect();
    const cachedCards = [...this.editSectionsList.querySelectorAll('.edit-section-card:not(.is-dragging)')]
      .map(card => ({ card, rect: card.getBoundingClientRect() }));

    this._editSectionDrag = {
      sectionIndex: parseInt(cardEl.dataset.sectionIndex, 10),
      cardEl,
      ghost,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      currentTargetCard: null,
      currentTargetIndex: null,
      cachedListRect,
      cachedCards,
    };

    this._editSectionDrag.boundMove = this._onEditSectionDragMove.bind(this);
    this._editSectionDrag.boundUp = this._onEditSectionDragEnd.bind(this);
    this._editSectionDrag.boundCancel = this._cleanupEditSectionDrag.bind(this);

    document.addEventListener('pointermove', this._editSectionDrag.boundMove);
    document.addEventListener('pointerup', this._editSectionDrag.boundUp);
    document.addEventListener('pointercancel', this._editSectionDrag.boundCancel);
  }

  _onEditSectionDragMove(e) {
    const d = this._editSectionDrag;
    if (!d) return;

    d.ghost.style.left = (e.clientX - d.offsetX) + 'px';
    d.ghost.style.top = (e.clientY - d.offsetY) + 'px';

    const targetCard = this._findEditSectionDropTarget(e.clientX, e.clientY);
    if (targetCard === d.currentTargetCard) return;

    if (d.currentTargetCard) {
      d.currentTargetCard.classList.remove('is-drop-target');
    }

    d.currentTargetCard = targetCard;

    if (targetCard) {
      targetCard.classList.add('is-drop-target');
      d.currentTargetIndex = parseInt(targetCard.dataset.sectionIndex, 10);
    } else {
      d.currentTargetIndex = null;
    }
  }

  _findEditSectionDropTarget(clientX, clientY) {
    const { cachedListRect, cachedCards } = this._editSectionDrag;

    if (clientX < cachedListRect.left || clientX > cachedListRect.right ||
      clientY < cachedListRect.top || clientY > cachedListRect.bottom) {
      return null;
    }

    for (const { card, rect } of cachedCards) {
      if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
        return card;
      }
    }

    // Between cards — return nearest by center distance
    let best = null;
    let bestDist = Infinity;
    for (const { card, rect } of cachedCards) {
      const dist = Math.hypot(clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2));
      if (dist < bestDist) { bestDist = dist; best = card; }
    }
    return best;
  }

  _onEditSectionDragEnd(e) {
    const d = this._editSectionDrag;
    if (!d) return;

    const fromIndex = d.sectionIndex;
    const toIndex = d.currentTargetIndex;

    this._cleanupEditSectionDrag();

    if (toIndex === null || fromIndex === toIndex) return;

    const activeSongId = this.presetManager.activeSongId;
    if (!activeSongId) return;

    const reordered = this.presetManager.reorderSections(activeSongId, fromIndex, toIndex);
    if (reordered) {
      this.updateEditContextBar();
      this.renderLiveMode();
    }
  }

  _cleanupEditSectionDrag() {
    const d = this._editSectionDrag;
    if (!d) return;

    document.removeEventListener('pointermove', d.boundMove);
    document.removeEventListener('pointerup', d.boundUp);
    document.removeEventListener('pointercancel', d.boundCancel);

    d.ghost.remove();

    if (d.currentTargetCard) {
      d.currentTargetCard.classList.remove('is-drop-target');
    }

    d.cardEl.classList.remove('is-dragging');

    this._editSectionDrag = null;
  }
}

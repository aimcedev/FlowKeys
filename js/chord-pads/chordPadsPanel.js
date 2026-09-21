// Note names for mini piano labels and display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEY_POSITIONS = new Set([1, 3, 6, 8, 10]); // index within octave

export class ChordPadsPanel {
  constructor(chordPads, midiMapping) {
    this.chordPads = chordPads;
    this.midiMapping = midiMapping;

    this.drawer = document.getElementById('chord-pads-drawer');
    this.content = this.drawer?.querySelector('.cp-drawer-content');
    this.editToggleBtn = document.getElementById('cp-edit-toggle-btn');
    this.mapBtn = document.getElementById('cp-map-btn');
    this.closeBtn = document.getElementById('close-chord-pads-btn');

    this.isEditMode = false;
    this.selectedPadIndex = null;
    // Chord-pads-local mapping mode — does NOT set body.is-learning
    this.isChordPadMapping = false;

    this.closeBtn?.addEventListener('click', () => this.close());
    this.editToggleBtn?.addEventListener('click', () => this._toggleEditMode());

    // MIDI Map button — local chord-pads-only mapping mode
    this.mapBtn?.addEventListener('click', () => {
      if (this.isChordPadMapping) {
        this._deactivateMapping();
      } else {
        this._activateMapping();
      }
    });

    // When chordPads state changes (from external triggers), re-render pad states
    this.chordPads.onPadsChanged = () => this._updatePadGrid();

    // Live-refresh binding labels during mapping mode whenever a mapping changes
    this.midiMapping.onMappingsChanged = () => {
      if (this.isChordPadMapping) this._refreshBindingLabels();
    };

    this.render();
  }

  // ── Open / Close ───────────────────────────────────────────────────────────

  toggle(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : !this.isOpen();
    shouldOpen ? this.open() : this.close();
  }

  open() {
    if (!this.drawer) return;
    this.drawer.classList.add('open');
    document.getElementById('chord-pads-btn')?.classList.add('active');
    document.querySelector('.app-container')?.classList.add('drawer-open');
    this.render();
  }

  close() {
    if (!this.drawer) return;
    if (this.isChordPadMapping) this._deactivateMapping();
    this.drawer.classList.remove('open');
    document.getElementById('chord-pads-btn')?.classList.remove('active');
    const settingsOpen = document.getElementById('midi-mapping-drawer')?.classList.contains('open');
    if (!settingsOpen) {
      document.querySelector('.app-container')?.classList.remove('drawer-open');
    }
  }

  isOpen() {
    return this.drawer?.classList.contains('open') ?? false;
  }

  // ── Chord-pads-local mapping mode ──────────────────────────────────────────
  // Sets midiMapping.isLearning directly — does NOT add body.is-learning,
  // so global pointer-events CSS doesn't fire and only pads are highlighted.

  _activateMapping() {
    this.isChordPadMapping = true;
    this.midiMapping.isLearning = true;
    this.midiMapping.clearSelection();
    this.mapBtn?.classList.add('active');
    // Full render so delete buttons appear on already-mapped pads immediately
    this.render();
    this.midiMapping.updateMappableVisuals();
  }

  _deactivateMapping() {
    this.isChordPadMapping = false;
    this.midiMapping.isLearning = false;
    this.midiMapping.clearSelection();
    this.mapBtn?.classList.remove('active');
    this._applyMappingHighlights(false);
    this.render(); // refresh binding labels after mapping session
  }

  // ── Full render ────────────────────────────────────────────────────────────

  render() {
    if (!this.content) return;
    this.content.innerHTML = '';
    this.content.appendChild(this._buildControls());
    this.content.appendChild(this._buildPadGrid());
    if (this.isEditMode) {
      this.content.appendChild(this._buildEditSection());
    }
    // Restore mapping highlights if still in mapping mode after re-render
    if (this.isChordPadMapping) {
      this._applyMappingHighlights(true);
    }
  }

  // ── Partial update: just refresh pad states without full re-render ─────────

  _updatePadGrid() {
    const grid = this.content?.querySelector('.cp-pad-grid');
    if (!grid) { this.render(); return; }

    this.chordPads.pads.forEach((pad, i) => {
      const btn = grid.querySelector(`.cp-pad[data-index="${i}"]`);
      if (!btn) return;
      btn.querySelector('.cp-pad-name').textContent = pad.name;
      btn.classList.toggle('active', pad.isActive);
      btn.classList.toggle('has-chord', pad.notes.length > 0);
      btn.classList.toggle('selected', this.isEditMode && this.selectedPadIndex === i);
    });

    if (this.isEditMode && this.selectedPadIndex !== null) {
      this._refreshMiniPianoHighlights();
    }
  }

  // ── Controls row ───────────────────────────────────────────────────────────
  // Layout: [Channel + Hold] on one row, Velocity slider, Humanize slider

  _buildControls() {
    const wrap = document.createElement('div');
    wrap.className = 'cp-controls-row';

    // Top row: Channel select + Hold toggle side by side
    const topRow = document.createElement('div');
    topRow.className = 'cp-controls-top';

    // MIDI Channel
    const chanGroup = document.createElement('div');
    chanGroup.className = 'cp-control-group';
    chanGroup.innerHTML = `<label>Channel</label>
      <select class="cp-select" id="cp-channel-select">${this._channelOptions()}</select>`;
    chanGroup.querySelector('select').value = this.chordPads.channel;
    chanGroup.querySelector('select').addEventListener('change', (e) => {
      this.chordPads.channel = parseInt(e.target.value, 10);
    });

    // Hold (smart sustain) toggle — MIDI-mappable via chordPadSustain target
    const susGroup = document.createElement('div');
    susGroup.className = 'cp-control-group cp-sustain-group cp-hold-group';
    susGroup.dataset.midiTarget = 'chordPadSustain';
    const susChecked = this.chordPads.smartSustain ? 'checked' : '';
    susGroup.innerHTML = `<label for="cp-sustain">Hold</label>
      <label class="toggle-switch">
        <input type="checkbox" id="cp-sustain" ${susChecked}>
        <span class="slider"></span>
      </label>`;

    // Show binding label (with delete button in mapping mode) if Hold is already mapped
    const holdLabel = this._getStaticMappingLabel('chordPadSustain');
    if (holdLabel) {
      susGroup.appendChild(this._buildBindLabel('chordPadSustain', holdLabel));
    }

    // In chord-pads mapping mode, clicking Hold selects it for mapping
    susGroup.addEventListener('mousedown', (e) => {
      if (this.isChordPadMapping) {
        e.preventDefault();
        e.stopPropagation();
        this.midiMapping.selectTarget('chordPadSustain', susGroup);
      }
    });

    susGroup.querySelector('input').addEventListener('change', (e) => {
      if (this.isChordPadMapping) { e.preventDefault(); return; }
      this.chordPads.smartSustain = e.target.checked;
      if (!e.target.checked) this.chordPads.stopAll();
    });

    topRow.appendChild(chanGroup);
    topRow.appendChild(susGroup);

    // Velocity slider
    const velGroup = document.createElement('div');
    velGroup.className = 'cp-control-group';
    velGroup.innerHTML = `<label>Velocity</label>
      <div class="cp-slider-row">
        <input type="range" class="cp-slider" id="cp-velocity" min="1" max="127" value="${this.chordPads.velocity}">
        <span class="cp-slider-val" id="cp-vel-val">${this.chordPads.velocity}</span>
      </div>`;
    velGroup.querySelector('input').addEventListener('input', (e) => {
      this.chordPads.velocity = parseInt(e.target.value, 10);
      velGroup.querySelector('#cp-vel-val').textContent = e.target.value;
    });

    // Humanize slider
    const humGroup = document.createElement('div');
    humGroup.className = 'cp-control-group';
    humGroup.innerHTML = `<label>Humanize</label>
      <div class="cp-slider-row">
        <input type="range" class="cp-slider" id="cp-humanize" min="0" max="100" value="${this.chordPads.humanizeAmount}">
        <span class="cp-slider-val" id="cp-hum-val">${this.chordPads.humanizeAmount}</span>
      </div>`;
    humGroup.querySelector('input').addEventListener('input', (e) => {
      this.chordPads.humanizeAmount = parseInt(e.target.value, 10);
      humGroup.querySelector('#cp-hum-val').textContent = e.target.value;
    });

    wrap.appendChild(topRow);
    wrap.appendChild(velGroup);
    wrap.appendChild(humGroup);
    return wrap;
  }

  _channelOptions() {
    let html = '';
    for (let i = 1; i <= 16; i++) {
      html += `<option value="${i}">${i}</option>`;
    }
    return html;
  }

  // ── Pad grid ───────────────────────────────────────────────────────────────

  _buildPadGrid() {
    const grid = document.createElement('div');
    grid.className = 'cp-pad-grid';

    this.chordPads.pads.forEach((pad, i) => {
      grid.appendChild(this._buildPad(pad, i));
    });

    return grid;
  }

  _buildPad(pad, i) {
    const btn = document.createElement('div');
    btn.className = 'cp-pad';
    btn.dataset.index = i;
    btn.dataset.midiTarget = `chordPad:${i}`;

    if (pad.notes.length > 0) btn.classList.add('has-chord');
    if (pad.isActive) btn.classList.add('active');
    if (this.isEditMode && this.selectedPadIndex === i) btn.classList.add('selected');

    const nameEl = document.createElement('span');
    nameEl.className = 'cp-pad-name';
    nameEl.textContent = pad.name;
    btn.appendChild(nameEl);

    const mappingLabel = this._getMappingLabel(i);
    if (mappingLabel) {
      btn.appendChild(this._buildBindLabel(`chordPad:${i}`, mappingLabel));
    }

    btn.addEventListener('mousedown', (e) => {
      if (this.isChordPadMapping) {
        e.stopPropagation();
        this.midiMapping.selectTarget(`chordPad:${i}`, btn);
        return;
      }
      if (this.isEditMode) {
        this._selectPad(i);
      } else {
        this.chordPads.triggerPadDown(i);
      }
    });

    btn.addEventListener('mouseup', () => {
      if (!this.isEditMode && !this.isChordPadMapping) {
        this.chordPads.triggerPadUp(i);
      }
    });

    btn.addEventListener('mouseleave', () => {
      if (!this.isEditMode && !this.isChordPadMapping) {
        this.chordPads.triggerPadUp(i);
      }
    });

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.isChordPadMapping) {
        this.midiMapping.selectTarget(`chordPad:${i}`, btn);
        return;
      }
      if (this.isEditMode) {
        this._selectPad(i);
      } else {
        this.chordPads.triggerPadDown(i);
      }
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!this.isEditMode && !this.isChordPadMapping) {
        this.chordPads.triggerPadUp(i);
      }
    }, { passive: false });

    return btn;
  }

  _getMappingLabel(padIndex) {
    return this._getStaticMappingLabel(`chordPad:${padIndex}`);
  }

  _getStaticMappingLabel(targetId) {
    const m = this.midiMapping.mappings.find(m => m.targetId === targetId);
    if (!m) return null;
    if (m.type === 'key') return `Key:${this.midiMapping.formatKeyCode(m.key)}`;
    const typeStr = m.type === 'note' ? 'N' : 'CC';
    return `Ch${m.channel} ${typeStr}${m.data1}`;
  }

  // Builds a binding label span, with a delete "×" button when in mapping mode
  _buildBindLabel(targetId, labelText) {
    const bindEl = document.createElement('span');
    bindEl.className = 'cp-pad-bind';
    bindEl.textContent = labelText;

    if (this.isChordPadMapping) {
      const delBtn = document.createElement('button');
      delBtn.className = 'cp-pad-bind-del';
      delBtn.textContent = '×';
      delBtn.title = 'Remove mapping';
      delBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const idx = this.midiMapping.mappings.findIndex(m => m.targetId === targetId);
        if (idx >= 0) this.midiMapping.deleteMapping(idx);
      });
      bindEl.appendChild(delBtn);
    }
    return bindEl;
  }

  // Refreshes all binding labels in-place without a full re-render (used during mapping mode)
  _refreshBindingLabels() {
    if (!this.content) return;

    // Pads
    this.chordPads.pads.forEach((pad, i) => {
      const btn = this.content.querySelector(`.cp-pad[data-index="${i}"]`);
      if (!btn) return;
      btn.querySelector('.cp-pad-bind')?.remove();
      const label = this._getMappingLabel(i);
      if (label) btn.appendChild(this._buildBindLabel(`chordPad:${i}`, label));
    });

    // Hold / Sustain control
    const holdGroup = this.content.querySelector('.cp-hold-group');
    if (holdGroup) {
      holdGroup.querySelector('.cp-pad-bind')?.remove();
      const holdLabel = this._getStaticMappingLabel('chordPadSustain');
      if (holdLabel) holdGroup.appendChild(this._buildBindLabel('chordPadSustain', holdLabel));
    }

    this.midiMapping.updateMappableVisuals();
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  _toggleEditMode() {
    this.isEditMode = !this.isEditMode;
    if (this.editToggleBtn) {
      this.editToggleBtn.textContent = this.isEditMode ? 'Done' : 'Edit Pads';
      this.editToggleBtn.classList.toggle('active', this.isEditMode);
    }
    if (!this.isEditMode) {
      this.selectedPadIndex = null;
      this.chordPads.stopAll();
    }
    this.render();
  }

  _selectPad(index) {
    this.selectedPadIndex = index;
    this.render();
    this.chordPads.stopAll();
    this.chordPads.triggerPadDown(index);
    setTimeout(() => this.chordPads.stopAll(), 800);
  }

  // ── Edit section (below pad grid) ──────────────────────────────────────────

  _buildEditSection() {
    const section = document.createElement('div');
    section.className = 'cp-edit-section';

    if (this.selectedPadIndex === null) {
      section.innerHTML = '<p class="cp-edit-hint">Tap a pad to edit it</p>';
      section.appendChild(this._buildPadManagementRow());
      return section;
    }

    const pad = this.chordPads.pads[this.selectedPadIndex];

    const nameRow = document.createElement('div');
    nameRow.className = 'cp-edit-row';
    nameRow.innerHTML = `<label>Name</label>
      <input type="text" class="cp-name-input" value="${this._escapeHtml(pad.name)}" maxlength="12" placeholder="Pad name">`;
    nameRow.querySelector('input').addEventListener('input', (e) => {
      this.chordPads.setPadName(this.selectedPadIndex, e.target.value);
      const padEl = this.content.querySelector(`.cp-pad[data-index="${this.selectedPadIndex}"] .cp-pad-name`);
      if (padEl) padEl.textContent = e.target.value || (this.selectedPadIndex + 1).toString();
    });

    const notesInfo = document.createElement('div');
    notesInfo.className = 'cp-notes-info';
    notesInfo.textContent = `${pad.notes.length} note${pad.notes.length !== 1 ? 's' : ''} — click keys to add/remove`;

    const piano = this._buildMiniPiano();
    const mgmt = this._buildPadManagementRow();

    section.appendChild(nameRow);
    section.appendChild(notesInfo);
    section.appendChild(piano);
    section.appendChild(mgmt);
    return section;
  }

  _buildPadManagementRow() {
    const row = document.createElement('div');
    row.className = 'cp-mgmt-row';

    const addBtn = document.createElement('button');
    addBtn.className = 'cp-action-btn';
    addBtn.textContent = '+ Add Pad';
    addBtn.addEventListener('click', () => {
      this.chordPads.addPad();
      this.render();
    });

    row.appendChild(addBtn);

    if (this.selectedPadIndex !== null) {
      const delBtn = document.createElement('button');
      delBtn.className = 'cp-action-btn cp-delete-btn';
      delBtn.textContent = 'Delete Pad';
      delBtn.addEventListener('click', () => {
        this.chordPads.removePad(this.selectedPadIndex);
        this.selectedPadIndex = null;
        this.render();
      });
      row.appendChild(delBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'cp-action-btn';
      clearBtn.textContent = 'Clear Notes';
      clearBtn.addEventListener('click', () => {
        this.chordPads.setPadNotes(this.selectedPadIndex, []);
        this._refreshMiniPianoHighlights();
        const notesInfo = this.content?.querySelector('.cp-notes-info');
        if (notesInfo) notesInfo.textContent = '0 notes — click keys to add/remove';
      });
      row.appendChild(clearBtn);
    }

    return row;
  }

  // ── Mini piano ─────────────────────────────────────────────────────────────

  _buildMiniPiano() {
    const container = document.createElement('div');
    container.className = 'cp-mini-piano-wrap';

    const piano = document.createElement('div');
    piano.className = 'cp-mini-piano';

    const startOctave = 1;
    const endOctave = 5;

    for (let oct = startOctave; oct <= endOctave; oct++) {
      const octGroup = document.createElement('div');
      octGroup.className = 'cp-octave';

      const whiteOrder = [0, 2, 4, 5, 7, 9, 11];
      const blackSlots = [
        { after: 0, semitone: 1 },
        { after: 1, semitone: 3 },
        { after: 3, semitone: 6 },
        { after: 4, semitone: 8 },
        { after: 5, semitone: 10 },
      ];

      const whiteKeys = document.createElement('div');
      whiteKeys.className = 'cp-white-keys';

      whiteOrder.forEach((semitone) => {
        const midi = (oct + 1) * 12 + semitone;
        const key = document.createElement('div');
        key.className = 'cp-key-white';
        key.dataset.midi = midi;
        if (this._noteInSelectedPad(midi)) key.classList.add('cp-key-active');
        if (semitone === 0) {
          const label = document.createElement('span');
          label.className = 'cp-key-label';
          label.textContent = `C${oct}`;
          key.appendChild(label);
        }
        key.addEventListener('mousedown', (e) => { e.preventDefault(); this._onPianoKey(midi, key); });
        key.addEventListener('touchstart', (e) => { e.preventDefault(); this._onPianoKey(midi, key); }, { passive: false });
        whiteKeys.appendChild(key);
      });

      const blackKeys = document.createElement('div');
      blackKeys.className = 'cp-black-keys';

      blackSlots.forEach(({ after, semitone }) => {
        const midi = (oct + 1) * 12 + semitone;
        const key = document.createElement('div');
        key.className = 'cp-key-black';
        key.dataset.midi = midi;
        key.style.left = `${(after + 1) * (100 / 7) - (100 / 14)}%`;
        if (this._noteInSelectedPad(midi)) key.classList.add('cp-key-active');
        key.addEventListener('mousedown', (e) => { e.preventDefault(); this._onPianoKey(midi, key); });
        key.addEventListener('touchstart', (e) => { e.preventDefault(); this._onPianoKey(midi, key); }, { passive: false });
        blackKeys.appendChild(key);
      });

      octGroup.appendChild(whiteKeys);
      octGroup.appendChild(blackKeys);
      piano.appendChild(octGroup);
    }

    container.appendChild(piano);
    return container;
  }

  _noteInSelectedPad(midiNote) {
    if (this.selectedPadIndex === null) return false;
    const pad = this.chordPads.pads[this.selectedPadIndex];
    return pad ? pad.notes.includes(midiNote) : false;
  }

  _onPianoKey(midiNote, keyEl) {
    if (this.selectedPadIndex === null) return;
    this.chordPads.toggleNoteInPad(this.selectedPadIndex, midiNote);
    keyEl.classList.toggle('cp-key-active', this._noteInSelectedPad(midiNote));

    this.chordPads.midi.sendNoteOn(this.chordPads.channel, midiNote, this.chordPads.velocity);
    setTimeout(() => this.chordPads.midi.sendNoteOff(this.chordPads.channel, midiNote), 300);

    const notesInfo = this.content?.querySelector('.cp-notes-info');
    if (notesInfo) {
      const count = this.chordPads.pads[this.selectedPadIndex].notes.length;
      notesInfo.textContent = `${count} note${count !== 1 ? 's' : ''} — click keys to add/remove`;
    }
  }

  _refreshMiniPianoHighlights() {
    const piano = this.content?.querySelector('.cp-mini-piano');
    if (!piano) return;
    piano.querySelectorAll('[data-midi]').forEach(key => {
      const midi = parseInt(key.dataset.midi, 10);
      key.classList.toggle('cp-key-active', this._noteInSelectedPad(midi));
    });
  }

  // ── Mapping highlights (local to chord pads only) ──────────────────────────

  _applyMappingHighlights(active) {
    if (!this.content) return;
    this.content.querySelectorAll('.cp-pad').forEach(btn => {
      btn.classList.toggle('mappable', active);
    });
    const holdGroup = this.content.querySelector('.cp-hold-group');
    if (holdGroup) holdGroup.classList.toggle('mappable', active);
  }

  // Called by app.js when the SETTINGS drawer's learn mode changes
  activateMappingHighlights() {
    this._applyMappingHighlights(true);
    this.mapBtn?.classList.add('active');
  }

  deactivateMappingHighlights() {
    this._applyMappingHighlights(false);
    this.mapBtn?.classList.remove('active');
    this.render();
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  _escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

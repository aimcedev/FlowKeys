export class MidiMappingManager {
  constructor(performActionCallback, presetManager) {
    this.mappings = [];
    this.isLearning = false;
    this.selectedTargetId = null;
    this.selectedTargetElement = null;
    
    // Callback provided by App to execute mapped actions
    this.performAction = performActionCallback;
    // Optional callback for note-off release events (used by chord pads momentary mode)
    this.releaseCallback = null;
    // Optional callback fired when learn mode turns on/off — used to sync external UI
    this.onLearnModeChange = null;
    // Optional callback fired after any mapping is added or deleted
    this.onMappingsChanged = null;
    this.presetManager = presetManager;

    // UI Elements
    this.drawer = document.getElementById('midi-mapping-drawer');
    this.learnToggle = document.getElementById('mapping-learn-toggle');
    this.inputDeviceSelect = document.getElementById('mapping-input-device');
    this.mappingList = document.getElementById('mapping-list');
    this.learnInstructions = document.getElementById('learn-instructions');
    
    // Human-readable names for static targets
    this.targetNames = {
      'tapTempo': 'Tap Tempo',
      'panic': 'Panic (All Notes Off)',
      'toggleBass': 'Toggle Bass',
      'toggleArp': 'Toggle Arp',
      'togglePad': 'Toggle Pad',
      'toggleShaker': 'Toggle Shaker',
      'toggleKick': 'Toggle Kick',
      'toggleSnare': 'Toggle Snare',
      'nextSection': 'Next Section',
      'prevSection': 'Previous Section',
      'toggleLiveEdit': 'Toggle Live Edit Lock',
      'toggleFlowConfigure': 'Toggle Flow Rail Editor',
      'flowRailSource': 'Flow Rail Source',
      'setModeEdit': 'Mode: Edit',
      'setModeFlow': 'Mode: Flow',
      'setModeLive': 'Mode: Live',
      'saveToSection': 'Save to Active Section',
      // Tempo Tracker
      'tempoHintSlow':   'Tempo Tracker: Slow Hint',
      'tempoHintMedium': 'Tempo Tracker: Med Hint',
      'tempoHintFast':   'Tempo Tracker: Fast Hint',
      'tempoReset':      'Tempo Tracker: Reset',
      'tempoLock':       'Tempo Tracker: Lock',
      'tempoTrigger':    'Tempo Tracker: Open/Close',
      // Chord Pads
      'chordPadSustain': 'Chord Pad: Hold/Sustain',
    };

    this.init();
  }

  init() {
    this.loadState();
    
    // Listeners
    if (this.learnToggle) {
      this.learnToggle.addEventListener('change', (e) => {
        this.setLearnMode(e.target.checked);
      });
    }

    if (this.inputDeviceSelect) {
      this.inputDeviceSelect.addEventListener('change', (e) => {
        this.saveState();
      });
    }

    // Close button
    const closeBtn = document.getElementById('close-mapping-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleDrawer(false));
    }
    
    this.renderList();
  }

  toggleDrawer(forceOpen) {
    const _isAnyDrawerOpen = () =>
      document.getElementById('chord-pads-drawer')?.classList.contains('open') ||
      document.getElementById('midi-mapping-drawer')?.classList.contains('open');

    const applyDrawerState = () => {
      const appContainer = document.querySelector('.app-container');

      if (forceOpen === undefined) {
        const isOpening = !this.drawer.classList.contains('open');
        this.drawer.classList.toggle('open');
        if (isOpening) {
          if (appContainer) appContainer.classList.add('drawer-open');
        } else {
          if (!_isAnyDrawerOpen() && appContainer) appContainer.classList.remove('drawer-open');
          this.setLearnMode(false);
        }
      } else {
        if (forceOpen) {
          this.drawer.classList.add('open');
          if (appContainer) appContainer.classList.add('drawer-open');
        } else {
          this.drawer.classList.remove('open');
          if (!_isAnyDrawerOpen() && appContainer) appContainer.classList.remove('drawer-open');
          this.setLearnMode(false); // turn off learn mode when closing
        }
      }
    };

    if (document.startViewTransition) {
      document.startViewTransition(() => applyDrawerState());
    } else {
      applyDrawerState();
    }
  }

  isOpen() {
    return this.drawer.classList.contains('open');
  }

  setLearnMode(active) {
    this.isLearning = active;
    if (this.learnToggle) this.learnToggle.checked = active;

    if (active) {
      document.body.classList.add('is-learning');
      this.learnInstructions.style.display = 'block';
      this.learnInstructions.textContent = 'Select a control to map...';
      this.updateMappableVisuals();
    } else {
      document.body.classList.remove('is-learning');
      this.learnInstructions.style.display = 'none';
      this.clearSelection();
    }

    if (this.onLearnModeChange) this.onLearnModeChange(active);
  }

  handleTargetClick(event, element) {
    if (!this.isLearning) return false;
    
    // Prevent default action (e.g. toggling the module) because we are just selecting it
    event.preventDefault();
    event.stopPropagation();

    // The target ID could be right on the element or we assigned it
    const targetId = element.dataset.midiTarget;
    if (!targetId) return true;

    this.selectTarget(targetId, element);
    return true; // Indicates we handled the click
  }

  selectTarget(targetId, element) {
    this.clearSelection();

    this.selectedTargetId = targetId;
    this.selectedTargetElement = element;
    this.selectedTargetElement.classList.add('mapping-active');

    const name = this.getTargetName(targetId);
    this.learnInstructions.textContent = `Waiting for MIDI or key press for "${name}"...`;
    this.app?.flowRail?.updateChrome();
  }

  clearSelection() {
    if (this.selectedTargetElement) {
      this.selectedTargetElement.classList.remove('mapping-active');
    }
    this.selectedTargetId = null;
    this.selectedTargetElement = null;
    if (this.isLearning) {
      this.learnInstructions.textContent = 'Select a control to map...';
    }
    this.app?.flowRail?.updateChrome();
  }

  updateDeviceList(inputs) {
    if (!this.inputDeviceSelect) return;
    
    const currentVal = this.inputDeviceSelect.value;
    this.inputDeviceSelect.innerHTML = '<option value="any">Any Device</option>';
    
    inputs.forEach(input => {
      const opt = document.createElement('option');
      opt.value = input.id;
      opt.textContent = input.name;
      this.inputDeviceSelect.appendChild(opt);
    });
    
    // Restore selection if it still exists
    if (Array.from(this.inputDeviceSelect.options).some(o => o.value === currentVal)) {
      this.inputDeviceSelect.value = currentVal;
    }
  }

  processMidiMessage(event, inputId) {
    const data = event.data;
    if (!data || data.length < 2) return false;

    const status = data[0];
    const cmd = status >> 4;
    const channel = (status & 0xf) + 1;
    const data1 = data[1];
    const data2 = data.length > 2 ? data[2] : 0;

    // We only care about Note On (9), Note Off (8), and CC (11)
    let type = null;
    let isActive = false;
    
    if (cmd === 9 && data2 > 0) {
      type = 'note';
      isActive = true;
    } else if (cmd === 8 || (cmd === 9 && data2 === 0)) {
      type = 'note';
      isActive = false;
    } else if (cmd === 11) {
      type = 'cc';
      isActive = data2 > 64; // arbitrary threshold for buttons/switches on CC
    }

    if (!type) return false;

    // 1. Are we learning?
    if (this.isLearning && this.selectedTargetId) {
      if (this.selectedTargetId === 'flowRailSource') {
        if (type === 'cc') {
          this.app?.flowRail?.setSourceCc(data1);
          this.clearSelection();
        }
        return true;
      }
      // Only map on the "active" press (Note On, or CC > 64) to avoid mapping the release
      if (isActive) {
        const designatedInput = this.inputDeviceSelect.value;
        this.addMapping(this.selectedTargetId, designatedInput === 'any' ? 'any' : inputId, type, channel, data1);
        this.clearSelection();
      }
      return true; // We consume the message while waiting for learn, so it doesn't trigger synth
    }

    // 2. Not learning (or no target selected), check mappings.
    // A mapped control is *dedicated* to its mapping: it must be consumed on
    // BOTH the press and the release edge so the note/CC never reaches the
    // performance engine. Otherwise a leaked Note Off pollutes the engine's
    // note/sustain state (and can make a module sound a phantom note), which is
    // exactly the "mapped note still plays" behaviour we want to eliminate.
    // Consumption ends the moment the mapping is deleted, restoring normal play.
    const matches = (map) =>
      map.type === type && map.data1 === data1 && map.channel === channel &&
      (map.inputId === 'any' || map.inputId === inputId);

    const isMapped = this.mappings.some(matches);

    // Release edge (Note Off, or CC falling to/below the button threshold).
    if (!isActive) {
      // Fire release callbacks for mapped note targets (e.g. momentary chord pads).
      if (isMapped && this.releaseCallback && type === 'note') {
        for (const map of this.mappings) {
          if (matches(map)) this.releaseCallback(map.targetId);
        }
      }
      // Consume the release of a mapped control; let everything else through.
      return isMapped;
    }

    // Active edge — fire the mapped action(s).
    let handled = false;
    for (const map of this.mappings) {
      if (matches(map)) {
        if (map.targetId === 'flowRailSource') {
          handled = true;
          continue;
        }
        this.performAction(map.targetId);
        handled = true;
        // Don't break — one control may be mapped to multiple targets.
      }
    }

    // Returning true tells the app gate not to forward this event to the engine,
    // so a mapped note makes no sound — only its mapping fires.
    return handled;
  }

  addMapping(targetId, inputId, type, channel, data1, keyCode = null) {
    const exists = this.mappings.findIndex(m =>
      m.targetId === targetId && m.inputId === inputId && m.type === type &&
      m.channel === channel && m.data1 === data1 && (m.key ?? null) === keyCode
    );
    if (exists >= 0) return;

    const entry = { targetId, inputId, type, channel, data1 };
    if (keyCode) entry.key = keyCode;
    this.mappings.push(entry);
    this.saveState();
    this.renderList();
    if (this.onMappingsChanged) this.onMappingsChanged();
  }

  // ── Keyboard Input ─────────────────────────────────────────────────────────

  processKeyboardEvent(event) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (event.ctrlKey || event.metaKey) return false;

    const code = event.code;

    if (event.type === 'keydown') {
      if (this.isLearning && this.selectedTargetId) {
        // Escape cancels target selection without mapping
        if (code === 'Escape') {
          event.preventDefault();
          this.clearSelection();
          return true;
        }
        if (this.selectedTargetId === 'flowRailSource') return true;
        event.preventDefault();
        this.addMapping(this.selectedTargetId, 'keyboard', 'key', 0, 0, code);
        this.clearSelection();
        return true;
      }

      let handled = false;
      for (const map of this.mappings) {
        if (map.type === 'key' && map.key === code) {
          this.performAction(map.targetId);
          handled = true;
        }
      }
      if (handled) event.preventDefault();
      return handled;
    }

    if (event.type === 'keyup' && this.releaseCallback) {
      for (const map of this.mappings) {
        if (map.type === 'key' && map.key === code) {
          this.releaseCallback(map.targetId);
        }
      }
    }

    return false;
  }

  formatKeyCode(code) {
    if (!code) return '?';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    const aliases = {
      Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Bksp', Tab: 'Tab',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      ShiftLeft: 'L⇧', ShiftRight: 'R⇧', ControlLeft: 'L⌃', ControlRight: 'R⌃',
      AltLeft: 'L⌥', AltRight: 'R⌥', MetaLeft: 'L⌘', MetaRight: 'R⌘',
      F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
      F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
      BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
      Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
      Minus: '-', Equal: '=',
    };
    return aliases[code] || code;
  }

  deleteMapping(index) {
    this.mappings.splice(index, 1);
    this.saveState();
    this.renderList();
    if (this.onMappingsChanged) this.onMappingsChanged();
  }

  formatInputName(inputId) {
    if (inputId === 'any') return 'Any Device';
    // try to find it in the select box
    if (this.inputDeviceSelect) {
      const opt = Array.from(this.inputDeviceSelect.options).find(o => o.value === inputId);
      if (opt) return opt.textContent;
    }
    return inputId.substring(0, 10) + '...';
  }

  renderList() {
    if (!this.mappingList) return;
    this.mappingList.innerHTML = '';

    const flowSource = this._flowSourceOverride();
    if (this.mappings.length === 0 && !flowSource) {
      this.mappingList.innerHTML = '<li style="color:var(--text-dim); font-size: 0.85rem; text-align: center; padding: 1rem;">No mappings yet.</li>';
      this.updateMappableVisuals();
      return;
    }

    if (flowSource != null) {
      const li = document.createElement('li');
      li.className = 'mapping-item';
      const info = document.createElement('div');
      info.className = 'mapping-info';
      const name = document.createElement('div');
      name.className = 'mapping-target-name';
      name.textContent = 'Flow Rail Source';
      const data = document.createElement('div');
      data.className = 'mapping-data';
      data.textContent = `CC ${flowSource}  ·  this song`;
      info.appendChild(name);
      info.appendChild(data);
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-mapping-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Reset to Mod Wheel';
      delBtn.onclick = () => this.app?.flowRail?.resetSourceCc();
      li.appendChild(info);
      li.appendChild(delBtn);
      this.mappingList.appendChild(li);
    }

    this.mappings.forEach((map, idx) => {
      const li = document.createElement('li');
      li.className = 'mapping-item';

      const info = document.createElement('div');
      info.className = 'mapping-info';
      
      const name = document.createElement('div');
      name.className = 'mapping-target-name';
      name.textContent = this.getTargetName(map.targetId);
      
      const data = document.createElement('div');
      data.className = 'mapping-data';
      const dataStr = map.type === 'key'
        ? `Keyboard • ${this.formatKeyCode(map.key)}`
        : `${this.formatInputName(map.inputId)} • Ch ${map.channel} • ${map.type === 'note' ? 'Note' : 'CC'} ${map.data1}`;
      data.textContent = dataStr;

      info.appendChild(name);
      info.appendChild(data);

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-mapping-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete Mapping';
      delBtn.onclick = () => this.deleteMapping(idx);

      li.appendChild(info);
      li.appendChild(delBtn);
      this.mappingList.appendChild(li);
    });
    
    this.updateMappableVisuals();
  }

  _flowSourceOverride() {
    const cc = this.app?.flowRail?.engine?.rail?.source?.cc;
    return cc === null || cc === undefined ? null : cc;
  }

  // ── Dynamic Target Name Resolution ────────────────────
  getTargetName(targetId) {
    // Static targets
    if (this.targetNames[targetId]) return this.targetNames[targetId];

    // Dynamic targets: song:<id> or section:<id>
    if (targetId.startsWith('song:') && this.presetManager) {
      const songId = targetId.substring(5);
      const song = this.presetManager.getSong(songId);
      return song ? `Song: ${song.name}` : `Song (deleted)`;
    }
    if (targetId.startsWith('section:') && this.presetManager) {
      const sectionId = targetId.substring(8);
      // Search all songs for this section
      for (const song of this.presetManager.getSongs()) {
        const section = song.sections.find(s => s.id === sectionId);
        if (section) return `${song.name} › ${section.name}`;
      }
      return `Section (deleted)`;
    }

    return targetId;
  }

  // ── Orphaned Mapping Cleanup ───────────────────────────
  cleanupOrphanedMappings() {
    if (!this.presetManager) return;
    const before = this.mappings.length;
    this.mappings = this.mappings.filter(map => {
      if (map.targetId.startsWith('song:')) {
        const songId = map.targetId.substring(5);
        return !!this.presetManager.getSong(songId);
      }
      if (map.targetId.startsWith('section:')) {
        const sectionId = map.targetId.substring(8);
        for (const song of this.presetManager.getSongs()) {
          if (song.sections.some(s => s.id === sectionId)) return true;
        }
        return false;
      }
      return true; // static targets always survive
    });
    if (this.mappings.length < before) {
      this.saveState();
      this.renderList();
    }
  }

  saveState() {
    const state = {
      mappings: this.mappings,
      designatedInput: this.inputDeviceSelect ? this.inputDeviceSelect.value : 'any'
    };
    localStorage.setItem('flowKeysMidiMap', JSON.stringify(state));
  }

  loadState() {
    try {
      const str = localStorage.getItem('flowKeysMidiMap');
      if (str) {
        const state = JSON.parse(str);
        this.mappings = state.mappings || [];
        if (state.designatedInput && this.inputDeviceSelect) {
          // Value might not exist in options yet, but we'll set it anyway
          this.inputDeviceSelect.value = state.designatedInput;
        }
      }
    } catch (e) {
      console.warn('Could not load MIDI mappings', e);
    }
  }

  updateMappableVisuals() {
    if (!this.isLearning) return;
    const mappables = document.querySelectorAll('.mappable');
    mappables.forEach(el => {
      const targetId = el.dataset.midiTarget;
      const targetMappings = this.mappings.filter(m => m.targetId === targetId);
      if (targetId === 'flowRailSource') {
        const src = this._flowSourceOverride();
        if (src != null) {
          el.classList.add('has-mapping');
          el.setAttribute('data-mapping-text', `CC ${src}`);
        } else {
          el.classList.remove('has-mapping');
          el.removeAttribute('data-mapping-text');
        }
        return;
      }
      if (targetMappings.length > 0) {
        el.classList.add('has-mapping');
        const texts = targetMappings.map(m =>
          m.type === 'key' ? `Key: ${this.formatKeyCode(m.key)}` : `${m.type === 'note' ? 'Note' : 'CC'} ${m.data1}`
        );
        el.setAttribute('data-mapping-text', texts.join(', '));
      } else {
        el.classList.remove('has-mapping');
        el.removeAttribute('data-mapping-text');
      }
    });
  }
}

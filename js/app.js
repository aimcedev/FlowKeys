import { MidiManager, VIRTUAL_OUTPUT_ID } from './midi/midiManager.js';
import { ChordPads } from './chord-pads/chordPads.js';
import { ChordPadsPanel } from './chord-pads/chordPadsPanel.js';
import { PerformanceEngine } from './engine/performanceEngine.js?v=2';
import { ActivityVisualizer } from './ui/activityVisualizer.js';
import { BassModule } from './modules/bass.js';
import { ArpModule } from './modules/arp.js';
import { PadModule } from './modules/pad.js';
import { PercussionModule } from './modules/percussion.js';
import { KeyboardModule } from './modules/keyboard.js';
import { LooperModule } from './modules/looper.js';
import { SwellModule } from './modules/swell.js';
import { MidiMappingManager } from './midi/midiMapping.js?v=2';
import { PresetManager } from './state/presetManager.js?v=3';
import { ModulePresetManager } from './state/modulePresets.js';
import { migrateState, buildDefaultState, LEGACY_MODULE_IDS } from './state/stateSchema.js';
import { AppUiManager } from './ui/appUiManager.js?v=16';
import { SettingsWindow } from './ui/settingsWindow.js';
import { loadSettings } from './state/settingsStore.js';
import { setCcConfig, CLOCK_TICK, CLOCK_START, CLOCK_STOP } from './utils/midiConstants.js';
import { ShowFileManager } from './state/showFileManager.js';
import { TempoWidget } from './tempo/tempo-widget.js';
import { ContextMenu } from './ui/contextMenu.js?v=2';
import { ModuleCardBuilder } from './ui/moduleCardBuilder.js';
import { DragDropController } from './ui/dragDropController.js';
import { ModuleRegistry } from './modules/moduleRegistry.js';
import { ModulesGridController } from './ui/modulesGridController.js?v=3';
import { MidiActionRouter } from './midi/midiActionRouter.js';
import { ContextActionsController } from './ui/contextActionsController.js';
import { TempoController } from './tempo/tempoController.js';
import { normalizeBpm } from './utils/bpm.js';
import { ChordDetectorController } from './chord-detector/chordDetectorController.js';
import { FlowRailController } from './flow-rail/flowRailController.js?v=13';

class App {
  constructor() {
    this.midi = new MidiManager();
    this.engine = new PerformanceEngine(this.midi);
    this.presetManager = new PresetManager();
    this.modulePresetManager = new ModulePresetManager();
    this.showFileManager = new ShowFileManager(this);
    this.midiActions = new MidiActionRouter(this);
    this.midiMapping = new MidiMappingManager((targetId) => this.midiActions.handle(targetId), this.presetManager);

    // Chord Pads — standalone controller + UI panel
    this.chordPads = new ChordPads();
    this.chordPadsPanel = new ChordPadsPanel(this.chordPads, this.midiMapping);
    // The panel sets onPadsChanged for grid updates; chain in the mapping sync here
    const _panelPadsChanged = this.chordPads.onPadsChanged;
    this.chordPads.onPadsChanged = () => {
      this.midiActions.syncChordPadMappingTargets();
      if (_panelPadsChanged) _panelPadsChanged();
    };

    // Sync chord pad panel highlights when MIDI learn mode changes
    this.midiMapping.onLearnModeChange = (active) => {
      if (!active && this.flowRail) {
        this.flowRail._learningSource = false;
        this.flowRail.updateChrome();
      }
      if (active) {
        this.chordPadsPanel.activateMappingHighlights();
      } else {
        this.chordPadsPanel.deactivateMappingHighlights();
      }
    };

    // Wire release callback for chord pad note-off (momentary mode)
    this.midiMapping.releaseCallback = (targetId) => {
      if (targetId.startsWith('chordPad:')) {
        const idx = parseInt(targetId.substring(9), 10);
        if (!isNaN(idx)) this.chordPads.triggerPadUp(idx);
      }
    };

    // Feed chord-pad note events into the performance engine so that all modules
    // (Bass, Arp, Keyboard, etc.) react to chord pads just like physical keys.
    // Each event is a synthetic MIDI message { status, note, velocity } that is
    // Route through engine.injectNotes so all modules receive the same
    // processState calls as physical MIDI input, and MIDI is sent to the
    // chord pad's configured output channel with engine transpose applied.
    this.chordPads.onNoteEvents = (events) => {
      this.engine.injectNotes(events, this.chordPads.channel);
      if (this.chordDetector) {
        for (const evt of events) {
          this.chordDetector.handleSyntheticMidi(evt);
        }
      }
    };

    this.pendingSectionChange = null;
    this.pendingModuleActivations = []; // modules waiting to be activated at the next bar
    // Flow Mode: when the clock stops (no-tempo scene) we mark this so the
    // next tempo scene always starts cleanly from beat 1.
    this._clockNeedsReset = true;
    this._loopCache = new Map(); // sectionId → Map<moduleId, loopSnapshot>
    this.uiManager = new AppUiManager(this);
    window.appUiManager = this.uiManager; // specific mapping hack fix
    this.settingsWindow = new SettingsWindow(this);

    // MIDI clock output (Settings → MIDI & Sync); applied from saved settings in init().
    this._clockSendEnabled = false;
    this.contextMenu = new ContextMenu(this);
    this.cardBuilder = new ModuleCardBuilder(this);
    this.dragDrop = new DragDropController(this);

    // Tempo reference widget (reads the same MIDI input as the performance engine)
    this.tempoWidget = new TempoWidget();
    this._tempoLocked = false;
    this._preLockBpm = null;

    // Instantiates legacy modules, sets this.moduleInstances, registers with engine
    this.moduleRegistry = new ModuleRegistry(this);
    this.modulesGrid = new ModulesGridController(this);
    this.contextActions = new ContextActionsController(this);
    this.tempoController = new TempoController(this);
    this.chordDetector = new ChordDetectorController(this);

    // Sequencer UIs keyed by instanceId — populated by renderModules()
    this.sequencers = new Map();

    // The ordered module list (structure only — which modules exist and in what order).
    // Values (config, active state) live in the DOM and the module instances.
    this._currentModules = buildDefaultState().modules;

    // Visualizer
    const canvas = document.getElementById('activityCanvas');
    this.visualizer = new ActivityVisualizer(canvas);

    // ── PERF DEBUG (temporary) ───────────────────────────────────────────────
    // Section-switch jitter instrumentation. On by default while we diagnose the
    // first-visit hiccup; set window.FK_PERF_DEBUG = false in the console to mute,
    // or delete this block (and the [FK PERF] sites in app.js/clock.js) to remove.
    if (window.FK_PERF_DEBUG === undefined) window.FK_PERF_DEBUG = true;
    if (window.FK_PERF_DEBUG) console.log('[FK PERF] Section-switch instrumentation ON. Click through every section once (cold), then again (warm), and read the [FK PERF] lines. Mute with: window.FK_PERF_DEBUG = false');

    this._currentSongKey = 0; // pitch class 0–11 (0=C)

    // Global UI elements (non-module)
    this.ui = {
      status: document.getElementById('system-status'),
      input: document.getElementById('midi-input'),
      output: document.getElementById('midi-output'),
      panicBtn: document.getElementById('panic-button'),
      tapTempoBtn: document.getElementById('tap-tempo-btn'),
      masterBpm: document.getElementById('master-bpm'),
      liveTapTempoBtn: null,
      songKeySelect: document.getElementById('song-key-select'),
      transposeDisplay: document.getElementById('transpose-display'),
      transposeUpBtn: document.getElementById('transpose-up-btn'),
      transposeDownBtn: document.getElementById('transpose-down-btn'),
    };

    this.midiMapping.app = this;
    this.flowRail = new FlowRailController(this);

    this.init();
  }

  // ── DOM Helpers ───────────────────────────────────────────────────────────

  _getModuleEl(instanceId, control) {
    return document.querySelector(`[data-instance-id="${instanceId}"] [data-control="${control}"]`);
  }

  _getModuleCard(instanceId) {
    return document.querySelector(`[data-instance-id="${instanceId}"]`);
  }

  // ── Module Card Generation ────────────────────────────────────────────────

  _buildPresetPanelHtml(type, instanceId) {
    return this.cardBuilder.buildPresetPanelHtml(type, instanceId);
  }

  _buildModuleCardElement(modDesc) {
    return this.cardBuilder.buildCard(modDesc);
  }

  // ── Module Rendering ──────────────────────────────────────────────────────

  renderModules(modules) {
    return this.modulesGrid.renderModules(modules);
  }

  // ── Module State Helpers ──────────────────────────────────────────────────

  _readModuleFromDom(mod) {
    return this.modulesGrid.readModuleFromDom(mod);
  }

  handleModuleNoteState(instanceId, velocity, hasActive) {
    this.modulesGrid.triggerMeter(instanceId, velocity, hasActive);
  }

  // ── Direct Module Toggle (used by MIDI action router) ────────────────────
  // Bypasses DOM click so MIDI-mapped toggles don't trigger saveState() or any
  // DOM event dispatch from within the MIDI message handler.

  _toggleModuleDirectly(instanceId, active, { persist = true } = {}) {
    this.flowRail?.tempoTransitions.cancelModule(instanceId);
    const mod = this.moduleInstances.get(instanceId);
    if (!mod) return;
    const card = this._getModuleCard(instanceId);
    const toggleEl = this._getModuleEl(instanceId, 'toggle');

    if (mod.isTempoBased && active && this.engine.clock.isRunning) {
      mod.isActive = false;
      if (!this.pendingModuleActivations.includes(mod)) {
        this.pendingModuleActivations.push(mod);
      }
    } else {
      this.pendingModuleActivations = this.pendingModuleActivations.filter(m => m !== mod);
      mod.toggle(active);
    }

    if (card) card.classList.toggle('active', active);
    if (toggleEl) toggleEl.checked = active;
    if (!active) this._checkFlowClockStop();

    // Call saveState if in Edit mode to ensure MIDI toggles are saved to the section
    if (persist && this.uiManager && this.uiManager.currentMode === 'edit') {
      this.saveState();
    }
  }

  // ── Dynamic Module Add / Remove ───────────────────────────────────────────

  addModule(type, insertIndex) {
    return this.moduleRegistry.addModule(type, insertIndex);
  }

  removeModule(instanceId) {
    return this.moduleRegistry.removeModule(instanceId);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init() {
    this._loadTheme();
    this._loadModuleSize();
    this.showFileManager.init();
    // Render module cards first so note-selects and sequencer containers exist in DOM
    this.renderModules(this._currentModules);
    this.loadState();
    this.midiActions.syncChordPadMappingTargets();
    this.setupEventListeners();
    this._wireClockSend();
    this._applyGlobalSettings();

    // ── Native virtual MIDI output (Electron desktop host only) ──────────────
    // In a browser this is skipped entirely (window.flowKeysNative is undefined)
    // and the app behaves exactly as before, falling back to Web MIDI / IAC.
    // In the Electron host it publishes a system-wide "Flow Keys Out" port so
    // DAWs see Flow Keys with no IAC Driver setup. Must run before
    // populateMidiDevices() so the port appears in the output list.
    if (window.flowKeysNative?.createVirtualPort) {
      try {
        const portName = 'Flow Keys Out';
        const res = await window.flowKeysNative.createVirtualPort(portName);
        if (res?.ok) {
          this.midi.enableNativeOutput(portName, (bytes) => window.flowKeysNative.send(bytes));
        } else if (res?.error) {
          console.warn('[Flow Keys] Virtual MIDI port unavailable:', res.error);
        }
      } catch (e) {
        console.warn('[Flow Keys] Virtual MIDI port unavailable:', e);
      }
    }

    const initialized = await this.midi.initialize();
    if (initialized) {
      this.ui.status.classList.add('active');
      this.populateMidiDevices();

      this.midi.onStateChange(() => {
        this.populateMidiDevices();
      });

      // ── MIDI Activity Monitor ───────────────────────────────────────────────
      const midiInDot = document.getElementById('midi-in-dot');
      const midiOutDot = document.getElementById('midi-out-dot');

      const flashDot = (dot) => {
        dot.classList.add('active');
        clearTimeout(dot._flashTimer);
        dot._flashTimer = setTimeout(() => dot.classList.remove('active'), 80);
      };

      if (midiInDot) this.midi.onInputActivity(() => flashDot(midiInDot));
      if (midiOutDot) this.midi.onOutputActivity(() => flashDot(midiOutDot));

      // Surface MIDI output device disconnect/reconnect to the performer
      this.midi.onOutputDisconnect((deviceName) => {
        const label = deviceName ?? 'MIDI output';
        if (this.uiManager) this.uiManager.showToast(`⚠ ${label} disconnected — output lost`, 'error');
        if (this.ui.output) this.ui.output.classList.add('device-disconnected');
      });
      this.midi.onOutputReconnect((device) => {
        if (this.uiManager) this.uiManager.showToast(`${device.name} reconnected`);
        if (this.ui.output) this.ui.output.classList.remove('device-disconnected');
        // Sync the select to the rematch
        if (this.ui.output) this.ui.output.value = device.id;
      });

      // Surface clock Worker errors (timing loop failure) to the performer
      this.engine.clock.onWorkerError((message) => {
        console.error('[Clock Worker]', message);
        if (this.uiManager) this.uiManager.showToast('⚠ Clock timing error — restart recommended', 'error');
      });

      // Warn when the tab goes to background while the clock is live.
      // The Worker clock itself is unaffected, but main-thread note-off timers
      // (staccato, swell, percussion) will be throttled to ≥1 s.
      this.engine.clock.onBackground(() => {
        console.warn('[Flow Keys] Tab backgrounded while clock is running — note-off timers may be delayed.');
        if (this.uiManager) this.uiManager.showToast('⚠ Tab in background — keep this tab focused during performance', 'error');
      });

      this.midi.onMidiMessage((event, inputId) => {
        if (this.flowRail?.handleMidiMessage(event)) return;
        // Check mappings first — mapped keys are consumed and must not reach
        // the tempo tracker or the performance engine.
        const handledByMapping = this.midiMapping.processMidiMessage(event, inputId);
        if (!handledByMapping) {
          this.tempoWidget.processMidiMessage(event);
          this.engine.processMidiMessage(event);
          if (this.chordDetector) {
            this.chordDetector.handleMidiMessage(event);
          }
        }
        this.flowRail?.reassertEnvelope();
      });

      this.engine.onStateChange((state) => {
        this.visualizer.updateState(state);

        // Flow Mode: Handle pedal lift for Entry/Exit section changes
        if (this.pendingSectionChange && this.pendingSectionChange.waitForPedalLift) {
          if (!state.sustainDown) {
            // Apply immediately on pedal lift (Entrance or Exit)
            const { songId, sectionId } = this.pendingSectionChange;
            this.applySectionState(songId, sectionId);
            return;
          }
        }

        this.flowRail?.tempoTransitions.onStateChange(state);

        // Flow Mode: stop the clock when ALL tempo-based modules become inactive
        if (this._getActiveSongMode() === 'flow' && this.engine.clock.isRunning) {
          this._checkFlowClockStop();
        }
      });

      // Bar-boundary: fires Sync pending section changes, and activates deferred modules
      this.engine.clock.onBar(() => {
        // 1. Apply any pending section change (Sync mode only)
        if (this.pendingSectionChange && !this.pendingSectionChange.waitForPedalLift) {
          const { songId, sectionId } = this.pendingSectionChange;
          this.applySectionState(songId, sectionId);
        }

        this.flowRail?.tempoTransitions.onBar();

        // 2. Activate any modules waiting for bar-alignment
        if (this.pendingModuleActivations.length > 0) {
          this.pendingModuleActivations.forEach(mod => {
            mod.isActive = true;
            if (mod.resetPhase) mod.resetPhase();
          });
          this.pendingModuleActivations = [];
        }
        this.flowRail?.view?.requestDraw();
      });

    } else {
      this.ui.status.style.backgroundColor = 'var(--state-error)';
      this.ui.input.innerHTML = '<option value="">MIDI Not Supported/Allowed</option>';
      this.ui.output.innerHTML = '<option value="">MIDI Not Supported/Allowed</option>';
    }
  }

  // ── Event Listeners ───────────────────────────────────────────────────────

  setupEventListeners() {
    // MIDI Mapping Drawer
    document.getElementById('midi-mapping-btn')?.addEventListener('click', () => {
      const willOpen = !this.midiMapping.isOpen();
      this.midiMapping.toggleDrawer();
      // Close chord pads drawer when settings opens
      if (willOpen && this.chordPadsPanel.isOpen()) {
        this.chordPadsPanel.close();
      }
    });

    // Chord Pads Drawer
    document.getElementById('chord-pads-btn')?.addEventListener('click', () => {
      const willOpen = !this.chordPadsPanel.isOpen();
      this.chordPadsPanel.toggle();
      // Close settings drawer when opening chord pads (and vice versa — feel clean)
      if (willOpen && this.midiMapping.isOpen()) {
        this.midiMapping.toggleDrawer(false);
      }
    });

    // Settings Window (gear icon)
    document.getElementById('settings-btn')?.addEventListener('click', () => {
      this.settingsWindow.toggle();
    });

    // "Open full Settings…" link inside the MIDI mapping drawer
    document.getElementById('open-settings-from-drawer')?.addEventListener('click', () => {
      if (this.midiMapping.isOpen()) this.midiMapping.toggleDrawer(false);
      this.settingsWindow.open();
    });

    // Theme toggle
    document.getElementById('theme-toggle')?.addEventListener('change', (e) => {
      this._applyTheme(e.target.checked ? 'light' : 'dark');
      this.saveState();
    });

    // Module Size Selector
    document.getElementById('module-size-selector')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.size-btn');
      if (btn) {
        const size = btn.dataset.size;
        this._applyModuleSize(size);
      }
    });

    // Capture phase listener for mapping learn clicks
    document.addEventListener('click', (e) => {
      if (this.midiMapping.isLearning) {
        const mappable = e.target.closest('.mappable');
        if (mappable) {
          e.preventDefault();
          e.stopPropagation();
          this.midiMapping.handleTargetClick(e, mappable);
        }
      }
    }, true);

    // Live Mode Navigation
    document.getElementById('prev-section-btn')?.addEventListener('click', () => {
      this.midiActions.handle('prevSection');
    });
    document.getElementById('next-section-btn')?.addEventListener('click', () => {
      this.midiActions.handle('nextSection');
    });

    // Edit Mode Navigation (Auto-saves implicitly via saveState hook)
    document.getElementById('edit-prev-section-btn')?.addEventListener('click', () => {
      this.midiActions.handle('prevSection');
    });

    document.getElementById('edit-next-section-btn')?.addEventListener('click', () => {
      this.midiActions.handle('nextSection');
    });

    // Global API
    this.ui.input.addEventListener('change', (e) => {
      this.midi.setInput(e.target.value);
      this.saveState();
    });

    this.ui.output.addEventListener('change', (e) => {
      this.midi.setOutput(e.target.value);
      this.saveState();
    });

    this.ui.panicBtn.addEventListener('click', () => {
      this.engine.panic();
      this.midi.sendPanic();
      this.chordPads.panic();
      this.triggerPanicVisual();
    });

    this.tempoController.attachListeners();

    // ── Song Key selector ─────────────────────────────────────────────────────
    this.ui.songKeySelect?.addEventListener('change', (e) => {
      this.setSongKey(parseInt(e.target.value, 10));
    });

    // ── Transpose controls ────────────────────────────────────────────────────
    this.ui.transposeUpBtn?.addEventListener('click', () => {
      this.setTranspose(Math.min(12, this.engine.transpose + 1));
    });
    this.ui.transposeDownBtn?.addEventListener('click', () => {
      this.setTranspose(Math.max(-12, this.engine.transpose - 1));
    });

    // ── Module card delegation ─────────────────────────────────────────────
    this.modulesGrid.attachListeners();

    // Right-click context menu for section cards
    const sectionGrid = document.getElementById('section-grid');
    if (sectionGrid) {
      sectionGrid.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('.section-card');
        if (!card?.dataset.midiTarget) return;
        e.preventDefault();
        const sectionId = card.dataset.midiTarget.split(':')[1];
        if (sectionId) this.contextMenu.open(e, sectionId, 'section');
      });
    }

    // Right-click context menu for song list items
    const songList = document.getElementById('song-list');
    if (songList) {
      songList.addEventListener('contextmenu', (e) => {
        const item = e.target.closest('.song-item');
        if (!item?.dataset.midiTarget) return;
        e.preventDefault();
        const songId = item.dataset.midiTarget.split(':')[1];
        if (songId) this.contextMenu.open(e, songId, 'song');
      });
    }

    // Keyboard input for MIDI/key mapping (both learn capture and playback)
    document.addEventListener('keydown', (e) => this.midiMapping.processKeyboardEvent(e));
    document.addEventListener('keyup', (e) => this.midiMapping.processKeyboardEvent(e));

    this.dragDrop.attachPaletteDrag();

    // ── Module preset export / import ──────────────────────────────────────
    document.getElementById('export-presets-btn')
      ?.addEventListener('click', () => this.modulePresetManager.exportUserPresets());

    document.getElementById('import-presets-input')
      ?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        try {
          const text = await file.text();
          const result = this.modulePresetManager.importUserPresets(text);
          this.uiManager.showToast(`Imported ${result.added} preset${result.added !== 1 ? 's' : ''}`);
        } catch {
          this.uiManager.showToast('Import failed — invalid file', 'error');
        }
      });
  }

  populateMidiDevices() {
    const state = JSON.parse(localStorage.getItem('flowKeysState') || '{}');

    // Inputs
    const inputs = this.midi.getInputs();
    if (inputs.length === 0) {
      this.ui.input.innerHTML = '<option value="">No inputs found</option>';
    } else {
      this.ui.input.innerHTML = '<option value="">Any Device</option>';
      inputs.forEach(input => {
        const option = document.createElement('option');
        option.value = input.id;
        option.textContent = input.name;
        this.ui.input.appendChild(option);
      });
      if (state.inputId && inputs.some(i => i.id === state.inputId)) {
        this.ui.input.value = state.inputId;
        this.midi.setInput(state.inputId);
      } else {
        // Default: listen to all devices
        this.ui.input.value = '';
        this.midi.setInput('');
      }
    }
    this.midiMapping.updateDeviceList(inputs);

    // Outputs
    const outputs = this.midi.getOutputs();
    const hasVirtual = this.midi.hasNativeOutput();

    if (outputs.length === 0 && !hasVirtual) {
      this.ui.output.innerHTML = '<option value="">No outputs found</option>';
    } else {
      this.ui.output.innerHTML = '<option value="">Select Output</option>';

      // Native virtual port first (Electron host only)
      if (hasVirtual) {
        const opt = document.createElement('option');
        opt.value = VIRTUAL_OUTPUT_ID;
        opt.textContent = '🎹 Flow Keys Out (Virtual)';
        this.ui.output.appendChild(opt);
      }

      outputs.forEach(output => {
        const option = document.createElement('option');
        option.value = output.id;
        option.textContent = output.name;
        this.ui.output.appendChild(option);
      });

      // Restore saved output, else prefer the virtual port, else IAC Driver.
      if (state.outputId === VIRTUAL_OUTPUT_ID && hasVirtual) {
        this.ui.output.value = VIRTUAL_OUTPUT_ID;
        this.midi.setOutput(VIRTUAL_OUTPUT_ID);
      } else if (state.outputId && outputs.some(o => o.id === state.outputId)) {
        this.ui.output.value = state.outputId;
        this.midi.setOutput(state.outputId);
      } else if (hasVirtual) {
        // Zero-config default: send to our own virtual port.
        this.ui.output.value = VIRTUAL_OUTPUT_ID;
        this.midi.setOutput(VIRTUAL_OUTPUT_ID);
      } else {
        // Auto-select IAC Driver if present and no saved output is available
        const iac = outputs.find(o => o.name && o.name.toLowerCase().includes('iac driver'));
        if (iac) {
          this.ui.output.value = iac.id;
          this.midi.setOutput(iac.id);
        }
      }
    }
  }

  populateNoteSelects() {
    this.cardBuilder.populateNoteSelects();
  }

  // ── State I/O ─────────────────────────────────────────────────────────────

  getCurrentStateData() {
    return {
      inputId: this.ui.input.value,
      outputId: this.ui.output.value,
      bpm: this.engine.clock.bpm,
      timeSignature: this.engine.clock.timeSignature,
      modules: this._currentModules.map(mod => this._readModuleFromDom(mod)),
      chordPads: this.chordPads.getState(),
    };
  }

  saveState() {
    if (this._suppressStatePersistence) return;

    this.flowRail?.prepareEditPersist();
    const state = this.getCurrentStateData();
    localStorage.setItem('flowKeysState', JSON.stringify(state));

    // Auto-save to active section if in Edit mode
    if (this.uiManager && this.uiManager.currentMode === 'edit') {
      const songId = this.presetManager.activeSongId;
      const sectionId = this.presetManager.activeSectionId;
      if (songId && sectionId) {
        this.presetManager.updateSectionState(songId, sectionId, state);
        if (this.uiManager.updateAllSectionBadges) {
          this.uiManager.updateAllSectionBadges();
        }
      }
    }

    this.flowRail?.afterEditPersist();
  }

  applyStateData(state, options = {}) {
    if (!state) return;
    const persist = options.persist !== false;
    const previousSuppress = this._suppressStatePersistence;
    this._suppressStatePersistence = !persist;

    // ── PERF DEBUG (temporary) ───────────────────────────────────────────────
    const _sd = window.FK_PERF_DEBUG ? performance.now() : 0;
    let _sdPrev = _sd;
    const _sub = (name) => {
      if (!window.FK_PERF_DEBUG) return;
      const now = performance.now();
      console.log(`[FK PERF]     · applyStateData/${name}: ${(now - _sdPrev).toFixed(1)}ms`);
      _sdPrev = now;
    };

    try {
      // Transparently upgrade any stale flat-key state that slipped through
      const s = state.modules ? state : migrateState(state);

      // Master Clock — skip BPM change when Tempo Tracker lock is active
      if (!this._tempoLocked) {
        const bpm = normalizeBpm(s.bpm, this.engine.clock.bpm);
        this.ui.masterBpm.value = bpm;
        this.engine.clock.setBpm(bpm);
      }

      // Time Signature
      this.setTimeSignature(s.timeSignature || '4/4', { persist });

      // Set clock mode from the currently active song
      const songMode = this._getActiveSongMode();
      if (songMode === 'sync') this.engine.clock.setMode('sync');
      else if (songMode === 'flow') this.engine.clock.setMode('flow');
      else this.engine.clock.setMode('trigger');

      if (!s.modules) return;
      _sub('bpm+timesig+mode');

      // ── Module Reconciliation ──────────────────────────────────────────────
      // Diff the incoming module list against what's currently running so that
      // switching sections correctly creates new instances, destroys removed ones,
      // and re-renders the grid when the layout changes.

      const incomingIds = new Set(s.modules.map(m => m.id));
      const prevOrderKey = this._currentModules.map(m => m.id).join(',');

      // Destroy instances not present in the incoming state
      for (const [id, mod] of [...this.moduleInstances.entries()]) {
        if (!incomingIds.has(id)) {
          mod.panic?.();
          this.engine.unregisterModule(id);
          this.moduleInstances.delete(id);
          
          // Clean up sequencer event listeners to prevent memory leaks
          const seqUI = this.sequencers.get(id);
          if (seqUI) {
            seqUI.destroy();
            this.sequencers.delete(id);
          }

          // Clean up any drum grid controllers for this module
          if (this.modulesGrid && this.modulesGrid._drumGridControllers) {
            this.modulesGrid._drumGridControllers.forEach((ctrl, key) => {
              if (key.startsWith(`${id}::`)) {
                ctrl.abort();
                this.modulesGrid._drumGridControllers.delete(key);
              }
            });
          }

          this.pendingModuleActivations = this.pendingModuleActivations.filter(m => m.instanceId !== id);
        }
      }

      // Create instances for modules not yet running
      for (const modDesc of s.modules) {
        if (!this.moduleInstances.has(modDesc.id)) {
          const { id, type } = modDesc;
          const mod = this.moduleRegistry.createModule(type, id);
          if (mod) {
            this.moduleInstances.set(id, mod);
            this.engine.registerModule(mod);
            if (type === 'looper') this._wireLooperCallbacks(id, mod);
          }
        }
      }

      // Sync ordered descriptor list to the incoming state
      this._currentModules = s.modules.map(m => ({
        id: m.id,
        type: m.type,
        label: m.label || (m.type.charAt(0).toUpperCase() + m.type.slice(1)),
      }));

      _sub('reconcile (destroy+create)');

      // Re-render the grid only when the module set or order changed
      const newOrderKey = this._currentModules.map(m => m.id).join(',');
      if (prevOrderKey !== newOrderKey) {
        this.renderModules(this._currentModules);
      }
      _sub('renderModules');

      // ── Apply config, sequences, and active state ──────────────────────────
      this._applyModuleConfigs(s.modules);
      _sub('applyModuleConfigs');

      // ── Chord Pads ──────────────────────────────────────────────────────────
      if (s.chordPads) {
        this.chordPads.loadState(s.chordPads);
        this.midiActions.syncChordPadMappingTargets();
        this.chordPadsPanel.render();
      }
      _sub('chordPads');
    } finally {
      this._suppressStatePersistence = previousSuppress;
    }
  }

  _applyModuleConfigs(modules) {
    return this.moduleRegistry.applyConfigs(modules);
  }

  loadState() {
    try {
      const rawState = JSON.parse(localStorage.getItem('flowKeysState'));

      // Migrate v1 flat state → v2 modules-array format, or use defaults if no state
      const state = rawState ? migrateState(rawState) : buildDefaultState();

      // Persist migrated state so future loads skip migration
      if (rawState && !rawState.modules) {
        localStorage.setItem('flowKeysState', JSON.stringify(state));
      }

      // We do not restore MIDI inputs/outputs here — handled by populateMidiDevices
      this.applyStateData(state, { persist: false });

      // Also apply active song settings
      if (this.presetManager.activeSongId) {
        this.applySongSettings(this.presetManager.getSong(this.presetManager.activeSongId));
      }

      // Auto-select the first section of the first song on every startup
      const firstSong = this.presetManager.songs[0];
      if (firstSong?.sections?.length > 0) {
        const firstSection = firstSong.sections[0];
        const sectionState = this.presetManager.getSectionData(firstSong.id, firstSection.id);
        if (sectionState) {
          this.applySectionState(firstSong.id, firstSection.id);
        } else {
          this.presetManager.setActiveSection(firstSong.id, firstSection.id);
        }
      }

    } catch (e) {
      console.warn('Failed to load local state', e);
    }
  }

  applySongSettings(song) {
    if (song && song.bpm && !this._tempoLocked) {
      this.engine.clock.setBpm(normalizeBpm(song.bpm, this.engine.clock.bpm));
    }
    // Restore song key
    const key = song?.key ?? 0;
    this._currentSongKey = key;
    if (this.ui.songKeySelect) this.ui.songKeySelect.value = String(key);
    // Push updated key to any drone modules using "Song Key"
    this._refreshDroneSongKey();
    // Sync chord pads transpose
    this.chordPads.keyTranspose = key < 6 ? key : key - 12;
    if (this.chordDetector) {
      this.chordDetector.onKeyChange(key);
    }
    // Restore transpose
    const transpose = song?.transpose ?? 0;
    this.engine.setTranspose(transpose);
    this._updateTransposeDisplay(transpose);
    // Sync clock mode and mode buttons
    const mode = song?.transitionMode || 'flow';
    if (mode === 'sync') this.engine.clock.setMode('sync');
    else if (mode === 'flow') this.engine.clock.setMode('flow');
    else this.engine.clock.setMode('trigger');
    if (this.uiManager) this.uiManager._setActiveModeBtn(mode);
    this.flowRail?.onSongChanged();
  }

  setSongKey(pitchClass) {
    this._currentSongKey = pitchClass;
    const songId = this.presetManager.activeSongId;
    if (songId) {
      this.presetManager.updateSongKey(songId, pitchClass);
    }
    this._refreshDroneSongKey();

    // Transpose chord pads relative to C using minimum chromatic distance:
    //   C=0, C#=+1, D=+2, D#=+3, E=+4, F=+5, F#=+6,
    //   G=−5, Ab=−4, A=−3, Bb=−2, B=−1
    const cpTranspose = pitchClass < 6 ? pitchClass : pitchClass - 12;
    this.chordPads.keyTranspose = cpTranspose;

    if (this.chordDetector) {
      this.chordDetector.onKeyChange(pitchClass);
    }
  }

  setTranspose(semitones) {
    this.engine.setTranspose(semitones);
    this._updateTransposeDisplay(semitones);
    const songId = this.presetManager.activeSongId;
    if (songId) {
      this.presetManager.updateSongSettings(songId, undefined, undefined, undefined, semitones);
    }
  }

  _updateTransposeDisplay(semitones) {
    if (!this.ui.transposeDisplay) return;
    this.ui.transposeDisplay.textContent = semitones > 0 ? `+${semitones}` : String(semitones);
  }

  _refreshDroneSongKey() {
    for (const mod of this._currentModules) {
      if (mod.type === 'pad') {
        const keyEl = this._getModuleEl(mod.id, 'key');
        if (keyEl?.value === 'song') {
          const modInstance = this.moduleInstances.get(mod.id);
          if (modInstance) {
            modInstance.setConfig(
              this._getModuleEl(mod.id, 'chan')?.value,
              60 + this._currentSongKey
            );
          }
        }
      }
    }
  }

  // ── Global settings (Settings window) ──────────────────────────────────────

  /** Apply saved app-global prefs on startup: CC remap + MIDI clock-send state. */
  _applyGlobalSettings() {
    const s = loadSettings();
    this.applyCcRemap(s.ccRemap);
    this._clockSendEnabled = !!s.clockSend.enabled;
  }

  /**
   * Register clock-send callbacks once. Each fires only when clock-send is
   * enabled. The clock already runs at 24 PPQ — the MIDI clock standard — so a
   * tick maps 1:1 to a MIDI Clock byte.
   */
  _wireClockSend() {
    this.engine.clock.onTick((_step, _ppq, when) => { if (this._clockSendEnabled) this.midi.sendRealtime(CLOCK_TICK, when); });
    this.engine.clock.onStart(() => { if (this._clockSendEnabled) this.midi.sendRealtime(CLOCK_START); });
    this.engine.clock.onStop(()  => { if (this._clockSendEnabled) this.midi.sendRealtime(CLOCK_STOP); });
  }

  /** Toggle MIDI clock output. If toggled while the clock runs, sync the DAW immediately. */
  setClockSendEnabled(enabled) {
    this._clockSendEnabled = !!enabled;
    if (this.engine.clock.isRunning) {
      this.midi.sendRealtime(enabled ? CLOCK_START : CLOCK_STOP);
    }
  }

  /** Remap the sustain / mod-wheel CC numbers used app-wide (live module bindings). */
  applyCcRemap({ sustain, modWheel } = {}) {
    setCcConfig({ sustain, modWheel });
  }

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('flowKeysTheme', theme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = (theme === 'light');
  }

  _loadTheme() {
    const theme = localStorage.getItem('flowKeysTheme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = (theme === 'light');
  }

  _applyModuleSize(size) {
    const validSizes = ['compact', 'standard', 'spacious'];
    const currentSize = validSizes.includes(size) ? size : 'standard';

    validSizes.forEach(s => {
      document.body.classList.toggle(`module-size-${s}`, s === currentSize);
    });

    localStorage.setItem('flowKeysModuleSize', currentSize);

    // Update active class on buttons
    document.querySelectorAll('#module-size-selector .size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === currentSize);
    });
  }

  _loadModuleSize() {
    const size = localStorage.getItem('flowKeysModuleSize') || 'standard';
    this._applyModuleSize(size);
  }

  setTimeSignature(sig, options) { return this.tempoController.setTimeSignature(sig, options); }

  // ── Section Management ────────────────────────────────────────────────────

  triggerSectionChange(songId, sectionId) {
    const song = this.presetManager.getSong(songId);
    if (!song) return;

    const mode = song.transitionMode || 'flow';

    if (mode === 'sync') {
      this.engine.clock.setMode('sync');
    } else if (mode === 'flow') {
      this.engine.clock.setMode('flow');
    } else {
      this.engine.clock.setMode('trigger');
    }

    if (mode === 'trigger') {
      this.applySectionState(songId, sectionId);
    } else if (mode === 'sync') {
      this.pendingSectionChange = { songId, sectionId, waitForPedalLift: false };
      if (this.uiManager && this.uiManager.syncLiveModeVisuals) this.uiManager.syncLiveModeVisuals();
      // Start preemptive mod wheel fade for keyboard modules with fadeMode='auto'
      this._tryPreemptiveModWheelFade(songId, sectionId);
    } else if (mode === 'flow') {
      const clockRunning = this.engine.clock.isRunning;
      const nextState = this.presetManager.getSectionData(songId, sectionId);
      const nextHasTempo = this._hasTempoModules(nextState);

      const isEntry = !clockRunning && nextHasTempo;
      const isExit = clockRunning && !nextHasTempo;
      const waitForLift = isEntry || isExit;

      if (waitForLift) {
        // Entry (no clock → tempo) or Exit (tempo → no-tempo): wait for pedal lift.
        // No preemptive fade — we don't know when the pedal will lift.
        this.pendingSectionChange = { songId, sectionId, waitForPedalLift: true };
        if (this.uiManager && this.uiManager.syncLiveModeVisuals) this.uiManager.syncLiveModeVisuals();
      } else if (clockRunning) {
        // Tempo → Tempo: queued for the next bar boundary.
        this.pendingSectionChange = { songId, sectionId, waitForPedalLift: false };
        if (this.uiManager && this.uiManager.syncLiveModeVisuals) this.uiManager.syncLiveModeVisuals();
        // Start preemptive mod wheel fade for keyboard modules with fadeMode='auto'
        this._tryPreemptiveModWheelFade(songId, sectionId);
      } else {
        this.applySectionState(songId, sectionId);
      }
    }
  }

  applySectionState(songId, sectionId) {
    // ── PERF DEBUG (temporary) ───────────────────────────────────────────────
    // Phase timing for the section switch. Stamp the start so the clock's
    // late-pulse log can report "Nms after last section switch", and break the
    // switch into phases so we can see which one owns the main-thread time on a
    // cold (first-visit) switch vs. a warm one.
    const _perf = window.FK_PERF_DEBUG;
    const _t0 = _perf ? performance.now() : 0;
    let _tPrev = _t0;
    const _visited = (window.__fkVisited = window.__fkVisited || new Set());
    const _firstVisit = _perf && !_visited.has(sectionId);
    if (_perf) _visited.add(sectionId);
    const _phase = (name) => {
      if (!_perf) return;
      const now = performance.now();
      console.log(`[FK PERF]   ${name}: ${(now - _tPrev).toFixed(1)}ms`);
      _tPrev = now;
    };
    if (_perf) window.__fkLastSwitch = _t0;

    // Null out pending change first to prevent re-entrancy: engine.clearState()
    // below fires no state callback, but guard here is cheap insurance.
    this.pendingSectionChange = null;

    const previousSongId = this.presetManager.activeSongId;

    // Snapshot loop state for the outgoing section before clearState wipes module buffers
    const outgoingSectionId = this.presetManager.activeSectionId;
    const outgoingLoops = new Map();
    for (const [id, mod] of this.moduleInstances) {
      if (typeof mod.getLoopSnapshot === 'function') {
        const snap = mod.getLoopSnapshot();
        if (snap) outgoingLoops.set(id, snap);
      }
    }
    if (outgoingSectionId) this._loopCache.set(outgoingSectionId, outgoingLoops);
    _phase('loop snapshot');

    const songChanged = (previousSongId !== songId);

    // Silence all active modules and clear engine note-tracking state when switching songs.
    // When switching sections within the same song, keep active notes and sustain state
    // so surviving modules transition smoothly without interruption or restrikes.
    if (songChanged) {
      this.engine.clearState();
    }

    _phase('clearState');
    const state = this.presetManager.getSectionData(songId, sectionId);
    if (state) {
      this.presetManager.setActiveSection(songId, sectionId);
      this.applyStateData(state, { persist: false });
      _phase('applyStateData (modules + config + DOM)');

      // Reload song key and transpose whenever the song changes
      if (previousSongId !== songId) {
        const song = this.presetManager.getSong(songId);
        if (song) {
          const key = song.key ?? 0;
          this._currentSongKey = key;
          if (this.ui.songKeySelect) this.ui.songKeySelect.value = String(key);
          this._refreshDroneSongKey();
          const transpose = song.transpose ?? 0;
          this.engine.setTranspose(transpose);
          this._updateTransposeDisplay(transpose);
        }
      }

      // ── Flow Mode clock lifecycle ─────────────────────────────────────────
      if (this._getActiveSongMode() === 'flow') {
        const anyTempoActive = this.engine.modules.some(m => m.isTempoBased && m.isActive);
        if (anyTempoActive) {
          if (this.engine.clock.isRunning && !this._clockNeedsReset) {
            // Tempo → Tempo (continuous): keep clock running untouched
          } else {
            // (Re-)Entry into tempo scene: restart from beat 1
            this.engine.modules.forEach(m => {
              if (m.isTempoBased && m.isActive && m.resetPhase) m.resetPhase();
            });
            this.engine.clock.restartFromZero();
            this._clockNeedsReset = false;
          }
        } else {
          // Tempo → No-Tempo: stop clock
          if (this.engine.clock.isRunning) {
            this.engine.clock.stop();
          }
          this._clockNeedsReset = true;
        }
      }
      _phase('clock lifecycle');

      if (this.uiManager) {
        if (this.uiManager.currentMode === 'edit') {
          this.uiManager.updateEditContextBar();
        } else if (this.uiManager.currentMode === 'flow') {
          this.flowRail?.onSectionApplied();
        } else {
          if (previousSongId !== songId) {
            this.uiManager.renderLiveMode();
          } else if (this.uiManager.syncLiveModeVisuals) {
            this.uiManager.syncLiveModeVisuals();
          }
        }
      }
      _phase('UI visuals (renderLiveMode / syncLiveModeVisuals)');

      // Restore any loop recorded in the incoming section; clear loops that leaked from other sections
      const cachedLoops = this._loopCache.get(sectionId);
      for (const [id, mod] of this.moduleInstances) {
        if (typeof mod.restoreLoopSnapshot !== 'function') continue;
        const snapshot = cachedLoops?.get(id);
        if (snapshot && mod.isActive) {
          mod.restoreLoopSnapshot(snapshot);
        } else if (!snapshot && mod._looperState === 'playing') {
          mod.clear();
        }
      }

      _phase('loop restore');

      // Re-trigger physically held keys and restore sustain state in the new section
      if (songChanged) {
        this.engine.reapplyPhysicalState();
      } else {
        this.engine.broadcastCurrentState();
      }
      _phase('broadcast/reapply state');
    }

    // ── PERF DEBUG (temporary) ─────────────────────────────────────────────
    if (_perf) {
      const total = performance.now() - _t0;
      const tag = _firstVisit ? 'COLD (first visit)' : 'warm';
      const flag = total > this.engine.clock._lookahead ? '  ⚠️ EXCEEDS LOOKAHEAD CUSHION' : '';
      console.log(`[FK PERF] applySectionState "${sectionId}" — ${tag}: ${total.toFixed(1)}ms total${flag}`);
    }
  }

  _getActiveSongMode() {
    if (!this.presetManager.activeSongId) return 'trigger';
    const song = this.presetManager.getSong(this.presetManager.activeSongId);
    return song ? (song.transitionMode || 'flow') : 'trigger';
  }

  _hasTempoModules(state) {
    if (!state) return false;
    if (state.modules) {
      return state.modules.some(m => m.active && (m.type === 'arp' || m.type === 'percussion' || m.type === 'looper'));
    }
    return ['arpToggle', 'kickToggle', 'snareToggle', 'shakerToggle'].some(k => state[k] === true);
  }

  // Wire up looper module callbacks after it is instantiated or rendered.
  // Safe to call multiple times — callbacks are replaced idempotently.
  _wireLooperCallbacks(instanceId, mod) {
    mod.onLooperStateChange = (state) => {
      this.modulesGrid._updateLooperCard(instanceId, state);
    };
    mod.onProgress = (fill, head) => {
      this.modulesGrid._updateLooperProgress(instanceId, fill, head);
    };
  }

  // Returns milliseconds until the next bar boundary based on the current clock position.
  _getMsToNextBar() {
    const clock = this.engine.clock;
    if (!clock.isRunning) return 0;
    const msPerPulse = (60000 / clock.bpm) / clock.ppq;
    const pulsesIntoBar = clock.step % clock.pulsesPerBar;
    const pulsesRemaining = pulsesIntoBar === 0 ? clock.pulsesPerBar : (clock.pulsesPerBar - pulsesIntoBar);
    return pulsesRemaining * msPerPulse;
  }

  // For keyboard modules in the destination section that have fadeMode='auto',
  // start a mod wheel transition right now so it arrives at the target value
  // exactly when the bar boundary fires and the section actually applies.
  _tryPreemptiveModWheelFade(songId, sectionId) {
    if (!this.engine.clock.isRunning) return;
    const msToNextBar = this._getMsToNextBar();
    if (msToNextBar < 50) return; // bar boundary too close — skip preemptive
    const nextState = this.presetManager.getSectionData(songId, sectionId);
    if (!nextState?.modules) return;
    for (const nextMod of nextState.modules) {
      if (nextMod.type !== 'keyboard' || !nextMod.config) continue;
      if ((nextMod.config.fadeMode || 'manual') !== 'auto') continue;
      const kbInstance = this.moduleInstances.get(nextMod.id);
      if (!kbInstance?.isActive) continue;
      kbInstance.startPreemptiveTransition(nextMod.config.modWheel ?? 0, msToNextBar);
    }
  }

  _checkFlowClockStop() {
    if (this._getActiveSongMode() !== 'flow' || !this.engine.clock.isRunning) return;

    const anyTempoActive = this.engine.modules.some(m => m.isTempoBased && m.isActive);
    if (!anyTempoActive) {
      this.engine.clock.stop();
      this._clockNeedsReset = true;
    }
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  triggerPanicVisual() {
    this.ui.panicBtn.style.transform = 'scale(0.95)';
    setTimeout(() => {
      this.ui.panicBtn.style.transform = '';
    }, 150);
  }

  // ── Context Menu Actions ──────────────────────────────────────────────────

  pasteModuleConfig(instanceId, config) { return this.contextActions.pasteModuleConfig(instanceId, config); }
  applyModuleConfigToAllSections(instanceId) { return this.contextActions.applyModuleConfigToAllSections(instanceId); }
  duplicateModule(instanceId) { return this.contextActions.duplicateModule(instanceId); }
  resetModuleToDefaults(instanceId) { return this.contextActions.resetModuleToDefaults(instanceId); }
  startModuleRename(instanceId) { return this.contextActions.startModuleRename(instanceId); }
  startSectionRename(sectionId) { return this.contextActions.startSectionRename(sectionId); }
  deleteSectionWithConfirm(sectionId) { return this.contextActions.deleteSectionWithConfirm(sectionId); }
  duplicateSection(sectionId) { return this.contextActions.duplicateSection(sectionId); }
  startSongRename(songId) { return this.contextActions.startSongRename(songId); }
  duplicateSong(songId) { return this.contextActions.duplicateSong(songId); }
  deleteSongWithConfirm(songId) { return this.contextActions.deleteSongWithConfirm(songId); }

}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

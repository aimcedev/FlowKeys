import { SequencerUI } from '../components/sequencer.js';
import { FreqVisualizer } from '../components/freqVisualizer.js';
import { LooperVisualizer } from '../components/looperVisualizer.js';
import { NoteActivityViz } from '../components/noteActivityViz.js';
import { LEGACY_MODULE_IDS } from '../state/stateSchema.js';
import { PresetDropdown } from './presetDropdown.js';
import { getCatalogEntry } from '../flow-rail/flowRailCatalog.js';

export class ModulesGridController {
  constructor(app) {
    this.app = app;
    this._presetDropdown = null;
    this._activeMeters = new Map();
    this._animationFrameId = null;
    this._freqVizs       = new Map(); // oscilloscope waveform (bass, pad, swell)
    this._noteActivityVizs = new Map(); // note-bar display (keyboard)
    this._looperVizs     = new Map();
    this._drumGridControllers = new Map(); // AbortControllers for drum-grid drag listeners
    this._muteVolumes      = new Map();   // runtime mute — not saved to state
    this._soloMutedVolumes = new Map();   // volumes silenced by solo
    this._soloId           = null;         // currently soloed instance id
  }

  attachListeners() {
    this._presetDropdown = new PresetDropdown(this.app, this);

    const grid = document.querySelector('.modules-grid');
    if (grid) {
      grid.addEventListener('change', (e) => {
        const card = e.target.closest('[data-instance-id]');
        if (!card) return;
        const instanceId = card.dataset.instanceId;
        const control = e.target.dataset.control;
        if (!instanceId || !control) return;
        this.app.flowRail?.markUserDirty(instanceId, control);
        this._handleModuleControlChange(instanceId, control, e.target);
      });

      // Live controls (mod wheel & volume fader): update display and stream CC while dragging
      grid.addEventListener('input', (e) => {
        const control = e.target.dataset.control;
        if (control !== 'modWheel' && control !== 'volume' && control !== 'swing' && control !== 'humanize') return;
        const card = e.target.closest('[data-instance-id]');
        if (!card) return;
        this.app.flowRail?.markUserDirty(card.dataset.instanceId, control);
        
        if (control === 'modWheel') {
          const display = card.querySelector('[data-mod-display]');
          if (display) display.textContent = e.target.value;
          const modInstance = this.app.moduleInstances.get(card.dataset.instanceId);
          if (modInstance) modInstance.setModWheelImmediate(parseInt(e.target.value, 10));
        } else if (control === 'volume') {
          const val = parseInt(e.target.value, 10);
          const display = card.querySelector('[data-volume-display]');
          if (display) display.textContent = this._midiTodB(val);
          const fillEl = card.querySelector('[data-control="fader-fill"]');
          if (fillEl) fillEl.style.height = `${(val / 127) * 120}px`;
          const isMuted = card.querySelector('.cs-mute-btn')?.classList.contains('active');
          if (!isMuted) {
            const modInstance = this.app.moduleInstances.get(card.dataset.instanceId);
            if (modInstance) modInstance.setVolumeImmediate(val);
          }
        } else if (control === 'swing' || control === 'humanize') {
          const modInstance = this.app.moduleInstances.get(card.dataset.instanceId);
          if (modInstance) {
            modInstance.setConfig(
              this.app._getModuleEl(card.dataset.instanceId, 'chan')?.value || 10,
              this.app._getModuleEl(card.dataset.instanceId, 'swing')?.value || 0,
              this.app._getModuleEl(card.dataset.instanceId, 'humanize')?.value || 15
            );
          }
        }
      });

      grid.addEventListener('click', async (e) => {
        // ── Mute button ──────────────────────────────────────────────────────
        const muteBtn = e.target.closest('[data-control="mute"]');
        if (muteBtn) {
          const card = muteBtn.closest('[data-instance-id]');
          if (!card) return;
          const instanceId = card.dataset.instanceId;
          const isMuted = muteBtn.classList.toggle('active');
          muteBtn.setAttribute('aria-pressed', String(isMuted));
          const mod = this.app.moduleInstances.get(instanceId);
          if (mod) {
            if (isMuted) {
              // Clear solo on this module if it was active
              if (this._soloId === instanceId) {
                const soloBtn = card.querySelector('[data-control="solo"]');
                soloBtn?.classList.remove('active');
                soloBtn?.setAttribute('aria-pressed', 'false');
                this._soloId = null;
                this._soloMutedVolumes.forEach((vol, otherId) => {
                  const otherCard = document.querySelector(`.modules-grid [data-instance-id="${otherId}"]`);
                  if (!otherCard?.querySelector('.cs-mute-btn')?.classList.contains('active')) {
                    this.app.moduleInstances.get(otherId)?.setVolumeImmediate(vol);
                  }
                });
                this._soloMutedVolumes.clear();
              }
              const fader = card.querySelector('[data-control="volume"]');
              this._muteVolumes.set(instanceId, parseInt(fader?.value || '100', 10));
              mod.setVolumeImmediate(0);
            } else {
              const faderVol = parseInt(card.querySelector('[data-control="volume"]')?.value || '100', 10);
              this._muteVolumes.delete(instanceId);
              // Only restore if not silenced by an active solo
              if (this._soloId === null || this._soloId === instanceId) {
                mod.setVolumeImmediate(faderVol);
              }
            }
          }
          return;
        }

        // ── Solo button ──────────────────────────────────────────────────────
        const soloBtn = e.target.closest('[data-control="solo"]');
        if (soloBtn) {
          const card = soloBtn.closest('[data-instance-id]');
          if (!card) return;
          const instanceId = card.dataset.instanceId;
          const wasSoloed = soloBtn.classList.contains('active');
          if (!wasSoloed) {
            this._soloId = instanceId;
            document.querySelectorAll('.modules-grid [data-instance-id]').forEach(otherCard => {
              const otherId = otherCard.dataset.instanceId;
              otherCard.querySelector('[data-control="solo"]')?.classList.remove('active');
              otherCard.querySelector('[data-control="solo"]')?.setAttribute('aria-pressed', 'false');
              if (otherId === instanceId) return;
              const fader = otherCard.querySelector('[data-control="volume"]');
              if (!this._soloMutedVolumes.has(otherId)) {
                this._soloMutedVolumes.set(otherId, parseInt(fader?.value || '100', 10));
              }
              this.app.moduleInstances.get(otherId)?.setVolumeImmediate(0);
            });
            soloBtn.classList.add('active');
            soloBtn.setAttribute('aria-pressed', 'true');
            // Clear mute on this module if it was active
            const muteBtn = card.querySelector('[data-control="mute"]');
            if (muteBtn?.classList.contains('active')) {
              muteBtn.classList.remove('active');
              muteBtn.setAttribute('aria-pressed', 'false');
              this._muteVolumes.delete(instanceId);
            }
            const myVol = parseInt(card.querySelector('[data-control="volume"]')?.value || '100', 10);
            this.app.moduleInstances.get(instanceId)?.setVolumeImmediate(myVol);
          } else {
            this._soloId = null;
            soloBtn.classList.remove('active');
            soloBtn.setAttribute('aria-pressed', 'false');
            this._soloMutedVolumes.forEach((vol, otherId) => {
              const otherCard = document.querySelector(`.modules-grid [data-instance-id="${otherId}"]`);
              if (!otherCard?.querySelector('.cs-mute-btn')?.classList.contains('active')) {
                this.app.moduleInstances.get(otherId)?.setVolumeImmediate(vol);
              }
            });
            this._soloMutedVolumes.clear();
          }
          return;
        }

        // Card tab (Main / Advanced / Instrument track)
        const tabBtn = e.target.closest('.card-tab-btn');
        if (tabBtn) {
          const card = tabBtn.closest('[data-instance-id]');
          if (!card) return;
          const instanceId = card.dataset.instanceId;
          const targetPanel = tabBtn.dataset.tab;
          card.querySelectorAll('.card-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn === tabBtn);
          });
          card.querySelectorAll('.card-tab-panel').forEach(panel => {
            panel.hidden = panel.dataset.panel !== targetPanel;
          });
          // For drums track tabs: update selectedTrackId so the position is remembered
          const modDesc = this.app._currentModules.find(m => m.id === instanceId);
          if (modDesc) {
            modDesc.activeTab = targetPanel;
            if (modDesc.type === 'drums' && targetPanel !== 'main' && targetPanel !== 'advanced') {
              const mod = this.app.moduleInstances.get(instanceId);
              if (mod) {
                if (targetPanel.startsWith('group-')) {
                  const groupIdx = parseInt(targetPanel.replace('group-', ''), 10);
                  const PAGE_SIZE = 4;
                  const firstTrackInGroup = mod.tracks[groupIdx * PAGE_SIZE];
                  if (firstTrackInGroup) {
                    mod.selectedTrackId = firstTrackInGroup.id;
                  }
                } else {
                  mod.selectedTrackId = targetPanel;
                }
                this.app.saveState();
              }
            }
          }
          return;
        }

        // Open preset dropdown
        const presetMenuBtn = e.target.closest('[data-action="open-preset-menu"]');
        if (presetMenuBtn) {
          const card = presetMenuBtn.closest('[data-instance-id]');
          if (!card) return;
          const instanceId = card.dataset.instanceId;
          const modDesc = this.app._currentModules.find(m => m.id === instanceId);
          const type = modDesc?.type;
          if (!type) return;
          this._presetDropdown.toggle(presetMenuBtn, instanceId, type);
          return;
        }

        // Looper ARM button
        const looperArmBtn = e.target.closest('[data-action="looper-arm"]');
        if (looperArmBtn) {
          const card = looperArmBtn.closest('[data-instance-id]');
          if (!card) return;
          const mod = this.app.moduleInstances.get(card.dataset.instanceId);
          mod?.arm();
          return;
        }

        // Looper CLEAR button
        const looperClearBtn = e.target.closest('[data-action="looper-clear"]');
        if (looperClearBtn) {
          const card = looperClearBtn.closest('[data-instance-id]');
          if (!card) return;
          const mod = this.app.moduleInstances.get(card.dataset.instanceId);
          mod?.clear();
          return;
        }

        // ── Drums Specific Click Actions ─────────────────────────────────────
        const muteTrackBtn = e.target.closest('[data-action="drums-mute"]');
        if (muteTrackBtn) {
          const card = muteTrackBtn.closest('[data-instance-id]');
          if (card) {
            const instanceId = card.dataset.instanceId;
            const trackId = muteTrackBtn.dataset.trackId;
            const mod = this.app.moduleInstances.get(instanceId);
            if (mod) {
              const track = mod.tracks.find(t => t.id === trackId);
              if (track) {
                track.muted = !track.muted;
                // Update all mute buttons for this track (tracker panel + table)
                card.querySelectorAll(`[data-action="drums-mute"][data-track-id="${trackId}"]`).forEach(btn => {
                  btn.classList.toggle('muted', track.muted);
                });
                this.app.saveState();
              }
            }
          }
          return;
        }

        const soloTrackBtn = e.target.closest('[data-action="drums-solo"]');
        if (soloTrackBtn) {
          const card = soloTrackBtn.closest('[data-instance-id]');
          if (card) {
            const instanceId = card.dataset.instanceId;
            const trackId = soloTrackBtn.dataset.trackId;
            const mod = this.app.moduleInstances.get(instanceId);
            if (mod) {
              const track = mod.tracks.find(t => t.id === trackId);
              if (track) {
                track.soloed = !track.soloed;
                // Toggle active class on all solo buttons for this track
                card.querySelectorAll(`[data-action="drums-solo"][data-track-id="${trackId}"]`).forEach(btn => {
                  btn.classList.toggle('active', track.soloed);
                });
                this.app.saveState();
              }
            }
          }
          return;
        }

        const drumsTabBtn = e.target.closest('.drums-tab');
        if (drumsTabBtn) {
          const card = drumsTabBtn.closest('[data-instance-id]');
          if (card) {
            const instanceId = card.dataset.instanceId;
            const trackId = drumsTabBtn.dataset.firstTrackId;
            const mod = this.app.moduleInstances.get(instanceId);
            if (mod) {
              mod.selectedTrackId = trackId;
              this.refreshDrumsUI(instanceId);
              this.app.saveState();
            }
          }
          return;
        }

        const auditionTrackBtn = e.target.closest('[data-action="drums-audition"]');
        if (auditionTrackBtn) {
          const card = auditionTrackBtn.closest('[data-instance-id]');
          if (card) {
            const instanceId = card.dataset.instanceId;
            const trackId = auditionTrackBtn.dataset.trackId;
            const mod = this.app.moduleInstances.get(instanceId);
            if (mod) {
              const track = mod.tracks.find(t => t.id === trackId);
              if (track) {
                mod.midi.sendNoteOn(mod.channel, track.note, 100);
                setTimeout(() => { mod.midi.sendNoteOff(mod.channel, track.note); }, 100);
              }
            }
          }
          return;
        }

        const addTrackBtn = e.target.closest('[data-action="drums-add"]');
        if (addTrackBtn) {
          const card = addTrackBtn.closest('[data-instance-id]');
          if (card) {
            const instanceId = card.dataset.instanceId;
            const mod = this.app.moduleInstances.get(instanceId);
            if (mod) {
              const newTrack = mod.addTrack();
              if (newTrack) {
                // Switch to the new track tab after rebuild
                mod.selectedTrackId = newTrack.id;
                // Snapshot current config, rebuild only this specific card to prevent flashing, re-apply config
                const existingConfigs = this.app.getCurrentStateData().modules;
                const modDesc = this.app._currentModules.find(m => m.id === instanceId);
                if (modDesc) {
                  modDesc.activeTab = 'advanced';
                  const newCard = this.app._buildModuleCardElement(modDesc);
                  
                  // Clear old drum grid controllers
                  this._drumGridControllers.forEach((ctrl, key) => {
                    if (key.startsWith(`${instanceId}::`)) {
                      ctrl.abort();
                      this._drumGridControllers.delete(key);
                    }
                  });
                  
                  const oldViz = this._noteActivityVizs.get(instanceId);
                  if (oldViz) {
                    oldViz.destroy();
                    this._noteActivityVizs.delete(instanceId);
                  }
                  card.replaceWith(newCard);
                  this.app.populateNoteSelects();
                  this._initDrumsGrid(instanceId);
                  const waveColor = getComputedStyle(document.documentElement)
                    .getPropertyValue('--accent-cyan').trim() || '#00e5ff';
                  const container = this.app._getModuleEl(instanceId, 'freq-viz');
                  const canvas    = container?.querySelector('.freq-viz-canvas');
                  if (canvas) {
                    const viz = new NoteActivityViz(canvas, waveColor);
                    this._noteActivityVizs.set(instanceId, viz);
                    this._updateDrumsVizRange(instanceId);
                  }
                  this.app.moduleRegistry.applyConfigs(existingConfigs);
                  this.app.saveState();
                }
              } else {
                this.app.uiManager.showToast('Max 12 tracks reached.');
              }
            }
          }
          return;
        }

        const removeTrackBtn = e.target.closest('[data-action="drums-remove"]');
        if (removeTrackBtn) {
          const card = removeTrackBtn.closest('[data-instance-id]');
          if (card) {
            const instanceId = card.dataset.instanceId;
            const trackId = removeTrackBtn.dataset.trackId;
            const mod = this.app.moduleInstances.get(instanceId);
            if (mod) {
              if (mod.tracks.length <= 1) {
                this.app.uiManager.showToast('Minimum 1 track required.');
                return;
              }
              mod.removeTrack(trackId);
              // Snapshot current config, rebuild only this specific card, re-apply config
              const existingConfigs = this.app.getCurrentStateData().modules;
              const modDesc = this.app._currentModules.find(m => m.id === instanceId);
              if (modDesc) {
                modDesc.activeTab = 'advanced';
                const newCard = this.app._buildModuleCardElement(modDesc);
                
                // Clear old drum grid controllers
                this._drumGridControllers.forEach((ctrl, key) => {
                  if (key.startsWith(`${instanceId}::`)) {
                    ctrl.abort();
                    this._drumGridControllers.delete(key);
                  }
                });
                
                const oldViz = this._noteActivityVizs.get(instanceId);
                if (oldViz) {
                  oldViz.destroy();
                  this._noteActivityVizs.delete(instanceId);
                }
                card.replaceWith(newCard);
                this.app.populateNoteSelects();
                this._initDrumsGrid(instanceId);
                const waveColor = getComputedStyle(document.documentElement)
                  .getPropertyValue('--accent-cyan').trim() || '#00e5ff';
                const container = this.app._getModuleEl(instanceId, 'freq-viz');
                const canvas    = container?.querySelector('.freq-viz-canvas');
                if (canvas) {
                  const viz = new NoteActivityViz(canvas, waveColor);
                  this._noteActivityVizs.set(instanceId, viz);
                  this._updateDrumsVizRange(instanceId);
                }
                this.app.moduleRegistry.applyConfigs(existingConfigs);
                this.app.saveState();
              }
            }
          }
          return;
        }

        // Remove module
        const removeBtn = e.target.closest('[data-action="remove"]');
        if (!removeBtn) return;
        const card = removeBtn.closest('[data-instance-id]');
        if (!card) return;
        const instanceId = card.dataset.instanceId;
        const modDesc = this.app._currentModules.find(m => m.id === instanceId);
        const confirmed = await this.app.uiManager.confirmModal(
          `Remove ${modDesc?.label ?? 'this'} module?`,
          'This cannot be undone.'
        );
        if (confirmed) this.app.removeModule(instanceId);
      });

      grid.addEventListener('dblclick', (e) => {
        const dbReadout = e.target.closest('.db-readout');
        if (dbReadout) {
          e.preventDefault();
          const card = dbReadout.closest('[data-instance-id]');
          if (!card) return;
          const instanceId = card.dataset.instanceId;
          const slider = card.querySelector('[data-control="volume"]');
          if (!slider) return;
          
          const currentVal = parseInt(slider.value, 10);
          
          this._startVolumeInlineEdit(dbReadout, currentVal, (newVolume) => {
            slider.value = newVolume;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
          });
          return;
        }

        const panKnob = e.target.closest('[data-control="pan"]');
        if (panKnob) {
          e.preventDefault();
          const card = panKnob.closest('[data-instance-id]');
          const newVal = 64;
          panKnob.dataset.panValue = newVal;
          const body = panKnob.querySelector('.cs-pan-knob-body');
          if (body) body.style.transform = 'rotate(0deg)';
          if (card) {
            const chan = parseInt(card.querySelector('[data-control="chan"]')?.value || '1', 10);
            this.app.midi.sendCC(chan, 10, newVal);
          }
          return;
        }

        const dknob = e.target.closest('[data-knob]');
        if (dknob) {
          e.preventDefault();
          const card = dknob.closest('[data-instance-id]');
          const key = dknob.dataset.knobFor;
          const input = card?.querySelector(`input[data-control="${key}"]`);
          if (input) {
            this._setDrumsKnob(dknob, input, parseInt(dknob.dataset.knobDefault, 10) || 0);
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return;
        }

        const control = e.target.dataset.control;
        if (control === 'volume') {
          e.preventDefault();
          e.target.value = 100;
          e.target.dispatchEvent(new Event('input', { bubbles: true }));
          e.target.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }

        const moduleTitleDiv = e.target.closest('.module-title');
        if (!moduleTitleDiv) return;
        const card = moduleTitleDiv.closest('[data-instance-id]');
        if (!card) return;
        const instanceId = card.dataset.instanceId;
        const modDesc = this.app._currentModules.find(m => m.id === instanceId);
        if (!modDesc) return;

        const h3 = moduleTitleDiv.querySelector('h3');
        if (!h3) return;

        this.app.uiManager._startInlineEdit(h3, modDesc.label, (newName) => {
          modDesc.label = newName;
          h3.textContent = newName;
          this.app.saveState();
          const _renSongId = this.app.presetManager.activeSongId;
          const _renSectionId = this.app.presetManager.activeSectionId;
          if (_renSongId && _renSectionId) {
            this.app.presetManager.propagateModuleRename(_renSongId, _renSectionId, instanceId, newName);
            if (this.app.uiManager.updateAllSectionBadges) {
              this.app.uiManager.updateAllSectionBadges();
            }
          }
        });
      });

      this.app.dragDrop.attachCardDrag();

      // ── Pan knob drag ────────────────────────────────────────────────────
      grid.addEventListener('mousedown', (e) => {
        const knob = e.target.closest('[data-control="pan"]');
        if (!knob) return;
        e.preventDefault();
        const card = knob.closest('[data-instance-id]');
        const startY  = e.clientY;
        const startVal = parseInt(knob.dataset.panValue || '64', 10);

        const onMove = (me) => {
          const delta  = startY - me.clientY;  // drag up → right pan
          const newVal = Math.max(0, Math.min(127, Math.round(startVal + delta)));
          knob.dataset.panValue = newVal;
          const rotation = ((newVal - 64) / 63) * 150;
          const body = knob.querySelector('.cs-pan-knob-body');
          if (body) body.style.transform = `rotate(${rotation}deg)`;
          if (card) {
            const chan = parseInt(card.querySelector('[data-control="chan"]')?.value || '1', 10);
            this.app.midi.sendCC(chan, 10, newVal);
          }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', () => document.removeEventListener('mousemove', onMove), { once: true });
      });

      // ── Drums knob drag (Swing / Humanize) ───────────────────────────────
      grid.addEventListener('mousedown', (e) => {
        const knob = e.target.closest('[data-knob]');
        if (!knob) return;
        e.preventDefault();
        const card = knob.closest('[data-instance-id]');
        const key = knob.dataset.knobFor;
        const input = card?.querySelector(`input[data-control="${key}"]`);
        if (!input) return;
        const startY = e.clientY;
        const startVal = parseInt(input.value, 10) || 0;
        const onMove = (me) => this._setDrumsKnob(knob, input, startVal + (startY - me.clientY));
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp, { once: true });
      });

      // Right-click: catalogued parameter → Add Flow Point; otherwise module menu
      grid.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('[data-instance-id]');
        if (!card) return;
        e.preventDefault();
        const instanceId = card.dataset.instanceId;
        const controlEl = e.target.closest('[data-control]');
        let control = controlEl?.dataset.control;
        if (control === 'fader-fill' || e.target.closest('.fader-container, .fader-area')) {
          control = 'volume';
        }
        const desc = this.app._currentModules.find(m => m.id === instanceId);
        if (control && desc && getCatalogEntry(desc.type, control)) {
          this.app.contextMenu.open(e, instanceId, 'flowParam', { control });
          return;
        }
        this.app.contextMenu.open(e, instanceId, 'module');
      });
    }
  }

  renderModules(modules) {
    const grid = document.querySelector('.modules-grid');
    if (!grid) return;

    // Clean up active meters and cancel animation frames to prevent memory leaks
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
    this._activeMeters.clear();

    // Destroy old visualizer instances
    this._freqVizs.forEach(viz => viz.destroy());
    this._freqVizs.clear();
    this._noteActivityVizs.forEach(viz => viz.destroy());
    this._noteActivityVizs.clear();
    this._looperVizs.forEach(viz => viz.destroy());
    this._looperVizs.clear();

    // Destroy old sequencer instances to remove their global event listeners
    this.app.sequencers.forEach(seq => seq.destroy());
    this.app.sequencers.clear();

    // Tear down drum-grid drag listeners bound to document
    this._drumGridControllers.forEach(ctrl => ctrl.abort());
    this._drumGridControllers.clear();

    // Render card elements
    grid.innerHTML = '';
    for (const mod of modules) {
      grid.appendChild(this.app._buildModuleCardElement(mod));
    }

    // Populate note selects inside the freshly rendered cards
    this.app.populateNoteSelects();

    // Wire looper callbacks after render (card elements now exist in DOM)
    for (const mod of modules) {
      if (mod.type === 'looper') {
        const modInstance = this.app.moduleInstances.get(mod.id);
        if (modInstance) this.app._wireLooperCallbacks(mod.id, modInstance);
      }
    }

    // Drums use a bespoke multi-row grid (not a single SequencerUI)
    for (const mod of modules) {
      if (mod.type === 'drums') this._initDrumsGrid(mod.id);
    }

    // Create SequencerUI instances for single-track step modules
    for (const mod of modules) {
      if (mod.type === 'arp' || mod.type === 'percussion') {
        const container = this.app._getModuleEl(mod.id, 'seq');
        if (!container) continue;
        const modInstance = this.app.moduleInstances.get(mod.id);
        const stepsCount = this.app.engine.clock.timeSignature === '4/4' ? 16 : 12;
        const seqUI = new SequencerUI(container, {
          steps: stepsCount,
          onChange: (seq) => { modInstance?.setSequence(seq); this.app.saveState(); }
        });
        this.app.sequencers.set(mod.id, seqUI);
        modInstance?.onStep(idx => seqUI.setCurrentStep(idx));
      }
    }

    // Single phosphor colour for ALL oscilloscope waveforms — one consistent look
    const waveColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-cyan').trim() || '#00e5ff';

    // Oscilloscope (FreqVisualizer): bass, pad, swell
    const oscTypes = new Set(['bass', 'pad', 'swell']);
    for (const mod of modules) {
      if (!oscTypes.has(mod.type)) continue;
      const container = this.app._getModuleEl(mod.id, 'freq-viz');
      const canvas    = container?.querySelector('.freq-viz-canvas');
      if (!canvas) continue;
      const viz = new FreqVisualizer(canvas, { color: waveColor });
      this._freqVizs.set(mod.id, viz);

      // Seed pad notes immediately — pad plays fixed notes, not keyboard input
      if (mod.type === 'pad') {
        const padMod = this.app.moduleInstances.get(mod.id);
        if (padMod?.playingNotes?.length) {
          viz.setActiveNotes(padMod.playingNotes);
          viz.setActivity(0.65);
        }
      }
    }

    // Note-bar activity display (NoteActivityViz): keyboard & drums modules
    for (const mod of modules) {
      if (mod.type !== 'keyboard' && mod.type !== 'drums') continue;
      const container = this.app._getModuleEl(mod.id, 'freq-viz');
      const canvas    = container?.querySelector('.freq-viz-canvas');
      if (!canvas) continue;
      const viz = new NoteActivityViz(canvas, waveColor);
      this._noteActivityVizs.set(mod.id, viz);
      if (mod.type === 'drums') {
        this._updateDrumsVizRange(mod.id);
      }
    }

    // Create LooperVisualizer instances for looper modules
    const looperColor = getComputedStyle(document.documentElement).getPropertyValue('--color-looper').trim() || '#ff6b35';
    for (const mod of modules) {
      if (mod.type !== 'looper') continue;
      const card   = this.app._getModuleCard(mod.id);
      const canvas = card?.querySelector('.looper-viz-canvas');
      if (!canvas) continue;
      const viz = new LooperVisualizer(canvas, looperColor);
      this._looperVizs.set(mod.id, viz);
    }
  }

  readModuleFromDom({ id, type, label }) {
    const val = (c) => this.app._getModuleEl(id, c)?.value ?? '';
    const checked = (c) => this.app._getModuleEl(id, c)?.checked ?? false;
    const stepsPerBar = this.app.engine.clock.timeSignature === '4/4' ? 16 : 12;
    const seq = () => this.app.sequencers.get(id)?.getVelocities() ?? new Array(stepsPerBar).fill(0);

    const entry = { id, type, label, active: checked('toggle') };
    const parsedVolume = parseInt(val('volume'), 10);
    const volVal = Number.isFinite(parsedVolume) ? parsedVolume : 100;

    if (type === 'bass') {
      entry.config = { chan: val('chan'), inMin: val('inMin'), inMax: val('inMax'), outMin: val('outMin'), outMax: val('outMax'), volume: volVal };
    } else if (type === 'arp') {
      entry.config = { chan: val('chan'), mode: val('mode'), notes: val('notes'), seq: seq(), volume: volVal };
    } else if (type === 'percussion') {
      entry.config = { chan: val('chan'), note: val('note'), seq: seq(), volume: volVal };
    } else if (type === 'pad') {
      entry.config = { chan: val('chan'), key: val('key'), volume: volVal };
    } else if (type === 'keyboard') {
      entry.config = {
        chan: val('chan'),
        octave: val('octave'),
        inversion: val('inversion'),
        filterMode: val('filterMode'),
        filterCount: val('filterCount'),
        modWheel: val('modWheel'),
        transitionMs: val('transitionMs'),
        fadeMode: val('fadeMode'),
        fadeCurve: val('fadeCurve'),
        volume: volVal,
      };
    } else if (type === 'looper') {
      entry.config = { chan: val('chan'), bars: val('bars'), quantize: val('quantize'), volume: volVal };
    } else if (type === 'swell') {
      entry.config = {
        chan: val('chan'), selectMode: val('selectMode'),
        outMin: val('outMin'), outMax: val('outMax'),
        density: val('density'), attackMs: val('attackMs'), holdMs: val('holdMs'),
        releaseMs: val('releaseMs'), curve: val('curve'),
        whammy: val('whammy'), whammyChance: val('whammyChance'),
        whammySpeed: val('whammySpeed'), whammyDouble: val('whammyDouble'),
        autoRate: val('autoRate'), vary: val('vary'),
        volume: volVal,
      };
    } else if (type === 'drums') {
      const modInstance = this.app.moduleInstances.get(id);
      entry.config = {
        chan: val('chan'),
        swing: val('swing'),
        humanize: val('humanize'),
        selectedTrackId: modInstance ? modInstance.selectedTrackId : 'kick',
        tracks: modInstance ? modInstance.tracks.map(t => ({
          id: t.id,
          name: t.name,
          note: t.note,
          seq: [...t.seq],
          muted: t.muted,
          soloed: !!t.soloed
        })) : [],
        volume: volVal
      };
    } else {
      entry.config = { volume: volVal };
    }

    return entry;
  }

  _syncModuleConfigFromDom(id, type) {
    const mod = this.app.moduleInstances.get(id);
    if (!mod) return;
    const val = (c) => this.app._getModuleEl(id, c)?.value ?? '';

    if (type === 'bass') {
      mod.setConfig(val('chan'), val('inMin'), val('inMax'), val('outMin'), val('outMax'));
    } else if (type === 'arp') {
      mod.setConfig(val('chan'), val('notes'), val('mode'));
    } else if (type === 'percussion') {
      mod.setConfig(val('chan'), val('note'), mod.humanize);
    } else if (type === 'pad') {
      const keyVal = val('key');
      const rootNote = keyVal === 'song' ? 60 + this.app._currentSongKey : parseInt(keyVal, 10);
      mod.setConfig(val('chan'), rootNote);
    } else if (type === 'keyboard') {
      mod.setConfig(
        val('chan'),
        val('octave'),
        '0',    // inversion — removed from UI
        'none', // filterMode — removed from UI
        '1',    // filterCount — removed from UI
        val('modWheel'),
        val('transitionMs'),
        val('fadeMode'),
        val('fadeCurve'),
      );
    } else if (type === 'looper') {
      mod.setConfig(val('chan'), val('bars'), val('quantize'));
    } else if (type === 'swell') {
      mod.setConfig(
        val('chan'), val('selectMode'), val('outMin'), val('outMax'),
        val('density'), val('attackMs'), val('holdMs'), val('releaseMs'),
        val('curve'), val('whammy'), val('whammyChance'),
        val('whammySpeed'), val('whammyDouble'),
        val('autoRate'), val('vary')
      );
    } else if (type === 'drums') {
      mod.setConfig(val('chan'), val('swing'), val('humanize'));
    }
  }

  // ── Looper card DOM update helpers ─────────────────────────────────────────

  _updateLooperCard(instanceId, looperState) {
    const card = this.app._getModuleCard(instanceId);
    if (!card) return;

    const statusEl = card.querySelector('[data-looper-status]');
    const btnLabel = card.querySelector('[data-looper-btn-label]');
    const led      = card.querySelector('[data-looper-led]');
    const armBtn   = card.querySelector('[data-action="looper-arm"]');

    const map = {
      idle:      { status: 'IDLE',    btn: 'ARM',    led: '',            cls: '' },
      armed:     { status: 'ARMED',   btn: 'CANCEL', led: 'led-armed',   cls: 'looper-armed' },
      recording: { status: 'REC',     btn: 'STOP',   led: 'led-rec',     cls: 'looper-recording' },
      playing:   { status: 'LOOPING', btn: 'RE-ARM', led: 'led-playing', cls: 'looper-playing' },
    };
    const cfg = map[looperState] || map.idle;

    if (statusEl) statusEl.textContent = cfg.status;
    if (btnLabel) btnLabel.textContent = cfg.btn;
    if (led) led.className = `looper-led ${cfg.led}`;

    card.classList.remove('looper-armed', 'looper-recording', 'looper-playing');
    if (cfg.cls) card.classList.add(cfg.cls);

    if (armBtn) armBtn.dataset.looperState = looperState;

    // Update canvas visualizer
    const viz = this._looperVizs.get(instanceId);
    if (viz) {
      viz.setState(looperState);
      if (looperState === 'playing') {
        const mod = this.app.moduleInstances.get(instanceId);
        const snapshot = mod?.getLoopSnapshot();
        if (snapshot) viz.setLoopData(snapshot.playEvents, snapshot.loopLengthPulses);
      }
      if (looperState === 'idle') viz.setProgress(0, 0);
    }
  }

  _updateLooperProgress(instanceId, fill, head) {
    const viz = this._looperVizs.get(instanceId);
    if (viz) viz.setProgress(fill, head);
  }

  _defaultPercussionCategory(instanceId) {
    if (instanceId === LEGACY_MODULE_IDS.snare) return 'snare';
    if (instanceId === LEGACY_MODULE_IDS.shaker) return 'shaker';
    return 'kick';
  }

  _loadPreset(instanceId, type, preset) {
    const mod = this.app.moduleInstances.get(instanceId);
    if (type === 'drums') {
      if (preset?.tracks) {
        mod?.setTracks(preset.tracks);
        this.refreshDrumsUI(instanceId);
      }
    } else {
      if (!preset?.seq) return;
      const seqUI = this.app.sequencers.get(instanceId);
      seqUI?.setVelocities(preset.seq);
      mod?.setSequence(preset.seq);
      if (type === 'arp') {
        if (preset.mode !== undefined) {
          const modeEl = this.app._getModuleEl(instanceId, 'mode');
          if (modeEl) { modeEl.value = preset.mode; this._syncModuleConfigFromDom(instanceId, 'arp'); }
        }
        if (preset.notes !== undefined) {
          const notesEl = this.app._getModuleEl(instanceId, 'notes');
          if (notesEl) { notesEl.value = preset.notes; this._syncModuleConfigFromDom(instanceId, 'arp'); }
        }
      }
    }
    this.app.saveState();
    this.app.uiManager.showToast(`Loaded "${preset.name}"`);
  }

  _handleModuleControlChange(instanceId, control, el) {
    const modDesc = this.app._currentModules.find(m => m.id === instanceId);
    if (!modDesc) return;
    const mod = this.app.moduleInstances.get(instanceId);
    if (!mod) return;

    if (control === 'toggle') {
      const active = el.checked;
      const card = this.app._getModuleCard(instanceId);
      if (mod.isTempoBased && active && this.app.engine.clock.isRunning) {
        mod.isActive = false;
        if (!this.app.pendingModuleActivations.includes(mod)) {
          this.app.pendingModuleActivations.push(mod);
        }
      } else {
        this.app.pendingModuleActivations = this.app.pendingModuleActivations.filter(m => m !== mod);
        mod.toggle(active);
      }
      if (card) card.classList.toggle('active', active);
      if (!active) this.app._checkFlowClockStop();
    } else if (control === 'drums-profile') {
      const profile = el.value;
      if (profile === 'custom') return;
      if (mod) {
        const mappings = {
          gm: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 },
          ez: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 },
          ad: { kick: 36, snare: 38, closedHat: 49, openHat: 51, clap: 39 },
          battery: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 },
          ssd: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 },
        }[profile];
        if (mappings) {
          mod.tracks.forEach(track => {
            if (mappings[track.id] !== undefined) {
              track.note = mappings[track.id];
            }
          });
          this.refreshDrumsUI(instanceId);
          this.app.saveState();
        }
      }
      return;
    } else {
      this._syncModuleConfigFromDom(instanceId, modDesc.type);
    }

    this.app.saveState();
  }

  /**
   * Convert 0–127 MIDI volume to dB string.
   * val 100 = 0.0 dB (snap/unity), val 127 = +6.0 dB, val 0 = -∞ dB.
   */
  _midiTodB(val) {
    if (val <= 0) return '-∞ dB';
    if (val <= 100) {
      // 0 → -∞, 100 → 0 dB  (logarithmic attenuation)
      const db = 20 * Math.log10(val / 100);
      return `${db.toFixed(1)} dB`;
    }
    // 100 → 0 dB, 127 → +6 dB  (linear boost range)
    const db = 6 * (val - 100) / 27;
    return `+${db.toFixed(1)} dB`;
  }

  _startVolumeInlineEdit(element, currentValue, onSave) {
    if (element.querySelector('.db-readout-input')) return; // already editing

    const displaySpan = element.querySelector('[data-volume-display]');
    const targetElement = displaySpan || element;
    const originalText = targetElement.textContent;
    targetElement.textContent = '';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '127';
    input.className = 'db-readout-input';
    input.value = currentValue;
    targetElement.appendChild(input);

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      let newVal = parseInt(input.value, 10);
      if (Number.isFinite(newVal)) {
        newVal = Math.max(0, Math.min(127, newVal));
        input.remove();
        onSave(newVal);
      } else {
        input.remove();
        targetElement.textContent = originalText;
      }
    };

    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        finished = true;
        input.removeEventListener('blur', commit);
        input.removeEventListener('keydown', onKeydown);
        input.remove();
        targetElement.textContent = originalText;
      }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', onKeydown);
  }

  triggerMeter(instanceId, velocity, hasActive) {
    const val = velocity / 127;
    const state = this._getMeterState(instanceId);
    if (!state) return;

    if (hasActive !== undefined) {
      state.hasActive = hasActive;
    }

    if (val > 0) {
      state.level = val;
      if (val >= state.peak) {
        state.peak = val;
        state.peakHoldUntil = performance.now() + 400; // Hold for 400ms
      }

      // Flash the title dot on each MIDI output event
      const card = this.app._getModuleCard(instanceId);
      const dot = card?.querySelector('.module-title-dot');
      if (dot) {
        dot.classList.remove('output-flash');
        void dot.offsetWidth; // reflow to restart animation
        dot.classList.add('output-flash');
      }
    }
    state.lastUpdateTime = performance.now();

    // Start animation loop if not already running
    if (!this._animationFrameId) {
      this._animationFrameId = requestAnimationFrame((now) => this._updateMeters(now));
    }

    const modType = this.app._currentModules.find(m => m.id === instanceId)?.type;

    // Oscilloscope freq visualizer (bass, pad, swell)
    const viz = this._freqVizs.get(instanceId);
    if (viz) {
      if (modType === 'pad') {
        // Pad plays its own fixed notes — not dependent on keyboard input
        const padMod = this.app.moduleInstances.get(instanceId);
        viz.setActiveNotes(padMod?.playingNotes ?? []);
        viz.setActivity(val);
      } else if (modType === 'swell') {
        // Swell notes are set on trigger; activity is driven continuously in _updateMeters
        const swellMod = this.app.moduleInstances.get(instanceId);
        viz.setActiveNotes(swellMod?._playingNotes ?? []);
        // Don't set activity here — _updateMeters tracks _currentExpression
      } else {
        viz.setActiveNotes([...(this.app.engine?.activeNotes?.keys() ?? [])]);
        viz.setActivity(val);
      }
    }

    // Note-bar activity viz (keyboard & drums)
    const noteViz = this._noteActivityVizs.get(instanceId);
    if (noteViz) {
      if (modType === 'drums') {
        const drumsMod = this.app.moduleInstances.get(instanceId);
        noteViz.setActiveNotes([...(drumsMod?.playingNotes ?? [])]);
      } else {
        noteViz.setActiveNotes([...(this.app.engine?.activeNotes?.keys() ?? [])]);
      }
    }
  }

  _getMeterState(instanceId) {
    if (this._activeMeters.has(instanceId)) {
      return this._activeMeters.get(instanceId);
    }
    const card = this.app._getModuleCard(instanceId);
    if (!card) return null;
    const barEl = card.querySelector('[data-control="meter-bar"]');
    const peakEl = card.querySelector('[data-control="meter-peak"]');
    if (!barEl || !peakEl) return null;

    const state = {
      level: 0,
      peak: 0,
      peakHoldUntil: 0,
      hasActive: false,
      barEl,
      peakEl,
      lastUpdateTime: performance.now()
    };
    this._activeMeters.set(instanceId, state);
    return state;
  }

  _updateMeters(now) {
    let hasActiveMeters = false;

    for (const [instanceId, state] of this._activeMeters.entries()) {
      const dt = (now - state.lastUpdateTime) / 1000;
      state.lastUpdateTime = now;

      // If active notes are held/sustained, keep meter at a minimum glow floor
      const floor = state.hasActive ? 0.22 : 0.0;

      // Decay level snappily, but clamp to floor
      if (state.level > floor) {
        state.level = Math.max(floor, state.level - dt * 2.5);
      } else if (state.level < floor) {
        state.level = floor;
      }

      // Decay peak: slower linear decay after hold duration, always >= current level
      if (now > state.peakHoldUntil) {
        state.peak = Math.max(state.level, state.peak - dt * 0.8);
      } else {
        state.peak = Math.max(state.peak, state.level);
      }

      // Render styles (scaleY is GPU-accelerated and highly responsive)
      state.barEl.style.transform = `scaleY(${state.level})`;
      state.peakEl.style.bottom = `${state.peak * 100}%`;

      if (state.level > 0 || state.peak > 0) {
        hasActiveMeters = true;
      }
    }

    // Continuously drive swell visualizer from live expression level so the
    // oscilloscope amplitude literally swells up and fades with the CC11 envelope.
    for (const [id, viz] of this._freqVizs) {
      const modDesc = this.app._currentModules.find(m => m.id === id);
      if (modDesc?.type !== 'swell') continue;
      const mod = this.app.moduleInstances.get(id);
      if (!mod) continue;
      viz.setActivity((mod._currentExpression || 0) / 127);
    }

    if (hasActiveMeters) {
      this._animationFrameId = requestAnimationFrame((now) => this._updateMeters(now));
    } else {
      this._animationFrameId = null;
    }
  }

  // ── Drums Module UI Helpers ──────────────────────────────────────────────

  _initDrumsGrid(instanceId) {
    const mod = this.app.moduleInstances.get(instanceId);
    if (!mod) return;
    this.refreshDrumsUI(instanceId);
    mod.onStep(idx => this._highlightDrumsStep(instanceId, idx));
  }

  refreshDrumsUI(instanceId) {
    const card = this.app._getModuleCard(instanceId);
    const mod = this.app.moduleInstances.get(instanceId);
    if (!card || !mod) return;

    // Render the sequencer grid for each track into its tracker panel
    card.querySelectorAll('.drums-tracker-panel[data-tracker-id]').forEach(container => {
      const trackId = container.dataset.trackerId;
      const track = mod.tracks.find(t => t.id === trackId);
      if (track) this._renderSingleDrumsTrack(instanceId, mod, track, container);
    });

    // Sync mute and solo button states in track panels
    mod.tracks.forEach(track => {
      card.querySelectorAll(`[data-action="drums-mute"][data-track-id="${track.id}"]`).forEach(btn => {
        btn.classList.toggle('muted', !!track.muted);
      });
      card.querySelectorAll(`[data-action="drums-solo"][data-track-id="${track.id}"]`).forEach(btn => {
        btn.classList.toggle('active', !!track.soloed);
      });
    });

    // Render the Advanced tab's kit map table
    const tbody = this.app._getModuleEl(instanceId, 'drums-tracks-body');
    if (tbody) this._renderDrumsTracksTable(instanceId, tbody);

    this._syncDrumsKnobs(instanceId);
    this._updateDrumsVizRange(instanceId);

    // Auto-select matching profile in dropdown
    const profileEl = this.app._getModuleEl(instanceId, 'drums-profile');
    if (profileEl) {
      const mappings = {
        gm: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 },
        ez: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 },
        ad: { kick: 36, snare: 38, closedHat: 49, openHat: 51, clap: 39 },
        battery: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 },
        ssd: { kick: 36, snare: 38, closedHat: 42, openHat: 46, clap: 39 }
      };
      
      let matchedProfile = 'custom';
      const matches = [];
      for (const [prof, map] of Object.entries(mappings)) {
        let isMatch = true;
        for (const track of mod.tracks) {
          if (map[track.id] !== undefined && track.note !== map[track.id]) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) {
          matches.push(prof);
        }
      }
      if (matches.length > 0) {
        matchedProfile = matches.includes(profileEl.value) ? profileEl.value : matches[0];
      }
      profileEl.value = matchedProfile;
    }
  }

  _updateDrumsVizRange(instanceId) {
    const viz = this._noteActivityVizs.get(instanceId);
    if (!viz) return;
    const mod = this.app.moduleInstances.get(instanceId);
    if (!mod || !mod.tracks || mod.tracks.length === 0) return;

    const trackNotes = mod.tracks.map(t => t.note);
    let minNote = Math.min(...trackNotes);
    let maxNote = Math.max(...trackNotes);

    const span = maxNote - minNote;
    if (span < 12) {
      const pad = Math.ceil((12 - span) / 2);
      minNote -= pad;
      maxNote += pad;
    } else {
      minNote -= 2;
      maxNote += 2;
    }

    viz.setNoteRange(minNote, maxNote);
  }

  // Reflect a value on a drum knob: rotate the indicator, update the readout,
  // write the hidden input, and stream the change to the module.
  // For 'volume' knob the range is 0-127 (MIDI), for others it is 0-100.
  _setDrumsKnob(knob, input, value) {
    const isVolume = knob.dataset.knobFor === 'volume';
    const maxVal = isVolume ? 127 : 100;
    const v = Math.max(0, Math.min(maxVal, Math.round(value)));
    input.value = v;
    const body = knob.querySelector('.cs-pan-knob-body');
    if (body) body.style.transform = `rotate(${(v / maxVal) * 270 - 135}deg)`;
    const card = knob.closest('[data-instance-id]');
    const valEl = card?.querySelector(`[data-knob-val-for="${knob.dataset.knobFor}"]`);
    if (valEl) valEl.textContent = isVolume ? this._midiTodB(v) : `${v}%`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _syncDrumsKnobs(instanceId) {
    const card = this.app._getModuleCard(instanceId);
    if (!card) return;
    card.querySelectorAll('.drums-knob').forEach(knob => {
      const input = card.querySelector(`input[data-control="${knob.dataset.knobFor}"]`);
      if (!input) return;
      const isVolume = knob.dataset.knobFor === 'volume';
      const maxVal = isVolume ? 127 : 100;
      const v = Math.max(0, Math.min(maxVal, parseInt(input.value, 10) || 0));
      const body = knob.querySelector('.cs-pan-knob-body');
      if (body) body.style.transform = `rotate(${(v / maxVal) * 270 - 135}deg)`;
      const valEl = card.querySelector(`[data-knob-val-for="${knob.dataset.knobFor}"]`);
      if (valEl) valEl.textContent = isVolume ? this._midiTodB(v) : `${v}%`;
    });
  }

  _highlightDrumsStep(instanceId, idx) {
    const card = this.app._getModuleCard(instanceId);
    if (!card) return;
    card.querySelectorAll('.drums-cell').forEach(cell => {
      cell.classList.toggle('current-step', parseInt(cell.dataset.stepIndex, 10) === idx);
    });
  }

  _setDrumsCellVelocity(track, index, cell, velocity) {
    const vel = Math.max(0, Math.min(127, Math.round(velocity)));
    track.seq[index] = vel;
    cell.classList.toggle('active', vel > 0);
    const fill = cell.querySelector('.drums-cell-fill');
    if (fill) fill.style.height = vel > 0 ? `${Math.round((vel / 127) * 100)}%` : '0%';
  }


  // Render a single track's full-size sequencer row into the given container.
  // Matches the percussion module sequencer look: 60px tall velocity-fill bars.
  _renderSingleDrumsTrack(instanceId, mod, track, container) {
    // Abort any existing drag controller for this specific container
    const containerKey = `${instanceId}::${track.id}`;
    this._drumGridControllers.get(containerKey)?.abort();
    this._drumGridControllers.delete(containerKey);

    const steps = mod.stepsPerBar || 16;

    // Pad / truncate sequence to current step count
    if (track.seq.length < steps) {
      track.seq = track.seq.concat(new Array(steps - track.seq.length).fill(0));
    } else if (track.seq.length > steps) {
      track.seq = track.seq.slice(0, steps);
    }

    container.innerHTML = '';

    // Step row (full width, percussion-style)
    const row = document.createElement('div');
    row.className = 'drums-track-row';
    row.dataset.trackId = track.id;

    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'drums-row-steps';

    for (let i = 0; i < steps; i++) {
      const vel = track.seq[i] || 0;
      const cell = document.createElement('div');
      cell.className = `drums-cell${vel > 0 ? ' active' : ''}`;
      cell.dataset.stepIndex = i;
      cell.dataset.trackId = track.id;
      const fill = document.createElement('div');
      fill.className = 'drums-cell-fill';
      fill.style.height = vel > 0 ? `${Math.round((vel / 127) * 100)}%` : '0%';
      cell.appendChild(fill);
      stepsContainer.appendChild(cell);
    }

    row.appendChild(stepsContainer);
    container.appendChild(row);

    this._attachDrumsRowDrag(instanceId, containerKey, mod, track, container);
  }

  // Per-track drag/paint handler scoped to one tracker panel.
  _attachDrumsRowDrag(instanceId, containerKey, mod, track, container) {
    const ctrl = new AbortController();
    this._drumGridControllers.set(containerKey, ctrl);
    const { signal } = ctrl;

    let drag = null;

    container.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.drums-cell');
      if (!cell || !container.contains(cell)) return;
      e.preventDefault();
      const index = parseInt(cell.dataset.stepIndex, 10);
      const startVel = track.seq[index] || 0;
      drag = { index, cell, startY: e.clientY, startVel, moved: false, mode: startVel > 0 ? 'pending' : 'paint' };
      if (startVel === 0) this._setDrumsCellVelocity(track, index, cell, 100);
    }, { signal });

    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dy = drag.startY - e.clientY;
      if (Math.abs(dy) > 3) drag.moved = true;

      if (drag.mode === 'paint') {
        const overEl = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.drums-cell');
        if (overEl && container.contains(overEl)) {
          const idx = parseInt(overEl.dataset.stepIndex, 10);
          if ((track.seq[idx] || 0) === 0) this._setDrumsCellVelocity(track, idx, overEl, 100);
        }
      } else if (drag.moved) {
        drag.mode = 'velocity';
        this._setDrumsCellVelocity(track, drag.index, drag.cell, Math.max(1, drag.startVel + dy));
      }
    }, { signal });

    document.addEventListener('mouseup', () => {
      if (!drag) return;
      if (drag.mode === 'pending' && !drag.moved) {
        this._setDrumsCellVelocity(track, drag.index, drag.cell, 0);
      }
      drag = null;
      this.app.saveState();
    }, { signal });
  }

  // Legacy tracker renderer kept for backward compatibility (not used in new tab layout).
  _renderDrumsTracksTable(instanceId, tbody) {
    const mod = this.app.moduleInstances.get(instanceId);
    if (!mod) return;
    tbody.innerHTML = '';

    mod.tracks.forEach(track => {
      const tr = document.createElement('tr');
      tr.dataset.trackId = track.id;
      tr.innerHTML = `
        <td><input type="text" class="drums-track-name-input" data-track-id="${track.id}" value="${track.name}" title="Instrument name" spellcheck="false"></td>
        <td><select class="drums-note-select" data-track-id="${track.id}" title="MIDI note">${this._buildNoteOptionsHtml(track.note)}</select></td>
        <td><button class="drums-action-btn" data-action="drums-audition" data-track-id="${track.id}" title="Audition" type="button">▶</button></td>
        <td><button class="drums-action-btn drums-delete-btn" data-action="drums-remove" data-track-id="${track.id}" title="Remove" type="button">×</button></td>
      `;

      tr.querySelector('.drums-track-name-input').addEventListener('change', (e) => {
        track.name = e.target.value;
        const card = this.app._getModuleCard(instanceId);
        if (card) {
          // Keep the grid row label in sync
          const label = card.querySelector(`.drums-row[data-track-id="${track.id}"] .drums-row-label`);
          if (label) { label.textContent = track.name; label.title = track.name; }
          const panelName = card.querySelector(`.drums-group-track[data-track-id="${track.id}"] .drums-track-panel-name`);
          if (panelName) { panelName.textContent = track.name; panelName.title = track.name; }
          // Keep the tab label in sync
          const tabLabel = card.querySelector(`.drums-tab[data-track-id="${track.id}"] .drums-tab-label`);
          if (tabLabel) { tabLabel.textContent = track.name; tabLabel.title = track.name; }
        }
        this.app.saveState();
      });

      tr.querySelector('.drums-note-select').addEventListener('change', (e) => {
        track.note = parseInt(e.target.value, 10);
        const profileEl = this.app._getModuleEl(instanceId, 'drums-profile');
        if (profileEl) profileEl.value = 'custom';
        this._updateDrumsVizRange(instanceId);
        this.app.saveState();
      });

      tbody.appendChild(tr);
    });
  }

  /**
   * Step interaction for the drum grid:
   *  - click an empty step  → turn it on (and paint across empty steps while dragging)
   *  - click an active step  → turn it off
   *  - drag up/down on an active step → sculpt its velocity (1 px ≈ 1 unit)
   */
  _attachDrumsGridDrag(instanceId, container) {
    const mod = this.app.moduleInstances.get(instanceId);
    if (!mod) return;

    const ctrl = new AbortController();
    this._drumGridControllers.set(instanceId, ctrl);
    const { signal } = ctrl;

    let drag = null;

    const trackOf = (cell) => mod.tracks.find(t => t.id === cell.dataset.trackId);

    container.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.drums-cell');
      if (!cell || !container.contains(cell)) return;
      e.preventDefault();
      const track = trackOf(cell);
      if (!track) return;
      const index = parseInt(cell.dataset.stepIndex, 10);
      const startVel = track.seq[index] || 0;
      drag = { track, index, cell, startY: e.clientY, startVel, moved: false, mode: startVel > 0 ? 'pending' : 'paint' };
      if (startVel === 0) this._setDrumsCellVelocity(track, index, cell, 100); // paint-on
    }, { signal });

    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dy = drag.startY - e.clientY;
      if (Math.abs(dy) > 3) drag.moved = true;

      if (drag.mode === 'paint') {
        const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.drums-cell');
        if (cell && container.contains(cell)) {
          const t = trackOf(cell);
          const idx = parseInt(cell.dataset.stepIndex, 10);
          if (t && (t.seq[idx] || 0) === 0) this._setDrumsCellVelocity(t, idx, cell, 100);
        }
      } else if (drag.moved) {
        drag.mode = 'velocity';
        this._setDrumsCellVelocity(drag.track, drag.index, drag.cell, Math.max(1, drag.startVel + dy));
      }
    }, { signal });

    document.addEventListener('mouseup', () => {
      if (!drag) return;
      if (drag.mode === 'pending' && !drag.moved) {
        this._setDrumsCellVelocity(drag.track, drag.index, drag.cell, 0); // toggle off
      }
      drag = null;
      this.app.saveState();
    }, { signal });
  }

  _buildNoteOptionsHtml(selectedNote) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    let html = '';
    for (let i = 0; i <= 127; i++) {
      const octave = Math.floor(i / 12) - 1;
      const noteName = noteNames[i % 12];
      const nameStr = `${noteName}${octave}`;
      const sel = (i === selectedNote) ? ' selected' : '';
      html += `<option value="${i}"${sel}>${nameStr} (${i})</option>`;
    }
    return html;
  }
}

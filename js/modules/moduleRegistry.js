import { BassModule } from './bass.js';
import { ArpModule } from './arp.js';
import { PadModule } from './pad.js';
import { PercussionModule } from './percussion.js';
import { KeyboardModule } from './keyboard.js';
import { LooperModule } from './looper.js';
import { SwellModule } from './swell.js';
import { DrumsModule } from './drums.js';
import { GlideModule } from './glide.js';
import { LEGACY_MODULE_IDS, buildDefaultState, MODULE_TYPE_DEFAULTS } from '../state/stateSchema.js';

function createMidiWrapper(app, instanceId) {
  const activeNotes = new Set();
  const sustainedNotes = new Set();
  let sustainPedalDown = false;

  const updateActiveState = (velocity = 0) => {
    const hasActive = (activeNotes.size > 0 || sustainedNotes.size > 0);
    app.handleModuleNoteState(instanceId, velocity, hasActive);
  };

  return new Proxy(app.midi, {
    get(target, prop) {
      if (prop === 'sendNoteOn') {
        return function(channel, note, velocity, when) {
          activeNotes.add(note);
          sustainedNotes.delete(note);
          updateActiveState(velocity);
          return target.sendNoteOn(channel, note, velocity, when);
        };
      }
      if (prop === 'sendNoteOff') {
        return function(channel, note, when) {
          if (sustainPedalDown) {
            if (activeNotes.has(note)) {
              activeNotes.delete(note);
              sustainedNotes.add(note);
            }
          } else {
            activeNotes.delete(note);
            sustainedNotes.delete(note);
          }
          updateActiveState(0);
          return target.sendNoteOff(channel, note, when);
        };
      }
      if (prop === 'sendCC') {
        return function(channel, cc, value, when) {
          if (cc === 64) {
            sustainPedalDown = (value >= 64);
            if (!sustainPedalDown) {
              sustainedNotes.clear();
            }
            updateActiveState(0);
          }
          return target.sendCC(channel, cc, value, when);
        };
      }
      const val = target[prop];
      if (typeof val === 'function') {
        return val.bind(target);
      }
      return val;
    }
  });
}

export class ModuleRegistry {
  constructor(app) {
    this.app = app;

    // Instantiate the 6 legacy modules using createModule so they are wrapped
    const bassMod = this.createModule('bass', LEGACY_MODULE_IDS.bass);
    const arpMod = this.createModule('arp', LEGACY_MODULE_IDS.arp);
    const padMod = this.createModule('pad', LEGACY_MODULE_IDS.pad);
    const kickMod = this.createModule('percussion', LEGACY_MODULE_IDS.kick);
    const snareMod = this.createModule('percussion', LEGACY_MODULE_IDS.snare);
    const shakerMod = this.createModule('percussion', LEGACY_MODULE_IDS.shaker);

    // Write the central registry onto app so all other controllers can read it
    app.moduleInstances = new Map([
      [LEGACY_MODULE_IDS.bass, bassMod],
      [LEGACY_MODULE_IDS.arp, arpMod],
      [LEGACY_MODULE_IDS.kick, kickMod],
      [LEGACY_MODULE_IDS.snare, snareMod],
      [LEGACY_MODULE_IDS.shaker, shakerMod],
      [LEGACY_MODULE_IDS.pad, padMod],
    ]);

    app.engine.registerModule(bassMod);
    app.engine.registerModule(arpMod);
    app.engine.registerModule(kickMod);
    app.engine.registerModule(snareMod);
    app.engine.registerModule(shakerMod);
    app.engine.registerModule(padMod);
  }

  // Create a new module instance by type — shared by addModule and applyStateData
  createModule(type, id) {
    const wrappedMidi = createMidiWrapper(this.app, id);
    if (type === 'bass') return new BassModule(wrappedMidi, id);
    if (type === 'arp') return new ArpModule(wrappedMidi, id);
    if (type === 'pad') return new PadModule(wrappedMidi, id);
    if (type === 'percussion') {
      const mod = new PercussionModule(wrappedMidi, id);
      if (id === LEGACY_MODULE_IDS.shaker) mod.humanize = true;
      return mod;
    }
    if (type === 'keyboard') return new KeyboardModule(wrappedMidi, id);
    if (type === 'looper') return new LooperModule(wrappedMidi, id);
    if (type === 'swell') return new SwellModule(wrappedMidi, id);
    if (type === 'drums') return new DrumsModule(wrappedMidi, id, this.app);
    if (type === 'glide') return new GlideModule(wrappedMidi, id);
    return null;
  }

  addModule(type, insertIndex) {
    const id = `${type}-${Date.now()}`;
    const mod = this.createModule(type, id);
    if (!mod) return;

    this.app.moduleInstances.set(id, mod);
    this.app.engine.registerModule(mod);
    if (type === 'looper') this.app._wireLooperCallbacks(id, mod);

    // Snapshot existing module configs before renderModules() wipes the DOM
    const existingConfigs = this.app.getCurrentStateData().modules;

    const labelMap = { pad: 'Drone', keyboard: 'Keyboard', looper: 'Looper', glide: 'Glide' };
    const label = labelMap[type] ?? (type.charAt(0).toUpperCase() + type.slice(1));
    const defaultConfig = MODULE_TYPE_DEFAULTS[type] ?? {};
    // Deep clone so nested structures (e.g. drums `tracks`/`seq`) are not shared by
    // reference with the global defaults or with other module instances.
    const entry = { id, type, label, active: false, config: structuredClone(defaultConfig) };
    // New modules always start with a blank sequencer, regardless of legacy defaults
    if (type === 'arp' || type === 'percussion') entry.config.seq = new Array(16).fill(0);

    let actualInsertIndex;
    if (typeof insertIndex === 'number' && insertIndex >= 0 && insertIndex <= this.app._currentModules.length) {
      this.app._currentModules.splice(insertIndex, 0, entry);
      actualInsertIndex = insertIndex;
    } else {
      this.app._currentModules.push(entry);
      actualInsertIndex = this.app._currentModules.length - 1;
    }

    this.app.renderModules(this.app._currentModules);

    // renderModules() rebuilds all cards from HTML defaults and creates fresh empty
    // SequencerUI instances, so we must re-apply config for every existing module.
    const configsToApply = this.app._currentModules.map(m =>
      m.id === id ? entry : (existingConfigs.find(c => c.id === m.id) ?? m)
    );
    this.applyConfigs(configsToApply);

    this.app.saveState();

    // Mirror the structural change to every other section in this song
    const _addSongId = this.app.presetManager.activeSongId;
    const _addSectionId = this.app.presetManager.activeSectionId;
    if (_addSongId && _addSectionId) {
      this.app.presetManager.propagateModuleAdd(
        _addSongId, _addSectionId,
        { id, type, label, active: false, config: structuredClone(entry.config) },
        actualInsertIndex
      );
    }
  }

  removeModule(instanceId) {
    const mod = this.app.moduleInstances.get(instanceId);
    if (!mod) return;

    mod.panic?.();
    this.app.engine.unregisterModule(instanceId);
    this.app.moduleInstances.delete(instanceId);

    // Clean up sequencer event listeners to prevent memory leaks
    const seqUI = this.app.sequencers.get(instanceId);
    if (seqUI) {
      seqUI.destroy();
      this.app.sequencers.delete(instanceId);
    }

    // Clean up any drum grid controllers for this module
    if (this.app.modulesGrid && this.app.modulesGrid._drumGridControllers) {
      this.app.modulesGrid._drumGridControllers.forEach((ctrl, key) => {
        if (key.startsWith(`${instanceId}::`)) {
          ctrl.abort();
          this.app.modulesGrid._drumGridControllers.delete(key);
        }
      });
    }

    this.app.pendingModuleActivations = this.app.pendingModuleActivations.filter(m => m.instanceId !== instanceId);

    // Snapshot remaining module configs before renderModules() wipes the DOM
    const existingConfigs = this.app.getCurrentStateData().modules.filter(m => m.id !== instanceId);

    this.app._currentModules = this.app._currentModules.filter(m => m.id !== instanceId);

    this.app.renderModules(this.app._currentModules);
    this.applyConfigs(existingConfigs);
    this.app.saveState();

    // Mirror the removal to every other section in this song
    const _rmSongId = this.app.presetManager.activeSongId;
    const _rmSectionId = this.app.presetManager.activeSectionId;
    if (_rmSongId && _rmSectionId) {
      this.app.presetManager.propagateModuleRemove(_rmSongId, _rmSectionId, instanceId);
    }
    this.app.flowRail?.pruneModule(instanceId);
  }

  applyConfigs(modules) {
    modules.forEach(mod => {
      const { id, type, active, config } = mod;
      const setVal = (control, val) => {
        const el = this.app._getModuleEl(id, control);
        if (el && val !== undefined) el.value = val;
      };
      const card = this.app._getModuleCard(id);
      const modInstance = this.app.moduleInstances.get(id);

      // Volume config application (common to all modules)
      const volume = config.volume !== undefined ? parseInt(config.volume, 10) : 100;
      setVal('volume', volume);
      const volDisplay = card?.querySelector('[data-volume-display]');
      if (volDisplay) {
        const db = volume <= 0 ? '-\u221e dB' : (() => {
          if (volume <= 100) {
            const d = 20 * Math.log10(volume / 100);
            return `${d.toFixed(1)} dB`;
          }
          const d = 6 * (volume - 100) / 27;
          return `+${d.toFixed(1)} dB`;
        })();
        volDisplay.textContent = db;
      }
      // Set the fader fill height to match the restored volume
      const fillEl = card?.querySelector('[data-control="fader-fill"]');
      if (fillEl) fillEl.style.height = `${(volume / 127) * 120}px`;
      if (modInstance && typeof modInstance.setVolumeImmediate === 'function') {
        modInstance.setVolumeImmediate(volume);
      }

      if (type === 'bass') {
        setVal('chan', config.chan);
        setVal('inMin', config.inMin);
        setVal('inMax', config.inMax);
        setVal('outMin', config.outMin);
        setVal('outMax', config.outMax);
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          this.app._getModuleEl(id, 'inMin')?.value,
          this.app._getModuleEl(id, 'inMax')?.value,
          this.app._getModuleEl(id, 'outMin')?.value,
          this.app._getModuleEl(id, 'outMax')?.value
        );

      } else if (type === 'arp') {
        setVal('chan', config.chan);
        setVal('mode', config.mode);
        setVal('notes', config.notes);
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          this.app._getModuleEl(id, 'notes')?.value,
          this.app._getModuleEl(id, 'mode')?.value
        );
        const stepsN = this.app.engine.clock.timeSignature === '4/4' ? 16 : 12;
        const arpSeq = config.seq || new Array(stepsN).fill(0).map((_, i) => i % 2 === 0 ? 90 : 75);
        const seqUI = this.app.sequencers.get(id);
        if (seqUI) { seqUI.setVelocities(arpSeq); modInstance?.setSequence(arpSeq); }

      } else if (type === 'percussion') {
        setVal('chan', config.chan);
        setVal('note', config.note);
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          this.app._getModuleEl(id, 'note')?.value,
          modInstance.humanize
        );
        if (config.seq) {
          const seqUI = this.app.sequencers.get(id);
          if (seqUI) { seqUI.setVelocities(config.seq); modInstance?.setSequence(config.seq); }
        }

      } else if (type === 'pad') {
        setVal('chan', config.chan);
        setVal('key', config.key);
        const keyVal = config.key;
        const rootNote = keyVal === 'song' ? 60 + this.app._currentSongKey : parseInt(keyVal, 10);
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          rootNote
        );

      } else if (type === 'looper') {
        setVal('chan', config.chan);
        setVal('bars', config.bars);
        setVal('quantize', config.quantize);
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          this.app._getModuleEl(id, 'bars')?.value,
          this.app._getModuleEl(id, 'quantize')?.value,
        );

      } else if (type === 'keyboard') {
        setVal('chan', config.chan);
        setVal('octave', config.octave);
        setVal('modWheel', config.modWheel);
        setVal('transitionMs', config.transitionMs);
        setVal('fadeMode', config.fadeMode);
        setVal('fadeCurve', config.fadeCurve);
        // Sync the mod wheel display span
        const kbCard = this.app._getModuleCard(id);
        const display = kbCard?.querySelector('[data-mod-display]');
        if (display) display.textContent = config.modWheel ?? '0';
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          this.app._getModuleEl(id, 'octave')?.value,
          '0',    // inversion — removed from UI
          'none', // filterMode — removed from UI
          '1',    // filterCount — removed from UI
          this.app._getModuleEl(id, 'modWheel')?.value,
          this.app._getModuleEl(id, 'transitionMs')?.value,
          this.app._getModuleEl(id, 'fadeMode')?.value,
          this.app._getModuleEl(id, 'fadeCurve')?.value,
        );

      } else if (type === 'swell') {
        setVal('chan',          config.chan);
        setVal('selectMode',   config.selectMode);
        setVal('outMin',       config.outMin);
        setVal('outMax',       config.outMax);
        setVal('density',      config.density);
        setVal('attackMs',     config.attackMs);
        setVal('holdMs',       config.holdMs);
        setVal('releaseMs',    config.releaseMs);
        setVal('curve',        config.curve);
        setVal('whammy',       config.whammy);
        setVal('whammyChance', config.whammyChance);
        setVal('whammySpeed',  config.whammySpeed);
        setVal('whammyDouble', config.whammyDouble);
        setVal('autoRate',     config.autoRate);
        setVal('vary',         config.vary);
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          this.app._getModuleEl(id, 'selectMode')?.value,
          this.app._getModuleEl(id, 'outMin')?.value,
          this.app._getModuleEl(id, 'outMax')?.value,
          this.app._getModuleEl(id, 'density')?.value,
          this.app._getModuleEl(id, 'attackMs')?.value,
          this.app._getModuleEl(id, 'holdMs')?.value,
          this.app._getModuleEl(id, 'releaseMs')?.value,
          this.app._getModuleEl(id, 'curve')?.value,
          this.app._getModuleEl(id, 'whammy')?.value,
          this.app._getModuleEl(id, 'whammyChance')?.value,
          this.app._getModuleEl(id, 'whammySpeed')?.value,
          this.app._getModuleEl(id, 'whammyDouble')?.value,
          this.app._getModuleEl(id, 'autoRate')?.value,
          this.app._getModuleEl(id, 'vary')?.value,
        );
      } else if (type === 'glide') {
        setVal('chan', config.chan);
        setVal('glideMs', config.glideMs);
        setVal('curve', config.curve);
        setVal('pitchBendRange', config.pitchBendRange);
        if (modInstance) modInstance.setConfig(
          this.app._getModuleEl(id, 'chan')?.value,
          this.app._getModuleEl(id, 'glideMs')?.value,
          this.app._getModuleEl(id, 'curve')?.value,
          this.app._getModuleEl(id, 'pitchBendRange')?.value,
        );

      } else if (type === 'drums') {
        setVal('chan', config.chan);
        setVal('swing', config.swing);
        setVal('humanize', config.humanize);
        if (modInstance) {
          modInstance.setConfig(
            this.app._getModuleEl(id, 'chan')?.value || 10,
            this.app._getModuleEl(id, 'swing')?.value || 0,
            this.app._getModuleEl(id, 'humanize')?.value || 15
          );
          if (config.tracks) {
            modInstance.setTracks(config.tracks);
          }
          if (config.selectedTrackId) {
            modInstance.selectedTrackId = config.selectedTrackId;
          }
          this.app.modulesGrid?.refreshDrumsUI?.(id);
        }
      }

      if (active !== undefined) {
        const toggle = this.app._getModuleEl(id, 'toggle');
        if (toggle) toggle.checked = active;
        modInstance?.toggle(active);
        card?.classList.toggle('active', active);
      }
    });
  }
}

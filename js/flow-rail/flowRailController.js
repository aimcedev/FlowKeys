/**
 * FlowRailController — mode wiring, MIDI ingest, persistence, FLOW chrome.
 */

import { FlowTempoTransitions } from './flowTempoTransitions.js?v=1';
import { FlowRailEngine } from './flowRailEngine.js?v=6';
import { FlowRailView } from './flowRailView.js?v=9';
import { FlowRailEditor } from './flowRailEditor.js?v=6';
import { FlowEditPlayhead } from './flowEditPlayhead.js?v=5';
import {
  buildDefaultFlowRail,
  cloneFlowRail,
  dropOrphanMappings,
  generateFlowRailId,
  sanitizeMapping,
  upsertPoint,
  removePoint,
  targetsMatch,
  makePoint,
} from './flowRailState.js?v=3';
import {
  interpolate,
  stepValue,
  isContinuousMapping,
  moduleTypeForId,
  mappingLabel,
  formatParamValue,
  getCatalogEntry,
  readMappingValue,
  restoreControlFromSnapshot,
  SOURCE_CURVE_OPTIONS,
  applySourceCurve,
  sanitizeSourceCurve,
} from './flowRailCatalog.js?v=4';
import { MOD_WHEEL_CC } from '../utils/midiConstants.js';

export class FlowRailController {
  constructor(app) {
    this.app = app;
    this.engine = new FlowRailEngine(app);
    this.view = null;
    this.editor = null;
    this.editPlayhead = null;
    this.isConfigure = false;
    this.selectedId = null;
    this.selectedPointId = null;
    this._learningSource = false;
    this._restoreOnLeave = true;
    this._userDirty = new Set();
    this._rawCc = null;
    this.tempoTransitions = new FlowTempoTransitions(app, () => this.view?.requestDraw());
    app.engine.deferFlowClockStart = () => this.tempoTransitions.enabled() && this.tempoTransitions.kind === 'entry';
    app.engine.onPanic(() => {
      this.tempoTransitions.clear();
      app.pendingModuleActivations = [];
    });
    app.engine.clock.onBeat(beat => { this.tempoTransitions.beat = beat; this.view?.requestDraw(); });
    app.engine.clock.onStart(() => this.view?.requestDraw());
    app.engine.clock.onStop(() => {
      if (!this.tempoTransitions._committing && this.tempoTransitions.kind !== 'entry') this.tempoTransitions.clear();
      this.view?.requestDraw();
    });
    app.engine.clock.onWorkerError(() => this.tempoTransitions.clear());

    this.songNameEl = document.getElementById('flow-rail-song-name');
    this.sectionNameEl = document.getElementById('flow-rail-section-name');
    this.sourceLabelEl = document.getElementById('flow-rail-source-label');
    this.editSourceEl = document.getElementById('flow-edit-source-btn');
    this.sourceCurveEl = document.getElementById('flow-source-curve');
    this.configureBtn = document.getElementById('flow-configure-toggle-btn');
    this.flowViewEl = document.getElementById('flow-mode-view');
    this.prevBtn = document.getElementById('flow-prev-section-btn');
    this.nextBtn = document.getElementById('flow-next-section-btn');

    this.engine.onChange(() => {
      this.view?.requestDraw();
      this.editPlayhead?.refresh();
    });

    const canvas = document.getElementById('flow-rail-canvas');
    if (canvas) {
      this.view = new FlowRailView(canvas, this.engine, app);
      this.editor = new FlowRailEditor(this);
    }
    this.editPlayhead = new FlowEditPlayhead(this.engine, app);

    this._bindSourceLearnClicks();
    this._bindChrome();
    this.loadFromActiveSong();
  }

  _bindChrome() {
    if (this.configureBtn) {
      this.configureBtn.addEventListener('click', () => this.toggleConfigure());
    }
    this.prevBtn?.addEventListener('click', () => {
      this.app.midiActions.handle('prevSection');
    });
    this.nextBtn?.addEventListener('click', () => {
      this.app.midiActions.handle('nextSection');
    });
    this._bindSourceCurve();
  }

  _bindSourceCurve() {
    if (!this.sourceCurveEl) return;
    this.sourceCurveEl.innerHTML = SOURCE_CURVE_OPTIONS.map(c =>
      `<option value="${c.id}">${c.label}</option>`
    ).join('');
    this.sourceCurveEl.addEventListener('change', () => {
      this.setSourceCurve(this.sourceCurveEl.value);
    });
  }

  _bindSourceLearnClicks() {
    const onClick = (e) => {
      if (this.app.midiMapping?.isLearning) return;
      e.preventDefault();
      this.beginSourceLearn();
    };
    this.sourceLabelEl?.addEventListener('click', onClick);
    this.editSourceEl?.addEventListener('click', onClick);
  }

  loadFromActiveSong() {
    this.tempoTransitions.clear();
    const song = this.app.presetManager.getSong(this.app.presetManager.activeSongId);
    const rail = song?.flowRail ? cloneFlowRail(song.flowRail) : buildDefaultFlowRail();
    const moduleIds = (this.app._currentModules || []).map(m => m.id);
    dropOrphanMappings(rail, moduleIds);
    this.engine.load(rail);
    this.selectedId = null;
    this.selectedPointId = null;
    this.view?.setSelection(null);
    this.updateChrome();
    this.editor?.refresh();
    this.view?.requestDraw();
    this.editPlayhead?.refresh();
    this.app.midiMapping?.renderList();
  }

  persist() {
    const songId = this.app.presetManager.activeSongId;
    if (!songId) return;
    this.app.presetManager.updateSongFlowRail(songId, this.engine.rail);
  }

  pruneModule(moduleId) {
    const songId = this.app.presetManager.activeSongId;
    if (!songId) return;
    this.app.presetManager.pruneFlowRailMappings(songId, moduleId);
    this.loadFromActiveSong();
  }

  enter() {
    this.loadFromActiveSong();
    this.setConfigure(false);
    this.view?.resize();
    this.engine._lastApplied.clear();
    this.engine.setCc(this.engine.cc, { silent: true, force: true });
    this.updateChrome();
  }

  leave() {
    this.tempoTransitions.clear();
    this.setConfigure(false);
    this._learningSource = false;
    this.engine._lastApplied.clear();
    if (!this._restoreOnLeave) return;
    const songId = this.app.presetManager.activeSongId;
    const sectionId = this.app.presetManager.activeSectionId;
    if (!songId || !sectionId) return;
    const state = this.app.presetManager.getSectionData(songId, sectionId);
    if (state) this.app.applyStateData(state, { persist: false });
  }

  leaveEdit() {
    this._userDirty.clear();
    this.engine._lastApplied.clear();
    const songId = this.app.presetManager.activeSongId;
    const sectionId = this.app.presetManager.activeSectionId;
    if (!songId || !sectionId) return;
    const state = this.app.presetManager.getSectionData(songId, sectionId);
    if (state) this.app.applyStateData(state, { persist: false });
  }

  dirtyKey(moduleId, control) {
    return `${moduleId}:${control}`;
  }

  isUserDirty(moduleId, control) {
    return this._userDirty.has(this.dirtyKey(moduleId, control));
  }

  markUserDirty(moduleId, control) {
    if (!moduleId || !control || control === 'fader-fill') return;
    this._userDirty.add(this.dirtyKey(moduleId, control));
  }

  clearDirtyForMapping(mapping) {
    if (mapping?.target?.kind !== 'param') return;
    this._userDirty.delete(this.dirtyKey(mapping.target.moduleId, mapping.target.control));
  }

  prepareEditPersist() {
    if (this.app.uiManager?.currentMode !== 'edit') return;
    const songId = this.app.presetManager.activeSongId;
    const sectionId = this.app.presetManager.activeSectionId;
    if (!songId || !sectionId) return;
    const section = this.app.presetManager.getSectionData(songId, sectionId);
    if (!section?.modules) return;
    for (const mapping of this.engine.rail.mappings || []) {
      if (mapping.target?.kind !== 'param') continue;
      const { moduleId, control } = mapping.target;
      if (this.isUserDirty(moduleId, control)) continue;
      const modState = section.modules.find(m => m.id === moduleId);
      restoreControlFromSnapshot(this.app, modState, control);
    }
  }

  afterEditPersist() {
    if (this.app.uiManager?.currentMode !== 'edit') return;
    this.engine._lastApplied.clear();
    this.engine.setCc(this.engine.cc, { silent: true, force: true, respectDirty: true });
  }

  reassertEnvelope() {
    const mode = this.app.uiManager?.currentMode;
    if (mode !== 'edit' && mode !== 'flow') return;
    if (!(this.engine.rail.mappings || []).length) return;
    this.engine.setCc(this.engine.cc, { silent: true, force: true, respectDirty: true });
  }

  onSectionApplied() {
    if (this.app.uiManager?.currentMode !== 'flow') return;
    this.loadFromActiveSong();
    this.engine.setCc(this.engine.cc, { silent: true });
    this.updateChrome();
  }

  onSongChanged() {
    this.loadFromActiveSong();
    if (this.app.uiManager?.currentMode === 'flow') {
      this.engine.setCc(this.engine.cc, { silent: true });
    }
  }

  toggleConfigure() {
    if (this.app.uiManager?.currentMode !== 'flow') return;
    this.setConfigure(!this.isConfigure);
  }

  setConfigure(on) {
    this.isConfigure = !!on;
    this.flowViewEl?.classList.toggle('configuring', this.isConfigure);
    this.view?.setConfigure(this.isConfigure);
    if (this.sourceLabelEl) this.sourceLabelEl.disabled = !this.isConfigure;
    if (this.configureBtn) {
      this.configureBtn.classList.toggle('unlocked', this.isConfigure);
      this.configureBtn.textContent = this.isConfigure ? 'Done' : 'Shape';
      this.configureBtn.setAttribute('aria-expanded', String(this.isConfigure));
    }
    if (!this.isConfigure) this.editor?.togglePicker(false);
    this.editor?.refresh();
    this.view?.resize();
  }

  selectMapping(id) {
    this.editor?.revealMapping(id);
    this.selectedId = id;
    const mapping = (this.engine.rail.mappings || []).find(m => m.id === id);
    this.selectedPointId = mapping?.points?.[0]?.id || null;
    this.view?.setSelection(id);
    this.editor?.renderList();
    this.editor?.renderInspector();
  }

  selectPoint(mappingId, pointId) {
    this.editor?.revealMapping(mappingId);
    this.selectedId = mappingId;
    this.selectedPointId = pointId;
    this.view?.setSelection(mappingId);
    this.view?.setHover(mappingId, { mappingId, pointId });
    this.editor?.renderList();
    this.editor?.renderInspector();
  }

  addMapping(partial) {
    const mapping = sanitizeMapping({
      id: partial.id || generateFlowRailId(),
      curve: 'ease-out',
      label: '',
      ...partial,
    });
    if (!mapping) return null;
    this.engine.rail.mappings.push(mapping);
    this.persist();
    this.selectMapping(mapping.id);
    this.engine.setCc(this.engine.cc, { silent: true });
    this.editor?.refresh();
    this.view?.requestDraw();
    return mapping;
  }

  removeMapping(id) {
    const old = this.engine.rail.mappings.find(m => m.id === id);
    if (old?.target?.moduleId) this.tempoTransitions.cancelModule(old.target.moduleId);
    if (old?.target?.kind === 'event' && old.target.action?.startsWith('module:')) {
      this.tempoTransitions.cancelModule(old.target.action.slice(7, old.target.action.lastIndexOf(':')));
    }
    this.engine.rail.mappings = this.engine.rail.mappings.filter(m => m.id !== id);
    if (this.selectedId === id) {
      this.selectedId = null;
      this.selectedPointId = null;
    }
    this.persist();
    this.view?.setSelection(this.selectedId);
    this.editor?.refresh();
    this.view?.requestDraw();
  }

  findMappingByTarget(target) {
    return (this.engine.rail.mappings || []).find(m => targetsMatch(m.target, target)) || null;
  }

  upsertFlowPoint(target, cc, value) {
    let mapping = this.findMappingByTarget(target);
    if (!mapping) {
      mapping = this.addMapping({
        target,
        curve: target.kind === 'param' && target.control !== 'toggle' ? 'ease-out' : 'linear',
        points: [makePoint(cc, value)],
      });
    } else {
      const pt = upsertPoint(mapping, cc, value);
      this.persist();
      this.selectPoint(mapping.id, pt?.id);
      this.engine.setCc(this.engine.cc, { silent: true });
      this.editor?.refresh();
      this.view?.requestDraw();
    }
    return mapping;
  }

  addPointAtPlayhead(mappingId) {
    return this.addPointAt(mappingId, this.engine.cc);
  }

  addPointAt(mappingId, position, explicitValue) {
    const mapping = (this.engine.rail.mappings || []).find(m => m.id === mappingId);
    if (!mapping || mapping.target?.kind === 'event') return;
    const cc = Math.max(0, Math.min(127, Math.round(position)));
    const existing = (mapping.points || []).find(p => p.cc === cc);
    if (existing) {
      this.selectPoint(mapping.id, existing.id);
      return;
    }
    const type = mapping.target?.kind === 'param'
      ? moduleTypeForId(this.app, mapping.target.moduleId)
      : null;
    const value = explicitValue ?? (isContinuousMapping(mapping, type)
      ? interpolate(cc, mapping)
      : stepValue(cc, mapping));
    const pt = upsertPoint(mapping, cc, value);
    this.persist();
    this.selectPoint(mapping.id, pt?.id);
    this.engine.setCc(this.engine.cc, { silent: true });
    this.editor?.refresh();
    this.view?.requestDraw();
  }

  removeFlowPoint(mappingId, pointId) {
    const mapping = (this.engine.rail.mappings || []).find(m => m.id === mappingId);
    if (!mapping) return;
    if (!removePoint(mapping, pointId)) return;
    if (this.selectedPointId === pointId) {
      this.selectedPointId = mapping.points[0]?.id || null;
    }
    this.persist();
    this.engine.setCc(this.engine.cc, { silent: true });
    this.editor?.refresh();
    this.view?.requestDraw();
  }

  addFlowPointFromEdit(moduleId, control) {
    const target = { kind: 'param', moduleId, control };
    const cc = this.engine.cc;
    const draft = { target };
    let value = readMappingValue(this.app, draft);
    const card = document.querySelector(`[data-instance-id="${moduleId}"]`);
    const el = card?.querySelector(`[data-control="${control}"]`);
    if (el) {
      if (el.type === 'checkbox') value = el.checked ? 1 : 0;
      else if (el.value !== undefined && el.value !== '') {
        const n = Number(el.value);
        value = Number.isFinite(n) && el.tagName !== 'SELECT' ? n : (Number.isFinite(n) ? n : el.value);
      }
    }
    this.upsertFlowPoint(target, cc, value);
    const type = moduleTypeForId(this.app, moduleId);
    const entry = getCatalogEntry(type, control);
    const label = mappingLabel(this.app, { target, label: '' });
    const display = formatParamValue(entry, value);
    this.app.uiManager?.showToast(`${label} @ CC ${cc} = ${display}`);
  }

  beginSourceLearn() {
    this._learningSource = true;
    this.app.midiMapping?.toggleDrawer(true);
    this.app.midiMapping?.setLearnMode(true);
    const candidates = [...document.querySelectorAll('[data-midi-target="flowRailSource"]')];
    const el = candidates.find(node => node.offsetParent !== null) || this.editSourceEl || this.sourceLabelEl;
    this.app.midiMapping?.selectTarget('flowRailSource', el);
    this.updateChrome();
    this.app.uiManager?.showToast('Move a MIDI CC to set the Flow Rail source');
  }

  setSourceCc(cc, { toast = true } = {}) {
    const next = Math.max(0, Math.min(127, Math.round(Number(cc))));
    this.engine.rail.source.cc = next;
    this._learningSource = false;
    this.persist();
    this.updateChrome();
    this.app.midiMapping?.renderList();
    if (toast) this.app.uiManager?.showToast(`Flow Rail source set to CC ${String(next).padStart(2, '0')}`);
  }

  resetSourceCc() {
    this.engine.rail.source.cc = null;
    this._learningSource = false;
    this.persist();
    this.updateChrome();
    this.app.midiMapping?.renderList();
    this.app.uiManager?.showToast('Flow Rail source reset to Mod Wheel');
  }

  setSourceCurve(curve) {
    const prev = sanitizeSourceCurve(this.engine.rail.source?.curve);
    const next = sanitizeSourceCurve(curve);
    this.engine.rail.source.curve = next;
    this.persist();
    this.updateChrome();
    if (this._rawCc == null) return;
    const previouslyShaped = applySourceCurve(this._rawCc, prev);
    if (this.engine.cc !== previouslyShaped) return;
    const mode = this.app.uiManager?.currentMode;
    this.engine.setCc(applySourceCurve(this._rawCc, next), {
      silent: mode !== 'flow',
      force: true,
    });
  }

  _shapedCc(raw) {
    return applySourceCurve(raw, this.engine.rail.source?.curve);
  }

  _isLearningSource() {
    return this.app.midiMapping?.isLearning && this.app.midiMapping.selectedTargetId === 'flowRailSource';
  }

  handleMidiMessage(event) {
    const data = event.data;
    if (!data || data.length < 2) return false;
    const status = data[0];
    const cmd = status >> 4;
    if (cmd !== 11) return false;
    const cc = data[1];
    const value = data.length > 2 ? data[2] : 0;
    const mode = this.app.uiManager?.currentMode;

    if (this._isLearningSource()) {
      this.setSourceCc(cc);
      this.app.midiMapping?.clearSelection();
      this.updateChrome();
      this._rawCc = value;
      this.engine.setCc(this._shapedCc(value), { silent: mode !== 'flow' });
      return true;
    }

    if (cc !== this.engine.sourceCc()) return false;

    this._rawCc = value;
    const shaped = this._shapedCc(value);

    if (mode === 'edit') {
      this.engine.setCc(shaped, { silent: true });
      return false;
    }

    if (mode !== 'flow') {
      this.engine.setCc(shaped, { apply: false, silent: true });
      return false;
    }

    this.engine.setCc(shaped);
    return true;
  }

  updateChrome() {
    const song = this.app.presetManager.getSong(this.app.presetManager.activeSongId);
    const section = song?.sections.find(s => s.id === this.app.presetManager.activeSectionId);
    if (this.songNameEl) this.songNameEl.textContent = song?.name || 'Song';
    if (this.sectionNameEl) this.sectionNameEl.textContent = section?.name || 'Section';

    const src = this.engine.sourceCc();
    const isDefault = this.engine.rail.source.cc == null;
    const listening = this._isLearningSource();
    const padded = String(src).padStart(2, '0');
    const flowLabel = listening
      ? 'Listening for source CC…'
      : (isDefault ? `CC ${padded}  ·  MOD WHEEL` : `CC ${padded}`);
    const editLabel = listening
      ? 'Listening…'
      : (isDefault ? 'Source · Mod Wheel' : `Source · CC ${padded}`);

    if (this.sourceLabelEl) this.sourceLabelEl.textContent = flowLabel;
    if (this.editSourceEl) this.editSourceEl.textContent = editLabel;
    if (this.sourceCurveEl) {
      this.sourceCurveEl.value = sanitizeSourceCurve(this.engine.rail.source?.curve);
    }
    this.editPlayhead?.refresh();
  }
}


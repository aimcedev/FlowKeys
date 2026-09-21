/**
 * FlowRailEngine — CC in, interpolated values out.
 * Does not persist; callers own song.flowRail and section restore.
 */

import { interpolate, stepValue, applyMappingValue, isContinuousMapping, moduleTypeForId, mappingLabel, formatParamValue, getCatalogEntry, colorVarForModule } from './flowRailCatalog.js?v=4';
import { cloneFlowRail, mappingSpan } from './flowRailState.js?v=3';
import { MOD_WHEEL_CC } from '../utils/midiConstants.js';

export class FlowRailEngine {
  constructor(app) {
    this.app = app;
    this.rail = cloneFlowRail(null);
    this.cc = 0;
    this._lastCc = 0;
    this._lastApplied = new Map(); // mappingId → last sent (number or string)
    this._onChange = null;
  }

  onChange(cb) {
    this._onChange = cb;
  }

  load(rail) {
    this.rail = cloneFlowRail(rail);
    this._lastApplied.clear();
  }

  getRail() {
    return this.rail;
  }

  sourceCc() {
    const explicit = this.rail?.source?.cc;
    return explicit === null || explicit === undefined ? MOD_WHEEL_CC : explicit;
  }

  setCc(cc, { silent = false, apply = true, respectDirty = false, force = false } = {}) {
    const next = Math.max(0, Math.min(127, Math.round(cc)));
    const prev = this.cc;
    this.cc = next;
    if (apply) this.apply(next, { silent, fromCc: prev, respectDirty, force });
    this._lastCc = next;
    if (this._onChange) this._onChange(next);
  }

  apply(cc, { silent = false, fromCc = cc, respectDirty = false, force = false } = {}) {
    const mappings = this.rail.mappings || [];
    const skipCcOut = this.app.uiManager?.currentMode === 'edit';
    const transitions = this.app.flowRail?.tempoTransitions;
    transitions?.beginUpdate();
    try {
      for (const mapping of mappings) {
        if (mapping.target?.kind === 'event') {
          if (!silent) this._maybeFireEvent(mapping, fromCc, cc);
          continue;
        }

        const type = mapping.target?.kind === 'param'
          ? moduleTypeForId(this.app, mapping.target.moduleId)
          : null;
        const continuous = isContinuousMapping(mapping, type);

        let value;
        if (continuous) {
          value = interpolate(cc, mapping);
          if (mapping.target?.kind === 'ccOut' || mapping.target?.control === 'volume' || mapping.target?.control === 'modWheel') {
            value = Math.round(value);
          }
        } else {
          value = stepValue(cc, mapping);
        }

        const dirty = mapping.target?.kind === 'param'
          && this.app.flowRail?.isUserDirty(mapping.target.moduleId, mapping.target.control);
        if (respectDirty && dirty) continue;

        const key = mapping.id;
        const prev = this._lastApplied.get(key);
        const comparable = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
        if (!force && prev === comparable && !dirty) continue;
        this._lastApplied.set(key, comparable);
        const handled = mapping.target?.kind === 'param' && mapping.target.control === 'toggle'
          && transitions?.request(mapping.target.moduleId, Number(value) >= 0.5);
        if (!handled) applyMappingValue(this.app, mapping, value, { skipCcOut });
        this.app.flowRail?.clearDirtyForMapping(mapping);
      }
    } finally {
      transitions?.endUpdate();
    }
  }

  _maybeFireEvent(mapping, fromCc, toCc) {
    const at = mapping.cc ?? mapping.range?.ccStart ?? 0;
    const lo = Math.min(fromCc, toCc);
    const hi = Math.max(fromCc, toCc);
    // Hysteresis band of 1: fire when the playhead crosses `at`.
    if (lo === hi) return;
    const crossed = lo < at && hi >= at;
    if (!crossed) return;
    this._fireAction(mapping.target.action);
  }

  _fireAction(action) {
    if (!action) return;
    if (action.startsWith('module:') && (action.endsWith(':on') || action.endsWith(':off'))) {
      const parts = action.split(':');
      const moduleId = parts[1];
      const on = action.endsWith(':on');
      if (!this.app.flowRail?.tempoTransitions?.request(moduleId, on)) this.app._toggleModuleDirectly(moduleId, on);
      return;
    }
    this.app.midiActions?.handle(action);
  }

  getPlayheadInfo() {
    const cc = this.cc;
    const majors = (this.rail.checkpoints || [])
      .filter(c => c.kind === 'major')
      .slice()
      .sort((a, b) => a.cc - b.cc);

    let prev = majors[0] || null;
    let next = majors[majors.length - 1] || null;
    for (let i = 0; i < majors.length; i++) {
      if (majors[i].cc <= cc) prev = majors[i];
      if (majors[i].cc > cc) {
        next = majors[i];
        break;
      }
    }

    const active = [];
    for (const mapping of this.rail.mappings || []) {
      if (mapping.target?.kind === 'event') continue;
      const type = mapping.target?.kind === 'param'
        ? moduleTypeForId(this.app, mapping.target.moduleId)
        : null;
      if (!isContinuousMapping(mapping, type)) continue;
      const { ccStart: start, ccEnd: end } = mappingSpan(mapping);
      if (cc < start || cc > end) continue;
      const value = interpolate(cc, mapping);
      const entry = type ? getCatalogEntry(type, mapping.target.control) : { label: 'CC', unit: '', step: 1 };
      const colorVar = mapping.target?.kind === 'ccOut'
        ? '--accent-cyan'
        : colorVarForModule(type, mapping.target.moduleId);
      active.push({
        id: mapping.id,
        label: mappingLabel(this.app, mapping),
        display: formatParamValue(entry, value),
        value,
        colorVar,
      });
      if (active.length >= 4) break;
    }

    return { cc, prev, next, active };
  }
}

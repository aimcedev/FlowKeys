import { mappingGroups } from './flowMappingGroups.js?v=1';
/**
 * Flow Rail configure-density: canvas hit-testing, mapping list, Add Mapping picker.
 */

import { generateFlowRailId, makePoint, mappingSpan, movePoint, setPointPosition, commitPoints, removePoint } from './flowRailState.js?v=3';
import {
  listPickerGroups,
  mappingLabel,
  CURVE_OPTIONS,
  getCatalogEntry,
  moduleTypeForId,
  colorVarForModule,
  readMappingValue,
  isContinuousMapping,
  mappingPoints,
} from './flowRailCatalog.js';

export class FlowRailEditor {
  constructor(controller) {
    this.controller = controller;
    this.app = controller.app;
    this.listEl = document.getElementById('flow-mapping-list');
    this.inspectorEl = document.getElementById('flow-mapping-inspector');
    this.pickerEl = document.getElementById('flow-add-mapping-picker');
    this.addBtn = document.getElementById('flow-add-mapping-btn');
    this.emptyEl = document.getElementById('flow-rail-empty');
    this.learnBtn = document.getElementById('flow-learn-source-btn');
    this.resetSourceBtn = document.getElementById('flow-reset-source-btn');

    this.checkpointEl = document.getElementById('flow-checkpoint-list');
    this._drag = null;
    this._pickerOpen = false;
    this._collapsedGroups = new Set();

    this._bind();
  }

  _bind() {
    const canvas = this.controller.view?.canvas;
    if (canvas) {
      canvas.addEventListener('dblclick', e => this._onDoubleClick(e));
      canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
      canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
      canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
      canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
      canvas.addEventListener('lostpointercapture', () => { this._drag = null; });
    }

    document.getElementById('flow-first-mapping-btn')?.addEventListener('click', () => {
      this.controller.setConfigure(true);
      this.togglePicker(true);
      this.pickerEl?.querySelector('button')?.focus();
    });
    document.getElementById('flow-add-checkpoint-btn')?.addEventListener('click', () => {
      const cp = { id: generateFlowRailId(), cc: this.controller.engine.cc, name: '', kind: 'major' };
      this.controller.engine.rail.checkpoints.push(cp);
      this._saveCheckpoints();
      this.renderCheckpoints();
      this.checkpointEl?.querySelector(`[data-checkpoint-id="${cp.id}"] input`)?.focus();
    });
    canvas?.addEventListener('pointerleave', () => {
      if (!this._drag) this.controller.view.setHover(null);
    });
    this.addBtn?.addEventListener('click', () => this.togglePicker());
    this.learnBtn?.addEventListener('click', () => this.controller.beginSourceLearn());
    this.resetSourceBtn?.addEventListener('click', () => this.controller.resetSourceCc());
  }

  refresh() {
    this.renderList();
    this.renderInspector();
    this._updateEmpty();
    this.renderCheckpoints();
    if (this._pickerOpen) this.renderPicker();
  }

  _updateEmpty() {
    if (!this.emptyEl) return;
    const empty = (this.controller.engine.rail.mappings || []).length === 0;
    this.emptyEl.hidden = !empty;
  }

  _saveCheckpoints() {
    this.controller.engine.rail.checkpoints.sort((a, b) => a.cc - b.cc);
    this.controller.persist();
    this.controller.view.requestDraw();
  }

  renderCheckpoints() {
    if (!this.checkpointEl) return;
    this.checkpointEl.replaceChildren();
    for (const cp of this.controller.engine.rail.checkpoints || []) {
      const row = document.createElement('div');
      row.className = 'flow-checkpoint-row'; row.dataset.checkpointId = cp.id;
      const name = document.createElement('input');
      name.type = 'text'; name.value = cp.name || ''; name.placeholder = 'Name this moment'; name.maxLength = 24;
      name.setAttribute('aria-label', 'Checkpoint name');
      name.addEventListener('change', () => { cp.name = name.value.trim(); this._saveCheckpoints(); });
      const cc = document.createElement('input');
      cc.type = 'number'; cc.min = '0'; cc.max = '127'; cc.value = cp.cc;
      cc.setAttribute('aria-label', 'Checkpoint CC position');
      cc.addEventListener('change', () => { cp.cc = clamp127(cc.value); cc.value = cp.cc; this._saveCheckpoints(); });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'flow-point-delete'; remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove checkpoint');
      remove.addEventListener('click', () => {
        this.controller.engine.rail.checkpoints = this.controller.engine.rail.checkpoints.filter(item => item.id !== cp.id);
        this._saveCheckpoints(); this.renderCheckpoints();
        document.getElementById('flow-add-checkpoint-btn')?.focus();
      });
      row.append(name, cc, remove); this.checkpointEl.append(row);
    }
  }

  togglePicker(force) {
    this._pickerOpen = force === undefined ? !this._pickerOpen : !!force;
    if (this.pickerEl) this.pickerEl.hidden = !this._pickerOpen;
    if (this._pickerOpen) this.renderPicker();
  }

  revealMapping(id) {
    const group = mappingGroups(this.controller.engine.rail.mappings || [], this.app).find(g => g.mappings.some(m => m.id === id));
    if (group) this._collapsedGroups.delete(group.id);
  }

  renderList() {
    if (!this.listEl) return;
    const focusedId = this.listEl.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    const rail = this.controller.engine.rail;
    const mappings = rail.mappings || [];
    this.listEl.innerHTML = '';

    if (mappings.length === 0) {
      const li = document.createElement('li');
      li.className = 'flow-mapping-empty';
      li.textContent = 'No mappings yet.';
      this.listEl.appendChild(li);
      return;
    }

    for (const group of mappingGroups(mappings, this.app)) {
      const groupRow = document.createElement('li'); groupRow.className = 'flow-mapping-group';
      const header = document.createElement('button'); header.type = 'button'; header.className = 'flow-mapping-group-toggle';
      header.textContent = `${this._collapsedGroups.has(group.id) ? '▸' : '▾'} ${group.label} · ${group.mappings.length}`;
      header.setAttribute('aria-expanded', String(!this._collapsedGroups.has(group.id)));
      header.addEventListener('click', () => {
        if (this._collapsedGroups.has(group.id)) this._collapsedGroups.delete(group.id); else this._collapsedGroups.add(group.id);
        this.renderList();
        [...this.listEl.querySelectorAll('.flow-mapping-group-toggle')].find(el => el.dataset.groupId === group.id)?.focus();
      });
      header.dataset.groupId = group.id;
      const children = document.createElement('ul'); children.hidden = this._collapsedGroups.has(group.id);
      groupRow.append(header, children); this.listEl.append(groupRow);
      for (const mapping of group.mappings) {
      const li = document.createElement('li');
      li.className = 'flow-mapping-row' + (mapping.id === this.controller.selectedId ? ' selected' : '');
      li.dataset.id = mapping.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', String(mapping.id === this.controller.selectedId));
      li.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); }
      });

      const swatch = document.createElement('span');
      swatch.className = 'flow-mapping-swatch';
      const type = mapping.target?.kind === 'param' ? moduleTypeForId(this.app, mapping.target.moduleId) : null;
      const colorVar = mapping.target?.kind === 'ccOut'
        ? '--accent-cyan'
        : mapping.target?.kind === 'event'
          ? '--accent-yellow'
          : colorVarForModule(type, mapping.target?.moduleId);
      swatch.style.background = `var(${colorVar})`;

      const name = document.createElement('span');
      name.className = 'flow-mapping-name';
      name.textContent = mappingLabel(this.app, mapping);

      const range = document.createElement('span');
      range.className = 'flow-mapping-range';
      if (mapping.target?.kind === 'event') {
        range.textContent = `CC ${mapping.cc ?? 0}`;
      } else {
        const { ccStart: a, ccEnd: b } = mappingSpan(mapping);
        const n = (mapping.points || []).length;
        range.textContent = a === b ? `CC ${a}` : `${a}–${b} · ${n}`;
      }

      li.appendChild(swatch);
      li.appendChild(name);
      li.appendChild(range);
      li.addEventListener('click', () => {
        this.controller.selectMapping(mapping.id);
        this.togglePicker(false);
      });
      li.addEventListener('mouseenter', () => this.controller.view.setHover(mapping.id));
      li.addEventListener('mouseleave', () => this.controller.view.setHover(null));
      children.appendChild(li);
      if (focusedId === mapping.id) li.focus({ preventScroll: true });
      }
    }
  }

  renderInspector() {
    const active = document.activeElement;
    const restore = this.inspectorEl?.contains(active) && active.dataset.fr
      ? { key: active.dataset.fr, point: active.dataset.pointId, start: active.selectionStart, end: active.selectionEnd } : null;
    this._renderInspector();
    if (restore) {
      const input = [...this.inspectorEl.querySelectorAll('[data-fr]')].find(el =>
        el.dataset.fr === restore.key && el.dataset.pointId === restore.point);
      input?.focus({ preventScroll: true });
      if (input?.type === 'text' && restore.start != null) input.setSelectionRange(restore.start, restore.end);
    }
  }

  _renderInspector() {
    if (!this.inspectorEl) return;
    const mapping = (this.controller.engine.rail.mappings || [])
      .find(m => m.id === this.controller.selectedId);
    if (!mapping) {
      this.inspectorEl.innerHTML = '<p class="flow-inspector-placeholder">Select a mapping to edit points, values, and curve.</p>';
      return;
    }

    const isEvent = mapping.target?.kind === 'event';
    const type = mapping.target?.kind === 'param' ? moduleTypeForId(this.app, mapping.target.moduleId) : null;
    const entry = type ? getCatalogEntry(type, mapping.target.control) : (
      mapping.target?.kind === 'ccOut'
        ? { style: 'continuous', min: 0, max: 127, step: 1 }
        : null
    );
    const curveOpts = CURVE_OPTIONS.map(c =>
      `<option value="${c.id}" ${mapping.curve === c.id ? 'selected' : ''}>${c.label}</option>`
    ).join('');
    const discrete = entry?.style === 'discrete';
    const points = mappingPoints(mapping);
    const selectedPointId = this.controller.selectedPointId;

    const pointRows = points.map(p => `
      <div class="flow-point-row${p.id === selectedPointId ? ' selected' : ''}" data-point-id="${escapeAttr(p.id)}">
        <label class="flow-field">
          <span>CC</span>
          <input type="number" min="0" max="127" data-fr="pointCc" data-point-id="${escapeAttr(p.id)}" value="${p.cc}">
        </label>
        <label class="flow-field">
          <span>Value</span>
          <input type="${discrete ? 'text' : 'number'}" data-fr="pointVal" data-point-id="${escapeAttr(p.id)}" value="${escapeAttr(p.value)}">
        </label>
        <button type="button" class="flow-point-delete" data-fr="pointDel" data-point-id="${escapeAttr(p.id)}" title="Remove point" ${points.length <= 1 ? 'disabled' : ''}>×</button>
      </div>
    `).join('');

    this.inspectorEl.innerHTML = `
      <div class="flow-inspector">
        <label class="flow-field">
          <span>Label</span>
          <input type="text" data-fr="label" value="${escapeAttr(mapping.label || '')}" placeholder="${escapeAttr(mappingLabel(this.app, mapping))}">
        </label>
        ${this.controller.tempoTransitions.mappingStatus(mapping) && this.controller.tempoTransitions.enabled()
          ? '<p class="flow-point-hint">Tempo entry and exit arm here, then commit on sustain release. Changes within a groove land on the next bar.</p>' : ''}
        ${isEvent ? `
          <label class="flow-field">
            <span>At CC</span>
            <input type="number" min="0" max="127" data-fr="cc" value="${mapping.cc ?? 0}">
          </label>
        ` : `
          <div class="flow-point-list-header">
            <span>Flow Points</span>
            <button type="button" class="flow-add-point-btn" data-fr="addPoint">+ Add Point</button>
          </div>
          ${!discrete ? '<p class="flow-point-hint">Drag points to shape the response. Double-click a lane to add a point; double-click a point to remove it.</p>' : ''}
          <div class="flow-point-list">${pointRows}</div>
          <label class="flow-field">
            <span>Curve</span>
            <select data-fr="curve">${curveOpts}</select>
          </label>
        `}
        ${mapping.target?.kind === 'ccOut' ? `
          <div class="flow-field-row">
            <label class="flow-field">
              <span>Channel</span>
              <input type="number" min="1" max="16" data-fr="outChan" value="${mapping.target.channel}">
            </label>
            <label class="flow-field">
              <span>CC number</span>
              <input type="number" min="0" max="127" data-fr="outCc" value="${mapping.target.cc}">
            </label>
          </div>
        ` : ''}
        <button type="button" class="flow-delete-mapping" data-fr="delete">Remove mapping</button>
      </div>
    `;

    this.inspectorEl.querySelectorAll('.flow-point-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('input, button')) return;
        this.controller.selectPoint(mapping.id, row.dataset.pointId);
      });
    });

    this.inspectorEl.querySelectorAll('[data-fr]').forEach(el => {
      const key = el.dataset.fr;
      if (key === 'delete') {
        el.addEventListener('click', () => this.controller.removeMapping(mapping.id));
        return;
      }
      if (key === 'addPoint') {
        el.addEventListener('click', () => this.controller.addPointAtPlayhead(mapping.id));
        return;
      }
      if (key === 'pointDel') {
        el.addEventListener('click', () => this.controller.removeFlowPoint(mapping.id, el.dataset.pointId));
        return;
      }
      const evt = el.tagName === 'SELECT' ? 'change' : 'change';
      el.addEventListener(evt, () => this._commitInspector(mapping.id, key, el.value, el.dataset.pointId));
    });
  }

  _commitInspector(id, key, raw, pointId) {
    const rail = this.controller.engine.rail;
    const mapping = rail.mappings.find(m => m.id === id);
    if (!mapping) return;
    if (key === 'label') mapping.label = raw.slice(0, 40);
    else if (key === 'cc') {
      mapping.cc = clamp127(raw);
      mapping.range = { ccStart: mapping.cc, ccEnd: mapping.cc };
    } else if (key === 'pointCc' && pointId) {
      movePoint(mapping, pointId, clamp127(raw));
      this.controller.selectedPointId = pointId;
    } else if (key === 'pointVal' && pointId) {
      const pt = (mapping.points || []).find(p => p.id === pointId);
      if (pt) pt.value = coerceValue(raw);
    } else if (key === 'curve') mapping.curve = raw;
    else if (key === 'outChan' && mapping.target.kind === 'ccOut') mapping.target.channel = Math.max(1, Math.min(16, parseInt(raw, 10) || 1));
    else if (key === 'outCc' && mapping.target.kind === 'ccOut') mapping.target.cc = clamp127(raw);
    this.controller.persist();
    this.controller.engine.setCc(this.controller.engine.cc, { silent: true });
    this.controller.view.requestDraw();
    this.renderList();
    this.renderInspector();
  }

  renderPicker() {
    if (!this.pickerEl) return;
    const groups = listPickerGroups(this.app);
    this.pickerEl.innerHTML = '<p class="flow-picker-title">Add Mapping</p>';

    for (const group of groups) {
      const section = document.createElement('div');
      section.className = 'flow-picker-group';
      const h = document.createElement('h3');
      h.textContent = group.title;
      h.style.color = `var(${group.colorVar})`;
      section.appendChild(h);

      if (group.id === 'ccOut') {
        const row = document.createElement('div');
        row.className = 'flow-ccout-form';
        row.innerHTML = `
          <label>Ch <input type="number" min="1" max="16" value="1" data-ccout="ch"></label>
          <label>CC <input type="number" min="0" max="127" value="91" data-ccout="cc"></label>
          <button type="button" data-ccout="add">Add</button>
        `;
        row.querySelector('[data-ccout="add"]').addEventListener('click', () => {
          const ch = parseInt(row.querySelector('[data-ccout="ch"]').value, 10) || 1;
          const cc = parseInt(row.querySelector('[data-ccout="cc"]').value, 10) || 91;
          this.controller.addMapping({
            target: { kind: 'ccOut', channel: ch, cc },
            points: [makePoint(0, 0), makePoint(127, 127)],
            curve: 'linear',
            label: '',
          });
          this.togglePicker(false);
        });
        section.appendChild(row);
      } else {
        const list = document.createElement('div');
        list.className = 'flow-picker-items';
        for (const item of group.items) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'flow-picker-item';
          btn.textContent = item.label;
          btn.addEventListener('click', () => {
            this._addFromPicker(item);
            this.togglePicker(false);
          });
          list.appendChild(btn);
        }
        section.appendChild(list);
      }
      this.pickerEl.appendChild(section);
    }
  }

  _addFromPicker(item) {
    if (item.kind === 'event') {
      this.controller.addMapping({
        target: { kind: 'event', action: item.action },
        cc: 64,
        curve: 'linear',
        label: item.label,
      });
      return;
    }

    const draft = {
      id: generateFlowRailId(),
      target: { kind: 'param', moduleId: item.moduleId, control: item.control },
      curve: item.style === 'continuous' ? 'ease-out' : 'linear',
      label: '',
      points: [],
    };

    const current = readMappingValue(this.app, draft);
    if (item.style === 'discrete') {
      if (item.control === 'toggle') {
        draft.points = [makePoint(0, 0), makePoint(64, 1)];
      } else {
        draft.points = [makePoint(64, current)];
      }
    } else {
      const max = item.max ?? 127;
      draft.points = [makePoint(20, current), makePoint(100, max)];
    }
    this.controller.addMapping(draft);
  }

  _onDoubleClick(e) {
    const view = this.controller.view;
    if (!this.controller.isConfigure) return;
    e.preventDefault();
    if (!view.canEditPoints()) {
      return;
    }
    const hit = view.hitTest(e.clientX, e.clientY);
    if (hit.type === 'handle') {
      const mapping = this.controller.engine.rail.mappings.find(m => m.id === hit.mappingId);
      if ((mapping?.points?.length || 0) <= 1) {
        this.app.uiManager?.showToast('Keep at least one point, or remove the whole mapping.');
        return;
      }
      this.controller.removeFlowPoint(hit.mappingId, hit.pointId);
      return;
    }
    if (hit.type === 'checkpoint') return;
    const rect = view.canvas.getBoundingClientRect(), lay = view.layout();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (y < lay.padT || y > lay.h - lay.padB || x < lay.margin || x > lay.w - 24) return;
    const mapping = view.pointMapping(x, lay);
    if (!mapping || mapping.target?.kind === 'event') return;
    const cc = view.yToCc(y, lay);
    const type = mapping.target?.kind === 'param' ? moduleTypeForId(this.app, mapping.target.moduleId) : null;
    let value;
    if (isContinuousMapping(mapping, type)) {
      const lane = lay.lanes.get(mapping.id);
      value = view.xToValue(lane.center + Math.abs(x - lane.center), mapping, lay);
      const entry = getCatalogEntry(type, mapping.target.control);
      const step = entry?.step || 1;
      value = Math.max(entry?.min ?? 0, Math.min(entry?.max ?? 127, Math.round(value / step) * step));
    }
    this.controller.addPointAt(mapping.id, cc, value);
  }

  _onPointerDown(e) {
    const view = this.controller.view;
    if (!view) return;
    const hit = view.hitTest(e.clientX, e.clientY);
    if (e.button !== 0 || this._drag) return;
    if (hit.type === 'handle' || hit.type === 'checkpoint') view.canvas.setPointerCapture(e.pointerId);

    if (hit.type === 'handle' && this.controller.isConfigure) {
      this._drag = { kind: 'handle', mappingId: hit.mappingId, pointId: hit.pointId };
      this.controller.selectPoint(hit.mappingId, hit.pointId);
      return;
    }
    if (hit.type === 'checkpoint' && this.controller.isConfigure) {
      this._drag = { kind: 'checkpoint', id: hit.id };
      return;
    }
    if (hit.type === 'mapping') {
      this.controller.selectMapping(hit.id);
    }
  }

  _onPointerMove(e) {
    const view = this.controller.view;
    if (!view) return;
    const rect = view.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cc = view.yToCc(y);
    const lay = view.layout();

    if (!this._drag) {
      {
        const hit = view.hitTest(e.clientX, e.clientY);
        if (hit.type === 'handle') view.setHover(hit.mappingId, { mappingId: hit.mappingId, pointId: hit.pointId });
        else if (hit.type === 'mapping') view.setHover(hit.id, null);
        else view.setHover(null, null);
        view.canvas.style.cursor = hit.type === 'handle' ? 'move' : hit.type === 'checkpoint' ? 'ns-resize' : hit.type === 'mapping' ? 'pointer' : 'default';
      }
      return;
    }

    if (this._drag.kind === 'checkpoint') {
      const cp = this.controller.engine.rail.checkpoints.find(c => c.id === this._drag.id);
      if (cp) {
        cp.cc = cc;
        this.controller.engine.rail.checkpoints.sort((a, b) => a.cc - b.cc);
        this.controller.view.requestDraw();
      }
      return;
    }
    if (this._drag.kind === 'handle') {
      const mapping = this.controller.engine.rail.mappings.find(m => m.id === this._drag.mappingId);
      if (!mapping) return;
      const type = mapping.target?.kind === 'param' ? moduleTypeForId(this.app, mapping.target.moduleId) : null;
      const continuous = isContinuousMapping(mapping, type);
      let value;
      if (continuous) {
        value = view.xToValue(x, mapping, lay);
        const entry = type ? getCatalogEntry(type, mapping.target.control) : { step: 1, min: 0, max: 127 };
        const step = entry?.step ?? 1;
        if (step >= 1) value = Math.round(value);
        const min = entry?.min ?? 0;
        const max = entry?.max ?? 127;
        value = Math.max(min, Math.min(max, value));
      }
      const moved = setPointPosition(mapping, this._drag.pointId, cc, value);
      if (moved) this.controller.selectedPointId = moved.id;
      this.controller.view.requestDraw();
      this.renderList();
    }
  }

  _onPointerUp() {
    if (this._drag && this._drag.kind === 'handle') {
      const mapping = this.controller.engine.rail.mappings.find(m => m.id === this._drag.mappingId);
      if (mapping) commitPoints(mapping, this._drag.pointId);
      this.controller.persist();
      this.renderInspector();
    } else if (this._drag && this._drag.kind === 'checkpoint') {
      this.controller.persist();
      this.renderCheckpoints();
    }
    this._drag = null;
  }
}

function clamp127(v) {
  return Math.max(0, Math.min(127, Math.round(Number(v) || 0)));
}

function coerceValue(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && String(raw).trim() !== '' ? n : raw;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

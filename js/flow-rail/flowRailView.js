import { mappingGroups } from './flowMappingGroups.js?v=1';
/** Pedal-driven landscape. Drawing is demand-based and never writes to the engine. */
import { isContinuousMapping, moduleTypeForId, colorVarForModule, mappingLabel, mappingPoints,
  interpolate, stepValue, getCatalogEntry, formatParamValue } from './flowRailCatalog.js?v=4';
import { instrumentDeckLayout, landscapeY, landscapeCc, ribbonPoints, ribbonValue } from './flowLandscapeGeometry.js?v=4';

export class FlowRailView {
  constructor(canvas, engine, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.app = app;
    this.width = 0;
    this.height = 0;
    this.configure = false;
    this.presentation = 'stack';
    this._activeGroupId = null;
    this._rememberedCards = new Map();
    this._expandedGroups = new Set();
    this._cardControls = new Map();
    this.cardControls = document.getElementById('flow-card-controls');
    this._transition = null;
    this._deckAnchors = new Map();
    this.selectedId = null;
    this.hoveredId = null;
    this.hoveredHandle = null;
    this._rafId = null;
    this._soundButtons = new Map();
    this.strip = document.getElementById('flow-sound-strip');
    this.landscape = document.getElementById('flow-landscape');
    this.slider = document.getElementById('flow-position-slider');
    this.position = document.getElementById('flow-position-value');
    this.ccLabel = document.getElementById('flow-position-cc');
    this.annotation = document.getElementById('flow-current-annotation');
    this.grooveEl = document.getElementById('flow-groove');
    this.resize = this.resize.bind(this);
    this._draw = this._draw.bind(this);
    this._observer = new ResizeObserver(this.resize);
    this._observer.observe(canvas.parentElement);
    this._themeObserver = new MutationObserver(() => this.requestDraw());
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.slider?.addEventListener('input', () => this.engine.setCc(Number(this.slider.value)));
  }

  destroy() {
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._observer.disconnect();
    this._themeObserver.disconnect();
  }

  setConfigure(on) {
    this.configure = !!on;
    if (on && !this.selectedId && this.focusedId()) this.app.flowRail?.selectMapping(this.focusedId());
    this.requestDraw();
  }
  _beginTransition() {
    this._transition = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : { from: this.layout(), start: performance.now() };
  }
  setPresentation(mode) {
    const group = this.activeGroup();
    if (group && ['stack', 'fan'].includes(mode) && this._expandedGroups.has(group.id) !== (mode === 'fan')) this.toggleGroup(group.id);
  }
  toggleGroup(groupId, mappingId = null) {
    const group = this.groups().find(g => g.id === groupId);
    if (!group || group.mappings.length < 2) return;
    this._beginTransition();
    const closing = this._expandedGroups.has(groupId);
    if (closing) this._expandedGroups.delete(groupId);
    else {
      this._deckAnchors.set(groupId, this._rememberedCards.get(groupId) || group.mappings[0].id);
      this._expandedGroups.add(groupId);
    }
    const transition = this._transition;
    if (mappingId) {
      this._rememberedCards.set(groupId, mappingId);
      // Select through the controller so the numeric inspector stays in sync.
      this.app.flowRail.selectMapping(mappingId);
    }
    this._transition = transition;
    if (closing && transition && mappingId) {
      const scroll = this.landscape.parentElement;
      transition.scrollAnchor = { id: mappingId, center: transition.from.lanes.get(mappingId).center, left: scroll.scrollLeft };
    }
    this.presentation = closing ? 'stack' : 'fan';
    this.requestDraw();
  }
  groups() { return mappingGroups(this.engine.rail.mappings || [], this.app); }
  activeGroup() {
    const groups = this.groups();
    return groups.find(group => group.id === this._activeGroupId) || groups[0];
  }
  focusedId() {
    const group = this.activeGroup();
    return group?.mappings.find(m => m.id === this._rememberedCards.get(group.id))?.id || group?.mappings[0]?.id || null;
  }
  displayedMappings() { return this.groups().flatMap(group => group.mappings); }
  cycleCard(direction) {
    const mappings = this.activeGroup()?.mappings || [];
    if (!mappings.length) return;
    const index = mappings.findIndex(m => m.id === this.focusedId());
    this.app.flowRail.selectMapping(mappings[(index + direction + mappings.length) % mappings.length].id);
  }
  selectInstrument(id) {
    const group = this.groups().find(g => g.id === id);
    if (!group) return;
    this.app.flowRail.selectMapping(group.mappings.find(m => m.id === this._rememberedCards.get(id))?.id || group.mappings[0].id);
  }
  canEditPoints() { return this.configure && !this._transition; }
  setSelection(id) {
    const group = this.groups().find(g => g.mappings.some(m => m.id === id));
    if (group) {
      if (group.id !== this.activeGroup()?.id || (!this._expandedGroups.has(group.id) && id !== this.focusedId())) this._beginTransition();
      this._activeGroupId = group.id; this._rememberedCards.set(group.id, id);
    }
    this.selectedId = id; this.requestDraw();
  }
  setHover(id, handle = null) { this.hoveredId = id; this.hoveredHandle = handle; this.requestDraw(); }
  requestDraw() {
    if (this._rafId == null) this._rafId = requestAnimationFrame(this._draw);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.requestDraw();
  }

  layout() {
    const target = instrumentDeckLayout(this.width, this.height, this.groups(), this.engine.rail.checkpoints, this._expandedGroups, this._rememberedCards, this._deckAnchors);
    if (this._transition) {
      const t = Math.min(1, (performance.now() - this._transition.start) / 280);
      const ease = 1 - Math.pow(1 - t, 3);
      for (const [id, lane] of target.lanes) {
        const from = this._transition.from.lanes.get(id);
        if (from) for (const key of ['center', 'radius', 'cardWidth']) lane[key] = from[key] + (lane[key] - from[key]) * ease;
      }
      if (t >= 1) this._transition = null;
    }
    return target;
  }
  pointMapping(x, lay = this.layout()) {
    return this.displayedMappings().filter(m => lay.lanes.get(m.id).depth === 0)
      .find(m => Math.abs(x - lay.lanes.get(m.id).center) < lay.lanes.get(m.id).cardWidth / 2);
  }

  ccToY(cc, lay = this.layout()) { return landscapeY(cc, lay); }
  yToCc(y, lay = this.layout()) { return landscapeCc(y, lay); }
  trajectoryPoints(mapping, lay = this.layout()) { return ribbonPoints(mapping, lay, this.app); }
  xToValue(x, mapping, lay = this.layout()) { return ribbonValue(x, mapping, lay, this.app); }
  _type(mapping) { return mapping.target?.kind === 'param' ? moduleTypeForId(this.app, mapping.target.moduleId) : null; }
  _continuous(mapping) { return mapping.target?.kind !== 'event' && isContinuousMapping(mapping, this._type(mapping)); }
  _colorVar(mapping) {
    return mapping.target?.kind === 'event' ? '--accent-yellow' : mapping.target?.kind === 'ccOut'
      ? '--accent-cyan' : colorVarForModule(this._type(mapping), mapping.target?.moduleId);
  }
  _color(variable) { return this._styles.getPropertyValue(variable).trim() || '#00bcd4'; }
  _eventPositions(mapping) {
    return mapping.target?.kind === 'event' ? [mapping.cc ?? 0] : mappingPoints(mapping).map(p => p.cc);
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const lay = this.layout();
    if (this._transition) return { type: 'none' };
    const mappings = this.displayedMappings();
    const selected = mappings.find(m => m.id === this.selectedId);
    if (this.canEditPoints() && selected && lay.lanes.get(selected.id)?.depth === 0 && selected.target?.kind !== 'event') {
      const pts = this._continuous(selected) ? this.trajectoryPoints(selected, lay) : null;
      for (const bp of mappingPoints(selected).slice().reverse()) {
        const p = pts ? pts[bp.cc] : { x: lay.lanes.get(selected.id).center, y: this.ccToY(bp.cc, lay) };
        if (p && Math.hypot(x - p.x, y - p.y) < 14) return { type: 'handle', mappingId: selected.id, pointId: bp.id };
      }
    }
    if (this.configure) {
      for (const cp of this.engine.rail.checkpoints || []) {
        if (x >= 0 && x < lay.margin && Math.abs(y - this.ccToY(cp.cc, lay)) < 10) return { type: 'checkpoint', id: cp.id };
      }
    }
    if (y < lay.padT - 10 || y > lay.h - lay.padB + 10) return { type: 'none' };

    const card = [...mappings].sort((a, b) => lay.lanes.get(a.id).depth - lay.lanes.get(b.id).depth)
      .find(m => lay.lanes.get(m.id).depth < 4 && Math.abs(x - lay.lanes.get(m.id).center) < lay.lanes.get(m.id).cardWidth / 2);
    if (card) return { type: 'mapping', id: card.id };
    return { type: 'none' };
  }

  _discreteX(mapping, lay) { return lay.lanes.get(mapping.id).center; }

  _syncGroove() {
    const transitions = this.app.flowRail?.tempoTransitions;
    if (!transitions || !this.grooveEl) return;
    const info = transitions.status();
    this.grooveEl.dataset.state = info.state;
    const title = document.getElementById('flow-groove-state');
    const detail = document.getElementById('flow-groove-detail');
    // Announce changes in intent/actual state, never every beat or CC update.
    if (title.textContent !== info.title) title.textContent = info.title;
    if (detail.textContent !== info.detail) detail.textContent = info.detail;
    const beats = document.getElementById('flow-groove-beats');
    const count = this.app.engine.clock.beatsPerBar;
    if (beats.children.length !== count) beats.replaceChildren(...Array.from({ length: count }, () => document.createElement('i')));
    [...beats.children].forEach((dot, i) => dot.classList.toggle('current', info.inGroove && i === transitions.beat));
    this.canvas.parentElement.dataset.groove = info.state;
  }

  _syncStatus(lay) {
    this._syncGroove();
    const cc = this.engine.cc;
    if (this.slider) {
      this.slider.value = String(cc);
      this.slider.style.setProperty('--flow-progress', `${cc / 127 * 100}%`);
      this.slider.style.setProperty('--flow-slider-length', `${lay.innerH + 16}px`);
      this.slider.parentElement.style.setProperty('--flow-axis-top', `${lay.padT - 18}px`);
      this.slider.style.setProperty('--flow-slider-center', `${lay.padT + lay.innerH / 2}px`);
      this.slider.parentElement.style.setProperty('--flow-strip-height', `${this.strip?.getBoundingClientRect().height || 114}px`);
    }
    if (this.position) this.position.textContent = `${Math.round(cc / 127 * 100)}%`;
    if (this.ccLabel) this.ccLabel.textContent = `CC ${cc} / 127`;
    const previous = (this.engine.rail.checkpoints || []).filter(cp => cp.cc <= cc && cp.name).at(-1);
    if (this.annotation) this.annotation.textContent = previous?.name || '';
    if (!this.strip) return;
    this._syncDeckControls(lay);
    const mappings = this.displayedMappings();
    this.strip.dataset.presentation = this.presentation;
    const ids = new Set(mappings.map(m => m.id));
    for (const [id, button] of this._soundButtons) {
      if (!ids.has(id)) { button.remove(); this._soundButtons.delete(id); }
    }
    mappings.forEach((mapping, i) => {
      let button = this._soundButtons.get(mapping.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'flow-sound';
        const label = document.createElement('span'); label.className = 'flow-sound-label';
        const value = document.createElement('strong'); value.className = 'flow-sound-value';
        const timing = document.createElement('span'); timing.className = 'flow-sound-timing';
        button.append(label, value, timing);
        button.addEventListener('click', () => this.app.flowRail.selectMapping(mapping.id));
        button.addEventListener('mouseenter', () => this.setHover(mapping.id));
        button.addEventListener('mouseleave', () => this.setHover(null));
        this._soundButtons.set(mapping.id, button);
      }

      const label = mappingLabel(this.app, mapping);
      const tempo = this.app.flowRail?.tempoTransitions?.mappingStatus(mapping);
      const value = tempo ? (tempo.on ? 'On' : 'Off') : mapping.target?.kind === 'event' ? `At ${mapping.cc ?? 0}`
        : formatParamValue(getCatalogEntry(this._type(mapping), mapping.target?.control),
          this._continuous(mapping) ? interpolate(cc, mapping) : stepValue(cc, mapping));
      button.children[0].textContent = label;
      button.children[1].textContent = value;
      button.children[2].textContent = tempo?.timing || '';
      button.dataset.pending = String(!!tempo?.pending);
      button.setAttribute('aria-label', `${label}: ${value}${tempo ? ', ' + tempo.timing : ''}`);
      button.title = `${label} · ${value}`;
      button.setAttribute('aria-pressed', String(mapping.id === this.selectedId));
      button.style.setProperty('--sound-color', this._color(this._colorVar(mapping)));
    });
    mappings.forEach((mapping, i) => {
      const button = this._soundButtons.get(mapping.id), lane = lay.lanes.get(mapping.id);
      if (this.strip.children[i] !== button) this.strip.insertBefore(button, this.strip.children[i] || null);
      button.style.left = `${lane.center - lane.cardWidth / 2}px`;
      button.style.width = `${lane.cardWidth}px`;
      button.hidden = lane.depth !== 0;
    });
  }

  _syncDeckControls(lay) {
    const groups = this.groups();
    const ids = new Set(this.displayedMappings().map(m => m.id));
    for (const [id, el] of this._cardControls) if (!ids.has(id)) { el.remove(); this._cardControls.delete(id); }
    for (const group of groups) for (const mapping of group.mappings) {
      const lane = lay.lanes.get(mapping.id);
      let el = this._cardControls.get(mapping.id);
      if (!el) {
        el = document.createElement('div'); el.className = 'flow-card-header';
        const name = document.createElement('button'); name.type = 'button'; name.className = 'flow-card-name';
        name.addEventListener('click', () => this.app.flowRail.selectMapping(mapping.id));
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'flow-card-fold';
        toggle.addEventListener('click', () => this.toggleGroup(group.id, mapping.id));
        el.append(name, toggle); this.cardControls.append(el); this._cardControls.set(mapping.id, el);
      }
      el.hidden = lane.depth !== 0;
      el.style.left = `${lane.center - lane.cardWidth / 2 + 12}px`;
      el.style.width = `${lane.cardWidth - 24}px`;
      const [name, toggle] = el.children;
      name.textContent = `${group.label}${lane.expanded ? '' : ' · ' + group.mappings.length}`;
      name.title = `Select ${mappingLabel(this.app, mapping)}`;
      const open = this._expandedGroups.has(group.id);
      toggle.textContent = open ? '⇤' : '⇥';
      const action = `${open ? 'Collapse' : 'Fan out'} ${group.label} parameters`;
      toggle.setAttribute('aria-label', action); toggle.title = action;
      toggle.setAttribute('aria-expanded', String(open)); toggle.hidden = group.mappings.length < 2;
      el.dataset.pending = String(group.mappings.some(m => this.app.flowRail?.tempoTransitions?.mappingStatus(m)?.pending));
    }
  }

  _draw() {
    this._rafId = null;
    const mappings = this.displayedMappings();
    const geometry = this.layout();
    const minWidth = Math.max(geometry.contentWidth, this._transition?.from.contentWidth || 0);
    if (this.landscape && this.landscape.style.minWidth !== `${minWidth}px`) {
      this.landscape.style.minWidth = `${minWidth}px`;
      this.resize();
    }
    const ctx = this.ctx, lay = this.layout();
    this._styles = getComputedStyle(document.documentElement);
    this._syncStatus(lay);
    const anchor = this._transition?.scrollAnchor;
    if (anchor && lay.lanes.has(anchor.id)) this.landscape.parentElement.scrollLeft = Math.max(0, anchor.left + lay.lanes.get(anchor.id).center - anchor.center);
    if (lay.w < 8 || lay.h < 8) return;
    ctx.clearRect(0, 0, lay.w, lay.h);
    const text = this._color('--text-primary');
    const dim = this._color('--text-secondary');
    const cyan = this._color('--accent-cyan');
    const playY = this.ccToY(this.engine.cc, lay);
    const groove = this.app.flowRail?.tempoTransitions?.status();
    const playColor = groove?.state === 'entry' || groove?.state === 'exit' || groove?.state === 'queued' ? this._color('--accent-yellow') : cyan;

    // Quiet reference lines make pedal position legible without adding a graph grid.
    for (const cc of [0, 64, 127]) {
      ctx.globalAlpha = 0.09; ctx.strokeStyle = dim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lay.margin, this.ccToY(cc, lay)); ctx.lineTo(lay.w - 24, this.ccToY(cc, lay)); ctx.stroke();
    }
    const paintOrder = [...mappings].sort((a, b) => lay.lanes.get(b.id).depth - lay.lanes.get(a.id).depth);
    for (const mapping of paintOrder) {
      const lane = lay.lanes.get(mapping.id);
      if (lane.depth >= 4 && !this._transition) continue;
      const color = this._color(this._colorVar(mapping));
      const selected = mapping.id === this.selectedId;
      const emphasis = selected || mapping.id === this.hoveredId;
      const muted = this.configure && this.selectedId && !emphasis;
      ctx.globalAlpha = 1; ctx.fillStyle = this._color('--flow-card-bg');
      ctx.shadowColor = 'rgba(0,0,0,0.16)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
      ctx.beginPath(); ctx.roundRect(lane.center - lane.cardWidth / 2, 10, lane.cardWidth, Math.max(32, lay.h - 20), 16); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.globalAlpha = selected || mapping.id === this.focusedId() ? 0.35 : 0.12; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = text; ctx.font = '500 13px Outfit, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      let label = mapping.label || getCatalogEntry(this._type(mapping), mapping.target?.control)?.label || mappingLabel(this.app, mapping);
      while (ctx.measureText(label).width > lane.cardWidth - 40 && label.length > 1) label = label.slice(0, -2) + '…';
      ctx.fillText(label, lane.center - lane.cardWidth / 2 + 18, 65);
      if (this._continuous(mapping)) {
        const pts = this.trajectoryPoints(mapping, lay);
        ctx.beginPath(); ctx.moveTo(pts[0].left, pts[0].y);
        for (const p of pts) ctx.lineTo(p.left, p.y);
        for (const p of pts.slice().reverse()) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fillStyle = color; ctx.globalAlpha = muted ? 0.045 : 0.09; ctx.fill();
        ctx.save(); ctx.clip();
        ctx.globalAlpha = muted ? 0.08 : 0.16;
        ctx.fillRect(0, playY, lay.w, lay.h - playY);
        ctx.restore();
        ctx.strokeStyle = color; ctx.globalAlpha = muted ? 0.28 : emphasis ? 0.85 : 0.5;
        ctx.lineWidth = emphasis ? 1.8 : 1.2; ctx.stroke();
        const current = pts[this.engine.cc];
        ctx.globalAlpha = muted ? 0.45 : 1;
        ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(current.left, playY); ctx.lineTo(current.x, playY); ctx.stroke();
        ctx.beginPath(); ctx.arc(lane.center, playY, emphasis ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
        if (this.canEditPoints() && selected) {
          for (const bp of mappingPoints(mapping)) {
            const p = pts[bp.cc];
            const hot = this.hoveredHandle?.pointId === bp.id;
            ctx.globalAlpha = 1; ctx.fillStyle = this._color('--bg-dark'); ctx.strokeStyle = color; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, hot ? 7 : 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
      } else {
        const discreteX = this._discreteX(mapping, lay);
        // Tempo on-regions remain visible before and after the threshold is armed.
        const tempo = this.app.flowRail?.tempoTransitions?.mappingStatus(mapping);
        if (tempo && mapping.target?.kind === 'param') {
          ctx.fillStyle = color; ctx.globalAlpha = 0.08;
          for (let cc = 0; cc < 127; cc++) {
            if (Number(stepValue(cc, mapping)) >= 0.5) {
              const top = this.ccToY(cc + 1, lay);
              ctx.fillRect(discreteX - lane.radius * 0.65, top, lane.radius * 1.3, lay.innerH / 127 + 0.2);
            }
          }
        }
        ctx.strokeStyle = color; ctx.globalAlpha = 0.2; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(discreteX, lay.padT); ctx.lineTo(discreteX, lay.h - lay.padB); ctx.stroke();
        for (const cc of this._eventPositions(mapping)) {
          const y = this.ccToY(cc, lay);
          ctx.globalAlpha = this.engine.cc >= cc ? 0.95 : 0.5;
          ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(discreteX, y - 6);
          ctx.lineTo(discreteX + 6, y); ctx.lineTo(discreteX, y + 6); ctx.lineTo(discreteX - 6, y); ctx.closePath(); ctx.fill();
        }
        if (this.canEditPoints() && selected && mapping.target?.kind !== 'event') {
          for (const point of mappingPoints(mapping)) {
            ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(discreteX, this.ccToY(point.cc, lay), 9, 0, Math.PI * 2); ctx.stroke();
          }
        }
      }
    }
    ctx.globalAlpha = groove?.inGroove ? 0.8 : 0.4; ctx.strokeStyle = playColor; ctx.lineWidth = groove?.inGroove ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(lay.margin, playY); ctx.lineTo(lay.w - 24, playY); ctx.stroke();
    ctx.globalAlpha = 1;
    // Labels have their own margin; crowded checkpoints retain their true marker positions.
    let lastLabelY = -Infinity;
    for (const cp of (this.engine.rail.checkpoints || []).slice().sort((a, b) => b.cc - a.cc)) {
      const y = this.ccToY(cp.cc, lay);
      ctx.globalAlpha = cp.cc <= this.engine.cc ? 0.7 : 0.4;
      ctx.strokeStyle = dim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lay.margin - 10, y); ctx.lineTo(lay.margin - 3, y); ctx.stroke();
      if (cp.name && y - lastLabelY >= 18) {
        ctx.fillStyle = text; ctx.font = '500 11px Outfit, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        let label = cp.name;
        while (ctx.measureText(label).width > lay.margin - 24 && label.length > 1) label = label.slice(0, -2) + '…';
        ctx.fillText(label, lay.margin - 17, y); lastLabelY = y;
      }
    }
    ctx.globalAlpha = 1;
    if (this._transition) this.requestDraw();
  }
}

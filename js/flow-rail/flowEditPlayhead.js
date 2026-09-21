/**
 * Compact CC playhead in the EDIT sidebar.
 * Scrubbing applies Flow Rail mappings so module cards follow the envelope.
 */

import { rafThrottle } from '../utils/rafThrottle.js';
import { isContinuousMapping, moduleTypeForId, colorVarForModule, mappingPoints } from './flowRailCatalog.js?v=3';
import { mappingSpan } from './flowRailState.js?v=3';
import { assignLanes, trajectoryPoints as buildTrajectory } from './flowRailGeometry.js?v=5';

export class FlowEditPlayhead {
  constructor(engine, app) {
    this.engine = engine;
    this.app = app;
    this.root = document.getElementById('flow-edit-playhead');
    this.canvas = document.getElementById('flow-edit-playhead-canvas');
    this.ccEl = document.getElementById('flow-edit-playhead-cc');
    this.ctx = this.canvas?.getContext('2d') || null;
    this._rafId = null;
    this._dragging = false;
    this._lanes = new Map();

    if (!this.canvas || !this.ctx) return;

    this._draw = this._draw.bind(this);
    this.resize = this.resize.bind(this);
    this._resizeHandler = rafThrottle(() => this.resize());
    window.addEventListener('resize', this._resizeHandler);

    this.canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this._scrub(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this._dragging) this._scrub(e);
    });
    this.canvas.addEventListener('pointerup', () => { this._dragging = false; });
    this.canvas.addEventListener('pointercancel', () => { this._dragging = false; });

    this.resize();
  }

  _cssColor(varName, fallback = '#00e5ff') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return raw || fallback;
  }

  _parseRgb(color) {
    const c = color.trim();
    if (c.startsWith('#')) {
      const hex = c.length === 4
        ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
        : c;
      return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
      };
    }
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return { r: 0, g: 229, b: 255 };
  }

  _rgba(color, a) {
    const { r, g, b } = this._parseRgb(color);
    return `rgba(${r},${g},${b},${a})`;
  }

  layout() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const padT = 14;
    const padB = 14;
    return { w, h, padT, padB, railX: w * 0.5, innerH: Math.max(1, h - padT - padB) };
  }

  ccToY(cc, lay) {
    return lay.padT + (1 - cc / 127) * lay.innerH;
  }

  yToCc(y, lay) {
    const t = (y - lay.padT) / lay.innerH;
    return Math.max(0, Math.min(127, Math.round((1 - t) * 127)));
  }

  _scrub(e) {
    const rect = this.canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const cc = this.yToCc(y, this.layout());
    this.engine.setCc(cc, { silent: true });
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.requestDraw();
  }

  requestDraw() {
    if (!this.ctx) return;
    if (this._rafId == null) this._rafId = requestAnimationFrame(this._draw);
  }

  refresh() {
    if (this.ccEl) this.ccEl.textContent = `CC ${this.engine.cc}`;
    this.requestDraw();
  }

  _draw() {
    this._rafId = null;
    if (!this.ctx) return;
    const { ctx } = this;
    const lay = this.layout();
    ctx.clearRect(0, 0, lay.w, lay.h);

    this._lanes = assignLanes(this.engine.rail, this.app, { magBase: 12, magStep: 10 });

    const cyan = this._cssColor('--accent-cyan');
    const dim = this._cssColor('--text-dim', '#6b7280');
    const cc = this.engine.cc;
    const playY = this.ccToY(cc, lay);
    const x = lay.railX;
    const y0 = this.ccToY(0, lay);
    const y127 = this.ccToY(127, lay);

    this._drawTrajectories(ctx, lay, cc);

    ctx.strokeStyle = this._rgba(dim, 0.35);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, y127);
    ctx.lineTo(x, playY);
    ctx.stroke();

    ctx.strokeStyle = this._rgba(cyan, 0.55);
    ctx.lineWidth = 2;
    ctx.shadowColor = this._rgba(cyan, 0.35);
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x, playY);
    ctx.lineTo(x, y0);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = this._rgba(dim, 0.7);
    ctx.font = '600 10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('127', x - 10, y127 + 3);
    ctx.fillText('0', x - 10, y0 + 3);

    this._drawEventTicks(ctx, lay, dim, cc);

    ctx.beginPath();
    ctx.arc(x, playY, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = this._rgba('#ffffff', 0.92);
    ctx.shadowColor = this._rgba(cyan, 0.65);
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = this._rgba(cyan, 0.95);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  _drawTrajectories(ctx, lay, cc) {
    const rail = this.engine.rail;
    for (const mapping of rail.mappings || []) {
      if (mapping.target?.kind === 'event') continue;
      const type = mapping.target?.kind === 'param'
        ? moduleTypeForId(this.app, mapping.target.moduleId)
        : null;
      if (!isContinuousMapping(mapping, type)) continue;

      const color = mapping.target?.kind === 'ccOut'
        ? this._cssColor('--accent-cyan')
        : this._cssColor(colorVarForModule(type, mapping.target.moduleId));
      const pts = buildTrajectory(mapping, lay, this._lanes, this.app, (c, l) => this.ccToY(c, l));
      const { ccStart: start, ccEnd: end } = mappingSpan(mapping);
      const active = cc >= start && cc <= end;

      this._strokeSpan(ctx, pts, 0, start - 1, color, active ? 0.22 : 0.12, 1);
      this._strokeSpan(ctx, pts, Math.max(start, cc), end, color, 0.18, 1.05);
      this._strokeSpan(ctx, pts, start, Math.min(end, cc), color, active ? 0.9 : 0.4, active ? 1.85 : 1.25);
      this._strokeSpan(ctx, pts, end + 1, 127, color, 0.14, 1);

      for (const bp of mappingPoints(mapping)) {
        this._breakpointDot(ctx, pts[bp.cc], color);
      }
    }
  }

  _strokeSpan(ctx, pts, ccA, ccB, color, alpha, width) {
    const a = Math.max(0, Math.min(127, ccA));
    const b = Math.max(0, Math.min(127, ccB));
    if (b < a) return;
    ctx.strokeStyle = this._rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    for (let n = a; n <= b; n++) {
      const p = pts[n];
      if (!p) continue;
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    if (started) ctx.stroke();
  }

  _breakpointDot(ctx, pt, color) {
    if (!pt) return;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = this._rgba(color, 0.9);
    ctx.fill();
    ctx.strokeStyle = this._rgba('#ffffff', 0.3);
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  _drawEventTicks(ctx, lay, dim, cc) {
    for (const mapping of this.engine.rail.mappings || []) {
      const type = mapping.target?.kind === 'param'
        ? moduleTypeForId(this.app, mapping.target.moduleId)
        : null;
      const isEvent = mapping.target?.kind === 'event';
      const isStep = isEvent || (mapping.target?.kind === 'param' && !isContinuousMapping(mapping, type));
      if (!isStep) continue;
      const ats = isEvent
        ? [mapping.cc ?? mapping.range?.ccStart ?? 0]
        : mappingPoints(mapping).map(p => p.cc);
      for (const at of ats) {
        const y = this.ccToY(at, lay);
        const past = cc >= at;
        ctx.strokeStyle = this._rgba(dim, past ? 0.65 : 0.28);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lay.railX + 6, y);
        ctx.lineTo(lay.railX + 12, y);
        ctx.stroke();
      }
    }
  }
}

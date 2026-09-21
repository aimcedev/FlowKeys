/**
 * NoteActivityViz — displays active MIDI notes as vertical bars at their piano
 * pitch positions.  Used by the keyboard module card and (with a different input
 * API) the sidebar activity monitor.
 *
 * Bar positions map the full MIDI range (21 A0 → 108 C8) linearly across the
 * canvas width.  Each bar decays smoothly after the note is released.
 */
import { rafThrottle } from '../utils/rafThrottle.js';

export class NoteActivityViz {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {string} color   — CSS hex colour for the bars
   */
  constructor(canvas, color) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.color  = color || '#3cd4e0';

    this.minNote = 21;
    this.maxNote = 108;

    this._activeNotes = new Set();   // notes currently held
    this._decayLevels = new Map();   // note → brightness 0–1

    this._rafId  = null;
    this._lastTs = performance.now();
    this._w      = 1;
    this._h      = 1;

    this._resizeHandler = rafThrottle(() => this._resize());
    window.addEventListener('resize', this._resizeHandler);

    this._rafId = requestAnimationFrame(() => {
      this._resize();
      this._loop = this._drawLoop.bind(this);
      this._rafId = requestAnimationFrame(this._loop);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Accept an array of MIDI note numbers currently active. */
  setActiveNotes(notes) {
    const next = new Set(notes);
    for (const n of next) {
      this._decayLevels.set(n, 1.0); // new or held — full brightness
    }
    this._activeNotes = next;
  }

  setNoteRange(minNote, maxNote) {
    this.minNote = minNote;
    this.maxNote = maxNote;
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._resizeHandler.cancel();
    window.removeEventListener('resize', this._resizeHandler);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = rect.width  * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this._w = rect.width;
    this._h = rect.height;
  }

  _drawLoop(ts) {
    const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
    this._lastTs = ts;

    const { ctx, _w: w, _h: h } = this;
    ctx.clearRect(0, 0, w, h);

    // Decay released notes
    for (const [note, level] of this._decayLevels) {
      if (this._activeNotes.has(note)) {
        this._decayLevels.set(note, 1.0);
      } else {
        const next = level - dt * 3.5;
        if (next <= 0) this._decayLevels.delete(note);
        else           this._decayLevels.set(note, next);
      }
    }

    const hasNotes = this._decayLevels.size > 0;

    // Centre baseline
    ctx.strokeStyle = this._rgba(hasNotes ? 0.06 : 0.1);
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0,     h / 2);
    ctx.lineTo(w,     h / 2);
    ctx.stroke();

    // Bars
    const minNote = this.minNote;
    const maxNote = this.maxNote;
    const range   = (maxNote - minNote) || 1;

    for (const [note, level] of this._decayLevels) {
      const x    = ((note - minNote) / range) * w;
      const barH = (h - 10) * level;
      const y    = (h - barH) / 2;

      // Soft glow halo
      ctx.globalAlpha = level * 0.18;
      ctx.fillStyle   = this.color;
      ctx.fillRect(x - 6, y, 12, barH);

      // Crisp main bar
      ctx.globalAlpha = level * 0.82;
      ctx.fillRect(x - 1.5, y, 3, barH);
    }

    ctx.globalAlpha = 1;
    this._rafId = requestAnimationFrame(this._loop);
  }

  _rgba(alpha) {
    if (this.color.startsWith('#')) {
      const r = parseInt(this.color.slice(1, 3), 16);
      const g = parseInt(this.color.slice(3, 5), 16);
      const b = parseInt(this.color.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return this.color;
  }
}

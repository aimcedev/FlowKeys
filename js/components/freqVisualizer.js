/**
 * OscilloscopeVisualizer — per-module oscilloscope waveform display.
 *
 * Synthesises a waveform from active MIDI notes using frequency ratios relative
 * to the lowest active note.  Phase advances in "cycles of the lowest note"
 * space at a slow visual rate (~0.15 cycles/sec), so the wave drifts gently
 * rather than scrolling at audio rate.  The result is a stable, readable trace
 * that shows chord structure through natural interference patterns.
 */
import { rafThrottle } from '../utils/rafThrottle.js';

export class OscilloscopeVisualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ color?: string }} options
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.color  = options.color || '#00e5ff';

    this._activeNotes = [];
    this._activity    = 0;
    this._phase       = 0; // in "cycles of lowest note" space
    this._idle        = false;

    this._rafId  = null;
    this._lastTs = performance.now();
    this._w      = 1;
    this._h      = 1;

    this._resizeHandler = rafThrottle(() => this._resize());
    window.addEventListener('resize', this._resizeHandler);

    this._rafId = requestAnimationFrame(() => {
      this._resize();
      this.drawLoop = this._drawLoop.bind(this);
      this._rafId = requestAnimationFrame(this.drawLoop);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setActiveNotes(notes) {
    this._activeNotes = [...notes];
  }

  setActivity(level) {
    this._activity = Math.max(0, Math.min(1, level));
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
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = rect.width  * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this._w = rect.width;
    this._h = rect.height;
  }

  /**
   * Evaluate the synthesised waveform at normalised time normT.
   * normT is in units of "cycles of the lowest active note", so the display
   * always shows exactly NUM_CYCLES cycles regardless of pitch.
   * Each active note's ratio relative to the lowest note is used, which means
   * a fifth (ratio 1.5) completes 1.5× as many cycles as the root — producing
   * the natural interference patterns you would see on an audio oscilloscope.
   * Limited to notes within 3 octaves of the lowest to avoid visual noise.
   */
  _sample(normT) {
    if (this._activeNotes.length === 0) return 0;

    const lowestNote   = Math.min(...this._activeNotes);
    const harmonicAmps = [1.0, 0.45, 0.18];
    let sum = 0;

    for (const note of this._activeNotes) {
      if (note - lowestNote > 36) continue; // skip notes >3 octaves above root
      const ratio = Math.pow(2, (note - lowestNote) / 12);
      for (let h = 0; h < harmonicAmps.length; h++) {
        sum += harmonicAmps[h] * Math.sin(2 * Math.PI * ratio * (h + 1) * normT);
      }
    }

    const maxAmp = this._activeNotes.length * harmonicAmps.reduce((a, b) => a + b, 0);
    return maxAmp > 0 ? sum / maxAmp : 0;
  }

  _drawLoop(ts) {
    const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
    this._lastTs = ts;

    // Gentle visual drift — 0.15 cycles/sec, ~6.7 sec for one full scroll
    this._phase += dt * 0.15;

    const hasNotes    = this._activeNotes.length > 0;
    const hasActivity = hasNotes || this._activity > 0.005;

    if (!hasNotes && this._activity > 0) {
      this._activity = Math.max(0, this._activity - dt * 1.8);
    }

    if (!hasActivity) {
      if (!this._idle) {
        this._idle = true;
        this._drawIdle();
      }
      this._rafId = requestAnimationFrame(this.drawLoop);
      return;
    }
    this._idle = false;

    this._drawFrame();
    this._rafId = requestAnimationFrame(this.drawLoop);
  }

  _drawIdle() {
    const { ctx, _w: w, _h: h } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = this._rgba(0.1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  _drawFrame() {
    const { ctx, _w: w, _h: h } = this;
    ctx.clearRect(0, 0, w, h);
    if (w < 2 || h < 2) return;

    this._drawGrid();

    const alpha     = Math.max(0.3, this._activity);
    const amplitude = (h * 0.4) * Math.min(1, this._activity * 1.6 + 0.25);

    // Outer glow
    ctx.globalAlpha = alpha * 0.18;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 8;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.beginPath();
    this._tracePath(w, h, amplitude);
    ctx.stroke();

    // Inner glow
    ctx.globalAlpha = alpha * 0.35;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    this._tracePath(w, h, amplitude);
    ctx.stroke();

    // Sharp phosphor trace
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    this._tracePath(w, h, amplitude);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  _drawGrid() {
    const { ctx, _w: w, _h: h } = this;
    ctx.strokeStyle = this._rgba(0.07);
    ctx.lineWidth   = 0.5;

    // Centre horizontal
    ctx.beginPath();
    ctx.moveTo(0,     h / 2);
    ctx.lineTo(w,     h / 2);
    ctx.stroke();

    // Vertical quarter marks
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((w * i) / 4, 0);
      ctx.lineTo((w * i) / 4, h);
      ctx.stroke();
    }
  }

  _tracePath(w, h, amplitude) {
    const ctx       = this.ctx;
    const steps     = Math.ceil(w);
    const cy        = h / 2;
    const numCycles = 2.5; // always show 2.5 cycles of the root note

    for (let px = 0; px <= steps; px++) {
      const normT = this._phase + (px / steps) * numCycles;
      const y     = cy - this._sample(normT) * amplitude;
      if (px === 0) ctx.moveTo(px, y);
      else          ctx.lineTo(px, y);
    }
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

  // Keep old helper name for any direct callers
  _alphaColor(color, a) {
    return this._rgba(a);
  }
}

// Keep the old export name for callers that import FreqVisualizer
export { OscilloscopeVisualizer as FreqVisualizer };

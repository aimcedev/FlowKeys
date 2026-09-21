import { rafThrottle } from '../utils/rafThrottle.js';

export class ActivityVisualizer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');

    // Single phosphor colour — resolved from CSS at construction time
    this._color = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-cyan').trim() || '#00e5ff';

    // Note tracking for visualization
    this.activeNotes = new Map();
    this._decayLevels = new Map(); // note → brightness 0–1 for smooth release

    this.resize();
    this._resizeHandler = rafThrottle(() => this.resize());
    window.addEventListener('resize', this._resizeHandler);

    this._idle = false;
    this._rafId = null;
    this.lastDrawTime = performance.now();
    this.drawLoop = this.drawLoop.bind(this);
    this._rafId = requestAnimationFrame(this.drawLoop);
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._resizeHandler.cancel();
    window.removeEventListener('resize', this._resizeHandler);
  }

  resize() {
    // Handle Canvas scaling for high dpi displays
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  updateState(state) {
    this.activeNotes = state.activeNotes;

    // Refresh decay levels for newly added notes
    if (state.activeNotes) {
      for (const [note] of state.activeNotes) {
        this._decayLevels.set(note, 1.0);
      }
    }

    // Restart the draw loop if it stopped during idle
    if (this._idle && this._decayLevels.size > 0) {
      this._idle = false;
      this.lastDrawTime = performance.now();
      this._rafId = requestAnimationFrame(this.drawLoop);
    }
  }

  drawLoop(time) {
    const dt = Math.min((time - this.lastDrawTime) / 1000, 0.05);
    this.lastDrawTime = time;

    const { ctx } = this;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // Decay released notes
    for (const [note, level] of this._decayLevels) {
      if (this.activeNotes.has(note)) {
        this._decayLevels.set(note, 1.0);
      } else {
        const next = level - dt * 3.0;
        if (next <= 0) this._decayLevels.delete(note);
        else           this._decayLevels.set(note, next);
      }
    }

    const hasActivity = this._decayLevels.size > 0;

    if (!hasActivity) {
      if (!this._idle) {
        this._idle = true;
        // Draw a single final clear frame with just the baseline
        ctx.strokeStyle = this._rgba(0.09);
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(0,     h / 2);
        ctx.lineTo(w,     h / 2);
        ctx.stroke();
      }
      this._rafId = null;
      return;
    }
    this._idle = false;

    // Centre baseline
    ctx.strokeStyle = this._rgba(0.06);
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Note bars — same style as NoteActivityViz
    const minNote = 21;
    const maxNote = 108;
    const range   = maxNote - minNote;

    for (const [note, level] of this._decayLevels) {
      const x    = ((note - minNote) / range) * w;
      const barH = (h - 10) * level;
      const y    = (h - barH) / 2;

      // Soft glow
      ctx.globalAlpha = level * 0.18;
      ctx.fillStyle   = this._color;
      ctx.fillRect(x - 6, y, 12, barH);

      // Crisp bar
      ctx.globalAlpha = level * 0.82;
      ctx.fillRect(x - 1.5, y, 3, barH);
    }

    ctx.globalAlpha = 1;
    this._rafId = requestAnimationFrame(this.drawLoop);
  }

  _rgba(alpha) {
    const c = this._color;
    if (c.startsWith('#')) {
      const r = parseInt(c.slice(1, 3), 16);
      const g = parseInt(c.slice(3, 5), 16);
      const b = parseInt(c.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return c;
  }
}

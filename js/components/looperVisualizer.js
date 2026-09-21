/**
 * LooperVisualizer — canvas-based mini display for looper module cards.
 *
 * Shows a piano-roll-style view of recorded notes during playback, a recording
 * fill bar while capturing, a pulsing scan in armed state, and a flat baseline
 * when idle.  The playhead sweeps across the canvas as the loop plays back.
 *
 * Sizing matches the step sequencer (60 px) so all module bottom rows align.
 */
import { rafThrottle } from '../utils/rafThrottle.js';

export class LooperVisualizer {
  constructor(canvas, color = '#ff6b35') {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.color  = color;

    this._state            = 'idle';
    this._fillFraction     = 0;
    this._headFraction     = 0;
    this._events           = [];
    this._loopLengthPulses = 1;

    this._phase  = 0; // wall-time accumulator for animations
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

  setState(state) {
    this._state = state;
  }

  setProgress(fill, head) {
    this._fillFraction = fill;
    this._headFraction = head;
  }

  setLoopData(events, loopLengthPulses) {
    this._events           = events || [];
    this._loopLengthPulses = loopLengthPulses || 1;
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
    this._phase += dt;

    const { ctx, _w: w, _h: h } = this;
    ctx.clearRect(0, 0, w, h);

    switch (this._state) {
      case 'idle':      this._drawIdle(w, h);      break;
      case 'armed':     this._drawArmed(w, h);     break;
      case 'recording': this._drawRecording(w, h); break;
      case 'playing':   this._drawPlaying(w, h);   break;
    }

    this._rafId = requestAnimationFrame(this._loop);
  }

  _drawIdle(w, h) {
    const { ctx } = this;
    ctx.strokeStyle = this._rgba(0.1);
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0,     h / 2);
    ctx.lineTo(w,     h / 2);
    ctx.stroke();
  }

  _drawArmed(w, h) {
    const { ctx } = this;

    // Centre line
    ctx.strokeStyle = this._rgba(0.15);
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Horizontal scan glow that sweeps left-to-right every 2 seconds
    const scanX = ((this._phase % 2) / 2) * w;
    const pulse = (Math.sin(this._phase * Math.PI * 2) + 1) / 2;

    const grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
    grad.addColorStop(0,   this._rgba(0));
    grad.addColorStop(0.5, this._rgba(pulse * 0.35));
    grad.addColorStop(1,   this._rgba(0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  _drawRecording(w, h) {
    const { ctx } = this;
    const fillW = Math.min(this._fillFraction, 1) * w;

    // Fill bar
    ctx.fillStyle = 'rgba(255, 56, 56, 0.18)';
    ctx.fillRect(0, 0, fillW, h);

    // Centre line
    ctx.strokeStyle = 'rgba(255, 56, 56, 0.2)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Pulsing record dot at the leading edge
    const pulse = (Math.sin(this._phase * Math.PI * 4) + 1) / 2;
    ctx.globalAlpha = 0.5 + pulse * 0.5;
    ctx.fillStyle   = '#ff3838';
    ctx.beginPath();
    ctx.arc(fillW, h / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  _drawPlaying(w, h) {
    const { ctx } = this;
    const events = this._events;
    const len    = this._loopLengthPulses;

    if (events.length && len > 0) {
      const noteOnEvents = events.filter(e => e.type === 'noteOn');

      if (noteOnEvents.length) {
        const notes = noteOnEvents.map(e => e.note);
        const lo    = Math.min(...notes);
        const hi    = Math.max(...notes);
        const range = Math.max(hi - lo, 12); // at least 1 octave visual span
        const padY  = h * 0.18;

        for (const ev of noteOnEvents) {
          const x      = (ev.pulse / len) * w;
          const yNorm  = (ev.note - lo) / range;
          const y      = h - padY - yNorm * (h - 2 * padY);
          const alpha  = (ev.velocity / 127) * 0.65 + 0.35;

          ctx.globalAlpha = alpha * 0.88;
          ctx.fillStyle   = this.color;
          // Thin vertical blip: 1.5 px wide, 5 px tall
          ctx.fillRect(x - 0.75, y - 2.5, 1.5, 5);
        }
        ctx.globalAlpha = 1;
      }
    }

    // Subtle played-region tint behind the playhead
    const headX = this._headFraction * w;
    ctx.fillStyle = this._rgba(0.07);
    ctx.fillRect(0, 0, headX, h);

    // Playhead — glowing vertical bar
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = this.color;
    ctx.shadowBlur  = 7;
    ctx.beginPath();
    ctx.moveTo(headX, 0);
    ctx.lineTo(headX, h);
    ctx.stroke();
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
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

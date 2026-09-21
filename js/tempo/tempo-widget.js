/**
 * TempoWidget — compact tempo-reference panel for Flow Keys.
 *
 * Plugs directly into the existing MidiManager — no separate MIDI input
 * selector needed.  Call processMidiMessage(event) from the app's
 * onMidiMessage handler to feed raw events into the 4-layer pipeline:
 *
 *   Raw MIDI → chord grouping → EventClassifier → PulseEngine → TempoTracker
 *
 * Renders a compact BPM readout + distribution graph inside the header bar.
 */
import { EventClassifier } from './event-classifier.js';
import { PulseEngine }     from './pulse-engine.js';
import { TempoTracker }    from './tempo-tracker.js';
import { SUSTAIN_CC }      from '../utils/midiConstants.js';
import { rafThrottle }     from '../utils/rafThrottle.js';

export class TempoWidget {
  constructor() {
    this.classifier  = new EventClassifier();
    this.pulseEngine = new PulseEngine();
    this.tracker     = new TempoTracker();

    // Chord-grouping buffer (mirrors MidiInput behaviour from Tempo Tool)
    this.pendingNotes    = [];
    this.chordTimer      = null;
    this.CHORD_WINDOW_MS = 50;

    this.lastDistribution = null;
    this.lastState        = null;
    this.activeHint       = null;
    this._lockedAtBpm     = null;

    // Auto-reset: clear analysis 1 s after all keys AND sustain are released
    this._silenceTimer    = null;
    this.SILENCE_RESET_MS = 1000;
    this._activeNotes     = new Set(); // MIDI note numbers currently held
    this._sustainDown     = false;     // sustain pedal state

    this.distCanvas = null;
    this.distCtx    = null;
    this.miniCanvas = null;
    this.miniCtx    = null;
    this._rafId     = null;
    this._resizeHandler = rafThrottle(() => this._setupCanvas());

    this._bindUI();
    this._startRenderLoop();
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._resizeHandler.cancel();
    window.removeEventListener('resize', this._resizeHandler);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Called by TempoController on lock/unlock.
   * bpm = the detected BPM at the moment of locking, null to clear.
   */
  setLockedBpm(bpm) {
    this._lockedAtBpm = bpm != null ? Math.round(bpm) : null;
  }

  /**
   * Returns the most recently detected BPM, or null if none yet.
   * Use this to snapshot the detected tempo at the moment the user clicks Lock.
   */
  getCurrentBpm() {
    return this.lastState?.bpm || null;
  }

  /**
   * Set the tempo hint, updating both the pulse engine and the button visuals.
   * Pass null to clear the active hint.
   */
  setHint(hint) {
    this.activeHint = hint || null;
    document.querySelectorAll('.tempo-hint-btn').forEach(b => b.classList.remove('active'));
    if (hint) {
      const btn = document.querySelector(`.tempo-hint-btn[data-hint="${hint}"]`);
      if (btn) btn.classList.add('active');
      this.pulseEngine.setHint(hint);
    } else {
      this.pulseEngine.setHint(null);
    }
    // Reflect hint change on the header trigger button immediately
    const locked = document.getElementById('tempo-lock-btn')?.classList.contains('active');
    window.appUiManager?.updateTempoTrigger(this.lastState?.bpm ?? null, locked, this.activeHint);
  }

  /**
   * Clears all analysis state so the widget starts fresh.
   * Called by the Reset button and automatically after 1 s of silence.
   */
  reset() {
    clearTimeout(this._silenceTimer);
    this._silenceTimer = null;

    this.classifier.reset();
    this.tracker.reset();
    // PulseEngine is stateless per-call; preserve the active hint

    this.lastDistribution = null;
    this.lastState        = null;

    // Clear display back to waiting state
    this._updateBpmDisplay(null);
  }

  /**
   * Call this from app.js inside the midi.onMidiMessage handler,
   * passing every raw MIDI event so the widget analyses in parallel
   * with the performance engine.
   */
  processMidiMessage(event) {
    const [status, data1, data2] = event.data;
    const type = status & 0xf0;
    const time = event.timeStamp;

    if (type === 0x90 && data2 > 0) {
      // Note-on: track note, cancel any pending silence reset
      this._activeNotes.add(data1);
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
      this._bufferNoteOn(time, data1, data2);
    } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
      // Note-off: untrack note, start silence countdown if nothing is held
      this._activeNotes.delete(data1);
      this._checkSilence();
    } else if (type === 0xb0 && data1 === SUSTAIN_CC) {
      // Sustain pedal
      const pedalDown = data2 >= 64;
      this._sustainDown = pedalDown;
      if (pedalDown) {
        // Pedal pressed — sound is still being held, cancel silence timer
        clearTimeout(this._silenceTimer);
        this._silenceTimer = null;
      } else {
        // Pedal released — check if everything is now silent
        this._checkSilence();
      }
      this._onRawEvent({ type: 'pedal', time, value: pedalDown ? 1 : 0 });
    }
  }

  // Start the 1-second silence timer only when all keys AND the sustain pedal are released.
  _checkSilence() {
    if (this._activeNotes.size === 0 && !this._sustainDown) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = setTimeout(() => this.reset(), this.SILENCE_RESET_MS);
    }
  }

  // ── Chord grouping ─────────────────────────────────────────────────────────

  _bufferNoteOn(time, pitch, velocity) {
    this.pendingNotes.push({ time, pitch, velocity });
    clearTimeout(this.chordTimer);
    this.chordTimer = setTimeout(() => this._flushChord(), this.CHORD_WINDOW_MS);
  }

  _flushChord() {
    if (this.pendingNotes.length === 0) return;
    const notes      = this.pendingNotes.splice(0);
    const onsetTime  = notes.reduce((min, n) => Math.min(min, n.time), Infinity);
    const pitches    = notes.map(n => n.pitch);
    const velocities = notes.map(n => n.velocity);

    this._onRawEvent({
      type:         'onset',
      time:         onsetTime,
      notes,
      count:        notes.length,
      lowestPitch:  Math.min(...pitches),
      highestPitch: Math.max(...pitches),
      maxVelocity:  Math.max(...velocities),
      meanVelocity: velocities.reduce((s, v) => s + v, 0) / velocities.length,
    });
  }

  // ── Analysis pipeline ──────────────────────────────────────────────────────

  _onRawEvent(rawEvent) {
    const classified = this.classifier.process(rawEvent);
    if (!classified) return; // pedal event only

    const events       = this.classifier.getEvents();
    const distribution = this.pulseEngine.analyze(events);
    const state        = this.tracker.update(distribution, this.pulseEngine, rawEvent.time);

    this.lastDistribution = distribution;
    this.lastState        = state;

    this._updateBpmDisplay(state);
  }

  // ── BPM display ────────────────────────────────────────────────────────────

  _updateBpmDisplay(state) {
    const bpmEl  = document.getElementById('tempo-bpm-value');
    const confEl = document.getElementById('tempo-conf-bar');
    if (!bpmEl || !confEl) return;

    if (state?.display != null) {
      bpmEl.textContent = state.display;
      bpmEl.classList.remove('waiting');
    } else if (!state?.bpm) {
      bpmEl.textContent = '---';
      bpmEl.classList.add('waiting');
    }

    // On reset (state is null), collapse the confidence bar immediately
    if (!state) {
      confEl.style.width = '0%';
      const isLocked = document.getElementById('tempo-lock-btn')?.classList.contains('active') ?? false;
      window.appUiManager?.updateTempoTrigger(null, isLocked, this.activeHint);
      return;
    }

    if (state?.confidence != null) {
      const pct = Math.min(state.confidence, 1) * 100;
      confEl.style.width = pct + '%';
      const c = state.confidence;
      confEl.style.background = c > 0.65 ? 'var(--state-on)'
                              : c > 0.35 ? 'var(--accent-cyan)'
                              :            'var(--text-dim)';
    }

    // Update the header trigger button with the live BPM and hint
    if (state?.bpm) {
      const locked = document.getElementById('tempo-lock-btn')?.classList.contains('active');
      window.appUiManager?.updateTempoTrigger(state.bpm, locked, this.activeHint);
    }
  }

  // ── UI bindings ────────────────────────────────────────────────────────────

  _bindUI() {
    // Hint buttons — delegate to setHint() so MIDI and click use same path
    document.querySelectorAll('.tempo-hint-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const hint     = btn.dataset.hint;
        const isActive = btn.classList.contains('active');
        this.setHint(isActive ? null : hint); // toggle off if already active
      });
    });

    // Reset button
    document.getElementById('tempo-reset-btn')?.addEventListener('click', () => {
      this.reset();
    });

    // Default to Slow hint on load; defer trigger button sync until appUiManager is ready
    this.setHint('slow');
    setTimeout(() => {
      window.appUiManager?.updateTempoTrigger(null, false, this.activeHint);
    }, 0);
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  _startRenderLoop() {
    // Canvas may not be in the DOM yet — wait one frame
    requestAnimationFrame(() => {
      this.distCanvas = document.getElementById('tempo-dist-canvas');
      this.miniCanvas = document.getElementById('tempo-mini-canvas');
      if (this.distCanvas) this.distCtx = this.distCanvas.getContext('2d');
      if (this.miniCanvas) this.miniCtx = this.miniCanvas.getContext('2d');

      this._setupCanvas();
      window.addEventListener('resize', this._resizeHandler);

      const loop = (now) => {
        this.tracker.tick(now);
        this._renderDistribution();
        this._renderMiniDistribution();
        this._rafId = requestAnimationFrame(loop);
      };
      this._rafId = requestAnimationFrame(loop);
    });
  }

  _setupCanvas() {
    const canvas = this.distCanvas;
    if (canvas) {
      const dpr  = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0) {
        canvas.width  = rect.width  * dpr;
        canvas.height = rect.height * dpr;
        canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    const mini = this.miniCanvas;
    if (mini) {
      const dpr  = window.devicePixelRatio || 1;
      const rect = mini.getBoundingClientRect();
      if (rect.width > 0) {
        mini.width  = rect.width  * dpr;
        mini.height = rect.height * dpr;
        mini.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
  }

  // ── Distribution canvas ────────────────────────────────────────────────────

  _renderDistribution() {
    const canvas = this.distCanvas;
    if (!canvas) return;
    const ctx = this.distCtx;
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.width  / dpr;
    const H   = canvas.height / dpr;
    if (W === 0 || H === 0) return;

    ctx.clearRect(0, 0, W, H);

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const cyanBase = isLight ? '0, 144, 168' : '0, 229, 255';
    const yellowBase = isLight ? '184, 134, 0' : '255, 184, 0';

    const HINT_RANGES = {
      slow:   { min: 42,  max: 102, ticks: [50, 60, 70, 80, 90, 100] },
      medium: { min: 74,  max: 134, ticks: [80, 90, 100, 110, 120, 130] },
      fast:   { min: 106, max: 165, ticks: [110, 120, 130, 140, 150] },
    };
    const activeHint  = this.pulseEngine.hint;
    const hintRange   = activeHint && HINT_RANGES[activeHint];
    const MIN_BPM     = hintRange ? hintRange.min  : 50;
    const MAX_BPM     = hintRange ? hintRange.max  : 155;
    const axisTicks   = hintRange ? hintRange.ticks : [60, 80, 100, 120, 140];
    const bpmToX      = bpm => ((bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * W;
    const TICK_H  = 13;
    const plotH   = H - TICK_H;

    if (!this.lastDistribution) {
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.16)';
      ctx.font      = '9px system-ui, sans-serif';
      const msg = 'Play to detect tempo…';
      const tw  = ctx.measureText(msg).width;
      ctx.fillText(msg, Math.max(0, W / 2 - tw / 2), H / 2 + 4);
      return;
    }

    // Filter distribution to visible BPM window (important when zoomed)
    const dist = this.lastDistribution.filter(d => d.bpm >= MIN_BPM && d.bpm <= MAX_BPM);
    if (dist.length === 0) return;

    // Filled area — Flow Keys cyan
    const grad = ctx.createLinearGradient(0, 0, 0, plotH);
    grad.addColorStop(0,   `rgba(${cyanBase}, 0.75)`);
    grad.addColorStop(0.6, `rgba(${cyanBase}, 0.25)`);
    grad.addColorStop(1,   `rgba(${cyanBase}, 0.03)`);

    ctx.beginPath();
    ctx.moveTo(bpmToX(dist[0].bpm), plotH);
    for (const d of dist) {
      ctx.lineTo(bpmToX(d.bpm), plotH - d.normalizedScore * (plotH - 4) - 1);
    }
    ctx.lineTo(bpmToX(dist[dist.length - 1].bpm), plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Outline
    ctx.beginPath();
    let first = true;
    for (const d of dist) {
      const x = bpmToX(d.bpm);
      const y = plotH - d.normalizedScore * (plotH - 4) - 1;
      if (first) { ctx.moveTo(x, y); first = false; }
      else        ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(${cyanBase}, 0.45)`;
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Current BPM marker — amber/yellow matching Flow Keys accent-yellow
    const ts = this.lastState;
    if (ts?.bpm) {
      const x = bpmToX(ts.bpm);
      ctx.strokeStyle = `rgba(${yellowBase}, 0.9)`;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH);
      ctx.stroke();

      const label = Math.round(ts.bpm) + '';
      ctx.font      = 'bold 9px system-ui, sans-serif';
      const lw      = ctx.measureText(label).width;
      const lx      = Math.min(Math.max(x - lw / 2, 1), W - lw - 1);
      ctx.fillStyle = `rgba(${yellowBase}, 0.95)`;
      ctx.fillText(label, lx, 9);
    }

    // BPM axis ticks — sparse, compact
    ctx.fillStyle   = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.18)';
    ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.font        = '8px system-ui, sans-serif';
    for (const bpm of axisTicks) {
      const x = bpmToX(bpm);
      if (x < 0 || x > W) continue;
      ctx.beginPath();
      ctx.moveTo(x, plotH);
      ctx.lineTo(x, plotH + 3);
      ctx.stroke();
      const lbl = String(bpm);
      ctx.fillText(lbl, x - ctx.measureText(lbl).width / 2, H - 1);
    }
  }

  // ── Mini sparkline (header strip) ─────────────────────────────────────────

  _renderMiniDistribution() {
    const canvas = this.miniCanvas;
    if (!canvas) return;
    const ctx = this.miniCtx;
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.width  / dpr;
    const H   = canvas.height / dpr;
    if (W === 0 || H === 0) return;

    ctx.clearRect(0, 0, W, H);

    if (!this.lastDistribution) {
      canvas.classList.remove('has-data');
      return;
    }

    canvas.classList.add('has-data');

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const cyanBase = isLight ? '0, 144, 168' : '0, 229, 255';
    const yellowBase = isLight ? '184, 134, 0' : '255, 184, 0';

    const HINT_RANGES = {
      slow:   { min: 42,  max: 102 },
      medium: { min: 74,  max: 134 },
      fast:   { min: 106, max: 165 },
    };
    const activeHint = this.pulseEngine.hint;
    const hintRange  = activeHint && HINT_RANGES[activeHint];
    const MIN_BPM    = hintRange ? hintRange.min : 50;
    const MAX_BPM    = hintRange ? hintRange.max : 155;
    const bpmToX     = bpm => ((bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * W;

    const dist = this.lastDistribution.filter(d => d.bpm >= MIN_BPM && d.bpm <= MAX_BPM);
    if (dist.length === 0) return;

    const isLocked = this._lockedAtBpm != null;

    // Filled distribution curve
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    if (isLocked) {
      grad.addColorStop(0, `rgba(${yellowBase}, 0.55)`);
      grad.addColorStop(1, `rgba(${yellowBase}, 0.06)`);
    } else {
      grad.addColorStop(0, `rgba(${cyanBase}, 0.60)`);
      grad.addColorStop(1, `rgba(${cyanBase}, 0.05)`);
    }

    ctx.beginPath();
    ctx.moveTo(bpmToX(dist[0].bpm), H);
    for (const d of dist) {
      ctx.lineTo(bpmToX(d.bpm), H - d.normalizedScore * (H - 1) - 0.5);
    }
    ctx.lineTo(bpmToX(dist[dist.length - 1].bpm), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    const ts = this.lastState;

    if (isLocked) {
      // Gold anchor line at the locked BPM
      const ax = bpmToX(this._lockedAtBpm);
      if (ax >= 0 && ax <= W) {
        ctx.strokeStyle = `rgba(${yellowBase}, 0.9)`;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax, 0);
        ctx.lineTo(ax, H);
        ctx.stroke();
      }

      // Cyan live cursor with BPM label
      if (ts?.bpm) {
        const x = bpmToX(ts.bpm);
        if (x >= 0 && x <= W) {
          ctx.strokeStyle = `rgba(${cyanBase}, 0.9)`;
          ctx.lineWidth   = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();

          const label = Math.round(ts.bpm) + '';
          ctx.font      = 'bold 11px system-ui, sans-serif';
          const lw      = ctx.measureText(label).width;
          const lx      = Math.min(Math.max(x - lw / 2, 1), W - lw - 1);
          const ly      = Math.round(H / 2) + 4;
          ctx.fillStyle = isLight ? 'rgba(255, 253, 248, 0.85)' : 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(lx - 2, ly - 12, lw + 4, 14);
          ctx.fillStyle = `rgba(${cyanBase}, 1)`;
          ctx.fillText(label, lx, ly);
        }
      }
    } else if (ts?.bpm) {
      // Unlocked: single cyan cursor, no label
      const x = bpmToX(ts.bpm);
      if (x >= 0 && x <= W) {
        ctx.strokeStyle = `rgba(${cyanBase}, 0.9)`;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }
  }
}

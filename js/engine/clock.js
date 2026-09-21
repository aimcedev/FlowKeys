import { normalizeBpm } from '../utils/bpm.js';

export class Clock {
  constructor() {
    this.bpm = 120;
    this.mode = 'sync'; // 'sync' | 'trigger' | 'flow'
    this.ppq = 24; // Pulses Per Quarter Note
    this.isRunning = false;
    this.step = 0;

    // Time signature
    this.timeSignature = '4/4';
    this.beatsPerBar = 4;
    this.pulsesPerBeat = this.ppq;      // quarter note = 24 pulses
    this.pulsesPerBar = this.ppq * 4;   // 96 pulses per bar
    // In 6/8, taps land on eighth notes (2× quarter-note BPM), so halve the result.
    this.tapTempoFactor = 1.0;

    // Tap Tempo state
    this.tapTimes = [];
    this.tapTimeout = null;
    this._tapInterval = null; // running beat-length estimate (ms)

    // Listeners
    this.onTickCallbacks = [];
    this.onBpmChangeCallbacks = [];
    this.onBarCallbacks = [];
    this.onBeatCallbacks = []; // fires every quarter-note (every PPQ pulses)
    this.onStartCallbacks = []; // fires when the clock starts
    this.onStopCallbacks = []; // fires when the clock stops

    // ── Web Worker ───────────────────────────────────────────────────────────
    // The Worker runs the timing loop in a dedicated thread so it is NOT
    // throttled by the browser's tab-visibility policy.
    this._worker = new Worker(new URL('./clockWorker.js', import.meta.url));
    this._worker.onmessage = (e) => {
      if (e.data.type === 'tick') this._onWake();
      else if (e.data.type === 'error') this._onWorkerError(e.data.message);
    };

    // ── Main-thread timing baseline ──────────────────────────────────────────
    // The Worker is only a "waker": each 'tick' message is a hint that work
    // *may* be due, not a command to advance exactly one pulse. The main thread
    // is the authority — it decides how many pulses are due based on the real
    // wall-clock time elapsed (this._expected). This makes the clock immune to
    // a backlog of queued Worker messages: if the main thread stalls (window
    // resize, GC, a heavy module) and a burst of 'tick' messages piles up, the
    // first one we process catches up (bounded), and the rest become no-ops
    // instead of replaying a flurry of notes.
    this._expected = 0;            // performance.now() time the next pulse is due
    this._maxCatchUp = 4;          // pulses to replay in one wake before resyncing

    // ── Lookahead scheduling ─────────────────────────────────────────────────
    // We process each pulse slightly *before* it is due and hand its exact
    // due-time down to the MIDI layer (output.send(data, when)). The OS/Web MIDI
    // subsystem then dispatches the bytes at that precise timestamp, so notes
    // land dead on the grid even if the main thread is briefly busy between now
    // and the pulse's due-time. This window is the jitter cushion: any stall
    // shorter than it is inaudible. Keep it small so transport stop / BPM change
    // stay responsive (only this many ms of notes are ever committed ahead).
    this._lookahead = 25;          // ms scheduled ahead of real time
    this._worker.onerror = (e) => {
      this._onWorkerError(e.message ?? 'Unknown worker error');
    };
    this.onWorkerErrorCallbacks = [];

    // ── Visibility guard ─────────────────────────────────────────────────────
    // When the user switches back to this tab, tell the Worker to re-anchor
    // its expected-time baseline.  Without this the Worker (on browsers that
    // do throttle Workers) would try to fire all missed ticks in rapid
    // succession the moment the tab regains focus.
    this.onBackgroundCallbacks = [];
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isRunning) {
        // Re-anchor both the Worker's send cadence and our own pulse baseline so
        // neither side tries to replay ticks that were delayed while hidden.
        this._expected = performance.now();
        this._worker.postMessage({ type: 'resetBase' });
      } else if (document.visibilityState === 'hidden' && this.isRunning) {
        // Worker setTimeout is immune to throttling, but main-thread note-off
        // timers (staccato, swell, percussion) will fire late. Warn the performer.
        this.onBackgroundCallbacks.forEach(cb => cb());
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  _getMsPerPulse() {
    return (60000 / this.bpm) / this.ppq;
  }

  // ── BPM ─────────────────────────────────────────────────────────────────
  setBpm(bpm) {
    this.bpm = normalizeBpm(bpm, this.bpm);
    // Keep the Worker in sync so timing adjusts immediately mid-play
    if (this.isRunning) {
      this._worker.postMessage({ type: 'setMsPerPulse', data: { msPerPulse: this._getMsPerPulse() } });
    }
    this.onBpmChangeCallbacks.forEach(cb => cb(this.bpm));
  }

  // ── Time Signature ───────────────────────────────────────────────────────
  setTimeSignature(sig) {
    this.timeSignature = sig;
    if (sig === '3/4') {
      this.beatsPerBar = 3;
      this.pulsesPerBeat = this.ppq;       // quarter note
      this.tapTempoFactor = 1.0;
    } else if (sig === '6/8') {
      this.beatsPerBar = 6;
      this.pulsesPerBeat = this.ppq / 2;  // eighth note
      this.tapTempoFactor = 0.5;          // taps are eighth notes → halve to get quarter-note BPM
    } else {
      this.beatsPerBar = 4;
      this.pulsesPerBeat = this.ppq;       // quarter note (4/4 default)
      this.tapTempoFactor = 1.0;
    }
    this.pulsesPerBar = this.pulsesPerBeat * this.beatsPerBar;
  }

  // ── Clock mode ───────────────────────────────────────────────────────────
  setMode(mode) {
    this.mode = mode;
    if (mode === 'sync' && !this.isRunning) {
      this.start();
    }
  }

  // ── Callback registration ─────────────────────────────────────────────
  onTick(callback)        { this.onTickCallbacks.push(callback); }
  onBpmChange(callback)   { this.onBpmChangeCallbacks.push(callback); }
  onBar(callback)         { this.onBarCallbacks.push(callback); }
  onBeat(callback)        { this.onBeatCallbacks.push(callback); }
  onStart(callback)       { this.onStartCallbacks.push(callback); }
  onStop(callback)        { this.onStopCallbacks.push(callback); }
  onWorkerError(callback) { this.onWorkerErrorCallbacks.push(callback); }
  onBackground(callback)  { this.onBackgroundCallbacks.push(callback); }

  // ── Tap Tempo ────────────────────────────────────────────────────────────
  tapTempo() {
    const now = performance.now();

    if (this.tapTimeout) clearTimeout(this.tapTimeout);

    // Ignore accidental double-taps (< 200 ms since last tap)
    if (this.tapTimes.length > 0 && now - this.tapTimes[this.tapTimes.length - 1] < 200) {
      const resetDelay = this._tapInterval ? Math.max(2000, this._tapInterval * 2.5) : 2000;
      this.tapTimeout = setTimeout(() => { this.tapTimes = []; this._tapInterval = null; }, resetDelay);
      return;
    }

    // Start fresh if this tap is more than 2.5 beat-lengths after the last one
    if (this.tapTimes.length > 0) {
      const gap = now - this.tapTimes[this.tapTimes.length - 1];
      const threshold = this._tapInterval ? this._tapInterval * 2.5 : 3000;
      if (gap > threshold) {
        this.tapTimes = [];
        this._tapInterval = null;
      }
    }

    this.tapTimes.push(now);
    if (this.tapTimes.length > 8) this.tapTimes.shift();

    if (this.tapTimes.length >= 2) {
      // Exponential weighting: most recent interval gets highest weight (2^i)
      const intervals = [];
      for (let i = 1; i < this.tapTimes.length; i++) {
        intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
      }
      let weightedSum = 0;
      let totalWeight = 0;
      for (let i = 0; i < intervals.length; i++) {
        const w = Math.pow(2, i);
        weightedSum += intervals[i] * w;
        totalWeight += w;
      }
      const avgInterval = weightedSum / totalWeight;
      this._tapInterval = avgInterval;
      this.setBpm(Math.round(60000 / avgInterval * this.tapTempoFactor));
    }

    // Reset after 2.5 beat-lengths of silence (minimum 2 s)
    const resetDelay = this._tapInterval ? Math.max(2000, this._tapInterval * 2.5) : 2000;
    this.tapTimeout = setTimeout(() => { this.tapTimes = []; this._tapInterval = null; }, resetDelay);
  }

  // ── Transport ────────────────────────────────────────────────────────────
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.step = 0;
    this._expected = performance.now();
    this._worker.postMessage({ type: 'start', data: { msPerPulse: this._getMsPerPulse() } });
    this.onStartCallbacks.forEach(cb => cb());
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this._worker.postMessage({ type: 'stop' });
    this.onStopCallbacks.forEach(cb => cb());
  }

  /**
   * reset() — used by Trigger mode when the first note is pressed.
   * Resets the step counter to 0.  If the clock is already running it tells
   * the Worker to restart immediately (fires step-0 right now), otherwise
   * the subsequent start() call will handle initialisation.
   */
  reset() {
    this.step = 0;
    if (this.isRunning) {
      this._expected = performance.now();
      this._worker.postMessage({ type: 'restartImmediate', data: { msPerPulse: this._getMsPerPulse() } });
    }
  }

  /**
   * restartFromZero() — used by Flow mode when a section is applied.
   * Performs a hard stop → step=0 → immediate tick, regardless of previous state.
   */
  restartFromZero() {
    this.isRunning = true;
    this.step = 0;
    this._expected = performance.now();
    this._worker.postMessage({ type: 'restartImmediate', data: { msPerPulse: this._getMsPerPulse() } });
  }

  /**
   * handleNoteStateChange() — convenience wrapper kept for compatibility.
   */
  handleNoteStateChange(activeNotesCount) {
    if (this.mode === 'trigger') {
      if (activeNotesCount === 0) {
        this.stop();
      } else if (!this.isRunning) {
        this.start();
      }
    }
  }

  _onWorkerError(message) {
    this.isRunning = false;
    this.onWorkerErrorCallbacks.forEach(cb => cb(message));
  }

  // ── Wake handler ───────────────────────────────────────────────────────────
  /**
   * Called by the Worker for every pulse message. Rather than blindly advancing
   * one step per message, we advance based on how much real time has actually
   * elapsed (this._expected). This absorbs Worker jitter and, crucially, makes
   * the clock resilient to main-thread stalls: if a backlog of messages queues
   * up while the main thread was busy (e.g. a window resize), the first wake we
   * process catches up — bounded by _maxCatchUp — and the queued siblings find
   * no pulse due and return immediately, instead of firing a burst of notes.
   */
  _onWake() {
    if (!this.isRunning) return;

    const now = performance.now();
    const msPerPulse = this._getMsPerPulse();

    // Safety: if we were never anchored (shouldn't happen), anchor now.
    if (this._expected === 0) this._expected = now;

    // ── PERF DEBUG (temporary) ───────────────────────────────────────────────
    // How overdue is the pulse we're about to process? In steady state this is
    // slightly negative (we run a touch early). If a main-thread stall delayed
    // this wake, `lateness` exceeds the lookahead cushion and notes will sound
    // late — exactly the "hiccup" we're hunting. Logs only when it crosses the
    // cushion so the console stays quiet in normal play.
    if (window.FK_PERF_DEBUG) {
      const lateness = now - this._expected;
      if (lateness > this._lookahead) {
        const sinceSwitch = window.__fkLastSwitch ? (now - window.__fkLastSwitch).toFixed(0) : '—';
        console.warn(`[FK PERF] LATE PULSE: ${lateness.toFixed(1)}ms overdue (cushion ${this._lookahead}ms) — ${sinceSwitch}ms after last section switch`);
      }
    }

    let processed = 0;
    const tStep = (window.FK_PERF_DEBUG) ? performance.now() : 0;
    // Emit every pulse whose due-time falls within the lookahead window, tagging
    // each with its exact due-time (this._expected) so the MIDI layer dispatches
    // it precisely on time. In steady state this schedules ~1 pulse per wake, a
    // touch ahead of real time.
    while (this._expected <= now + this._lookahead) {
      this._step(this._expected);
      this._expected += msPerPulse;

      if (++processed >= this._maxCatchUp && this._expected < now) {
        // A real stall left a backlog of overdue pulses. Replaying them all
        // would bunch notes together; instead drop the missed pulses and resync
        // to real time so we stay musically in time.
        this._expected = now + msPerPulse;
        break;
      }
    }

    // ── PERF DEBUG (temporary) ───────────────────────────────────────────────
    // How long did the tick callbacks themselves take on the main thread? If a
    // single _onWake spends >5ms running module note logic, that work is the
    // stall source (vs. the wake merely arriving late from an outside stall).
    if (window.FK_PERF_DEBUG) {
      const dur = performance.now() - tStep;
      if (dur > 5) console.warn(`[FK PERF] SLOW TICK WORK: ${dur.toFixed(1)}ms in onTick callbacks (${processed} pulse(s))`);
    }
  }

  // ── Internal step ──────────────────────────────────────────────────────────
  /**
   * Advances the clock by exactly one pulse. `when` is the pulse's precise
   * due-time (performance.now() timeline); it is forwarded to listeners so they
   * can schedule MIDI output with sample-accurate timestamps. Step counting and
   * bar/beat detection happen here on the main thread.
   */
  _step(when) {
    // ── Beat callback (fires every pulsesPerBeat pulses) ────────────────
    // beatInBar: 0 = downbeat, then 1…(beatsPerBar-1)
    if (this.step % this.pulsesPerBeat === 0) {
      const beatInBar = Math.floor((this.step % this.pulsesPerBar) / this.pulsesPerBeat);
      this.onBeatCallbacks.forEach(cb => cb(beatInBar, when));
    }

    // ── Bar callback (start of every measure) ────────────────────────────
    // Fires BEFORE tick callbacks so section changes and module activations
    // happen before any notes are played in this bar.
    if (this.step % this.pulsesPerBar === 0) {
      this.onBarCallbacks.forEach(cb => cb(this.step, when));
    }

    // ── Tick callbacks (modules play their notes) ─────────────────────────
    this.onTickCallbacks.forEach(cb => cb(this.step, this.ppq, when));

    this.step++;
  }
}

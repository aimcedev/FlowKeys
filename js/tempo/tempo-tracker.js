/**
 * Layer 4 — Smooth tempo tracker.
 *
 * Reads the local distribution from the pulse engine and decodes a
 * temporally smooth BPM trajectory.
 */
export class TempoTracker {
  constructor() {
    this.bpm        = null;
    this.confidence = 0;
    this.history    = [];

    this.lastBeatMs = null;
    this._beatCallback = null;

    this.lockScore = 0;
    this.driftBuffer = [];

    // Tuning
    this.ADAPT_RATE_LOCKED    = 0.12;
    this.ADAPT_RATE_OPEN      = 0.28;
    this.CONF_BLEND_RATE      = 0.18;
    this.CONF_DECAY           = 0.97;
    this.MIN_CONF_DISPLAY     = 0.18;
    this.MIN_CONF_BEAT_FLASH  = 0.30;
    this.COLD_START_CONF      = 0.28;
    this.LOCK_BUILD_THRESH    = 0.04;
    this.LOCK_BREAK_THRESH    = 0.09;

    this.DRIFT_AWAY_THRESH    = 0.06;
    this.DRIFT_CLUSTER_PCT    = 0.10;
    this.DRIFT_CONFIRM_COUNT  = 5;
  }

  onBeat(callback) { this._beatCallback = callback; }

  update(distribution, pulseEngine, now) {
    const rawConf = pulseEngine.getConfidence(distribution);
    const best    = pulseEngine.findBestBPM(distribution, this.bpm, this.lockScore);

    if (!best || rawConf < 0.05) {
      this.confidence *= this.CONF_DECAY;
      this.lockScore   = Math.max(this.lockScore - 0.05, 0);
      return this._state();
    }

    if (this.bpm === null) {
      if (rawConf >= this.COLD_START_CONF) {
        this.bpm        = best.bpm;
        this.confidence = rawConf * 0.35;
        this.lockScore  = 0;
        this.lastBeatMs = now;
      }
    } else {
      const pctDiff = Math.abs(best.bpm - this.bpm) / this.bpm;

      if (pctDiff < this.DRIFT_AWAY_THRESH) {
        this.driftBuffer = [];
      } else {
        this.driftBuffer.push(best.bpm);
        if (this.driftBuffer.length > this.DRIFT_CONFIRM_COUNT + 2) {
          this.driftBuffer.shift();
        }

        if (this.driftBuffer.length >= this.DRIFT_CONFIRM_COUNT) {
          const mean   = this.driftBuffer.reduce((a, b) => a + b, 0) / this.driftBuffer.length;
          const spread = Math.max(...this.driftBuffer.map(b => Math.abs(b - mean)));

          if (spread / mean < this.DRIFT_CLUSTER_PCT) {
            this.bpm        = mean;
            this.lockScore  = 0;
            this.driftBuffer = [];
            this.confidence = this.confidence * 0.5;
            this._advanceBeatPhase(now);
            if (this.bpm) this.history.push({ time: now, bpm: this.bpm, confidence: this.confidence });
            return this._state();
          }
        }
      }

      if (pctDiff < this.LOCK_BUILD_THRESH) {
        this.lockScore = Math.min(this.lockScore + 0.06, 1);
      } else if (pctDiff > this.LOCK_BREAK_THRESH) {
        this.lockScore = Math.max(this.lockScore - 0.12, 0);
      }

      const rate = this.ADAPT_RATE_OPEN
        - (this.ADAPT_RATE_OPEN - this.ADAPT_RATE_LOCKED) * this.lockScore;

      this.bpm        = this.bpm * (1 - rate) + best.bpm * rate;
      this.confidence = this.confidence * (1 - this.CONF_BLEND_RATE)
                      + rawConf          * this.CONF_BLEND_RATE;
    }

    this._advanceBeatPhase(now);

    if (this.bpm) {
      this.history.push({ time: now, bpm: this.bpm, confidence: this.confidence });
      if (this.history.length > 300) this.history.shift();
    }

    return this._state();
  }

  tick(now) {
    this._advanceBeatPhase(now);
  }

  _advanceBeatPhase(now) {
    if (!this.bpm || this.confidence < this.MIN_CONF_BEAT_FLASH) return;
    if (this.lastBeatMs === null) {
      this.lastBeatMs = now;
      return;
    }

    const period  = 60_000 / this.bpm;
    const elapsed = now - this.lastBeatMs;

    if (elapsed >= period * 0.92) {
      const beats = Math.max(1, Math.round(elapsed / period));
      this.lastBeatMs += beats * period;

      if (this._beatCallback) {
        this._beatCallback(this.lastBeatMs, this.bpm);
      }
    }
  }

  _state() {
    return {
      bpm:        this.bpm,
      confidence: this.confidence,
      display:    (this.bpm && this.confidence >= this.MIN_CONF_DISPLAY)
                    ? Math.round(this.bpm)
                    : null,
      lastBeatMs: this.lastBeatMs,
    };
  }

  reset() {
    this.bpm         = null;
    this.confidence  = 0;
    this.lockScore   = 0;
    this.driftBuffer = [];
    this.history     = [];
    this.lastBeatMs  = null;
  }
}

/**
 * Layers 2 + 3 — Pulse engine.
 *
 * Layer 2: Builds a continuous "salience signal" by placing small Gaussian
 *          bumps at each classified event, weighted by that event's salience.
 *
 * Layer 3: Computes the normalized autocorrelation of that signal over a
 *          short moving window.  Peaks in the autocorrelation at lag L
 *          mean the performance has recurring structure every L ms — i.e.,
 *          L is a candidate beat period.
 *
 * The result is a probability-like *distribution* over candidate BPMs rather
 * than a single hard answer, which lets the tracking layer (Layer 4) pick a
 * musically coherent path over time.
 */
export class PulseEngine {
  constructor() {
    this.BIN_MS   = 10;       // 10 ms bins → 100 Hz resolution
    this.WINDOW_MS = 8_000;   // analyse the last 8 seconds
    this.MIN_BPM  = 50;
    this.MAX_BPM  = 155;
    this.SIGMA_BINS = 2;      // Gaussian spread ≈ 20 ms per event

    // Optional hint — biases candidate selection without hard-locking.
    // null | 'slow' | 'medium' | 'fast'
    this.hint = null;
  }

  static HINTS = {
    slow:   { center: 70,  spread: 22 }, // covers ~48–92  comfortably
    medium: { center: 102, spread: 18 }, // covers ~84–120 comfortably
    fast:   { center: 137, spread: 24 }, // covers ~113–161 comfortably
  };

  setHint(hint) { this.hint = hint; }

  /**
   * Run the full Layer-2 + Layer-3 analysis.
   * Returns an array of { bpm, period, score, normalizedScore }
   * or null if there are fewer than 3 events.
   */
  analyze(events) {
    if (events.length < 3) return null;

    const now = events[events.length - 1].time;
    const cutoff = now - this.WINDOW_MS;
    const recent = events.filter(e => e.time >= cutoff);
    if (recent.length < 3) return null;

    // ── Layer 2: build salience signal ───────────────────────────────────
    const N = Math.ceil(this.WINDOW_MS / this.BIN_MS); // 800 bins
    const signal = new Float32Array(N);
    const sigma = this.SIGMA_BINS;
    const radius = sigma * 3;

    for (const ev of recent) {
      const age = now - ev.time;
      const center = N - 1 - Math.floor(age / this.BIN_MS);
      if (center < 0) continue;

      const lo = Math.max(0, center - radius);
      const hi = Math.min(N - 1, center + radius);
      for (let b = lo; b <= hi; b++) {
        const d = b - center;
        signal[b] += ev.salience * Math.exp(-(d * d) / (2 * sigma * sigma));
      }
    }

    // ── Layer 3: normalized autocorrelation ───────────────────────────────
    const minLag = Math.floor(60_000 / this.MAX_BPM / this.BIN_MS); // ≥ 25
    const maxLag = Math.ceil(60_000 / this.MIN_BPM  / this.BIN_MS); // ≤ 150

    const distribution = [];

    for (let lag = minLag; lag <= maxLag; lag++) {
      const overlap = N - lag;
      if (overlap <= 0) continue;

      let sum = 0;
      for (let t = 0; t < overlap; t++) {
        sum += signal[t] * signal[t + lag];
      }
      const score = sum / overlap;
      const bpm = 60_000 / (lag * this.BIN_MS);
      distribution.push({ lag, bpm, period: lag * this.BIN_MS, score });
    }

    // Normalize scores to [0, 1]
    const maxScore = distribution.reduce((m, d) => Math.max(m, d.score), 0);
    if (maxScore > 0) {
      distribution.forEach(d => { d.normalizedScore = d.score / maxScore; });
    } else {
      distribution.forEach(d => { d.normalizedScore = 0; });
    }

    return distribution;
  }

  /**
   * Given a distribution and the current running BPM estimate, pick the
   * best BPM candidate.
   */
  findBestBPM(distribution, currentBPM, lockScore = 0) {
    if (!distribution || distribution.length === 0) return null;

    const rawScores = distribution.map(d => d.normalizedScore);
    const smoothed  = this._gaussianSmooth(rawScores, 2);

    const NEAR_RATIOS = [1, 0.5, 2, 2 / 3, 3 / 2, 1 / 3, 3];

    const candidates = distribution.map((d, i) => {
      const bpm = d.bpm;
      let w = smoothed[i];

      // Musical comfort zone (baseline preference)
      if      (bpm >= 60  && bpm <= 160) w *= 1.25;
      else if (bpm >= 40  && bpm <= 200) w *= 1.00;
      else                               w *= 0.75;

      // Speed hint: soft Gaussian boost around the target zone.
      if (this.hint) {
        const { center, spread } = PulseEngine.HINTS[this.hint];
        const dist = bpm - center;
        const hintBoost = Math.exp(-(dist * dist) / (2 * spread * spread));
        w *= 1 + 1.8 * hintBoost;
      }

      // Stability bonus — scaled by lockScore
      if (currentBPM) {
        const ratio = bpm / currentBPM;
        const minDist = NEAR_RATIOS.reduce(
          (mn, r) => Math.min(mn, Math.abs(ratio - r)), Infinity
        );
        const ratioBias = 0.4 + 0.3 * lockScore;
        w *= 1 + ratioBias * Math.exp(-6 * minDist * minDist);

        if (lockScore > 0.3 && Math.abs(ratio - 1) < 0.04) {
          w *= 1 + 1.2 * lockScore;
        }
      }

      return { ...d, weight: w };
    });

    // Peak centroid
    const argmax = candidates.reduce((best, c) => c.weight > best.weight ? c : best);
    const CENTROID_WINDOW = 7;
    const near = candidates.filter(c => Math.abs(c.bpm - argmax.bpm) <= CENTROID_WINDOW);
    const totalW = near.reduce((s, c) => s + c.weight, 0);
    const centroidBPM = totalW > 0
      ? near.reduce((s, c) => s + c.bpm * c.weight, 0) / totalW
      : argmax.bpm;

    return { ...argmax, bpm: centroidBPM };
  }

  /**
   * Returns a confidence value in [0, 1] based on how "peaked" the
   * distribution is.
   */
  getConfidence(distribution) {
    if (!distribution) return 0;
    const scores = distribution.map(d => d.normalizedScore);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const std  = Math.sqrt(
      scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
    );
    return Math.min(std * 3.5, 1);
  }

  _gaussianSmooth(arr, sigma) {
    const radius = Math.ceil(sigma * 2);
    return arr.map((_, i) => {
      let sum = 0, w = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(arr.length - 1, i + radius); j++) {
        const gw = Math.exp(-((j - i) ** 2) / (2 * sigma * sigma));
        sum += arr[j] * gw;
        w   += gw;
      }
      return w > 0 ? sum / w : 0;
    });
  }
}

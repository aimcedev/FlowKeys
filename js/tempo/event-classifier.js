/**
 * Layer 1 — Event classifier.
 *
 * Converts raw MIDI onsets into musically-weighted events.
 * Each event gets a salience score (0–1) encoding how strongly it
 * likely represents a structural arrival rather than decoration.
 *
 * Salience sources:
 *   chord attack    — simultaneous notes (most reliable structural cue)
 *   bass note       — low register, pitch-weighted
 *   velocity accent — loud attack
 *   harmonic change — new pitch classes not present in last chord
 *   agogic accent   — gap before this event (temporal emphasis)
 *   pedal proximity — pedal edge near this onset
 */
export class EventClassifier {
  constructor() {
    this.events = [];
    this.WINDOW_MS = 10_000; // retain 10 s of events

    // State carried between events
    this.pedalState = 0;
    this.lastPedalTime = -9999;
    this.lastHarmonyPCs = new Set(); // pitch-classes of previous chord
  }

  process(rawEvent) {
    if (rawEvent.type === 'pedal') {
      this.pedalState = rawEvent.value;
      this.lastPedalTime = rawEvent.time;
      return null;
    }
    if (rawEvent.type === 'onset') {
      return this._classify(rawEvent);
    }
    return null;
  }

  _classify(event) {
    const { notes, count, lowestPitch, maxVelocity, time } = event;
    const pitches = notes.map(n => n.pitch);
    const newPCs = new Set(pitches.map(p => p % 12));

    let salience = 0.08; // baseline

    // 1. Chord attack: the stronger the better
    if (count >= 2) {
      // 3-note chord already gives 0.32; saturates around 5 notes
      salience += Math.min(0.25 + (count - 1) * 0.06, 0.45);
    }

    // 2. Bass note: linear boost from MIDI 60 down to 36
    //    C5=60 (no boost) → C2=36 (full 0.30 boost)
    if (lowestPitch < 60) {
      const strength = Math.max(0, Math.min((60 - lowestPitch) / 24, 1));
      salience += 0.30 * strength;
    } else if (lowestPitch < 67) {
      salience += 0.06; // upper-mid range, small bump
    }

    // 3. Velocity / accent
    if (maxVelocity >= 90)      salience += 0.20;
    else if (maxVelocity >= 72) salience += 0.10;
    else if (maxVelocity >= 55) salience += 0.04;

    // 4. Harmonic novelty — how different from the last chord?
    if (this.lastHarmonyPCs.size > 0) {
      const novel = [...newPCs].filter(pc => !this.lastHarmonyPCs.has(pc)).length;
      const novelRatio = novel / Math.max(newPCs.size, 1);
      salience += 0.20 * novelRatio;
    }

    // 5. Agogic accent: gap > 150 ms before this onset → structural arrival
    const lastEvent = this.events[this.events.length - 1];
    if (lastEvent) {
      const gap = time - lastEvent.time;
      if (gap > 150) {
        // Scales from 0 at 150 ms to 0.25 at 1250 ms+
        salience += Math.min((gap - 150) / 1100, 0.25);
      }
    }

    // 6. Pedal change within 80 ms of this onset
    if (Math.abs(time - this.lastPedalTime) < 80) {
      salience += 0.12;
    }

    salience = Math.min(salience, 1.0);

    // Update harmony state
    this.lastHarmonyPCs = newPCs;

    const classified = {
      time,
      salience,
      count,
      lowestPitch,
      maxVelocity,
      isBass:  lowestPitch < 60,
      isChord: count >= 2,
    };

    this.events.push(classified);
    this._prune(time);
    return classified;
  }

  _prune(now) {
    const cutoff = now - this.WINDOW_MS;
    if (this.events.length > 0 && this.events[0].time < cutoff) {
      let i = 0;
      while (i < this.events.length && this.events[i].time < cutoff) i++;
      this.events = this.events.slice(i);
    }
  }

  getEvents() { return this.events; }

  reset() {
    this.events = [];
    this.lastHarmonyPCs = new Set();
    this.pedalState = 0;
    this.lastPedalTime = -9999;
  }
}

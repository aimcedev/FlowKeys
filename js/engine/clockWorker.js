/**
 * Clock Worker — runs the timing loop in a dedicated thread.
 *
 * Why a Worker? The main browser thread's setTimeout is throttled to ~1 second
 * minimum intervals when the tab is backgrounded or the user switches away.
 * Workers run independently of the tab's visibility state, so the clock stays
 * rock-solid even if the browser window loses focus for minutes.
 *
 * Messages received (from main thread):
 *   { type: 'start',            data: { msPerPulse } }  — begin ticking from now
 *   { type: 'stop' }                                     — halt all ticking
 *   { type: 'setMsPerPulse',    data: { msPerPulse } }  — update BPM on the fly
 *   { type: 'resetBase' }                               — re-anchor expected time to now (tab focus restore)
 *   { type: 'restartImmediate', data: { msPerPulse } }  — stop, fire one tick immediately, then resume
 *
 * Messages sent (to main thread):
 *   { type: 'tick' }
 */

let timeoutId = null;
let expectedTime = 0;
let msPerPulse = (60000 / 120) / 24; // default: 120 BPM, PPQ 24
let running = false;

self.onerror = function (e) {
  self.postMessage({ type: 'error', message: `Worker uncaught error: ${e.message}` });
};

self.onmessage = function (e) {
  const { type, data } = e.data;

  switch (type) {
    case 'start':
      if (running) return;
      running = true;
      if (data?.msPerPulse) msPerPulse = data.msPerPulse;
      expectedTime = performance.now();
      // Fire first tick immediately (matches old clock.start() behaviour)
      self.postMessage({ type: 'tick' });
      schedule();
      break;

    case 'stop':
      running = false;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      break;

    case 'setMsPerPulse':
      if (data?.msPerPulse) msPerPulse = data.msPerPulse;
      break;

    case 'resetBase':
      // Tab came back into focus — re-anchor so we don't race to catch up on
      // all the ticks that were delayed while the tab was backgrounded.
      expectedTime = performance.now();
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (running) schedule();
      break;

    case 'restartImmediate':
      // Used by reset() and restartFromZero(): stop whatever is running, fire
      // one tick RIGHT NOW (so step 0 / bar 1 sounds immediately), then resume.
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      running = true;
      if (data?.msPerPulse) msPerPulse = data.msPerPulse;
      expectedTime = performance.now();
      self.postMessage({ type: 'tick' });
      schedule();
      break;
  }
};

function schedule() {
  if (!running) return;

  expectedTime += msPerPulse;
  let delay = expectedTime - performance.now();

  // If we've fallen behind (delay < 0), snap the base forward so we don't
  // spiral into a burst of catch-up ticks.
  if (delay < 0) {
    expectedTime = performance.now();
    delay = 0;
  }

  timeoutId = setTimeout(() => {
    if (!running) return;
    try {
      self.postMessage({ type: 'tick' });
      schedule();
    } catch (e) {
      running = false;
      self.postMessage({ type: 'error', message: `Clock scheduler error: ${e.message}` });
    }
  }, delay);
}

/**
 * rafThrottle(fn) — coalesces rapid calls into at most one invocation per
 * animation frame. Useful for `resize` handlers: the browser can fire dozens of
 * resize events per second while a window is being dragged, and reallocating a
 * canvas on each one saturates the main thread (which in turn stalls the clock).
 * Throttling to one call per frame caps that work at the display refresh rate.
 *
 * Returns a wrapped function plus a `.cancel()` to drop any pending frame.
 */
export function rafThrottle(fn) {
  let rafId = null;
  const wrapped = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn();
    });
  };
  wrapped.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  return wrapped;
}

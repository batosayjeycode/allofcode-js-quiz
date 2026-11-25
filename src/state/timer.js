/**
 * Deadline-driven ticker. It never counts down by itself: every tick just
 * reports "check the clock now", and callers compare Date.now() with an
 * absolute deadline. A throttled or backgrounded tab therefore can't drift;
 * the next tick (or the visibility/focus/pageshow event fired on return)
 * catches up immediately.
 */

const WAKE_EVENTS = [
  ['document', 'visibilitychange'],
  ['window', 'focus'],
  ['window', 'pageshow'],
];

/**
 * @param {{ onTick: () => void, intervalMs?: number, win?: Window, doc?: Document }} options
 */
export function createTicker({ onTick, intervalMs = 250, win = globalThis.window, doc = globalThis.document }) {
  let intervalId = null;
  const targets = { window: win, document: doc };
  const tick = () => onTick();

  return {
    get running() {
      return intervalId !== null;
    },
    /** Idempotent: a second start never creates a second interval. */
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, intervalMs);
      for (const [target, type] of WAKE_EVENTS) targets[target]?.addEventListener?.(type, tick);
    },
    stop() {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
      for (const [target, type] of WAKE_EVENTS) targets[target]?.removeEventListener?.(type, tick);
    },
  };
}

/** Milliseconds left until `deadline`, never negative. */
export function remainingMs(deadline, now) {
  return Math.max(0, deadline - now);
}

/** "mm:ss", rounding up so the display never shows 00:00 while time is left. */
export function formatCountdown(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

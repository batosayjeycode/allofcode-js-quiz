/**
 * Sandbox runtime — runs INSIDE an isolated worker (browser Web Worker, or a
 * Node worker thread in tests). It never runs on the application main thread.
 *
 * Responsibilities:
 *  - capture console output (streamed to the host so partial output survives a timeout)
 *  - track timers so the host knows when asynchronous work has settled
 *  - capture synchronous, asynchronous and promise-rejection errors
 *  - disable network / messaging globals that candidate code has no business using
 *
 * Protocol (worker -> host):
 *  { type: 'log',  entry: { level, text, args: [{ text, cloneable, value? }] } }
 *  { type: 'done', result: { status, error, errors, durationMs, truncated } }
 */

import { formatLogLine, formatValue, serializeValue } from './format.js';

export const MAX_LOG_ENTRIES = 300;
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
const IDLE_CHECKS_REQUIRED = 3;
const POLL_INTERVAL_MS = 4;
// Minimum quiet period before declaring the run settled. Browsers deliver
// `unhandledrejection` in a separate task, which may run after a few timer tasks.
const SETTLE_QUIET_MS = 30;

export const DEFAULT_BLOCKED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'postMessage',
  'close',
];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Normalises anything that was thrown into a transferable error description.
 * @param {unknown} thrown
 * @param {'compile'|'sync'|'async'|'promise'} phase
 */
export function serializeError(thrown, phase) {
  const isErrorLike =
    thrown !== null &&
    typeof thrown === 'object' &&
    typeof thrown.name === 'string' &&
    typeof thrown.message === 'string';
  if (isErrorLike) {
    return { name: thrown.name, message: thrown.message, phase, nonError: false };
  }
  // `throw 'oops'` or `Promise.reject(42)` — not an Error instance.
  return { name: 'Uncaught', message: formatValue(thrown, { top: false }), phase, nonError: true };
}

function blockGlobal(globalObject, name) {
  const blocked = function blockedGlobal() {
    throw new Error(`${name} is disabled in the interview sandbox`);
  };
  // Override the property on the global and every prototype that owns it, so
  // candidate code cannot reach the original via Object.getPrototypeOf(self).
  let target = globalObject;
  while (target) {
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      try {
        Object.defineProperty(target, name, { value: blocked, configurable: true, writable: false });
      } catch {
        /* non-configurable host property — ignore */
      }
    }
    target = Object.getPrototypeOf(target);
  }
}

/**
 * @param {object} options
 * @param {object} options.globalObject  the worker global scope
 * @param {(message: object) => void} options.post  host messaging function (captured before blocking)
 * @param {string[]} [options.blockedGlobals]
 * @param {number} [options.maxLogEntries]
 */
export function createSandboxRuntime({
  globalObject,
  post,
  blockedGlobals = DEFAULT_BLOCKED_GLOBALS,
  maxLogEntries = MAX_LOG_ENTRIES,
}) {
  const native = {
    setTimeout: globalObject.setTimeout,
    clearTimeout: globalObject.clearTimeout,
    setInterval: globalObject.setInterval,
    clearInterval: globalObject.clearInterval,
  };
  const schedule = (fn, ms) => native.setTimeout.call(globalObject, fn, ms);

  const activeTimers = new Set();
  const errors = [];
  let logCount = 0;
  let truncated = false;
  let startedAt = 0;
  let lastActivityAt = 0;
  let started = false;
  let finished = false;

  function emitLog(level, args) {
    if (finished) return;
    lastActivityAt = now();
    if (logCount >= maxLogEntries) {
      truncated = true;
      return;
    }
    logCount += 1;
    post({
      type: 'log',
      entry: { level, text: formatLogLine(args), args: args.map(serializeValue) },
    });
  }

  function reportError(thrown, phase = 'async') {
    if (finished) return;
    lastActivityAt = now();
    errors.push(serializeError(thrown, phase));
  }

  function invokeCallback(callback, args) {
    lastActivityAt = now();
    try {
      callback(...args);
    } catch (error) {
      reportError(error, 'async');
    }
  }

  function assertCallback(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Timer callbacks must be functions (string callbacks are disabled in the sandbox)');
    }
  }

  // --- console capture -----------------------------------------------------
  const sandboxConsole = {};
  for (const level of CONSOLE_LEVELS) {
    sandboxConsole[level] = (...args) => emitLog(level, args);
  }
  sandboxConsole.table = (...args) => emitLog('log', args);
  sandboxConsole.dir = (value) => emitLog('log', [value]);

  // --- tracked timers ------------------------------------------------------
  const sandboxTimers = {
    setTimeout(callback, delay, ...args) {
      assertCallback(callback);
      const handle = native.setTimeout.call(
        globalObject,
        () => {
          activeTimers.delete(handle);
          invokeCallback(callback, args);
        },
        delay,
      );
      activeTimers.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      activeTimers.delete(handle);
      native.clearTimeout.call(globalObject, handle);
    },
    setInterval(callback, delay, ...args) {
      assertCallback(callback);
      const handle = native.setInterval.call(globalObject, () => invokeCallback(callback, args), delay);
      activeTimers.add(handle);
      return handle;
    },
    clearInterval(handle) {
      activeTimers.delete(handle);
      native.clearInterval.call(globalObject, handle);
    },
  };

  function install() {
    Object.defineProperty(globalObject, 'console', {
      value: sandboxConsole,
      configurable: true,
      writable: true,
    });
    for (const [name, fn] of Object.entries(sandboxTimers)) {
      Object.defineProperty(globalObject, name, { value: fn, configurable: true, writable: true });
    }
    for (const name of blockedGlobals) blockGlobal(globalObject, name);
  }

  function finish() {
    if (finished) return;
    finished = true;
    const [first = null] = errors;
    post({
      type: 'done',
      result: {
        status: first ? 'error' : 'success',
        error: first,
        errors: errors.slice(0, 10),
        durationMs: Math.round((now() - startedAt) * 100) / 100,
        truncated,
      },
    });
  }

  /**
   * Waits until no tracked timers remain and the microtask queue has drained
   * across several macrotask turns (unhandled rejections are reported in a
   * later task). Never-settling timers are handled by the host timeout.
   */
  function waitForSettle() {
    let idleChecks = 0;
    const check = () => {
      if (activeTimers.size > 0) {
        idleChecks = 0;
        schedule(check, POLL_INTERVAL_MS);
        return;
      }
      idleChecks += 1;
      const quietFor = now() - lastActivityAt;
      if (idleChecks >= IDLE_CHECKS_REQUIRED && quietFor >= SETTLE_QUIET_MS) finish();
      else schedule(check, idleChecks >= IDLE_CHECKS_REQUIRED ? SETTLE_QUIET_MS - quietFor : 0);
    };
    schedule(check, 0);
  }

  install();

  return {
    reportError,
    /** @param {string} code */
    execute(code) {
      if (started) return;
      started = true;
      startedAt = now();
      lastActivityAt = startedAt;

      let compiled;
      try {
        // Compiled inside the worker realm only; the code is the function body
        // so a leading 'use strict' directive in the snippet is honoured.
        compiled = new Function(String(code));
      } catch (error) {
        reportError(error, 'compile');
        finish();
        return;
      }

      try {
        compiled.call(undefined);
      } catch (error) {
        // Like a real script: execution stops, but already-scheduled async work still runs.
        reportError(error, 'sync');
      }
      waitForSettle();
    },
  };
}

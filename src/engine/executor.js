/**
 * Host-side execution controller (main thread).
 *
 * Spawns an isolated worker per run, collects streamed console output, enforces
 * a hard timeout by terminating the worker, and resolves with a normalised
 * ExecutionResult. Never rejects.
 *
 * @typedef {{ text: string, cloneable: boolean, value?: unknown }} LoggedArg
 * @typedef {{ level: string, text: string, args: LoggedArg[] }} LogEntry
 * @typedef {{ name: string, message: string, phase: string, nonError?: boolean }} ExecutionError
 * @typedef {{
 *   status: 'success' | 'error' | 'timeout',
 *   logs: LogEntry[],
 *   error: ExecutionError | null,
 *   errors: ExecutionError[],
 *   durationMs: number,
 *   truncated: boolean,
 * }} ExecutionResult
 */

export const DEFAULT_TIMEOUT_MS = 3000;

/** Default factory: a module Web Worker bundled by Vite. */
export function createBrowserWorker() {
  return new Worker(new URL('./sandbox.worker.js', import.meta.url), {
    type: 'module',
    name: 'js-interview-sandbox',
  });
}

/**
 * @param {string} code
 * @param {{ timeoutMs?: number, createWorker?: () => any }} [options]
 * @returns {Promise<ExecutionResult>}
 */
export function executeCode(code, { timeoutMs = DEFAULT_TIMEOUT_MS, createWorker = createBrowserWorker } = {}) {
  return new Promise((resolve) => {
    const logs = [];
    const startedAt = Date.now();
    let settled = false;
    let worker = null;
    let timer = null;

    const finalize = (partial) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        /* already gone */
      }
      resolve({
        status: partial.status,
        logs,
        error: partial.error ?? null,
        errors: partial.errors ?? (partial.error ? [partial.error] : []),
        durationMs: partial.durationMs ?? Date.now() - startedAt,
        truncated: Boolean(partial.truncated),
      });
    };

    try {
      worker = createWorker();
    } catch (error) {
      finalize({
        status: 'error',
        error: { name: 'SandboxError', message: `Unable to start sandbox: ${error?.message ?? error}`, phase: 'host' },
      });
      return;
    }

    timer = setTimeout(() => {
      finalize({
        status: 'timeout',
        error: {
          name: 'TimeoutError',
          message: `Execution did not finish within ${timeoutMs} ms and was terminated`,
          phase: 'host',
        },
        durationMs: timeoutMs,
        truncated: true,
      });
    }, timeoutMs);

    worker.onmessage = (event) => {
      const message = event.data;
      if (!message || settled) return;
      if (message.type === 'log') logs.push(message.entry);
      else if (message.type === 'done') finalize(message.result);
    };

    worker.onerror = (event) => {
      event?.preventDefault?.();
      finalize({
        status: 'error',
        error: { name: 'SandboxError', message: event?.message || 'The sandbox worker crashed', phase: 'host' },
      });
    };

    worker.postMessage({ type: 'run', code });
  });
}

/** Human readable label for an execution error, e.g. "Uncaught (in promise) Error: boom". */
export function describeError(error) {
  if (!error) return '';
  if (error.name === 'TimeoutError' || error.name === 'SandboxError') return `${error.name}: ${error.message}`;
  const prefix = error.phase === 'promise' ? 'Uncaught (in promise) ' : error.phase === 'compile' ? '' : 'Uncaught ';
  if (error.nonError) return `${prefix.trim() || 'Uncaught'} ${error.message}`;
  return `${prefix}${error.name}${error.message ? `: ${error.message}` : ''}`;
}

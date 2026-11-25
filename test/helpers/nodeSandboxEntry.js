// Node worker_threads entry that hosts the SAME sandbox runtime the browser
// Web Worker uses, so the execution engine can be tested without a browser.
import { parentPort } from 'node:worker_threads';
import { createSandboxRuntime, DEFAULT_BLOCKED_GLOBALS } from '../../src/engine/runtime.js';

const runtime = createSandboxRuntime({
  globalObject: globalThis,
  post: (message) => parentPort.postMessage(message),
  blockedGlobals: DEFAULT_BLOCKED_GLOBALS.filter((name) => name !== 'close'),
});

process.on('uncaughtException', (error) => runtime.reportError(error, 'async'));
process.on('unhandledRejection', (reason) => runtime.reportError(reason, 'promise'));

parentPort.once('message', (message) => {
  if (message && message.type === 'run') runtime.execute(message.code);
});

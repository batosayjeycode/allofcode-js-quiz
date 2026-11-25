/**
 * Browser Web Worker entry point for the code sandbox.
 * A fresh worker is created for every execution and terminated afterwards, so
 * no state leaks between runs and an infinite loop can always be killed.
 */
import { createSandboxRuntime } from './runtime.js';

const scope = self;
const post = scope.postMessage.bind(scope); // captured before postMessage is blocked

const runtime = createSandboxRuntime({ globalObject: scope, post });

scope.addEventListener('error', (event) => {
  event.preventDefault();
  runtime.reportError(event.error ?? new Error(event.message), 'async');
});

scope.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  runtime.reportError(event.reason, 'promise');
});

scope.addEventListener(
  'message',
  (event) => {
    if (event.data && event.data.type === 'run') runtime.execute(event.data.code);
  },
  { once: true },
);

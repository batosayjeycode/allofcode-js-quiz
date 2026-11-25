import { Worker } from 'node:worker_threads';

const entry = new URL('./nodeSandboxEntry.js', import.meta.url);

/** Adapts a Node worker thread to the browser Worker interface used by executeCode. */
export function createNodeWorker() {
  const worker = new Worker(entry);
  const adapter = {
    onmessage: null,
    onerror: null,
    postMessage: (data) => worker.postMessage(data),
    terminate: () => worker.terminate(),
  };
  worker.on('message', (data) => adapter.onmessage?.({ data }));
  worker.on('error', (error) => adapter.onerror?.({ message: error.message }));
  return adapter;
}

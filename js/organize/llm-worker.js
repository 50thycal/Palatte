// Runs the on-device model off the main thread so typing stays smooth.
import { WebWorkerMLCEngineHandler } from '/vendor/web-llm/index.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => {
  // Diagnostics ping: proves the worker (and the library) loaded
  if (msg.data && msg.data.palatePing) {
    self.postMessage({ palatePong: true, gpu: 'gpu' in navigator });
    return;
  }
  handler.onmessage(msg);
};

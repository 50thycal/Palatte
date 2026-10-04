// Runs the on-device model off the main thread so typing stays smooth.
import { WebWorkerMLCEngineHandler } from '/vendor/web-llm/index.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);

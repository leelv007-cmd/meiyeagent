import { startWorker } from './assembly/worker-runtime.js';

await startWorker(process.env);

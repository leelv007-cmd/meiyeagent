import { assembleCore } from './assembly/index.js';

await assembleCore(process.env, { role: 'worker' });

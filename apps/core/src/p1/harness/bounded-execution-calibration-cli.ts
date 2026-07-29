import { readFile } from 'node:fs/promises';

import { summarizeBoundedExecutionCalibration } from './bounded-execution-calibration.js';

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error(
    'Usage: bounded-execution-calibration-cli.ts <samples.json>',
  );
}

const samples = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
const summary = summarizeBoundedExecutionCalibration(samples);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

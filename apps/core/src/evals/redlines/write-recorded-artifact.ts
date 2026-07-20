import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createRecordedRedlineEvalRun } from './redline-artifact.js';

const output = process.argv[2];
if (!output) {
  throw new Error(
    'Usage: tsx write-recorded-artifact.ts <eval-run-output.json>',
  );
}
const outputPath = resolve(output);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(createRecordedRedlineEvalRun(), null, 2)}\n`,
  'utf8',
);
console.log(outputPath);

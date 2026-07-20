import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { runBeautyPreferenceMemoryEval } from './runner.js';

const output = process.argv[2];
if (!output) {
  throw new Error(
    'Usage: tsx write-recorded-artifact.ts <eval-run-output.json>',
  );
}
const outputPath = resolve(output);
const evaluation = await runBeautyPreferenceMemoryEval();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(evaluation.artifact, null, 2)}\n`,
  'utf8',
);
console.log(outputPath);

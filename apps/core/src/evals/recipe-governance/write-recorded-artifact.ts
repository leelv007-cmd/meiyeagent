import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createRecordedRecipeGovernanceEvalRun } from './runner.js';

const output = process.argv[2];
if (!output) {
  throw new Error(
    'Usage: tsx write-recorded-artifact.ts <eval-run-output.json>',
  );
}
const outputPath = resolve(output);
const run = await createRecordedRecipeGovernanceEvalRun();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(run, null, 2)}\n`,
  'utf8',
);
console.log(outputPath);

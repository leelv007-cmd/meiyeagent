import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { summarizeBoundedExecutionCalibration } from './bounded-execution-calibration.js';
import { runIssue255RecordedCalibration } from './issue-255-recorded-calibration.js';

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  throw new Error(
    'Usage: issue-255-recorded-calibration-cli.ts <evidence-directory>',
  );
}

const directory = resolve(outputDirectory);
const samples = await runIssue255RecordedCalibration();
const summary = summarizeBoundedExecutionCalibration(samples);
await mkdir(directory, { recursive: true });
await Promise.all([
  writeFile(
    `${directory}/recorded-samples.json`,
    `${JSON.stringify(samples, null, 2)}\n`,
    { flag: 'wx' },
  ),
  writeFile(
    `${directory}/recorded-summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
    { flag: 'wx' },
  ),
]);
process.stdout.write(
  `${JSON.stringify({
    evidenceKind: 'recorded',
    fixtureCount: summary.evidenceCounts.fixture,
    liveCount: summary.evidenceCounts.live,
    recordedCount: summary.evidenceCounts.recorded,
  })}\n`,
);

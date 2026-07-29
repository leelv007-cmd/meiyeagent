import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ISSUE_255_RECORDED_CALIBRATION_LIMITS,
} from '../admin-config/bounded-execution-limits.js';
import { summarizeBoundedExecutionCalibration } from './bounded-execution-calibration.js';
import {
  runIssue255RecordedCalibration,
} from './issue-255-recorded-calibration.js';
import { assertIssue255RecordedMatrix } from './issue-255-calibration-guard.js';

test('issue 255 recorded runner executes the strict 27-sample matrix with network disabled', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('recorded calibration must not use network');
  };

  try {
    const samples = await runIssue255RecordedCalibration(globalThis.fetch);
    assert.equal(assertIssue255RecordedMatrix(samples).length, 27);
    assert.equal(networkCalls, 0);
    assert.deepEqual(
      samples.reduce(
        (counts, sample) => {
          counts[sample.modality] += 1;
          return counts;
        },
        { copy: 0, image_text: 0, video: 0 },
      ),
      { copy: 9, image_text: 9, video: 9 },
    );
    assert.equal(
      samples
        .filter(
          (sample) =>
            sample.modality === 'copy' &&
            sample.scenarioBand === 'low',
        )
        .every(
          (sample) =>
            sample.observed.iterations === 1 &&
            sample.loopEvidence === 'bounded_single_pass',
        ),
      true,
      'low copy samples must cross the production bounded selection once',
    );
    assert.equal(
      samples
        .filter(
          (sample) =>
            sample.modality === 'copy' &&
            sample.scenarioBand === 'typical',
        )
        .every(
          (sample) =>
            sample.observed.iterations === 2 &&
            sample.loopEvidence === 'full_limit_loop',
        ),
      true,
      'typical copy samples must self-correct through the canonical gate',
    );
    assert.equal(
      samples
        .filter(
          (sample) =>
            sample.modality === 'copy' &&
            sample.scenarioBand === 'boundary',
        )
        .every(
          (sample) =>
            sample.observed.iterations === 1 &&
            sample.loopEvidence === 'full_limit_loop',
        ),
      true,
      'boundary copy samples must hit the real maxIterations suspension',
    );
    assert.equal(
      samples
        .filter((sample) => sample.modality !== 'copy')
        .every(
          (sample) =>
            sample.loopEvidence === 'non_limit_loop' &&
            sample.observed.costCents === 0,
        ),
      true,
      'recorded media samples must be labeled as non-limit-loop zero-cost observations',
    );

    const summary = summarizeBoundedExecutionCalibration(samples);
    const evidence = JSON.parse(
      await readFile(
        new URL(
          '../../../../../references/evidence/issue-255/recorded-calibration-decision.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.equal(evidence.evidence.recorded.sampleCount, 27);
    assert.deepEqual(evidence.evidence.recorded.distribution.modalities, {
      copy: 9,
      image_text: 9,
      video: 9,
    });
    assert.deepEqual(
      evidence.observedDistributions.overall.iterations,
      summary.overall.maxIterations,
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(evidence.decisions).map(([axis, decision]) => [
          axis,
          {
            default: (decision as { default: number | 'unset' }).default,
            hardCap: (decision as { hardCap: number | 'unset' }).hardCap,
          },
        ]),
      ),
      ISSUE_255_RECORDED_CALIBRATION_LIMITS,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

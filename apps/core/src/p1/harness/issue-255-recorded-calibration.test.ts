import { createHash } from 'node:crypto';
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
import {
  assertIssue255RecordedMatrix,
  canonicalRecordedMatrixDigest,
} from './issue-255-calibration-guard.js';

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

    const evidenceDirectory = new URL(
      '../../../../../references/evidence/issue-255/',
      import.meta.url,
    );
    const [evidenceText, recordedSamplesText, recordedSummaryText] =
      await Promise.all([
        readFile(
          new URL('recorded-calibration-decision.json', evidenceDirectory),
          'utf8',
        ),
        readFile(new URL('recorded-samples.json', evidenceDirectory), 'utf8'),
        readFile(new URL('recorded-summary.json', evidenceDirectory), 'utf8'),
      ]);
    const evidence = JSON.parse(evidenceText);
    const recordedSamples = assertIssue255RecordedMatrix(
      JSON.parse(recordedSamplesText),
    );
    const recordedSummary = JSON.parse(recordedSummaryText);
    assert.deepEqual(
      summarizeBoundedExecutionCalibration(recordedSamples),
      recordedSummary,
    );
    assert.equal(
      createHash('sha256').update(recordedSamplesText).digest('hex'),
      evidence.recordedArtifacts.samplesFileSha256,
    );
    assert.equal(
      createHash('sha256').update(recordedSummaryText).digest('hex'),
      evidence.recordedArtifacts.summaryFileSha256,
    );
    assert.equal(
      canonicalRecordedMatrixDigest(recordedSamples),
      evidence.recordedMatrixDigest,
    );
    assert.equal(
      evidence.recordedArtifacts.canonicalMatrixDigest,
      evidence.recordedMatrixDigest,
    );
    assert.equal(evidence.evidence.recorded.sampleCount, 27);
    assert.deepEqual(evidence.evidence.recorded.distribution.modalities, {
      copy: 9,
      image_text: 9,
      video: 9,
    });
    assert.deepEqual(
      evidence.observedDistributions,
      {
        overall: recordedSummary.overall,
        byModality: recordedSummary.byModality,
      },
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

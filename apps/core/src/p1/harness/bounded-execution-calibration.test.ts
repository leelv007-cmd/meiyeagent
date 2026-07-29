import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedExecutionCalibrationSampleSchema,
  summarizeBoundedExecutionCalibration,
} from './bounded-execution-calibration.js';

const axes = {
  skillRevision: 'copywriter@rev-17',
  promptVersion: 'marketing/copy@v4',
  catalogRevision: 'catalog-2026-07-29',
  scene: 'copy.generate',
} as const;

test('bounded-execution calibration keeps evidence classes separate and reports nearest-rank distributions by modality', () => {
  const summary = summarizeBoundedExecutionCalibration([
    {
      axes,
      artifactRef: 'fixture://calibration/copy-low-1',
      evidenceKind: 'fixture',
      modality: 'copy',
      sampleId: 'copy-low-1',
      scenarioBand: 'low',
      scenarioId: 'copy-low',
      seed: 1,
      observed: {
        delegations: 0,
        iterations: 1,
        costCents: 10,
        wallClockMs: 100,
        suspendedMs: 0,
      },
    },
    {
      axes,
      artifactRef: 'recorded://calibration/copy-typical-1',
      evidenceKind: 'recorded',
      modality: 'copy',
      sampleId: 'copy-typical-1',
      scenarioBand: 'typical',
      scenarioId: 'copy-typical',
      seed: 1,
      observed: {
        delegations: 0,
        iterations: 2,
        costCents: 20,
        wallClockMs: 200,
        suspendedMs: 50,
      },
    },
    {
      axes: { ...axes, scene: 'image_text.generate' },
      artifactRef: 'recorded://calibration/image-boundary-1',
      evidenceKind: 'recorded',
      modality: 'image_text',
      sampleId: 'image-boundary-1',
      scenarioBand: 'boundary',
      scenarioId: 'image-boundary',
      seed: 1,
      observed: {
        delegations: 0,
        iterations: 3,
        costCents: 30,
        wallClockMs: 300,
        suspendedMs: 100,
      },
    },
    {
      axes: { ...axes, scene: 'video.generate' },
      artifactRef: 'live://calibration/video-typical-1',
      evidenceKind: 'live',
      modality: 'video',
      sampleId: 'video-typical-1',
      scenarioBand: 'typical',
      scenarioId: 'video-typical',
      seed: 1,
      observed: {
        delegations: 0,
        iterations: 4,
        costCents: 40,
        wallClockMs: 400,
        suspendedMs: 0,
      },
    },
    {
      axes: { ...axes, scene: 'video.generate' },
      artifactRef: 'live://calibration/video-boundary-1',
      evidenceKind: 'live',
      modality: 'video',
      sampleId: 'video-boundary-1',
      scenarioBand: 'boundary',
      scenarioId: 'video-boundary',
      seed: 1,
      observed: {
        delegations: 0,
        iterations: 5,
        costCents: 50,
        wallClockMs: 500,
        suspendedMs: 200,
      },
    },
  ]);

  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.quantileMethod, 'nearest_rank');
  assert.equal(summary.sampleCount, 5);
  assert.deepEqual(summary.evidenceCounts, {
    fixture: 1,
    recorded: 2,
    live: 2,
  });
  assert.deepEqual(summary.scenarioBandCounts, {
    low: 1,
    typical: 2,
    boundary: 2,
  });
  assert.deepEqual(summary.overall.maxIterations, {
    count: 5,
    min: 1,
    p50: 3,
    p90: 5,
    p95: 5,
    max: 5,
  });
  assert.deepEqual(summary.overall.maxWallClockMs, {
    count: 5,
    min: 100,
    p50: 300,
    p90: 500,
    p95: 500,
    max: 500,
  });
  assert.deepEqual(summary.overall.activeWallClockMs, {
    count: 5,
    min: 100,
    p50: 200,
    p90: 400,
    p95: 400,
    max: 400,
  });
  assert.deepEqual(summary.byEvidence.live?.maxIterations, {
    count: 2,
    min: 4,
    p50: 4,
    p90: 5,
    p95: 5,
    max: 5,
  });
  assert.deepEqual(summary.byModality.copy.maxCostCents, {
    count: 2,
    min: 10,
    p50: 10,
    p90: 20,
    p95: 20,
    max: 20,
  });
  assert.equal(summary.byModality.video.maxIterations.max, 5);
});

test('bounded-execution calibration rejects samples that blur suspension accounting or observability lineage', () => {
  assert.equal(
    boundedExecutionCalibrationSampleSchema.safeParse({
      axes,
      artifactRef: 'live://calibration/video-invalid',
      evidenceKind: 'live',
      modality: 'video',
      sampleId: 'video-invalid',
      scenarioBand: 'boundary',
      scenarioId: 'video-invalid',
      seed: 1,
      observed: {
        delegations: 0,
        iterations: 1,
        costCents: 10,
        wallClockMs: 100,
        suspendedMs: 101,
      },
    }).success,
    false,
  );
  assert.equal(
    boundedExecutionCalibrationSampleSchema.safeParse({
      axes,
      artifactRef: 'fixture://calibration/video-relabeled',
      evidenceKind: 'live',
      modality: 'video',
      sampleId: 'video-relabeled',
      scenarioBand: 'boundary',
      scenarioId: 'video-relabeled',
      seed: 1,
      observed: {
        delegations: 0,
        iterations: 1,
        costCents: 10,
        wallClockMs: 100,
        suspendedMs: 0,
      },
    }).success,
    false,
  );
});

test('bounded-execution calibration rejects duplicate sample identities before computing distributions', () => {
  const sample = boundedExecutionCalibrationSampleSchema.parse({
    axes,
    artifactRef: 'live://calibration/shared-sample',
    evidenceKind: 'live',
    modality: 'copy',
    sampleId: 'shared-sample',
    scenarioBand: 'typical',
    scenarioId: 'copy-typical',
    seed: 1,
    observed: {
      delegations: 0,
      iterations: 1,
      costCents: 10,
      wallClockMs: 100,
      suspendedMs: 0,
    },
  });

  assert.throws(
    () =>
      summarizeBoundedExecutionCalibration([
        sample,
        {
          ...sample,
          axes: { ...axes, scene: 'image_text.generate' },
          artifactRef: 'live://calibration/shared-sample-image',
          modality: 'image_text',
        },
        {
          ...sample,
          axes: { ...axes, scene: 'video.generate' },
          artifactRef: 'live://calibration/shared-sample-video',
          modality: 'video',
        },
      ]),
    /sampleId must be unique/u,
  );
});

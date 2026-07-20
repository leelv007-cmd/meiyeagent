import assert from 'node:assert/strict';
import test from 'node:test';

import { videoWorkflowLaunchPlan } from './video-workflow-launcher';

test('builds a fixture-compatible vertical video contract from the public catalog', () => {
  const plan = videoWorkflowLaunchPlan(
    {
      models: [
        {
          availability: 'recorded',
          available: true,
          displayName: '本地视频成片',
          id: 'seedance-fixture',
          modality: 'video',
          operations: ['video.generate'],
          qualityRank: 1,
          unitPrice: {
            amountMicros: 30_000,
            currency: 'USD',
            revision: 'fixture-price-v1',
            unit: 'video',
          },
        },
      ],
      revisionId: 'fixture-catalog-v1',
    },
    {
      aigcLabelEnabled: true,
      watermarkEnabled: false,
    },
    '2026-07-18T12:00:00.000Z'
  );

  assert.ok(plan);
  assert.equal(plan.model.id, 'seedance-fixture');
  assert.deepEqual(plan.contract, {
    aigcLabelEnabled: true,
    aspectRatio: '9:16',
    catalogModelId: 'seedance-fixture',
    catalogRevision: 'fixture-catalog-v1',
    currency: 'USD',
    dataClass: [],
    durationSeconds: 15,
    estimatedAmount: 0.03,
    operation: 'video.generate',
    outputCount: 1,
    outputLabel: '1 段竖屏视频',
    quoteAcceptedAt: '2026-07-18T12:00:00.000Z',
    quoteRevision:
      'fixture-catalog-v1:fixture-price-v1:seedance-fixture:video.generate:9:16',
    watermarkEnabled: false,
  });
});

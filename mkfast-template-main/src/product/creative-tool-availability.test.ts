import assert from 'node:assert/strict';
import test from 'node:test';

import { toolAvailabilityForCatalog } from './creative-tool-availability';

test('tool availability requires one live model with quote evidence', () => {
  const priced = toolAvailabilityForCatalog(
    'copy.generate',
    {
      deployments: [
        {
          activationEvidence: { status: 'live_verified' },
          catalogModelId: 'copy-model',
          priceRevision: 'price-v1',
          status: 'active',
          unitPrice: {
            amountMicros: 20_000,
            currency: 'CNY',
            unit: 'request',
          },
        },
      ],
      models: [
        {
          displayName: 'Copy Model',
          id: 'copy-model',
          modality: 'llm',
          operations: ['copy.generate'],
        },
      ],
    },
    'success'
  );
  const unpriced = toolAvailabilityForCatalog(
    'video.generate',
    {
      models: [
        {
          available: true,
          id: 'video-model',
          modality: 'video',
          operations: ['video.generate'],
        },
      ],
    },
    'success'
  );

  assert.deepEqual(priced, { available: true });
  assert.equal(unpriced.available, false);
  assert.match(unpriced.unavailableReason ?? '', /报价/);
});

test('tool stays disabled while the current catalog is unresolved', () => {
  assert.deepEqual(
    toolAvailabilityForCatalog('image.generate', undefined, 'pending'),
    { available: false, unavailableReason: '正在核验模型与报价' }
  );
  assert.deepEqual(
    toolAvailabilityForCatalog('image.generate', undefined, 'error'),
    { available: false, unavailableReason: '模型目录暂时无法读取' }
  );
});

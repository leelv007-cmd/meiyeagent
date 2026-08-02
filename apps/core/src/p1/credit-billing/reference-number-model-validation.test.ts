import assert from 'node:assert/strict';
import test from 'node:test';

import { assertReferenceModelsArePriced } from './reference-number-model-validation.js';

const referenceNumbers = {
  published: {
    growth: { copy: 1_300, image: 260, video: 26 },
    pro: { copy: 2_800, image: 560, video: 56 },
    starter: { copy: 500, image: 100, video: 10 },
    trial: { copy: 100, image: 20, video: 2 },
  },
  referenceModels: {
    copy: 'copy-reference',
    image: 'image-reference',
    video: 'video-reference',
  },
};

test('reference number publication rejects missing category models and a video model without a 15-second price', async () => {
  const catalog = {
    async getCatalog(_workspaceId: string, operation: string) {
      if (operation === 'copy.generate') {
        return {
          models: [
            {
              creditPricing: {
                'copy.generate': {
                  creditCost: 1,
                  failureRefundsCredits: true,
                },
              },
              id: 'copy-reference',
            },
          ],
        };
      }
      if (operation === 'image.generate') {
        return {
          models: [
            {
              creditPricing: {
                'image.generate': {
                  creditCost: 5,
                  failureRefundsCredits: true,
                },
              },
              id: 'image-reference',
            },
          ],
        };
      }
      return {
        models: [
          {
            creditPricing: {
              'video.generate': {
                creditCost: 90,
                failureRefundsCredits: true,
                videoCreditCosts: { 30: 90, 60: 160 },
              },
            },
            id: 'video-reference',
          },
        ],
      };
    },
  };

  await assert.rejects(
    assertReferenceModelsArePriced(referenceNumbers, catalog),
    /15-second video credit price/i
  );
  await assert.rejects(
    assertReferenceModelsArePriced(
      {
        ...referenceNumbers,
        referenceModels: {
          ...referenceNumbers.referenceModels,
          image: 'missing-image-model',
        },
      },
      catalog
    ),
    /image reference model/i
  );
});

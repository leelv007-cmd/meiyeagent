import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AdminModelCreditPricingControl,
  replaceCatalogModelCreditPricing,
} from './admin-model-credit-pricing-control';
import type { AdminCatalogControl } from './admin-view-model';

test('operator pricing edits replace only the selected model credit pricing', () => {
  const catalog = {
    models: [
      {
        creditPricing: {
          'image.generate': {
            creditCost: 5,
            failureRefundsCredits: true,
          },
        },
        id: 'image-model',
      },
      { id: 'video-model' },
    ],
  };

  const updated = replaceCatalogModelCreditPricing(catalog, 'video-model', {
    'video.generate': {
      creditCost: 50,
      failureRefundsCredits: false,
      videoCreditCosts: { '15': 50, '30': 90, '60': 160 },
    },
  });

  assert.deepEqual(updated.models[0], catalog.models[0]);
  assert.deepEqual(updated.models[1], {
    creditPricing: {
      'video.generate': {
        creditCost: 50,
        failureRefundsCredits: false,
        videoCreditCosts: { '15': 50, '30': 90, '60': 160 },
      },
    },
    id: 'video-model',
  });
  assert.deepEqual(catalog.models[1], { id: 'video-model' });
});

test('renders customer credit controls for reference transforms and video duration prices only', () => {
  const catalog = {
    models: [
      {
        creditPricing: {
          'image.edit': { creditCost: 5, failureRefundsCredits: true },
          'image.reference_transform': {
            creditCost: 5,
            failureRefundsCredits: true,
          },
          'video.generate': {
            creditCost: 50,
            failureRefundsCredits: false,
            videoCreditCosts: { '15': 50, '30': 90, '60': 160 },
          },
        },
        displayName: 'Media Studio',
        id: 'media-studio',
        operations: ['image.edit', 'video.generate'],
      },
    ],
  } as unknown as AdminCatalogControl['catalog'];

  const html = renderToStaticMarkup(
    <AdminModelCreditPricingControl
      busy={false}
      catalog={catalog}
      onCreateDraft={async () => undefined}
    />
  );

  assert.match(html, /模型积分定价/u);
  assert.match(
    html,
    /data-testid="model-credit-pricing-media-studio-image.reference_transform"/u
  );
  assert.match(html, /name="media-studio:video.generate:15"/u);
  assert.match(html, /name="media-studio:video.generate:30"/u);
  assert.match(html, /name="media-studio:video.generate:60"/u);
  assert.doesNotMatch(html, /name="[^"]*(?:token|provider|amountMicros)/u);
});

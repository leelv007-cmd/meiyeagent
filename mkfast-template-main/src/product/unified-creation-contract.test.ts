import assert from 'node:assert/strict';
import test from 'node:test';

import type { CatalogModelView } from '@/p1/settings-view-model';

import {
  creativeQuoteRevision,
  defaultAspectRatioForOperation,
  merchantUsageQuoteLabel,
  quoteFor,
} from './creative-quote';

const pricedModel = {
  unitPrice: {
    amountMicros: 125_000,
    currency: 'USD',
    revision: 'price-v3',
    unit: 'generation',
  },
} as CatalogModelView;

test('keeps the copy quote byte-compatible with the Core contract', () => {
  const quote = quoteFor('copy.generate', pricedModel, '3:4');

  assert.equal(quote.outputCount, 3);
  assert.equal(quote.outputLabel, '3 条内容候选');
  assert.equal(quote.estimatedAmount, 0.375);
  assert.equal(quote.currency, 'USD');
  assert.equal(
    creativeQuoteRevision({
      aspectRatio: '3:4',
      catalogModelId: 'copy-model-a',
      catalogRevision: 'catalog-v8',
      operation: 'copy.generate',
      priceRevision: 'price-v3',
    }),
    'catalog-v8:price-v3:copy-model-a:copy.generate:text'
  );
});

test('merchant quote label uses product allowance language, never provider currency', () => {
  for (const operation of [
    'copy.generate',
    'image.generate',
    'video.generate',
  ] as const) {
    const label = merchantUsageQuoteLabel(operation);
    assert.match(label, /消耗|Uses|allowance|额度/u);
    assert.doesNotMatch(label, /\$|USD|CNY|US\$|€|¥/u);
  }
  assert.match(merchantUsageQuoteLabel('copy.generate'), /文案|copy/iu);
  assert.match(merchantUsageQuoteLabel('image.generate'), /图片|image/iu);
  assert.match(merchantUsageQuoteLabel('video.generate'), /视频|video/iu);
});

test('keeps media aspect ratio in the Core quote revision', () => {
  assert.equal(
    creativeQuoteRevision({
      aspectRatio: '9:16',
      catalogModelId: 'video-model-a',
      catalogRevision: 'catalog-v8',
      operation: 'video.generate',
      priceRevision: 'price-v4',
    }),
    'catalog-v8:price-v4:video-model-a:video.generate:9:16'
  );
});

test('selecting a media operation starts from its documented aspect ratio', () => {
  assert.equal(defaultAspectRatioForOperation('image.generate'), '3:4');
  assert.equal(defaultAspectRatioForOperation('video.generate'), '9:16');
  assert.equal(defaultAspectRatioForOperation('copy.generate'), undefined);
});

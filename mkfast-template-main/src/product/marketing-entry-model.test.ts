import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeMarketingCapability,
  marketingEntryContext,
  releasedMarketingEntries,
  secondaryScenesForEntry,
  type MarketingEntryCapability,
} from '@/product/marketing-entry-model';

test('fails every marketing entry closed until the complete package contract is evidenced', () => {
  const complete = completeMarketingCapability();

  for (const field of Object.keys(complete) as Array<
    keyof MarketingEntryCapability
  >) {
    const incomplete = { ...complete, [field]: false };
    assert.deepEqual(
      releasedMarketingEntries({ project_exposure: incomplete }),
      []
    );
  }
});

test('releases only categories with the complete D-023 capability contract', () => {
  assert.deepEqual(
    releasedMarketingEntries({
      project_exposure: completeMarketingCapability(),
      promotion_conversion: {
        ...completeMarketingCapability(),
        publishExport: false,
      },
    }),
    ['project_exposure']
  );
});

test('switches one composer context without navigation or form state', () => {
  assert.deepEqual(marketingEntryContext('promotion_conversion'), {
    entryId: 'promotion_conversion',
    intent:
      '为本店当前促销或团购制作一套可发布内容，只使用已核验的价格、权益和有效期，并给出预约、买券或到店行动。',
    presetFamilies: ['price_card', 'package_explainer'],
  });
});

test('keeps legacy scenes secondary to their released parent category', () => {
  assert.deepEqual(secondaryScenesForEntry('promotion_conversion'), [
    'promotion-nail',
  ]);
  assert.deepEqual(secondaryScenesForEntry('hot_topic'), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { contentCount } from './content-count';

test('counts every ContentPackage and only unmigrated legacy content', () => {
  assert.equal(
    contentCount(
      [
        { id: 'product-a', sourceType: 'product_content_item' },
        { id: 'creative-a', sourceType: 'creative_content' },
        { id: 'product-b', sourceType: 'product_content_item' },
      ],
      [
        {
          legacySource: {
            mappingConfidence: 'exact',
            sourceId: 'product-a',
            sourceType: 'product_content_item',
          },
        },
        {
          legacySource: {
            mappingConfidence: 'exact',
            sourceId: 'creative-a',
            sourceType: 'creative_content',
          },
        },
        { legacySource: undefined },
      ]
    ),
    4
  );
});

test('keeps equal legacy ids distinct across source types', () => {
  assert.equal(
    contentCount(
      [
        { id: 'shared-id', sourceType: 'product_content_item' },
        { id: 'shared-id', sourceType: 'creative_content' },
      ],
      [
        {
          legacySource: {
            mappingConfidence: 'partial',
            sourceId: 'shared-id',
            sourceType: 'product_content_item',
          },
        },
      ]
    ),
    2
  );
});

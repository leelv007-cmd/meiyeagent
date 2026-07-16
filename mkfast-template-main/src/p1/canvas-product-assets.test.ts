import assert from 'node:assert/strict';
import test from 'node:test';

import type { Asset } from '@meiye/contracts';

import {
  canvasImageAssetIds,
  productAssetsToCanvasLibrary,
  withCanvasAssetProvenance,
} from './canvas-product-assets';

const asset = (overrides: Partial<Asset>): Asset => ({
  aigcStatus: 'not_ai',
  authorizationStatus: 'pending',
  consentScope: 'internal_only',
  containsPerson: false,
  containsSensitiveData: false,
  createdAt: '2026-07-11T00:00:00.000Z',
  id: 'asset-image',
  mediaType: 'image',
  minorStatus: 'none',
  objectKey: 'workspace-a/assets/store.png',
  replacementRequired: false,
  rightsOwner: '测试门店',
  sourceType: 'real',
  tags: ['门店外景'],
  ...overrides,
});

test('maps every real Product image into the canvas library without authorization gating', () => {
  const assets = productAssetsToCanvasLibrary([
    asset({ authorizationStatus: 'pending' }),
    asset({
      authorizationStatus: 'withdrawn',
      id: 'asset-withdrawn',
      objectKey: 'workspace-a/assets/withdrawn image.png',
      tags: [],
    }),
    asset({ id: 'asset-video', mediaType: 'video' }),
  ]);

  assert.deepEqual(
    assets.map((item) => [item.id, item.authorizationStatus]),
    [
      ['asset-image', 'pending'],
      ['asset-withdrawn', 'withdrawn'],
    ]
  );
  assert.equal(
    assets[1]?.src,
    '/api/storage/file?key=workspace-a%2Fassets%2Fwithdrawn%20image.png'
  );
});

test('keeps Product asset provenance across current and historical document shapes', () => {
  const historicalElement = withCanvasAssetProvenance({
    assetId: 'asset-image',
    src: '/api/storage/file?key=image',
    type: 'image',
  });

  assert.equal(
    (historicalElement.custom as Record<string, unknown>).productAssetId,
    'asset-image'
  );
  assert.deepEqual(
    canvasImageAssetIds({
      pages: [{ children: [historicalElement] }],
    }),
    ['asset-image']
  );
  assert.deepEqual(
    canvasImageAssetIds({
      pages: [
        {
          elements: [
            {
              custom: { productAssetId: 'asset-image' },
              kind: 'image',
            },
          ],
        },
      ],
    }),
    ['asset-image']
  );
});

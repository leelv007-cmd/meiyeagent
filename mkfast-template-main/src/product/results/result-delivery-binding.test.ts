import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ContentPackageVersion,
  PublicContentPackage,
} from '@meiye/contracts';

import { resolveResultDeliveryBinding } from './result-delivery-binding';

function version(id: string, orderedAssetIds: string[]): ContentPackageVersion {
  return {
    body: `${id} body`,
    createdAt: '2026-08-02T00:00:00.000Z',
    id,
    orderedAssetIds,
    source: 'ai_generated',
    title: `${id} title`,
    topics: [],
  };
}

function packageFixture(
  overrides: Partial<PublicContentPackage> = {}
): PublicContentPackage {
  return {
    currentVersionId: 'base-v1',
    generated: {
      assetIds: [],
      childRuns: [],
      ownedAssets: [
        {
          contentType: 'image/jpeg',
          id: 'base-asset',
          objectKey: 'objects/base.jpg',
          sha256: 'a'.repeat(64),
        },
        {
          contentType: 'image/jpeg',
          id: 'xhs-current-asset',
          objectKey: 'objects/xhs-current.jpg',
          sha256: 'b'.repeat(64),
        },
        {
          contentType: 'image/jpeg',
          id: 'xhs-history-asset',
          objectKey: 'objects/xhs-history.jpg',
          sha256: 'c'.repeat(64),
        },
        {
          contentType: 'image/jpeg',
          id: 'douyin-asset',
          objectKey: 'objects/douyin.jpg',
          sha256: 'd'.repeat(64),
        },
      ],
    },
    legacySource: undefined,
    source: { assetIds: [], targetPlatform: 'xiaohongshu' },
    variants: [
      {
        currentVersionId: 'xhs-v2',
        id: 'xhs-variant',
        platform: 'xiaohongshu',
        versions: [
          version('xhs-v1', ['xhs-history-asset']),
          version('xhs-v2', ['xhs-current-asset']),
        ],
      },
      {
        currentVersionId: 'douyin-v1',
        id: 'douyin-variant',
        platform: 'douyin',
        versions: [version('douyin-v1', ['douyin-asset'])],
      },
    ],
    versions: [version('base-v1', ['base-asset'])],
    ...overrides,
  } as PublicContentPackage;
}

describe('Result delivery binding', () => {
  it('uses the durable XHS current variant and its ordered assets when mutable intent says Douyin or Moments', () => {
    for (const inferredTarget of ['douyin', 'wechat_moments'] as const) {
      const binding = resolveResultDeliveryBinding(
        packageFixture(),
        inferredTarget
      );

      assert.equal(binding.canonicalPlatform, 'xiaohongshu');
      assert.equal(binding.panelTarget, 'xiaohongshu');
      assert.equal(binding.scopePlatform, 'xiaohongshu');
      assert.equal(binding.currentVersion?.id, 'xhs-v2');
      assert.deepEqual(binding.currentVersion?.orderedAssetIds, [
        'xhs-current-asset',
      ]);
      assert.deepEqual(
        binding.orderedOwnedAssets.map((asset) => asset.objectKey),
        ['objects/xhs-current.jpg']
      );
    }
  });

  it('binds a non-legacy package without targetPlatform to package current and never infers a platform scope', () => {
    const contentPackage = packageFixture({
      source: { assetIds: [] },
    });

    const binding = resolveResultDeliveryBinding(contentPackage, 'douyin');

    assert.equal(binding.canonicalPlatform, null);
    assert.equal(binding.panelTarget, null);
    assert.equal(binding.scopePlatform, undefined);
    assert.equal(binding.currentVersion?.id, 'base-v1');
    assert.deepEqual(binding.currentVersion?.orderedAssetIds, ['base-asset']);
    assert.deepEqual(
      binding.orderedOwnedAssets.map((asset) => asset.objectKey),
      ['objects/base.jpg']
    );
  });

  it('keeps the modern Moments panel on package current without inventing a platform scope', () => {
    const contentPackage = packageFixture({
      source: { assetIds: [] },
    });

    const binding = resolveResultDeliveryBinding(
      contentPackage,
      'wechat_moments'
    );

    assert.equal(binding.canonicalPlatform, null);
    assert.equal(binding.panelTarget, 'wechat_moments');
    assert.equal(binding.scopePlatform, undefined);
    assert.equal(binding.currentVersion?.id, 'base-v1');
    assert.deepEqual(binding.currentVersion?.orderedAssetIds, ['base-asset']);
    assert.deepEqual(
      binding.orderedOwnedAssets.map((asset) => asset.objectKey),
      ['objects/base.jpg']
    );
  });

  it('fails closed when a durable target has no matching variant', () => {
    const binding = resolveResultDeliveryBinding(
      packageFixture({ variants: [] }),
      'douyin'
    );

    assert.equal(binding.canonicalPlatform, 'xiaohongshu');
    assert.equal(binding.scopePlatform, 'xiaohongshu');
    assert.equal(binding.variant, undefined);
    assert.equal(binding.currentVersion, undefined);
    assert.equal(binding.panelTarget, null);
    assert.deepEqual(binding.orderedOwnedAssets, []);
  });

  it('fails closed when the durable variant currentVersionId is dangling', () => {
    const contentPackage = packageFixture();
    const xhsVariant = contentPackage.variants.find(
      (candidate) => candidate.platform === 'xiaohongshu'
    );
    assert.ok(xhsVariant);
    xhsVariant.currentVersionId = 'xhs-missing';

    const binding = resolveResultDeliveryBinding(contentPackage, 'douyin');

    assert.equal(binding.canonicalPlatform, 'xiaohongshu');
    assert.equal(binding.scopePlatform, 'xiaohongshu');
    assert.equal(binding.variant?.id, 'xhs-variant');
    assert.equal(binding.currentVersion, undefined);
    assert.equal(binding.panelTarget, null);
    assert.deepEqual(binding.orderedOwnedAssets, []);
  });

  it('allows mutable intent fallback only for an explicit legacy source', () => {
    const contentPackage = packageFixture({
      legacySource: {
        mappingConfidence: 'exact',
        sourceId: 'legacy-content-1',
        sourceType: 'product_content_item',
      },
      source: { assetIds: [] },
    });

    const binding = resolveResultDeliveryBinding(contentPackage, 'douyin');

    assert.equal(binding.canonicalPlatform, 'douyin');
    assert.equal(binding.panelTarget, 'douyin');
    assert.equal(binding.scopePlatform, 'douyin');
    assert.equal(binding.currentVersion?.id, 'douyin-v1');
    assert.deepEqual(
      binding.orderedOwnedAssets.map((asset) => asset.objectKey),
      ['objects/douyin.jpg']
    );
  });
});

import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ProductContentPackageRightsResolver } from './product-package-rights-adapter.js';

it('resolves current Product authorization without requiring propagation into ContentPackage', async () => {
  const resolver = new ProductContentPackageRightsResolver({
    async load(workspaceId) {
      assert.equal(workspaceId, 'workspace-rights');
      return {
        assets: [
          {
            authorizationStatus: 'authorized',
            consentScope: 'public_marketing',
            id: 'asset-authorized',
            rightsEvidence: 'merchant-release.pdf',
            sourceType: 'real',
          },
          {
            authorizationStatus: 'withdrawn',
            consentScope: 'public_marketing',
            id: 'asset-withdrawn',
            rightsEvidence: 'merchant-release.pdf',
            sourceType: 'real',
          },
          {
            authorizationStatus: 'authorized',
            consentScope: 'public_marketing',
            id: 'asset-missing-evidence',
            sourceType: 'real',
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await resolver.resolve({
      assetIds: [
        'asset-authorized',
        'asset-withdrawn',
        'asset-missing-evidence',
        'owned-output',
      ],
      workspaceId: 'workspace-rights',
    }),
    {
      knownAssetIds: [
        'asset-authorized',
        'asset-withdrawn',
        'asset-missing-evidence',
      ],
      unauthorizedAssetIds: ['asset-withdrawn', 'asset-missing-evidence'],
    }
  );
});

it('rejects an expired restricted-asset authorization during live resolution', async () => {
  const resolver = new ProductContentPackageRightsResolver(
    {
      async load() {
        return {
          assets: [
            {
              authorizationStatus: 'authorized',
              consentScope: 'public_marketing',
              containsPerson: true,
              id: 'asset-expired',
              rightsEvidence: 'merchant-release.pdf',
              rightsPlatforms: ['douyin'],
              rightsValidUntil: '2026-07-22T09:59:59.000Z',
              sourceType: 'real',
            },
          ],
        };
      },
    },
    () => new Date('2026-07-22T10:00:00.000Z'),
  );

  assert.deepEqual(
    await resolver.resolve({
      assetIds: ['asset-expired'],
      workspaceId: 'workspace-rights',
    }),
    {
      knownAssetIds: ['asset-expired'],
      unauthorizedAssetIds: ['asset-expired'],
    },
  );
});

it('rejects an asset whose authorization excludes the export platform', async () => {
  const resolver = new ProductContentPackageRightsResolver({
    async load() {
      return {
        assets: [
          {
            authorizationStatus: 'authorized',
            consentScope: 'public_marketing',
            containsPerson: true,
            id: 'asset-xiaohongshu-only',
            rightsEvidence: 'merchant-release.pdf',
            rightsNoFixedExpiry: true,
            rightsPlatforms: ['xiaohongshu'],
            sourceType: 'real',
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await resolver.resolve({
      assetIds: ['asset-xiaohongshu-only'],
      platform: 'douyin',
      workspaceId: 'workspace-rights',
    }),
    {
      knownAssetIds: ['asset-xiaohongshu-only'],
      unauthorizedAssetIds: ['asset-xiaohongshu-only'],
    },
  );
});

it('exposes precise read-only export policy reasons from the live Product facts', async () => {
  const resolver = new ProductContentPackageRightsResolver(
    {
      async load() {
        return {
          assets: [
            {
              authorizationStatus: 'withdrawn',
              consentScope: 'public_marketing',
              id: 'asset-revoked',
              rightsEvidence: 'release.pdf',
              sourceType: 'real',
            },
            {
              authorizationStatus: 'authorized',
              consentScope: 'internal_only',
              id: 'asset-private',
              rightsEvidence: 'release.pdf',
              sourceType: 'real',
            },
            {
              authorizationStatus: 'authorized',
              consentScope: 'public_marketing',
              containsPerson: true,
              id: 'asset-expired',
              rightsEvidence: 'release.pdf',
              rightsPlatforms: ['douyin'],
              rightsValidUntil: '2026-07-22T09:59:59.000Z',
              sourceType: 'real',
            },
          ],
        };
      },
    },
    () => new Date('2026-07-22T10:00:00.000Z')
  );

  assert.deepEqual(
    await Promise.all(
      ['asset-revoked', 'asset-private', 'asset-expired', 'asset-missing'].map(
        (assetId) =>
          resolver.resolveExportPolicy({
            assetId,
            workspaceId: 'workspace-rights',
          })
      )
    ),
    [
      { kind: 'unavailable', reason: 'revoked' },
      { kind: 'unavailable', reason: 'private_retrieval_denied' },
      { kind: 'unavailable', reason: 'expired' },
      { kind: 'unknown' },
    ]
  );
});

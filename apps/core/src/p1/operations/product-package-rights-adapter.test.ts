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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductCommand } from '@meiye/contracts';
import { DomainError, ProductService } from './product-service.js';
import { MemoryProductRepository } from './repository.js';

const merchant = {
  actor: 'user' as const,
  correlationId: 'corr-v31-87',
  userId: 'user-a',
  workspaceId: 'workspace-a',
};

const SHARED_OBJECT_KEY = 'workspace-a/assets/user-a/case.png';

function addAssetCommand(
  overrides: Partial<Extract<ProductCommand, { type: 'add_asset' }>['asset']>
): Extract<ProductCommand, { type: 'add_asset' }> {
  return {
    type: 'add_asset',
    asset: {
      category: 'other',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      id: 'asset-page-random',
      mediaType: 'image',
      minorStatus: 'none',
      objectKey: SHARED_OBJECT_KEY,
      rightsOwner: '暮色美甲',
      sourceType: 'real',
      tags: [],
      ...overrides,
    },
  };
}

function serviceWithMembership() {
  const repository = new MemoryProductRepository();
  repository.grantMembership(merchant.userId, merchant.workspaceId);
  return new ProductService({ repository });
}

describe('V31-87 same-content asset reupload', () => {
  it('replays the same add_asset key and payload without inserting another row', async () => {
    const service = serviceWithMembership();
    const command = addAssetCommand({ id: 'asset-same' });
    const first = await service.execute(merchant, command, 'asset-register:same');
    const replay = await service.execute(merchant, command, 'asset-register:same');

    assert.equal(first.state.assets.length, 1);
    assert.equal(replay.state.assets.length, 1);
    assert.equal(replay.state.assets[0]?.id, 'asset-same');
  });

  it('still rejects the same key when the add_asset payload changes', async () => {
    const service = serviceWithMembership();
    const first = addAssetCommand({ category: 'other', id: 'asset-fence' });
    await service.execute(merchant, first, 'asset-register:fence');

    await assert.rejects(
      service.execute(
        merchant,
        addAssetCommand({
          category: 'customer_case',
          id: 'asset-fence',
          rightsOwner: '另一权利人',
        }),
        'asset-register:fence'
      ),
      (error: unknown) =>
        error instanceof DomainError && error.code === 'IDEMPOTENCY_CONFLICT'
    );

    const state = await service.bootstrap(merchant);
    assert.equal(state.assets.length, 1);
    assert.equal(state.assets[0]?.category, 'other');
    assert.equal(state.assets[0]?.rightsOwner, '暮色美甲');
  });

  it('reuses the existing objectKey instead of inserting a second asset', async () => {
    const service = serviceWithMembership();
    await service.execute(
      merchant,
      addAssetCommand({ category: 'other', id: 'asset-from-library' }),
      'asset-register:library'
    );

    const reused = await service.execute(
      merchant,
      addAssetCommand({
        category: 'other',
        id: 'asset-from-composer',
        tags: ['case.png'],
      }),
      'asset-register:composer-same-facts'
    );

    assert.equal(reused.state.assets.length, 1);
    assert.equal(reused.state.assets[0]?.id, 'asset-from-library');
    assert.deepEqual(reused.state.assets[0]?.tags, ['case.png']);
  });

  it('applies later registration facts onto the reused asset', async () => {
    const service = serviceWithMembership();
    await service.execute(
      merchant,
      addAssetCommand({
        category: 'other',
        id: 'asset-from-library',
        rightsOwner: '暮色美甲',
      }),
      'asset-register:library-first'
    );

    const updated = await service.execute(
      merchant,
      addAssetCommand({
        category: 'customer_case',
        id: 'asset-from-composer',
        rightsOwner: '顾客本人',
        tags: ['case.png'],
      }),
      'asset-register:composer-changed-facts'
    );

    assert.equal(updated.state.assets.length, 1);
    assert.equal(updated.state.assets[0]?.id, 'asset-from-library');
    assert.equal(updated.state.assets[0]?.category, 'customer_case');
    assert.equal(updated.state.assets[0]?.rightsOwner, '顾客本人');
    assert.deepEqual(updated.state.assets[0]?.tags, ['case.png']);
  });

  it('does not revoke an existing public authorization when add_asset retries as internal_only', async () => {
    const service = serviceWithMembership();
    await service.execute(
      merchant,
      addAssetCommand({ id: 'asset-from-library' }),
      'asset-register:library-auth'
    );
    await service.execute(
      merchant,
      {
        type: 'authorize_asset',
        assetId: 'asset-from-library',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-library',
        rightsNoFixedExpiry: true,
        rightsPlatforms: ['xiaohongshu'],
      },
      'asset-authorize:library'
    );

    const reused = await service.execute(
      merchant,
      addAssetCommand({
        category: 'customer_case',
        consentScope: 'internal_only',
        id: 'asset-from-composer',
      }),
      'asset-register:composer-after-auth'
    );

    assert.equal(reused.state.assets.length, 1);
    assert.equal(reused.state.assets[0]?.consentScope, 'public_marketing');
    assert.equal(reused.state.assets[0]?.authorizationStatus, 'authorized');
    assert.equal(reused.state.assets[0]?.category, 'customer_case');
  });
});

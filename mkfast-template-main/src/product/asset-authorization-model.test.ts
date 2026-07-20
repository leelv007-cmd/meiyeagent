import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assetAuthorizationCommands,
  executeAssetAuthorization,
  systemInlineAuthEvidence,
} from '@/product/asset-authorization-model';

test('authorization writes current metadata before the matching rights command', async () => {
  const executed: unknown[] = [];
  const draft = {
    assetId: 'asset-real-1',
    category: 'before_after' as const,
    consentScope: 'public_marketing' as const,
    containsPerson: true,
    containsSensitiveData: false,
    minorStatus: 'none' as const,
    rightsEvidence: 'system:inline-auth:2026-07-19T00:00:00.000Z:test',
    rightsNoFixedExpiry: false,
    rightsOwner: '弥鹿美甲',
    rightsPlatforms: ['xiaohongshu'] as const,
    rightsValidUntil: '2027-07-19T23:59:59.999Z',
    tags: ['门店实拍.jpg'],
  };

  assert.deepEqual(assetAuthorizationCommands(draft), [
    {
      type: 'update_asset_metadata',
      assetId: 'asset-real-1',
      category: 'before_after',
      tags: ['门店实拍.jpg'],
      rightsOwner: '弥鹿美甲',
      containsPerson: true,
      containsSensitiveData: false,
      minorStatus: 'none',
    },
    {
      type: 'authorize_asset',
      assetId: 'asset-real-1',
      consentScope: 'public_marketing',
      rightsEvidence: 'system:inline-auth:2026-07-19T00:00:00.000Z:test',
      rightsNoFixedExpiry: false,
      rightsPlatforms: ['xiaohongshu'],
      rightsValidUntil: '2027-07-19T23:59:59.999Z',
    },
  ]);

  await executeAssetAuthorization(async (command) => {
    executed.push(command);
  }, draft);
  assert.deepEqual(executed, assetAuthorizationCommands(draft));
});

test('metadata failure prevents authorization against stale asset facts', async () => {
  const commandTypes: string[] = [];
  await assert.rejects(
    executeAssetAuthorization(
      async (command) => {
        commandTypes.push(command.type);
        throw new Error('metadata failed');
      },
      {
        assetId: 'asset-real-1',
        category: 'customer_case',
        consentScope: 'public_marketing',
        containsPerson: true,
        containsSensitiveData: false,
        minorStatus: 'none',
        rightsEvidence: 'owner-consent-1',
        rightsOwner: '弥鹿美甲',
        rightsPlatforms: ['douyin'],
        rightsValidUntil: '2027-07-19T23:59:59.999Z',
        tags: [],
      }
    ),
    /metadata failed/u
  );
  assert.deepEqual(commandTypes, ['update_asset_metadata']);
});

test('shared composer and library seam supplies stable system evidence when external evidence is absent', () => {
  const base = {
    assetId: 'asset-real-1',
    category: 'store' as const,
    consentScope: 'public_marketing' as const,
    containsPerson: false,
    containsSensitiveData: false,
    minorStatus: 'none' as const,
    rightsOwner: '弥鹿美甲',
    tags: [] as string[],
  };
  const library = assetAuthorizationCommands({
    ...base,
    systemEvidence: { context: 'asset-library', nonce: 'asset-real-1' },
  });
  assert.equal(
    library[1].rightsEvidence,
    'system:inline-auth:asset-library:asset-real-1'
  );
  assert.equal(
    assetAuthorizationCommands({
      ...base,
      systemEvidence: { context: 'asset-library', nonce: 'asset-real-1' },
    })[1].rightsEvidence,
    library[1].rightsEvidence
  );
  assert.notEqual(
    systemInlineAuthEvidence({ context: 'composer', nonce: 'asset-real-1' }),
    library[1].rightsEvidence
  );
  assert.throws(() => assetAuthorizationCommands(base), /system evidence/u);
});

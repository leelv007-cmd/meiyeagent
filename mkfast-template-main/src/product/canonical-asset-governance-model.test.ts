import assert from 'node:assert/strict';
import test from 'node:test';

import type { Asset } from '@meiye/contracts';

import {
  assetAuthorizationPresentation,
  isContentPackageEligibleAsset,
} from './canonical-asset-governance-model';

function realAsset(rightsEvidence?: string): Asset {
  return {
    aigcStatus: 'not_ai',
    authorizationStatus: 'authorized',
    category: 'store',
    consentScope: 'public_marketing',
    containsPerson: false,
    containsSensitiveData: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    id: 'asset-rights-repair',
    mediaType: 'image',
    minorStatus: 'none',
    objectKey: 'workspace-a/assets/rights-repair.png',
    replacementRequired: false,
    rightsEvidence,
    rightsOwner: '暮色美甲',
    sourceType: 'real',
    tags: [],
  };
}

test('authorized real assets without evidence are presented as pending and repairable', () => {
  assert.deepEqual(assetAuthorizationPresentation(realAsset()), {
    action: 'authorize',
    status: 'pending',
  });
});

test('authorized real assets with evidence stay usable and allow evidence updates', () => {
  assert.deepEqual(
    assetAuthorizationPresentation(realAsset('owner-consent-archive-003')),
    {
      action: 'update_evidence',
      status: 'authorized',
    }
  );
});

test('internal-only real assets are not presented as publicly usable', () => {
  assert.deepEqual(
    assetAuthorizationPresentation({
      ...realAsset('owner-consent-archive-003'),
      consentScope: 'internal_only',
    }),
    {
      action: 'authorize',
      status: 'pending',
    }
  );
});

test('ContentPackage eligibility matches the provider and export rights gate', () => {
  const eligible = realAsset('owner-consent-archive-003');
  assert.equal(isContentPackageEligibleAsset(eligible), true);
  assert.equal(
    isContentPackageEligibleAsset({
      ...eligible,
      consentScope: 'internal_only',
    }),
    false
  );
  assert.equal(
    isContentPackageEligibleAsset({ ...eligible, sourceType: 'ai_generated' }),
    false
  );
  assert.equal(isContentPackageEligibleAsset(realAsset()), false);
});

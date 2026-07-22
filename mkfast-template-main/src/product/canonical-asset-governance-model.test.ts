import assert from 'node:assert/strict';
import test from 'node:test';

import type { Asset, ContentPackage } from '@meiye/contracts';

import {
  applyBulkAssetTags,
  assetAuthorizationPresentation,
  assetBusinessTitle,
  assetGovernanceMetadataVersion,
  assetLibraryAvailability,
  assetReplacementImpact,
  filterAssetLibrary,
  hasDurableAssetReceipt,
  isContentPackageEligibleAsset,
  isUsableLibraryAsset,
  projectAssetGovernanceCard,
  resolveAssetBusinessTitle,
  safeAssetReplacementPlan,
} from './canonical-asset-governance-model';

function realAsset(
  rightsEvidence?: string,
  overrides: Partial<Asset> = {}
): Asset {
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
    ...overrides,
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

test('restricted public assets stay pending when platform or validity evidence is missing or expired', () => {
  const restricted: Asset = {
    ...realAsset('consent/archive-2026-0718'),
    category: 'before_after' as const,
    containsPerson: true,
    rightsNoFixedExpiry: false,
    rightsPlatforms: ['xiaohongshu'],
    rightsValidUntil: '2026-07-17T23:59:59.999Z',
  };
  const at = new Date('2026-07-18T00:00:00.000Z');

  assert.equal(isContentPackageEligibleAsset(restricted, at), false);
  assert.deepEqual(assetAuthorizationPresentation(restricted, at), {
    action: 'authorize',
    status: 'pending',
  });
  assert.equal(
    isContentPackageEligibleAsset(
      { ...restricted, rightsNoFixedExpiry: true, rightsValidUntil: undefined },
      at
    ),
    true
  );
});

test('only durable receipt assets enter the usable library; temporary and failed stay out', () => {
  const durable = realAsset('evidence-1');
  assert.equal(hasDurableAssetReceipt(durable), true);
  assert.equal(isUsableLibraryAsset(durable), true);

  assert.equal(
    assetLibraryAvailability({
      ...durable,
      objectKey: 'https://cdn.example/temp.png',
    }),
    'temporary'
  );
  assert.equal(
    isUsableLibraryAsset({
      ...durable,
      objectKey: '',
      temporaryUrl: 'https://cdn.example/preview',
    }),
    false
  );
  assert.equal(
    assetLibraryAvailability({
      ...durable,
      processingStatus: 'processing',
    }),
    'processing'
  );
  assert.equal(
    assetLibraryAvailability({
      ...durable,
      processingStatus: 'failed',
    }),
    'failed'
  );
  assert.equal(
    isUsableLibraryAsset({
      ...durable,
      processingStatus: 'failed',
    }),
    false
  );
});

test('business titles prefer Chinese labels and reject internal English candidate names', () => {
  assert.equal(
    assetBusinessTitle({
      ...realAsset(),
      tags: ['generated_candidate_01', '店招夜景'],
    }),
    '店招夜景'
  );
  assert.equal(
    assetBusinessTitle({
      ...realAsset(),
      displayTitle: 'image_output_v3',
      tags: ['asset-temp-9'],
    }),
    undefined
  );
  assert.equal(
    resolveAssetBusinessTitle({
      ...realAsset(),
      displayTitle: 'image_output_v3',
      tags: ['asset-temp-9'],
    }),
    '暮色美甲 · 门店素材'
  );
  assert.equal(
    resolveAssetBusinessTitle({
      mediaType: 'video',
      rightsOwner: '',
      tags: [],
    }),
    '视频素材'
  );
});

test('filters cover type, source, rights, tags, platform, project/IP and workspace isolation', () => {
  const cards = [
    projectAssetGovernanceCard({
      ...realAsset('e1', {
        id: 'asset-a',
        tags: ['店招'],
        rightsPlatforms: ['xiaohongshu'],
      }),
      projectLabels: ['美甲项目'],
      ipLabels: ['主理人小鹿'],
      workspaceId: 'workspace-a',
    }),
    projectAssetGovernanceCard({
      ...realAsset('e2', {
        id: 'asset-b',
        mediaType: 'video',
        sourceType: 'ai_generated',
        authorizationStatus: 'withdrawn',
        tags: ['口播'],
        rightsPlatforms: ['douyin'],
      }),
      workspaceId: 'workspace-b',
    }),
  ];

  assert.equal(
    filterAssetLibrary(cards, { workspaceId: 'workspace-a' }).map((c) => c.id)
      .length,
    1
  );
  assert.equal(
    filterAssetLibrary(cards, { mediaType: 'video' })[0]?.id,
    'asset-b'
  );
  assert.equal(
    filterAssetLibrary(cards, { sourceType: 'real' })[0]?.id,
    'asset-a'
  );
  assert.equal(
    filterAssetLibrary(cards, { rightsStatus: 'withdrawn' })[0]?.id,
    'asset-b'
  );
  assert.equal(
    filterAssetLibrary(cards, { platform: 'xiaohongshu' })[0]?.id,
    'asset-a'
  );
  assert.equal(filterAssetLibrary(cards, { tag: '店招' })[0]?.id, 'asset-a');
  assert.equal(
    filterAssetLibrary(cards, { project: '美甲' })[0]?.id,
    'asset-a'
  );
  assert.equal(filterAssetLibrary(cards, { ip: '小鹿' })[0]?.id, 'asset-a');
  assert.equal(filterAssetLibrary(cards, { query: '口播' })[0]?.id, 'asset-b');
  assert.deepEqual(filterAssetLibrary(cards, { query: '不存在' }), []);
});

test('revoke impact lists referencing packages and blocks generation/delivery', () => {
  const packages = [
    {
      id: 'package-1',
      status: 'needs_replacement',
      rights: { state: 'revoked', revokedAt: '2026-07-21T00:00:00.000Z' },
      source: { assetIds: ['asset-rights-repair'] },
      generated: { assetIds: [], childRuns: [] },
      versions: [
        {
          body: 'x',
          createdAt: '2026-07-20T00:00:00.000Z',
          id: 'v1',
          orderedAssetIds: ['asset-rights-repair'],
          title: 't',
          topics: [],
        },
      ],
    },
    {
      id: 'package-2',
      status: 'accepted',
      rights: { state: 'authorized' },
      source: { assetIds: ['other'] },
      generated: { assetIds: ['other'], childRuns: [] },
      versions: [
        {
          body: 'y',
          createdAt: '2026-07-20T00:00:00.000Z',
          id: 'v2',
          orderedAssetIds: ['other'],
          title: 't2',
          topics: [],
        },
      ],
    },
  ] as unknown as ContentPackage[];

  const impact = assetReplacementImpact(
    'asset-rights-repair',
    packages,
    realAsset('e', {
      replacementRequired: true,
      authorizationStatus: 'withdrawn',
    })
  );
  assert.equal(impact.affectedPackageCount, 1);
  assert.deepEqual(impact.affectedPackageIds, ['package-1']);
  assert.equal(impact.blocksDelivery, true);
  assert.equal(impact.blocksGeneration, true);
  assert.equal(impact.pendingReplacement, true);
});

test('safe replacement creates a new package revision without rewriting history', () => {
  const plan = safeAssetReplacementPlan({
    assetId: 'asset-old',
    contentPackageId: 'package-1',
    currentRevision: 3,
    historicalReceiptIds: ['receipt-1'],
  });
  assert.equal(plan.newPackageRevision, 4);
  assert.equal(plan.historicalAssetId, 'asset-old');
  assert.deepEqual(plan.historicalReceiptIds, ['receipt-1']);
  assert.equal(plan.rewritesHistory, false);
});

test('bulk tags and governance metadata never copy object binaries', () => {
  const assets = [
    realAsset('e1', { id: 'a1', tags: ['店招'] }),
    realAsset('e2', { id: 'a2', tags: ['价目'] }),
  ];
  const tagged = applyBulkAssetTags(assets, ['a1', 'a2'], ['夏日', '店招']);
  assert.deepEqual(new Set(tagged[0]?.tags), new Set(['店招', '夏日']));
  assert.deepEqual(new Set(tagged[1]?.tags), new Set(['价目', '夏日', '店招']));
  assert.equal(tagged[0]?.objectKey, assets[0]?.objectKey);
  assert.equal(tagged[1]?.objectKey, assets[1]?.objectKey);

  const versioned = assetGovernanceMetadataVersion({
    previousVersion: 2,
    folder: '门店实拍',
    tags: ['店招', '夏日'],
    projectLabels: ['美甲项目'],
    ipLabels: ['主理人'],
    displayTitle: '夜景店招',
  });
  assert.equal(versioned.version, 3);
  assert.equal(versioned.copiesObject, false);
  assert.equal(versioned.folder, '门店实拍');
  assert.equal(versioned.displayTitle, '夜景店招');
});

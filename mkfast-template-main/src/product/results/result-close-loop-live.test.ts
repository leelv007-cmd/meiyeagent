import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicContentPackage } from '@meiye/contracts';

import type { AssistedReceipt } from './delivery-b3-types';
import { projectResultCloseLoopFacts } from './result-close-loop-live';

function contentPackage(): PublicContentPackage {
  return {
    id: 'package-a',
    workspaceId: 'workspace-a',
    revision: 3,
    currentVersionId: 'version-a',
    variants: [
      {
        id: 'variant-douyin',
        platform: 'douyin',
        currentVersionId: 'douyin-v1',
        versions: [
          {
            id: 'douyin-v1',
            title: '夏日美甲·抖音',
            body: '到店可享夏日美甲套餐',
            conversionHook: '私信预约',
            orderedAssetIds: [],
            createdAt: '2026-07-22T09:00:00.000Z',
          },
        ],
      },
    ],
    versions: [
      {
        id: 'version-a',
        title: '夏日美甲',
        body: '到店可享夏日美甲套餐',
        conversionHook: '私信预约',
      },
    ],
    deliveryEvents: [
      {
        accountDisplayLabel: '花间美甲抖音',
        actorId: 'owner-a',
        id: 'manual-publish-a',
        occurredAt: '2026-07-22T09:30:00.000Z',
        platform: 'douyin',
        source: 'native',
        status: 'published',
        type: 'manual_publish_result',
        variantVersionId: 'douyin-v1',
      },
    ],
    resultSignals: [
      {
        actorId: 'owner-a',
        // Deliberately NOT the package's current revision (3): a signal
        // observes the revision that was live when it happened, and the
        // projection must carry that, not restamp the current one.
        contentPackageRevision: 1,
        id: 'signal-a',
        kind: 'attention',
        occurredAt: '2026-07-22T10:00:00.000Z',
        source: 'merchant_recorded',
      },
      {
        actorId: 'owner-a',
        // Quarantined by the V31-19 backfill: unprovable, so not evidence.
        contentPackageRevision: 'unknown',
        id: 'signal-quarantined',
        kind: 'store_visit',
        occurredAt: '2026-07-22T11:00:00.000Z',
        source: 'merchant_recorded',
      },
    ],
  } as unknown as PublicContentPackage;
}

function assistedReceipt(): AssistedReceipt {
  return {
    id: 'receipt-a',
    packageId: 'package-a',
    workspaceId: 'workspace-a',
    status: 'handed_over',
    binding: {
      accountId: 'account-private',
      approvalReceiptId: 'approval-a',
      contentPackageRevision: 3,
      costRange: { currency: 'CNY', minAmount: 0, maxAmount: 0 },
      packageId: 'package-a',
      platform: 'douyin',
      purpose: 'public_content',
      responsibilityRole: 'self_publish',
      scheduledAt: '2026-07-22T09:00:00.000Z',
      variantVersionId: 'douyin-v1',
      workspaceId: 'workspace-a',
    },
    events: [
      {
        actorId: 'owner-a',
        occurredAt: '2026-07-22T08:50:00.000Z',
        type: 'materials_prepared',
      },
      {
        actorId: 'owner-a',
        occurredAt: '2026-07-22T09:00:00.000Z',
        type: 'handed_over',
      },
    ],
    handoffLink: {
      createdAt: '2026-07-22T09:00:00.000Z',
      expiresAt: '2026-07-25T09:00:00.000Z',
      token: 'handoff-token-123456',
    },
  };
}

test('projects the canonical package into an honest Result close-loop journey', () => {
  const facts = projectResultCloseLoopFacts({
    contentPackage: contentPackage(),
    contentPackages: [contentPackage()],
    assistedReceipts: [assistedReceipt()],
    canShareFiles: false,
    hasDownload: true,
    nowIso: '2026-07-23T12:00:00.000Z',
    preferredPlatform: 'douyin',
  });

  assert.equal(facts.variantVersionId, 'douyin-v1');
  assert.equal(facts.publicationPlatform, 'douyin');
  assert.equal(facts.automaticVerifiedPlatformCount, 0);
  assert.equal(facts.deliveryReceipts.length, 2);
  assert.equal(facts.deliveryReceipts[1]?.kind, 'handed_off');
  assert.equal(
    facts.deliveryReceipts[1]?.binding.accountOrOwnerLabel,
    '本人账号发布'
  );
  assert.equal(
    facts.publicationRecords[0]?.accountDisplayLabel,
    '花间美甲抖音'
  );
  assert.equal(
    facts.publicationRecords[0]?.publishedAt,
    '2026-07-22T09:30:00.000Z'
  );
  assert.equal(facts.observations[0]?.kind, 'attention');
  // V31-19 P1-3: the projection must carry each signal's OWN revision, not
  // restamp the package's current one (3), and must drop the quarantined row
  // instead of laundering `'unknown'` into an exact number that renders bound.
  assert.equal(facts.observations[0]?.contentPackageRevision, 1);
  assert.deepEqual(
    facts.observations.map((row) => row.id),
    ['signal-a']
  );
  assert.equal(facts.weeklyReview.publications.length, 1);
  assert.equal(facts.weeklyReview.observations.length, 1);
  assert.equal(facts.hasOneShotLink, true);
});

test('does not bind a non-platform package to the first variant', () => {
  const unscoped = contentPackage();
  unscoped.variants.push({
    id: 'variant-xiaohongshu',
    platform: 'xiaohongshu',
    currentVersionId: 'xiaohongshu-v1',
    versions: [
      {
        id: 'xiaohongshu-v1',
        title: '夏日美甲·小红书',
        body: '到店可享夏日美甲套餐',
        conversionHook: '私信预约',
        orderedAssetIds: [],
        topics: [],
        createdAt: '2026-07-22T09:00:00.000Z',
      },
    ],
  });
  const facts = projectResultCloseLoopFacts({
    contentPackage: unscoped,
    contentPackages: [unscoped],
    assistedReceipts: [],
    canShareFiles: false,
    hasDownload: true,
    nowIso: '2026-07-23T12:00:00.000Z',
    preferredPlatform: null,
    allowExplicitVariantSelection: true,
  });

  assert.equal(facts.publicationPlatform, undefined);
  assert.equal(facts.variantVersionId, undefined);
  assert.deepEqual(facts.publicationBindings, [
    { platform: 'douyin', variantVersionId: 'douyin-v1' },
    { platform: 'xiaohongshu', variantVersionId: 'xiaohongshu-v1' },
  ]);
});

test('keeps an unscoped non-distribution package closed to publication selection', () => {
  const facts = projectResultCloseLoopFacts({
    contentPackage: contentPackage(),
    contentPackages: [contentPackage()],
    assistedReceipts: [],
    canShareFiles: false,
    hasDownload: false,
    nowIso: '2026-07-23T12:00:00.000Z',
    preferredPlatform: null,
  });

  assert.deepEqual(facts.publicationBindings, []);
  assert.equal(facts.publicationPlatform, undefined);
  assert.equal(facts.variantVersionId, undefined);
});

test('does not expose a dangling variant currentVersionId as a writable publication scope', () => {
  const dangling = contentPackage();
  dangling.variants[0]!.currentVersionId = 'douyin-missing';

  const facts = projectResultCloseLoopFacts({
    contentPackage: dangling,
    contentPackages: [dangling],
    assistedReceipts: [],
    canShareFiles: false,
    hasDownload: false,
    nowIso: '2026-07-23T12:00:00.000Z',
    preferredPlatform: 'douyin',
  });

  assert.equal(facts.publicationPlatform, undefined);
  assert.equal(facts.variantVersionId, undefined);
  assert.deepEqual(facts.publicationBindings, []);
});

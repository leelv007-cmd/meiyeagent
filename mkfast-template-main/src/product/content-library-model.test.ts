import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContentPackage } from '@meiye/contracts';
import {
  contentLibraryActionTarget,
  contentLibraryProjectionIsMerchantSafe,
  filterContentLibrary,
  legacyContentInteraction,
  projectContentLibraryCard,
} from './content-library-model';

function packageFixture(
  overrides: Partial<ContentPackage> &
    Pick<ContentPackage, 'id' | 'status' | 'kind'>
): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-20T08:00:00.000Z',
    currentVersionId: 'version-1',
    exportReceipts: [],
    generated: { assetIds: ['asset-1'], childRuns: [] },
    lineage: {},
    revision: 1,
    rights: { state: 'authorized' },
    source: { assetIds: ['source-1'], workId: 'work-1' },
    updatedAt: '2026-07-21T10:00:00.000Z',
    variants: [
      {
        currentVersionId: 'variant-version-1',
        id: 'variant-xhs',
        platform: 'xiaohongshu',
        versions: [
          {
            body: '到店体验夏日美甲',
            createdAt: '2026-07-20T08:00:00.000Z',
            id: 'variant-version-1',
            orderedAssetIds: ['asset-1'],
            title: '夏日美甲',
            topics: ['#夏日系列'],
          },
        ],
      },
    ],
    versions: [
      {
        body: '到店体验夏日美甲，预约有礼。',
        createdAt: '2026-07-20T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: ['asset-1'],
        title: '夏日美甲新色',
        topics: ['美甲项目', '#夏日系列'],
      },
    ],
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

test('projects merchant card fields with a single next action and Result href', () => {
  const card = projectContentLibraryCard(
    packageFixture({ id: 'package-1', kind: 'image_text', status: 'accepted' })
  );

  assert.equal(card.title, '夏日美甲新色');
  assert.equal(card.statusGroup, 'usable');
  assert.equal(card.statusLabel, '可使用');
  assert.deepEqual(card.platforms, ['xiaohongshu']);
  assert.equal(card.kind, 'image_text');
  assert.ok(card.projectLabels.includes('美甲项目'));
  assert.ok(card.seriesLabels.includes('#夏日系列'));
  assert.equal(card.nextAction.action, 'edit_text');
  assert.equal(card.nextAction.opensResult, true);
  assert.equal(
    card.resultHref,
    '/dashboard/results/work-1?contentId=package-1'
  );
  assert.equal(card.legacyReadOnly, false);
});

test('merchant card serialization never leaks internal provider/prompt/AIDA fields', () => {
  const internal = packageFixture({
    id: 'package-secret',
    kind: 'image_text',
    status: 'review_ready',
  });
  (internal.generated as { childRuns: unknown[] }).childRuns = [
    {
      apiCounterparty: 'provider-secret',
      providerCost: { amount: 1, currency: 'USD', status: 'observed' },
      providerModel: 'secret-model',
      providerAttempts: [{ id: 'attempt-1' }],
      routeSnapshot: { id: 'route-secret' },
      routeSnapshotId: 'route-secret',
      runId: 'run-1',
      runType: 'model_job',
      status: 'succeeded',
    },
  ];

  const card = projectContentLibraryCard(internal);
  assert.equal(contentLibraryProjectionIsMerchantSafe(card), true);
  assert.equal(card.nextAction.action, 'edit_text');
});

test('search and filters return match reasons and empty results without inventing hits', () => {
  const cards = [
    projectContentLibraryCard(
      packageFixture({
        id: 'package-a',
        kind: 'image_text',
        status: 'accepted',
      })
    ),
    projectContentLibraryCard(
      packageFixture({
        id: 'package-b',
        kind: 'video',
        status: 'needs_replacement',
        updatedAt: '2026-07-10T00:00:00.000Z',
        variants: [
          {
            currentVersionId: 'v-dy',
            id: 'variant-dy',
            platform: 'douyin',
            versions: [
              {
                body: '视频口播',
                createdAt: '2026-07-10T00:00:00.000Z',
                id: 'v-dy',
                orderedAssetIds: [],
                title: '门店探店视频',
                topics: [],
              },
            ],
          },
        ],
        versions: [
          {
            body: '视频口播',
            createdAt: '2026-07-10T00:00:00.000Z',
            id: 'version-1',
            orderedAssetIds: [],
            title: '门店探店视频',
            topics: [],
          },
        ],
      })
    ),
  ];

  const byTitle = filterContentLibrary(cards, { query: '夏日美甲' });
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0]?.card.packageId, 'package-a');
  assert.ok(byTitle[0]?.matchReasons.includes('title'));
  assert.ok(byTitle[0]?.matchReasonLabels.includes('标题匹配'));

  const byPlatform = filterContentLibrary(cards, { platform: 'douyin' });
  assert.equal(byPlatform.length, 1);
  assert.equal(byPlatform[0]?.card.packageId, 'package-b');
  assert.ok(byPlatform[0]?.matchReasons.includes('platform'));

  const byStatus = filterContentLibrary(cards, {
    statusGroup: 'needs_attention',
  });
  assert.equal(byStatus.length, 1);
  assert.equal(byStatus[0]?.card.packageId, 'package-b');

  const empty = filterContentLibrary(cards, { query: '不存在的内容XYZ' });
  assert.deepEqual(empty, []);
});

test('legacy interactions stay read-only until explicit adjust or deliver', () => {
  assert.deepEqual(legacyContentInteraction({ kind: 'read' }), {
    createsLegacyAnchor: false,
    mayCallModel: false,
    mayCharge: false,
    mayCreateRevision: false,
    readOnly: true,
  });
  assert.deepEqual(legacyContentInteraction({ kind: 'search' }), {
    createsLegacyAnchor: false,
    mayCallModel: false,
    mayCharge: false,
    mayCreateRevision: false,
    readOnly: true,
  });
  assert.deepEqual(legacyContentInteraction({ kind: 'adjust' }), {
    createsLegacyAnchor: true,
    mayCallModel: false,
    mayCharge: false,
    mayCreateRevision: false,
    readOnly: false,
  });
  assert.deepEqual(legacyContentInteraction({ kind: 'deliver' }), {
    createsLegacyAnchor: true,
    mayCallModel: false,
    mayCharge: false,
    mayCreateRevision: false,
    readOnly: false,
  });
});

test('library actions open Result adapter when work is known', () => {
  const card = projectContentLibraryCard(
    packageFixture({ id: 'package-1', kind: 'image_text', status: 'accepted' })
  );
  assert.deepEqual(contentLibraryActionTarget(card), {
    kind: 'result_adapter',
    href: '/dashboard/results/work-1?contentId=package-1',
  });

  const legacy = projectContentLibraryCard(
    packageFixture({
      id: 'legacy-1',
      kind: 'image_text',
      status: 'accepted',
      legacySource: {
        mappingConfidence: 'exact',
        sourceId: 'content-old',
        sourceType: 'product_content_item',
      },
      source: { assetIds: [] },
    })
  );
  assert.equal(legacy.legacyReadOnly, true);
  assert.deepEqual(contentLibraryActionTarget(legacy), {
    kind: 'legacy_read_only',
  });
});

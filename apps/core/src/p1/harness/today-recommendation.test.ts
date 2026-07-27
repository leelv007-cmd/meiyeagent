import assert from 'node:assert/strict';
import test from 'node:test';
import { contentPackageSchema } from '@meiye/contracts';

import { compileCopyGenerationRequest } from './output-compiler.js';
import { projectTodayRecommendation } from './today-recommendation.js';

const NOW = '2026-07-18T12:00:00.000Z';
const PRIMARY_COPY_SELECTION_REASON =
  'Single primary result; comparative scoring was not run.';

test('keeps zero facts cold even when an old delivery exists', () => {
  assert.deepEqual(projectTodayRecommendation('workspace-1', 0, record(0)), {
    workspaceId: 'workspace-1',
    currentFactsRevision: 0,
    recommendation: null,
    stale: false,
  });
});

test('exposes one persisted recommendation only at its exact fact revision', () => {
  const state = projectTodayRecommendation('workspace-1', 1, record(1), NOW);

  assert.equal(state.recommendation?.factsRevision, 1);
  assert.equal(state.recommendation?.packageId, 'package-1');
  assert.equal(state.recommendation?.versionId, 'version-1');
  assert.equal(state.recommendation?.whyNow, PRIMARY_COPY_SELECTION_REASON);
  assert.deepEqual(state.recommendation?.factReferences, [
    'store_fact:offer-price:1',
  ]);
  assert.equal(state.stale, false);
});

test('today fixture uses the production primary copy candidate contract', () => {
  const compiled = compileCopyGenerationRequest({
    brief: {
      assetRefs: [],
      constraints: [],
      cta: '私信预约',
      factRefs: ['store_fact:offer-price:1'],
      identityRefs: [],
      instructions: 'Generate one grounded copy result.',
      platform: 'xiaohongshu',
    },
    context: {},
  });
  const selection = record(1).selectionTrace;

  assert.equal(compiled.candidateId, 'c01');
  assert.deepEqual(selection, {
    winnerCandidateId: compiled.candidateId,
    candidateScores: [
      {
        candidateId: compiled.candidateId,
        reason: PRIMARY_COPY_SELECTION_REASON,
      },
    ],
  });
});

test('replays a delivered image or video when media selection has no scores', () => {
  for (const [kind, expectedWhyNow] of [
    ['image_text', '这份图文成品今天已经完成，可以从这份成品继续编辑。'],
    ['video', '这份视频成品今天已经完成，可以从这份成品继续编辑。'],
  ] as const) {
    const state = projectTodayRecommendation(
      'workspace-1',
      1,
      mediaRecord(kind),
      NOW,
    );

    assert.equal(state.recommendation?.whyNow, expectedWhyNow);
    assert.equal(state.recommendation?.packageId, 'package-1');
    assert.equal(state.stale, false);
  }
});

test('does not treat a previous UTC calendar-day delivery as today', () => {
  const justBeforeMidnight = {
    ...record(1),
    deliveredAt: '2026-07-18T23:59:59.999Z',
  };

  assert.deepEqual(
    projectTodayRecommendation(
      'workspace-1',
      1,
      justBeforeMidnight,
      '2026-07-19T00:00:00.000Z',
    ),
    {
      workspaceId: 'workspace-1',
      currentFactsRevision: 1,
      recommendation: null,
      stale: false,
    },
  );
});

test('treats a delivery at UTC midnight as the new day recommendation', () => {
  const atMidnight = {
    ...record(1),
    deliveredAt: '2026-07-19T00:00:00.000Z',
  };

  const state = projectTodayRecommendation(
    'workspace-1',
    1,
    atMidnight,
    '2026-07-19T00:00:00.000Z',
  );

  assert.equal(state.recommendation?.createdAt, atMidnight.deliveredAt);
  assert.equal(state.stale, false);
});

test('withholds the previous recommendation after the fact revision changes', () => {
  assert.deepEqual(projectTodayRecommendation('workspace-1', 2, record(1)), {
    workspaceId: 'workspace-1',
    currentFactsRevision: 2,
    recommendation: null,
    stale: true,
  });
});

test('projects only an active, matched, unexpired nonfallback opportunity', () => {
  const active = opportunity();
  const current = projectTodayRecommendation(
    'workspace-1',
    1,
    record(1, active),
    NOW,
  );

  assert.deepEqual(current.recommendation?.opportunity, active);
  for (const hidden of [
    { ...active, expiresAt: NOW },
    {
      ...active,
      status: 'evergreen_fallback' as const,
      source: '常青选题库',
      sourceType: 'evergreen_fallback' as const,
    },
    { ...active, status: 'expired' as const },
  ]) {
    assert.equal(
      projectTodayRecommendation('workspace-1', 1, record(1, hidden), NOW)
        .recommendation?.opportunity,
      undefined,
    );
  }
});

function opportunity() {
  return {
    opportunityId: 'opportunity-1',
    status: 'active' as const,
    source: 'https://example.com/city-hair-color',
    sourceType: 'user_link' as const,
    capturedAt: '2026-07-18T08:00:00.000Z',
    expiresAt: '2026-07-19T08:00:00.000Z',
    platforms: ['xiaohongshu' as const],
    region: '上海静安',
    targetAudience: '准备换夏季发色的同城顾客',
    matchedStoreReferences: ['store_fact:service-1:2'],
    relevanceExplanation: '门店本周主推低损伤染发。',
    reusableMechanism: '借夏季显白发色问题给出本店原创建议。',
    expectedAction: '私信预约发质判断。',
    evergreenFallback: '转为常青发色选择指南。',
    protectedExpressionCopied: false as const,
  };
}

function record(
  factsRevision: number,
  hotTopicOpportunity?: ReturnType<typeof opportunity> | {
    opportunityId: string;
    status: 'active' | 'expired' | 'evergreen_fallback';
    source: string;
    sourceType:
      | 'user_link'
      | 'user_screenshot'
      | 'user_text_with_source'
      | 'evergreen_fallback';
    capturedAt: string;
    expiresAt: string;
    platforms: Array<'xiaohongshu' | 'douyin' | 'video_account'>;
    region: string;
    targetAudience: string;
    matchedStoreReferences: string[];
    relevanceExplanation: string;
    reusableMechanism: string;
    expectedAction: string;
    evergreenFallback: string;
    protectedExpressionCopied: false;
  },
) {
  const createdAt = '2026-07-18T08:00:00.000Z';
  return {
    taskId: 'task-1',
    rawInput: '把新团购做一套能发的',
    deliveredAt: createdAt,
    delivery: { packageId: 'package-1', versionId: 'version-1', revision: 1 },
    contentPackage: contentPackageSchema.parse({
      workspaceId: 'workspace-1',
      id: 'package-1',
      kind: 'image_text',
      status: 'review_ready',
      revision: 1,
      currentVersionId: 'version-1',
      createdAt,
      updatedAt: createdAt,
      source: { assetIds: [] },
      rights: { state: 'authorized' },
      compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
      lineage: {},
      generated: { childRuns: [] },
      exportReceipts: [],
      variants: [],
      ...(hotTopicOpportunity
        ? {
            marketing: {
              scene: 'traffic_opportunity',
              capabilities: {
                mainRecommendation: true,
                platformDeliverables: true,
                factsAndRights: true,
                quickEdit: true,
                publishExport: true,
                asyncRecovery: true,
                remix: true,
              },
              contextBundle: {
                bundleId: 'context-bundle-1',
                revision: 1,
                hash: 'a'.repeat(64),
              },
              factRefs: ['store_fact:service-1:2'],
              rightsRefs: [],
              identityRefs: [],
              opportunity: hotTopicOpportunity,
              identityFallback: 'none',
            },
          }
        : {}),
      versions: [
        {
          id: 'version-1',
          title: '本周猫眼项目推荐',
          body: '使用本店已确认的猫眼项目和价格制作的完整内容。',
          conversionHook: '私信预约',
          orderedAssetIds: [],
          topics: [],
          createdAt,
          createdBy: 'harness-task-1',
          source: 'ai_generated',
        },
      ],
    }),
    contextTrace: {
      sourceRevisions: {
        facts: factsRevision,
      },
    },
    briefTrace: {
      factRefs: [
        ' store_fact:offer-price:1 ',
        'store_fact:offer-price:1',
      ],
    },
    selectionTrace: {
      winnerCandidateId: 'c01',
      candidateScores: [
        { candidateId: 'c01', reason: PRIMARY_COPY_SELECTION_REASON },
      ],
    },
  };
}

function mediaRecord(kind: 'image_text' | 'video') {
  const base = record(1);
  return {
    ...base,
    contentPackage: contentPackageSchema.parse({
      ...base.contentPackage,
      kind,
    }),
    selectionTrace: {
      winnerCandidateId: 'media-asset-1',
      candidateScores: [],
    },
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { contentPackageSchema } from '@meiye/contracts';

import { compileCopyGenerationRequest } from './output-compiler.js';
import { projectTodayRecommendation } from './today-recommendation.js';

const NOW = '2026-07-18T12:00:00.000Z';
const PRIMARY_COPY_SELECTION_REASON =
  '这版先按你这次的要求整理，已经准备好直接使用。';

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

test('uses configured industry and platform rules before the persisted winner reason', () => {
  const configured = {
    ...record(1),
    intent: { context: { industry: '美甲' } },
    briefTrace: {
      ...record(1).briefTrace,
      platforms: ['xiaohongshu'],
    },
    recommendationRules: {
      weekdayWhyNow: { '6': '周六规则' },
      industryWhyNow: { 美甲: '美甲行业先验' },
      platformWhyNow: { xiaohongshu: '小红书平台规则' },
    },
  };

  assert.equal(
    projectTodayRecommendation('workspace-1', 1, configured, NOW)
      .recommendation?.whyNow,
    '美甲行业先验',
  );
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

test('does not treat a delivery before the 08:00 Shanghai business boundary as today', () => {
  // Intentional equivalence: this Shanghai 08:00 boundary is the UTC calendar
  // boundary after the fixed offset and day-start constants are applied.
  const justBeforeMidnight = {
    ...record(1),
    deliveredAt: '2026-07-18T07:59:00+08:00',
  };

  assert.deepEqual(
    projectTodayRecommendation(
      'workspace-1',
      1,
      justBeforeMidnight,
      '2026-07-18T08:01:00+08:00',
    ),
    {
      workspaceId: 'workspace-1',
      currentFactsRevision: 1,
      recommendation: null,
      stale: false,
    },
  );
});

test('treats a delivery after the 08:00 Shanghai business boundary as today', () => {
  // Keep this UTC-looking timestamp: Asia/Shanghai 08:00 is intentionally equal
  // to the UTC calendar-day boundary in the current fixed-offset model.
  const atMidnight = {
    ...record(1),
    deliveredAt: '2026-07-18T00:01:00.000Z',
  };

  const state = projectTodayRecommendation(
    'workspace-1',
    1,
    atMidnight,
    '2026-07-18T08:01:00+08:00',
  );

  assert.equal(state.recommendation?.createdAt, atMidnight.deliveredAt);
  assert.equal(state.stale, false);
});

test('whyNow weekday follows the same Shanghai 08:00 business boundary', () => {
  const rules = {
    weekdayWhyNow: { '5': '周五规则', '6': '周六规则' },
    industryWhyNow: {},
    platformWhyNow: {},
  };

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        deliveredAt: '2026-07-17T23:59:00.000Z',
        recommendationRules: rules,
      },
      '2026-07-18T07:59:00+08:00',
    ).recommendation?.whyNow,
    '周五规则',
  );
  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        deliveredAt: '2026-07-18T00:01:00.000Z',
        recommendationRules: rules,
      },
      '2026-07-18T08:01:00+08:00',
    ).recommendation?.whyNow,
    '周六规则',
  );
});

test('withholds the previous recommendation after the fact revision changes', () => {
  assert.deepEqual(projectTodayRecommendation('workspace-1', 2, record(1)), {
    workspaceId: 'workspace-1',
    currentFactsRevision: 2,
    recommendation: null,
    stale: true,
  });
});

function record(factsRevision: number) {
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

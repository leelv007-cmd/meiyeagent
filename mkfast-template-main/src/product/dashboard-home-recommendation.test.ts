import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PublicContentPackage,
  TodayRecommendationState,
} from '@meiye/contracts';

import { projectDashboardHomeRecommendation } from './dashboard-home-recommendation';

function coldState(
  overrides: Partial<TodayRecommendationState> = {}
): TodayRecommendationState {
  return {
    currentFactsRevision: 3,
    recommendation: null,
    stale: false,
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

function historicalPackage(
  overrides: Partial<PublicContentPackage> = {}
): PublicContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-26T08:00:00.000Z',
    currentVersionId: 'version-1',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'package-1',
    kind: 'image_text',
    lineage: {},
    marketing: {
      declaration: {
        deliveryLayer: 'copy',
        implicitConstraints: [],
        normalizedIntent: '写一条换季头皮护理内容',
        relevantAssetCategories: ['store'],
        route: 'customized',
        routingSource: 'policy',
        taskType: 'daily_service_exposure',
        usedAssetCategories: ['store'],
      },
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 3,
      },
      factRefs: ['store_fact:project-1'],
      identityRefs: [],
      rightsRefs: [],
    },
    revision: 2,
    rights: { state: 'authorized' },
    source: {
      assetIds: [],
      storeProfileId: 'store-1',
      workId: 'work-1',
      workflowId: 'workflow-1',
    },
    status: 'accepted',
    updatedAt: '2026-07-26T10:00:00.000Z',
    variants: [],
    versions: [
      {
        body: '换季头皮护理，先了解头皮状态再选护理方案。',
        conversionHook: '私信预约到店检测',
        createdAt: '2026-07-26T09:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: [],
        title: '换季头皮护理提醒',
        topics: ['头皮护理'],
      },
    ],
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

test('keeps the harness recommendation as the first authority', () => {
  const harness = coldState({
    recommendation: {
      body: '来自确定性推荐链',
      createdAt: '2026-07-27T08:00:00.000Z',
      customerAction: '私信预约',
      factsRevision: 3,
      factReferences: ['store_fact:project-1'],
      packageId: 'package-harness',
      sourceLabel: '真实任务',
      taskId: 'task-harness',
      title: '今日主推荐',
      versionId: 'version-harness',
      whyNow: '今天有明确的到店机会',
      workspaceId: 'workspace-1',
    },
  });

  assert.deepEqual(
    projectDashboardHomeRecommendation(harness, [historicalPackage()]),
    harness
  );
});

test('projects the latest usable canonical history into a hot recommendation', () => {
  const state = projectDashboardHomeRecommendation(coldState(), [
    historicalPackage(),
  ]);

  assert.equal(state.stale, false);
  assert.equal(state.recommendation?.packageId, 'package-1');
  assert.equal(state.recommendation?.versionId, 'version-1');
  assert.equal(state.recommendation?.title, '换季头皮护理提醒');
  assert.equal(state.recommendation?.customerAction, '私信预约到店检测');
  assert.match(state.recommendation?.whyNow ?? '', /最近完成/u);
  assert.deepEqual(state.recommendation?.factReferences, [
    'store_fact:project-1',
  ]);
});

test('uses the confirmed store profile when an older package has no factRefs', () => {
  const state = projectDashboardHomeRecommendation(coldState(), [
    historicalPackage({
      marketing: {
        ...historicalPackage().marketing!,
        factRefs: [],
      },
    }),
  ]);

  assert.deepEqual(state.recommendation?.factReferences, ['store-1']);
});

test('does not call an incomplete or stale history item a current recommendation', () => {
  assert.equal(
    projectDashboardHomeRecommendation(coldState(), [
      historicalPackage({ currentVersionId: undefined, versions: [] }),
    ]).recommendation,
    null
  );
  assert.equal(
    projectDashboardHomeRecommendation(coldState({ stale: true }), [
      historicalPackage(),
    ]).recommendation,
    null
  );
  assert.equal(
    projectDashboardHomeRecommendation(coldState({ currentFactsRevision: 0 }), [
      historicalPackage(),
    ]).recommendation,
    null
  );
});

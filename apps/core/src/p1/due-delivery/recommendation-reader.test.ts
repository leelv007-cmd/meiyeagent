import assert from 'node:assert/strict';
import test from 'node:test';

import type { TodayRecommendationState } from '@meiye/contracts';

import {
  DueAwareHarnessRecommendationReader,
  type DailyRecommendationDueReader,
} from './recommendation-reader.js';

const businessDate = '2026-07-29';
const taskId = `daily-rec_workspace-1_${businessDate}`;
const runId = `delivery-run:${taskId}`;

test('delivered daily output is the Dashboard recommendation authority', async () => {
  let baseReads = 0;
  const state = recommendationState(taskId);
  const reader = new DueAwareHarnessRecommendationReader(
    {
      async readTodayRecommendation() {
        baseReads += 1;
        return recommendationState('legacy-task');
      },
    },
    dueReader({
      businessDate,
      completedAt: '2026-07-29T01:00:00.000Z',
      output: {
        schemaVersion: 'daily-recommendation-delivery/v1',
        source: {
          actorId: 'system:due-scanner',
          businessDate,
          generationRequested: false,
          runId,
          taskId,
        },
        state,
      },
      runId,
      taskId,
    }),
    () => new Date('2026-07-29T01:00:00.000Z'),
  );

  assert.deepEqual(await reader.readTodayRecommendation('workspace-1'), state);
  assert.equal(baseReads, 0);
});

test('first Dashboard reads hide the base recommendation until the daily due is delivered', async () => {
  const ensured: Array<{ businessDate: string; workspaceId: string }> = [];
  let baseReads = 0;
  const reader = new DueAwareHarnessRecommendationReader(
    {
      async readTodayRecommendation(workspaceId) {
        baseReads += 1;
        return recommendationState(`legacy-${workspaceId}`);
      },
    },
    {
      async ensureDailyRecommendationDue(workspaceId, date) {
        ensured.push({ businessDate: date, workspaceId });
        return { businessDate: date };
      },
      async readLatestDelivered() {
        return null;
      },
    },
    () => new Date('2026-07-29T08:00:00.000Z'),
  );

  const first = await reader.readTodayRecommendation('workspace-1');
  const second = await reader.readTodayRecommendation('workspace-1');

  assert.deepEqual(first, {
    ...recommendationState('legacy-workspace-1'),
    recommendation: null,
  });
  assert.deepEqual(second, first);
  assert.equal(baseReads, 2);
  assert.deepEqual(ensured, [
    { businessDate, workspaceId: 'workspace-1' },
    { businessDate, workspaceId: 'workspace-1' },
  ]);
});

test('invalid or previous-day delivery output cannot expose the base recommendation', async () => {
  const fallback = recommendationState('legacy-task');
  const reader = new DueAwareHarnessRecommendationReader(
    {
      async readTodayRecommendation() {
        return fallback;
      },
    },
    dueReader({
      businessDate: '2026-07-28',
      completedAt: '2026-07-28T01:00:00.000Z',
      output: {
        schemaVersion: 'daily-recommendation-delivery/v1',
        source: {
          actorId: 'system:due-scanner',
          businessDate: '2026-07-28',
          generationRequested: false,
          runId: 'delivery-run:previous',
          taskId: 'daily-rec_workspace-1_2026-07-28',
        },
        state: recommendationState('daily-rec_workspace-1_2026-07-28'),
      },
      runId: 'delivery-run:previous',
      taskId: 'daily-rec_workspace-1_2026-07-28',
    }),
    () => new Date('2026-07-29T01:00:00.000Z'),
  );

  assert.deepEqual(await reader.readTodayRecommendation('workspace-1'), {
    ...fallback,
    recommendation: null,
  });
});

function dueReader(
  delivered: NonNullable<
    Awaited<ReturnType<DailyRecommendationDueReader['readLatestDelivered']>>
  >,
): DailyRecommendationDueReader {
  return {
    async ensureDailyRecommendationDue(_workspaceId, date) {
      return { businessDate: date };
    },
    async readLatestDelivered() {
      return delivered;
    },
  };
}

function recommendationState(task: string): TodayRecommendationState {
  return {
    currentFactsRevision: 1,
    recommendation: {
      body: '今天可以沿用这份已交付内容。',
      createdAt: '2026-07-29T01:00:00.000Z',
      customerAction: '打开 Composer 继续编辑',
      factReferences: ['store_fact:service-1:1'],
      factsRevision: 1,
      packageId: 'package-1',
      sourceLabel: '已交付内容',
      taskId: task,
      title: '今日推荐',
      versionId: 'version-1',
      whyNow: '适合今天继续使用',
      workspaceId: 'workspace-1',
    },
    stale: false,
    workspaceId: 'workspace-1',
  };
}

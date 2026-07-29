import assert from 'node:assert/strict';
import test from 'node:test';

import type { TodayRecommendationState } from '@meiye/contracts';

import type { ProductNotification } from '../../product/notifier.js';
import { DailyRecommendationDeliveryPort } from './delivery-port.js';

test('daily delivery freezes the base recommendation under the delivery task and run', async () => {
  const reads: string[] = [];
  const notifications: ProductNotification[] = [];
  const port = new DailyRecommendationDeliveryPort(
    {
      async readDailyRecommendationCandidate(workspaceId, at) {
        reads.push(workspaceId);
        assert.equal(at, '2026-07-29T01:02:03.000Z');
        return recommendationState(workspaceId);
      },
    },
    () => new Date('2026-07-29T01:02:03.000Z'),
    {
      async notify(notification) {
        notifications.push(notification);
      },
    },
  );

  assert.deepEqual(
    await port.deliver({
      actorId: 'system:due-scanner',
      attemptCount: 1,
      businessDate: '2026-07-29',
      claimToken: 'claim-1',
      dueAt: '2026-07-29T00:00:00.000Z',
      generationRequested: false,
      id: 'due-1',
      idempotencyKey:
        'delivery-run:daily-rec_workspace-1_2026-07-29',
      payload: {
        businessDate: '2026-07-29',
        schemaVersion: 'daily-recommendation/v1',
      },
      runId: 'delivery-run:daily-rec_workspace-1_2026-07-29',
      taskId: 'daily-rec_workspace-1_2026-07-29',
      type: 'daily_recommendation',
      workspaceId: 'workspace-1',
    }),
    {
      output: {
        schemaVersion: 'daily-recommendation-delivery/v1',
        source: {
          actorId: 'system:due-scanner',
          businessDate: '2026-07-29',
          generationRequested: false,
          runId: 'delivery-run:daily-rec_workspace-1_2026-07-29',
          taskId: 'daily-rec_workspace-1_2026-07-29',
        },
        state: {
          ...recommendationState('workspace-1'),
          recommendation: {
            ...recommendationState('workspace-1').recommendation!,
            createdAt: '2026-07-29T01:02:03.000Z',
            taskId: 'daily-rec_workspace-1_2026-07-29',
          },
        },
      },
    },
  );
  assert.deepEqual(reads, ['workspace-1']);
  assert.deepEqual(notifications, []);
});

test('daily delivery retries when the base has no usable recommendation', async () => {
  const port = new DailyRecommendationDeliveryPort({
    async readDailyRecommendationCandidate(workspaceId) {
      return {
        currentFactsRevision: 0,
        recommendation: null,
        stale: false,
        workspaceId,
      };
    },
  });

  await assert.rejects(
    port.deliver({
      actorId: 'system:due-scanner',
      attemptCount: 1,
      businessDate: '2026-07-29',
      claimToken: 'claim-1',
      dueAt: '2026-07-29T00:00:00.000Z',
      generationRequested: false,
      id: 'due-1',
      idempotencyKey:
        'delivery-run:daily-rec_workspace-1_2026-07-29',
      payload: {
        businessDate: '2026-07-29',
        schemaVersion: 'daily-recommendation/v1',
      },
      runId: 'delivery-run:daily-rec_workspace-1_2026-07-29',
      taskId: 'daily-rec_workspace-1_2026-07-29',
      type: 'daily_recommendation',
      workspaceId: 'workspace-1',
    }),
    /usable recommendation/u,
  );
});

test('daily delivery remains available without a product notifier', async () => {
  const port = new DailyRecommendationDeliveryPort(
    {
      async readDailyRecommendationCandidate(workspaceId) {
        return recommendationState(workspaceId);
      },
    },
    () => new Date('2026-07-29T01:02:03.000Z'),
  );

  const result = await port.deliver({
    actorId: 'system:due-scanner',
    attemptCount: 1,
    businessDate: '2026-07-29',
    claimToken: 'claim-1',
    dueAt: '2026-07-29T00:00:00.000Z',
    generationRequested: false,
    id: 'due-1',
    idempotencyKey: 'delivery-run:daily-rec_workspace-1_2026-07-29',
    payload: {
      businessDate: '2026-07-29',
      schemaVersion: 'daily-recommendation/v1',
    },
    runId: 'delivery-run:daily-rec_workspace-1_2026-07-29',
    taskId: 'daily-rec_workspace-1_2026-07-29',
    type: 'daily_recommendation',
    workspaceId: 'workspace-1',
  });

  assert.equal(
    result.output.schemaVersion,
    'daily-recommendation-delivery/v1',
  );
});

test('task recall delivers a structured notification without reading recommendation generation', async () => {
  let baseRead = false;
  const notifications: ProductNotification[] = [];
  const port = new DailyRecommendationDeliveryPort(
    {
      async readDailyRecommendationCandidate() {
        baseRead = true;
        return recommendationState('workspace-1');
      },
    },
    () => new Date('2026-07-29T01:02:03.000Z'),
    {
      async notify(notification) {
        notifications.push(notification);
      },
    },
  );

  assert.deepEqual(
    await port.deliver({
      actorId: 'system:due-scanner',
      attemptCount: 1,
      claimToken: 'claim-1',
      dueAt: '2026-07-29T00:00:00.000Z',
      generationRequested: false,
      id: 'due-recall-1',
      idempotencyKey: 'delivery-run:recall-task-1',
      payload: {
        nextStep: '回到任务查看成品',
        schemaVersion: 'task-recall/v1',
        taskId: 'source-task-1',
        title: '你的内容已完成',
      },
      runId: 'delivery-run:recall-task-1',
      taskId: 'recall-task-1',
      type: 'task_recall',
      workspaceId: 'workspace-1',
    }),
    {
      output: {
        notification: {
          nextStep: '回到任务查看成品',
          taskId: 'source-task-1',
          title: '你的内容已完成',
        },
        schemaVersion: 'task-recall-delivery/v1',
        source: {
          actorId: 'system:due-scanner',
          generationRequested: false,
          runId: 'delivery-run:recall-task-1',
          taskId: 'recall-task-1',
        },
      },
    },
  );
  assert.equal(baseRead, false);
  assert.deepEqual(notifications, [
    {
      correlationId: 'delivery-run:recall-task-1',
      deepLink: '/dashboard',
      idempotencyKey: 'delivery-run:recall-task-1',
      jobId: 'source-task-1',
      message: '你的内容已完成：回到任务查看成品',
      status: 'completed',
      workspaceId: 'workspace-1',
    },
  ]);
});

test('task recall fails closed when no real notifier is available', async () => {
  const port = new DailyRecommendationDeliveryPort({
    async readDailyRecommendationCandidate() {
      throw new Error('task recall must not read recommendations');
    },
  });

  await assert.rejects(
    port.deliver(taskRecallInput()),
    /requires a product notifier/u,
  );
});

test('invalid task recall output is rejected before notification', async () => {
  const notifications: ProductNotification[] = [];
  const port = new DailyRecommendationDeliveryPort(
    {
      async readDailyRecommendationCandidate() {
        throw new Error('task recall must not read recommendations');
      },
    },
    undefined,
    {
      async notify(notification) {
        notifications.push(notification);
      },
    },
  );

  await assert.rejects(
    port.deliver({
      ...taskRecallInput(),
      payload: {
        nextStep: '   ',
        schemaVersion: 'task-recall/v1',
        taskId: 'source-task-1',
        title: '你的内容已完成',
      },
    }),
  );
  assert.deepEqual(notifications, []);
});

function taskRecallInput(): Parameters<
  DailyRecommendationDeliveryPort['deliver']
>[0] {
  return {
    actorId: 'system:due-scanner',
    attemptCount: 1,
    claimToken: 'claim-1',
    dueAt: '2026-07-29T00:00:00.000Z',
    generationRequested: false,
    id: 'due-recall-1',
    idempotencyKey: 'delivery-run:recall-task-1',
    payload: {
      nextStep: '回到任务查看成品',
      schemaVersion: 'task-recall/v1',
      taskId: 'source-task-1',
      title: '你的内容已完成',
    },
    runId: 'delivery-run:recall-task-1',
    taskId: 'recall-task-1',
    type: 'task_recall',
    workspaceId: 'workspace-1',
  };
}

function recommendationState(workspaceId: string): TodayRecommendationState {
  return {
    currentFactsRevision: 1,
    recommendation: {
      body: '今天可以沿用这份已交付内容。',
      createdAt: '2026-07-29T00:00:00.000Z',
      customerAction: '打开 Composer 继续编辑',
      factReferences: ['store_fact:service-1:1'],
      factsRevision: 1,
      packageId: 'package-1',
      sourceLabel: '已交付内容',
      taskId: 'legacy-task',
      title: '今日推荐',
      versionId: 'version-1',
      whyNow: '适合今天继续使用',
      workspaceId,
    },
    stale: false,
    workspaceId,
  };
}

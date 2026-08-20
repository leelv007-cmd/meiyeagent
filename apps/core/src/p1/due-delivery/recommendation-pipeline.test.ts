import assert from 'node:assert/strict';
import test from 'node:test';
import { contentPackageSchema, type TodayRecommendationState } from '@meiye/contracts';

import { DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG } from '../admin-config/foundation-module.js';
import { projectTodayRecommendation } from '../harness/today-recommendation.js';
import { DailyRecommendationDeliveryPort } from './delivery-port.js';
import {
  DueAwareHarnessRecommendationReader,
  type DailyRecommendationDueReader,
} from './recommendation-reader.js';
import {
  DueDeliveryWorker,
  type DueDeliveryClaim,
  type DueDeliveryRepository,
} from './worker.js';

const NOW = '2026-07-29T01:00:00.000Z';
const BUSINESS_DATE = '2026-07-29';
const INDUSTRY_WHY_NOW =
  DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG.industryWhyNow.hair_care;
const PLATFORM_WHY_NOW =
  DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG.platformWhyNow.xiaohongshu;
const GENERIC_WHY_NOW = '这版先按你这次的要求整理，已经准备好直接使用。';

test('due worker must deliver before a stated 美发 industry whyNow is readable', async () => {
  const queue = new MemoryDueDeliveryQueue();
  const candidate = recommendationFrom({
    storeIndustry: '美发',
    platforms: ['xiaohongshu'],
  });
  const reader = dueAwareReader(queue, candidate);
  const worker = dueWorker(queue, candidate);

  const pending = await reader.readTodayRecommendation('workspace-1');
  assert.equal(pending.recommendation, null);
  assert.equal(queue.pendingCount, 1);

  assert.deepEqual(await worker.runOnce('due-worker-1'), {
    claimed: 1,
    deadLettered: 0,
    delivered: 1,
    lost: 0,
    retried: 0,
    suppressed: 0,
  });

  const delivered = await reader.readTodayRecommendation('workspace-1');
  assert.equal(delivered.recommendation?.whyNow, INDUSTRY_WHY_NOW);
  assert.equal(
    delivered.recommendation?.taskId,
    `daily-rec_workspace-1_${BUSINESS_DATE}`,
  );
});

test('empty and unmapped store industries fall through after due delivery', async () => {
  for (const [label, storeIndustry, platforms, expectedWhyNow] of [
    ['empty', undefined, ['xiaohongshu'], PLATFORM_WHY_NOW],
    ['unmapped 美甲', '美甲', ['xiaohongshu'], PLATFORM_WHY_NOW],
    ['unmapped 美甲 without platform', '美甲', [], GENERIC_WHY_NOW],
  ] as const) {
    const queue = new MemoryDueDeliveryQueue();
    const candidate = recommendationFrom({
      ...(storeIndustry ? { storeIndustry } : {}),
      platforms: [...platforms],
    });
    const reader = dueAwareReader(queue, candidate);
    const worker = dueWorker(queue, candidate);

    assert.equal(
      (await reader.readTodayRecommendation('workspace-1')).recommendation,
      null,
      `${label} stays hidden until due delivery`,
    );
    assert.equal((await worker.runOnce('due-worker-1')).delivered, 1, label);
    assert.equal(
      (await reader.readTodayRecommendation('workspace-1')).recommendation
        ?.whyNow,
      expectedWhyNow,
      label,
    );
    assert.notEqual(expectedWhyNow, INDUSTRY_WHY_NOW, label);
  }
});

test('due delivery retries instead of publishing a cold candidate', async () => {
  const queue = new MemoryDueDeliveryQueue();
  const cold: TodayRecommendationState = {
    currentFactsRevision: 1,
    recommendation: null,
    stale: false,
    workspaceId: 'workspace-1',
  };
  const reader = dueAwareReader(queue, cold);
  const worker = dueWorker(queue, cold);

  await reader.readTodayRecommendation('workspace-1');
  assert.deepEqual(await worker.runOnce('due-worker-1'), {
    claimed: 1,
    deadLettered: 0,
    delivered: 0,
    lost: 0,
    retried: 1,
    suppressed: 0,
  });
  assert.equal(
    (await reader.readTodayRecommendation('workspace-1')).recommendation,
    null,
  );
});

function dueAwareReader(
  queue: MemoryDueDeliveryQueue,
  candidate: TodayRecommendationState,
) {
  return new DueAwareHarnessRecommendationReader(
    {
      async readTodayRecommendation() {
        return candidate;
      },
    },
    queue,
    () => new Date(NOW),
  );
}

function dueWorker(
  queue: MemoryDueDeliveryQueue,
  candidate: TodayRecommendationState,
) {
  return new DueDeliveryWorker(
    queue,
    {
      async evaluate() {
        return { isRestDay: false, workspaceActive: true };
      },
    },
    new DailyRecommendationDeliveryPort(
      {
        async readDailyRecommendationCandidate() {
          return candidate;
        },
      },
      () => new Date(NOW),
    ),
    {
      batchSize: 1,
      clock: () => new Date(NOW),
    },
  );
}

function recommendationFrom(input: {
  platforms: string[];
  storeIndustry?: string;
}): TodayRecommendationState {
  return projectTodayRecommendation(
    'workspace-1',
    1,
    {
      taskId: 'copy-task-1',
      rawInput: '写一条发朋友圈提醒老客到店的短文案',
      deliveredAt: NOW,
      delivery: { packageId: 'package-1', versionId: 'version-1', revision: 1 },
      contentPackage: contentPackageSchema.parse({
        workspaceId: 'workspace-1',
        id: 'package-1',
        kind: 'image_text',
        status: 'review_ready',
        revision: 1,
        currentVersionId: 'version-1',
        createdAt: NOW,
        updatedAt: NOW,
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
            title: '今日到店提醒',
            body: '用本店已确认的项目提醒老客到店。',
            conversionHook: '私信预约',
            orderedAssetIds: [],
            topics: [],
            createdAt: NOW,
            createdBy: 'harness-copy-task-1',
            source: 'ai_generated',
          },
        ],
      }),
      ...(input.storeIndustry ? { storeIndustry: input.storeIndustry } : {}),
      recommendationRules: DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
      contextTrace: { sourceRevisions: { facts: 1 } },
      briefTrace: {
        factRefs: ['store_fact:offer-price:1'],
        platforms: input.platforms,
      },
      selectionTrace: {
        winnerCandidateId: 'c01',
        candidateScores: [
          { candidateId: 'c01', reason: GENERIC_WHY_NOW },
        ],
      },
    },
    NOW,
  );
}

class MemoryDueDeliveryQueue
  implements DailyRecommendationDueReader, DueDeliveryRepository
{
  private readonly items = new Map<string, QueueItem>();
  private latestDelivered: {
    businessDate: string | null;
    completedAt: string;
    output: Record<string, unknown>;
    runId: string;
    taskId: string;
  } | null = null;

  get pendingCount() {
    return [...this.items.values()].filter(
      (item) => item.status === 'pending' || item.status === 'retry',
    ).length;
  }

  async ensureDailyRecommendationDue(workspaceId: string, businessDate: string) {
    const taskId = `daily-rec_${workspaceId}_${businessDate}`;
    const key = `${workspaceId}:${taskId}`;
    if (this.items.has(key)) return { businessDate };
    this.items.set(key, {
      attemptCount: 0,
      businessDate,
      claimToken: null,
      dueAt: `${businessDate}T00:00:00.000Z`,
      id: `due-${key}`,
      payload: {
        businessDate,
        schemaVersion: 'daily-recommendation/v1',
      },
      status: 'pending',
      taskId,
      type: 'daily_recommendation',
      workspaceId,
    });
    return { businessDate };
  }

  async readLatestDelivered(
    workspaceId: string,
    type: 'daily_recommendation',
  ) {
    if (
      !this.latestDelivered ||
      this.latestDelivered.taskId !==
        `daily-rec_${workspaceId}_${BUSINESS_DATE}`
    ) {
      return null;
    }
    void type;
    return this.latestDelivered;
  }

  async claimBatch(input: {
    claimToken: string;
    leaseMs: number;
    limit: number;
    now: Date;
    workerId: string;
  }) {
    const ready = [...this.items.values()]
      .filter(
        (item) =>
          (item.status === 'pending' || item.status === 'retry') &&
          Date.parse(item.dueAt) <= input.now.getTime(),
      )
      .slice(0, input.limit);
    const claimed: DueDeliveryClaim[] = [];
    for (const item of ready) {
      item.attemptCount += 1;
      item.claimToken = input.claimToken;
      item.status = 'claimed';
      claimed.push({
        attemptCount: item.attemptCount,
        businessDate: item.businessDate,
        claimToken: input.claimToken,
        dueAt: item.dueAt,
        id: item.id,
        payload: item.payload,
        taskId: item.taskId,
        type: item.type,
        workspaceId: item.workspaceId,
      });
    }
    return claimed;
  }

  async beginDelivery(input: {
    identity: { claimToken: string; dueId: string; workspaceId: string };
    taskId: string;
    type: 'daily_recommendation' | 'task_recall';
  }) {
    const item = this.itemById(input.identity.dueId);
    if (
      !item ||
      item.claimToken !== input.identity.claimToken ||
      item.taskId !== input.taskId
    ) {
      return null;
    }
    return { runId: `delivery-run:${item.taskId}` };
  }

  async settleDelivered(input: {
    identity: { claimToken: string; dueId: string; workspaceId: string };
    output: Record<string, unknown>;
    runId: string;
  }) {
    const item = this.itemById(input.identity.dueId);
    if (!item || item.claimToken !== input.identity.claimToken) return false;
    item.status = 'delivered';
    item.claimToken = null;
    this.latestDelivered = {
      businessDate: item.businessDate,
      completedAt: NOW,
      output: input.output,
      runId: input.runId,
      taskId: item.taskId,
    };
    return true;
  }

  async settleFailed(input: {
    deadLetter: boolean;
    identity: { claimToken: string; dueId: string; workspaceId: string };
  }) {
    const item = this.itemById(input.identity.dueId);
    if (!item || item.claimToken !== input.identity.claimToken) return false;
    item.status = input.deadLetter ? 'dead_letter' : 'retry';
    item.claimToken = null;
    return true;
  }

  async settleSuppressed() {
    return false;
  }

  private itemById(dueId: string) {
    return [...this.items.values()].find((item) => item.id === dueId);
  }
}

interface QueueItem {
  attemptCount: number;
  businessDate: string;
  claimToken: string | null;
  dueAt: string;
  id: string;
  payload: {
    businessDate: string;
    schemaVersion: 'daily-recommendation/v1';
  };
  status: 'pending' | 'claimed' | 'retry' | 'delivered' | 'dead_letter';
  taskId: string;
  type: 'daily_recommendation';
  workspaceId: string;
}

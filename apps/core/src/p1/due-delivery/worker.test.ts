import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DueDeliveryWorker,
  type DueDeliveryClaim,
  type DueDeliveryClaimIdentity,
  type DueDeliveryEligibility,
  type DueDeliveryRepository,
} from './worker.js';

test('claims and processes multiple due items one at a time until the queue is empty', async () => {
  const pending = [
    {
      ...dailyRecommendationClaim(),
      id: 'due-1',
      taskId: 'daily-rec_workspace-1_2026-07-29',
    },
    {
      ...dailyRecommendationClaim(),
      id: 'due-2',
      taskId: 'daily-rec_workspace-2_2026-07-29',
      workspaceId: 'workspace-2',
    },
  ];
  const claimCalls: Array<{ claimToken: string; limit: number }> = [];
  let tokenSequence = 0;
  const repository: DueDeliveryRepository = {
    async claimBatch(input) {
      claimCalls.push({
        claimToken: input.claimToken,
        limit: input.limit,
      });
      return pending.splice(0, input.limit).map((claim) => ({
        ...claim,
        claimToken: input.claimToken,
      }));
    },
    async beginDelivery(input) {
      return { runId: `delivery-run:${input.taskId}` };
    },
    async settleDelivered() {
      return true;
    },
    async settleFailed() {
      throw new Error('settleFailed must not be called');
    },
    async settleSuppressed() {
      throw new Error('settleSuppressed must not be called');
    },
  };
  const worker = new DueDeliveryWorker(
    repository,
    {
      async evaluate() {
        return { workspaceActive: true, isRestDay: false };
      },
    },
    {
      async deliver() {
        return { output: {} };
      },
    },
    {
      claimToken: () => `claim-${++tokenSequence}`,
    },
  );

  assert.deepEqual(await worker.runOnce('worker-1'), {
    claimed: 2,
    deadLettered: 0,
    delivered: 2,
    lost: 0,
    retried: 0,
    suppressed: 0,
  });
  assert.deepEqual(claimCalls, [
    { claimToken: 'claim-1', limit: 1 },
    { claimToken: 'claim-2', limit: 1 },
    { claimToken: 'claim-3', limit: 1 },
  ]);
});

test('delivers one due recommendation and chains the next business day without a generation run', async () => {
  const claim: DueDeliveryClaim = {
    attemptCount: 1,
    businessDate: '2026-07-29',
    claimToken: 'claim-1',
    dueAt: '2026-07-29T00:00:00.000Z',
    id: 'due-daily-rec-workspace-1-2026-07-29',
    payload: {
      schemaVersion: 'daily-recommendation/v1',
      businessDate: '2026-07-29',
    },
    taskId: 'daily-rec_workspace-1_2026-07-29',
    type: 'daily_recommendation',
    workspaceId: 'workspace-1',
  };
  const settled: Array<{
    identity: DueDeliveryClaimIdentity;
    nextDue?: {
      businessDate: string;
      dueAt: string;
      payload: {
        businessDate: string;
        schemaVersion: string;
      };
      taskId: string;
    };
    output: unknown;
    runId: string;
  }> = [];
  let claimed = false;
  const sequence: string[] = [];
  const repository: DueDeliveryRepository = {
    async beginDelivery() {
      sequence.push('begin');
      return { runId: `delivery-run:${claim.taskId}` };
    },
    async claimBatch() {
      if (claimed) return [];
      claimed = true;
      return [claim];
    },
    async settleDelivered(input) {
      sequence.push('settle');
      settled.push(input);
      return true;
    },
    async settleFailed() {
      throw new Error('settleFailed must not be called');
    },
    async settleSuppressed() {
      throw new Error('settleSuppressed must not be called');
    },
  };
  const eligibility: DueDeliveryEligibility = {
    async evaluate() {
      return { workspaceActive: true, isRestDay: false };
    },
  };
  const deliveries: Array<{
    taskId: string;
    type: string;
    generationRequested: boolean;
  }> = [];
  const worker = new DueDeliveryWorker(
    repository,
    eligibility,
    {
      async deliver(input) {
        sequence.push('deliver');
        deliveries.push({
          generationRequested: input.generationRequested,
          taskId: input.taskId,
          type: input.type,
        });
        assert.equal(input.runId, `delivery-run:${input.taskId}`);
        return {
          output: {
            packageId: 'package-1',
            schemaVersion: 'daily-recommendation-delivery/v1',
            versionId: 'version-1',
          },
        };
      },
    },
    {
      claimToken: () => 'claim-1',
      clock: () => new Date('2026-07-29T00:05:00.000Z'),
    },
  );

  const first = await worker.runOnce('worker-1');
  const replay = await worker.runOnce('worker-1');

  assert.deepEqual(first, {
    claimed: 1,
    deadLettered: 0,
    delivered: 1,
    lost: 0,
    retried: 0,
    suppressed: 0,
  });
  assert.equal(replay.claimed, 0);
  assert.deepEqual(deliveries, [
    {
      generationRequested: false,
      taskId: 'daily-rec_workspace-1_2026-07-29',
      type: 'daily_recommendation',
    },
  ]);
  assert.deepEqual(sequence, ['begin', 'deliver', 'settle']);
  assert.deepEqual(settled, [
    {
      identity: {
        claimToken: 'claim-1',
        dueId: 'due-daily-rec-workspace-1-2026-07-29',
        workspaceId: 'workspace-1',
      },
      nextDue: {
        businessDate: '2026-07-30',
        dueAt: '2026-07-30T00:00:00.000Z',
        payload: {
          businessDate: '2026-07-30',
          schemaVersion: 'daily-recommendation/v1',
        },
        taskId: 'daily-rec_workspace-1_2026-07-30',
      },
      output: {
        packageId: 'package-1',
        schemaVersion: 'daily-recommendation-delivery/v1',
        versionId: 'version-1',
      },
      runId: 'delivery-run:daily-rec_workspace-1_2026-07-29',
    },
  ]);
});

test('suppresses a rest-day recommendation before delivery and still chains the next day', async () => {
  const claim = dailyRecommendationClaim();
  const suppressed: Array<
    Parameters<DueDeliveryRepository['settleSuppressed']>[0]
  > = [];
  let delivered = 0;
  const worker = new DueDeliveryWorker(
    singleClaimRepository(claim, {
      async settleSuppressed(input) {
        suppressed.push(input);
        return true;
      },
    }),
    {
      async evaluate() {
        return { workspaceActive: true, isRestDay: true };
      },
    },
    {
      async deliver() {
        delivered += 1;
        return { output: {} };
      },
    },
    { claimToken: () => claim.claimToken },
  );

  const result = await worker.runOnce('worker-1');

  assert.equal(result.suppressed, 1);
  assert.equal(result.delivered, 0);
  assert.equal(delivered, 0);
  assert.deepEqual(suppressed, [
    {
      identity: {
        claimToken: 'claim-1',
        dueId: claim.id,
        workspaceId: claim.workspaceId,
      },
      nextDue: {
        businessDate: '2026-07-30',
        dueAt: '2026-07-30T00:00:00.000Z',
        payload: {
          businessDate: '2026-07-30',
          schemaVersion: 'daily-recommendation/v1',
        },
        taskId: 'daily-rec_workspace-1_2026-07-30',
      },
      reason: 'rest_day',
      suppressedAt: suppressed[0]?.suppressedAt,
    },
  ]);
});

test('stops a daily chain when the workspace is inactive', async () => {
  const claim = dailyRecommendationClaim();
  const suppressed: Array<
    Parameters<DueDeliveryRepository['settleSuppressed']>[0]
  > = [];
  const worker = new DueDeliveryWorker(
    singleClaimRepository(claim, {
      async settleSuppressed(input) {
        suppressed.push(input);
        return true;
      },
    }),
    {
      async evaluate() {
        return { workspaceActive: false, isRestDay: false };
      },
    },
    {
      async deliver() {
        throw new Error('inactive workspaces must not be delivered');
      },
    },
    { claimToken: () => claim.claimToken },
  );

  await worker.runOnce('worker-1');

  assert.deepEqual(suppressed, [
    {
      identity: {
        claimToken: 'claim-1',
        dueId: claim.id,
        workspaceId: claim.workspaceId,
      },
      reason: 'workspace_inactive',
      suppressedAt: suppressed[0]?.suppressedAt,
    },
  ]);
});

test('retries an eligibility read failure without creating a delivery run', async () => {
  const claim = dailyRecommendationClaim();
  const failures: Array<{ deadLetter: boolean; error: string }> = [];
  let delivered = 0;
  const worker = new DueDeliveryWorker(
    singleClaimRepository(claim, {
      async settleFailed(input) {
        failures.push(input);
        return true;
      },
    }),
    {
      async evaluate() {
        throw new Error('fact ledger unavailable');
      },
    },
    {
      async deliver() {
        delivered += 1;
        return { output: {} };
      },
    },
    {
      claimToken: () => claim.claimToken,
      clock: () => new Date('2026-07-29T00:05:00.000Z'),
    },
  );

  const result = await worker.runOnce('worker-1');

  assert.equal(result.retried, 1);
  assert.equal(delivered, 0);
  assert.deepEqual(failures, [
    {
      deadLetter: false,
      error: 'fact ledger unavailable',
      failedAt: new Date('2026-07-29T00:05:00.000Z'),
      identity: {
        claimToken: 'claim-1',
        dueId: claim.id,
        workspaceId: claim.workspaceId,
      },
      retryAt: new Date('2026-07-29T00:05:05.000Z'),
    },
  ]);
});

function dailyRecommendationClaim(): DueDeliveryClaim {
  return {
    attemptCount: 1,
    businessDate: '2026-07-29',
    claimToken: 'claim-1',
    dueAt: '2026-07-29T00:00:00.000Z',
    id: 'due-daily-rec-workspace-1-2026-07-29',
    payload: {
      schemaVersion: 'daily-recommendation/v1',
      businessDate: '2026-07-29',
    },
    taskId: 'daily-rec_workspace-1_2026-07-29',
    type: 'daily_recommendation',
    workspaceId: 'workspace-1',
  };
}

function singleClaimRepository(
  claim: DueDeliveryClaim,
  overrides: Partial<DueDeliveryRepository>,
): DueDeliveryRepository {
  let claimed = false;
  return {
    async beginDelivery() {
      throw new Error('beginDelivery must not be called');
    },
    async claimBatch() {
      if (claimed) return [];
      claimed = true;
      return [claim];
    },
    async settleDelivered() {
      throw new Error('settleDelivered must not be called');
    },
    async settleFailed() {
      throw new Error('settleFailed must not be called');
    },
    async settleSuppressed() {
      throw new Error('settleSuppressed must not be called');
    },
    ...overrides,
  };
}

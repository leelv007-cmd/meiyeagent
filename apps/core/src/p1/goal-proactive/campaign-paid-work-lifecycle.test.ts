import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentRevisionRef } from '@meiye/contracts';

import {
  CampaignPaidWorkLifecycle,
  type CampaignPaidWorkLifecycleRecord,
  type CampaignPaidWorkLifecycleStore,
} from './campaign-paid-work-lifecycle.js';
import {
  CampaignPaidWorkProducer,
  type CampaignWorkSubmissionPort,
} from './campaign-weekly-schedule.js';

type Submission = {
  agentThreadId?: string;
  idempotencyKey: string;
  intent: string;
};

type Result = {
  contentPackage: { id: string };
  runId: string;
  task: { id: string };
  threadId: string;
  work: { id: string };
};

class MemoryLifecycleStore
  implements CampaignPaidWorkLifecycleStore<Submission, Result>
{
  readonly records = new Map<string, CampaignPaidWorkLifecycleRecord<Submission, Result>>();
  readonly delivered = new Set<string>();
  readonly claimed = new Set<string>();

  async create(record: CampaignPaidWorkLifecycleRecord<Submission, Result>) {
    const existing = this.records.get(record.campaignId);
    if (existing) return existing;
    this.records.set(record.campaignId, structuredClone(record));
    return structuredClone(record);
  }

  async get(workspaceId: string, campaignId: string) {
    const record = this.records.get(campaignId);
    return record?.workspaceId === workspaceId ? structuredClone(record) : null;
  }

  async isDelivered(workspaceId: string, taskId: string) {
    return this.delivered.has(`${workspaceId}:${taskId}`);
  }

  async listOpen(limit: number) {
    return [...this.records.values()]
      .filter((record) => !record.results[1])
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async claimWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number
  ) {
    const record = this.records.get(campaignId);
    assert.ok(record);
    assert.equal(record.workspaceId, workspaceId);
    if (record.results[workOrdinal - 1]) {
      return { kind: 'complete' as const, record: structuredClone(record) };
    }
    const claimKey = `${campaignId}:${workOrdinal}`;
    if (this.claimed.has(claimKey)) {
      return { kind: 'busy' as const, record: structuredClone(record) };
    }
    this.claimed.add(claimKey);
    return { kind: 'claimed' as const, record: structuredClone(record) };
  }

  async completeWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number,
    result: Result
  ) {
    const record = this.records.get(campaignId);
    assert.ok(record);
    assert.equal(record.workspaceId, workspaceId);
    record.results[workOrdinal - 1] ??= structuredClone(result);
    this.claimed.delete(`${campaignId}:${workOrdinal}`);
    return structuredClone(record);
  }

  async releaseWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number
  ) {
    assert.equal(this.records.get(campaignId)?.workspaceId, workspaceId);
    this.claimed.delete(`${campaignId}:${workOrdinal}`);
  }
}

class MemoryPlanApproval {
  readonly confirmed = new Set<string>();

  async isConfirmed(workspaceId: string, requestId: string) {
    return this.confirmed.has(`${workspaceId}:${requestId}`);
  }
}

function result(ordinal: number): Result {
  return {
    contentPackage: { id: `package-${ordinal}` },
    runId: `run-${ordinal}`,
    task: { id: `task-${ordinal}` },
    threadId: 'thread-campaign',
    work: { id: `work-${ordinal}` },
  };
}

test('Campaign starts only Work 1 and creates Work 2 only after real delivery', async () => {
  const submitted: Array<{
    campaignPlanRef: AgentRevisionRef;
    submission: Submission;
    workOrdinal: number;
  }> = [];
  const submissions: CampaignWorkSubmissionPort<Submission, Result> = {
    async submitCampaignWork(input) {
      submitted.push(structuredClone(input));
      return result(input.workOrdinal);
    },
  };
  const store = new MemoryLifecycleStore();
  const planApproval = new MemoryPlanApproval();
  const lifecycle = new CampaignPaidWorkLifecycle(
    store,
    new CampaignPaidWorkProducer(submissions),
    planApproval
  );
  const campaignPlanRef = { id: 'campaign-plan-1', revision: 1 };

  const started = await lifecycle.start({
    campaignId: 'campaign-1',
    campaignPlanRef,
    planApprovalRequestId: 'confirmation-campaign-plan-1',
    submissions: [
      { idempotencyKey: 'campaign-1-work-1', intent: '第一周护理海报' },
      { idempotencyKey: 'campaign-1-work-2', intent: '第二周补水海报' },
    ],
    workspaceId: 'workspace-1',
  });

  assert.equal(submitted.length, 0, 'plan_only must gate Work 1');
  await lifecycle.advance('workspace-1', 'campaign-1');
  assert.equal(submitted.length, 0, 'pending plan must not create paid Work');

  planApproval.confirmed.add(
    'workspace-1:confirmation-campaign-plan-1'
  );
  const afterPlanConfirmation = await lifecycle.advance(
    'workspace-1',
    'campaign-1'
  );
  assert.deepEqual(
    submitted.map(({ workOrdinal }) => workOrdinal),
    [1]
  );
  assert.equal(started.results[0], undefined);
  assert.equal(afterPlanConfirmation.results[0]?.task.id, 'task-1');
  assert.equal(afterPlanConfirmation.results[1], undefined);

  await lifecycle.advance('workspace-1', 'campaign-1');
  assert.equal(submitted.length, 1, 'delivery is required before Work 2');

  store.delivered.add('workspace-1:task-1');
  const advanced = await lifecycle.advance('workspace-1', 'campaign-1');

  assert.deepEqual(
    submitted.map(({ campaignPlanRef: ref, submission, workOrdinal }) => ({
      agentThreadId: submission.agentThreadId,
      campaignPlanRef: ref,
      workOrdinal,
    })),
    [
      { agentThreadId: undefined, campaignPlanRef, workOrdinal: 1 },
      {
        agentThreadId: 'thread-campaign',
        campaignPlanRef,
        workOrdinal: 2,
      },
    ]
  );
  assert.equal(advanced.results[1]?.task.id, 'task-2');
});

test('Campaign advancement is replay-safe after Work 2 exists', async () => {
  let submissions = 0;
  const store = new MemoryLifecycleStore();
  const planApproval = new MemoryPlanApproval();
  const lifecycle = new CampaignPaidWorkLifecycle(
    store,
    new CampaignPaidWorkProducer<Submission, Result>({
      async submitCampaignWork({ workOrdinal }) {
        submissions += 1;
        return result(workOrdinal);
      },
    }),
    planApproval
  );

  await lifecycle.start({
    campaignId: 'campaign-replay',
    campaignPlanRef: { id: 'campaign-plan-replay', revision: 1 },
    planApprovalRequestId: 'confirmation-campaign-replay',
    submissions: [
      { idempotencyKey: 'replay-1', intent: '第一周' },
      { idempotencyKey: 'replay-2', intent: '第二周' },
    ],
    workspaceId: 'workspace-1',
  });
  planApproval.confirmed.add(
    'workspace-1:confirmation-campaign-replay'
  );
  await lifecycle.advance('workspace-1', 'campaign-replay');
  store.delivered.add('workspace-1:task-1');

  await Promise.all([
    lifecycle.advance('workspace-1', 'campaign-replay'),
    lifecycle.advance('workspace-1', 'campaign-replay'),
  ]);
  await lifecycle.advance('workspace-1', 'campaign-replay');

  assert.equal(submissions, 2);
});

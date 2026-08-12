import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyComposerWorkflowState,
  bindComposerTask,
  createComposerSession,
  type ComposerDeliveryTurn,
  type ComposerSession,
} from './composer-session';
import { campaignPaidWorkProjectionSchema } from './campaign-paid-work-client';
import { nextCampaignWorkToBind } from './campaign-paid-work-binding';

const WORK_1 = {
  packageId: 'package-1',
  taskId: 'task-1',
  workId: 'work-1',
};

const CAMPAIGN = campaignPaidWorkProjectionSchema.parse({
  campaignId: 'campaign-1',
  campaignPlanRef: { id: 'campaign-1:plan', revision: 1 },
  planApproval: {
    approvalScope: 'plan_only',
    planOnlyNotice: 'This confirmation approves scheduling only.',
    requestId: 'confirmation-campaign-1-plan',
    reservedCredits: 0,
    status: 'confirmed',
  },
  works: [createdWork(1), createdWork(2)],
});

test('Campaign binding starts with Work 1 when both Works are projected', () => {
  const next = nextCampaignWorkToBind({
    boundOrdinal: 0,
    campaign: CAMPAIGN,
    currentTask: null,
    turns: [],
  });

  assert.equal(next?.workOrdinal, 1);
  assert.equal(next?.task.id, 'task-1');
});

test('Campaign binding holds Work 2 until the exact Work 1 delivery is projected', () => {
  const running = bindComposerTask(createComposerSession('session-1'), WORK_1);
  assert.equal(nextWork(running), null);
  assert.equal(nextWork(withDelivery(running, { taskId: 'task-other' })), null);
  assert.equal(nextWork(withDelivery(running, { workId: 'work-other' })), null);

  const delivered = applyComposerWorkflowState(running, 'success');
  const next = nextWork(delivered);
  assert.equal(next?.workOrdinal, 2);

  const advanced = bindComposerTask(delivered, {
    packageId: next!.contentPackage.id,
    taskId: next!.task.id,
    workId: next!.work.id,
  });
  assert.deepEqual(
    advanced.turns
      .filter((turn) => turn.kind === 'delivery')
      .map(({ taskId, workId }) => ({ taskId, workId })),
    [{ taskId: 'task-1', workId: 'work-1' }]
  );
  assert.equal(advanced.task?.taskId, 'task-2');
  assert.equal(
    nextCampaignWorkToBind({
      boundOrdinal: 2,
      campaign: CAMPAIGN,
      currentTask: advanced.task,
      turns: advanced.turns,
    }),
    null
  );
});

test('Campaign binding rejects delivery from a non-Campaign current task', () => {
  const unrelated = applyComposerWorkflowState(
    bindComposerTask(createComposerSession('session-1'), {
      packageId: 'package-other',
      taskId: 'task-other',
      workId: 'work-other',
    }),
    'success'
  );

  assert.equal(nextWork(unrelated), null);
});

function createdWork(workOrdinal: 1 | 2) {
  return {
    approvalScope: 'single_work' as const,
    contentPackage: {
      expectedRevision: 0,
      id: `package-${workOrdinal}`,
    },
    makeReady: false,
    replayed: false,
    runId: `run-${workOrdinal}`,
    snapshot: {
      id: `snapshot-${workOrdinal}`,
      identity: { id: 'identity-1', revision: '1' },
      schemaVersion: 'creation-execution-snapshot/v1',
    },
    task: { id: `task-${workOrdinal}` },
    threadId: 'thread-1',
    usageReservation: { id: `reservation-${workOrdinal}` },
    work: { id: `work-${workOrdinal}` },
    workOrdinal,
  };
}

function nextWork(session: ComposerSession) {
  return nextCampaignWorkToBind({
    boundOrdinal: 1,
    campaign: CAMPAIGN,
    currentTask: session.task,
    turns: session.turns,
  });
}

function withDelivery(
  session: ComposerSession,
  overrides: Partial<ComposerDeliveryTurn>
): ComposerSession {
  return {
    ...session,
    turns: [
      ...session.turns,
      {
        id: 'delivery:work-1',
        kind: 'delivery',
        packageId: 'package-1',
        revision: null,
        taskId: 'task-1',
        workId: 'work-1',
        ...overrides,
      },
    ],
  };
}

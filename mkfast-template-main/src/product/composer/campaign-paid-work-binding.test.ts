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
import {
  nextCampaignWorkToBind,
  selectCampaignLivingPlanBinding,
} from './campaign-paid-work-binding';

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
    phase: 'idle',
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
  assert.equal(
    nextWork(withDelivery(running, {}))?.workOrdinal,
    2,
    'delivery card in the thread is enough; do not wait for phase=delivered'
  );

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
      phase: advanced.phase,
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

test('Campaign binding rejects retained delivery after a late failed state', () => {
  const delivered = applyComposerWorkflowState(
    bindComposerTask(createComposerSession('session-1'), WORK_1),
    'success'
  );
  const failed = applyComposerWorkflowState(delivered, 'failed');

  assert.equal(failed.phase, 'failed');
  assert.equal(
    failed.turns.some(
      (turn) =>
        turn.kind === 'delivery' &&
        turn.taskId === WORK_1.taskId &&
        turn.workId === WORK_1.workId
    ),
    true
  );
  assert.equal(nextWork(failed), null);
});

test('Campaign binding advances sequential Work 2 without a session delivery turn', () => {
  const running = bindComposerTask(createComposerSession('session-1'), WORK_1);
  assert.equal(running.phase, 'running');
  assert.equal(
    running.turns.some((turn) => turn.kind === 'delivery'),
    false,
    'Work 1 can still be generating; the visible delivery card is not this turn'
  );

  const next = nextCampaignWorkToBind({
    boundOrdinal: 1,
    campaign: CAMPAIGN,
    currentTask: running.task,
    holdSuccessorUntilDelivery: false,
    phase: running.phase,
    turns: [],
  });

  assert.equal(next?.workOrdinal, 2);
  assert.equal(next?.task.id, 'task-2');
  assert.equal(next?.executionConfirmationRequestId, 'confirmation-work-2');
  assert.notEqual(
    next?.executionConfirmationRequestId,
    createdWork(1).executionConfirmationRequestId
  );
});

test('Campaign living plan start prefers bound Work 2 over overlay Work 1', () => {
  const binding = selectCampaignLivingPlanBinding({
    boundWork: createdWork(2),
    overlayTask: {
      packageId: 'package-1',
      taskId: 'task-1',
      workId: 'work-1',
      executionConfirmationRequestId: 'confirmation-work-1',
    },
  });

  assert.equal(binding.taskId, 'task-2');
  assert.equal(binding.executionConfirmationRequestId, 'confirmation-work-2');
  assert.notEqual(
    binding.executionConfirmationRequestId,
    'confirmation-work-1'
  );
});

test('Campaign projection rejects a missing Work ordinal', () => {
  assert.throws(() =>
    campaignPaidWorkProjectionSchema.parse({
      ...CAMPAIGN,
      works: [createdWork(1), createdWork(1)],
    })
  );
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
    executionConfirmationRequestId: `confirmation-work-${workOrdinal}`,
  };
}

function nextWork(session: ComposerSession) {
  return nextCampaignWorkToBind({
    boundOrdinal: 1,
    campaign: CAMPAIGN,
    currentTask: session.task,
    phase: session.phase,
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

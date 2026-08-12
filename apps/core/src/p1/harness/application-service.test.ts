import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessApplicationService,
  HarnessInteractionTaskMismatchError,
  type HarnessInteractionApplicationPort,
  type HarnessSuccessorConfirmationPort,
  type HarnessSuccessorConfirmationProjection,
} from './application-service.js';
import { HarnessInteractionError } from './interaction-service.js';
import type { HarnessDecisionService } from './decision-service.js';
import type { HarnessTaskAdmissionService } from './task-admission.js';

const WORKSPACE = 'workspace-succ';
const ORIGINAL_TASK = 'task-original';
const SUCCESSOR_WORKFLOW = 'task-successor:plan:2:hash-succ';
const SUCCESSOR_TASK = 'task-successor';
const SUCCESSOR_REQUEST = 'confirmation:original:r:1';

function successorProjection(
  confirmationStatus: 'pending' | 'decided' = 'pending',
): HarnessSuccessorConfirmationProjection {
  return {
    successorWorkflowId: SUCCESSOR_WORKFLOW,
    successorTaskId: SUCCESSOR_TASK,
    planRevision: 2,
    confirmationStatus,
    request: {
      workflowRevision: 4,
      executionConfirmationRequestId: SUCCESSOR_REQUEST,
      executionConfirmationReservedCredits: 6,
      executionSnapshot: {
        id: 'submission-succ',
        revision: 4,
        quote: { revision: 'r2' },
        operation: 'note_generation',
        catalogModel: { id: 'copy-model-1', revision: 'catalog-r1' },
        deliverable: { kind: 'note' },
        distributionTarget: 'xiaohongshu',
        work: { id: 'work-succ' },
        contentPackage: { id: 'package-succ' },
      },
    },
  };
}

function service(input: {
  projection?: HarnessSuccessorConfirmationProjection | null;
  starts?: Array<{ workspaceId: string; taskId: string; planRevision: number }>;
  interactions?: Partial<HarnessInteractionApplicationPort>;
}) {
  const successorConfirmations: HarnessSuccessorConfirmationPort = {
    async readPendingSuccessorConfirmation(workspaceId, taskId) {
      return workspaceId === WORKSPACE && taskId === ORIGINAL_TASK
        ? (input.projection ?? null)
        : null;
    },
    async startConfirmedSuccessor(start) {
      input.starts?.push(start);
    },
  };
  const interactions: HarnessInteractionApplicationPort = {
    async ackRenderer() {
      throw new HarnessInteractionError(
        'STALE_INTERACTION_REQUEST',
        'The interaction request is no longer pending.',
      );
    },
    async readForCarrier() {
      return null;
    },
    async readWaitingMessageForCarrier() {
      return null;
    },
    async setEditing() {},
    async submit() {
      return { kind: 'resumed' as const, replayed: false };
    },
    async submitMerchantMessage() {
      return { kind: 'resumed' as const, replayed: false };
    },
    ...input.interactions,
  };
  return new HarnessApplicationService(
    // Admission and decisions are untouched by the successor projection paths.
    {} as unknown as HarnessTaskAdmissionService,
    {} as unknown as HarnessDecisionService,
    {
      async taskBelongsToWorkspace(taskId, workspaceId) {
        return workspaceId === WORKSPACE && taskId === ORIGINAL_TASK;
      },
    },
    undefined,
    undefined,
    undefined,
    interactions,
    successorConfirmations,
  );
}

function successorAnswer(response: { kind: 'approved' | 'rejected' }) {
  return {
    requestId: SUCCESSOR_REQUEST,
    revision: 4,
    idempotencyKey: `composer-interaction:${SUCCESSOR_REQUEST}:r4:merchant`,
    resume: { runId: SUCCESSOR_WORKFLOW, step: 'execution_selection' },
    response,
  };
}

test('a pending reprice successor projects an execution confirmation card into the original thread', async () => {
  const app = service({ projection: successorProjection() });
  const request = await app.readPendingInteraction(WORKSPACE, ORIGINAL_TASK);
  assert.ok(request);
  assert.equal(request.kind, 'execution_confirmation');
  assert.equal(request.requestId, SUCCESSOR_REQUEST);
  assert.equal(request.runId, SUCCESSOR_WORKFLOW);
  assert.equal(request.step, 'execution_selection');
  assert.equal(request.revision, 4);
  if (request.kind !== 'execution_confirmation') return;
  assert.equal(request.frozen.reservedCredits, 6);
  assert.equal(request.frozen.quoteRevision, 'r2');
  assert.ok(
    (request.presentation.carriers as readonly string[]).includes(
      'conversation',
    ),
  );
});

test('a decided successor confirmation no longer projects a card', async () => {
  const app = service({ projection: successorProjection('decided') });
  assert.equal(
    await app.readPendingInteraction(WORKSPACE, ORIGINAL_TASK),
    null,
  );
});

test('an approved successor answer starts the prepared successor and returns its task handle', async () => {
  const starts: Array<{
    workspaceId: string;
    taskId: string;
    planRevision: number;
  }> = [];
  // The browser decides first, so the projection is 'decided' by the time the
  // interaction answer arrives — the answer path must still match it.
  const app = service({ projection: successorProjection('decided'), starts });
  const result = await app.submitInteraction(
    WORKSPACE,
    ORIGINAL_TASK,
    successorAnswer({ kind: 'approved' }),
  );
  assert.deepEqual(starts, [
    { workspaceId: WORKSPACE, taskId: SUCCESSOR_TASK, planRevision: 2 },
  ]);
  assert.deepEqual(result, {
    kind: 'resumed',
    replayed: false,
    successorTask: {
      taskId: SUCCESSOR_TASK,
      workId: 'work-succ',
      packageId: 'package-succ',
    },
  });
});

test('a rejected successor answer resolves without starting anything', async () => {
  const starts: Array<{
    workspaceId: string;
    taskId: string;
    planRevision: number;
  }> = [];
  const app = service({ projection: successorProjection('decided'), starts });
  const result = await app.submitInteraction(
    WORKSPACE,
    ORIGINAL_TASK,
    successorAnswer({ kind: 'rejected' }),
  );
  assert.deepEqual(starts, []);
  assert.deepEqual(result, { kind: 'resumed', replayed: false });
});

test('a foreign run id with no matching successor projection stays a 409', async () => {
  const app = service({ projection: null });
  await assert.rejects(
    app.submitInteraction(
      WORKSPACE,
      ORIGINAL_TASK,
      successorAnswer({ kind: 'approved' }),
    ),
    (error: unknown) =>
      error instanceof HarnessInteractionTaskMismatchError &&
      error.status === 409,
  );
});

test('an answer whose identity does not match the projection stays a 409', async () => {
  const app = service({ projection: successorProjection() });
  await assert.rejects(
    app.submitInteraction(WORKSPACE, ORIGINAL_TASK, {
      ...successorAnswer({ kind: 'approved' }),
      requestId: 'confirmation:someone-else',
    }),
    (error: unknown) => error instanceof HarnessInteractionTaskMismatchError,
  );
});

test('a same-run answer still goes through the durable interaction store', async () => {
  const submitted: unknown[] = [];
  const app = service({
    projection: successorProjection(),
    interactions: {
      async submit(_workspaceId, answer) {
        submitted.push(answer);
        return { kind: 'resumed' as const, replayed: true };
      },
    },
  });
  const answer = {
    ...successorAnswer({ kind: 'approved' }),
    resume: { runId: ORIGINAL_TASK, step: 'execution_selection' },
  };
  const result = await app.submitInteraction(WORKSPACE, ORIGINAL_TASK, answer);
  assert.deepEqual(result, { kind: 'resumed', replayed: true });
  assert.deepEqual(submitted, [answer]);
});

test('a renderer ack that names the projected successor card is accepted despite the stale store', async () => {
  const app = service({ projection: successorProjection() });
  await app.ackInteractionRenderer(WORKSPACE, ORIGINAL_TASK, {
    requestId: SUCCESSOR_REQUEST,
    revision: 4,
    step: 'execution_selection',
    carrier: 'conversation',
  });
});

test('a renderer ack for anything else keeps the stale rejection', async () => {
  const app = service({ projection: successorProjection() });
  await assert.rejects(
    app.ackInteractionRenderer(WORKSPACE, ORIGINAL_TASK, {
      requestId: 'confirmation:someone-else',
      revision: 4,
      step: 'execution_selection',
      carrier: 'conversation',
    }),
    (error: unknown) =>
      error instanceof HarnessInteractionError &&
      error.code === 'STALE_INTERACTION_REQUEST',
  );
});

/**
 * V31-11 confirmation-objects final merge:
 * ① confirm gate → createRequest idempotent wiring;
 * ② execution-time settlement never double-debits a confirmation hold
 *    (U8=A — confirmation-time reserve shares the Coordinator operation id).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planConfirmationDecisionSchema } from '@meiye/contracts';

import {
  MemoryExecutionConfirmationRequestStore,
  MemoryPlanConfirmationDecisionStore,
} from '../agent-session/memory-execution-confirmation-store.js';
import {
  confirmationCreditPortFromMemoryLedger,
  type CreateExecutionConfirmationResult,
  ExecutionConfirmationService,
} from '../agent-session/execution-confirmation-service.js';
import {
  creditUsageOperationId,
  MemoryCreditLedger,
} from '../credit-billing/credit-ledger.js';
import { HarnessExecutionFenceSafeStopError } from './context-fence.js';
import {
  confirmPaidGenerationExecution,
  PaidExecutionRequiresSuccessorAdmissionError,
} from './paid-generation-confirmation.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';

const CREATED = '2026-08-08T12:00:00.000Z';

function paidRequest(overrides: {
  taskId?: string;
  credits?: number;
  plan?: boolean;
  authorityRevisionRefs?: string[];
} = {}): HarnessWorkflowInput {
  const taskId = overrides.taskId ?? 'task-1';
  const content = {
    planId: 'plan-1',
    planRevision: 3,
    intentDeclaration: { summary: 'image' },
    contextBundleRef: { bundleId: 'bundle-1', revision: 1, hash: 'ctx-1' },
    executionPlan: {
      schemaVersion: 'compiled-execution-plan/v1',
      units: [{ unitId: 'unit-1', unitType: 'media.generate', primitive: 'generate' }],
      dependencyGroups: [{ groupId: 'group-1', unitIds: ['unit-1'] }],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 1,
          maxCostCents: 0,
          retry: { enabled: false },
        },
      },
    },
    deliverables: [{ deliverableId: 'deliverable-1', kind: 'media', quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 'r1' },
    rightsRevisionRefs: [],
    factRevisionRefs: [],
    ...(overrides.authorityRevisionRefs
      ? { authorityRevisionRefs: overrides.authorityRevisionRefs }
      : {}),
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 1,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 0,
      requiredLimits: [],
      consumption: { iterations: 0, costCents: 0, wallClockMs: 0, delegations: 0 },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'merchant_confirmed',
  } as unknown as ExecutionPlanFrozenContent;
  return {
    actorId: 'merchant-1',
    workspaceId: 'ws-1',
    packageId: 'p-1',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: 'image',
    intent: {
      context: { workId: 'w-1', intent: 'image', sourceSummaries: [] },
      assetReferences: [],
    },
    executionSnapshot: {
      createdAt: CREATED,
      id: 'snap-1',
      quote: { id: 'quote-1', revision: 'r1' },
      task: { id: taskId },
      lens: 'image',
    },
    ...(overrides.plan
      ? { pendingExecutionPlanSnapshot: freezeExecutionPlanContent(content) }
      : {}),
    usageReservation: {
      id: `usage-reservation-${taskId}`,
      ...(overrides.credits !== undefined
        ? { credits: overrides.credits, units: [] }
        : { units: [{ resource: 'image', quantity: 1 }] }),
    },
  } as unknown as HarnessWorkflowInput;
}

function approve(decisions: number[] = []) {
  let turn = 0;
  return {
    awaitResolvedDecision: async (question: unknown) => {
      const next = decisions[turn] ?? 0;
      turn += 1;
      return {
        questionId: (question as { questionId: string }).questionId,
        workflowRevision: 1,
        idempotencyKey: `k-${turn}`,
        patch: { field: 'execution_confirmation', value: 'approved' },
        decision: { state: 'accepted', value: 'approved' },
        ...(next === 0 ? {} : { cancel: true }),
      } as never;
    },
  };
}

function makeService(credits = 20) {
  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-1',
    workspaceId: 'ws-1',
    credits,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const service = new ExecutionConfirmationService(
    new MemoryExecutionConfirmationRequestStore(),
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
  );
  return { service, ledger };
}

test('confirm gate attaches the immutable domain decision and admits the paid snapshot', async () => {
  const request = paidRequest({ credits: 7, plan: true });
  const admissions: string[] = [];
  const decisionReads: Array<[string, string]> = [];
  let waits = 0;
  const out = await confirmPaidGenerationExecution({
    workflowId: 'wf-1',
    request,
    reportProgress: async () => undefined,
    getExecutionConfirmationDecision: async (workspaceId, requestId) => {
      decisionReads.push([workspaceId, requestId]);
      return planConfirmationDecisionSchema.parse({
        schemaVersion: 'plan-confirmation-decision/v1',
        decisionId: 'decision-paid-1',
        requestId,
        actorId: 'merchant-1',
        decision: 'confirmed',
        decidedAt: CREATED,
      });
    },
    admitExecutionPlanSnapshot: async ({ snapshot }) => {
      admissions.push(snapshot.snapshotHash);
      return buildExecutionPlanSnapshot({
        content: request.pendingExecutionPlanSnapshot!.content,
        snapshotHash: request.pendingExecutionPlanSnapshot!.snapshotHash,
        confirmationDecisionRef: 'decision-paid-1',
      });
    },
    awaitResolvedDecision: async (question) => {
      waits += 1;
      return approve().awaitResolvedDecision(question);
    },
    applyCurrentTaskDecision: async (_wf, req) => req,
  });
  assert.equal(out.executionPlanSnapshot?.confirmationDecisionRef, 'decision-paid-1');
  assert.equal(out.executionPlanSnapshot?.approvalBasis, 'merchant_confirmed');
  assert.deepEqual(admissions, [request.pendingExecutionPlanSnapshot!.snapshotHash]);
  // Pre-confirmed domain decision must admit without a second merchant wait
  // (Living Plan decide→start; V31-56 delivery projection).
  assert.equal(waits, 0);
  // Pre-check + admitConfirmedExecutionPlan both read the domain decision.
  assert.deepEqual(decisionReads, [
    ['ws-1', 'confirmation:wf-1'],
    ['ws-1', 'confirmation:wf-1'],
  ]);
});

test('pre-confirmed Living Plan start admits without re-suspending for interaction', async () => {
  const request = paidRequest({ credits: 15, plan: true });
  request.executionConfirmationRequestId = 'confirmation:living-plan-start';
  const progress: Array<{ state: string }> = [];
  let waits = 0;
  const out = await confirmPaidGenerationExecution({
    workflowId: 'composer-task:living-plan:plan-r1',
    request,
    reportProgress: async (event) => {
      progress.push({ state: event.state });
    },
    getExecutionConfirmationDecision: async (_workspaceId, requestId) =>
      planConfirmationDecisionSchema.parse({
        schemaVersion: 'plan-confirmation-decision/v1',
        decisionId: `living-plan-commit:${requestId}`,
        requestId,
        actorId: 'merchant-1',
        decision: 'confirmed',
        decidedAt: CREATED,
      }),
    admitExecutionPlanSnapshot: async ({ snapshot }) =>
      buildExecutionPlanSnapshot({
        content: request.pendingExecutionPlanSnapshot!.content,
        snapshotHash: request.pendingExecutionPlanSnapshot!.snapshotHash,
        confirmationDecisionRef: `living-plan-commit:${request.executionConfirmationRequestId}`,
      }),
    awaitResolvedDecision: async () => {
      waits += 1;
      throw new Error('pre-confirmed start must not wait on interaction resume');
    },
    applyCurrentTaskDecision: async () => {
      throw new Error('pre-confirmed start must not apply a merchant re-answer');
    },
  });
  assert.equal(waits, 0);
  assert.equal(out.executionPlanSnapshot?.approvalBasis, 'merchant_confirmed');
  assert.equal(
    out.executionPlanSnapshot?.confirmationDecisionRef,
    'living-plan-commit:confirmation:living-plan-start',
  );
  assert.deepEqual(
    progress.map((item) => item.state),
    ['success'],
  );
});

test('confirm gate fails closed when a pending paid freeze has no domain decision reader', async () => {
  await assert.rejects(
    confirmPaidGenerationExecution({
      workflowId: 'wf-1',
      request: paidRequest({ credits: 7, plan: true }),
      reportProgress: async () => undefined,
      ...approve(),
      applyCurrentTaskDecision: async (_wf, req) => req,
    }),
    /cannot start without confirmation decision/u,
  );
});

test('post-confirm rights revocation safe-stops with merchant 授权已撤销 copy', async () => {
  const request = paidRequest({ credits: 15, plan: true });
  request.executionConfirmationRequestId = 'confirmation:rights-revoked';
  await assert.rejects(
    confirmPaidGenerationExecution({
      workflowId: 'wf-rights-revoked',
      request,
      reportProgress: async () => undefined,
      getExecutionConfirmationDecision: async (_workspaceId, requestId) =>
        planConfirmationDecisionSchema.parse({
          schemaVersion: 'plan-confirmation-decision/v1',
          decisionId: `decision:${requestId}`,
          requestId,
          actorId: 'merchant-1',
          decision: 'confirmed',
          decidedAt: CREATED,
        }),
      resolveExecutionPlanLiveFacts: async () => ({ rightsRevoked: true }),
      admitExecutionPlanSnapshot: async () => {
        throw new Error('revoked rights must not admit a snapshot');
      },
      awaitResolvedDecision: async () => {
        throw new Error('revoked rights must not re-wait merchant confirmation');
      },
      applyCurrentTaskDecision: async () => {
        throw new Error('revoked rights must not apply a merchant re-answer');
      },
    }),
    (error: unknown) =>
      error instanceof HarnessExecutionFenceSafeStopError &&
      error.code === 'HARNESS_EXECUTION_FENCE_SAFE_STOP' &&
      error.noAdditionalCharge === true &&
      error.refundIfReserved === true &&
      /授权已撤销/u.test(error.merchantMessage),
  );
});

test('post-confirm live quote drift requires a new immutable admission attempt', async () => {
  const request = paidRequest({ credits: 7, plan: true });
  request.executionConfirmationRequestId = 'confirmation-authority-r1';
  request.executionConfirmationReservationIdempotencyKey =
    'consume:task:wf-drift';
  let questions = 0;
  let refreshed = 0;
  let created = 0;
  let authorityWrites = 0;
  let admissions = 0;
  // Domain decisions only exist after the merchant interaction wait resolves —
  // not before the first suspend (contrast Living Plan decide→start).
  const decidedRequestIds = new Set<string>();
  await assert.rejects(
    confirmPaidGenerationExecution({
      workflowId: 'wf-drift',
      request,
      reportProgress: async () => undefined,
      awaitResolvedDecision: async (question) => {
        questions += 1;
        decidedRequestIds.add(question.questionId);
        return approve().awaitResolvedDecision(question);
      },
      applyCurrentTaskDecision: async (_wf, req) => req,
      getExecutionConfirmationDecision: async (_workspaceId, requestId) => {
        if (!decidedRequestIds.has(requestId)) return null;
        return planConfirmationDecisionSchema.parse({
          schemaVersion: 'plan-confirmation-decision/v1',
          decisionId: `decision-${requestId}`,
          requestId,
          actorId: 'merchant-1',
          decision: 'confirmed',
          decidedAt: CREATED,
        });
      },
      resolveExecutionPlanLiveFacts: async () => ({ quoteRevision: 'r2' }),
      // These ports must remain unused: only a new admission transaction may
      // persist the replacement authority, hold and task request.
      refreshExecutionPlanLiveBindings: async () => {
        refreshed += 1;
        throw new Error('old workflow must not refresh a successor plan');
      },
      putExecutionConfirmationAuthority: async () => {
        authorityWrites += 1;
        throw new Error('old workflow must not write a successor authority');
      },
      createExecutionConfirmationRequest: async () => {
        created += 1;
        throw new Error('old workflow must not reserve a successor hold');
      },
      admitExecutionPlanSnapshot: async () => {
        admissions += 1;
        throw new Error('old workflow must not admit a successor snapshot');
      },
    }),
    (error: unknown) =>
      error instanceof PaidExecutionRequiresSuccessorAdmissionError &&
      error.code === 'REQUIRES_SUCCESSOR_ADMISSION' &&
      error.status === 409 &&
      error.details.workflowId === 'wf-drift' &&
      error.details.confirmationRequestId === 'confirmation-authority-r1' &&
      error.details.repricedSuccessorAuthority === 'unavailable' &&
      error.details.diffFields.includes('quote'),
  );
  assert.equal(questions, 1);
  assert.equal(refreshed, 0);
  assert.equal(authorityWrites, 0);
  assert.equal(created, 0);
  assert.equal(admissions, 0);
  assert.equal(
    request.executionConfirmationReservationIdempotencyKey,
    'consume:task:wf-drift',
  );
});

test('post-confirm identity drift fails closed without creating a price successor', async () => {
  const request = paidRequest({
    credits: 7,
    plan: true,
    authorityRevisionRefs: ['identity:identity-1@1'],
  });
  let successorCreates = 0;

  await assert.rejects(
    confirmPaidGenerationExecution({
      workflowId: 'wf-authority-drift',
      request,
      reportProgress: async () => undefined,
      awaitResolvedDecision: approve().awaitResolvedDecision,
      applyCurrentTaskDecision: async (_workflowId, current) => current,
      getExecutionConfirmationDecision: async (_workspaceId, requestId) =>
        planConfirmationDecisionSchema.parse({
          schemaVersion: 'plan-confirmation-decision/v1',
          decisionId: `decision-${requestId}`,
          requestId,
          actorId: 'merchant-1',
          decision: 'confirmed',
          decidedAt: CREATED,
        }),
      resolveExecutionPlanLiveFacts: async () => ({
        quoteRevision: 'r1',
        authorityRevisionRefs: ['identity:identity-1@2'],
        contextDrifted: true,
      }),
      createRepricedPaidExecutionSuccessor: async () => {
        successorCreates += 1;
        return {
          kind: 'created',
          submission: {
            task: { id: 'must-not-create' },
            confirmationDispatch: { requestId: 'must-not-create' },
          },
        };
      },
      admitExecutionPlanSnapshot: async () => {
        throw new Error('authority drift must not admit');
      },
    }),
    (error: unknown) =>
      error instanceof PaidExecutionRequiresSuccessorAdmissionError &&
      error.details.diffFields.includes('authorityRevisionRefs'),
  );
  assert.equal(successorCreates, 0);
});

function confirmationResult(
  requestId: string,
  reservationIdempotencyKey = 'consume:task:test',
): CreateExecutionConfirmationResult {
  return {
    stored: { request: { requestId, reservationIdempotencyKey } },
  } as CreateExecutionConfirmationResult;
}

test('submission-time reserve + confirmation-time reserve collapse into one debit (U8=A)', async () => {
  const { service, ledger } = makeService(20);
  const taskId = 'task-hold-1';
  const operationId = creditUsageOperationId(taskId);

  // Coordinator submission already consumed the same operation id (old chain).
  await ledger.consume({
    workspaceId: 'ws-1',
    credits: 5,
    transactionId: operationId,
    actorId: 'merchant-1',
    correlationId: `coordinator:${taskId}`,
    createdAt: CREATED,
  });
  assert.equal((await ledger.project('ws-1', CREATED)).availableCredits, 15);

  // Confirmation gate createRequest reuses the operation id — idempotent replay.
  const created = await service.createRequest({
    requestId: 'confirmation:wf-hold-1',
    workspaceId: 'ws-1',
    planId: 'plan-1',
    planRevision: 1,
    snapshotHash: 'snap-hash-1',
    quoteRef: { id: 'quote-1', revision: 'r1' },
    reservationIdempotencyKey: operationId,
    createdAt: CREATED,
    holdExpiresAt: '2026-08-09T12:00:00.000Z',
    actorId: 'merchant-1',
    creditCost: 5,
    failureRefundsCredits: true,
  });
  assert.equal(created.reservedCredits, 5);

  // Still one debit: settlement consumes the already-reserved hold, never again.
  const after = await ledger.project('ws-1', CREATED);
  assert.equal(after.availableCredits, 15);
  assert.equal(after.usedCredits, 5);

  // Failure refund releases the same operation id exactly once, back to 20.
  await ledger.refundUsageOperation({
    workspaceId: 'ws-1',
    usageOperationId: operationId,
    refundOperationId: 'credit-refund:task-hold-1',
    actorId: 'system-harness',
    correlationId: `harness:${taskId}`,
    createdAt: CREATED,
  });
  const refunded = await ledger.project('ws-1', CREATED);
  assert.equal(refunded.availableCredits, 20);
  assert.equal(refunded.usedCredits, 5);
  assert.equal(refunded.refundedCredits, 5);
});

test('same requestId re-entry never reserves twice at the confirm gate', async () => {
  const { service, ledger } = makeService(20);
  const operationId = creditUsageOperationId('task-replay-1');
  const input = {
    requestId: 'confirmation:wf-replay-1',
    workspaceId: 'ws-1',
    planId: 'plan-1',
    planRevision: 1,
    snapshotHash: 'snap-hash-1',
    quoteRef: { id: 'quote-1', revision: 'r1' },
    reservationIdempotencyKey: operationId,
    createdAt: CREATED,
    holdExpiresAt: '2026-08-09T12:00:00.000Z',
    actorId: 'merchant-1',
    creditCost: 4,
    failureRefundsCredits: true,
  };

  // DBOS replay re-enters the approved branch with the same request facts.
  const first = await service.createRequest(input);
  const replay = await service.createRequest(input);
  assert.equal(first.reservedCredits, 4);
  assert.equal(replay.reservedCredits, 4);
  assert.equal(replay.stored.request.requestId, input.requestId);
  const after = await ledger.project('ws-1', CREATED);
  assert.equal(after.usedCredits, 4);
  assert.equal(after.availableCredits, 16);
});

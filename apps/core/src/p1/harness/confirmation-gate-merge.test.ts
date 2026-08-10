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
import { confirmPaidGenerationExecution } from './paid-generation-confirmation.js';
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

test('post-confirm live quote drift creates a diff-bound request and requires re-confirmation', async () => {
  const request = paidRequest({ credits: 7, plan: true });
  request.executionConfirmationRequestId = 'confirmation-authority-r1';
  request.executionConfirmationReservationIdempotencyKey =
    'consume:task:wf-drift';
  const questions: string[] = [];
  const created: Array<{ requestId: string; quoteRevision: number | string }> = [];
  const admissionWorkflowIds: string[] = [];
  // Domain decisions only exist after the merchant interaction wait resolves —
  // not before the first suspend (contrast Living Plan decide→start).
  const decidedRequestIds = new Set<string>();
  let authoritativeSnapshotHash = '';
  let liveReads = 0;
  let activeReservationId: string | undefined;
  const out = await confirmPaidGenerationExecution({
    workflowId: 'wf-drift',
    request,
    reportProgress: async () => undefined,
    awaitResolvedDecision: async (question) => {
      questions.push(`${question.questionId}:${question.question}`);
      decidedRequestIds.add(question.questionId);
      if (questions.length === 2) {
        assert.equal(
          activeReservationId,
          'consume:confirmation:successor-r2',
          'successor settlement authority must publish before the second decision wait',
        );
      }
      return approve().awaitResolvedDecision(question);
    },
    onActiveRequest(activeRequest) {
      activeReservationId =
        activeRequest.executionConfirmationReservationIdempotencyKey;
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
    resolveExecutionPlanLiveFacts: async ({ snapshot }) => {
      liveReads += 1;
      return {
        quoteRevision: liveReads === 1 ? 'r2' : snapshot.quoteRef.revision,
      };
    },
    refreshExecutionPlanLiveBindings: async (input) => ({
      revision: {
        planId: input.planId,
        revision: input.expectedRevision + 1,
        quoteRef: input.quoteRef,
        boundRevisions: {
          rightsRevisionIds: [...input.rightsRevisionRefs],
        },
      },
      executionPlan: request.pendingExecutionPlanSnapshot!.content.executionPlan,
      factRevisionRefs: [...input.factRevisionRefs],
    }) as never,
    putExecutionConfirmationAuthority: async (input) => {
      authoritativeSnapshotHash = input.snapshotHash;
      assert.equal(
        input.predecessorRequestId,
        'confirmation-authority-r1',
      );
      created.push({
        quoteRevision: input.quoteRef.revision,
        requestId: `confirmation:wf-drift:${input.snapshotHash}`,
      });
      return input;
    },
    createExecutionConfirmationRequest: async () => {
      return confirmationResult(
        `confirmation:wf-drift:${authoritativeSnapshotHash}`,
        'consume:confirmation:successor-r2',
      );
    },
    admitExecutionPlanSnapshot: async ({ workflowId, snapshot }) => {
      admissionWorkflowIds.push(workflowId);
      return snapshot;
    },
  });

  assert.equal(out.executionPlanSnapshot?.quoteRef.revision, 'r2');
  assert.equal(
    out.executionPlanSnapshot?.planRevision,
    request.pendingExecutionPlanSnapshot!.content.planRevision + 1,
  );
  assert.equal(questions.length, 2);
  assert.match(questions[1]!, /quote/u);
  assert.deepEqual(created, [
    {
      requestId: `confirmation:wf-drift:${out.executionPlanSnapshot!.snapshotHash}`,
      quoteRevision: 'r2',
    },
  ]);
  assert.deepEqual(admissionWorkflowIds, [
    `wf-drift:plan:${out.executionPlanSnapshot!.planRevision}:${out.executionPlanSnapshot!.snapshotHash}`,
  ]);
  assert.equal(
    out.executionPlanSnapshot?.confirmationDecisionRef,
    `decision-${created[0]!.requestId}`,
  );
  assert.equal(
    out.executionConfirmationReservationIdempotencyKey,
    'consume:confirmation:successor-r2',
  );
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

/**
 * V31-11 confirmation-objects final merge:
 * ① confirm gate → createRequest idempotent wiring;
 * ② execution-time settlement never double-debits a confirmation hold
 *    (U8=A — confirmation-time reserve shares the Coordinator operation id).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryExecutionConfirmationRequestStore,
  MemoryPlanConfirmationDecisionStore,
} from '../agent-session/memory-execution-confirmation-store.js';
import {
  confirmationCreditPortFromMemoryLedger,
  ExecutionConfirmationService,
} from '../agent-session/execution-confirmation-service.js';
import {
  creditUsageOperationId,
  MemoryCreditLedger,
} from '../credit-billing/credit-ledger.js';
import { confirmPaidGenerationExecution } from './paid-generation-confirmation.js';
import type { HarnessWorkflowInput } from './task-admission.js';

const CREATED = '2026-08-08T12:00:00.000Z';

function paidRequest(overrides: {
  taskId?: string;
  credits?: number;
  plan?: boolean;
} = {}): HarnessWorkflowInput {
  const taskId = overrides.taskId ?? 'task-1';
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
      id: 'snap-1',
      quote: { id: 'quote-1', revision: 'r1' },
      task: { id: taskId },
      lens: 'image',
    },
    ...(overrides.plan
      ? {
          executionPlanSnapshot: {
            planId: 'plan-1',
            planRevision: 3,
            snapshotHash: 'snap-hash-1',
          } as unknown as NonNullable<HarnessWorkflowInput['executionPlanSnapshot']>,
        }
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

test('confirm gate creates the confirmation request once with plan-backed facts', async () => {
  const request = paidRequest({ credits: 7, plan: true });
  const calls: Array<Record<string, unknown>> = [];
  const out = await confirmPaidGenerationExecution({
    workflowId: 'wf-1',
    request,
    reportProgress: async () => undefined,
    createExecutionConfirmationRequest: async (input) => {
      calls.push(input as unknown as Record<string, unknown>);
      return {
        stored: undefined as never,
        card: undefined as never,
        reservedCredits: input.creditCost,
      };
    },
    ...approve(),
    applyCurrentTaskDecision: async (_wf, req) => req,
  });
  assert.equal(out.workflowRevision, 1);
  assert.equal(calls.length, 1);
  const input = calls[0]!;
  assert.equal(input.requestId, 'confirmation:wf-1');
  assert.equal(input.workspaceId, 'ws-1');
  assert.equal(input.planId, 'plan-1');
  assert.equal(input.planRevision, 3);
  assert.equal(input.snapshotHash, 'snap-hash-1');
  assert.deepEqual(input.quoteRef, { id: 'quote-1', revision: 'r1' });
  assert.equal(input.reservationIdempotencyKey, 'consume:task:task-1');
  assert.equal(input.creditCost, 7);
  assert.equal(input.failureRefundsCredits, true);
  const holdMs =
    Date.parse(input.holdExpiresAt as string) -
    Date.parse(input.createdAt as string);
  assert.ok(holdMs >= 60 * 60 * 1000 && holdMs <= 30 * 24 * 60 * 60 * 1000);
});

test('confirm gate skips createRequest when wiring port or plan is absent', async () => {
  for (const request of [paidRequest({ credits: 7 }), paidRequest()]) {
    let calls = 0;
    await confirmPaidGenerationExecution({
      workflowId: 'wf-1',
      request,
      reportProgress: async () => undefined,
      createExecutionConfirmationRequest: async () => {
        calls += 1;
        return {
          stored: undefined as never,
          card: undefined as never,
          reservedCredits: 0,
        };
      },
      ...approve(),
      applyCurrentTaskDecision: async (_wf, req) => req,
    });
    assert.equal(calls, 0);
  }
});

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

/**
 * V31-11 ExecutionConfirmationRequest / PlanConfirmationDecision service tests.
 * Seams: create-tx atomicity (A3 memory serialization), decision immutability,
 * hold expiry refund + plain copy, Campaign second paid Work (U7), A5 dual-state.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCreditLedger } from '../credit-billing/credit-ledger.js';
import {
  confirmationCreditPortFromMemoryLedger,
  ExecutionConfirmationService,
} from './execution-confirmation-service.js';
import {
  projectConfirmationCard,
  projectHoldExpiredMessage,
  projectRejectRefundMessage,
} from './execution-confirmation-projection.js';
import { ExecutionConfirmationError } from './execution-confirmation-store.js';
import {
  MemoryExecutionConfirmationRequestStore,
  MemoryPlanConfirmationDecisionStore,
} from './memory-execution-confirmation-store.js';

const CREATED = '2026-08-08T12:00:00.000Z';
const HOLD = '2026-08-09T12:00:00.000Z'; // 24h

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
  const requests = new MemoryExecutionConfirmationRequestStore();
  const decisions = new MemoryPlanConfirmationDecisionStore();
  const service = new ExecutionConfirmationService(
    requests,
    decisions,
    confirmationCreditPortFromMemoryLedger(ledger),
  );
  return { service, ledger, requests, decisions };
}

function baseCreate(
  overrides: Partial<Parameters<ExecutionConfirmationService['createRequest']>[0]> = {},
) {
  return {
    requestId: 'req-1',
    workspaceId: 'ws-1',
    planId: 'plan-1',
    planRevision: 1,
    snapshotHash: 'snap-hash-1',
    quoteRef: { id: 'quote-1', revision: 1 },
    reservationIdempotencyKey: 'reserve-req-1',
    createdAt: CREATED,
    holdExpiresAt: HOLD,
    actorId: 'merchant-1',
    creditCost: 5,
    failureRefundsCredits: true,
    rightsSummary: '素材授权有效至本月末',
    factSummary: '门店地址已确认',
    ...overrides,
  };
}

test('createRequest reserves FEFO credits and projects 已预留 N 分 + A5 refund dual-state', async () => {
  const { service, ledger } = makeService(12);
  const created = await service.createRequest(baseCreate());
  assert.equal(created.reservedCredits, 5);
  assert.equal(created.stored.request.status, 'pending');
  assert.match(created.card.heldLabel, /已预留 5 分/);
  assert.equal(created.card.refundLabel, '失败自动退回');
  assert.equal(created.card.readOnly, true);
  assert.deepEqual(created.card.actions, ['reject', 'confirm']);
  assert.equal(created.card.rightsSummary, '素材授权有效至本月末');
  assert.equal(
    (await ledger.project('ws-1', CREATED)).availableCredits,
    7,
  );

  const off = await service.createRequest(
    baseCreate({
      requestId: 'req-refund-off',
      reservationIdempotencyKey: 'reserve-off',
      failureRefundsCredits: false,
      creditCost: 2,
    }),
  );
  assert.equal(off.card.refundLabel, '该模型失败不退回');
});

test('createRequest concurrent attempts never over-debit (A3 memory seam)', async () => {
  const { service, ledger } = makeService(5);
  const attempts = Array.from({ length: 4 }, (_, index) =>
    service.createRequest(
      baseCreate({
        requestId: `req-concurrent-${index}`,
        reservationIdempotencyKey: `reserve-concurrent-${index}`,
        creditCost: 3,
      }),
    ),
  );
  const results = await Promise.allSettled(attempts);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 3);
  for (const result of rejected) {
    assert.equal(result.status, 'rejected');
    assert.match(String(result.reason), /Insufficient credits|INSUFFICIENT/i);
  }
  assert.equal((await ledger.project('ws-1', CREATED)).availableCredits, 2);
  assert.equal((await ledger.project('ws-1', CREATED)).usedCredits, 3);
});

test('PlanConfirmationDecision is immutable and carries no TTL', async () => {
  const { service, decisions } = makeService();
  await service.createRequest(baseCreate());
  const first = await service.decide({
    decisionId: 'dec-1',
    requestId: 'req-1',
    actorId: 'merchant-1',
    decision: 'confirmed',
    decidedAt: '2026-08-08T12:30:00.000Z',
  });
  assert.equal(first.decision.decision, 'confirmed');
  assert.equal('holdExpiresAt' in first.decision, false);

  // Same facts → idempotent.
  const replay = await service.decide({
    decisionId: 'dec-1',
    requestId: 'req-1',
    actorId: 'merchant-1',
    decision: 'confirmed',
    decidedAt: '2026-08-08T12:30:00.000Z',
  });
  assert.equal(replay.decision.decisionId, 'dec-1');

  // Different decision for same request → fail closed.
  await assert.rejects(
    () =>
      service.decide({
        decisionId: 'dec-2',
        requestId: 'req-1',
        actorId: 'merchant-1',
        decision: 'rejected',
        decidedAt: '2026-08-08T12:31:00.000Z',
      }),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'DECISION_IMMUTABLE',
  );

  const stored = await decisions.getByRequestId('req-1');
  assert.equal(stored?.decision, 'confirmed');
});

test('reject fully refunds original hold lots with plain merchant message', async () => {
  const { service, ledger } = makeService(10);
  await service.createRequest(baseCreate({ creditCost: 4 }));
  assert.equal((await ledger.project('ws-1', CREATED)).availableCredits, 6);

  const decided = await service.decide({
    decisionId: 'dec-reject',
    requestId: 'req-1',
    actorId: 'merchant-1',
    decision: 'rejected',
    decidedAt: '2026-08-08T13:00:00.000Z',
  });
  assert.equal(decided.refundedCredits, 4);
  assert.equal(
    decided.merchantMessage,
    projectRejectRefundMessage(4),
  );
  assert.match(decided.merchantMessage ?? '', /已全额退回/);
  assert.equal(
    (await ledger.project('ws-1', '2026-08-08T13:00:00.000Z')).availableCredits,
    10,
  );
});

test('hold expiry cancels + refunds + plain D-153 message (durable seam)', async () => {
  const { service, ledger } = makeService(8);
  await service.createRequest(baseCreate({ creditCost: 3 }));
  assert.equal((await ledger.project('ws-1', CREATED)).availableCredits, 5);

  await assert.rejects(
    () =>
      service.expireHold({
        requestId: 'req-1',
        now: '2026-08-08T18:00:00.000Z', // before HOLD
      }),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'HOLD_NOT_EXPIRED',
  );

  const expired = await service.expireHold({
    requestId: 'req-1',
    now: '2026-08-09T12:00:01.000Z',
  });
  assert.equal(expired.request.status, 'expired');
  assert.equal(expired.refundedCredits, 3);
  assert.equal(expired.merchantMessage, projectHoldExpiredMessage(3));
  assert.match(expired.merchantMessage, /超时未确认|积分已退回|已退回/);
  assert.equal(
    (await ledger.project('ws-1', '2026-08-09T12:00:01.000Z')).availableCredits,
    8,
  );

  // Idempotent re-expire.
  const again = await service.expireHold({
    requestId: 'req-1',
    now: '2026-08-09T13:00:00.000Z',
  });
  assert.equal(again.request.status, 'expired');
});

test('Campaign second paid Work requires its own confirmation (U7)', async () => {
  const { service } = makeService(30);
  const campaignPlanRef = { id: 'campaign-1', revision: 1 };

  const work1 = await service.createRequest(
    baseCreate({
      requestId: 'req-work-1',
      reservationIdempotencyKey: 'reserve-work-1',
      planId: 'work-plan-1',
      creditCost: 5,
      campaignPlanRef,
      workOrdinal: 1,
      approvalScope: 'single_work',
    }),
  );
  assert.equal(work1.stored.request.workOrdinal, 1);

  // Second paid work — different ordinal — must create a separate request.
  const work2 = await service.createRequest(
    baseCreate({
      requestId: 'req-work-2',
      reservationIdempotencyKey: 'reserve-work-2',
      planId: 'work-plan-2',
      creditCost: 5,
      campaignPlanRef,
      workOrdinal: 2,
      approvalScope: 'single_work',
    }),
  );
  assert.equal(work2.stored.request.workOrdinal, 2);
  assert.notEqual(
    work1.stored.request.requestId,
    work2.stored.request.requestId,
  );

  const check = await service.assertCampaignWorkNeedsOwnConfirmation({
    workspaceId: 'ws-1',
    campaignPlanId: 'campaign-1',
    workOrdinal: 2,
  });
  assert.equal('existingRequestId' in check, true);

  // plan_only does not pre-authorize / reserve credits.
  const planOnly = await service.createRequest(
    baseCreate({
      requestId: 'req-plan-only',
      reservationIdempotencyKey: 'reserve-plan-only',
      creditCost: 0,
      campaignPlanRef,
      workOrdinal: 99,
      approvalScope: 'plan_only',
    }),
  );
  assert.equal(planOnly.reservedCredits, 0);
  assert.equal(planOnly.card.planOnlyNotice, '本确认只批准计划排期，不含扣费');
});

test('projection helpers keep A5 dual-state and held copy stable', () => {
  const on = projectConfirmationCard({
    reservedCredits: 12,
    failureRefundsCredits: true,
    availableCredits: 40,
    rightsSummary: '授权 OK',
    factSummary: '事实 OK',
  });
  assert.equal(on.costLabel, '本次约消耗 12 分');
  assert.equal(on.heldLabel, '已预留 12 分');
  assert.equal(on.refundLabel, '失败自动退回');
  assert.equal(on.balanceLabel, '当前可用 40 分');

  const off = projectConfirmationCard({
    reservedCredits: 12,
    failureRefundsCredits: false,
  });
  assert.equal(off.refundLabel, '该模型失败不退回');
});

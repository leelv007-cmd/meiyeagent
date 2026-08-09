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
import { confirmationCreditPortFromPostgresLedger } from './postgres-execution-confirmation-store.js';

const CREATED = '2026-08-08T12:00:00.000Z';
const HOLD = '2026-08-09T12:00:00.000Z'; // 24h

function makeService(
  credits = 20,
  clock = () => new Date('2026-08-08T12:30:00.000Z'),
) {
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
    undefined,
    { clock },
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

test('createRequest rejects a changed immutable authority under the same request id', async () => {
  const { service, ledger } = makeService(12);
  await service.createRequest(baseCreate());

  await assert.rejects(
    service.createRequest(
      baseCreate({
        planRevision: 2,
        snapshotHash: 'snap-hash-2',
      }),
    ),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal((await ledger.project('ws-1', CREATED)).usedCredits, 5);
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

test('successor confirmation atomically replaces the prior hold instead of double-debiting', async () => {
  const { service, ledger } = makeService(10);
  await service.createRequest(
    baseCreate({
      requestId: 'req-reprice-r1',
      reservationIdempotencyKey: 'reserve-reprice-r1',
      creditCost: 6,
    }),
  );
  await service.decide({
    decisionId: 'decision-reprice-r1',
    requestId: 'req-reprice-r1',
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'confirmed',
    decidedAt: '2026-08-08T12:10:00.000Z',
  });

  const successor = await service.createRequest(
    baseCreate({
      requestId: 'req-reprice-r2',
      planRevision: 2,
      snapshotHash: 'snap-hash-2',
      quoteRef: { id: 'quote-1', revision: 2 },
      reservationIdempotencyKey: 'reserve-reprice-r2',
      predecessorRequestId: 'req-reprice-r1',
      replacesReservationIdempotencyKey: 'reserve-reprice-r1',
      creditCost: 7,
    }),
  );
  const replay = await service.createRequest(
    baseCreate({
      requestId: 'req-reprice-r2',
      planRevision: 2,
      snapshotHash: 'snap-hash-2',
      quoteRef: { id: 'quote-1', revision: 2 },
      reservationIdempotencyKey: 'reserve-reprice-r2',
      predecessorRequestId: 'req-reprice-r1',
      replacesReservationIdempotencyKey: 'reserve-reprice-r1',
      creditCost: 7,
    }),
  );

  assert.equal(successor.reservedCredits, 7);
  assert.equal(replay.stored.request.requestId, 'req-reprice-r2');
  assert.equal(
    successor.stored.request.replacesReservationIdempotencyKey,
    'reserve-reprice-r1',
  );
  const balance = ledger.project('ws-1', CREATED);
  assert.equal(balance.availableCredits, 3);
  assert.equal(balance.usedCredits, 13);
  assert.equal(balance.refundedCredits, 6);

  await assert.rejects(
    () =>
      service.createRequest(
        baseCreate({
          requestId: 'req-reprice-r2-duplicate',
          planRevision: 2,
          snapshotHash: 'snap-hash-2-duplicate',
          quoteRef: { id: 'quote-1', revision: 2 },
          reservationIdempotencyKey: 'reserve-reprice-r2-duplicate',
          predecessorRequestId: 'req-reprice-r1',
          replacesReservationIdempotencyKey: 'reserve-reprice-r1',
          creditCost: 7,
        }),
      ),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.deepEqual(ledger.project('ws-1', CREATED), balance);
});

test('successor replacement rejects a confirmed hold from another plan or quote', async () => {
  for (const lineage of [
    { planId: 'plan-other', quoteRef: { id: 'quote-1', revision: 2 } },
    { planId: 'plan-1', quoteRef: { id: 'quote-other', revision: 2 } },
  ]) {
    const { service, ledger } = makeService(10);
    await service.createRequest(
      baseCreate({
        requestId: 'req-lineage-r1',
        reservationIdempotencyKey: 'reserve-lineage-r1',
        creditCost: 6,
      }),
    );
    await service.decide({
      decisionId: 'decision-lineage-r1',
      requestId: 'req-lineage-r1',
      workspaceId: 'ws-1',
      actorId: 'merchant-1',
      decision: 'confirmed',
      decidedAt: '2026-08-08T12:10:00.000Z',
    });

    await assert.rejects(
      () =>
        service.createRequest(
          baseCreate({
            ...lineage,
            requestId: 'req-lineage-r2',
            planRevision: 2,
            snapshotHash: 'snap-lineage-r2',
            reservationIdempotencyKey: 'reserve-lineage-r2',
            predecessorRequestId: 'req-lineage-r1',
            replacesReservationIdempotencyKey: 'reserve-lineage-r1',
            creditCost: 7,
          }),
        ),
      (error: unknown) =>
        error instanceof ExecutionConfirmationError &&
        error.code === 'INVALID_STATE',
    );
    assert.equal(ledger.project('ws-1', CREATED).availableCredits, 4);
  }
});

test('createRequest compensates orphan hold when row insert fails (non-tx seam)', async () => {
  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-comp',
    workspaceId: 'ws-1',
    credits: 20,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'comp-test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const requests = new (class extends MemoryExecutionConfirmationRequestStore {
    async savePending(): Promise<never> {
      throw new Error('injected request row failure');
    }
  })();
  const service = new ExecutionConfirmationService(
    requests,
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
  );
  await assert.rejects(() => service.createRequest(baseCreate()));
  const projection = ledger.project('ws-1', CREATED);
  assert.equal(projection.availableCredits, 20);
  assert.equal(projection.usedCredits, 5);
  assert.equal(projection.refundedCredits, 5);
});

test('PlanConfirmationDecision is immutable and carries no TTL', async () => {
  const { service, decisions } = makeService();
  await service.createRequest(baseCreate());
  const first = await service.decide({
    decisionId: 'dec-1',
    requestId: 'req-1',
    workspaceId: 'ws-1',
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
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'confirmed',
    decidedAt: '2026-08-08T12:30:00.000Z',
  });
  assert.equal(replay.decision.decisionId, 'dec-1');

  const laterClockReplay = await service.decide({
    decisionId: 'dec-1',
    requestId: 'req-1',
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'confirmed',
    decidedAt: '2026-08-08T12:45:00.000Z',
  });
  assert.equal(laterClockReplay.decision.decidedAt, '2026-08-08T12:30:00.000Z');

  // Different decision for same request → fail closed.
  await assert.rejects(
    () =>
      service.decide({
        decisionId: 'dec-2',
        requestId: 'req-1',
        workspaceId: 'ws-1',
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
  assert.equal(
    (await service.getDecisionForWorkspace('ws-1', 'req-1'))?.decision,
    'confirmed',
  );
  assert.equal(await service.getDecisionForWorkspace('ws-2', 'req-1'), null);
});

test('reject fully refunds original hold lots with plain merchant message', async () => {
  const { service, ledger } = makeService(10);
  await service.createRequest(baseCreate({ creditCost: 4 }));
  assert.equal((await ledger.project('ws-1', CREATED)).availableCredits, 6);

  const decided = await service.decide({
    decisionId: 'dec-reject',
    requestId: 'req-1',
    workspaceId: 'ws-1',
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

test('replay completes a rejected decision after a crash immediately after decision append', async () => {
  class CrashAfterDecisionAppend extends MemoryPlanConfirmationDecisionStore {
    private crash = true;

    override async append(
      decision: Parameters<MemoryPlanConfirmationDecisionStore['append']>[0],
    ) {
      const appended = await super.append(decision);
      if (this.crash) {
        this.crash = false;
        throw new Error('injected crash after decision append');
      }
      return appended;
    }
  }

  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-crash-append',
    workspaceId: 'ws-1',
    credits: 10,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const requests = new MemoryExecutionConfirmationRequestStore();
  const service = new ExecutionConfirmationService(
    requests,
    new CrashAfterDecisionAppend(),
    confirmationCreditPortFromMemoryLedger(ledger),
    undefined,
    { clock: () => new Date('2026-08-08T12:30:00.000Z') },
  );
  await service.createRequest(baseCreate({ creditCost: 4 }));
  const decision = {
    decisionId: 'dec-crash-append',
    requestId: 'req-1',
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'rejected' as const,
    decidedAt: '2026-08-08T13:00:00.000Z',
  };

  await assert.rejects(() => service.decide(decision), /injected crash/);
  const replay = await service.decide(decision);

  assert.equal(replay.request.status, 'decided');
  assert.equal(replay.refundedCredits, 4);
  assert.equal(
    (await ledger.project('ws-1', decision.decidedAt)).availableCredits,
    10,
  );
});

test('replay completes a rejected decision after a crash immediately after status transition', async () => {
  class CrashAfterStatusTransition extends MemoryExecutionConfirmationRequestStore {
    private crash = true;

    override async markStatus(
      input: Parameters<MemoryExecutionConfirmationRequestStore['markStatus']>[0],
    ) {
      const updated = await super.markStatus(input);
      if (this.crash) {
        this.crash = false;
        throw new Error('injected crash after status transition');
      }
      return updated;
    }
  }

  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-crash-status',
    workspaceId: 'ws-1',
    credits: 10,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const service = new ExecutionConfirmationService(
    new CrashAfterStatusTransition(),
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
    undefined,
    { clock: () => new Date('2026-08-08T12:30:00.000Z') },
  );
  await service.createRequest(baseCreate({ creditCost: 4 }));
  const decision = {
    decisionId: 'dec-crash-status',
    requestId: 'req-1',
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'rejected' as const,
    decidedAt: '2026-08-08T13:00:00.000Z',
  };

  await assert.rejects(() => service.decide(decision), /injected crash/);
  const replay = await service.decide(decision);

  assert.equal(replay.request.status, 'decided');
  assert.equal(replay.refundedCredits, 4);
  assert.equal(
    (await ledger.project('ws-1', decision.decidedAt)).availableCredits,
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
        workspaceId: 'ws-1',
        now: '2026-08-08T18:00:00.000Z', // before HOLD
      }),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'HOLD_NOT_EXPIRED',
  );

  const expired = await service.expireHold({
    requestId: 'req-1',
    workspaceId: 'ws-1',
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
    workspaceId: 'ws-1',
    now: '2026-08-09T13:00:00.000Z',
  });
  assert.equal(again.request.status, 'expired');
});

test('decide at the server-clock expiry boundary atomically expires and refunds', async () => {
  const { service, ledger } = makeService(20, () => new Date(HOLD));
  await service.createRequest(baseCreate());

  await assert.rejects(
    service.decideForWorkspace({
      decisionId: 'dec-at-expiry',
      requestId: 'req-1',
      workspaceId: 'ws-1',
      actorId: 'merchant-1',
      decision: 'confirmed',
      decidedAt: CREATED,
    }),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'INVALID_STATE',
  );
  assert.equal((await service.getRequest('req-1'))?.request.status, 'expired');
  assert.equal(ledger.project('ws-1', HOLD).availableCredits, 20);
  assert.equal(await service.getDecision('req-1'), null);
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

test('Postgres credit adapter fails fast without every client-aware operation', () => {
  assert.throws(
    () =>
      confirmationCreditPortFromPostgresLedger({
        project: async () => ({}) as never,
        consume: async () => [],
        refundUsageOperation: async () => [],
        withWorkspaceCreditLock: async (
          _workspaceId: string,
          action: (client: never) => Promise<unknown>,
        ) =>
          action({} as never),
      } as never),
    /client-aware|transaction/i,
  );
});

test('Postgres credit adapter never constructs a split non-transactional port', () => {
  assert.throws(
    () =>
      confirmationCreditPortFromPostgresLedger({
        async project() {
          return {} as never;
        },
        async consume() {
          return [];
        },
        async refundUsageOperation() {
          return [];
        },
      } as never),
    /transaction/i,
  );
});

test('confirmation service requires one workspace transaction action seam', () => {
  assert.throws(
    () =>
      new ExecutionConfirmationService(
        new MemoryExecutionConfirmationRequestStore(),
        new MemoryPlanConfirmationDecisionStore(),
        {} as never,
      ),
    /transaction/i,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCreditLedger } from '../credit-billing/credit-ledger.js';
import {
  ConfirmationAuthorityAssembler,
  type ConfirmationAuthorityPlanReader,
  type ConfirmationAuthorityQuoteReader,
} from './execution-confirmation-authority.js';
import {
  confirmationCreditPortFromMemoryLedger,
  ExecutionConfirmationService,
} from './execution-confirmation-service.js';
import { ExecutionConfirmationError } from './execution-confirmation-store.js';
import {
  MemoryExecutionConfirmationRequestStore,
  MemoryPlanConfirmationDecisionStore,
} from './memory-execution-confirmation-store.js';

test('authority assembler freezes plan, quote, rights, facts and clock from server sources', async () => {
  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-authority',
    workspaceId: 'ws-1',
    credits: 20,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const requests = new MemoryExecutionConfirmationRequestStore();
  const service = new ExecutionConfirmationService(
    requests,
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
  );
  const plans: ConfirmationAuthorityPlanReader = {
    async getCurrentByWorkflowId() {
      return {
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        planId: 'plan-authority',
        planRevision: 7,
        snapshotHash: 'hash-authority',
        quoteRef: { id: 'quote-authority', revision: 'rev-3' },
        rightsRevisionRefs: ['rights-2', 'rights-1'],
        factRevisionRefs: ['fact-1'],
        frozenAt: '2026-08-09T11:59:00.000Z',
        executionConfirmationContext: {
          campaignPlanRef: { id: 'campaign-plan-1', revision: 2 },
          workOrdinal: 2,
          approvalScope: 'single_work',
        },
      } as never;
    },
  };
  const quotes: ConfirmationAuthorityQuoteReader = {
    async getQuote() {
      return {
        quoteId: 'quote-authority',
        revision: 'rev-3',
        taskId: 'task-authority',
        creditCost: 6,
        failureRefundsCredits: false,
      } as never;
    },
  };
  const assembler = new ConfirmationAuthorityAssembler(service, plans, quotes, {
    clock: () => new Date('2026-08-09T12:00:00.000Z'),
  });

  const result = await assembler.createRequest({
    actorId: 'merchant-1',
    workspaceId: 'ws-1',
    workflowId: 'workflow-1',
  });

  assert.deepEqual(result.stored.request, {
    schemaVersion: 'agent-execution-confirmation-request/v1',
    requestId: result.stored.request.requestId,
    workspaceId: 'ws-1',
    planId: 'plan-authority',
    planRevision: 7,
    snapshotHash: 'hash-authority',
    quoteRef: { id: 'quote-authority', revision: 'rev-3' },
    reservationIdempotencyKey: 'consume:task:task-authority',
    createdAt: '2026-08-09T12:00:00.000Z',
    holdExpiresAt: '2026-08-11T12:00:00.000Z',
    campaignPlanRef: { id: 'campaign-plan-1', revision: 2 },
    workOrdinal: 2,
    approvalScope: 'single_work',
    status: 'pending',
  });
  assert.match(result.stored.request.requestId, /^confirmation:[a-f0-9]{40}$/u);
  assert.equal(result.reservedCredits, 6);
  assert.equal(result.card.rightsSummary, 'rights-1, rights-2');
  assert.equal(result.card.factSummary, 'fact-1');
  assert.equal(result.card.refundLabel, '该模型失败不退回');
});

test('authority assembler replays one workflow with its first frozen clock', async () => {
  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-authority-replay',
    workspaceId: 'ws-1',
    credits: 20,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const requests = new MemoryExecutionConfirmationRequestStore();
  const service = new ExecutionConfirmationService(
    requests,
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
  );
  const plans: ConfirmationAuthorityPlanReader = {
    async getCurrentByWorkflowId() {
      return {
        workflowId: 'workflow-replay',
        workspaceId: 'ws-1',
        planId: 'plan-replay',
        planRevision: 1,
        snapshotHash: 'hash-replay',
        quoteRef: { id: 'quote-replay', revision: 1 },
        rightsRevisionRefs: [],
        factRevisionRefs: [],
        frozenAt: '2026-08-09T11:59:00.000Z',
      } as never;
    },
  };
  const quotes: ConfirmationAuthorityQuoteReader = {
    getQuote: () => ({
      quoteId: 'quote-replay',
      revision: 1,
      taskId: 'task-replay',
      creditCost: 6,
      failureRefundsCredits: true,
    }) as never,
  };
  let now = '2026-08-09T12:00:00.001Z';
  const assembler = new ConfirmationAuthorityAssembler(service, plans, quotes, {
    clock: () => new Date(now),
  });
  const command = {
    actorId: 'merchant-1',
    workspaceId: 'ws-1',
    workflowId: 'workflow-replay',
  };

  const first = await assembler.createRequest(command);
  now = '2026-08-09T12:00:00.999Z';
  const replay = await assembler.createRequest(command);

  assert.equal(replay.stored.request.createdAt, first.stored.request.createdAt);
  assert.equal(
    replay.stored.request.holdExpiresAt,
    first.stored.request.holdExpiresAt,
  );
  assert.equal(
    ledger.project('ws-1', '2026-08-09T12:01:00.000Z').availableCredits,
    14,
  );

  await service.decide({
    decisionId: 'decision-replay-1',
    requestId: first.stored.request.requestId,
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'rejected',
    decidedAt: '2026-08-09T12:01:00.000Z',
  });
  now = '2026-08-09T12:02:00.000Z';
  const reconfirm = await assembler.createRequest(command);
  now = '2026-08-09T12:02:00.500Z';
  const reconfirmReplay = await assembler.createRequest(command);
  assert.notEqual(reconfirm.stored.request.requestId, first.stored.request.requestId);
  assert.equal(
    reconfirmReplay.stored.request.requestId,
    reconfirm.stored.request.requestId,
  );
  assert.equal(
    reconfirmReplay.stored.request.createdAt,
    reconfirm.stored.request.createdAt,
  );

  await service.expireHold({
    requestId: reconfirm.stored.request.requestId,
    workspaceId: 'ws-1',
    now: '2026-08-11T12:02:01.000Z',
  });
  now = '2026-08-11T12:03:00.000Z';
  const successor = await assembler.createRequest(command);
  assert.notEqual(
    successor.stored.request.requestId,
    reconfirm.stored.request.requestId,
  );
  assert.equal(successor.stored.request.status, 'pending');
  assert.equal(
    ledger.project('ws-1', now).availableCredits,
    14,
  );
  await service.expireHold({
    requestId: reconfirm.stored.request.requestId,
    workspaceId: 'ws-1',
    now: '2026-08-11T12:04:00.000Z',
  });
  assert.equal(
    ledger
      .listTransactions('ws-1')
      .filter((transaction) => transaction.transactionType === 'REFUND').length,
    2,
  );
  await requests.markStatus({
    requestId: successor.stored.request.requestId,
    status: 'decided',
    expectedStatus: 'pending',
  });
  now = '2026-08-11T12:05:00.000Z';
  await assert.rejects(
    () => assembler.createRequest(command),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'INVALID_STATE',
  );
  assert.equal(ledger.project('ws-1', now).availableCredits, 14);
  await service.decide({
    decisionId: 'decision-reconcile-missing',
    requestId: successor.stored.request.requestId,
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'rejected',
    decidedAt: now,
  });
  assert.equal(ledger.project('ws-1', now).availableCredits, 20);

  const confirmedAttempt = await assembler.createRequest(command);
  await service.decide({
    decisionId: 'decision-confirmed-final',
    requestId: confirmedAttempt.stored.request.requestId,
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'confirmed',
    decidedAt: '2026-08-11T12:06:00.000Z',
  });
  now = '2026-08-11T12:07:00.000Z';
  const confirmedReplay = await assembler.createRequest(command);
  assert.equal(
    confirmedReplay.stored.request.requestId,
    confirmedAttempt.stored.request.requestId,
  );
  assert.equal(ledger.project('ws-1', now).availableCredits, 14);
});

test('authority assembler rejects foreign workspace and quote revision drift', async () => {
  const { service } = (() => {
    const ledger = new MemoryCreditLedger();
    return {
      service: new ExecutionConfirmationService(
        new MemoryExecutionConfirmationRequestStore(),
        new MemoryPlanConfirmationDecisionStore(),
        confirmationCreditPortFromMemoryLedger(ledger),
      ),
    };
  })();
  const plans: ConfirmationAuthorityPlanReader = {
    async getCurrentByWorkflowId() {
      return {
        workflowId: 'wf',
        workspaceId: 'ws-owner',
        planId: 'plan-1',
        planRevision: 1,
        snapshotHash: 'hash-1',
        quoteRef: { id: 'quote-1', revision: '1' },
        rightsRevisionRefs: [],
        factRevisionRefs: [],
        frozenAt: '2026-08-09T11:59:00.000Z',
      } as never;
    },
  };
  const quotes: ConfirmationAuthorityQuoteReader = {
    async getQuote() {
      return { quoteId: 'quote-1', revision: '2', creditCost: 1 } as never;
    },
  };
  const assembler = new ConfirmationAuthorityAssembler(service, plans, quotes);

  await assert.rejects(
    () =>
      assembler.createRequest({
        actorId: 'x',
        workspaceId: 'foreign',
        workflowId: 'wf',
      }),
    /not found/i,
  );
  await assert.rejects(
    () =>
      assembler.createRequest({
        actorId: 'x',
        workspaceId: 'ws-owner',
        workflowId: 'wf',
      }),
    /revision|current/i,
  );
});

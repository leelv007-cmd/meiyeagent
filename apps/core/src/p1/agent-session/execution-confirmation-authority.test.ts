import assert from 'node:assert/strict';
import test from 'node:test';

import {
  creditUsageOperationId,
  MemoryCreditLedger,
} from '../credit-billing/credit-ledger.js';
import { executionConfirmationAuthorityRequestId } from '../harness/execution-confirmation-id.js';
import {
  ConfirmationRequiresSuccessorAdmissionError,
  ConfirmationAuthorityAssembler,
  repricedConfirmationSuccessorRequestId,
  type ConfirmationAuthorityPlanReader,
  type ConfirmationAuthorityQuoteReader,
} from './execution-confirmation-authority.js';
import {
  confirmationCreditPortFromMemoryLedger,
  ExecutionConfirmationService,
} from './execution-confirmation-service.js';
import { MemoryConfirmationAuthorityStore } from './execution-confirmation-authority-store.js';
import { P1DomainError } from '../foundation/domain.js';
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
        reservationAttempt: 'successor',
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
    reservationIdempotencyKey:
      result.stored.request.reservationIdempotencyKey,
    createdAt: '2026-08-09T12:00:00.000Z',
    holdExpiresAt: '2026-08-11T12:00:00.000Z',
    campaignPlanRef: { id: 'campaign-plan-1', revision: 2 },
    workOrdinal: 2,
    approvalScope: 'single_work',
    status: 'pending',
  });
  assert.equal(
    result.stored.request.requestId,
    executionConfirmationAuthorityRequestId({
      workflowId: 'workflow-1',
      planRevision: 7,
      snapshotHash: 'hash-authority',
    }),
  );
  assert.match(
    result.stored.request.reservationIdempotencyKey,
    /^consume:confirmation:[a-f0-9]{40}$/u,
  );
  assert.notEqual(
    result.stored.request.reservationIdempotencyKey,
    creditUsageOperationId('task-authority'),
  );
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
  let now = '2026-08-09T12:00:00.001Z';
  const requests = new MemoryExecutionConfirmationRequestStore();
  const service = new ExecutionConfirmationService(
    requests,
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
    undefined,
    { clock: () => new Date(now) },
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
  let createBarrier:
    | { entered(): void; wait: Promise<void> }
    | undefined;
  const assembler = new ConfirmationAuthorityAssembler(
    {
      getRequest: (requestId) => service.getRequest(requestId),
      getDecision: (requestId) => service.getDecision(requestId),
      async createRequest(input) {
        const barrier = createBarrier;
        if (barrier) {
          createBarrier = undefined;
          barrier.entered();
          await barrier.wait;
        }
        return service.createRequest(input);
      },
    },
    plans,
    quotes,
    { clock: () => new Date(now) },
  );
  const command = {
    actorId: 'merchant-1',
    workspaceId: 'ws-1',
    workflowId: 'workflow-replay',
  };

  const first = await assembler.createRequest(command);
  now = '2026-08-09T12:00:00.999Z';
  const replay = await assembler.createRequest(command);

  assert.equal(
    first.stored.request.reservationIdempotencyKey,
    creditUsageOperationId('task-replay'),
  );
  assert.equal(replay.stored.request.createdAt, first.stored.request.createdAt);
  assert.equal(
    replay.stored.request.holdExpiresAt,
    first.stored.request.holdExpiresAt,
  );
  assert.equal(
    ledger.project('ws-1', '2026-08-09T12:01:00.000Z').availableCredits,
    14,
  );

  let releaseCreate!: () => void;
  let enteredCreate!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredCreate = resolve;
  });
  createBarrier = {
    entered: enteredCreate,
    wait: new Promise<void>((resolve) => {
      releaseCreate = resolve;
    }),
  };
  const reconfirmPromise = assembler.createRequest(command);
  await entered;
  await service.decide({
    decisionId: 'decision-replay-1',
    requestId: first.stored.request.requestId,
    workspaceId: 'ws-1',
    actorId: 'merchant-1',
    decision: 'rejected',
    decidedAt: '2026-08-09T12:01:00.000Z',
  });
  releaseCreate();
  await assert.rejects(
    reconfirmPromise,
    (error: unknown) =>
      error instanceof ConfirmationRequiresSuccessorAdmissionError &&
      error.code === 'REQUIRES_SUCCESSOR_ADMISSION' &&
      error.status === 409 &&
      error.details.terminalState === 'terminal_race',
  );
  assert.equal(
    ledger.project('ws-1', '2026-08-09T12:02:00.000Z').availableCredits,
    20,
  );
  await assert.rejects(
    () => assembler.createRequest(command),
    (error: unknown) =>
      error instanceof ConfirmationRequiresSuccessorAdmissionError &&
      error.details.terminalRequestId === first.stored.request.requestId &&
      error.details.terminalState === 'rejected',
  );
});

test('authority assembler retries an authority that advances before the credit transaction', async () => {
  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-authority-advance',
    workspaceId: 'ws-1',
    credits: 20,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const authorityStore = new MemoryConfirmationAuthorityStore();
  const revision1 = {
    workflowId: 'workflow-authority-advance',
    workspaceId: 'ws-1',
    planId: 'plan-authority-advance',
    planRevision: 1,
    snapshotHash: 'hash-authority-advance-1',
    quoteRef: { id: 'quote-authority-advance', revision: 1 },
    rightsRevisionRefs: [],
    factRevisionRefs: [],
    frozenAt: '2026-08-09T11:59:00.000Z',
  } as const;
  const revision2 = {
    ...revision1,
    planRevision: 2,
    snapshotHash: 'hash-authority-advance-2',
    frozenAt: '2026-08-09T12:00:00.000Z',
  } as const;
  await authorityStore.putCurrent(revision1);
  let firstRead = true;
  const plans: ConfirmationAuthorityPlanReader = {
    async getCurrentByWorkflowId(workflowId) {
      if (firstRead) {
        firstRead = false;
        await authorityStore.putCurrent(revision2);
        return revision1;
      }
      return authorityStore.getCurrentByWorkflowId(workflowId);
    },
  };
  const service = new ExecutionConfirmationService(
    new MemoryExecutionConfirmationRequestStore(),
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
    authorityStore,
  );
  const assembler = new ConfirmationAuthorityAssembler(
    service,
    plans,
    {
      getQuote: () => ({
        quoteId: 'quote-authority-advance',
        revision: 1,
        taskId: 'task-authority-advance',
        creditCost: 6,
        failureRefundsCredits: true,
      }) as never,
    },
    { clock: () => new Date('2026-08-09T12:01:00.000Z') },
  );

  const result = await assembler.createRequest({
    actorId: 'merchant-1',
    workspaceId: 'ws-1',
    workflowId: revision1.workflowId,
  });

  assert.equal(result.stored.request.planRevision, 2);
  assert.equal(result.stored.request.snapshotHash, revision2.snapshotHash);
  assert.equal(
    ledger.project('ws-1', '2026-08-09T12:02:00.000Z').availableCredits,
    14,
  );
});

test('V31-63 successor authority reads its quote on the admission transaction, not the pool', async () => {
  const predecessorRequestId = 'confirmation:pred-1';
  const requestId = repricedConfirmationSuccessorRequestId(
    predecessorRequestId,
  );
  const pendingAuthority = {
    workflowId: 'workflow-successor-1',
    workspaceId: 'ws-1',
    planId: 'plan-successor-1',
    planRevision: 2,
    snapshotHash: 'hash-successor-1',
    quoteRef: { id: 'quote-successor-1', revision: 'r1' },
    rightsRevisionRefs: [],
    factRevisionRefs: [],
    frozenAt: '2026-08-12T09:00:00.000Z',
    reservationAttempt: 'successor',
    predecessorRequestId,
  } as never;
  const transactionalCreates: string[] = [];
  const assembler = new ConfirmationAuthorityAssembler(
    {
      async getRequest(candidate: string) {
        if (candidate === predecessorRequestId) {
          return {
            request: {
              requestId: predecessorRequestId,
              workspaceId: 'ws-1',
              reservationIdempotencyKey: 'consume:pred-1',
              status: 'decided',
            },
          } as never;
        }
        return null;
      },
      async getDecision() {
        return null;
      },
      async createRequest() {
        throw new Error('successor create must stay on the transaction');
      },
      async createRequestInTransaction(input: {
        requestId: string;
        creditCost: number;
      }) {
        transactionalCreates.push(input.requestId);
        return {
          stored: { request: { requestId: input.requestId } },
          card: {},
          reservedCredits: input.creditCost,
        } as never;
      },
    } as never,
    {
      async getCurrentByWorkflowId() {
        throw new Error('successor authority must come from pendingAuthority');
      },
    },
    {
      // The pool cannot see the successor quote: the builder created it
      // inside the still-open admission transaction.
      async getQuote() {
        return null;
      },
      async getQuoteInTransaction(client, quoteId, workspaceId) {
        assert.ok(client, 'transaction reads must receive the client');
        assert.equal(quoteId, 'quote-successor-1');
        assert.equal(workspaceId, 'ws-1');
        return {
          quoteId: 'quote-successor-1',
          revision: 'r1',
          taskId: 'task-successor-1',
          creditCost: 4,
          failureRefundsCredits: true,
        } as never;
      },
    },
    { clock: () => new Date('2026-08-12T09:00:00.000Z') },
  );

  const result = await assembler.createRequestInTransaction(
    {
      actorId: 'merchant-1',
      workspaceId: 'ws-1',
      workflowId: 'workflow-successor-1',
      pendingAuthority,
      repricedConfirmedSuccessor: {
        requestId,
        predecessorRequestId,
        reservationIdempotencyKey: 'consume:successor-1',
        holdExpiresAt: '2026-08-14T09:00:00.000Z',
      },
    },
    {
      transactionClient: {} as never,
      async project() {
        return { availableCredits: 10 } as never;
      },
      async consume() {
        return [];
      },
      async refundUsageOperation() {
        return [];
      },
    },
  );

  assert.equal(result.reservedCredits, 4);
  assert.deepEqual(transactionalCreates, [requestId]);
});

test('living-plan reprice confirmation replays the successor usage key, not consume:task', async () => {
  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-living-reprice',
    workspaceId: 'ws-1',
    credits: 40,
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
  const taskId = 'task-living-reprice';
  const admissionKey = creditUsageOperationId(taskId);
  ledger.consume({
    workspaceId: 'ws-1',
    credits: 15,
    transactionId: admissionKey,
    actorId: 'merchant-1',
    correlationId: 'admit',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  ledger.refundUsageOperation({
    workspaceId: 'ws-1',
    usageOperationId: admissionKey,
    refundOperationId: 'plan-reprice-refund:task-living-reprice:r2',
    actorId: 'merchant-1',
    correlationId: 'reprice',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const successorKey = `consume:plan-reprice:${taskId}:r2:quote-r2@2`;
  ledger.consume({
    workspaceId: 'ws-1',
    credits: 20,
    transactionId: successorKey,
    actorId: 'merchant-1',
    correlationId: 'reprice',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const assembler = new ConfirmationAuthorityAssembler(
    service,
    {
      async getCurrentByWorkflowId() {
        return {
          workflowId: `${taskId}:plan-r2`,
          workspaceId: 'ws-1',
          planId: 'plan-living',
          planRevision: 2,
          snapshotHash: 'hash-r2',
          quoteRef: { id: 'quote-r2', revision: '2' },
          rightsRevisionRefs: [],
          factRevisionRefs: [],
          frozenAt: '2026-08-09T12:00:00.000Z',
        } as never;
      },
    },
    {
      getQuote: () =>
        ({
          quoteId: 'quote-r2',
          revision: '2',
          taskId,
          creditCost: 20,
          failureRefundsCredits: true,
        }) as never,
    },
    { clock: () => new Date('2026-08-09T12:00:00.000Z') },
  );

  await assert.rejects(
    () =>
      assembler.createRequest({
        actorId: 'merchant-1',
        workspaceId: 'ws-1',
        workflowId: `${taskId}:plan-r2`,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const result = await assembler.createRequest({
    actorId: 'merchant-1',
    workspaceId: 'ws-1',
    workflowId: `${taskId}:plan-r2`,
    reservationIdempotencyKey: successorKey,
  });

  assert.equal(result.stored.request.reservationIdempotencyKey, successorKey);
  assert.equal(result.reservedCredits, 20);
  assert.equal(
    ledger.project('ws-1', '2026-08-09T12:01:00.000Z').availableCredits,
    20,
  );
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

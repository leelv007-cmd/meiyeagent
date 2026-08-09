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
  const service = new ExecutionConfirmationService(
    new MemoryExecutionConfirmationRequestStore(),
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
  );
  const plans: ConfirmationAuthorityPlanReader = {
    async getByWorkflowId() {
      return {
        workspaceId: 'ws-1',
        snapshot: {
          planId: 'plan-authority',
          planRevision: 7,
          snapshotHash: 'hash-authority',
          quoteRef: { id: 'quote-authority', revision: 'rev-3' },
          rightsRevisionRefs: ['rights-2', 'rights-1'],
          factRevisionRefs: ['fact-1'],
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
    requestId: 'confirmation:workflow-1',
    workspaceId: 'ws-1',
    planId: 'plan-authority',
    planRevision: 7,
    snapshotHash: 'hash-authority',
    quoteRef: { id: 'quote-authority', revision: 'rev-3' },
    reservationIdempotencyKey: 'consume:task:task-authority',
    createdAt: '2026-08-09T12:00:00.000Z',
    holdExpiresAt: '2026-08-11T12:00:00.000Z',
    status: 'pending',
  });
  assert.equal(result.reservedCredits, 6);
  assert.equal(result.card.rightsSummary, 'rights-1, rights-2');
  assert.equal(result.card.factSummary, 'fact-1');
  assert.equal(result.card.refundLabel, '该模型失败不退回');
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
    async getByWorkflowId() {
      return {
        workspaceId: 'ws-owner',
        snapshot: {
          planId: 'plan-1',
          planRevision: 1,
          snapshotHash: 'hash-1',
          quoteRef: { id: 'quote-1', revision: '1' },
          rightsRevisionRefs: [],
          factRevisionRefs: [],
        },
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

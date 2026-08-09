/**
 * V31-16 partial delivery settlement: 6 pages quoted, 5 delivered.
 *
 * The chain under test is the production one: ProductQuoteService.settle →
 * ProductUsageLedger (sole product-usage writer) → refundedCredits, which is the
 * only field HarnessProductBillingSettlementExecutor will hand to the workspace
 * credit ledger.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { P1DomainError } from '../foundation/domain.js';
import {
  computePartialCreditSettlement,
  isPartialDeliveryBasis,
} from './partial-delivery-settlement.js';
import { MemoryProductUsageLedger } from './product-usage-ledger.js';
import { ProductQuoteService } from './quote-service.js';

const NOW = new Date('2026-08-09T00:00:00.000Z');

function creditQuoteService(options: {
  failureRefundsCredits: boolean;
  creditCost?: number;
}) {
  const service = new ProductQuoteService({ clock: () => NOW });
  const built = service.buildQuote({
    quoteId: 'quote-note-6',
    catalogModelId: 'catalog:note-image',
    operation: 'image.generate',
    quotePolicyRevision: 'quote.policy@1',
    billingMode: 'per_request',
    creditCost: options.creditCost ?? 60,
    failureRefundsCredits: options.failureRefundsCredits,
    outputCount: 6,
    unitRate: options.creditCost ?? 60,
    workspaceId: 'workspace-partial',
    taskId: 'task-note-6',
  });
  service.confirm({ quoteId: built.quoteId, taskId: 'task-note-6' });
  service.reserve({
    quoteId: built.quoteId,
    units: [],
    usageId: 'usage-note-6',
  });
  return service;
}

test('computePartialCreditSettlement pro-rates only when the failure policy refunds', () => {
  const refunding = computePartialCreditSettlement({
    reservedCredits: 60,
    totalUnits: 6,
    deliveredUnits: 5,
    failureRefundsCredits: true,
  });
  assert.equal(refunding.failedUnits, 1);
  assert.equal(refunding.refundCredits, 10);
  assert.equal(refunding.settledCredits, 50);
  assert.match(refunding.refundRule, /退回 10 积分/u);

  const nonRefunding = computePartialCreditSettlement({
    reservedCredits: 60,
    totalUnits: 6,
    deliveredUnits: 5,
    failureRefundsCredits: false,
  });
  assert.equal(nonRefunding.refundCredits, 0);
  assert.equal(nonRefunding.settledCredits, 60);
  assert.match(nonRefunding.refundRule, /已扣积分不退/u);

  const complete = computePartialCreditSettlement({
    reservedCredits: 60,
    totalUnits: 6,
    deliveredUnits: 6,
    failureRefundsCredits: true,
  });
  assert.equal(complete.refundCredits, 0);
  assert.equal(complete.refundRule, '无失败页，不退费。');
});

test('partial delivery basis rejects impossible unit counts', () => {
  assert.equal(isPartialDeliveryBasis({ totalUnits: 6, deliveredUnits: 7 }), false);
  assert.equal(isPartialDeliveryBasis({ totalUnits: 0, deliveredUnits: 0 }), false);
  assert.equal(isPartialDeliveryBasis({ totalUnits: 6, deliveredUnits: 5 }), true);
  assert.throws(
    () =>
      computePartialCreditSettlement({
        reservedCredits: 60,
        totalUnits: 6,
        deliveredUnits: 9,
        failureRefundsCredits: true,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && /deliveredUnits/u.test(error.message),
  );
});

test('credit settle with 5/6 delivered writes a partial credit refund on the usage ledger', () => {
  const service = creditQuoteService({ failureRefundsCredits: true });
  const settled = service.settle({
    quoteId: 'quote-note-6',
    trustedUsage: {
      kind: 'product_units',
      units: [{ resource: 'image', quantity: 5 }],
      evidenceRef: 'note-plan-pages:p1@1,p2@1,p3@1,p4@1,p5@1,p6@1',
    },
    partialDelivery: { totalUnits: 6, deliveredUnits: 5 },
  });

  assert.equal(settled.usage.reservedCredits, 60);
  assert.equal(settled.usage.settledCredits, 50);
  assert.equal(settled.usage.refundedCredits, 10);
  assert.equal(settled.usage.status, 'partially_refunded');
  assert.equal(settled.quote.settlementStatus, 'reconciled');
});

test('failure-policy off keeps every credit charged on the same partial evidence', () => {
  const service = creditQuoteService({ failureRefundsCredits: false });
  const settled = service.settle({
    quoteId: 'quote-note-6',
    partialDelivery: { totalUnits: 6, deliveredUnits: 5 },
  });
  assert.equal(settled.usage.refundedCredits, 0);
  assert.equal(settled.usage.settledCredits, 60);
  assert.equal(settled.usage.status, 'committed');
});

test('no partial evidence still settles the full credit charge', () => {
  const service = creditQuoteService({ failureRefundsCredits: true });
  const settled = service.settle({ quoteId: 'quote-note-6' });
  assert.equal(settled.usage.refundedCredits, 0);
  assert.equal(settled.usage.settledCredits, 60);
  assert.equal(settled.quote.settlementStatus, 'estimated');
});

test('zero delivered units cannot be laundered through the success settle path', () => {
  const service = creditQuoteService({ failureRefundsCredits: true });
  assert.throws(
    () =>
      service.settle({
        quoteId: 'quote-note-6',
        partialDelivery: { totalUnits: 6, deliveredUnits: 0 },
      }),
    /delivered zero units and must settle through the failure path/u,
  );
});

test('usage ledger refuses a credit refund larger than the reservation', () => {
  const ledger = new MemoryProductUsageLedger();
  ledger.reserve({
    id: 'usage-guard',
    taskId: 'task-guard',
    workspaceId: 'workspace-partial',
    quoteId: 'quote-guard',
    credits: 60,
    units: [],
    billingMode: 'per_request',
    createdAt: NOW.toISOString(),
  });
  assert.throws(
    () =>
      ledger.settle({
        taskId: 'task-guard',
        settledUnits: [],
        refundCredits: 61,
        settlementStatus: 'reconciled',
        updatedAt: NOW.toISOString(),
      }),
    /cannot exceed the reserved credits/u,
  );
  // Zero side effect: the reservation is untouched after the rejected settle.
  assert.equal(ledger.getByTask('task-guard')?.status, 'reserved');
});

test('a task that reserved no credits cannot receive a credit refund', () => {
  const ledger = new MemoryProductUsageLedger();
  ledger.reserve({
    id: 'usage-units',
    taskId: 'task-units',
    workspaceId: 'workspace-partial',
    quoteId: 'quote-units',
    units: [{ resource: 'image', quantity: 6 }],
    billingMode: 'per_request',
    createdAt: NOW.toISOString(),
  });
  assert.throws(
    () =>
      ledger.settle({
        taskId: 'task-units',
        settledUnits: [{ resource: 'image', quantity: 5 }],
        refundCredits: 10,
        settlementStatus: 'reconciled',
        updatedAt: NOW.toISOString(),
      }),
    /reserved no credits/u,
  );
  assert.equal(ledger.getByTask('task-units')?.status, 'reserved');
});

test('partial credit settle replays idempotently', () => {
  const service = creditQuoteService({ failureRefundsCredits: true });
  const first = service.settle({
    quoteId: 'quote-note-6',
    partialDelivery: { totalUnits: 6, deliveredUnits: 5 },
  });
  const replay = service.settle({
    quoteId: 'quote-note-6',
    partialDelivery: { totalUnits: 6, deliveredUnits: 5 },
  });
  assert.equal(replay.usage.refundedCredits, first.usage.refundedCredits);
  assert.equal(replay.quote.settledAmount, first.quote.settledAmount);
});

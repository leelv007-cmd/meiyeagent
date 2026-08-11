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
  computePackagePartialCreditSettlement,
  computePartialCreditSettlement,
  isPackagePartialDeliveryBasis,
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

function packageCreditQuoteService() {
  const service = new ProductQuoteService({ clock: () => NOW });
  const built = service.buildQuote({
    quoteId: 'quote-note-copy-package',
    catalogModelId: 'package-root-not-executable',
    quotePolicyRevision: 'quote.policy@1',
    billingMode: 'per_request',
    creditCost: 67,
    outputCount: 7,
    unitRate: 67,
    workspaceId: 'workspace-partial',
    taskId: 'task-note-copy-package',
    packageContract: {
      contractHash: 'package-contract-note-copy-r1',
      allocations: [
        {
          allocationId: 'note-pages',
          carrier: 'note',
          deliveryUnits: 6,
          creditCost: 60,
          failureRefundsCredits: true,
          operation: 'image.generate',
          catalogModel: { id: 'catalog:note-image', revision: 'catalog-r1' },
          routeSnapshotRef: 'route-note-r1',
          rightsRevisionRefs: ['rights:note-r1'],
        },
        {
          allocationId: 'copy-caption',
          carrier: 'copy',
          deliveryUnits: 1,
          creditCost: 7,
          failureRefundsCredits: false,
          operation: 'copy.generate',
          catalogModel: { id: 'catalog:copy', revision: 'catalog-r1' },
          routeSnapshotRef: 'route-copy-r1',
          rightsRevisionRefs: ['rights:copy-r1'],
        },
      ],
    },
  });
  service.confirm({ quoteId: built.quoteId, taskId: 'task-note-copy-package' });
  service.reserve({
    quoteId: built.quoteId,
    units: [],
    usageId: 'usage-note-copy-package',
  });
  return service;
}

test('package quote build rejects aggregate output or credit totals that drift from allocations', () => {
  const service = new ProductQuoteService({ clock: () => NOW });
  assert.throws(
    () =>
      service.buildQuote({
        quoteId: 'quote-package-bad-total',
        catalogModelId: 'package-root-not-executable',
        quotePolicyRevision: 'quote.policy@1',
        billingMode: 'per_request',
        creditCost: 10,
        outputCount: 1,
        unitRate: 10,
        packageContract: {
          contractHash: 'package-contract-bad-total',
          allocations: [
            {
              allocationId: 'note-pages',
              carrier: 'note',
              deliveryUnits: 2,
              creditCost: 10,
              failureRefundsCredits: true,
              operation: 'image.generate',
              catalogModel: { id: 'catalog:note-image', revision: 'catalog-r1' },
              routeSnapshotRef: 'route-note-r1',
              rightsRevisionRefs: ['rights:note-r1'],
            },
          ],
        },
      }),
    /outputCount and creditCost must equal the allocation totals/u,
  );
});

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

test('package partial settlement refunds each allocation at its own price and policy', () => {
  const settled = computePackagePartialCreditSettlement({
    allocations: [
      {
        allocationId: 'note-pages',
        deliveryUnits: 6,
        creditCost: 60,
        failureRefundsCredits: true,
      },
      {
        allocationId: 'copy-caption',
        deliveryUnits: 1,
        creditCost: 7,
        failureRefundsCredits: false,
      },
    ],
    partialDelivery: {
      allocations: [
        { allocationId: 'note-pages', deliveredUnits: 5 },
        { allocationId: 'copy-caption', deliveredUnits: 0 },
      ],
    },
  });

  assert.equal(settled.reservedCredits, 67);
  assert.equal(settled.settledCredits, 57);
  assert.equal(settled.refundCredits, 10);
  assert.equal(
    settled.allocations.find((allocation) => allocation.allocationId === 'note-pages')
      ?.refundCredits,
    10,
  );
  assert.equal(
    settled.allocations.find((allocation) => allocation.allocationId === 'copy-caption')
      ?.refundCredits,
    0,
  );
  assert.equal(
    isPackagePartialDeliveryBasis({
      allocations: [{ allocationId: 'note-pages', deliveredUnits: 5 }],
    }),
    true,
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

test('package quote rejects global partial evidence and settles allocation evidence without a global ratio', () => {
  const service = packageCreditQuoteService();
  assert.throws(
    () =>
      service.settle({
        quoteId: 'quote-note-copy-package',
        partialDelivery: { totalUnits: 7, deliveredUnits: 5 },
      }),
    /requires allocation-keyed partial delivery evidence/u,
  );

  const settled = service.settle({
    quoteId: 'quote-note-copy-package',
    packagePartialDelivery: {
      allocations: [
        { allocationId: 'note-pages', deliveredUnits: 5 },
        { allocationId: 'copy-caption', deliveredUnits: 0 },
      ],
    },
  });
  assert.equal(settled.usage.reservedCredits, 67);
  assert.equal(settled.usage.settledCredits, 57);
  assert.equal(settled.usage.refundedCredits, 10);
  assert.equal(settled.quote.settledAmount, 57);
});

test('full package failure applies each allocation failure policy', () => {
  const service = packageCreditQuoteService();
  const failed = service.failAndRefund({ quoteId: 'quote-note-copy-package' });
  assert.equal(failed.usage.settledCredits, 7);
  assert.equal(failed.usage.refundedCredits, 60);
  assert.equal(failed.quote.settledAmount, 7);
  assert.equal(failed.quote.refundedAmount, 60);
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

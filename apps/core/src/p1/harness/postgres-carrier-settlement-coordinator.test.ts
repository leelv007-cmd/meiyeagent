import assert from 'node:assert/strict';
import test from 'node:test';

import { settlementIdempotencyKey } from '../execution-spine/billing-identity.js';
import type { HarnessBillingSettlementInput } from './billing-compensation.js';
import { carrierReceiptFingerprint } from './carrier-settlement-coordinator.js';
import { reduceCarrierReceiptsForWork } from './postgres-carrier-settlement-coordinator.js';

function settlement(
  carrierUnitId: string,
  carrierBillableUnits: number,
  partialDelivery?: { totalUnits: number; deliveredUnits: number },
): HarnessBillingSettlementInput {
  const billingIdentity = {
    workspaceId: 'workspace-carrier',
    taskId: 'merchant-task',
    workId: 'work-carrier',
    workflowId: `workflow-${carrierUnitId}`,
    quoteRef: { id: 'quote-carrier', revision: 'revision-1' },
    reservationId: 'consume:task:merchant-task',
    carrierUnitId,
    carrierUnitIds: ['copy', 'note'],
    carrierBillableUnits,
  };
  return {
    workspaceId: billingIdentity.workspaceId,
    taskId: billingIdentity.workflowId,
    billingTaskId: billingIdentity.taskId,
    billingIdentity,
    settlementIdempotencyKey: settlementIdempotencyKey(billingIdentity),
    quoteId: billingIdentity.quoteRef.id,
    quoteRevision: billingIdentity.quoteRef.revision,
    ...(partialDelivery ? { partialDelivery } : {}),
  };
}

function packageSettlement(
  carrierUnitId: 'carrier-copy' | 'carrier-note',
  actionPartial?: { totalUnits: number; deliveredUnits: number },
): HarnessBillingSettlementInput {
  const packageBilling = {
    contractHash: 'package-contract-carrier-r1',
    allocations: [
      {
        carrierUnitId: 'carrier-note',
        allocationId: 'note-pages',
        carrier: 'note' as const,
        deliveryUnits: 6,
        creditCost: 60,
        failureRefundsCredits: true,
        operation: 'note.generate',
        catalogModel: { id: 'note-model', revision: 'note-r1' },
        routeSnapshotRef: 'route-note-r1',
        rightsRevisionRefs: ['rights-note-r1'],
      },
      {
        carrierUnitId: 'carrier-copy',
        allocationId: 'copy-document',
        carrier: 'copy' as const,
        deliveryUnits: 1,
        creditCost: 17,
        failureRefundsCredits: false,
        operation: 'copy.generate',
        catalogModel: { id: 'copy-model', revision: 'copy-r1' },
        routeSnapshotRef: 'route-copy-r1',
        rightsRevisionRefs: ['rights-copy-r1'],
      },
    ],
  };
  const allocation = packageBilling.allocations.find(
    (candidate) => candidate.carrierUnitId === carrierUnitId,
  )!;
  const billingIdentity = {
    workspaceId: 'workspace-package-carrier',
    taskId: 'merchant-package-task',
    workId: 'work-package-carrier',
    workflowId: `workflow-${carrierUnitId}`,
    quoteRef: { id: 'quote-package-carrier', revision: 'revision-package-1' },
    reservationId: 'consume:task:merchant-package-task',
    carrierUnitId,
    carrierUnitIds: ['carrier-copy', 'carrier-note'],
    carrierBillableUnits: allocation.deliveryUnits,
    packageBilling,
  };
  return {
    workspaceId: billingIdentity.workspaceId,
    taskId: billingIdentity.workflowId,
    billingTaskId: billingIdentity.taskId,
    billingIdentity,
    settlementIdempotencyKey: settlementIdempotencyKey(billingIdentity),
    quoteId: billingIdentity.quoteRef.id,
    quoteRevision: billingIdentity.quoteRef.revision,
    ...(actionPartial ? { partialDelivery: actionPartial } : {}),
  };
}

test('multi-carrier receipts fail closed without a frozen package billing contract', () => {
  const note = settlement('note', 2, { totalUnits: 2, deliveredUnits: 1 });
  const copy = settlement('copy', 1);
  assert.throws(
    () =>
      reduceCarrierReceiptsForWork({
        aggregateKey: 'aggregate-1',
        expectedCarrierUnitIds: ['copy', 'note'],
        receipts: [
          { action: 'refund', fingerprint: 'copy', payload: copy },
          { action: 'commit', fingerprint: 'note', payload: note },
        ],
      }),
    /frozen package billing contract/u,
  );
});

test('carrier receipt reducer refuses a multi-carrier trusted usage guess', () => {
  const note = settlement('note', 1);
  const copy = {
    ...settlement('copy', 1),
    trustedUsage: {
      kind: 'media_duration' as const,
      actualSeconds: 3,
    },
  };
  assert.throws(
    () =>
      reduceCarrierReceiptsForWork({
        aggregateKey: 'aggregate-2',
        expectedCarrierUnitIds: ['copy', 'note'],
        receipts: [
          { action: 'commit', fingerprint: 'note', payload: note },
          { action: 'commit', fingerprint: 'copy', payload: copy },
        ],
      }),
    /carrier-aware product quote reducer/u,
  );
});

test('carrier receipt replay ignores the queue-added idempotency transport field', () => {
  const queued = settlement('note', 1);
  const { settlementIdempotencyKey: _key, ...direct } = queued;
  assert.equal(
    carrierReceiptFingerprint({ action: 'commit', settlement: direct }),
    carrierReceiptFingerprint({ action: 'commit', settlement: queued }),
  );
});

test('package receipts cover allocation ids exactly and never use global price proration', () => {
  const note = packageSettlement('carrier-note', {
    totalUnits: 6,
    deliveredUnits: 5,
  });
  const copy = packageSettlement('carrier-copy');
  const ready = reduceCarrierReceiptsForWork({
    aggregateKey: 'package-aggregate-1',
    expectedCarrierUnitIds: ['carrier-copy', 'carrier-note'],
    receipts: [
      { action: 'refund', fingerprint: 'copy', payload: copy },
      { action: 'commit', fingerprint: 'note', payload: note },
    ],
  });

  assert.equal(ready?.action, 'commit');
  assert.equal(ready?.settlement.partialDelivery, undefined);
  assert.deepEqual(ready?.settlement.packagePartialDelivery, {
    allocations: [
      { allocationId: 'note-pages', deliveredUnits: 5 },
      { allocationId: 'copy-document', deliveredUnits: 0 },
    ],
  });
});

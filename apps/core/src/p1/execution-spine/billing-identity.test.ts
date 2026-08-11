/**
 * R-P0-05 canonical BillingIdentity tests.
 *
 * - admission-time freeze is deterministic (replay produces the same identity)
 * - fail closed when the frozen request cannot produce an identity
 * - V31-47 carrier fan-out marks the carrier unit on the identity
 * - Campaign Work1/Work2 settle under distinct identities
 * - a persisted frozen identity that no longer matches the request is rejected
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSameBillingIdentity,
  BillingIdentityError,
  billingPlanId,
  billingIdentityReservationFingerprint,
  buildBillingIdentity,
  isCreditReservationId,
  type BillingIdentitySource,
} from './billing-identity.js';

function fullRequest(overrides: Partial<BillingIdentitySource> = {}): BillingIdentitySource {
  return {
    workspaceId: 'workspace-1',
    billingTaskId: 'task-source-1',
    executionSnapshot: {
      work: { id: 'work-1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
    },
    executionPlanSnapshot: {
      planId: 'plan-1',
      planRevision: 2,
      snapshotHash: 'hash-1',
      quoteRef: { id: 'quote-1', revision: 'quote-r1' },
    },
    usageReservation: {
      id: 'usage-reservation-1',
      creditUsageOperationId: 'consume:task:task-source-1',
    },
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
    ...overrides,
  };
}

test('admission produces the canonical frozen identity', () => {
  const identity = buildBillingIdentity(fullRequest(), 'task-source-1');
  assert.deepEqual(identity, {
    workspaceId: 'workspace-1',
    taskId: 'task-source-1',
    workId: 'work-1',
    workflowId: 'task-source-1',
    planId: billingPlanId('plan-1'),
    planRevision: 2,
    snapshotHash: 'hash-1',
    quoteRef: { id: 'quote-1', revision: 'quote-r1' },
    creditUsageOperationId: 'consume:task:task-source-1',
    productUsageReservationId: 'usage-reservation-1',
    reservationId: 'typed|-|consume:task:task-source-1|usage-reservation-1',
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
  });
});

test('replay derives the identical identity and the frozen copy must match', () => {
  const first = buildBillingIdentity(fullRequest(), 'task-source-1');
  const replay = buildBillingIdentity(fullRequest(), 'task-source-1');
  assertSameBillingIdentity(first!, replay!);
  assert.throws(
    () =>
      assertSameBillingIdentity(
        first!,
        buildBillingIdentity(
          fullRequest({ executionPlanSnapshot: undefined }),
          'task-source-1',
        )!,
      ),
    (error: unknown) =>
      error instanceof BillingIdentityError &&
      error.code === 'BILLING_IDENTITY_MISMATCH',
  );
});

test('a request without an execution snapshot has nothing to bill', () => {
  assert.equal(
    buildBillingIdentity({ workspaceId: 'workspace-1' }, 'task-legacy'),
    null,
  );
});

test('missing frozen fields fail closed instead of guessing', () => {
  for (const [name, request] of [
    ['missing work', fullRequest({ executionSnapshot: { quote: { id: 'q', revision: '1' } } })],
    [
      'missing quote',
      fullRequest({
        executionSnapshot: { work: { id: 'w' } },
        executionPlanSnapshot: undefined,
        pendingExecutionPlanSnapshot: undefined,
      }),
    ],
    ['missing reservation', fullRequest({ usageReservation: undefined })],
    ['missing workspace', fullRequest({ workspaceId: undefined })],
    ['missing carrier', fullRequest({ carrierUnitId: undefined })],
    ['missing carrier set', fullRequest({ carrierUnitIds: undefined })],
    ['missing carrier allocation', fullRequest({ carrierBillableUnits: undefined })],
  ] as Array<[string, BillingIdentitySource]>) {
    assert.throws(
      () => buildBillingIdentity(request, 'task-x'),
      (error: unknown) =>
        error instanceof BillingIdentityError &&
        error.code === 'BILLING_IDENTITY_UNAVAILABLE',
      name,
    );
  }
});

test('the pending successor plan wins the effective quote and snapshot binding', () => {
  const identity = buildBillingIdentity(
    fullRequest({
      executionPlanSnapshot: {
        planId: 'plan-1',
        planRevision: 1,
        snapshotHash: 'hash-r1',
        quoteRef: { id: 'quote-1', revision: 'quote-r1' },
      },
      pendingExecutionPlanSnapshot: {
        snapshotHash: 'hash-r2',
        content: {
          planId: 'plan-1',
          planRevision: 2,
          quoteRef: { id: 'quote-1', revision: 'quote-r2' },
        },
      },
    }),
    'task-source-1',
  );
  assert.equal(identity?.planRevision, 2);
  assert.equal(identity?.snapshotHash, 'hash-r2');
  assert.deepEqual(identity?.quoteRef, { id: 'quote-1', revision: 'quote-r2' });
});

test('V31-47 carrier fan-out freezes the explicit carrier unit into the identity', () => {
  const identity = buildBillingIdentity(
    fullRequest({
      carrierUnitId: 'note',
      carrierUnitIds: ['note'],
    }),
    'task-source-1:plan-r1:carrier-note',
  );
  assert.equal(identity?.carrierUnitId, 'note');
  assert.equal(identity?.workflowId, 'task-source-1:plan-r1:carrier-note');
  assert.equal(
    buildBillingIdentity(fullRequest(), 'task-source-1:plan-r1')?.carrierUnitId,
    'single',
  );
});

test('package identity retains the full allocation authority and rejects carrier quantity drift', () => {
  const packageBilling = {
    contractHash: 'package-contract-r1',
    allocations: [
      {
        carrierUnitId: 'carrier-copy',
        allocationId: 'copy-document',
        carrier: 'copy' as const,
        deliveryUnits: 1,
        creditCost: 17,
        failureRefundsCredits: true,
        operation: 'copy.generate',
        catalogModel: { id: 'copy-model', revision: 'copy-r2' },
        routeSnapshotRef: 'route-copy-r2',
        rightsRevisionRefs: ['rights-copy-r2'],
      },
      {
        carrierUnitId: 'carrier-note',
        allocationId: 'note-pages',
        carrier: 'note' as const,
        deliveryUnits: 6,
        creditCost: 60,
        failureRefundsCredits: true,
        operation: 'note.generate',
        catalogModel: { id: 'note-model', revision: 'note-r4' },
        routeSnapshotRef: 'route-note-r4',
        rightsRevisionRefs: ['rights-note-r4'],
      },
    ],
  };
  const request = fullRequest({
    carrierUnitId: 'carrier-note',
    carrierUnitIds: ['carrier-copy', 'carrier-note'],
    carrierBillableUnits: 6,
    executionPlanSnapshot: {
      planId: 'plan-1',
      planRevision: 2,
      snapshotHash: 'hash-package-r1',
      quoteRef: { id: 'quote-1', revision: 'quote-r1' },
      packageBilling,
    },
  });
  const identity = buildBillingIdentity(request, 'workflow-carrier-note');

  assert.deepEqual(identity?.packageBilling, packageBilling);
  assert.throws(
    () =>
      buildBillingIdentity(
        { ...request, carrierBillableUnits: 5 },
        'workflow-carrier-note',
      ),
    (error: unknown) =>
      error instanceof BillingIdentityError &&
      error.code === 'BILLING_IDENTITY_UNAVAILABLE',
  );
});

test('campaign Work1 and Work2 settle under distinct identities', () => {
  const base = {
    executionPlanSnapshot: undefined,
    pendingExecutionPlanSnapshot: undefined,
  };
  const work1 = buildBillingIdentity(
    fullRequest({
      ...base,
      billingTaskId: 'campaign-work-1',
      executionSnapshot: { work: { id: 'work-1' }, quote: { id: 'quote-w1', revision: '1' } },
      usageReservation: { id: 'usage-w1', creditUsageOperationId: 'consume:task:campaign-work-1' },
    }),
    'campaign-work-1',
  );
  const work2 = buildBillingIdentity(
    fullRequest({
      ...base,
      billingTaskId: 'campaign-work-2',
      executionSnapshot: { work: { id: 'work-2' }, quote: { id: 'quote-w2', revision: '1' } },
      usageReservation: { id: 'usage-w2', creditUsageOperationId: 'consume:task:campaign-work-2' },
    }),
    'campaign-work-2',
  );
  assert.notEqual(work1?.taskId, work2?.taskId);
  assert.notEqual(work1?.workId, work2?.workId);
  assert.notEqual(work1?.quoteRef.id, work2?.quoteRef.id);
});

test('typed operation sources and the legacy alias fail closed on mismatch', () => {
  assert.throws(
    () =>
      buildBillingIdentity(
        fullRequest({ creditUsageOperationId: 'consume:task:other' }),
        'task-source-1',
      ),
    (error: unknown) =>
      error instanceof BillingIdentityError &&
      error.code === 'BILLING_IDENTITY_MISMATCH',
  );
  assert.throws(
    () =>
      billingIdentityReservationFingerprint({
        creditHoldOperationId: 'consume:confirmation:hold-1',
        creditUsageOperationId: 'consume:task:task-1',
        productUsageReservationId: 'usage-reservation-1',
        reservationId: 'consume:task:task-1',
      }),
    (error: unknown) =>
      error instanceof BillingIdentityError &&
      error.code === 'BILLING_IDENTITY_MISMATCH',
  );
});

test('credit reservation ids are recognized by their consume prefix only', () => {
  assert.equal(isCreditReservationId('consume:task:task-1'), true);
  assert.equal(isCreditReservationId('consume:confirmation:abc'), true);
  assert.equal(isCreditReservationId('usage-reservation-1'), false);
});

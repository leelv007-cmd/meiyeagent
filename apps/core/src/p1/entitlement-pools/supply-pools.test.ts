import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupplierPriceRevision } from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import {
  CONSUME_IDEMPOTENCY_KEY_PREFIX,
  GRANT_IDEMPOTENCY_KEY_PREFIX,
  MemoryGrantLotLedger,
  allocateFifoConsumption,
  assertIndependentGrantConsumeIdempotencyKeys,
  buildConsumeIdempotencyKey,
  compareGrantLotsForFifo,
  normalizeGrantIdempotencyKey,
  type GrantLot,
} from '../foundation/grant-lot.js';
import { MemoryProductUsageLedger } from '../product-billing/product-usage-ledger.js';
import { AccountAllocationStore } from './account-allocation.js';
import { SupplyAccountFairQueue } from './fair-queue.js';
import {
  capacitySupplyAccountLockKey,
  capacitySystemLockKey,
} from './postgres-repository.js';
import {
  SupplierVarianceLedger,
  SupplySideProductUsageBridge,
  assertGrantConsumeIdempotencySeparation,
  buildProviderCostEventFromFreeze,
  buildSupplyRequestFreeze,
  projectUserFacingCost,
} from './supply-ledger-fields.js';
import { SupplyPoolRegistry } from './supply-pool.js';
import { ThreeLayerCapacityGate } from './three-layer-capacity.js';

const priceRevision = (): SupplierPriceRevision => ({
  id: 'spr-1',
  deploymentId: 'dep-copy-a',
  amountMicros: 1200,
  currency: 'CNY',
  unit: 'request',
  evidence: {
    source: 'observed_usage',
    observedAt: '2026-07-20T00:00:00.000Z',
  },
  revisionId: 'spr-1:r1',
});

// ---------------------------------------------------------------------------
// SupplyPool shared + dedicated + no silent cross-kind fallback
// ---------------------------------------------------------------------------

test('SupplyPool shared default and DedicatedSupplyPool bind via contract or AccountAllocation', () => {
  const registry = new SupplyPoolRegistry();
  const shared = registry.registerShared({
    id: 'pool-shared-default',
    displayName: 'Shared default',
    credentialAccountIds: ['cred-shared-1'],
    deploymentIds: ['dep-1'],
    capacity: {
      supplyAccount: { concurrency: 4 },
      productAccount: { concurrency: 2 },
      systemTotal: { concurrency: 8 },
    },
    revisionId: 'pool-shared:r1',
  });
  assert.equal(shared.kind, 'shared');

  const dedicated = registry.registerDedicated({
    id: 'pool-dedicated-enterprise',
    displayName: 'Enterprise dedicated',
    credentialAccountIds: ['cred-dedicated-1'],
    deploymentIds: ['dep-ent-1'],
    contractRef: 'contract:ent-acme',
    authorizedWorkspaceIds: ['ws-enterprise'],
    regionRestriction: ['domestic'],
    dataClassRestriction: ['public', 'contains_face'],
    exclusiveBilling: true,
    reservedCapacity: {
      supplyAccount: { concurrency: 2 },
      productAccount: { concurrency: 2 },
      systemTotal: { concurrency: 2 },
    },
    revisionId: 'pool-dedicated:r1',
  });
  assert.equal(dedicated.kind, 'dedicated');
  assert.equal(dedicated.exclusiveBilling, true);

  // Contract-authorized workspace may use dedicated.
  assert.equal(
    registry.isWorkspaceAuthorizedForPool({
      poolId: dedicated.id,
      workspaceId: 'ws-enterprise',
      accountId: 'acct-ent',
    }),
    true
  );

  // Foreign workspace needs AccountAllocation grant.
  assert.equal(
    registry.isWorkspaceAuthorizedForPool({
      poolId: dedicated.id,
      workspaceId: 'ws-other',
      accountId: 'acct-other',
    }),
    false
  );

  const store = new AccountAllocationStore();
  const allocation = store.append({
    accountId: 'acct-other',
    workspaceId: 'ws-other',
    kind: 'grant',
    target: { type: 'supply_pool', supplyPoolId: dedicated.id },
    delta: { mode: 'set', enabled: true },
    source: 'enterprise_contract',
    reason: 'Pilot-on dedicated access',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
    correlationId: 'corr-pool-grant',
  });
  assert.equal(
    registry.isWorkspaceAuthorizedForPool({
      poolId: dedicated.id,
      workspaceId: 'ws-other',
      accountId: 'acct-other',
      allocations: [allocation],
    }),
    true
  );

  // Shared is open by default.
  assert.equal(
    registry.isWorkspaceAuthorizedForPool({
      poolId: shared.id,
      workspaceId: 'ws-any',
      accountId: 'acct-any',
    }),
    true
  );
});

test('shared/dedicated cross-kind fallback is denied without contract+data policy auth', () => {
  const registry = new SupplyPoolRegistry();
  registry.registerShared({
    id: 'pool-shared',
    displayName: 'Shared',
    credentialAccountIds: ['cred-s'],
    deploymentIds: ['dep-s'],
    revisionId: 'r1',
  });
  registry.registerDedicated({
    id: 'pool-dedicated',
    displayName: 'Dedicated',
    credentialAccountIds: ['cred-d'],
    deploymentIds: ['dep-d'],
    contractRef: 'contract:x',
    authorizedWorkspaceIds: ['ws-a'],
    revisionId: 'r1',
  });

  const denied = registry.resolve({
    preferredPoolId: 'pool-dedicated',
    fallbackPoolId: 'pool-shared',
    preferredUnavailable: true,
    workspaceId: 'ws-a',
    accountId: 'acct-a',
  });
  assert.equal(denied.status, 'denied');
  if (denied.status === 'denied') {
    assert.equal(denied.code, 'CROSS_KIND_FALLBACK_DENIED');
  }

  const stillDeniedPartial = registry.resolve({
    preferredPoolId: 'pool-dedicated',
    fallbackPoolId: 'pool-shared',
    preferredUnavailable: true,
    workspaceId: 'ws-a',
    accountId: 'acct-a',
    authorization: {
      contractEntitlementAuthorized: true,
      dataPolicyAuthorized: false,
    },
  });
  assert.equal(stillDeniedPartial.status, 'denied');

  const allowed = registry.resolve({
    preferredPoolId: 'pool-dedicated',
    fallbackPoolId: 'pool-shared',
    preferredUnavailable: true,
    workspaceId: 'ws-a',
    accountId: 'acct-a',
    authorization: {
      contractEntitlementAuthorized: true,
      dataPolicyAuthorized: true,
    },
  });
  assert.equal(allowed.status, 'resolved');
  if (allowed.status === 'resolved') {
    assert.equal(allowed.pool.id, 'pool-shared');
    assert.equal(allowed.via, 'authorized_fallback');
  }

  // Reverse direction also requires dual authorization.
  const reverseDenied = registry.resolve({
    preferredPoolId: 'pool-shared',
    fallbackPoolId: 'pool-dedicated',
    preferredUnavailable: true,
    workspaceId: 'ws-a',
    accountId: 'acct-a',
  });
  assert.equal(reverseDenied.status, 'denied');
});

// ---------------------------------------------------------------------------
// Three-layer capacity + multi product-account bypass negative
// ---------------------------------------------------------------------------

test('three-layer capacity admits within supply/product/system limits', () => {
  const gate = new ThreeLayerCapacityGate('cred-shared-1', {
    supplyAccount: { concurrency: 3 },
    productAccount: { concurrency: 2 },
    systemTotal: { concurrency: 5 },
  });

  const a1 = gate.tryAcquire({
    productAccountId: 'acct-a',
    workspaceId: 'ws-a',
  });
  assert.equal(a1.status, 'admitted');
  const a2 = gate.tryAcquire({
    productAccountId: 'acct-a',
    workspaceId: 'ws-a',
  });
  assert.equal(a2.status, 'admitted');
  const a3 = gate.tryAcquire({
    productAccountId: 'acct-a',
    workspaceId: 'ws-a',
  });
  assert.equal(a3.status, 'rejected');
  if (a3.status === 'rejected') {
    assert.equal(a3.layer, 'product_account');
  }

  const b1 = gate.tryAcquire({
    productAccountId: 'acct-b',
    workspaceId: 'ws-b',
  });
  assert.equal(b1.status, 'admitted');

  // supply-account limit = 3, already 3 leases → reject at supply layer
  const b2 = gate.tryAcquire({
    productAccountId: 'acct-b',
    workspaceId: 'ws-b',
  });
  assert.equal(b2.status, 'rejected');
  if (b2.status === 'rejected') {
    assert.equal(b2.layer, 'supply_account');
  }
});

test('negative: multiple product accounts cannot bypass upstream shared limits', () => {
  // Pure concurrency ceiling — no rpm so this test only asserts concurrency.
  const gate = new ThreeLayerCapacityGate('cred-shared-upstream', {
    supplyAccount: { concurrency: 3 },
    productAccount: { concurrency: 10 },
    systemTotal: { concurrency: 100 },
  });
  gate.setProductAccountLimit('acct-1', 10);
  gate.setProductAccountLimit('acct-2', 10);
  gate.setProductAccountLimit('acct-3', 10);
  gate.setProductAccountLimit('acct-4', 10);

  const admitted: string[] = [];
  const productAccounts = ['acct-1', 'acct-2', 'acct-3', 'acct-4'];
  for (const accountId of productAccounts) {
    for (let i = 0; i < 10; i += 1) {
      const decision = gate.tryAcquire({
        productAccountId: accountId,
        workspaceId: `ws-${accountId}`,
        leaseId: `${accountId}:${i}`,
      });
      if (decision.status === 'admitted') {
        admitted.push(decision.lease.leaseId);
      }
    }
  }

  // Stacking four product accounts must not exceed supply-account concurrency=3.
  assert.equal(admitted.length, 3);
  assert.equal(gate.snapshot().supplyAccountInUse, 3);
  assert.ok(admitted.length <= gate.effectiveUpstreamCeiling());

  const overflow = gate.tryAcquire({
    productAccountId: 'acct-1',
    workspaceId: 'ws-acct-1',
    leaseId: 'overflow',
  });
  assert.equal(overflow.status, 'rejected');
  if (overflow.status === 'rejected') {
    assert.equal(overflow.layer, 'supply_account');
    assert.equal(overflow.code, 'CAPACITY_EXHAUSTED');
  }

  // System-total is also an absolute ceiling when tighter than product sum.
  const systemTight = new ThreeLayerCapacityGate('cred-sys', {
    supplyAccount: { concurrency: 50 },
    productAccount: { concurrency: 20 },
    systemTotal: { concurrency: 2 },
  });
  assert.equal(
    systemTight.tryAcquire({ productAccountId: 'p1', workspaceId: 'w1' }).status,
    'admitted'
  );
  assert.equal(
    systemTight.tryAcquire({ productAccountId: 'p2', workspaceId: 'w2' }).status,
    'admitted'
  );
  const blocked = systemTight.tryAcquire({
    productAccountId: 'p3',
    workspaceId: 'w3',
  });
  assert.equal(blocked.status, 'rejected');
  if (blocked.status === 'rejected') {
    assert.equal(blocked.layer, 'system_total');
  }
});

test('supply-account sliding-window RPM rejects after rate limit within 60s', () => {
  let nowMs = Date.parse('2026-07-20T12:00:00.000Z');
  const gate = new ThreeLayerCapacityGate(
    'cred-rpm',
    {
      // High concurrency so only RPM can reject.
      supplyAccount: { concurrency: 50, rpm: 3 },
      productAccount: { concurrency: 50 },
      systemTotal: { concurrency: 50 },
    },
    () => new Date(nowMs)
  );

  for (let i = 0; i < 3; i += 1) {
    const decision = gate.tryAcquire({
      productAccountId: 'acct-rpm',
      workspaceId: 'ws-rpm',
      leaseId: `rpm-${i}`,
    });
    assert.equal(decision.status, 'admitted', `rpm admit ${i}`);
    // Release concurrency so only rate limit remains binding.
    if (decision.status === 'admitted') {
      gate.release(decision.lease.leaseId);
    }
  }

  const rejected = gate.tryAcquire({
    productAccountId: 'acct-rpm',
    workspaceId: 'ws-rpm',
    leaseId: 'rpm-overflow',
  });
  assert.equal(rejected.status, 'rejected');
  if (rejected.status === 'rejected') {
    assert.equal(rejected.layer, 'supply_account');
    assert.equal(rejected.limit, 3);
    assert.equal(rejected.inUse, 3);
    assert.match(rejected.message, /RPM exhausted/);
  }

  // After the 60s window slides past the first admits, RPM allows again.
  nowMs += 60_001;
  const afterWindow = gate.tryAcquire({
    productAccountId: 'acct-rpm',
    workspaceId: 'ws-rpm',
    leaseId: 'rpm-after-window',
  });
  assert.equal(afterWindow.status, 'admitted');
});

// ---------------------------------------------------------------------------
// Fair queue contract
// ---------------------------------------------------------------------------

test('fair queue contract: peers share supply slots; priority still orders bands', () => {
  const queue = new SupplyAccountFairQueue('cred-shared-1');
  const t0 = '2026-07-20T00:00:00.000Z';
  // Same priority band — must interleave across product accounts.
  for (const accountId of ['acct-a', 'acct-b', 'acct-c']) {
    for (let i = 0; i < 4; i += 1) {
      queue.enqueue({
        requestId: `${accountId}-${i}`,
        productAccountId: accountId,
        workspaceId: `ws-${accountId}`,
        queuePriority: 5,
        enqueuedAt: t0,
      });
    }
  }

  const counts = queue.drainServiceCounts(12);
  assert.equal(counts.get('acct-a'), 4);
  assert.equal(counts.get('acct-b'), 4);
  assert.equal(counts.get('acct-c'), 4);

  // Re-enqueue and verify no monopoly on first N slots under fairness.
  for (const accountId of ['acct-a', 'acct-b']) {
    for (let i = 0; i < 6; i += 1) {
      queue.enqueue({
        requestId: `round2-${accountId}-${i}`,
        productAccountId: accountId,
        workspaceId: `ws-${accountId}`,
        queuePriority: 1,
        enqueuedAt: t0,
      });
    }
  }
  const firstSix: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const result = queue.dequeue();
    assert.equal(result.status, 'dequeued');
    if (result.status === 'dequeued') {
      firstSix.push(result.entry.productAccountId);
    }
  }
  const aCount = firstSix.filter((id) => id === 'acct-a').length;
  const bCount = firstSix.filter((id) => id === 'acct-b').length;
  assert.ok(aCount >= 2 && bCount >= 2, `expected interleave, got ${firstSix.join(',')}`);

  // Higher priority band is always preferred over lower.
  const priorityQueue = new SupplyAccountFairQueue('cred-prio');
  priorityQueue.enqueue({
    requestId: 'low',
    productAccountId: 'acct-low',
    workspaceId: 'ws-low',
    queuePriority: 1,
    enqueuedAt: t0,
  });
  priorityQueue.enqueue({
    requestId: 'high',
    productAccountId: 'acct-high',
    workspaceId: 'ws-high',
    queuePriority: 10,
    enqueuedAt: '2026-07-20T00:01:00.000Z',
  });
  const first = priorityQueue.dequeue();
  assert.equal(first.status, 'dequeued');
  if (first.status === 'dequeued') {
    assert.equal(first.entry.requestId, 'high');
  }

  // A sustained high-priority backlog receives its weighted share but cannot
  // starve a continuously waiting low-priority request.
  const weightedQueue = new SupplyAccountFairQueue('cred-weighted');
  weightedQueue.enqueue({
    requestId: 'low-waiting',
    productAccountId: 'acct-low',
    workspaceId: 'ws-low',
    queuePriority: 0,
    enqueuedAt: t0,
  });
  for (let i = 0; i < 24; i += 1) {
    weightedQueue.enqueue({
      requestId: `high-backlog-${i}`,
      productAccountId: 'acct-high',
      workspaceId: 'ws-high',
      queuePriority: 10,
      enqueuedAt: t0,
    });
  }
  const firstTwelve = Array.from({ length: 12 }, () => weightedQueue.dequeue());
  assert.ok(
    firstTwelve.some(
      (result) =>
        result.status === 'dequeued' && result.entry.requestId === 'low-waiting',
    ),
    'weighted priority must admit the waiting low-priority account by turn 12',
  );
});

test('fair queue service counts use a sliding window (F-H-05)', () => {
  const window = 4;
  const queue = new SupplyAccountFairQueue('cred-window', {
    maxRecentServed: window,
  });
  const t0 = '2026-07-20T00:00:00.000Z';

  // Serve 6 turns for acct-a only — window retains 4, not 6.
  for (let i = 0; i < 6; i += 1) {
    queue.enqueue({
      requestId: `a-${i}`,
      productAccountId: 'acct-a',
      workspaceId: 'ws-a',
      queuePriority: 1,
      enqueuedAt: t0,
    });
    const dequeued = queue.dequeue();
    assert.equal(dequeued.status, 'dequeued');
  }
  assert.equal(queue.recentServiceSampleSize(), window);
  assert.equal(queue.snapshotServiceCounts().get('acct-a'), window);

  // Serve 4 more for acct-b — window is all acct-b; acct-a weight fully decays.
  for (let i = 0; i < window; i += 1) {
    queue.enqueue({
      requestId: `b-${i}`,
      productAccountId: 'acct-b',
      workspaceId: 'ws-b',
      queuePriority: 1,
      enqueuedAt: t0,
    });
    assert.equal(queue.dequeue().status, 'dequeued');
  }
  assert.equal(queue.recentServiceSampleSize(), window);
  assert.equal(queue.snapshotServiceCounts().get('acct-a'), undefined);
  assert.equal(queue.snapshotServiceCounts().get('acct-b'), window);
});

test('capacity lock keys are supply-scoped with independent system key (F-H-04)', () => {
  assert.equal(
    capacitySupplyAccountLockKey('cred-a'),
    'p1:capacity-leases:supply:cred-a',
  );
  assert.equal(
    capacitySupplyAccountLockKey('cred-b'),
    'p1:capacity-leases:supply:cred-b',
  );
  assert.notEqual(
    capacitySupplyAccountLockKey('cred-a'),
    capacitySupplyAccountLockKey('cred-b'),
  );
  assert.equal(capacitySystemLockKey(), 'p1:capacity-leases:system');
  assert.notEqual(
    capacitySupplyAccountLockKey('cred-a'),
    capacitySystemLockKey(),
  );
  // Former global hotspot must not reappear as the supply key.
  assert.notEqual(
    capacitySupplyAccountLockKey('any'),
    'p1:capacity-leases:global',
  );
  assert.notEqual(capacitySystemLockKey(), 'p1:capacity-leases:global');
});

// ---------------------------------------------------------------------------
// GrantLot FIFO + independent idempotency keys + pool source
// ---------------------------------------------------------------------------

test('GrantLot FIFO expirationDate ASC NULLS LAST and independent grant/consume keys', () => {
  const lots: GrantLot[] = [
    {
      id: 'never',
      workspaceId: 'ws',
      resource: 'image',
      originalAmount: 10,
      remainingAmount: 10,
      expirationDate: null,
      transactionType: 'PURCHASE_PACKAGE',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'soon',
      workspaceId: 'ws',
      resource: 'image',
      originalAmount: 5,
      remainingAmount: 5,
      expirationDate: '2026-07-10T00:00:00.000Z',
      transactionType: 'REGISTER_GIFT',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'later',
      workspaceId: 'ws',
      resource: 'image',
      originalAmount: 5,
      remainingAmount: 5,
      expirationDate: '2026-08-01T00:00:00.000Z',
      transactionType: 'SUBSCRIPTION_RENEWAL',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ];
  assert.deepEqual(
    [...lots].sort(compareGrantLotsForFifo).map((lot) => lot.id),
    ['soon', 'later', 'never']
  );
  assert.deepEqual(
    allocateFifoConsumption(lots, 7).map((item) => item.lotId),
    ['soon', 'later']
  );

  const ledger = new MemoryGrantLotLedger();
  const grantKey = normalizeGrantIdempotencyKey('lot-pool-gift', 'pool-grant-1');
  assert.equal(grantKey, `${GRANT_IDEMPOTENCY_KEY_PREFIX}pool-grant-1`);
  const consumeKey = buildConsumeIdempotencyKey('usage-task-1');
  assert.equal(consumeKey, `${CONSUME_IDEMPOTENCY_KEY_PREFIX}usage-task-1`);
  assertGrantConsumeIdempotencySeparation(grantKey, consumeKey);
  assert.throws(
    () => assertIndependentGrantConsumeIdempotencyKeys(grantKey, grantKey),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE'
  );
  assert.throws(
    () =>
      assertIndependentGrantConsumeIdempotencyKeys(
        grantKey,
        `${GRANT_IDEMPOTENCY_KEY_PREFIX}stolen`
      ),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE'
  );

  const granted = ledger.grant({
    id: 'lot-pool-gift',
    workspaceId: 'ws',
    resource: 'image',
    amount: 8,
    expirationDate: '2026-07-25T00:00:00.000Z',
    transactionType: 'REGISTER_GIFT',
    createdAt: '2026-07-01T00:00:00.000Z',
    supplyPoolId: 'pool-shared-default',
    grantSource: 'pool_allocation',
    grantIdempotencyKey: grantKey,
  });
  assert.equal(granted.supplyPoolId, 'pool-shared-default');
  assert.equal(granted.grantSource, 'pool_allocation');
  assert.equal(granted.grantIdempotencyKey, grantKey);

  // Grant idempotent on independent key.
  const replayGrant = ledger.grant({
    id: 'lot-pool-gift',
    workspaceId: 'ws',
    resource: 'image',
    amount: 8,
    expirationDate: '2026-07-25T00:00:00.000Z',
    transactionType: 'REGISTER_GIFT',
    createdAt: '2026-07-01T00:00:00.000Z',
    supplyPoolId: 'pool-shared-default',
    grantSource: 'pool_allocation',
    grantIdempotencyKey: grantKey,
  });
  assert.equal(replayGrant.id, granted.id);
  assert.equal(ledger.listLots('ws').length, 1);

  const usage = ledger.consume({
    workspaceId: 'ws',
    resource: 'image',
    amount: 3,
    transactionId: consumeKey,
    actorId: 'owner',
    correlationId: 'corr-usage',
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.operationId, consumeKey);
  assert.notEqual(usage[0]?.operationId, grantKey);

  // Consume idempotent on independent key.
  const replayUsage = ledger.consume({
    workspaceId: 'ws',
    resource: 'image',
    amount: 3,
    transactionId: consumeKey,
    actorId: 'owner',
    correlationId: 'corr-usage-replay',
    createdAt: '2026-07-05T00:01:00.000Z',
  });
  assert.deepEqual(replayUsage, usage);
  assert.equal(
    ledger.listLots('ws', 'image')[0]?.remainingAmount,
    5
  );

  // Reject consume key that steals the grant namespace.
  assert.throws(
    () =>
      ledger.consume({
        workspaceId: 'ws',
        resource: 'image',
        amount: 1,
        transactionId: grantKey,
        actorId: 'owner',
        correlationId: 'corr-bad',
        createdAt: '2026-07-05T00:02:00.000Z',
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE'
  );
});

// ---------------------------------------------------------------------------
// Supply-side ledger freeze fields + ProductUsage #92 consume + ProviderCost
// ---------------------------------------------------------------------------

test('supply request freezes RouteSnapshot/CredentialAccountVersion/price evidence fields', async () => {
  const freeze = buildSupplyRequestFreeze({
    id: 'freeze-1',
    workspaceId: 'ws-a',
    routeSnapshotRef: 'route-snap-canonical-1',
    credentialAccountVersion: 'cred-shared-1:v3',
    supplierRequestTaskId: 'supplier-task-abc',
    usage: { resource: 'image', quantity: 1, unit: 'request' },
    supplierPriceRevision: priceRevision(),
    supplyPoolId: 'pool-shared-default',
    providerCostAttemptId: 'attempt-1',
    frozenAt: '2026-07-20T12:00:00.000Z',
  });
  assert.equal(freeze.routeSnapshotRef, 'route-snap-canonical-1');
  assert.equal(freeze.credentialAccountVersion, 'cred-shared-1:v3');
  assert.equal(freeze.supplierRequestTaskId, 'supplier-task-abc');
  assert.equal(freeze.supplierPriceRevision.evidence.source, 'observed_usage');
  // Must not be named QuotePolicy.
  assert.equal('quotePolicy' in freeze, false);
  assert.equal('quotePolicyRevision' in freeze.supplierPriceRevision, false);

  const costEvent = buildProviderCostEventFromFreeze({
    freeze,
    attemptId: 'attempt-1',
    stage: 'observed',
    amountMicros: 1200,
    actorId: 'system',
    correlationId: 'corr-cost',
    createdAt: '2026-07-20T12:00:01.000Z',
  });
  assert.equal(costEvent.attemptId, 'attempt-1');
  assert.equal(costEvent.workspaceId, 'ws-a');
  assert.match(costEvent.evidence, /supplierPriceRevision=spr-1/);
  assert.match(costEvent.evidence, /routeSnapshotRef=route-snap-canonical-1/);
  assert.match(costEvent.evidence, /credentialAccountVersion=cred-shared-1:v3/);
  assert.match(costEvent.evidence, /supplierRequestTaskId=supplier-task-abc/);

  // ProductUsage #92 only — bridge attaches freeze after reserve.
  const productUsage = new MemoryProductUsageLedger();
  productUsage.reserve({
    id: 'pu-1',
    taskId: 'task-1',
    workspaceId: 'ws-a',
    quoteId: 'quote-1',
    quantity: 1,
    billingMode: 'per_request',
    resource: 'image',
    createdAt: '2026-07-20T12:00:00.000Z',
  });
  const bridge = new SupplySideProductUsageBridge({
    getUsage(taskId, workspaceId) {
      const usage = productUsage.getByTask(taskId);
      return usage?.workspaceId === workspaceId ? usage : null;
    },
  });
  const linked = await bridge.attachFreeze('task-1', freeze);
  assert.equal(linked.productUsageTaskId, 'task-1');
  assert.equal((await bridge.getProductUsage('task-1', 'ws-a'))?.quoteId, 'quote-1');
});

// ---------------------------------------------------------------------------
// Supplier variance not allocated to user projection
// ---------------------------------------------------------------------------

test('supplier-level variance is not allocated to user projection', () => {
  const varianceLedger = new SupplierVarianceLedger();
  const variance = varianceLedger.record({
    id: 'var-1',
    supplyAccountId: 'cred-shared-1',
    credentialAccountId: 'cred-shared-1',
    amountMicros: 50_000,
    currency: 'CNY',
    reason: 'Upstream balance delta not attributable to workspace requests',
    observedAt: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(variance.allocation, 'supplier_unallocated');
  assert.equal(varianceLedger.totalMicros('cred-shared-1'), 50_000);

  const productUsage = new MemoryProductUsageLedger();
  const reserved = productUsage.reserve({
    id: 'pu-var',
    taskId: 'task-var',
    workspaceId: 'ws-user',
    quoteId: 'quote-var',
    quantity: 1,
    billingMode: 'per_request',
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  productUsage.settle({
    taskId: 'task-var',
    settledQuantity: 1,
    settlementStatus: 'reconciled',
    updatedAt: '2026-07-20T00:01:00.000Z',
  });
  const settled = productUsage.getByTask('task-var');
  assert.ok(settled);

  const projection = projectUserFacingCost({
    workspaceId: 'ws-user',
    productUsage: settled,
    chargedAmount: 1200,
    currency: 'CNY',
    supplierVariance: varianceLedger.listForSupplyAccount('cred-shared-1'),
  });

  assert.equal(projection.supplierVarianceAllocated, false);
  assert.equal(projection.chargedAmount, 1200);
  assert.equal(projection.productUsage?.taskId, 'task-var');
  // Projection body must not carry variance amount or supply-account keys.
  assert.equal(
    JSON.stringify(projection).includes('50000'),
    false
  );
  assert.equal(
    JSON.stringify(projection).includes('cred-shared-1'),
    false
  );
  assert.equal(
    JSON.stringify(projection).includes('supplier_unallocated'),
    false
  );
  // Reserved product usage identity is present without variance bleed.
  assert.equal(reserved.workspaceId, 'ws-user');
});

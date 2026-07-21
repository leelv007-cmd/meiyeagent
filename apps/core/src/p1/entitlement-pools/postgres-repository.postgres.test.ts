import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DedicatedSupplyPool, SupplyPool } from '@meiye/contracts';
import { Pool } from 'pg';
import { P1ApplicationService } from '../foundation/application-service.js';
import { P1DomainError } from '../foundation/domain.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { FoundationModelSupplyLedger } from '../model-supply/foundation-ledger.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
} from '../model-supply/index.js';
import { DurableProductBillingService } from '../product-billing/durable-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import type {
  AccountAllocation,
  EntitlementPolicyBody,
  EntitlementPolicyRevision,
} from './contracts.js';
import {
  PostgresAccountAllocationStore,
  PostgresCapacityLeaseStore,
  PostgresEntitlementPoolsMigration,
  PostgresEntitlementPolicyStore,
  PostgresSupplyAccountFairQueue,
  PostgresSupplyFreezeStore,
  PostgresSupplyPoolStore,
} from './postgres-repository.js';
import { buildSupplyRequestFreeze } from './supply-ledger-fields.js';
import { PostgresModelSupplyProviderAdmission } from './model-supply-admission.js';

const connectionString = process.env.TEST_DATABASE_URL;

function growthBody(
  overrides: Partial<EntitlementPolicyBody> = {},
): EntitlementPolicyBody {
  return {
    tier: 'growth',
    allowance: { copy: 100, image: 20, video: 5, audio: 10 },
    concurrencyLimit: 3,
    queuePriority: 5,
    supportLabel: 'priority',
    rateLabel: 'elevated',
    allowedCatalogModelIds: ['catalog-copy-a'],
    allowedQualityTiers: ['quality', 'balanced'],
    availableSupplyPoolIds: ['pool-shared'],
    overage: { mode: 'block' },
    validity: { validFrom: null, validUntil: null },
    ...overrides,
  };
}

function policyRevision(
  revision: number,
  overrides: Partial<EntitlementPolicyRevision> = {},
): EntitlementPolicyRevision {
  return {
    id: `entitlement-policy:growth:r${revision}`,
    tier: 'growth',
    body: growthBody({ concurrencyLimit: revision + 2 }),
    revision,
    stage: 'published',
    actorId: 'admin-1',
    reason: `Publish revision ${revision}`,
    correlationId: `corr-policy-${revision}`,
    createdAt: `2026-07-20T00:00:0${revision}.000Z`,
    rolledBackToRevision: null,
    ...overrides,
  };
}

test(
  'PostgreSQL entitlement/pool repositories preserve durable control-plane contracts',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const schema = `p1_entitlement_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminPool.end();
    });

    const migrationClient = await pool.connect();
    try {
      await new PostgresEntitlementPoolsMigration().migrate(migrationClient);
    } finally {
      migrationClient.release();
    }

    await t.test('policy head is process-shared and protected by CAS', async () => {
      const writer = new PostgresEntitlementPolicyStore(pool);
      const reader = new PostgresEntitlementPolicyStore(pool);
      const first = policyRevision(1);
      assert.deepEqual(await writer.publish(first, null), first);
      assert.deepEqual(await reader.getPublished('growth'), first);
      assert.deepEqual(await writer.publish(first, null), first);

      const second = policyRevision(2);
      await assert.rejects(
        writer.publish(second, null),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
      assert.deepEqual(await writer.publish(second, 1), second);
      assert.deepEqual(
        (await reader.history('growth')).map(({ revision, stage }) => ({
          revision,
          stage,
        })),
        [
          { revision: 1, stage: 'superseded' },
          { revision: 2, stage: 'published' },
        ],
      );

      const competing = await Promise.allSettled([
        writer.publish(policyRevision(3), 2),
        reader.publish(policyRevision(4), 2),
      ]);
      assert.equal(
        competing.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      const rejected = competing.find(({ status }) => status === 'rejected');
      assert.ok(rejected && rejected.status === 'rejected');
      assert.ok(
        rejected.reason instanceof P1DomainError &&
          rejected.reason.code === 'IDEMPOTENCY_CONFLICT',
      );
      assert.ok([3, 4].includes((await reader.getPublished('growth'))?.revision ?? 0));
      assert.equal((await reader.history('growth')).length, 3);
      assert.deepEqual(
        (await reader.listAll()).map(({ tier, revision, stage }) => ({
          tier,
          revision,
          stage,
        })),
        (await reader.history('growth')).map(({ tier, revision, stage }) => ({
          tier,
          revision,
          stage,
        })),
      );
    });

    await t.test('allocations are append-only with expiry and rollback overlay', async () => {
      const store = new PostgresAccountAllocationStore(pool);
      const active: AccountAllocation = {
        id: 'allocation:active',
        accountId: 'account-a',
        workspaceId: 'workspace-a',
        kind: 'grant',
        target: { type: 'concurrency' },
        delta: { mode: 'delta', amount: 1 },
        source: 'support_compensation',
        reason: 'Restore one slot',
        actorId: 'admin-1',
        startsAt: '2026-07-20T00:00:00.000Z',
        endsAt: null,
        status: 'active',
        rolledBackAt: null,
        correlationId: 'corr-allocation-active',
        createdAt: '2026-07-20T00:00:00.000Z',
      };
      const expired: AccountAllocation = {
        ...active,
        id: 'allocation:expired',
        endsAt: '2026-07-20T00:10:00.000Z',
        correlationId: 'corr-allocation-expired',
      };
      assert.deepEqual(await store.append(active), active);
      assert.deepEqual(await store.append(active), active);
      await assert.rejects(
        store.append({ ...active, id: 'allocation:invalid-account', accountId: '' }),
        (error: unknown) =>
          error instanceof P1DomainError && error.code === 'INVALID_STATE',
      );
      await assert.rejects(
        store.append({
          ...active,
          id: 'allocation:invalid-delta',
          delta: { mode: 'delta', amount: -1 },
        }),
        (error: unknown) =>
          error instanceof P1DomainError && error.code === 'INVALID_STATE',
      );
      await store.append(expired);
      await store.append({
        ...active,
        id: 'allocation:foreign-workspace',
        accountId: 'account-b',
        workspaceId: 'workspace-b',
        correlationId: 'corr-allocation-foreign-workspace',
      });
      assert.deepEqual(
        (await store.listActive({
          accountId: 'account-a',
          workspaceId: 'workspace-a',
          now: new Date('2026-07-20T00:20:00.000Z'),
        })).map(({ id }) => id),
        ['allocation:active'],
      );

      await store.rollback({
        allocationId: active.id,
        actorId: 'admin-2',
        reason: 'Compensation window closed',
        correlationId: 'corr-allocation-rollback',
        rolledBackAt: '2026-07-20T00:21:00.000Z',
      });
      assert.equal(
        (await store.rollback({
          allocationId: active.id,
          actorId: 'admin-2',
          reason: 'Compensation window closed',
          correlationId: 'corr-allocation-rollback',
          rolledBackAt: '2026-07-20T08:21:00.000+08:00',
        })).rolledBackAt,
        '2026-07-20T00:21:00.000Z',
      );
      assert.deepEqual(
        await store.listActive({
          accountId: 'account-a',
          workspaceId: 'workspace-a',
          now: new Date('2026-07-20T00:22:00.000Z'),
        }),
        [],
      );
      assert.deepEqual(
        (await store.listAll('account-a', new Date('2026-07-20T00:22:00.000Z')))
          .map(({ id, status }) => ({ id, status })),
        [
          { id: 'allocation:active', status: 'rolled_back' },
          { id: 'allocation:expired', status: 'expired' },
        ],
      );
      assert.deepEqual(
        (
          await store.listForWorkspace(
            'workspace-a',
            new Date('2026-07-20T00:22:00.000Z'),
          )
        ).map(({ id, status }) => ({ id, status })),
        [
          { id: 'allocation:active', status: 'rolled_back' },
          { id: 'allocation:expired', status: 'expired' },
        ],
      );
    });

    await t.test('shared and dedicated pools retain revision heads with CAS', async () => {
      const store = new PostgresSupplyPoolStore(pool);
      const shared: SupplyPool = {
        id: 'pool-shared',
        kind: 'shared',
        displayName: 'Shared',
        credentialAccountIds: ['credential-shared'],
        deploymentIds: ['deployment-shared'],
        revisionId: 'pool-shared:r1',
      };
      const dedicated: DedicatedSupplyPool = {
        id: 'pool-dedicated',
        kind: 'dedicated',
        displayName: 'Dedicated',
        credentialAccountIds: ['credential-dedicated'],
        deploymentIds: ['deployment-dedicated'],
        revisionId: 'pool-dedicated:r1',
        contractRef: 'contract:enterprise',
        authorizedWorkspaceIds: ['workspace-a'],
        exclusiveBilling: true,
      };
      await store.save(shared, null);
      await store.save(dedicated, null);
      assert.deepEqual(await store.list(), [dedicated, shared]);

      const sharedV2 = { ...shared, revisionId: 'pool-shared:r2' };
      await assert.rejects(
        store.save(sharedV2, null),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
      assert.deepEqual(await store.save(sharedV2, shared.revisionId), sharedV2);
      assert.deepEqual(await store.get(shared.id), sharedV2);
      assert.deepEqual(await store.history(shared.id), [shared, sharedV2]);
    });

    await t.test('capacity leases enforce product, supply, and system ceilings', async () => {
      const firstProcess = new PostgresCapacityLeaseStore(pool);
      const secondProcess = new PostgresCapacityLeaseStore(pool);
      const limits = {
        supplyAccount: { concurrency: 2 },
        productAccount: { concurrency: 1 },
        systemTotal: { concurrency: 3 },
      };
      const now = '2026-07-20T01:00:00.000Z';
      const expiresAt = '2026-07-20T01:05:00.000Z';
      assert.equal(
        (await firstProcess.tryAcquire({
          leaseId: 'lease-a',
          supplyAccountId: 'supply-shared',
          productAccountId: 'account-a',
          workspaceId: 'workspace-a',
          limits,
          acquiredAt: now,
          expiresAt,
          now,
        })).status,
        'admitted',
      );
      assert.equal(
        (await secondProcess.tryAcquire({
          leaseId: 'lease-a',
          supplyAccountId: 'supply-shared',
          productAccountId: 'account-a',
          workspaceId: 'workspace-a',
          limits,
          acquiredAt: '2026-07-20T09:00:00.000+08:00',
          expiresAt: '2026-07-20T09:05:00.000+08:00',
          now: '2026-07-20T09:00:00.000+08:00',
        })).status,
        'admitted',
      );
      const productRejected = await secondProcess.tryAcquire({
        leaseId: 'lease-a-2',
        supplyAccountId: 'supply-shared',
        productAccountId: 'account-a',
        workspaceId: 'workspace-a',
        limits,
        acquiredAt: now,
        expiresAt,
        now,
      });
      assert.equal(productRejected.status, 'rejected');
      if (productRejected.status === 'rejected') {
        assert.equal(productRejected.layer, 'product_account');
      }
      assert.equal(
        (await secondProcess.tryAcquire({
          leaseId: 'lease-b',
          supplyAccountId: 'supply-shared',
          productAccountId: 'account-b',
          workspaceId: 'workspace-b',
          limits,
          acquiredAt: now,
          expiresAt,
          now,
        })).status,
        'admitted',
      );
      const supplyRejected = await firstProcess.tryAcquire({
        leaseId: 'lease-c',
        supplyAccountId: 'supply-shared',
        productAccountId: 'account-c',
        workspaceId: 'workspace-c',
        limits,
        acquiredAt: now,
        expiresAt,
        now,
      });
      assert.equal(supplyRejected.status, 'rejected');
      if (supplyRejected.status === 'rejected') {
        assert.equal(supplyRejected.layer, 'supply_account');
      }

      const systemLimits = {
        supplyAccount: { concurrency: 10 },
        productAccount: { concurrency: 10 },
        systemTotal: { concurrency: 2 },
      };
      const later = '2026-07-20T02:00:00.000Z';
      const laterExpiry = '2026-07-20T02:05:00.000Z';
      for (const id of ['system-a', 'system-b']) {
        assert.equal(
          (await firstProcess.tryAcquire({
            leaseId: id,
            supplyAccountId: `supply-${id}`,
            productAccountId: `account-${id}`,
            workspaceId: `workspace-${id}`,
            limits: systemLimits,
            acquiredAt: later,
            expiresAt: laterExpiry,
            now: later,
          })).status,
          'admitted',
        );
      }
      const systemRejected = await secondProcess.tryAcquire({
        leaseId: 'system-c',
        supplyAccountId: 'supply-system-c',
        productAccountId: 'account-system-c',
        workspaceId: 'workspace-system-c',
        limits: systemLimits,
        acquiredAt: later,
        expiresAt: laterExpiry,
        now: later,
      });
      assert.equal(systemRejected.status, 'rejected');
      if (systemRejected.status === 'rejected') {
        assert.equal(systemRejected.layer, 'system_total');
      }
      assert.equal(await firstProcess.release('system-a', later), true);
      assert.equal(await firstProcess.release('system-a', later), false);
      await assert.rejects(
        firstProcess.tryAcquire({
          leaseId: 'system-a',
          supplyAccountId: 'supply-system-a',
          productAccountId: 'account-system-a',
          workspaceId: 'workspace-system-a',
          limits: systemLimits,
          acquiredAt: later,
          expiresAt: laterExpiry,
          now: later,
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      const concurrentAt = '2026-07-20T03:00:00.000Z';
      const concurrentExpiry = '2026-07-20T03:05:00.000Z';
      const concurrentLimits = {
        supplyAccount: { concurrency: 1 },
        productAccount: { concurrency: 5 },
        systemTotal: { concurrency: 5 },
      };
      const concurrent = await Promise.all([
        firstProcess.tryAcquire({
          leaseId: 'concurrent-a',
          supplyAccountId: 'supply-concurrent',
          productAccountId: 'account-concurrent-a',
          workspaceId: 'workspace-concurrent-a',
          limits: concurrentLimits,
          acquiredAt: concurrentAt,
          expiresAt: concurrentExpiry,
          now: concurrentAt,
        }),
        secondProcess.tryAcquire({
          leaseId: 'concurrent-b',
          supplyAccountId: 'supply-concurrent',
          productAccountId: 'account-concurrent-b',
          workspaceId: 'workspace-concurrent-b',
          limits: concurrentLimits,
          acquiredAt: concurrentAt,
          expiresAt: concurrentExpiry,
          now: concurrentAt,
        }),
      ]);
      assert.equal(
        concurrent.filter(({ status }) => status === 'admitted').length,
        1,
      );
      assert.equal(
        concurrent.filter(
          (decision) =>
            decision.status === 'rejected' &&
            decision.layer === 'supply_account',
        ).length,
        1,
      );

      await assert.rejects(
        firstProcess.tryAcquire({
          leaseId: 'already-expired',
          supplyAccountId: 'supply-expired',
          productAccountId: 'account-expired',
          workspaceId: 'workspace-expired',
          limits: concurrentLimits,
          acquiredAt: concurrentAt,
          expiresAt: concurrentAt,
          now: concurrentAt,
        }),
        (error: unknown) =>
          error instanceof P1DomainError && error.code === 'INVALID_STATE',
      );

      const fairNow = new Date();
      const fairExpiry = new Date(
        fairNow.getTime() + 60_000,
      ).toISOString();
      const fairBase = {
        supplyAccountId: 'supply-fair-runtime',
        limits: concurrentLimits,
        acquiredAt: fairNow.toISOString(),
        expiresAt: fairExpiry,
        maxWaitMs: 2_000,
        pollIntervalMs: 10,
      };
      const holder = await firstProcess.tryAcquire({
        ...fairBase,
        leaseId: 'fair-holder',
        productAccountId: 'account-holder',
        workspaceId: 'workspace-holder',
      });
      assert.equal(holder.status, 'admitted');
      const firstWaiting = firstProcess.tryAcquireFair({
        ...fairBase,
        leaseId: 'fair-account-a',
        queueRequestId: 'fair-request-a',
        queuePriority: 5,
        productAccountId: 'account-a',
        workspaceId: 'workspace-a',
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const secondWaiting = secondProcess.tryAcquireFair({
        ...fairBase,
        leaseId: 'fair-account-b',
        queueRequestId: 'fair-request-b',
        queuePriority: 5,
        productAccountId: 'account-b',
        workspaceId: 'workspace-b',
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      assert.equal(await firstProcess.release('fair-holder'), true);
      const firstAdmitted = await firstWaiting;
      assert.equal(firstAdmitted.status, 'admitted');
      assert.equal(
        await firstProcess.renew(
          'fair-account-a',
          new Date(fairNow.getTime() + 120_000).toISOString(),
        ),
        true,
      );
      assert.equal(await firstProcess.release('fair-account-a'), true);
      const secondAdmitted = await secondWaiting;
      assert.equal(secondAdmitted.status, 'admitted');
      assert.equal(await secondProcess.release('fair-account-b'), true);

      const weightedSupplyAccountId = 'supply-weighted-runtime';
      const weightedQueues = [
        new PostgresSupplyAccountFairQueue(pool),
        new PostgresSupplyAccountFairQueue(pool),
      ];
      const weightedRequests = [
        {
          requestId: 'weighted-low',
          productAccountId: 'weighted-account-low',
          workspaceId: 'weighted-workspace-low',
          queuePriority: 0,
        },
        ...Array.from({ length: 24 }, (_, index) => ({
          requestId: `weighted-high-${index}`,
          productAccountId: 'weighted-account-high',
          workspaceId: 'weighted-workspace-high',
          queuePriority: 10,
        })),
      ];
      for (const request of weightedRequests) {
        await weightedQueues[0]!.enqueue({
          supplyAccountId: weightedSupplyAccountId,
          ...request,
          enqueuedAt: fairNow.toISOString(),
        });
      }
      const weightedOrder: string[] = [];
      for (let turn = 0; turn < 12; turn += 1) {
        const claims = await Promise.all(
          weightedRequests
            .filter(({ requestId }) => !weightedOrder.includes(requestId))
            .map(async (request, index) => ({
              request,
              claimed: await weightedQueues[index % 2]!.claimTurn(
                weightedSupplyAccountId,
                request.requestId,
              ),
            })),
        );
        const winner = claims.find(({ claimed }) => claimed)?.request;
        assert.ok(winner, `expected a PostgreSQL fair-queue winner at turn ${turn}`);
        weightedOrder.push(winner.requestId);
        await weightedQueues[turn % 2]!.complete(
          weightedSupplyAccountId,
          winner.requestId,
          winner.productAccountId,
          new Date().toISOString(),
        );
      }
      assert.ok(
        weightedOrder.includes('weighted-low'),
        `low priority was starved by PostgreSQL queue: ${weightedOrder.join(',')}`,
      );

      const expiredStart = new Date(Date.now() - 2_000);
      const expiredAt = new Date(Date.now() - 1_000);
      const resumedUntil = new Date(Date.now() + 60_000);
      const expiredBase = {
        leaseId: 'expired-lifecycle-lease',
        queueRequestId: 'expired-lifecycle-request',
        supplyAccountId: 'supply-expired-lifecycle',
        productAccountId: 'account-expired-lifecycle',
        workspaceId: 'workspace-expired-lifecycle',
        limits: concurrentLimits,
        queuePriority: 5,
        maxWaitMs: 2_000,
        pollIntervalMs: 10,
      };
      assert.equal(
        (await firstProcess.tryAcquireFair({
          ...expiredBase,
          acquiredAt: expiredStart.toISOString(),
          expiresAt: expiredAt.toISOString(),
          now: expiredStart.toISOString(),
        })).status,
        'admitted',
      );
      const renewNow = new Date();
      assert.equal(
        await firstProcess.renew(
          expiredBase.leaseId,
          resumedUntil.toISOString(),
          renewNow.toISOString(),
        ),
        false,
      );
      assert.equal(
        (await secondProcess.tryAcquire({
          leaseId: 'expired-lifecycle-blocker',
          supplyAccountId: expiredBase.supplyAccountId,
          productAccountId: 'account-expired-blocker',
          workspaceId: 'workspace-expired-blocker',
          limits: concurrentLimits,
          acquiredAt: renewNow.toISOString(),
          expiresAt: resumedUntil.toISOString(),
          now: renewNow.toISOString(),
        })).status,
        'admitted',
      );
      const resumed = firstProcess.tryAcquireFair({
        ...expiredBase,
        acquiredAt: expiredStart.toISOString(),
        expiresAt: resumedUntil.toISOString(),
        now: renewNow.toISOString(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const activeWhileBlocked = await pool.query<{ active: string }>(
        `SELECT count(*)::text AS active
           FROM p1_capacity_leases
          WHERE supply_account_id = $1
            AND released_at IS NULL
            AND expires_at > $2`,
        [expiredBase.supplyAccountId, renewNow.toISOString()],
      );
      assert.equal(Number(activeWhileBlocked.rows[0]?.active ?? 0), 1);
      assert.equal(
        await secondProcess.release(
          'expired-lifecycle-blocker',
          new Date().toISOString(),
        ),
        true,
      );
      assert.equal((await resumed).status, 'admitted');
    });

    await t.test(
      'service_turns retain only a sliding window after complete (F-H-05)',
      async () => {
        const { FAIR_QUEUE_SERVICE_TURN_WINDOW } = await import(
          './fair-queue.js'
        );
        const queue = new PostgresSupplyAccountFairQueue(pool);
        const supplyAccountId = 'supply-service-window';
        // Insert more turns than the window via the same complete path (enqueue→claim→complete).
        const total = FAIR_QUEUE_SERVICE_TURN_WINDOW + 12;
        for (let i = 0; i < total; i += 1) {
          const requestId = `window-req-${i}`;
          await queue.enqueue({
            supplyAccountId,
            requestId,
            productAccountId: i % 2 === 0 ? 'acct-even' : 'acct-odd',
            workspaceId: 'ws-window',
            queuePriority: 1,
            enqueuedAt: new Date().toISOString(),
          });
          assert.equal(
            await queue.claimTurn(supplyAccountId, requestId),
            true,
            `expected claimTurn for ${requestId}`,
          );
          await queue.complete(
            supplyAccountId,
            requestId,
            i % 2 === 0 ? 'acct-even' : 'acct-odd',
            new Date().toISOString(),
          );
        }
        const retained = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n
             FROM p1_supply_capacity_service_turns
            WHERE supply_account_id = $1`,
          [supplyAccountId],
        );
        assert.equal(
          Number(retained.rows[0]?.n ?? 0),
          FAIR_QUEUE_SERVICE_TURN_WINDOW,
          'service_turns must purge down to the sliding window',
        );
      },
    );

    await t.test(
      'distinct supply accounts admit in parallel under per-account locks (F-H-04)',
      async () => {
        const first = new PostgresCapacityLeaseStore(pool);
        const second = new PostgresCapacityLeaseStore(pool);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 60_000).toISOString();
        const acquiredAt = now.toISOString();
        const limits = {
          supplyAccount: { concurrency: 1 },
          productAccount: { concurrency: 4 },
          systemTotal: { concurrency: 8 },
        };
        // Two different supply accounts must both admit without a global lock serializing them.
        const [a, b] = await Promise.all([
          first.tryAcquire({
            leaseId: 'fh04-supply-a',
            supplyAccountId: 'supply-fh04-a',
            productAccountId: 'acct-fh04-a',
            workspaceId: 'ws-fh04-a',
            limits,
            acquiredAt,
            expiresAt,
            now: acquiredAt,
          }),
          second.tryAcquire({
            leaseId: 'fh04-supply-b',
            supplyAccountId: 'supply-fh04-b',
            productAccountId: 'acct-fh04-b',
            workspaceId: 'ws-fh04-b',
            limits,
            acquiredAt,
            expiresAt,
            now: acquiredAt,
          }),
        ]);
        assert.equal(a.status, 'admitted');
        assert.equal(b.status, 'admitted');

        // System-total independent counter still enforces the global ceiling.
        const systemTight = {
          supplyAccount: { concurrency: 4 },
          productAccount: { concurrency: 4 },
          systemTotal: { concurrency: 2 },
        };
        const overflow = await first.tryAcquire({
          leaseId: 'fh04-system-overflow',
          supplyAccountId: 'supply-fh04-c',
          productAccountId: 'acct-fh04-c',
          workspaceId: 'ws-fh04-c',
          limits: systemTight,
          acquiredAt,
          expiresAt,
          now: acquiredAt,
        });
        assert.equal(overflow.status, 'rejected');
        if (overflow.status === 'rejected') {
          assert.equal(overflow.layer, 'system_total');
        }
      },
    );

    await t.test('supply freezes are immutable and only reference the three ledgers', async () => {
      const store = new PostgresSupplyFreezeStore(pool);
      const freeze = buildSupplyRequestFreeze({
        id: 'freeze-1',
        workspaceId: 'workspace-a',
        routeSnapshotRef: 'route-snapshot-1',
        credentialAccountVersion: 'credential-a:v3',
        supplierRequestTaskId: 'supplier-task-1',
        usage: { resource: 'image', quantity: 1, unit: 'request' },
        supplierPriceRevision: {
          id: 'supplier-price-1',
          deploymentId: 'deployment-image-a',
          amountMicros: 1200,
          currency: 'CNY',
          unit: 'request',
          evidence: { source: 'observed_usage' },
          revisionId: 'supplier-price-1:r1',
        },
        supplyPoolId: 'pool-shared',
        productUsageTaskId: 'product-usage-task-1',
        providerCostAttemptId: 'provider-attempt-1',
        frozenAt: '2026-07-20T03:00:00.000Z',
      });
      assert.deepEqual(await store.append(freeze), freeze);
      assert.deepEqual(await store.append(freeze), freeze);
      assert.deepEqual(
        await store.append({
          ...freeze,
          frozenAt: '2026-07-20T03:01:00.000Z',
        }),
        freeze,
      );
      assert.deepEqual(await store.get(freeze.id), freeze);
      assert.deepEqual(
        await store.getByProductUsageTask('workspace-a', 'product-usage-task-1'),
        freeze,
      );
      await assert.rejects(
        store.append({ ...freeze, routeSnapshotRef: 'route-snapshot-other' }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
      await assert.rejects(
        store.append({
          ...freeze,
          id: 'freeze-invalid',
          productUsageTaskId: 'product-usage-task-invalid',
          usage: { ...freeze.usage, quantity: -1 },
        }),
        (error: unknown) =>
          error instanceof P1DomainError && error.code === 'INVALID_STATE',
      );
    });

    await t.test('real model attempts share durable entitlement, allocation, lease, and freeze facts', async () => {
      const entitlementPolicies = new PostgresEntitlementPolicyStore(pool);
      const accountAllocations = new PostgresAccountAllocationStore(pool);
      const supplyPools = new PostgresSupplyPoolStore(pool);
      const capacityLeases = new PostgresCapacityLeaseStore(pool);
      const supplyFreezes = new PostgresSupplyFreezeStore(pool);
      const productPolicy = {
        revision: 'product:growth:runtime',
        tier: 'growth' as const,
        allowance: { copy: 10, image: 2, video: 1, audio: 1 },
        concurrencyLimit: 4,
        queuePriority: 5,
        supportLabel: 'priority' as const,
        addOns: [],
        autoTopUp: {
          enabled: false,
          monthlyCapMicros: 0,
          spentThisMonthMicros: 0,
        },
      };
      const current = await entitlementPolicies.getPublished('growth');
      assert.ok(current);
      await accountAllocations.append({
        id: 'allocation:runtime-cap',
        accountId: 'account-runtime',
        workspaceId: 'workspace-runtime',
        kind: 'restrict',
        target: { type: 'concurrency' },
        delta: { mode: 'cap', amount: 1 },
        source: 'account_override',
        reason: 'Runtime concurrency cap',
        actorId: 'admin-runtime',
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: null,
        status: 'active',
        rolledBackAt: null,
        correlationId: 'corr-runtime-cap',
        createdAt: '2026-07-20T00:00:00.000Z',
      });
      const admission = new PostgresModelSupplyProviderAdmission({
        productEntitlements: {
          async resolve() {
            return productPolicy;
          },
        },
        entitlementPolicies,
        accountAllocations,
        supplyPools,
        capacityLeases,
        defaultSupplyPoolId: 'pool-shared',
      });
      const foundationRepository = new MemoryFoundationRepository();
      foundationRepository.grantOwner('workspace-runtime', 'account-runtime');
      const foundation = new P1ApplicationService(foundationRepository);
      const ledger = new FoundationModelSupplyLedger(
        foundation,
        {
          async resolve() {
            return productPolicy;
          },
        },
        undefined,
        {
          defaultSupplyPoolId: 'pool-shared',
          supplyFreezes,
        },
      );
      let providerObservedDurableFacts = false;
      const model = {
        id: 'catalog-copy-a',
        modality: 'llm' as const,
        operations: ['copy.generate' as const],
        displayName: 'Runtime copy',
        qualityRank: 90,
      };
      const deployment = {
        id: 'deployment-shared',
        catalogModelId: model.id,
        apiFamily: 'openai' as const,
        channel: 'direct' as const,
        region: 'domestic' as const,
        status: 'active' as const,
        credentialVersion: 'credential-runtime-v1',
        priceRevision: 'supplier-price-runtime-r1',
        unitPrice: {
          amountMicros: 1_200,
          currency: 'CNY' as const,
          unit: 'request',
        },
      };
      const service = new ModelSupplyApplicationService({
        models: [model],
        deployments: [deployment],
        providerAdmission: admission,
        ledger,
        execution: {
          async execute(request) {
            const [lease, freeze] = await Promise.all([
              pool.query<{ count: string }>(
                `SELECT count(*)::text AS count
                   FROM p1_capacity_leases
                  WHERE workspace_id = $1 AND released_at IS NULL`,
                [request.submission.workspaceId],
              ),
              pool.query<{ payload: { supplyPoolId: string } }>(
                `SELECT payload
                   FROM p1_supply_request_freezes
                  WHERE workspace_id = $1`,
                [request.submission.workspaceId],
              ),
            ]);
            providerObservedDurableFacts =
              lease.rows[0]?.count === '1' &&
              freeze.rows[0]?.payload.supplyPoolId === 'pool-shared';
            return new RecordedProviderExecutionPort().execute(request);
          },
        },
      });
      const submission = {
        workspaceId: 'workspace-runtime',
        actorId: 'account-runtime',
        idempotencyKey: 'runtime-durable-governance',
        operation: 'copy.generate' as const,
        selection: {
          mode: 'fixed' as const,
          catalogModelId: model.id,
        },
        dataClass: [],
        prompt: '持久供应治理链',
      };

      const result = await service.submit(submission);

      assert.equal(result.status, 'completed');
      assert.equal(providerObservedDurableFacts, true);
      assert.equal(result.snapshot.entitlementPolicyRevision, current.id);
      assert.deepEqual(result.snapshot.appliedAllocationIds, [
        'allocation:runtime-cap',
      ]);
      assert.equal(
        (
          await pool.query<{ count: string }>(
            `SELECT count(*)::text AS count
               FROM p1_capacity_leases
              WHERE workspace_id = $1 AND released_at IS NULL`,
            [submission.workspaceId],
          )
        ).rows[0]?.count,
        '0',
      );
      const persistedFreeze = await supplyFreezes.get(
        `supply-freeze:${result.jobId}:${result.attempt.id}`,
      );
      assert.equal(persistedFreeze?.productUsageTaskId, undefined);
      assert.equal(persistedFreeze?.providerCostAttemptId, result.attempt.id);
      assert.equal(persistedFreeze?.supplyPoolId, 'pool-shared');
    });

    await t.test('reserved Postgres ProductUsage links to a freeze readable and replayable by a new ledger', async () => {
      const workspaceId = `workspace-billing-bridge-${randomUUID()}`;
      const actorId = 'account-billing-bridge';
      const billingTaskId = `billing-task-${randomUUID()}`;
      const billingRepository = new PostgresProductBillingRepository(pool);
      await billingRepository.migrate();
      const billing = new DurableProductBillingService(billingRepository);
      const quote = await billing.buildQuote({
        billingMode: 'per_request',
        catalogModelId: 'catalog-billing-image',
        frozenCandidateDeploymentIds: ['deployment-billing-image'],
        quoteId: `quote-${randomUUID()}`,
        quotePolicyRevision: 'product-policy-billing-r1',
        unitRate: 1,
        workspaceId,
      });
      await billing.confirm({
        quoteId: quote.quoteId,
        taskId: billingTaskId,
        workspaceId,
      });
      await billing.beforeSubmit({
        quoteId: quote.quoteId,
        quoteRevision: quote.revision,
        resource: 'image',
        taskId: billingTaskId,
        workspaceId,
      });
      assert.equal(
        (await billing.getUsage(billingTaskId, workspaceId))?.status,
        'reserved',
      );

      const foundationRepository = new MemoryFoundationRepository();
      foundationRepository.grantOwner(workspaceId, actorId);
      const foundation = new P1ApplicationService(foundationRepository);
      await foundation.appendUsageEvent(
        { workspaceId, userId: actorId, correlationId: 'billing-bridge' },
        {
          action: 'adjust',
          amount: 1,
          id: `entitlement-${randomUUID()}`,
          reason: 'billing bridge integration fixture',
          resource: 'image',
        },
        `entitlement-${randomUUID()}`,
      );
      const supplyFreezes = new PostgresSupplyFreezeStore(pool);
      const model = {
        id: 'catalog-billing-image',
        modality: 'image' as const,
        operations: ['image.generate' as const],
        displayName: 'Billing image',
        qualityRank: 90,
      };
      const deployment = {
        id: 'deployment-billing-image',
        catalogModelId: model.id,
        apiFamily: 'image' as const,
        channel: 'managed' as const,
        region: 'domestic' as const,
        status: 'active' as const,
        credentialVersion: 'credential-billing-v1',
        priceRevision: 'supplier-price-billing-r1',
        unitPrice: {
          amountMicros: 1_000,
          currency: 'CNY' as const,
          unit: 'image',
        },
      };
      const ledger = new FoundationModelSupplyLedger(
        foundation,
        undefined,
        undefined,
        {
          billingLifecycle: billing,
          productUsage: billing,
          supplyFreezes,
        },
      );
      const submission = {
        actorId,
        billingQuoteRevision: quote.revision,
        billingTaskId,
        dataClass: [],
        idempotencyKey: `submit-${randomUUID()}`,
        operation: 'image.generate' as const,
        prompt: '真实 PostgreSQL 双侧账本',
        selection: { catalogModelId: model.id, mode: 'fixed' as const },
        workspaceId,
      };
      const result = await new ModelSupplyApplicationService({
        deployments: [deployment],
        execution: new RecordedProviderExecutionPort(),
        ledger,
        models: [model],
      }).submit(submission);

      const restartedBilling = new DurableProductBillingService(
        billingRepository,
      );
      const restartedLedger = new FoundationModelSupplyLedger(
        foundation,
        undefined,
        undefined,
        {
          productUsage: restartedBilling,
          supplyFreezes: new PostgresSupplyFreezeStore(pool),
        },
      );
      const persisted = await restartedLedger.getSupplyFreeze(
        workspaceId,
        billingTaskId,
      );
      assert.equal(persisted?.productUsageTaskId, billingTaskId);
      assert.equal(persisted?.providerCostAttemptId, result.attempt.id);
      assert.deepEqual(
        await restartedLedger.freezeAttempt({
          attemptId: result.attempt.id,
          deployment,
          jobId: result.jobId,
          model,
          ordinal: 1,
          previousAttempts: [],
          previousProviderCosts: [],
          snapshot: result.snapshot,
          submission,
        }),
        persisted,
      );
    });
  },
);

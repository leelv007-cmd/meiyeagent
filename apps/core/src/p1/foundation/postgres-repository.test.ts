import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { P1ApplicationService } from './application-service.js';
import { ProductEntitlementApplicationService } from './entitlement-service.js';
import { REGISTER_GIFT_GRANT_KEY } from './domain.js';
import { PostgresFoundationRepository } from './postgres-repository.js';
import type { PermissionAuthorizerPort } from '../capability-permission/port.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('Postgres foundation adapter preserves the P1ApplicationService contract', {
  skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
}, async (t) => {
  const pool = new Pool({ connectionString });
  const suffix = randomUUID();
  const workspaceId = `p1-workspace-${suffix}`;
  const userId = `p1-owner-${suffix}`;
  const repository = new PostgresFoundationRepository(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "user" (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id text PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    );
  `);
  await repository.migrate();
  await pool.query(
    `INSERT INTO "user" (id, name, email) VALUES ($1, 'P1 owner', $2)`,
    [userId, `${userId}@example.test`]
  );
  await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'P1 test')`, [workspaceId]);
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [workspaceId, userId]
  );
  t.after(async () => {
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
    await pool.end();
  });

  const clock = () => new Date('2026-07-19T00:00:00.000Z');
  const service = new P1ApplicationService(repository, { clock });
  const context = { workspaceId, userId, correlationId: 'corr-postgres' };
  const created = await service.recordRelationFact(context, {
    id: 'store-1', kind: 'store', data: { name: 'Postgres 门店' },
  }, 'store-create');
  const replayed = await service.recordRelationFact(context, {
    id: 'store-1', kind: 'store', data: { name: 'Postgres 门店' },
  }, 'store-create');
  await service.appendUsageEvent(context, {
    id: 'grant-1', resource: 'copy', action: 'adjust', amount: 4, reason: 'opening',
  }, 'grant-1');
  await service.appendUsageEvent(context, {
    id: 'reserve-generation',
    resource: 'copy',
    action: 'reserve',
    amount: 1,
    reservationId: 'reservation-generation',
    reason: 'generation',
  }, 'reserve-generation');
  const generationInput = {
    jobId: 'generation-1',
    operation: 'copy' as const,
    usageReservationId: 'reservation-generation',
    routeSnapshot: {
      id: 'route-generation-1',
      catalogRevision: 'catalog-r1',
      policyRevision: 'policy-r1',
      priceRevision: 'price-r1',
      requestedCatalogModelId: 'copy-model',
      selectionMode: 'fixed' as const,
      dataClass: 'public' as const,
      fallbackConsent: false,
      maxAttempts: 2,
      fallbackAuthorized: true,
      dataPolicyRevisionId: 'data-policy-r1',
      sourceKind: 'official_direct' as const,
      allowedCandidates: [
        {
          catalogModelId: 'copy-model',
          deploymentId: 'copy-deployment',
          region: 'cn' as const,
          credentialMode: 'platform' as const,
          credentialVersion: 'credential-v1',
        },
      ],
    },
  };
  const generation = await service.startGeneration(
    context,
    generationInput,
    'start-generation',
  );
  const replayedGeneration = await service.startGeneration(
    context,
    generationInput,
    'start-generation',
  );

  assert.deepEqual(replayed, created);
  assert.deepEqual(replayedGeneration, generation);
  const persistedRoute = await service.getRouteSnapshot(
    context,
    'route-generation-1'
  );
  assert.equal(persistedRoute.maxAttempts, 2);
  assert.equal(persistedRoute.fallbackAuthorized, true);
  assert.equal(persistedRoute.dataPolicyRevisionId, 'data-policy-r1');
  assert.equal(persistedRoute.sourceKind, 'official_direct');
  assert.equal((await service.getRelationFact(context, 'store-1')).data.name, 'Postgres 门店');
  assert.deepEqual(await service.getUsageProjection(context, 'copy'), {
    allowance: 4, reserved: 1, committed: 0, released: 0, available: 3,
  });

  let releaseExternal = () => {};
  const externalGate = new Promise<void>((resolve) => {
    releaseExternal = resolve;
  });
  let markStarted = () => {};
  const externalStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const fakeExternalModuleAuthorizer: PermissionAuthorizerPort = {
    decide(input) {
      assert.equal(input.action, '');
      assert.ok(
        ['slow-external', 'recoverable-external'].includes(
          String(input.module),
        ),
      );
      return {
        allow: true,
        required: null,
        reason: 'capability_granted',
      };
    },
    authorize(input) {
      this.decide(input);
    },
  };
  const moduleService = new P1ApplicationService(repository, {
    authorizer: fakeExternalModuleAuthorizer,
    operations: [
      {
        name: 'slow-external',
        async execute() {
          markStarted();
          await externalGate;
          return { completed: true };
        },
      },
    ],
  });
  const slowCommand = moduleService.executeModule(
    context,
    'slow-external',
    { request: 'provider-call' },
    'slow-external-command'
  );
  await externalStarted;
  const concurrentFoundationWrite = await Promise.race([
    service.appendUsageEvent(
      context,
      {
        id: 'grant-while-external',
        resource: 'copy',
        action: 'adjust',
        amount: 1,
        reason: 'proves external module is outside the workspace lock',
      },
      'grant-while-external'
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('module operation retained the foundation lock')),
        500
      )
    ),
  ]);
  assert.equal(concurrentFoundationWrite.id, 'grant-while-external');
  releaseExternal();
  assert.deepEqual(await slowCommand, { completed: true });
  assert.deepEqual(
    await moduleService.executeModule(
      context,
      'slow-external',
      { request: 'provider-call' },
      'slow-external-command'
    ),
    { completed: true }
  );

  let recoverAttempts = 0;
  const recoverableModule = new P1ApplicationService(repository, {
    authorizer: fakeExternalModuleAuthorizer,
    operations: [
      {
        name: 'recoverable-external',
        async execute() {
          recoverAttempts += 1;
          if (recoverAttempts === 1) {
            throw new Error('provider outcome unknown');
          }
          return { recovered: true };
        },
      },
    ],
  });
  await assert.rejects(
    recoverableModule.executeModule(
      context,
      'recoverable-external',
      { request: 'same' },
      'recoverable-external-command'
    ),
    /provider outcome unknown/
  );
  await pool.query(
    `UPDATE p1_module_commands
        SET lease_expires_at = now() - interval '1 second'
      WHERE workspace_id = $1 AND idempotency_key = $2`,
    [workspaceId, 'recoverable-external-command']
  );
  assert.deepEqual(
    await recoverableModule.executeModule(
      context,
      'recoverable-external',
      { request: 'same' },
      'recoverable-external-command'
    ),
    { recovered: true }
  );
  assert.equal(recoverAttempts, 2);

  const entitlements = new ProductEntitlementApplicationService(
    repository,
    undefined,
    clock
  );
  await entitlements.activatePlan(
    context,
    {
      paymentEventId: 'postgres-plan-payment',
      policy: {
        revision: 'postgres-pro-v1',
        tier: 'pro',
        periodId: '2026-07',
        periodStartsAt: '2026-07-01T00:00:00.000Z',
        periodEndsAt: '2026-08-01T00:00:00.000Z',
        allowance: { audio: 0, copy: 30, image: 12, video: 6 },
        concurrencyLimit: 6,
        queuePriority: 80,
        supportLabel: 'priority',
      },
    },
    'postgres-activate-plan'
  );
  const addOn = {
    paymentEventId: 'postgres-image-addon-payment',
    purchaseId: 'postgres-image-addon',
    resource: 'image' as const,
    quantity: 8,
    amountMicros: 4_900_000,
    currency: 'CNY',
  };
  await entitlements.recordAddOnPurchase(
    context,
    addOn,
    'postgres-image-addon-command'
  );
  const replayedAddOn = await entitlements.recordAddOnPurchase(
    context,
    addOn,
    'postgres-image-addon-webhook-replay'
  );
  assert.equal(replayedAddOn.usage.image.allowance, 20);
  assert.equal(replayedAddOn.addOnPurchases.length, 1);
  assert.equal(
    (
      await repository.listProductEntitlementEvents(workspaceId)
    ).filter((event) => event.kind === 'add_on_purchased').length,
    1
  );

  const giftEvent = {
    actorId: userId,
    correlationId: 'corr-postgres-gift',
    createdAt: '2026-07-19T08:00:00.000Z',
    grantKey: REGISTER_GIFT_GRANT_KEY,
    id: 'postgres-register-gift-1',
    kind: 'plan_activated' as const,
    paymentEventId: 'postgres-register-gift-payment-1',
    policy: {
      ...growthPolicy(),
      revision: 'postgres-register-gift-trial',
      tier: 'trial' as const,
    },
    workspaceId,
  };
  await repository.appendProductEntitlementEvent(giftEvent);
  await assert.rejects(
    repository.appendProductEntitlementEvent({
      ...giftEvent,
      id: 'postgres-register-gift-2',
      paymentEventId: 'postgres-register-gift-payment-2',
    }),
    /duplicate key|unique constraint/iu,
  );
  const registerGiftIndex = await pool.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'p1_product_entitlement_register_gift_once_idx'`,
  );
  assert.match(registerGiftIndex.rows[0]?.indexdef ?? '', /grant_key/iu);
});

function growthPolicy() {
  return {
    allowance: { audio: 0, copy: 20, image: 5, video: 2 },
    concurrencyLimit: 1,
    periodEndsAt: '2026-07-26T08:00:00.000Z',
    periodId: 'fixed-2026-07-19-7d',
    periodStartsAt: '2026-07-19T08:00:00.000Z',
    periodStrategy: 'fixed_days' as const,
    queuePriority: 1,
    revision: 'postgres-register-gift-base',
    supportLabel: 'standard' as const,
    tier: 'trial' as const,
  };
}

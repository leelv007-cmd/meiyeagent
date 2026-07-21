import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { P1ApplicationService } from '../foundation/application-service.js';
import { REGISTER_GIFT_GRANT_KEY } from '../foundation/domain.js';
import { ProductEntitlementApplicationService } from '../foundation/entitlement-service.js';
import { GrantLotAwareProductEntitlementService } from '../foundation/grant-lot-entitlement-service.js';
import { PostgresGrantLotLedger } from '../foundation/postgres-grant-lot.js';
import { PostgresRedemptionStore } from '../foundation/postgres-redemption.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { RedemptionApplicationService } from '../foundation/redemption.js';
import { FoundationModelSupplyLedger } from './foundation-ledger.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  modelSupplyJobId,
  type CatalogModel,
  type ModelDeployment,
  type ProviderExecutionPort,
} from './index.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres commits the dispatch checkpoint before the provider and settles one authoritative ledger',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `model-ledger-workspace-${suffix}`;
    const redemptionWorkspaceId = `model-ledger-redemption-${suffix}`;
    const packageWorkspaceId = `model-ledger-package-${suffix}`;
    const legacyOnlyWorkspaceId = `model-ledger-legacy-only-${suffix}`;
    const pendingWorkspaceId = `model-ledger-pending-${suffix}`;
    const concurrentMigrationWorkspaceId = `model-ledger-migration-race-${suffix}`;
    const userId = `model-ledger-owner-${suffix}`;
    const redemptionCode = `R${suffix.replaceAll('-', '').slice(0, 12)}`.toUpperCase();
    const redemptionRetryCode = `T${suffix.replaceAll('-', '').slice(0, 12)}`.toUpperCase();
    const repository = new PostgresFoundationRepository(pool);
    const grantLots = new PostgresGrantLotLedger(pool);
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
      CREATE TABLE IF NOT EXISTS p1_usage_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        resource text NOT NULL,
        action text NOT NULL,
        amount integer NOT NULL,
        reservation_id text,
        reason text NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      ALTER TABLE p1_usage_events
        DROP CONSTRAINT IF EXISTS p1_usage_events_amount_check;
      ALTER TABLE p1_usage_events
        ADD CONSTRAINT p1_usage_events_amount_check
        CHECK (amount <> 0) NOT VALID;
    `);
    await repository.migrate();
    await grantLots.migrate();
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, 'Ledger owner', $2)`,
      [userId, `${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Ledger test')`,
      [workspaceId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Redemption ledger test')`,
      [redemptionWorkspaceId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Package ledger test')`,
      [packageWorkspaceId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Legacy-only ledger test')`,
      [legacyOnlyWorkspaceId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Pending migration test')`,
      [pendingWorkspaceId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Migration race test')`,
      [concurrentMigrationWorkspaceId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [redemptionWorkspaceId, userId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [packageWorkspaceId, userId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [legacyOnlyWorkspaceId, userId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [pendingWorkspaceId, userId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [concurrentMigrationWorkspaceId, userId],
    );
    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_redemption_codes WHERE code = ANY($1::text[])',
        [[redemptionCode, redemptionRetryCode]],
      );
      await pool.query(
        'DELETE FROM p1_grant_lot_transactions WHERE workspace_id = ANY($1::text[])',
        [[workspaceId, redemptionWorkspaceId, packageWorkspaceId, legacyOnlyWorkspaceId, pendingWorkspaceId, concurrentMigrationWorkspaceId]],
      );
      await pool.query(
        'DELETE FROM p1_grant_lots WHERE workspace_id = ANY($1::text[])',
        [[workspaceId, redemptionWorkspaceId, packageWorkspaceId, legacyOnlyWorkspaceId, pendingWorkspaceId, concurrentMigrationWorkspaceId]],
      );
      await pool.query('DELETE FROM workspaces WHERE id = ANY($1::text[])', [
        [workspaceId, redemptionWorkspaceId, packageWorkspaceId, legacyOnlyWorkspaceId, pendingWorkspaceId, concurrentMigrationWorkspaceId],
      ]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const model: CatalogModel = {
      id: 'seedream-5-pro',
      modality: 'image',
      operations: ['image.generate'],
      displayName: 'Seedream 5.0 Pro',
      qualityRank: 90,
    };
    const deployment: ModelDeployment = {
      id: 'seedream-5-pro-direct',
      catalogModelId: model.id,
      apiFamily: 'image',
      channel: 'direct',
      region: 'domestic',
      status: 'active',
      policyRevision: 'policy-cn-v1',
      priceRevision: 'price-cn-v2',
      credentialMode: 'platform',
      credentialVersion: 'secret-version-3',
    };
    let executions = 0;
    const execution: ProviderExecutionPort = {
      async execute(request) {
        executions += 1;
        const checkpoint = await pool.query<{
          job_status: string;
          acceptance: string;
          usage_action: string;
        }>(
          `SELECT jobs.status AS job_status, attempts.acceptance,
                  usage.action AS usage_action
             FROM p1_generation_jobs jobs
             JOIN p1_provider_attempts attempts
               ON attempts.workspace_id = jobs.workspace_id
              AND attempts.job_id = jobs.id
             JOIN p1_usage_events usage
               ON usage.workspace_id = jobs.workspace_id
              AND usage.reservation_id = jobs.usage_reservation_id
            WHERE jobs.workspace_id = $1 AND jobs.id = $2
              AND usage.action = 'reserve'`,
          [workspaceId, request.jobId],
        );
        assert.deepEqual(checkpoint.rows[0], {
          job_status: 'running',
          acceptance: 'pending',
          usage_action: 'reserve',
        });
        return new RecordedProviderExecutionPort().execute(request);
      },
    };
    const foundation = new P1ApplicationService(repository);
    const entitlementContext = {
      workspaceId,
      userId,
      correlationId: 'pg-entitlement-sync',
    };
    const entitlements = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => new Date('2026-07-19T00:00:00.000Z'),
    );
    const trialPolicy = {
      revision: 'trial-pg-v1',
      tier: 'trial' as const,
      periodId: '2026-07',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
      periodStrategy: 'fixed_days' as const,
      allowance: { audio: 0, copy: 10, image: 10, video: 5 },
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard' as const,
    };
    await entitlements.activatePlan(
      entitlementContext,
      {
        paymentEventId: 'pg-register-gift',
        policy: trialPolicy,
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'pg-register-gift',
    );
    await entitlements.activatePlan(
      entitlementContext,
      {
        paymentEventId: 'pg-subscription-renewal',
        policy: {
          ...trialPolicy,
          revision: 'pro-pg-v1',
          tier: 'pro',
          periodStrategy: 'provider_period',
          allowance: { audio: 0, copy: 20, image: 20, video: 10 },
          concurrencyLimit: 4,
          queuePriority: 100,
          supportLabel: 'priority',
        },
      },
      'pg-subscription-renewal',
    );
    await entitlements.recordAddOnPurchase(
      entitlementContext,
      {
        paymentEventId: 'pg-package-payment',
        purchaseId: 'pg-image-package',
        resource: 'image',
        quantity: 5,
        amountMicros: 100,
        currency: 'CNY',
      },
      'pg-package-payment',
    );
    const ledger = new FoundationModelSupplyLedger(
      foundation,
      entitlements,
      grantLots,
    );
    const application = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution,
      ledger,
    });
    const submission = {
      workspaceId,
      actorId: userId,
      idempotencyKey: 'postgres-model-ledger-1',
      operation: 'image.generate' as const,
      selection: { mode: 'fixed' as const, catalogModelId: model.id },
      dataClass: [],
      prompt: 'Postgres checkpoint',
    };

    const completed = await application.submit(submission);
    const restarted = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution,
      ledger,
    });
    const replayed = await restarted.submit(submission);
    const zeroUsage = await restarted.submit({
      ...submission,
      idempotencyKey: 'postgres-model-ledger-zero-usage',
      productUsageQuantity: 0,
      prompt: 'Postgres zero usage checkpoint',
    });
    const copyModel: CatalogModel = {
      id: 'copy-linked-refund',
      modality: 'llm',
      operations: ['copy.generate'],
      displayName: 'Copy linked refund',
      qualityRank: 100,
    };
    const copyDeployment: ModelDeployment = {
      id: 'copy-linked-refund-direct',
      catalogModelId: copyModel.id,
      apiFamily: 'openai',
      channel: 'direct',
      region: 'domestic',
      status: 'active',
    };
    const failingExecution = new RecordedProviderExecutionPort();
    failingExecution.failNext(copyModel.id, 'acceptance_unknown');
    const failed = await new ModelSupplyApplicationService({
      models: [copyModel],
      deployments: [copyDeployment],
      execution: failingExecution,
      ledger,
    }).submit({
      ...submission,
      idempotencyKey: 'postgres-model-ledger-failure',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: copyModel.id },
      prompt: 'Postgres linked refund',
    });

    assert.equal(replayed.asset?.sha256, completed.asset?.sha256);
    assert.equal(zeroUsage.usage.quantity, 0);
    assert.equal(failed.usage.status, 'refunded');
    assert.equal(executions, 2);
    assert.deepEqual(
      (
        await pool.query<{ action: string; amount: number }>(
          `SELECT action, amount::double precision AS amount FROM p1_usage_events
            WHERE workspace_id = $1 AND reservation_id = $2
            ORDER BY CASE action WHEN 'reserve' THEN 0 ELSE 1 END`,
          [workspaceId, zeroUsage.usage.id],
        )
      ).rows,
      [
        { action: 'reserve', amount: 0 },
        { action: 'commit', amount: 0 },
      ],
    );
    assert.match(
      (
        await pool.query<{ definition: string }>(
          `SELECT pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
            WHERE conrelid = 'p1_usage_events'::regclass
              AND conname = 'p1_usage_events_amount_v2_check'`,
        )
      ).rows[0]?.definition ?? '',
      /amount >= \(?0\)?/i,
    );
    assert.deepEqual(
      (
        await pool.query<{ stage: string; billing_status: string }>(
          `SELECT stage, billing_status FROM p1_provider_cost_events
            WHERE workspace_id = $1
            ORDER BY stage, id`,
          [workspaceId],
        )
      ).rows,
      [
        { stage: 'estimated', billing_status: 'known' },
        { stage: 'observed', billing_status: 'known' },
        { stage: 'observed', billing_status: 'known' },
      ],
    );
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::integer AS count FROM p1_usage_events
            WHERE workspace_id = $1 AND action = 'commit'`,
          [workspaceId],
        )
      ).rows[0]?.count,
      2,
    );
    const grantTransactions = await grantLots.listTransactions(workspaceId);
    assert.ok(
      grantTransactions.some(
        (transaction) => transaction.transactionType === 'REGISTER_GIFT',
      ),
    );
    assert.ok(
      grantTransactions.some(
        (transaction) =>
          transaction.transactionType === 'SUBSCRIPTION_RENEWAL',
      ),
    );
    assert.ok(
      grantTransactions.some(
        (transaction) => transaction.transactionType === 'PURCHASE_PACKAGE',
      ),
    );
    const failedUsage = grantTransactions.find(
      (transaction) =>
        transaction.transactionType === 'USAGE' &&
        transaction.operationId === failed.usage.id,
    );
    const refund = grantTransactions.find(
      (transaction) =>
        transaction.transactionType === 'REFUND' &&
        transaction.relatedTransactionId === failedUsage?.id,
    );
    assert.ok(failedUsage);
    assert.equal(refund?.relatedTransactionId, failedUsage.id);
    const userProjection = await entitlements.getProjection(entitlementContext);
    assert.equal(userProjection.usage.image.available, 24);
    assert.equal(userProjection.usage.copy.available, 20);

    const redemptionContext = {
      workspaceId: redemptionWorkspaceId,
      userId,
      correlationId: 'pg-redemption-entitlement',
    };
    const legacyEntitlements = new ProductEntitlementApplicationService(
      repository,
      undefined,
      () => new Date('2026-07-19T00:00:00.000Z'),
    );
    await legacyEntitlements.activatePlan(
      redemptionContext,
      {
        paymentEventId: 'legacy-base-image-one',
        policy: {
          ...trialPolicy,
          revision: 'legacy-base-image-one',
          allowance: { audio: 0, copy: 0, image: 1, video: 0 },
        },
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'legacy-base-image-one',
    );
    const legacyApplication = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution: new RecordedProviderExecutionPort(),
      ledger: new FoundationModelSupplyLedger(foundation, legacyEntitlements),
    });
    const redemptionSubmission = {
      ...submission,
      workspaceId: redemptionWorkspaceId,
      idempotencyKey: 'legacy-base-consumed',
      prompt: 'Consume the legacy base allowance',
    };
    await legacyApplication.submit(redemptionSubmission);

    const redemptionStore = new PostgresRedemptionStore(pool);
    await redemptionStore.migrate();
    const redemptions = new RedemptionApplicationService(
      redemptionStore,
      undefined,
      () => new Date('2026-07-19T12:00:00.000Z'),
    );
    await redemptions.createCodes({
      code: redemptionCode,
      grants: { image: 1 },
      createdBy: userId,
    });
    await redemptions.redeem({
      code: redemptionCode,
      workspaceId: redemptionWorkspaceId,
      userId,
      correlationId: 'redeem-image-one',
    });
    const redemptionGrantEntitlements =
      new GrantLotAwareProductEntitlementService(
        repository,
        grantLots,
        undefined,
        () => new Date('2026-07-19T12:00:00.000Z'),
      );
    assert.equal(
      (await redemptionGrantEntitlements.getProjection(redemptionContext)).usage
        .image.available,
      1,
    );

    let redemptionExecutions = 0;
    const redemptionExecution: ProviderExecutionPort = {
      async execute(request) {
        redemptionExecutions += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    };
    const grantApplication = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution: redemptionExecution,
      ledger: new FoundationModelSupplyLedger(
        foundation,
        redemptionGrantEntitlements,
        grantLots,
      ),
    });
    const redeemed = await grantApplication.submit({
      ...redemptionSubmission,
      idempotencyKey: 'redeemed-image-consumed',
      prompt: 'Consume the redeemed allowance',
    });
    assert.equal(redeemed.status, 'completed');
    assert.equal(
      (await grantLots.listLots(redemptionWorkspaceId, 'image')).reduce(
        (total, lot) => total + lot.remainingAmount,
        0,
      ),
      0,
    );
    assert.deepEqual(
      (
        await pool.query<{ amount: number }>(
          `SELECT amount::double precision AS amount FROM p1_usage_events
            WHERE workspace_id = $1 AND reservation_id = $2
              AND action = 'reserve'`,
          [redemptionWorkspaceId, redeemed.usage.id],
        )
      ).rows,
      [{ amount: 0 }],
    );
    const redemptionRetrySubmission = {
      ...redemptionSubmission,
      idempotencyKey: 'redeemed-image-retry-after-topup',
      prompt: 'Retry the identical submission after redemption top-up',
    };
    await assert.rejects(
      grantApplication.submit(redemptionRetrySubmission),
      { code: 'INSUFFICIENT_ENTITLEMENT' },
    );
    assert.equal(redemptionExecutions, 1);
    assert.equal(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM p1_generation_jobs
            WHERE workspace_id = $1 AND id = $2`,
          [redemptionWorkspaceId, modelSupplyJobId(redemptionRetrySubmission)],
        )
      ).rows[0]?.count,
      0,
    );
    await redemptions.createCodes({
      code: redemptionRetryCode,
      grants: { image: 1 },
      createdBy: userId,
    });
    await redemptions.redeem({
      code: redemptionRetryCode,
      workspaceId: redemptionWorkspaceId,
      userId,
      correlationId: 'redeem-image-retry-one',
    });
    const redemptionRetry = await grantApplication.submit(
      redemptionRetrySubmission,
    );
    assert.equal(redemptionRetry.status, 'completed');
    assert.equal(redemptionExecutions, 2);
    assert.equal(
      (await grantLots.listLots(redemptionWorkspaceId, 'image')).reduce(
        (total, lot) => total + lot.remainingAmount,
        0,
      ),
      0,
    );

    const packageContext = {
      workspaceId: packageWorkspaceId,
      userId,
      correlationId: 'pg-package-entitlement',
    };
    const packageEntitlements = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => new Date('2026-07-19T00:00:00.000Z'),
    );
    await packageEntitlements.activatePlan(
      packageContext,
      {
        paymentEventId: 'package-base-image-one',
        policy: {
          ...trialPolicy,
          revision: 'package-base-image-one',
          allowance: { audio: 0, copy: 0, image: 1, video: 0 },
        },
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'package-base-image-one',
    );
    let packageExecutions = 0;
    const packageExecution: ProviderExecutionPort = {
      async execute(request) {
        packageExecutions += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    };
    const packageApplication = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution: packageExecution,
      ledger: new FoundationModelSupplyLedger(
        foundation,
        packageEntitlements,
        grantLots,
      ),
    });
    const packageSubmission = {
      ...submission,
      workspaceId: packageWorkspaceId,
      idempotencyKey: 'package-base-consumed',
      prompt: 'Consume the base allowance before a package purchase',
    };
    await packageApplication.submit(packageSubmission);
    await packageEntitlements.recordAddOnPurchase(
      packageContext,
      {
        paymentEventId: 'package-image-one-payment',
        purchaseId: 'package-image-one',
        resource: 'image',
        quantity: 1,
        amountMicros: 100,
        currency: 'CNY',
      },
      'package-image-one-payment',
    );
    const packageResult = await packageApplication.submit({
      ...packageSubmission,
      idempotencyKey: 'package-image-consumed',
      prompt: 'Consume the purchased allowance',
    });
    assert.equal(packageResult.status, 'completed');
    assert.equal(
      (await grantLots.listLots(packageWorkspaceId, 'image')).reduce(
        (total, lot) => total + lot.remainingAmount,
        0,
      ),
      0,
    );
    assert.ok(
      (await grantLots.listTransactions(packageWorkspaceId)).some(
        (transaction) => transaction.transactionType === 'PURCHASE_PACKAGE',
      ),
    );
    const packageRetrySubmission = {
      ...packageSubmission,
      idempotencyKey: 'package-image-retry-after-topup',
      prompt: 'Retry the identical submission after package top-up',
    };
    await assert.rejects(
      packageApplication.submit(packageRetrySubmission),
      { code: 'INSUFFICIENT_ENTITLEMENT' },
    );
    assert.equal(packageExecutions, 2);
    assert.equal(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM p1_generation_jobs
            WHERE workspace_id = $1 AND id = $2`,
          [packageWorkspaceId, modelSupplyJobId(packageRetrySubmission)],
        )
      ).rows[0]?.count,
      0,
    );
    await packageEntitlements.recordAddOnPurchase(
      packageContext,
      {
        paymentEventId: 'package-image-retry-payment',
        purchaseId: 'package-image-retry-one',
        resource: 'image',
        quantity: 1,
        amountMicros: 100,
        currency: 'CNY',
      },
      'package-image-retry-payment',
    );
    const packageRetry = await packageApplication.submit(
      packageRetrySubmission,
    );
    assert.equal(packageRetry.status, 'completed');
    assert.equal(packageExecutions, 3);
    assert.equal(
      (await grantLots.listLots(packageWorkspaceId, 'image')).reduce(
        (total, lot) => total + lot.remainingAmount,
        0,
      ),
      0,
    );

    const legacyOnlyContext = {
      workspaceId: legacyOnlyWorkspaceId,
      userId,
      correlationId: 'pg-legacy-only-entitlement',
    };
    await foundation.appendUsageEvent(
      legacyOnlyContext,
      {
        id: 'legacy-only-image-two',
        resource: 'image',
        action: 'adjust',
        amount: 2,
        reason: 'legacy-only opening balance',
      },
      'legacy-only-image-two',
    );
    const legacyOnlyEntitlements = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => new Date('2026-07-19T00:00:00.000Z'),
    );
    assert.equal(
      (await legacyOnlyEntitlements.getProjection(legacyOnlyContext)).usage.image
        .available,
      2,
    );
    assert.equal(
      (await grantLots.listLots(legacyOnlyWorkspaceId, 'image')).length,
      1,
    );
    let legacyOnlyExecutions = 0;
    const legacyOnlyExecution: ProviderExecutionPort = {
      async execute(request) {
        legacyOnlyExecutions += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    };
    const legacyOnlyApplication = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution: legacyOnlyExecution,
      ledger: new FoundationModelSupplyLedger(
        foundation,
        legacyOnlyEntitlements,
        grantLots,
      ),
    });
    const legacyOnlySubmission = {
      ...submission,
      workspaceId: legacyOnlyWorkspaceId,
      idempotencyKey: 'legacy-only-image-first',
      prompt: 'Consume migrated legacy allowance one',
    };
    assert.equal(
      (await legacyOnlyApplication.submit(legacyOnlySubmission)).status,
      'completed',
    );
    assert.equal(
      (
        await legacyOnlyApplication.submit({
          ...legacyOnlySubmission,
          idempotencyKey: 'legacy-only-image-second',
          prompt: 'Consume migrated legacy allowance two',
        })
      ).status,
      'completed',
    );
    assert.equal(
      (await legacyOnlyEntitlements.getProjection(legacyOnlyContext)).usage.image
        .available,
      0,
    );
    await assert.rejects(
      legacyOnlyApplication.submit({
        ...legacyOnlySubmission,
        idempotencyKey: 'legacy-only-image-third',
        prompt: 'Reject exhausted migrated legacy allowance',
      }),
      { code: 'INSUFFICIENT_ENTITLEMENT' },
    );
    assert.equal(legacyOnlyExecutions, 2);

    const pendingContext = {
      workspaceId: pendingWorkspaceId,
      userId,
      correlationId: 'pg-pending-migration',
    };
    const pendingLegacyEntitlements = new ProductEntitlementApplicationService(
      repository,
      undefined,
      () => new Date('2026-07-19T00:00:00.000Z'),
    );
    await pendingLegacyEntitlements.activatePlan(
      pendingContext,
      {
        paymentEventId: 'pending-legacy-plan',
        policy: {
          ...trialPolicy,
          revision: 'pending-legacy-plan',
          allowance: { audio: 0, copy: 2, image: 2, video: 0 },
        },
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'pending-legacy-plan',
    );
    await foundation.appendUsageEvent(
      pendingContext,
      {
        id: 'pending-legacy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 1,
        reservationId: 'pending-legacy-reservation',
        reason: 'legacy in-flight generation',
      },
      'pending-legacy-reserve',
    );
    const pendingGrantEntitlements =
      new GrantLotAwareProductEntitlementService(
        repository,
        grantLots,
        undefined,
        () => new Date('2026-07-19T12:00:00.000Z'),
      );
    assert.equal(
      (await pendingGrantEntitlements.getProjection(pendingContext)).usage.copy
        .available,
      0,
    );
    assert.equal(
      (await pendingGrantEntitlements.getProjection(pendingContext)).usage.image
        .available,
      2,
    );
    assert.equal(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM p1_grant_lot_legacy_migrations
            WHERE workspace_id = $1 AND resource = 'copy'`,
          [pendingWorkspaceId],
        )
      ).rows[0]?.count,
      0,
    );
    assert.equal(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM p1_grant_lot_legacy_migrations
            WHERE workspace_id = $1 AND resource = 'image'`,
          [pendingWorkspaceId],
        )
      ).rows[0]?.count,
      1,
    );
    await foundation.appendUsageEvent(
      pendingContext,
      {
        id: 'pending-legacy-refund',
        resource: 'copy',
        action: 'refund',
        amount: 1,
        reservationId: 'pending-legacy-reservation',
        reason: 'legacy in-flight generation refunded',
      },
      'pending-legacy-refund',
    );
    assert.equal(
      (await pendingGrantEntitlements.getProjection(pendingContext)).usage.copy
        .available,
      2,
    );
    assert.equal(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM p1_grant_lot_legacy_migrations
            WHERE workspace_id = $1 AND resource = 'copy'`,
          [pendingWorkspaceId],
        )
      ).rows[0]?.count,
      1,
    );

    const concurrentMigrationContext = {
      workspaceId: concurrentMigrationWorkspaceId,
      userId,
      correlationId: 'pg-concurrent-legacy-migration',
    };
    const concurrentLegacyEntitlements = new ProductEntitlementApplicationService(
      repository,
      undefined,
      () => new Date('2026-07-19T00:00:00.000Z'),
    );
    await concurrentLegacyEntitlements.activatePlan(
      concurrentMigrationContext,
      {
        paymentEventId: 'concurrent-legacy-plan',
        policy: {
          ...trialPolicy,
          revision: 'concurrent-legacy-plan',
          allowance: { audio: 0, copy: 0, image: 10, video: 0 },
        },
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'concurrent-legacy-plan',
    );
    await foundation.appendUsageEvent(
      concurrentMigrationContext,
      {
        id: 'concurrent-legacy-reserve',
        resource: 'image',
        action: 'reserve',
        amount: 3,
        reservationId: 'concurrent-legacy-reservation',
        reason: 'historical generation',
      },
      'concurrent-legacy-reserve',
    );
    await foundation.appendUsageEvent(
      concurrentMigrationContext,
      {
        id: 'concurrent-legacy-commit',
        resource: 'image',
        action: 'commit',
        amount: 3,
        reservationId: 'concurrent-legacy-reservation',
        reason: 'historical generation delivered',
      },
      'concurrent-legacy-commit',
    );
    let releaseMigration!: () => void;
    const migrationRelease = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    let signalMigrationEntered!: () => void;
    const migrationEntered = new Promise<void>((resolve) => {
      signalMigrationEntered = resolve;
    });
    let paused = false;
    const delayedGrantLots = new Proxy(grantLots, {
      get(target, property) {
        if (
          property === 'isLegacyBalanceMigrated' ||
          property === 'migrateLegacyBalance'
        ) {
          return async (...args: unknown[]) => {
            const targetsImage =
              property === 'isLegacyBalanceMigrated'
                ? args[1] === 'image'
                : (args[0] as { resource?: string } | undefined)?.resource ===
                  'image';
            if (!paused && targetsImage) {
              paused = true;
              const current =
                property === 'isLegacyBalanceMigrated'
                  ? await target.isLegacyBalanceMigrated(
                      args[0] as string,
                      args[1] as 'image',
                    )
                  : undefined;
              signalMigrationEntered();
              await migrationRelease;
              if (property === 'isLegacyBalanceMigrated') return current;
            }
            const method = Reflect.get(target, property, target) as
              | ((...methodArgs: unknown[]) => unknown)
              | undefined;
            if (!method) {
              throw new Error('Atomic legacy migration is not implemented.');
            }
            return method.apply(target, args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const delayedEntitlements = new GrantLotAwareProductEntitlementService(
      repository,
      delayedGrantLots,
      undefined,
      () => new Date('2026-07-19T12:00:00.000Z'),
    );
    const delayedProjection = delayedEntitlements.getProjection(
      concurrentMigrationContext,
    );
    await migrationEntered;
    const liveConsume = grantLots.consume({
      workspaceId: concurrentMigrationWorkspaceId,
      resource: 'image',
      amount: 1,
      transactionId: 'concurrent-live-consume',
      actorId: userId,
      correlationId: 'concurrent-live-consume',
      createdAt: '2026-07-19T12:01:00.000Z',
    });
    releaseMigration();
    await Promise.all([delayedProjection, liveConsume]);
    assert.equal(
      (await grantLots.listLots(concurrentMigrationWorkspaceId, 'image')).reduce(
        (total, lot) => total + lot.remainingAmount,
        0,
      ),
      6,
    );
    assert.equal(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM p1_grant_lot_legacy_migrations
            WHERE workspace_id = $1 AND resource = 'image'`,
          [concurrentMigrationWorkspaceId],
        )
      ).rows[0]?.count,
      1,
    );
  },
);

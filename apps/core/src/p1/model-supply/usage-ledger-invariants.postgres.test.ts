import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { z } from 'zod';

import { P1ApplicationService } from '../foundation/application-service.js';
import {
  P1DomainError,
  REGISTER_GIFT_GRANT_KEY,
} from '../foundation/domain.js';
import { ProductEntitlementApplicationService } from '../foundation/entitlement-service.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import {
  PostgresEntitlementPoolsMigration,
  PostgresSupplyFreezeStore,
} from '../entitlement-pools/postgres-repository.js';
import {
  executeCopySelection,
  type CandidatePolicyValidator,
} from '../harness/execution-selection.js';
import { DurableProductBillingService } from '../product-billing/durable-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { FoundationModelSupplyLedger } from './foundation-ledger.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type CatalogModel,
  type ModelDeployment,
} from './index.js';
import {
  ModelSupplyStructuredNodeRunner,
  type StructuredObjectExecutor,
} from './structured-node-runner.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'one Coordinator usage owns eight structured jobs through a worker replay',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `usage-invariant-${suffix}`;
    const actorId = `usage-invariant-owner-${suffix}`;
    const taskId = `usage-invariant-task-${suffix}`;
    const quoteId = `usage-invariant-quote-${suffix}`;
    const supplySchema = `p1_usage_invariant_${suffix.replaceAll('-', '')}`;
    const foundationRepository = new PostgresFoundationRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    await pool.query(`CREATE SCHEMA "${supplySchema}"`);
    const supplyPool = new Pool({
      connectionString,
      options: `-c search_path=${supplySchema}`,
    });
    const migrationClient = await supplyPool.connect();
    try {
      await new PostgresEntitlementPoolsMigration().migrate(migrationClient);
    } finally {
      migrationClient.release();
    }
    const supplyFreezes = new PostgresSupplyFreezeStore(supplyPool);

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
    await foundationRepository.migrate();
    await billingRepository.migrate();
    await pool.query(
      `INSERT INTO "user" (id, name, email)
       VALUES ($1, 'Usage invariant owner', $2)`,
      [actorId, `${actorId}@example.test`],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name)
       VALUES ($1, 'Usage invariant workspace')`,
      [workspaceId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, actorId],
    );

    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_product_billing_provider_costs WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_product_billing_usage WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_product_billing_quotes WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [actorId]);
      await supplyPool.end();
      await pool.query(`DROP SCHEMA "${supplySchema}" CASCADE`);
      await pool.end();
    });

    const foundation = new P1ApplicationService(foundationRepository);
    const entitlements = new ProductEntitlementApplicationService(
      foundationRepository,
      undefined,
      () => new Date('2026-07-25T00:00:00.000Z'),
    );
    await entitlements.activatePlan(
      {
        workspaceId,
        userId: actorId,
        correlationId: `usage-invariant-entitlement-${suffix}`,
      },
      {
        paymentEventId: `usage-invariant-grant-${suffix}`,
        grantKey: REGISTER_GIFT_GRANT_KEY,
        policy: {
          revision: `usage-invariant-policy-${suffix}`,
          tier: 'trial',
          periodId: 'usage-invariant-period',
          periodStartsAt: '2026-07-25T00:00:00.000Z',
          periodEndsAt: '2026-07-26T00:00:00.000Z',
          periodStrategy: 'fixed_days',
          allowance: { audio: 0, copy: 20, image: 0, video: 0 },
          concurrencyLimit: 1,
          queuePriority: 1,
          supportLabel: 'standard',
        },
      },
      `usage-invariant-grant-${suffix}`,
    );

    const billing = new DurableProductBillingService(billingRepository);
    const quote = await billing.buildQuote({
      billingMode: 'per_request',
      catalogModelId: 'usage-invariant-model',
      frozenCandidateDeploymentIds: ['usage-invariant-deployment'],
      outputCount: 1,
      quoteId,
      quotePolicyRevision: 'usage-invariant-quote-policy',
      unitRate: 1,
      workspaceId,
    });
    await billing.confirm({ quoteId, taskId, workspaceId });
    await billing.beforeSubmit({
      quoteId,
      quoteRevision: quote.revision,
      resource: 'copy',
      taskId,
      workspaceId,
    });
    await assert.rejects(
      billing.beforeSubmit({
        quoteId,
        quoteRevision: `${quote.revision}:changed`,
        resource: 'copy',
        taskId,
        workspaceId,
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );

    const model: CatalogModel = {
      id: 'usage-invariant-model',
      modality: 'llm',
      operations: ['text.respond'],
      displayName: 'Usage invariant model',
      qualityRank: 100,
    };
    const deployment: ModelDeployment = {
      id: 'usage-invariant-deployment',
      catalogModelId: model.id,
      apiFamily: 'openai',
      channel: 'direct',
      region: 'domestic',
      status: 'active',
      credentialVersion: 'usage-invariant-credential-v1',
      priceRevision: 'usage-invariant-price',
      unitPrice: {
        amountMicros: 1,
        currency: 'CNY',
        unit: 'request',
      },
    };
    const executor = new CountingStructuredExecutor();
    const createRunner = () =>
      new ModelSupplyStructuredNodeRunner({
        application: new ModelSupplyApplicationService({
          models: [model],
          deployments: [deployment],
          execution: new RecordedProviderExecutionPort(),
          ledger: new FoundationModelSupplyLedger(
            foundation,
            entitlements,
            undefined,
            {
              billingLifecycle: billing,
              productUsage: billing,
              supplyFreezes,
            },
          ),
        }),
        executor,
        workspaceId,
        actorId,
        selection: { mode: 'fixed', catalogModelId: model.id },
        billingTaskId: taskId,
        billingQuoteRevision: quote.revision,
      });
    const request = (index: number) => ({
      effectIdempotencyKey: `usage-invariant:${taskId}:job:${index}`,
      instructions: 'Return the structured fixture.',
      prompt: JSON.stringify({ index }),
      schema: z.object({ value: z.string() }).strict(),
      schemaName: 'usage_invariant_v1',
      schemaRevision: 'usage-invariant-v1',
    });

    const runner = createRunner();
    for (let index = 0; index < 8; index += 1) {
      await runner.run(request(index));
    }
    // The provider result is durable but its caller loses the response. A new
    // worker must recover the first job without a ninth provider execution.
    const replayed = await createRunner().run(request(0));
    assert.deepEqual(replayed.output, { value: 'fixture' });

    const legacyUsage = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM p1_usage_events
        WHERE workspace_id = $1
          AND action IN ('reserve', 'commit')
          AND reason IN (
            'generation_dispatch_checkpoint',
            'copy_output_delivered'
          )`,
      [workspaceId],
    );
    const canonicalUsage = await pool.query<{
      count: number;
      reserved_quantity: number;
    }>(
      `SELECT count(*)::integer AS count,
              min((payload->>'reservedQuantity')::integer)::integer
                AS reserved_quantity
         FROM p1_product_billing_usage
        WHERE workspace_id = $1 AND task_id = $2`,
      [workspaceId, taskId],
    );
    const canonicalCosts = await pool.query<{
      count: number;
      job_count: number;
      observed_count: number;
      task_count: number;
    }>(
      `SELECT count(*)::integer AS count,
              count(DISTINCT costs.task_id)::integer AS task_count,
              count(DISTINCT attempts.job_id)::integer AS job_count,
              count(*) FILTER (
                WHERE costs.payload->>'evidenceKind' = 'provider_bill'
                  AND costs.payload ? 'observedCostMicros'
              )::integer AS observed_count
         FROM p1_product_billing_provider_costs costs
         JOIN p1_provider_attempts attempts
           ON attempts.workspace_id = costs.workspace_id
          AND attempts.id = costs.attempt_id
        WHERE costs.workspace_id = $1`,
      [workspaceId],
    );
    const supplyCosts = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM p1_provider_cost_events
        WHERE workspace_id = $1 AND stage = 'observed'`,
      [workspaceId],
    );
    const taskSupplyFreezes = await supplyPool.query<{
      count: number;
      provider_attempt_count: number;
      supplier_request_count: number;
    }>(
      `SELECT count(*)::integer AS count,
              count(DISTINCT provider_cost_attempt_id)::integer
                AS provider_attempt_count,
              count(DISTINCT supplier_request_task_id)::integer
                AS supplier_request_count
         FROM p1_supply_request_freezes
        WHERE workspace_id = $1 AND product_usage_task_id = $2`,
      [workspaceId, taskId],
    );

    assert.deepEqual(
      {
        canonicalCosts: canonicalCosts.rows[0],
        canonicalUsage: canonicalUsage.rows[0],
        executorCalls: executor.calls,
        legacyUsageEvents: legacyUsage.rows[0]?.count,
        supplyCosts: supplyCosts.rows[0]?.count,
        supplyFreezes: taskSupplyFreezes.rows[0],
      },
      {
        canonicalCosts: {
          count: 8,
          job_count: 8,
          observed_count: 8,
          task_count: 1,
        },
        canonicalUsage: { count: 1, reserved_quantity: 1 },
        executorCalls: 8,
        legacyUsageEvents: 0,
        supplyCosts: 8,
        supplyFreezes: {
          count: 8,
          provider_attempt_count: 8,
          supplier_request_count: 8,
        },
      },
    );
    t.diagnostic(
      '8-job ledger: canonicalUsage=1 reservedQuantity=1 canonicalCosts=8 jobs=8 observed=8 tasks=1 executorCalls=8 legacyUsageEvents=0 supplyCosts=8 supplyFreezes=8 supplierRequests=8 providerAttempts=8',
    );

    await t.test(
      'a policy-blocked primary and its retry still own one ProductUsage',
      async (retryTest) => {
        const retryTaskId = `usage-invariant-retry-task-${suffix}`;
        const retryQuoteId = `usage-invariant-retry-quote-${suffix}`;
        const retryWorkflowId = `usage-invariant-retry-workflow-${suffix}`;
        const retryQuote = await billing.buildQuote({
          billingMode: 'per_request',
          catalogModelId: model.id,
          frozenCandidateDeploymentIds: [deployment.id],
          outputCount: 1,
          quoteId: retryQuoteId,
          quotePolicyRevision: 'usage-invariant-retry-quote-policy',
          unitRate: 1,
          workspaceId,
        });
        await billing.confirm({
          quoteId: retryQuoteId,
          taskId: retryTaskId,
          workspaceId,
        });
        await billing.beforeSubmit({
          quoteId: retryQuoteId,
          quoteRevision: retryQuote.revision,
          resource: 'copy',
          taskId: retryTaskId,
          workspaceId,
        });

        const retryExecutor = new RetryStructuredExecutor();
        const retryRunner = new ModelSupplyStructuredNodeRunner({
          application: new ModelSupplyApplicationService({
            models: [model],
            deployments: [deployment],
            execution: new RecordedProviderExecutionPort(),
            ledger: new FoundationModelSupplyLedger(
              foundation,
              entitlements,
              undefined,
              {
                billingLifecycle: billing,
                productUsage: billing,
                supplyFreezes,
              },
            ),
          }),
          executor: retryExecutor,
          workspaceId,
          actorId,
          selection: { mode: 'fixed', catalogModelId: model.id },
          billingTaskId: retryTaskId,
          billingQuoteRevision: retryQuote.revision,
        });

        const selection = await executeCopySelection(
          {
            workflowId: retryWorkflowId,
            unitId: 'copy-primary',
            brief: {
              kind: 'copy',
              instructions: '基于已确认事实写一条项目曝光文案。',
              platform: 'xiaohongshu',
              cta: '私信预约',
              factRefs: [],
              assetRefs: [],
              identityRefs: ['identity-owner-1'],
              constraints: ['不得编造事实'],
            },
            workspaceId,
            intendedUse: 'public_content',
            generationContext: {
              bundle: { workspaceId, revision: 1 },
              sourceRefs: [],
              rightsRefs: [],
              identityRefs: [
                { id: 'identity-owner-1', status: 'registered' },
              ],
            },
          },
          {
            runner: retryRunner,
            validator: new RetryOnceValidator(),
          },
        );

        const retryUsage = await pool.query<{
          count: number;
          reserved_quantity: number;
        }>(
          `SELECT count(*)::integer AS count,
                  min((payload->>'reservedQuantity')::integer)::integer
                    AS reserved_quantity
             FROM p1_product_billing_usage
            WHERE workspace_id = $1 AND task_id = $2`,
          [workspaceId, retryTaskId],
        );
        const retryCosts = await pool.query<{
          count: number;
          observed_count: number;
        }>(
          `SELECT count(*)::integer AS count,
                  count(*) FILTER (
                    WHERE payload->>'evidenceKind' = 'provider_bill'
                      AND payload ? 'observedCostMicros'
                  )::integer AS observed_count
             FROM p1_product_billing_provider_costs
            WHERE workspace_id = $1 AND task_id = $2`,
          [workspaceId, retryTaskId],
        );
        const retryLegacyUsage = await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM p1_usage_events
            WHERE workspace_id = $1
              AND correlation_id LIKE $2
              AND action IN ('reserve', 'commit')`,
          [workspaceId, `wf:${retryWorkflowId}:%`],
        );
        const retrySupplyFreezes = await supplyPool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM p1_supply_request_freezes
            WHERE workspace_id = $1 AND product_usage_task_id = $2`,
          [workspaceId, retryTaskId],
        );

        assert.equal(selection.winner.candidateId, 'c01-retry');
        assert.deepEqual(selection.blockedCandidates, [
          {
            candidateId: 'c01',
            gateIds: ['medical_claim'],
            alternativePath: ['换安全素材'],
          },
        ]);
        assert.deepEqual(
          {
            canonicalCosts: retryCosts.rows[0],
            canonicalUsage: retryUsage.rows[0],
            executorCalls: retryExecutor.calls,
            legacyUsageEvents: retryLegacyUsage.rows[0]?.count,
            supplyFreezes: retrySupplyFreezes.rows[0]?.count,
          },
          {
            canonicalCosts: { count: 2, observed_count: 2 },
            canonicalUsage: { count: 1, reserved_quantity: 1 },
            executorCalls: 2,
            legacyUsageEvents: 0,
            supplyFreezes: 2,
          },
        );
        retryTest.diagnostic(
          'blocked retry ledger: canonicalUsage=1 reservedQuantity=1 canonicalCosts=2 observed=2 executorCalls=2 legacyUsageEvents=0 supplyFreezes=2',
        );
      },
    );
  },
);

class CountingStructuredExecutor implements StructuredObjectExecutor {
  calls = 0;

  supportsCatalogModel(catalogModelId: string) {
    return catalogModelId === 'usage-invariant-model';
  }

  async generate<Output>(input: { schema: z.ZodType<Output> }) {
    this.calls += 1;
    return {
      output: input.schema.parse({ value: 'fixture' }),
      providerTaskRef: `usage-invariant-provider-${this.calls}`,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0, currency: 'CNY' as const, usage };
  }
}

class RetryStructuredExecutor implements StructuredObjectExecutor {
  calls = 0;

  supportsCatalogModel(catalogModelId: string) {
    return catalogModelId === 'usage-invariant-model';
  }

  async generate<Output>(input: { schema: z.ZodType<Output> }) {
    this.calls += 1;
    return {
      output: input.schema.parse({
        title: this.calls === 1 ? '主推荐' : '安全重试',
        body: this.calls === 1 ? '正文 A' : '正文 B',
        conversionHook: '私信预约',
        factClaims: [],
        assetRefs: this.calls === 1 ? ['asset-medical'] : [],
        expressionIdentityRef: 'identity-owner-1',
      }),
      providerTaskRef: `usage-invariant-retry-provider-${this.calls}`,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0, currency: 'CNY' as const, usage };
  }
}

class RetryOnceValidator implements CandidatePolicyValidator {
  validate(candidate: Parameters<CandidatePolicyValidator['validate']>[0]) {
    if (!candidate.assetRefs.includes('asset-medical')) {
      return { passed: true, failures: [] };
    }
    return {
      passed: false,
      failures: [
        {
          gateId: 'medical_claim',
          reason: '文案包含未核验医疗宣称',
          alternativePath: ['换安全素材'],
        },
      ],
    };
  }
}

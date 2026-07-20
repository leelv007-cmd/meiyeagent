import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { DurableProductBillingService } from './durable-service.js';
import { PostgresProductBillingRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

describe(
  'Postgres ProductBillingRepository',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresProductBillingRepository(pool);
    const workspaces: string[] = [];

    before(async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await new PostgresFoundationRepository(pool).migrate();
      await repository.migrate();
    });

    after(async () => {
      for (const workspaceId of workspaces) {
        await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      }
      await pool.end();
    });

    async function workspace() {
      const id = `billing-${randomUUID()}`;
      workspaces.push(id);
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Product billing test')`,
        [id],
      );
      await pool.query(
        `INSERT INTO p1_usage_events
         (workspace_id,id,resource,action,amount,reason,actor_id,correlation_id,created_at)
         VALUES ($1,$2,'video','adjust',100,'test allowance','billing-test',$2,now())`,
        [id, `allowance:${id}`],
      );
      return id;
    }

    async function providerAttempt(
      workspaceId: string,
      taskId: string,
      attemptId: string,
      deploymentId: string,
      ordinal = 1,
    ) {
      const now = new Date().toISOString();
      const routeId = `billing-route:${taskId}`;
      await pool.query(
        `INSERT INTO p1_route_snapshots
         (workspace_id,id,catalog_revision,policy_revision,price_revision,requested_catalog_model_id,
          selection_mode,data_class,fallback_consent,allowed_candidates,created_at)
         VALUES ($1,$2,'catalog-1','policy-1','price-1','video-model','fixed','public',true,'[]'::jsonb,$3)
         ON CONFLICT DO NOTHING`,
        [workspaceId, routeId, now],
      );
      await pool.query(
        `INSERT INTO p1_generation_jobs
         (workspace_id,id,operation,route_snapshot_id,usage_reservation_id,status,created_by,
          correlation_id,created_at,updated_at)
         VALUES ($1,$2,'video',$3,$4,'running','billing-test',$2,$5,$5)
         ON CONFLICT DO NOTHING`,
        [workspaceId, taskId, routeId, `usage:${taskId}`, now],
      );
      await pool.query(
        `INSERT INTO p1_provider_attempts
         (workspace_id,id,job_id,ordinal,deployment_id,acceptance,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,'pending','submitted',$6,$6)
         ON CONFLICT DO NOTHING`,
        [workspaceId, attemptId, taskId, ordinal, deploymentId, now],
      );
    }

    function quoteInput(workspaceId: string, quoteId: string) {
      return {
        billingMode: 'per_output_second' as const,
        catalogModelId: 'video-model',
        frozenCandidateDeploymentIds: ['deployment-a', 'deployment-b'],
        quoteId,
        quotePolicyRevision: 'product-policy-1',
        targetSeconds: 10,
        unitRate: 0.5,
        workspaceId,
      };
    }

    const providerCost = {
      currency: 'CNY',
      estimatedCostMicros: 100_000,
      evidenceKind: 'estimated' as const,
      supplierPriceRevision: 'supplier-price-1',
      unit: 'second',
      unitPriceMicros: 10_000,
    };

    it('recovers quote, usage, and provider cost across process restarts', async () => {
      const workspaceId = await workspace();
      const firstProcess = new DurableProductBillingService(repository);
      const quote = await firstProcess.buildQuote(
        quoteInput(workspaceId, 'restart-quote'),
      );
      await firstProcess.confirm({
        quoteId: quote.quoteId,
        taskId: 'restart-task',
        workspaceId,
      });
      await firstProcess.beforeSubmit({
        quoteRevision: quote.revision,
        resource: 'video',
        taskId: 'restart-task',
        workspaceId,
      });

      const dispatchProcess = new DurableProductBillingService(repository);
      await providerAttempt(
        workspaceId,
        'restart-task',
        'restart-attempt',
        'deployment-a',
      );
      await dispatchProcess.dispatchAttempt({
        attemptId: 'restart-attempt',
        deploymentId: 'deployment-a',
        providerCost,
        taskId: 'restart-task',
        workspaceId,
      });

      const settleProcess = new DurableProductBillingService(repository);
      await settleProcess.settleTask({
        attemptId: 'restart-attempt',
        deploymentId: 'deployment-a',
        providerCost: {
          ...providerCost,
          evidenceKind: 'provider_bill',
          observedCostMicros: 60_000,
        },
        status: 'completed',
        taskId: 'restart-task',
        trustedUsage: { actualSeconds: 6, kind: 'media_duration' },
        workspaceId,
      });

      const readProcess = new DurableProductBillingService(repository);
      assert.equal(
        (await readProcess.getQuoteByTask('restart-task', workspaceId))
          ?.lifecycleStatus,
        'settled',
      );
      assert.equal(
        (await readProcess.getUsage('restart-task', workspaceId))?.settledQuantity,
        3,
      );
      assert.equal(
        (await readProcess.listProviderCosts('restart-task', workspaceId))[0]
          ?.observedCostMicros,
        60_000,
      );
      const canonicalUsage = await pool.query<{ action: string; amount: string }>(
        `SELECT action, amount::text AS amount FROM p1_usage_events
          WHERE workspace_id = $1 AND billing->>'taskId' = 'restart-task'
          ORDER BY created_at, id`,
        [workspaceId],
      );
      assert.deepEqual(canonicalUsage.rows, [
        { action: 'reserve', amount: '5' },
        { action: 'commit', amount: '3' },
      ]);
      const canonicalCosts = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM p1_provider_cost_events
          WHERE workspace_id = $1 AND snapshot->>'taskId' = 'restart-task'`,
        [workspaceId],
      );
      assert.equal(canonicalCosts.rows[0]?.count, '2');
    });

    it('requires a fresh quote and billing task for a paid reroll', async () => {
      const workspaceId = await workspace();
      const firstProcess = new DurableProductBillingService(repository);
      const original = await firstProcess.buildQuote(
        quoteInput(workspaceId, 'original-quote'),
      );
      await firstProcess.beforeSubmit({
        quoteId: original.quoteId,
        quoteRevision: original.revision,
        resource: 'video',
        taskId: 'original-task',
        workspaceId,
      });
      await providerAttempt(
        workspaceId,
        'original-task',
        'original-attempt',
        'deployment-a',
      );
      await firstProcess.dispatchAttempt({
        attemptId: 'original-attempt',
        deploymentId: 'deployment-a',
        providerCost,
        taskId: 'original-task',
        workspaceId,
      });
      await firstProcess.settleTask({
        attemptId: 'original-attempt',
        deploymentId: 'deployment-a',
        status: 'completed',
        taskId: 'original-task',
        trustedUsage: { actualSeconds: 6, kind: 'media_duration' },
        workspaceId,
      });

      const rerollProcess = new DurableProductBillingService(repository);
      await assert.rejects(
        rerollProcess.beforeSubmit({
          quoteId: original.quoteId,
          quoteRevision: original.revision,
          resource: 'video',
          taskId: 'reroll-job',
          workspaceId,
        }),
        (error: unknown) =>
          error instanceof P1DomainError && error.code === 'INVALID_STATE',
      );

      const reroll = await rerollProcess.buildQuote(
        quoteInput(workspaceId, 'reroll-quote'),
      );
      await rerollProcess.beforeSubmit({
        quoteId: reroll.quoteId,
        quoteRevision: reroll.revision,
        resource: 'video',
        taskId: 'reroll-job',
        workspaceId,
      });

      assert.equal(
        (await rerollProcess.getQuote(original.quoteId, workspaceId))?.taskId,
        'original-task',
      );
      assert.equal(
        (await rerollProcess.getQuote(reroll.quoteId, workspaceId))?.taskId,
        'reroll-job',
      );
      assert.equal(
        (await rerollProcess.getQuote(reroll.quoteId, workspaceId))
          ?.lifecycleStatus,
        'reserved',
      );
    });

    it('serializes concurrent task and attempt idempotency keys', async () => {
      const workspaceId = await workspace();
      const service = new DurableProductBillingService(repository);
      const first = await service.buildQuote(quoteInput(workspaceId, 'concurrent-a'));
      const second = await service.buildQuote(quoteInput(workspaceId, 'concurrent-b'));

      const confirms = await Promise.allSettled([
        new DurableProductBillingService(repository).confirm({
          quoteId: first.quoteId,
          taskId: 'shared-task',
          workspaceId,
        }),
        new DurableProductBillingService(repository).confirm({
          quoteId: second.quoteId,
          taskId: 'shared-task',
          workspaceId,
        }),
      ]);
      assert.equal(
        confirms.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      const rejected = confirms.find((result) => result.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' &&
          rejected.reason instanceof P1DomainError &&
          rejected.reason.code === 'IDEMPOTENCY_CONFLICT',
      );

      const bound = await service.getQuoteByTask('shared-task', workspaceId);
      assert.ok(bound);
      await service.beforeSubmit({
        quoteRevision: bound.revision,
        resource: 'video',
        taskId: 'shared-task',
        workspaceId,
      });
      await providerAttempt(
        workspaceId,
        'shared-task',
        'shared-attempt',
        'deployment-a',
      );
      const attempts = await Promise.allSettled([
        new DurableProductBillingService(repository).dispatchAttempt({
          attemptId: 'shared-attempt',
          deploymentId: 'deployment-a',
          providerCost,
          taskId: 'shared-task',
          workspaceId,
        }),
        new DurableProductBillingService(repository).dispatchAttempt({
          attemptId: 'shared-attempt',
          deploymentId: 'deployment-b',
          providerCost: {
            ...providerCost,
            supplierPriceRevision: 'supplier-price-2',
          },
          taskId: 'shared-task',
          workspaceId,
        }),
      ]);
      assert.equal(
        attempts.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        (await service.listProviderCosts('shared-task', workspaceId)).length,
        1,
      );
      assert.equal(
        (await service.getUsage('shared-task', workspaceId))?.reservedQuantity,
        5,
      );
    });

    it('isolates workspaces and rolls back a failed transaction', async () => {
      const workspaceId = await workspace();
      const otherWorkspaceId = await workspace();
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote(
        quoteInput(workspaceId, 'isolated-quote'),
      );
      assert.equal(
        await service.getQuote(quote.quoteId, otherWorkspaceId),
        null,
      );
      await assert.rejects(
        service.beforeSubmit({
          quoteId: quote.quoteId,
          quoteRevision: quote.revision,
          resource: 'video',
          taskId: 'isolated-task',
          workspaceId: otherWorkspaceId,
        }),
        /was not found/,
      );

      await assert.rejects(
        repository.withTransaction(
          workspaceId,
          ['quote:isolated-quote'],
          async (transaction) => {
            await transaction.saveQuote(workspaceId, {
              ...quote,
              lifecycleStatus: 'confirmed',
              taskId: 'must-roll-back',
            });
            throw new Error('force rollback after quote update');
          },
        ),
        /force rollback/,
      );
      assert.equal(
        (await service.getQuote(quote.quoteId, workspaceId))?.lifecycleStatus,
        'quoted',
      );
    });
  },
);

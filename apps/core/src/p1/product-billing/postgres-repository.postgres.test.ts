import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
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
      await repository.migrate();
    });

    after(async () => {
      for (const workspaceId of workspaces) {
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
      }
      await pool.end();
    });

    function workspace() {
      const id = `billing-${randomUUID()}`;
      workspaces.push(id);
      return id;
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
      const workspaceId = workspace();
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
    });

    it('requires a fresh quote and billing task for a paid reroll', async () => {
      const workspaceId = workspace();
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
      const workspaceId = workspace();
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
      const workspaceId = workspace();
      const otherWorkspaceId = workspace();
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

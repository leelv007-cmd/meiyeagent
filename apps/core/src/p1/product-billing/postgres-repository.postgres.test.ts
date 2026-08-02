import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import {
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  type ProviderExecutionRequest,
  createDefaultCatalogModels,
  createDefaultDeployments,
} from '../model-supply/index.js';
import type { ModelSupplyControlPlaneService } from '../model-supply/foundation-module.js';
import {
  MemoryOperationsRepository,
  ModelSupplyCreationExecutor,
  OperationsApplicationService,
} from '../operations/index.js';
import {
  DurableProductBillingService,
  merchantExecutionInputHashes,
} from './durable-service.js';
import { PostgresProductBillingRepository } from './postgres-repository.js';
import {
  CatalogProductQuoteAuthority,
  type PublicProductQuoteIntent,
} from './server-quote-authority.js';

const connectionString = process.env.TEST_DATABASE_URL;
const execFileAsync = promisify(execFile);

async function buildComposerImageSetQuote() {
  const composerModule = new URL(
    '../../../../../mkfast-template-main/src/product/composer/composer-live.ts',
    import.meta.url,
  ).href;
  const workspaceRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  const script = `
    import { buildLiveQuoteInput } from ${JSON.stringify(composerModule)};
    console.log(JSON.stringify(buildLiveQuoteInput({
      sessionId: 'composer-credit-image-set',
      lensId: 'image_text',
      quantity: 2,
      model: {
        id: 'seedream-5-pro',
        displayName: 'Seedream',
        modality: 'image',
        qualityRank: 1,
        capabilityLabels: [],
        available: true,
        availabilityKind: 'production',
        unitPrice: { amountMicros: 5_000_000, currency: 'CNY', revision: 'price-r1', unit: 'image' },
      },
      submission: {
        creationMode: 'customized',
        intent: '生成两张门店项目主图',
        catalogModel: { id: 'seedream-5-pro', revision: 'catalog-composer-r1' },
        recipe: { id: 'recipe-image-set', revision: 'recipe-image-set@1' },
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'export',
        deliverable: { kind: 'image_text_package', quantity: 2, aspectRatio: '3:4' },
      },
    })));
  `;
  const { stdout } = await execFileAsync(
    'pnpm',
    ['--filter', '@meiye/web', 'exec', 'tsx', '--eval', script],
    { cwd: workspaceRoot },
  );
  return JSON.parse(stdout) as PublicProductQuoteIntent;
}

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
          'DELETE FROM p1_product_billing_merchant_executions WHERE workspace_id = $1',
          [workspaceId],
        );
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
      const hashes = merchantExecutionInputHashes({
        input: { durationSeconds: 10 },
        prompt: 'merchant prompt',
      });
      return {
        billingMode: 'per_output_second' as const,
        catalogModelId: 'video-model',
        operation: 'video.generate',
        outputCount: 1,
        frozenCandidateDeploymentIds: ['deployment-a', 'deployment-b'],
        quoteId,
        quotePolicyRevision: 'product-policy-1',
        submissionContractHash: `signed-snapshot:${quoteId}`,
        submissionInputAssetsHash: hashes.inputAssetsHash,
        submissionPromptHash: hashes.promptHash,
        submissionReferenceAssetsHash: hashes.referenceAssetsHash,
        targetSeconds: 10,
        unitRate: 0.5,
        workspaceId,
      };
    }

    it('upgrades merchant execution constraints once and keeps later startup stable', async () => {
      const readConstraints = async () =>
        (
          await pool.query<{ definition: string; name: string; oid: number }>(
            `SELECT oid::int,
                    conname AS name,
                    pg_get_constraintdef(oid) AS definition
              FROM pg_constraint
              WHERE conrelid = 'p1_product_billing_merchant_executions'::regclass
              ORDER BY conname`,
          )
        ).rows;
      const readColumns = async () =>
        (
          await pool.query<{
            name: string;
            notNull: boolean;
            number: number;
          }>(
            `SELECT attname AS name,
                    attnotnull AS "notNull",
                    attnum::int AS number
               FROM pg_attribute
              WHERE attrelid = 'p1_product_billing_merchant_executions'::regclass
                AND attnum > 0
                AND NOT attisdropped
              ORDER BY attnum`,
          )
        ).rows;
      await pool.query(`
        ALTER TABLE p1_product_billing_merchant_executions
          DROP CONSTRAINT p1_product_billing_merchant_executions_result_check,
          DROP CONSTRAINT p1_product_billing_merchant_executions_status_check,
          ADD CHECK (status IN ('claimed', 'completed')),
          ADD CHECK (status = 'claimed' OR result IS NOT NULL)
      `);

      await repository.migrate();

      const migrated = await readConstraints();
      const migratedColumns = await readColumns();
      const migratedChecks = migrated.filter(({ definition }) =>
        definition.startsWith('CHECK'),
      );
      assert.deepEqual(
        migratedChecks.map(({ name }) => name),
        [
          'p1_product_billing_merchant_executions_result_check',
          'p1_product_billing_merchant_executions_status_check',
        ],
      );
      assert.equal(
        migratedChecks.every(({ definition }) => definition.includes('bound')),
        true,
      );

      await repository.migrate();

      assert.deepEqual(await readConstraints(), migrated);
      assert.deepEqual(await readColumns(), migratedColumns);
    });

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
        6,
      );
      assert.equal(
        (await readProcess.listProviderCosts('restart-task', workspaceId))[0]
          ?.observedCostMicros,
        60_000,
      );
    });

    it('counts only committed ProductUsage receipts in the Asia/Shanghai month', async () => {
      const workspaceId = workspace();
      let now = new Date('2026-07-31T15:59:00.000Z');
      const service = new DurableProductBillingService(repository, () => now);
      const quote = await service.buildQuote({
        billingMode: 'per_request',
        catalogModelId: 'copy-model',
        outputCount: 3,
        quoteId: 'monthly-output-quote',
        quotePolicyRevision: 'product-policy-1',
        unitRate: 1,
        workspaceId,
      });
      await service.confirm({
        quoteId: quote.quoteId,
        taskId: 'monthly-output-task',
        workspaceId,
      });
      await service.reserve({
        quoteId: quote.quoteId,
        units: [{ resource: 'copy', quantity: 3 }],
        usageId: 'monthly-output-usage',
        workspaceId,
      });

      assert.deepEqual(
        await service.getMonthlyOutput(workspaceId, '2026-07'),
        { copy: 0, image: 0, video: 0 },
      );

      now = new Date('2026-07-31T16:01:00.000Z');
      await service.settle({ quoteId: quote.quoteId, workspaceId });

      assert.deepEqual(
        await service.getMonthlyOutput(workspaceId, '2026-07'),
        { copy: 0, image: 0, video: 0 },
      );
      assert.deepEqual(
        await service.getMonthlyOutput(workspaceId, '2026-08'),
        { copy: 3, image: 0, video: 0 },
      );
    });

    it('counts partially refunded video delivery and projects its settled usage', async () => {
      const workspaceId = workspace();
      const service = new DurableProductBillingService(
        repository,
        () => new Date('2026-07-26T08:00:00.000Z'),
      );
      const quote = await service.buildQuote(
        quoteInput(workspaceId, 'monthly-partial-video'),
      );
      await service.confirm({
        quoteId: quote.quoteId,
        taskId: 'monthly-partial-video-task',
        workspaceId,
      });
      await service.beforeSubmit({
        quoteId: quote.quoteId,
        quoteRevision: quote.revision,
        resource: 'video',
        taskId: 'monthly-partial-video-task',
        workspaceId,
      });
      await service.settleTask({
        attemptId: 'monthly-partial-video-attempt',
        deploymentId: 'coordinator',
        status: 'completed',
        taskId: 'monthly-partial-video-task',
        trustedUsage: { actualSeconds: 6, kind: 'media_duration' },
        workspaceId,
      });

      assert.equal(
        (await service.getUsage('monthly-partial-video-task', workspaceId))
          ?.status,
        'partially_refunded',
      );
      assert.deepEqual(
        await service.getMonthlyOutput(workspaceId, '2026-07'),
        { copy: 0, image: 0, video: 1 },
      );
      assert.deepEqual(
        (await service.getUsageProjection(workspaceId)).video,
        { reserved: 0, committed: 6, released: 4 },
      );
    });

    it('requires a fresh quote and billing task for a paid reroll', async () => {
      const workspaceId = workspace();
      const firstProcess = new DurableProductBillingService(repository);
      const original = await firstProcess.buildQuote(
        quoteInput(workspaceId, 'original-quote'),
      );
      await firstProcess.confirm({
        quoteId: original.quoteId,
        taskId: 'original-task',
        workspaceId,
      });
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
      await rerollProcess.confirm({
        quoteId: reroll.quoteId,
        taskId: 'reroll-job',
        workspaceId,
      });
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
        10,
      );
    });

    it('keeps one quote bound under concurrent confirms and reserves exactly once', async () => {
      const workspaceId = workspace();
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote(
        quoteInput(workspaceId, 'concurrent-binding'),
      );
      const taskIds = Array.from({ length: 18 }, (_, index) =>
        index % 3 === 0 ? 'binding-task-b' : 'binding-task-a',
      );
      const confirms = await Promise.allSettled(
        taskIds.map((taskId) =>
          new DurableProductBillingService(repository).confirm({
            quoteId: quote.quoteId,
            taskId,
            workspaceId,
          }),
        ),
      );
      const bound = await service.getQuote(quote.quoteId, workspaceId);
      const boundTaskId = bound?.taskId;
      assert.ok(boundTaskId);
      for (const [index, result] of confirms.entries()) {
        if (taskIds[index] === boundTaskId) {
          assert.equal(result.status, 'fulfilled');
        } else {
          assert.ok(
            result.status === 'rejected' &&
              result.reason instanceof P1DomainError &&
              result.reason.code === 'IDEMPOTENCY_CONFLICT',
          );
        }
      }

      const reservations = await Promise.all(
        Array.from({ length: 12 }, () =>
          new DurableProductBillingService(repository).beforeSubmit({
            quoteId: quote.quoteId,
            quoteRevision: quote.revision,
            resource: 'video',
            taskId: boundTaskId,
            workspaceId,
          }),
        ),
      );
      assert.equal(reservations.length, 12);
      const usageRows = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM p1_product_billing_usage
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, boundTaskId],
      );
      assert.equal(usageRows.rows[0]?.count, 1);
      assert.equal(
        (await service.getQuote(quote.quoteId, workspaceId))?.taskId,
        boundTaskId,
      );
    });

    it('claims one durable merchant execution per reserved task and replays its result', async () => {
      const workspaceId = workspace();
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote(
        quoteInput(workspaceId, 'merchant-execution-quote'),
      );
      await service.confirm({
        quoteId: quote.quoteId,
        taskId: 'merchant-execution-task',
        workspaceId,
      });
      await service.beforeSubmit({
        quoteRevision: quote.revision,
        resource: 'video',
        taskId: 'merchant-execution-task',
        workspaceId,
      });
      const contract = {
        catalogModelId: 'video-model',
        effectKey: 'merchant-execution:merchant-execution-task',
        operation: 'video.generate',
        outputCount: 1,
        inputAssetsHash: quote.submissionInputAssetsHash!,
        inputSnapshot: { input: { durationSeconds: 10 }, prompt: 'merchant prompt' },
        promptHash: quote.submissionPromptHash!,
        providerCatalogModelId: 'video-model',
        providerOperation: 'video.generate',
        quoteRevision: quote.revision,
        referenceAssetsHash: quote.submissionReferenceAssetsHash!,
        submissionContractHash: quote.submissionContractHash!,
        submissionInputAssetsHash: quote.submissionInputAssetsHash!,
        submissionPromptHash: quote.submissionPromptHash!,
        submissionReferenceAssetsHash: quote.submissionReferenceAssetsHash!,
        targetSeconds: 10,
        taskId: 'merchant-execution-task',
        workspaceId,
      };

      await assert.rejects(
        service.claimMerchantExecution({
          ...contract,
          idempotencyKey: 'merchant-forged-first-prompt',
          promptHash: 'forged-first-prompt-hash',
        }),
        /exact provider input|exactly match/i,
      );
      await service.bindMerchantExecutionInput({
        inputSnapshot: contract.inputSnapshot,
        quoteRevision: quote.revision,
        taskId: contract.taskId,
        workspaceId,
      });
      const bound = await repository.getMerchantExecution(
        workspaceId,
        contract.taskId,
        contract.effectKey,
      );
      assert.equal(bound?.status, 'bound');
      assert.deepEqual(bound?.inputSnapshot, contract.inputSnapshot);
      await assert.rejects(
        service.bindMerchantExecutionInput({
          inputSnapshot: {
            input: contract.inputSnapshot.input,
            prompt: 'drifted provider prompt',
          },
          quoteRevision: quote.revision,
          taskId: contract.taskId,
          workspaceId,
        }),
        /already bound to another provider submission/i,
      );

      const claims = await Promise.allSettled([
        new DurableProductBillingService(repository).claimMerchantExecution({
          ...contract,
          idempotencyKey: 'merchant-command-a',
        }),
        new DurableProductBillingService(repository).claimMerchantExecution({
          ...contract,
          idempotencyKey: 'merchant-command-b',
        }),
      ]);
      assert.equal(
        claims.filter((claim) => claim.status === 'fulfilled').length,
        1,
      );
      const winner = claims[0]?.status === 'fulfilled'
        ? 'merchant-command-a'
        : 'merchant-command-b';
      const inProgress = await service.claimMerchantExecution({
        ...contract,
        idempotencyKey: winner,
      });
      assert.deepEqual(inProgress, { decision: 'in_progress' });
      await pool.query(
        `UPDATE p1_product_billing_merchant_executions
            SET updated_at = now() - interval '2 minutes'
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, contract.taskId],
      );
      const recoveredClaim = await service.claimMerchantExecution({
        ...contract,
        idempotencyKey: winner,
      });
      assert.deepEqual(recoveredClaim, {
        decision: 'execute',
        inputSnapshot: contract.inputSnapshot,
      });
      const original = { jobId: 'job-durable', status: 'completed' };
      await service.completeMerchantExecution({
        ...contract,
        idempotencyKey: winner,
        result: original,
      });
      const replay = await new DurableProductBillingService(
        repository,
      ).claimMerchantExecution<typeof original>({
        ...contract,
        idempotencyKey: winner,
      });
      assert.deepEqual(replay, { decision: 'replay', result: original });
      const auxiliaryInputSnapshot = {
        input: { referenceAssetIds: ['asset-1'] },
        prompt: 'Read visible text.',
      };
      const auxiliary = await service.claimMerchantExecution({
        ...contract,
        ...merchantExecutionInputHashes(auxiliaryInputSnapshot),
        effectKey: 'merchant-execution:merchant-execution-task:exact-text',
        idempotencyKey:
          'merchant-execution:merchant-execution-task:exact-text',
        inputSnapshot: auxiliaryInputSnapshot,
        providerCatalogModelId: 'video-model',
        providerOperation: 'text.respond',
      });
      assert.deepEqual(auxiliary, {
        decision: 'execute',
        inputSnapshot: {
          input: { referenceAssetIds: ['asset-1'] },
          prompt: 'Read visible text.',
        },
      });
      await assert.rejects(
        service.claimMerchantExecution({
          ...contract,
          idempotencyKey: winner,
          outputCount: 2,
        }),
        /another merchant execution|exact provider input|exactly match/i,
      );
      await assert.rejects(
        service.claimMerchantExecution({
          ...contract,
          idempotencyKey: winner,
          promptHash: 'prompt-hash-drifted-before-replay',
        }),
        /another merchant execution|exact provider input|exactly match/i,
      );
      await service.settle({ quoteId: quote.quoteId, workspaceId });
      await service.bindMerchantExecutionInput({
        inputSnapshot: contract.inputSnapshot,
        quoteRevision: quote.revision,
        taskId: contract.taskId,
        workspaceId,
      });
      assert.deepEqual(
        await service.claimMerchantExecution<typeof original>({
          ...contract,
          idempotencyKey: winner,
        }),
        { decision: 'replay', result: original },
      );
    });

    it('rejects an expired merchant claim after its credit reservation is released', async () => {
      const workspaceId = workspace();
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote(
        quoteInput(workspaceId, 'expired-merchant-execution-quote'),
      );
      const taskId = 'expired-merchant-execution-task';
      await service.confirm({ quoteId: quote.quoteId, taskId, workspaceId });
      await service.beforeSubmit({
        quoteRevision: quote.revision,
        resource: 'video',
        taskId,
        workspaceId,
      });
      const effectKey = `merchant-execution:${taskId}:provider-attempt`;
      const claim = {
        catalogModelId: 'video-model',
        effectKey,
        idempotencyKey: effectKey,
        inputAssetsHash: quote.submissionInputAssetsHash!,
        inputSnapshot: {
          input: { durationSeconds: 10 },
          prompt: 'merchant prompt',
        },
        operation: 'video.generate',
        outputCount: 1,
        promptHash: quote.submissionPromptHash!,
        providerCatalogModelId: 'video-model',
        providerOperation: 'video.generate',
        quoteRevision: quote.revision,
        referenceAssetsHash: quote.submissionReferenceAssetsHash!,
        submissionContractHash: quote.submissionContractHash!,
        submissionInputAssetsHash: quote.submissionInputAssetsHash!,
        submissionPromptHash: quote.submissionPromptHash!,
        submissionReferenceAssetsHash: quote.submissionReferenceAssetsHash!,
        targetSeconds: 10,
        taskId,
        workspaceId,
      };

      assert.equal(
        (await service.claimMerchantExecution(claim)).decision,
        'execute',
      );
      await service.failAndRefund({
        forceCreditRefund: true,
        quoteId: quote.quoteId,
        workspaceId,
      });
      await pool.query(
        `UPDATE p1_product_billing_merchant_executions
            SET updated_at = now() - interval '2 minutes'
          WHERE workspace_id = $1 AND task_id = $2 AND effect_key = $3`,
        [workspaceId, taskId, effectKey],
      );

      await assert.rejects(
        service.claimMerchantExecution(claim),
        /reserved credit quote contract/i,
      );
    });

    it('promotes only one completed auxiliary merchant effect into the canonical task result', async () => {
      const workspaceId = workspace();
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote(
        quoteInput(workspaceId, 'merchant-execution-promotion'),
      );
      const taskId = 'merchant-execution-promotion-task';
      await service.confirm({ quoteId: quote.quoteId, taskId, workspaceId });
      await service.beforeSubmit({
        quoteRevision: quote.revision,
        resource: 'video',
        taskId,
        workspaceId,
      });
      const reserved = await service.readMerchantExecutionContract({
        taskId,
        workspaceId,
      });
      const completeAuxiliary = async (suffix: string) => {
        const effectKey = `merchant-execution:${taskId}:${suffix}`;
        const inputSnapshot = {
          input: { durationSeconds: 10 },
          prompt: `provider prompt ${suffix}`,
        };
        const claim = {
          ...reserved,
          ...merchantExecutionInputHashes(inputSnapshot),
          effectKey,
          idempotencyKey: effectKey,
          inputSnapshot,
          providerCatalogModelId: reserved.catalogModelId,
          providerOperation: reserved.operation,
          taskId,
          workspaceId,
        };
        assert.equal(
          (await service.claimMerchantExecution(claim)).decision,
          'execute',
        );
        const result = { jobId: `job-${suffix}`, status: 'completed' };
        await service.completeMerchantExecution({ ...claim, result });
        return { effectKey, inputSnapshot, result };
      };
      const selected = await completeAuxiliary('selected');
      const competing = await completeAuxiliary('competing');

      const promotions = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          new DurableProductBillingService(repository).promoteMerchantExecution({
            quoteRevision: quote.revision,
            sourceEffectKey: selected.effectKey,
            taskId,
            workspaceId,
          }),
        ),
      );
      assert.equal(
        promotions.every(({ status }) => status === 'fulfilled'),
        true,
      );
      const canonical = await repository.getMerchantExecution(
        workspaceId,
        taskId,
        `merchant-execution:${taskId}`,
      );
      assert.equal(canonical?.status, 'completed');
      assert.equal(
        canonical?.idempotencyKey,
        `merchant-execution-promotion:${selected.effectKey}`,
      );
      assert.deepEqual(canonical?.inputSnapshot, selected.inputSnapshot);
      assert.deepEqual(canonical?.result, selected.result);
      await assert.rejects(
        service.promoteMerchantExecution({
          quoteRevision: quote.revision,
          sourceEffectKey: competing.effectKey,
          taskId,
          workspaceId,
        }),
        /another canonical merchant execution/i,
      );

      await service.settle({ quoteId: quote.quoteId, workspaceId });
      await service.promoteMerchantExecution({
        quoteRevision: quote.revision,
        sourceEffectKey: selected.effectKey,
        taskId,
        workspaceId,
      });
    });

    it('binds a server-derived first submission to a reserved quote exactly once', async () => {
      const workspaceId = workspace();
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote({
        ...quoteInput(workspaceId, 'server-bound-submission-quote'),
        submissionInputAssetsHash: undefined,
        submissionPromptHash: undefined,
        submissionReferenceAssetsHash: undefined,
      });
      await service.confirm({
        quoteId: quote.quoteId,
        taskId: 'server-bound-submission-task',
        workspaceId,
      });
      await service.beforeSubmit({
        quoteRevision: quote.revision,
        resource: 'video',
        taskId: 'server-bound-submission-task',
        workspaceId,
      });

      await assert.rejects(
        service.readMerchantExecutionContract({
          taskId: 'server-bound-submission-task',
          workspaceId,
        }),
        /complete reserved credit quote contract/i,
      );
      await service.bindMerchantSubmissionInput({
        inputSnapshot: {
          input: { durationSeconds: 10, referenceAssetIds: ['asset-b', 'asset-a'] },
          prompt: 'server authoritative video prompt',
        },
        quoteRevision: quote.revision,
        taskId: 'server-bound-submission-task',
        workspaceId,
      });
      const bound = await service.readMerchantExecutionContract({
        taskId: 'server-bound-submission-task',
        workspaceId,
      });
      assert.ok(bound.submissionPromptHash);
      assert.ok(bound.submissionReferenceAssetsHash);
      assert.ok(bound.submissionInputAssetsHash);
      await assert.rejects(
        service.bindMerchantSubmissionInput({
          inputSnapshot: { input: { durationSeconds: 10 }, prompt: 'drifted prompt' },
          quoteRevision: quote.revision,
          taskId: 'server-bound-submission-task',
          workspaceId,
        }),
        /already bound to another submission/i,
      );
      const providerInput = {
        input: { durationSeconds: 10, resolvedAssetIds: ['provider-asset-1'] },
        prompt: 'canonical provider prompt compiled after admission',
      };
      await service.bindMerchantExecutionInput({
        inputSnapshot: providerInput,
        quoteRevision: quote.revision,
        taskId: 'server-bound-submission-task',
        workspaceId,
      });
      assert.deepEqual(
        (
          await repository.getMerchantExecution(
            workspaceId,
            'server-bound-submission-task',
            'merchant-execution:server-bound-submission-task',
          )
        )?.inputSnapshot,
        providerInput,
      );
    });

    it('binds the real Composer quote to its server submission before delivering every image', async () => {
      const workspaceId = workspace();
      const composerQuote = await buildComposerImageSetQuote();
      const authority = new CatalogProductQuoteAuthority({
        async getCatalog() {
          return {
            models: [
              {
                creditPricing: {
                  'image.generate': {
                    creditCost: 5,
                    failureRefundsCredits: true,
                  },
                },
                id: 'seedream-5-pro',
              },
            ],
            revisionId: 'catalog-composer-r1',
          };
        },
      });
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote(
        await authority.resolve({ ...composerQuote, workspaceId }),
      );
      assert.equal(quote.submissionInputAssetsHash, undefined);
      assert.equal(quote.submissionPromptHash, undefined);
      assert.equal(quote.submissionReferenceAssetsHash, undefined);

      const operationsRepository = new MemoryOperationsRepository();
      operationsRepository.grantMembership('owner-a', workspaceId);
      const supplyResults = new Map<string, Awaited<ReturnType<ModelSupplyApplicationService['submit']>>>();
      let providerOutputCount: number | undefined;
      let providerRequest: ProviderExecutionRequest | undefined;
      const supply = new ModelSupplyApplicationService({
        assetStorage: new MemoryModelAssetStorage(),
        deployments: createDefaultDeployments({
          activatedDeploymentIds: ['seedream-5-pro-direct'],
          activationEvidenceStatus: 'recorded',
        }),
        execution: {
          async execute(request) {
            providerRequest = structuredClone(request);
            providerOutputCount = request.submission.outputCount;
            return {
              assets: [
                {
                  bytes: Uint8Array.from([1, 2, 3]),
                  contentType: 'image/png' as const,
                },
                {
                  bytes: Uint8Array.from([4, 5, 6]),
                  contentType: 'image/png' as const,
                },
              ],
              kind: 'completed' as const,
              providerCost: {
                amount: 0.2,
                currency: 'CNY' as const,
                usage: { mediaUnits: 2 },
              },
            };
          },
        },
        merchantExecutionBilling: service,
        models: createDefaultCatalogModels(),
        resultSink: {
          async saveResult(_workspaceId, result) {
            supplyResults.set(result.jobId, result);
          },
        },
      });
      const controlPlane = {
        async getCatalog() {
          return {
            models: [
              {
                activationEvidence: { status: 'live_verified' as const },
                availability: 'available' as const,
                id: quote.catalogModelId,
              },
            ],
            revisionId: quote.catalogModelRevision,
          };
        },
        async getJob(_workspaceId: string, jobId: string) {
          const result = supplyResults.get(jobId);
          if (!result) throw new Error(`missing Model Supply result ${jobId}`);
          return { result, status: 'completed' as const };
        },
        async submitGeneration(
          context: { userId: string; workspaceId: string },
          submission: Parameters<ModelSupplyApplicationService['submit']>[0],
          idempotencyKey: string,
        ) {
          return supply.submit({
            ...submission,
            actorId: context.userId,
            idempotencyKey,
            workspaceId: context.workspaceId,
          });
        },
      } as unknown as ModelSupplyControlPlaneService;
      const operations = new OperationsApplicationService(operationsRepository, {
        billingLifecycle: service,
        canvasExporter: { async export() { throw new Error('not used'); } },
        creationExecutor: new ModelSupplyCreationExecutor(
          controlPlane,
          undefined,
        ),
        groundingResolver: {
          async resolve() {
            return {
              snapshot: {
                assets: [],
                capturedAt: '2026-08-01T00:00:00.000Z',
                store: {
                  address: '88 号',
                  booking: '提前预约',
                  brandVoice: '真诚、不夸张',
                  city: '成都',
                  confirmedAt: '2026-08-01T00:00:00.000Z',
                  district: '锦江区',
                  name: '春日美甲',
                  prohibitions: ['不得编造价格'],
                  projects: [
                    {
                      durationMinutes: 90,
                      id: 'project-a',
                      name: '纯色美甲',
                      price: 168,
                    },
                  ],
                  regulated: false,
                },
              },
              status: 'ready' as const,
            };
          },
        },
        imageGenerator: { async submit() { throw new Error('not used'); } },
        notifier: { async send() {} },
      });
      const context = {
        actor: 'owner' as const,
        correlationId: 'composer-credit-image-set',
        userId: 'owner-a',
        workspaceId,
      };
      const work = await operations.createCreativeWork(context, {
        autoConfirmBrief: true,
        intent: '生成两张门店项目主图',
        mode: 'direct',
        operation: 'image.generate',
        sessionId: 'composer-credit-image-set',
        sourceReferences: [],
      });
      const acceptedQuote = await service.confirm({
        quoteId: quote.quoteId,
        taskId: work.id,
        workspaceId,
      });
      const {
        catalogModelRevision,
        confirmedAmount,
        outputCount,
        outputLabel,
      } = acceptedQuote;
      const currency = acceptedQuote.formula.currency;
      assert.ok(catalogModelRevision);
      assert.notEqual(confirmedAmount, undefined);
      assert.notEqual(outputCount, undefined);
      assert.ok(outputLabel);
      assert.ok(currency);
      await service.beforeSubmit({
        quoteId: quote.quoteId,
        quoteRevision: quote.revision,
        resource: 'image',
        taskId: work.id,
        workspaceId,
      });
      await service.bindMerchantSubmissionInput({
        inputSnapshot: {
          input: null,
          prompt: 'Coordinator immutable Composer submission root.',
        },
        quoteRevision: quote.revision,
        taskId: work.id,
        workspaceId,
      });
      const result = await operations.submitCreativeWork(
        context,
        work.id,
        {
          aigcLabelEnabled: true,
          aspectRatio: '3:4',
          catalogModelId: quote.catalogModelId,
          catalogRevision: catalogModelRevision,
          currency,
          dataClass: [],
          estimatedAmount: confirmedAmount!,
          operation: 'image.generate',
          outputCount: outputCount!,
          outputLabel,
          quoteAcceptedAt: '2026-08-01T00:00:00.000Z',
          quoteRevision: quote.revision,
          watermarkEnabled: false,
        },
        'composer-credit-image-set-submit',
        undefined,
        undefined,
        undefined,
        undefined,
        quote.quoteId,
      );

      assert.equal(providerOutputCount, quote.outputCount);
      const executedProviderRequest = providerRequest;
      assert.ok(executedProviderRequest);
      assert.deepEqual(executedProviderRequest.submission.input, {
        height: 2048,
        width: 1536,
      });
      assert.notEqual(
        executedProviderRequest.submission.prompt,
        work.intent,
      );
      assert.match(executedProviderRequest.submission.prompt, /春日美甲/);
      assert.match(executedProviderRequest.submission.prompt, /纯色美甲/);
      assert.match(executedProviderRequest.submission.prompt, /168/);
      assert.equal(result.assets.length, quote.outputCount);
      assert.equal(result.job.outputAssetIds.length, quote.outputCount);
      assert.deepEqual(
        (
          await repository.getMerchantExecution(
            workspaceId,
            work.id,
            `merchant-execution:${work.id}`,
          )
        )?.inputSnapshot,
        {
          input: executedProviderRequest.submission.input,
          prompt: executedProviderRequest.submission.prompt,
        },
      );
      const boundQuote = await service.getQuote(quote.quoteId, workspaceId);
      assert.ok(boundQuote?.submissionPromptHash);
      assert.ok(boundQuote?.submissionReferenceAssetsHash);
      assert.ok(boundQuote?.submissionInputAssetsHash);
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

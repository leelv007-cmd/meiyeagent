import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import {
  OperationsApplicationService,
  OperationsVideoContentPackageAdapter,
  PostgresOperationsRepository,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from '../operations/index.js';
import { DurableProductBillingService } from '../product-billing/durable-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import type {
  VideoContentPackageConfirmation,
  VideoContentPackageOutcome,
} from '../video-content-package-port.js';
import { PostgresVideoRegenerationRepository } from './video-regeneration-postgres.js';
import {
  createVideoRegenerationTerminalObserver,
} from './video-regeneration-runtime.js';
import type { DurableVideoWorkflow } from './video-workflow-contract.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  'Postgres video regeneration terminal replay',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `video-replay-${randomUUID()}`;
    const actorId = `video-owner-${randomUUID()}`;
    const workflowId = `video-workflow-${randomUUID()}`;

    before(async () => {
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
          workspace_id text NOT NULL,
          user_id text NOT NULL,
          role text NOT NULL DEFAULT 'owner',
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, user_id)
        );
      `);
      await new PostgresProductBillingRepository(pool).migrate();
      await new PostgresVideoRegenerationRepository(pool).migrate();
      await new PostgresOperationsRepository(pool).migrate();
      await pool.query(
        `INSERT INTO "user" (id, name, email)
         VALUES ($1, 'Video replay owner', $2)`,
        [actorId, `${actorId}@example.test`],
      );
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Video replay workspace')`,
        [workspaceId],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id)
         VALUES ($1, $2)`,
        [workspaceId, actorId],
      );
    });

    after(async () => {
      for (const table of [
        'p1_operations_audit_events',
        'p1_content_packages',
        'model_video_regeneration_free_actions',
        'model_video_regeneration_tasks',
        'model_video_regeneration_quotes',
        'p1_product_billing_provider_costs',
        'p1_product_billing_usage',
        'p1_product_billing_quotes',
      ]) {
        await pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [
          workspaceId,
        ]);
      }
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [actorId]);
      await pool.end();
    });

    it('persists one billing settlement and one delivery revision after process restart replay', async () => {
      const billingRepository = new PostgresProductBillingRepository(pool);
      const regenerationRepository = new PostgresVideoRegenerationRepository(pool);
      const firstBillingProcess = new DurableProductBillingService(
        billingRepository,
        () => new Date('2026-07-20T12:00:00.000Z'),
      );
      const quote = await firstBillingProcess.buildQuote({
        billingMode: 'per_output_second',
        catalogModelId: 'seedance-2',
        frozenCandidateDeploymentIds: ['deployment-a'],
        quoteId: 'quote-replay',
        quotePolicyRevision: 'regen-policy-1',
        targetSeconds: 10,
        unitRate: 1,
        workspaceId,
      });
      await firstBillingProcess.confirm({
        quoteId: quote.quoteId,
        taskId: workflowId,
        workspaceId,
      });
      await firstBillingProcess.beforeSubmit({
        quoteId: quote.quoteId,
        quoteRevision: quote.revision,
        resource: 'video',
        taskId: workflowId,
        workspaceId,
      });
      await firstBillingProcess.dispatchAttempt({
        attemptId: 'attempt-replay',
        deploymentId: 'deployment-a',
        providerCost: {
          currency: 'CNY',
          estimatedCostMicros: 100_000,
          evidenceKind: 'estimated',
          supplierPriceRevision: 'supplier-price-1',
          unit: 'second',
          unitPriceMicros: 10_000,
        },
        taskId: workflowId,
        workspaceId,
      });
      await regenerationRepository.saveQuoteBinding({
        actorId,
        createdAt: '2026-07-20T12:00:00.000Z',
        quoteId: quote.quoteId,
        scope: 'full_compose',
        sourceRunId: 'source-run',
        targetSeconds: 10,
        workspaceId,
      });
      await regenerationRepository.saveTaskBinding({
        actorId,
        createdAt: '2026-07-20T12:00:00.000Z',
        quoteId: quote.quoteId,
        scope: 'full_compose',
        sourceRunId: 'source-run',
        taskId: workflowId,
        workspaceId,
      });
      const terminalWorkflow = {
        actorId,
        attempts: [
          {
            acceptance: 'accepted',
            catalogModelId: 'seedance-2',
            createdAt: '2026-07-20T12:00:00.000Z',
            deploymentId: 'deployment-a',
            id: 'attempt-replay',
            jobId: 'job-replay',
            status: 'completed',
          },
        ],
        catalogModelId: 'seedance-2',
        clipAssets: [],
        composedAsset: {
          compositionEvidence: {},
          contentType: 'video/mp4',
          createdAt: '2026-07-20T12:00:01.000Z',
          dataClass: [],
          id: 'composed-replay',
          objectKey: `${workspaceId}/composed-replay.mp4`,
          sha256: 'a'.repeat(64),
          sizeBytes: 8,
          technicalValidation: {
            durationSeconds: 6,
            evidenceKind: 'measured',
            playable: true,
          },
          workspaceId,
        },
        confirmed: true,
        createdAt: '2026-07-20T12:00:00.000Z',
        dataClass: [],
        id: workflowId,
        revision: 3,
        shots: [],
        status: 'completed',
        storyboardRevision: 'storyboard-1',
        storyboardVersion: 1,
        updatedAt: '2026-07-20T12:00:02.000Z',
        workspaceId,
      } as unknown as DurableVideoWorkflow;

      await createVideoRegenerationTerminalObserver({
        billing: firstBillingProcess,
        repository: regenerationRepository,
      }).settle(terminalWorkflow);
      const firstUsage = await firstBillingProcess.getUsage(
        workflowId,
        workspaceId,
      );
      const restartedBillingProcess = new DurableProductBillingService(
        new PostgresProductBillingRepository(pool),
        () => new Date('2026-07-20T12:01:00.000Z'),
      );
      await createVideoRegenerationTerminalObserver({
        billing: restartedBillingProcess,
        repository: new PostgresVideoRegenerationRepository(pool),
      }).settle(terminalWorkflow);
      const replayedUsage = await restartedBillingProcess.getUsage(
        workflowId,
        workspaceId,
      );

      assert.deepEqual(replayedUsage, firstUsage);
      assert.equal(replayedUsage?.settledQuantity, 6);
      const billingRows = await pool.query<{
        costs: string;
        quotes: string;
        usage: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM p1_product_billing_quotes
             WHERE workspace_id = $1 AND task_id = $2) AS quotes,
           (SELECT count(*)::text FROM p1_product_billing_usage
             WHERE workspace_id = $1 AND task_id = $2) AS usage,
           (SELECT count(*)::text FROM p1_product_billing_provider_costs
             WHERE workspace_id = $1 AND task_id = $2) AS costs`,
        [workspaceId, workflowId],
      );
      assert.deepEqual(billingRows.rows[0], {
        costs: '1',
        quotes: '1',
        usage: '1',
      });

      const confirmation: VideoContentPackageConfirmation = {
        actorId,
        aigcLabelEnabled: true,
        catalogModelId: 'seedance-2',
        dataClass: [],
        executionContract: {
          aigcLabelEnabled: true,
          aspectRatio: '9:16',
          catalogModelId: 'seedance-2',
          catalogRevision: 'catalog-1',
          currency: 'CNY',
          dataClass: [],
          durationSeconds: 6,
          estimatedAmount: 10,
          operation: 'video.generate',
          outputCount: 1,
          outputLabel: '6 second composed video',
          quoteAcceptedAt: '2026-07-20T12:00:00.000Z',
          quoteRevision: 'quote-replay',
          watermarkEnabled: false,
        },
        referenceAssetIds: [],
        shots: [{ id: 'opening', prompt: 'Store opening' }],
        storyboardRevision: 'storyboard-1',
        storyboardVersion: 1,
        workflowId,
        workspaceId,
      };
      const completed: VideoContentPackageOutcome = {
        actorId,
        clipAssetIds: ['clip-opening'],
        composedAsset: {
          compositionEvidence: {
            aigc: {
              implicitMetadata: {
                actual: true,
                contentId: workflowId,
                contentType: 'ai_generated',
                serviceCode: 'ffmpeg-compose-v1',
                serviceProvider: 'meiye-content-workflow',
                validated: true,
              },
              requested: true,
              validationMethod: 'ffprobe_metadata',
              visibleLabel: {
                actual: true,
                validated: true,
                value: '内容由 AI 生成',
              },
            },
            brandWatermark: {
              actual: false,
              requested: false,
              validated: true,
              validationMethod: 'recorded_synthetic',
            },
            clipCount: 1,
            delivery: {
              compositionRevision: 'composition-storyboard-1',
              storyboardRevision: 'storyboard-1',
              workflowId,
              outputVideoSha256: 'a'.repeat(64),
              cover: {
                id: 'cover-replay',
                objectKey: `${workspaceId}/owned/${'b'.repeat(64)}.jpg`,
                sha256: 'b'.repeat(64),
                sizeBytes: 4,
                contentType: 'image/jpeg',
                validationMethod: 'recorded_synthetic',
              },
              subtitles: {
                durationSeconds: 6,
                format: 'srt',
                text: '1\n00:00:00,000 --> 00:00:06,000\nStore opening\n',
                validationMethod: 'composition_manifest',
              },
            },
            durationSeconds: 6,
            outputSha256: 'a'.repeat(64),
            outputSizeBytes: 8,
            rendererRevision: 'renderer-1',
            sourceAssetIds: ['clip-opening'],
          },
          contentType: 'video/mp4',
          id: 'composed-replay',
          objectKey: `${workspaceId}/composed-replay.mp4`,
          sha256: 'a'.repeat(64),
          sizeBytes: 8,
        },
        providerAttempts: [],
        providerCosts: [],
        routeSnapshot: {
          actualCatalogModelId: 'seedance-2',
          candidateCatalogModelIds: ['seedance-2'],
          catalogRevisionId: 'catalog-1',
          createdAt: '2026-07-20T12:00:00.000Z',
          dataClass: [],
          deploymentId: 'deployment-a',
          id: 'route-replay',
          reason: 'fixed_selection',
          requestedSelection: {
            catalogModelId: 'seedance-2',
            mode: 'fixed',
          },
        },
        shots: confirmation.shots,
        status: 'completed',
        storyboardRevision: confirmation.storyboardRevision,
        workflowId,
        workspaceId,
      };
      const firstOperationsProcess = new OperationsApplicationService(
        new PostgresOperationsRepository(pool),
        {
          canvasExporter: new RecordedCanvasExportAdapter(),
          imageGenerator: new RecordedImageGenerationAdapter(),
          notifier: { async send() {} },
          clock: () => new Date('2026-07-20T12:00:03.000Z'),
        },
      );
      const firstDelivery = new OperationsVideoContentPackageAdapter(
        () => firstOperationsProcess,
      );
      await firstDelivery.confirm(confirmation);
      await firstDelivery.reconcile(completed);
      const firstPackage = (
        await firstOperationsProcess.listContentPackages({
          actor: 'owner',
          correlationId: 'delivery-first-read',
          userId: actorId,
          workspaceId,
        })
      )[0];

      const restartedOperationsProcess = new OperationsApplicationService(
        new PostgresOperationsRepository(pool),
        {
          canvasExporter: new RecordedCanvasExportAdapter(),
          imageGenerator: new RecordedImageGenerationAdapter(),
          notifier: { async send() {} },
          clock: () => new Date('2026-07-20T12:01:03.000Z'),
        },
      );
      const replayDelivery = new OperationsVideoContentPackageAdapter(
        () => restartedOperationsProcess,
      );
      await replayDelivery.confirm(confirmation);
      await replayDelivery.reconcile(completed);
      const replayedPackage = (
        await restartedOperationsProcess.listContentPackages({
          actor: 'owner',
          correlationId: 'delivery-replay-read',
          userId: actorId,
          workspaceId,
        })
      )[0];

      assert.deepEqual(replayedPackage, firstPackage);
      assert.equal(replayedPackage?.versions.length, 1);
      const deliveryRows = await pool.query<{
        count: string;
        revision: string;
      }>(
        `SELECT count(*)::text AS count, max(revision)::text AS revision
           FROM p1_content_packages
          WHERE workspace_id = $1
            AND payload->'source'->>'workflowId' = $2`,
        [workspaceId, workflowId],
      );
      assert.equal(deliveryRows.rows[0]?.count, '1');
      assert.equal(
        deliveryRows.rows[0]?.revision,
        String(firstPackage?.revision),
      );
    });
  },
);

import { shutdownLangfuseTracing } from '../instrumentation.js';

import { DBOS } from '@dbos-inc/dbos-sdk';
import { hostname } from 'node:os';
import {
  CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND,
  CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND,
  CreditSubscriptionCycleScheduler,
  createCreditSubscriptionCycleJobHandler,
  createCreditSubscriptionReconciliationJobHandler,
  registerCreditSubscriptionSchedules,
} from '../p1/credit-billing/credit-subscription-scheduler.js';
import {
  REDEMPTION_EXPIRY_JOB_KIND,
  RedemptionExpiryRunner,
  createRedemptionExpiryJobHandler,
  registerRedemptionExpirySchedule,
} from '../p1/foundation/redemption-expiry-scheduler.js';
import { DailyRecommendationDeliveryPort } from '../p1/due-delivery/delivery-port.js';
import {
  PostgresWorkspaceOwnerMembershipReader,
  ProductionDueDeliveryEligibility,
} from '../p1/due-delivery/eligibility.js';
import {
  DUE_DELIVERY_SCANNER_JOB_KIND,
  DueDeliveryScannerRunner,
  createDueDeliveryScannerJobHandler,
  registerDueDeliveryScannerSchedule,
} from '../p1/due-delivery/scanner-job.js';
import { DueDeliveryWorker } from '../p1/due-delivery/worker.js';
import {
  FEISHU_INTENT_RECONCILIATION_JOB_KIND,
  FEISHU_TOOL_LIFECYCLE_JOB_KIND,
  FeishuIntentReconciliationBatchRunner,
  createFeishuIntentReconciliationJobHandler,
  createFeishuToolLifecycleJobHandler,
} from '../p1/integrations/index.js';
import {
  DurableTracerWorker,
  P1JobWorkerEntrypoint,
  RecordedProductTracerEffect,
  WorkerOperationalTelemetry,
  resolveWorkerId,
} from '../p1/job-runtime/index.js';
import {
  MODEL_MEDIA_GENERATION_JOB_KIND,
  ModelMediaGenerationEffect,
  createMediaGenerationJobHandler,
} from '../p1/model-supply/index.js';
import {
  FoundationOwnedAssetReferenceVerifier,
  S3AssetRegistrationCleanupRunner,
  S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND,
  createS3AssetRegistrationCleanupJobHandler,
  registerS3AssetRegistrationCleanupSchedule,
} from '../p1/model-supply/owned-asset-registration-cleanup.js';
import { PostgresOwnedAssetCleanupClaimCoordinator } from '../p1/model-supply/postgres-owned-asset-cleanup-claim.js';
import { LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY } from '../p1/model-supply/reference-asset-delivery.js';
import { S3CompatibleAssetStorage } from '../p1/model-supply/s3-asset-storage.js';
import {
  ContentPackageArtifactReferenceVerifier,
  OPERATIONS_TRIGGER_JOB_KIND,
  PARSE_BATCH_JOB_KIND,
  ParseBatchJobEffect,
  createOperationsTriggerJobHandler,
} from '../p1/operations/index.js';

import { assembleCoreGraph } from './core-assembly.js';

export async function startWorker(env: NodeJS.ProcessEnv) {
  const {
    pool,
    assetStorage,
    foundationRepository,
    operationsRepository,
    tracerJobRepository,
    parseService,
    gatedMediaExecution,
    modelRuntime,
    p1ModelSupplyService,
    referenceAssets,
    creditSubscriptionStore,
    creditLedger,
    creditPlanCatalog,
    redemptionStore,
    notifier,
    dueDeliveryRepository,
    harnessSchemaStore,
    notificationWebhook,
    jobRuntime,
    integrationService,
    integrationRepository,
    operationsService,
    operationalTelemetryStore,
    harnessRuntimeConfig,
  } = await assembleCoreGraph(env, { role: 'worker' });
  const foundationAssetReferences = new FoundationOwnedAssetReferenceVerifier(
    foundationRepository
  );
  const contentPackageArtifactReferences =
    new ContentPackageArtifactReferenceVerifier(operationsRepository);
  const assetRegistrationReferences = {
    async isReferenced(
      input: Parameters<
        FoundationOwnedAssetReferenceVerifier['isReferenced']
      >[0]
    ) {
      return (
        (await foundationAssetReferences.isReferenced(input)) ||
        (await contentPackageArtifactReferences.isReferenced(input))
      );
    },
  };
  const assetRegistrationCleanup =
    assetStorage instanceof S3CompatibleAssetStorage
      ? new S3AssetRegistrationCleanupRunner(
          assetStorage,
          assetRegistrationReferences,
          new PostgresOwnedAssetCleanupClaimCoordinator(
            pool,
            assetStorage,
            assetRegistrationReferences
          )
        )
      : undefined;
  const dueRecommendationBase = harnessSchemaStore;
  const tracer = new DurableTracerWorker(
    tracerJobRepository,
    new RecordedProductTracerEffect()
  );
  const parseBatchWorker = new DurableTracerWorker(
    tracerJobRepository,
    new ParseBatchJobEffect(parseService)
  );
  const mediaGenerationWorker = gatedMediaExecution
    ? new DurableTracerWorker(
        tracerJobRepository,
        new ModelMediaGenerationEffect({
          models: p1ModelSupplyService,
          provider: gatedMediaExecution,
          ...(modelRuntime.mode === 'fixture'
            ? { referencePolicy: LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY }
            : {}),
          referenceAssets,
        })
      )
    : undefined;

  const workerId = resolveWorkerId(
    env.P1_JOB_WORKER_ID,
    `${hostname()}:${process.pid}`
  );
  const creditSubscriptionScheduler = new CreditSubscriptionCycleScheduler(
    creditSubscriptionStore,
    creditLedger,
    {
      planFor: (tier) => creditPlanCatalog.planFor(tier),
      alerts: {
        async notify(alert) {
          await notifier.notify({
            workspaceId: alert.workspaceId,
            jobId: `credit-subscription:${alert.subscriptionId}:${alert.cycleIndex}`,
            status: 'needs_action',
            message: 'Paid subscription cycle is missing its credit grant.',
            deepLink: '/admin',
            correlationId: `credit-subscription-reconcile:${alert.subscriptionId}:${alert.cycleIndex}`,
            idempotencyKey: `credit-subscription-missing:${alert.subscriptionId}:${alert.cycleIndex}`,
          });
        },
      },
    }
  );
  const dueDeliveryScanner = new DueDeliveryScannerRunner(
    new DueDeliveryWorker(
      dueDeliveryRepository,
      new ProductionDueDeliveryEligibility(
        new PostgresWorkspaceOwnerMembershipReader(pool)
      ),
      new DailyRecommendationDeliveryPort(
        dueRecommendationBase,
        undefined,
        notificationWebhook ? notifier : undefined
      )
    ),
    dueDeliveryRepository
  );
  const redemptionExpiry = new RedemptionExpiryRunner(redemptionStore);
  await registerDueDeliveryScannerSchedule(jobRuntime);
  await registerCreditSubscriptionSchedules(jobRuntime);
  await registerRedemptionExpirySchedule(jobRuntime);
  if (assetRegistrationCleanup) {
    await registerS3AssetRegistrationCleanupSchedule(jobRuntime);
  }
  const worker = new P1JobWorkerEntrypoint(
    jobRuntime,
    {
      [CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND]:
        createCreditSubscriptionCycleJobHandler(creditSubscriptionScheduler),
      [CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND]:
        createCreditSubscriptionReconciliationJobHandler(
          creditSubscriptionScheduler
        ),
      [REDEMPTION_EXPIRY_JOB_KIND]:
        createRedemptionExpiryJobHandler(redemptionExpiry),
      [DUE_DELIVERY_SCANNER_JOB_KIND]: createDueDeliveryScannerJobHandler(
        dueDeliveryScanner,
        workerId
      ),
      [FEISHU_TOOL_LIFECYCLE_JOB_KIND]:
        createFeishuToolLifecycleJobHandler(integrationService),
      [FEISHU_INTENT_RECONCILIATION_JOB_KIND]:
        createFeishuIntentReconciliationJobHandler(
          new FeishuIntentReconciliationBatchRunner(
            integrationRepository,
            integrationService
          )
        ),
      [OPERATIONS_TRIGGER_JOB_KIND]:
        createOperationsTriggerJobHandler(operationsService),
      [PARSE_BATCH_JOB_KIND]: parseBatchWorker.handle.bind(parseBatchWorker),
      ...(assetRegistrationCleanup
        ? {
            [S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND]:
              createS3AssetRegistrationCleanupJobHandler(
                assetRegistrationCleanup
              ),
          }
        : {}),
      ...(mediaGenerationWorker
        ? {
            [MODEL_MEDIA_GENERATION_JOB_KIND]: createMediaGenerationJobHandler(
              mediaGenerationWorker
            ),
          }
        : {}),
      'product.tracer': tracer.handle.bind(tracer),
    },
    {
      runnerEvents: operationalTelemetryStore,
      workerId,
    }
  );
  const workerTelemetry = new WorkerOperationalTelemetry(
    operationalTelemetryStore,
    {
      activeJobs: () => worker.activeJobs,
      sampleIntervalMs: Number(env.P1_WORKER_METRICS_INTERVAL_MS ?? 5_000),
      workerId,
    }
  );
  await worker.start();
  workerTelemetry.start();
  console.log('meiye-core P1 job worker started');

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await worker.stop();
    } finally {
      try {
        await workerTelemetry.stop();
        await jobRuntime.stop({ graceful: true });
        if (harnessRuntimeConfig) await DBOS.shutdown();
        await pool.end();
      } finally {
        await shutdownLangfuseTracing();
      }
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

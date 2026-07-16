import { hostname } from 'node:os';
import { Pool } from 'pg';
import {
  ModeGateExecutionPort,
  ModeGateMediaLifecyclePort,
  PostgresAdminConfigRepository,
  modelRuntimeAssemblyFromSources,
} from './p1/admin-config/index.js';
import { PostgresLegacyInFlightDecisionPort } from './p1/cutover/index.js';
import {
  CompositeProductEntitlementPolicy,
  P1ApplicationService,
  PostgresFoundationRepository,
  ProductEntitlementApplicationService,
} from './p1/foundation/index.js';
import {
  DOUYIN_OAUTH_LIFECYCLE_JOB_KIND,
  DOUYIN_OBSERVE_SYNC_JOB_KIND,
  DOUYIN_PUBLISH_POLLING_JOB_KIND,
  FEISHU_INTENT_RECONCILIATION_JOB_KIND,
  DouyinOAuthLifecycleBatchRunner,
  DouyinObserveSyncBatchRunner,
  DouyinPublishPollingBatchRunner,
  FeishuIntentReconciliationBatchRunner,
  FEISHU_TOOL_LIFECYCLE_JOB_KIND,
  IntegrationApplicationService,
  PostgresIntegrationRepository,
  RecordedDouyinAdapter,
  createDouyinOAuthLifecycleJobHandler,
  createDouyinObserveSyncJobHandler,
  createDouyinPublishPollingJobHandler,
  createFeishuIntentReconciliationJobHandler,
  createFeishuToolLifecycleJobHandler,
  feishuMcpAdapterFromEnv,
  integrationSecretStoreFromEnv,
  providerCredentialEnvFromVault,
} from './p1/integrations/index.js';
import {
  DurableTracerWorker,
  EntitlementAwareJobPort,
  P1JobWorkerEntrypoint,
  PgBossJobPort,
  PostgresOperationalTelemetryStore,
  PostgresTracerJobRepository,
  RecordedProductTracerEffect,
  TracerJobApplicationService,
  WorkerOperationalTelemetry,
} from './p1/job-runtime/index.js';
import {
  COMPOSED_VIDEO_JOB_KIND,
  ComposedVideoJobEffect,
  CanvasTextGenerationOutboxWorker,
  DurableMediaGenerationApplicationService,
  fileSystemAssetStorageFromEnv,
  FoundationModelSupplyLedger,
  ModelSupplyApplicationService,
  ModelSupplyControlPlaneService,
  MediaActivationProbeExecutor,
  PersistentContentWorkflowRunner,
  PostgresDurableVideoWorkflowStore,
  PostgresModelSupplyRepository,
  ProductReferenceAssetResolver,
  RECORDED_CATALOG_REVISION_ID,
  RecordedHumanCalibratedVideoQualityScorer,
  MODEL_MEDIA_GENERATION_JOB_KIND,
  ModelMediaGenerationEffect,
  createComposedVideoJobHandler,
  createMediaGenerationJobHandler,
  modelMediaExecutionMode,
  videoCompositionRuntimeFromEnv,
} from './p1/model-supply/index.js';
import {
  ModelSupplyImageGenerationAdapter,
  ContentPackageZipExportAdapter,
  OperationsContentPackageExportAssetReader,
  OPERATIONS_TRIGGER_JOB_KIND,
  OperationsApplicationService,
  OperationsVideoContentPackageAdapter,
  OperationsProductSearchProjection,
  OperationsProductPackageRightsAdapter,
  ProductContentPackageRightsResolver,
  PostgresOperationsRepository,
  PostgresContentPackageWriteOwnership,
  ProductOperationsBatchExecutionAdapter,
  PersistentCanvasExportAdapter,
  createOperationsTriggerJobHandler,
} from './p1/operations/index.js';
import { CutoverProductService } from './product/cutover-product-service.js';
import { PostgresProductRepository } from './product/postgres-repository.js';
import { PostgresRelationalProductRepository } from './product/relational-product-repository.js';
import { ProductService } from './product/product-service.js';
import {
  PostgresIdempotentProductNotifier,
  WebhookProductNotifier,
  noOpProductNotifier,
} from './product/notifier.js';
import { productPlanConfigFromEnv } from './product/plans.js';
import {
  ProductAssetDataClassResolver,
  ProductCreativeGroundingResolver,
  ProductStateEntitlementPolicy,
} from './product/p1-model-policy.js';
import { migratePostgresSchema } from './postgres-schema-migration.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const serviceToken = process.env.CORE_SERVICE_TOKEN;
if (!serviceToken) throw new Error('CORE_SERVICE_TOKEN is required.');
const notificationWebhook =
  process.env.FEISHU_WEBHOOK_URL ?? process.env.WECOM_WEBHOOK_URL;
const downstreamNotifier = notificationWebhook
  ? new WebhookProductNotifier(
      notificationWebhook,
      process.env.APP_BASE_URL ?? 'http://localhost:3000'
    )
  : noOpProductNotifier;

const pool = new Pool({ connectionString: databaseUrl });
const adminConfigRepository = new PostgresAdminConfigRepository(pool);
const notifier = new PostgresIdempotentProductNotifier(
  pool,
  downstreamNotifier,
);
const productPlans = productPlanConfigFromEnv(process.env);
const jobRuntime = PgBossJobPort.connect({
  connection: databaseUrl,
  queuePrefix: process.env.JOB_QUEUE_PREFIX ?? 'meiye-p1',
  workspaceConcurrencyLimits: [
    1,
    4,
    8,
    ...Object.values(productPlans).map((plan) => plan.concurrencyLimit),
  ],
});
const productRepository = new PostgresProductRepository(pool);
const relationalProductRepository = new PostgresRelationalProductRepository(pool);
const referenceAssets = new ProductReferenceAssetResolver(
  relationalProductRepository,
  {
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    serviceToken,
  }
);
const foundationRepository = new PostgresFoundationRepository(pool);
const operationsRepository = new PostgresOperationsRepository(pool);
const contentPackageWriteOwnership =
  new PostgresContentPackageWriteOwnership(pool);
const modelRepository = new PostgresModelSupplyRepository(pool);
const integrationRepository = new PostgresIntegrationRepository(pool);
const legacyInFlightDecisions = new PostgresLegacyInFlightDecisionPort(pool);
const productEntitlementPolicy = new ProductStateEntitlementPolicy(
  relationalProductRepository,
  productPlans
);
const foundationEntitlementPolicy = new ProductEntitlementApplicationService(
  foundationRepository
);
const recordedCommerceEnabled =
  process.env.P1_RECORDED_COMMERCE_ENABLED === '1';
const executionEntitlementPolicy = new CompositeProductEntitlementPolicy(
  productEntitlementPolicy,
  foundationEntitlementPolicy,
  {
    allowFoundationPlan: recordedCommerceEnabled,
    allowFoundationSupplements: recordedCommerceEnabled,
  }
);
const entitlementJobRuntime = new EntitlementAwareJobPort(
  jobRuntime,
  executionEntitlementPolicy
);
const repository = new PostgresTracerJobRepository(
  pool,
  entitlementJobRuntime
);
const operationalTelemetryStore = new PostgresOperationalTelemetryStore(pool);
await migratePostgresSchema(pool, [
  productRepository,
  relationalProductRepository,
  foundationRepository,
  adminConfigRepository,
  operationsRepository,
  contentPackageWriteOwnership,
  modelRepository,
  integrationRepository,
  repository,
  operationalTelemetryStore,
  notifier,
]);
const integrationSecrets = integrationSecretStoreFromEnv(process.env);
const providerCredentialRuntime = await providerCredentialEnvFromVault(
  integrationRepository,
  integrationSecrets,
  process.env,
);
const runtimeAssembly = await modelRuntimeAssemblyFromSources(
  adminConfigRepository,
  providerCredentialRuntime.env,
  { processKind: 'job-worker' },
);
const {
  deployments,
  models,
  runtime: modelRuntime,
  runtimeCapabilities,
} =
  runtimeAssembly.assembly;
const mediaExecutionMode = modelMediaExecutionMode(modelRuntime);
const gatedModelExecution = new ModeGateExecutionPort(
  modelRuntime.execution,
  adminConfigRepository,
  modelRuntime.mode,
);
const gatedMediaExecution = modelRuntime.media
  ? new ModeGateMediaLifecyclePort(
      modelRuntime.media,
      adminConfigRepository,
      mediaExecutionMode,
    )
  : undefined;
const foundation = new P1ApplicationService(foundationRepository);
const assetStorage = fileSystemAssetStorageFromEnv(process.env);
const modelSupply = new ModelSupplyApplicationService({
  assetStorage,
  catalogRevisionId: RECORDED_CATALOG_REVISION_ID,
  deployments,
  execution: gatedModelExecution,
  ledger: new FoundationModelSupplyLedger(
    foundation,
    executionEntitlementPolicy
  ),
  models,
  resultSink: modelRepository,
  runtimeCapabilities,
});
const modelControlPlane = new ModelSupplyControlPlaneService({
  activationEvidenceConfig: adminConfigRepository,
  ...(gatedMediaExecution
    ? {
        activationProbeExecutor: new MediaActivationProbeExecutor(
          gatedMediaExecution,
          { deployments, models },
        ),
      }
    : {}),
  activationProbeLiveDeploymentIds: [
    ...(modelRuntime.mode === 'direct' && modelRuntime.direct
      ? deployments
          .filter(
            (deployment) =>
              deployment.catalogModelId === modelRuntime.direct?.catalogModelId,
          )
          .map((deployment) => deployment.id)
      : []),
    ...(modelRuntime.arkMedia
      ? ['seedream-5-pro-direct', 'seedance-2-direct']
      : []),
    ...(modelRuntime.tuziMedia
      ? ['gpt-image-2-tuzi-relay', 'seedance-2-tuzi-relay']
      : []),
  ],
  allowRecordedExecution:
    modelRuntime.activation === 'local_fixture_verified',
  application: modelSupply,
  configurationRevisions: runtimeAssembly.assembly.configurationRevisions,
  fallbackCatalog: {
    payload: {
      capabilities: [],
      deployments,
      models,
      prices: [],
      routes: [],
    },
    revisionId: RECORDED_CATALOG_REVISION_ID,
  },
  repository: modelRepository,
});
const integrationService = new IntegrationApplicationService({
  douyin: new RecordedDouyinAdapter(),
  feishu: feishuMcpAdapterFromEnv(process.env),
  repository: integrationRepository,
  secrets: integrationSecrets,
});
const tracerJobs = new TracerJobApplicationService(repository);
const mediaGeneration = gatedMediaExecution
  ? new DurableMediaGenerationApplicationService({
      jobs: tracerJobs,
      models: modelSupply,
      provider: gatedMediaExecution,
    })
  : undefined;
if (mediaGeneration) modelSupply.attachDurableMediaRuntime(mediaGeneration);
const videoComposition = videoCompositionRuntimeFromEnv(
  process.env,
  assetStorage
);
const videoRunnerForWorkspace = async (workspaceId: string) => {
  await modelControlPlane.initialize(workspaceId);
  return new PersistentContentWorkflowRunner(
    modelSupply,
    videoComposition,
    new PostgresDurableVideoWorkflowStore(pool, workspaceId),
    new RecordedHumanCalibratedVideoQualityScorer()
  );
};
let operations: OperationsApplicationService;
const packageRightsPropagation = new OperationsProductPackageRightsAdapter(
  () => operations
);
const videoContentPackages = new OperationsVideoContentPackageAdapter(
  () => operations
);
const tracer = new DurableTracerWorker(
  repository,
  new RecordedProductTracerEffect()
);
const composedVideo = new DurableTracerWorker(
  repository,
  new ComposedVideoJobEffect(videoRunnerForWorkspace, videoContentPackages)
);
const mediaGenerationWorker = gatedMediaExecution
  ? new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models: modelSupply,
        provider: gatedMediaExecution,
        referenceAssets,
      })
    )
  : undefined;
const canvasTextGenerationWorker = new CanvasTextGenerationOutboxWorker({
  application: modelSupply,
  initializeWorkspace: (workspaceId) =>
    modelControlPlane.initialize(workspaceId).then(() => undefined),
  repository: modelRepository,
});
const legacyProductService = new ProductService(
  productRepository,
  notifier,
  productPlans,
  undefined,
  undefined,
  legacyInFlightDecisions,
  'legacy',
  { packageRightsPropagation }
);
const relationalProductService = new ProductService(
  relationalProductRepository,
  notifier,
  productPlans,
  undefined,
  undefined,
  legacyInFlightDecisions,
  'p1',
  {
    legacyVideoPath: 'disabled',
    packageRightsPropagation,
    searchProjection: new OperationsProductSearchProjection(
      operationsRepository
    ),
  }
);
const productService = new CutoverProductService(
  productRepository,
  legacyProductService,
  relationalProductService,
  legacyInFlightDecisions
);
const batchExecutor = new ProductOperationsBatchExecutionAdapter(
  productService,
  () => operations
);
operations = new OperationsApplicationService(operationsRepository, {
  contentPackageExporter: new ContentPackageZipExportAdapter(
    assetStorage,
    new OperationsContentPackageExportAssetReader(
      operationsRepository,
      assetStorage,
      referenceAssets
    )
  ),
  contentPackageRightsResolver: new ProductContentPackageRightsResolver(
    relationalProductRepository
  ),
  contentWriteOwnership: contentPackageWriteOwnership,
  assetDataClassResolver: new ProductAssetDataClassResolver(
    relationalProductRepository
  ),
  batchExecutor,
  canvasExporter: new PersistentCanvasExportAdapter(assetStorage),
  groundingResolver: new ProductCreativeGroundingResolver(
    relationalProductRepository
  ),
  imageGenerator: new ModelSupplyImageGenerationAdapter(
    modelSupply,
    async (workspaceId) => {
      await modelControlPlane.initialize(workspaceId);
    }
  ),
  notifier: {
    async send(notification) {
      await notifier.notify({
        correlationId: notification.idempotencyKey,
        deepLink: '/dashboard',
        idempotencyKey: notification.idempotencyKey,
        jobId: notification.taskId,
        message: notification.nextStep
          ? `${notification.title}：${notification.nextStep}`
          : notification.title,
        status: 'needs_action',
        workspaceId: notification.workspaceId,
      });
    },
  },
});
const workerId =
  process.env.P1_JOB_WORKER_ID ?? `${hostname()}:${process.pid}`;
const worker = new P1JobWorkerEntrypoint(
  jobRuntime,
  {
    [COMPOSED_VIDEO_JOB_KIND]: createComposedVideoJobHandler(composedVideo),
    [DOUYIN_OAUTH_LIFECYCLE_JOB_KIND]:
      createDouyinOAuthLifecycleJobHandler(
        new DouyinOAuthLifecycleBatchRunner(
          integrationRepository,
          integrationService
        )
      ),
    [DOUYIN_OBSERVE_SYNC_JOB_KIND]: createDouyinObserveSyncJobHandler(
      new DouyinObserveSyncBatchRunner(
        integrationRepository,
        integrationService
      )
    ),
    [DOUYIN_PUBLISH_POLLING_JOB_KIND]:
      createDouyinPublishPollingJobHandler(
        new DouyinPublishPollingBatchRunner(
          integrationRepository,
          integrationService
        )
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
    [OPERATIONS_TRIGGER_JOB_KIND]: createOperationsTriggerJobHandler(operations),
    ...(mediaGenerationWorker
      ? {
          [MODEL_MEDIA_GENERATION_JOB_KIND]:
            createMediaGenerationJobHandler(mediaGenerationWorker),
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
    sampleIntervalMs: Number(
      process.env.P1_WORKER_METRICS_INTERVAL_MS ?? 5_000
    ),
    workerId,
  }
);
await worker.start();
workerTelemetry.start();
const canvasTextGenerationInterval = setInterval(() => {
  void canvasTextGenerationWorker.runOnce().catch((error) => {
    console.error('Canvas text generation outbox iteration failed.', error);
  });
}, Number(process.env.CANVAS_TEXT_GENERATION_POLL_MS ?? 250));
canvasTextGenerationInterval.unref();
console.log('meiye-core P1 job worker started');

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(canvasTextGenerationInterval);
  try {
    await worker.stop();
  } finally {
    await workerTelemetry.stop();
    await jobRuntime.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  }
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

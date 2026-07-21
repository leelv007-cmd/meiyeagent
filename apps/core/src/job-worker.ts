import { hostname } from 'node:os';
import { Pool } from 'pg';
import {
  ModeGateExecutionPort,
  ModeGateMediaLifecyclePort,
  PostgresAdminConfigRepository,
  modelRuntimeAssemblyFromSources,
} from './p1/admin-config/index.js';
import { assertStrongSecret } from './security/secret-hardening.js';
import { PostgresLegacyInFlightDecisionPort } from './p1/cutover/index.js';
import {
  CompositeProductEntitlementPolicy,
  GrantLotAwareProductEntitlementService,
  P1ApplicationService,
  PostgresFoundationRepository,
  PostgresGrantLotLedger,
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
  createProviderCredentialSecretBroker,
  integrationSecretStoreFromEnv,
  migrateProviderCredentialAccountsFromIntegrations,
  providerConnectivityProbeFromEnv,
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
  CompositeReferenceAssetResolver,
  DurableMediaGenerationApplicationService,
  modelAssetStorageFromEnv,
  FoundationModelSupplyLedger,
  MediaActivationProbeExecutor,
  OwnedAssetReferenceResolver,
  PersistentContentWorkflowRunner,
  PostgresCanonicalVideoRunStore,
  PostgresCanonicalVideoWorkflowSchema,
  PostgresVideoRegenerationRepository,
  PostgresModelSupplyRepository,
  ProductReferenceAssetResolver,
  RecordedFixtureVideoQualityScorer,
  VersionedHumanCalibratedVideoQualityScorer,
  MODEL_MEDIA_GENERATION_JOB_KIND,
  ModelMediaGenerationEffect,
  createComposedVideoJobHandler,
  createVideoRegenerationTerminalObserver,
  createInitialVideoTerminalObserver,
  composeVideoTerminalObservers,
  createMediaGenerationJobHandler,
  createModelSupplyRuntime,
  modelMediaExecutionMode,
  seedCapabilityHotAssemblyFromCatalog,
  RECORDED_CATALOG_REVISION_ID,
  videoCompositionRuntimeFromEnv,
} from './p1/model-supply/index.js';
import {
  ensureDefaultRuntimeSupplyPool,
  PostgresAccountAllocationStore,
  PostgresCapacityLeaseStore,
  PostgresEntitlementPoolsMigration,
  PostgresEntitlementPolicyStore,
  PostgresModelSupplyProviderAdmission,
  PostgresSupplyFreezeStore,
  PostgresSupplyPoolStore,
} from './p1/entitlement-pools/index.js';
import {
  PLATFORM_SUPPLY_SCOPE_ID,
  PostgresAdminSupplyMigration,
  PostgresCapabilityHotAssemblyMigration,
  PostgresCapabilityHotAssemblyPort,
  PostgresSupplyControlPlaneRepository,
  PostgresSupplyPlanningControlPlane,
  PostgresSupplyPlanningMigration,
} from './p1/supply-registry/index.js';
import {
  DurableProductBillingService,
  PostgresProductBillingRepository,
} from './p1/product-billing/index.js';
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
  PostgresAssetIntakeRepository,
  PostgresOperationsRepository,
  PostgresContextBundleRepository,
  PostgresContextSourceRevisionRepository,
  PostgresReuseMemoryRepository,
  PostgresStoreFactLedger,
  PostgresContentPackageWriteOwnership,
  ProductOperationsBatchExecutionAdapter,
  PersistentCanvasExportAdapter,
  createOperationsTriggerJobHandler,
} from './p1/operations/index.js';
import { LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY } from './pro-studio-runtime/provider-reference-policy.js';
import {
  CanvasAssetDeletionWorker,
  migrateProStudioSchema,
  PostgresCanvasAssetRepository,
} from './pro-studio/index.js';
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
assertStrongSecret('CORE_SERVICE_TOKEN', serviceToken);
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
const assetStorage = modelAssetStorageFromEnv(process.env);
const canvasAssetRepository = new PostgresCanvasAssetRepository(pool);
const referenceAssets = new CompositeReferenceAssetResolver([
  new OwnedAssetReferenceResolver(
    canvasAssetRepository,
    {
      async head(objectKey) {
        return assetStorage.head(objectKey);
      },
      async read(objectKey) {
        return (await assetStorage.read(objectKey)).bytes;
      },
    },
  ),
  new ProductReferenceAssetResolver(relationalProductRepository, {
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    serviceToken,
  }),
]);
const foundationRepository = new PostgresFoundationRepository(pool);
const grantLotLedger = new PostgresGrantLotLedger(pool);
const operationsRepository = new PostgresOperationsRepository(pool);
const productBillingRepository = new PostgresProductBillingRepository(pool);
const billingLifecycle = new DurableProductBillingService(
  productBillingRepository,
);
const videoRegenerationRepository = new PostgresVideoRegenerationRepository(pool);
const canonicalVideoWorkflowSchema = new PostgresCanonicalVideoWorkflowSchema(pool);
const storeFactLedger = new PostgresStoreFactLedger(pool);
const contextBundleRepository = new PostgresContextBundleRepository(pool);
const contextSourceRevisions = new PostgresContextSourceRevisionRepository(pool);
const assetIntakeRepository = new PostgresAssetIntakeRepository(pool);
const reuseMemoryRepository = new PostgresReuseMemoryRepository(pool);
const contentPackageWriteOwnership =
  new PostgresContentPackageWriteOwnership(pool);
const modelRepository = new PostgresModelSupplyRepository(pool);
const integrationRepository = new PostgresIntegrationRepository(pool);
const supplyControlRepository = new PostgresSupplyControlPlaneRepository(pool);
const supplyPlanningControlPlane = new PostgresSupplyPlanningControlPlane(
  pool,
  PLATFORM_SUPPLY_SCOPE_ID,
);
const legacyInFlightDecisions = new PostgresLegacyInFlightDecisionPort(pool);
const productEntitlementPolicy = new ProductStateEntitlementPolicy(
  relationalProductRepository,
  productPlans
);
const foundationEntitlementPolicy = new GrantLotAwareProductEntitlementService(
  foundationRepository,
  grantLotLedger
);
const recordedCommerceEnabled =
  process.env.P1_RECORDED_COMMERCE_ENABLED === '1';
const executionEntitlementPolicy = new CompositeProductEntitlementPolicy(
  productEntitlementPolicy,
  foundationEntitlementPolicy,
  {
    allowFoundationPlan: true,
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
  grantLotLedger,
  adminConfigRepository,
  operationsRepository,
  productBillingRepository,
  canonicalVideoWorkflowSchema,
  videoRegenerationRepository,
  storeFactLedger,
  contextBundleRepository,
  contextSourceRevisions,
  assetIntakeRepository,
  reuseMemoryRepository,
  contentPackageWriteOwnership,
  modelRepository,
  integrationRepository,
  supplyControlRepository,
  new PostgresCapabilityHotAssemblyMigration(),
  new PostgresSupplyPlanningMigration(),
  new PostgresEntitlementPoolsMigration(),
  new PostgresAdminSupplyMigration(),
  repository,
  operationalTelemetryStore,
  notifier,
]);
await migrateProStudioSchema(pool);
const integrationSecrets = integrationSecretStoreFromEnv(process.env);
await migrateProviderCredentialAccountsFromIntegrations(
  integrationRepository,
  supplyControlRepository,
);
const providerCredentialRuntime = await providerCredentialEnvFromVault(
  supplyControlRepository,
  integrationSecrets,
  process.env,
);
const providerCredentialSecretBroker = createProviderCredentialSecretBroker(
  supplyControlRepository,
  integrationSecrets,
);
const providerConnectivity = providerConnectivityProbeFromEnv(
  providerCredentialRuntime.env,
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
} =
  runtimeAssembly.assembly;
// G3 hot assembly (Worker process) — same seed fingerprint as HTTP from shared catalog.
const bootCapabilityHotAssembly = seedCapabilityHotAssemblyFromCatalog(
  runtimeAssembly.assembly,
);
const capabilityHotAssembly = new PostgresCapabilityHotAssemblyPort(
  pool,
  supplyControlRepository,
  PLATFORM_SUPPLY_SCOPE_ID,
  providerCredentialSecretBroker,
);
await capabilityHotAssembly.seedIfEmpty(
  bootCapabilityHotAssembly.bootRevision,
);
capabilityHotAssembly.applyCatalogRevisionHead(
  RECORDED_CATALOG_REVISION_ID,
);
const supplyPoolStore = new PostgresSupplyPoolStore(pool);
const entitlementPolicyStore = new PostgresEntitlementPolicyStore(pool);
const accountAllocationStore = new PostgresAccountAllocationStore(pool);
const capacityLeaseStore = new PostgresCapacityLeaseStore(pool);
const supplyFreezeStore = new PostgresSupplyFreezeStore(pool);
const bootDeploymentIds =
  deployments.length > 0
    ? deployments.map((deployment) => deployment.id)
    : ['boot-placeholder-deployment'];
await ensureDefaultRuntimeSupplyPool(supplyPoolStore, bootDeploymentIds);
const modelSupplyProviderAdmission =
  new PostgresModelSupplyProviderAdmission({
    productEntitlements: executionEntitlementPolicy,
    entitlementPolicies: entitlementPolicyStore,
    accountAllocations: accountAllocationStore,
    supplyPools: supplyPoolStore,
    capacityLeases: capacityLeaseStore,
  });
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
const modelSupplyRuntime = createModelSupplyRuntime({
  application: {
    assetStorage,
    execution: gatedModelExecution,
    ledger: new FoundationModelSupplyLedger(
      foundation,
      executionEntitlementPolicy,
      grantLotLedger,
      {
        billingLifecycle,
        defaultSupplyPoolId: 'pool-shared-default',
        productUsage: billingLifecycle,
        supplyFreezes: supplyFreezeStore,
      },
    ),
    providerAdmission: modelSupplyProviderAdmission,
    resultSink: modelRepository,
  },
  catalog: runtimeAssembly.assembly,
  capabilityHotAssembly,
  controlPlane: {
    activationEvidenceConfig: adminConfigRepository,
    ...(gatedMediaExecution
      ? {
          activationProbeExecutor: new MediaActivationProbeExecutor(
            gatedMediaExecution,
            { deployments, models },
          ),
        }
      : {}),
    planningControlPlane: supplyPlanningControlPlane,
    repository: modelRepository,
    supplyRegistry: supplyControlRepository,
  },
});
const modelSupply = modelSupplyRuntime.application;
const modelControlPlane = modelSupplyRuntime.controlPlane;
{
  const view = await capabilityHotAssembly.reportProcessView('job-worker');
  const defaultSupplyPool = await supplyPoolStore.get('pool-shared-default');
  console.log(
    `[z2-wiring] job-worker capability revision=${view.effectiveCapabilityRevisionId ?? 'none'} catalog=${view.effectiveCatalogRevisionId ?? 'none'} supplyPool=${defaultSupplyPool?.id ?? 'missing'}`,
  );
}
const integrationService = new IntegrationApplicationService({
  douyin: new RecordedDouyinAdapter(),
  feishu: feishuMcpAdapterFromEnv(process.env),
  providerConnectivity,
  repository: integrationRepository,
  secrets: integrationSecrets,
});
const tracerJobs = new TracerJobApplicationService(repository);
const mediaGeneration = gatedMediaExecution
  ? new DurableMediaGenerationApplicationService({
      jobs: tracerJobs,
      models: modelSupply,
      provider: gatedMediaExecution,
      ...(modelRuntime.mode === 'fixture'
        ? { referencePolicy: LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY }
        : {}),
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
    new PostgresCanonicalVideoRunStore(pool, workspaceId),
    modelRuntime.mode === 'fixture'
      ? new RecordedFixtureVideoQualityScorer()
      : new VersionedHumanCalibratedVideoQualityScorer()
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
  new ComposedVideoJobEffect(
    videoRunnerForWorkspace,
    videoContentPackages,
    composeVideoTerminalObservers(
      createInitialVideoTerminalObserver({ billing: billingLifecycle }),
      createVideoRegenerationTerminalObserver({
        billing: billingLifecycle,
        repository: videoRegenerationRepository,
      }),
    ),
  )
);
const mediaGenerationWorker = gatedMediaExecution
  ? new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models: modelSupply,
        provider: gatedMediaExecution,
        ...(modelRuntime.mode === 'fixture'
          ? { referencePolicy: LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY }
          : {}),
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
const canvasAssetDeletionWorker = new CanvasAssetDeletionWorker({
  repository: canvasAssetRepository,
  storage: {
    delete: async (objectKey) =>
      assetStorage.deleteCanvasAsset({
        objectKey,
        workspaceId: objectKey.split('/')[0] ?? '',
      }),
    put: async (objectKey, bytes) =>
      assetStorage.putCanvasAsset({
        bytes,
        objectKey,
        workspaceId: objectKey.split('/')[0] ?? '',
      }),
    read: async (objectKey) => {
      try {
        return (await assetStorage.read(objectKey)).bytes;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  },
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
  billingLifecycle,
  contentPackageExporter: new ContentPackageZipExportAdapter(
    assetStorage,
    new OperationsContentPackageExportAssetReader(
      operationsRepository,
      assetStorage,
      referenceAssets
    ),
    {
      allowRecordedSyntheticVideoCompliance: process.env.APP_ENV === 'e2e',
      appEnv: process.env.APP_ENV,
    },
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
const canvasAssetDeletionInterval = setInterval(() => {
  void canvasAssetDeletionWorker.runOnce().catch((error) => {
    console.error('Canvas asset deletion outbox iteration failed.', error);
  });
}, Number(process.env.CANVAS_ASSET_DELETION_POLL_MS ?? 500));
canvasAssetDeletionInterval.unref();
console.log('meiye-core P1 job worker started');

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(canvasTextGenerationInterval);
  clearInterval(canvasAssetDeletionInterval);
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

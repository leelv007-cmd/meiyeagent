import { Pool } from 'pg';
import { PostgresDiagnosticRepository } from './diagnostics/postgres-repository.js';
import { PostgresProductRepository } from './product/postgres-repository.js';
import { PostgresRelationalProductRepository } from './product/relational-product-repository.js';
import {
  noOpProductNotifier,
  PostgresIdempotentProductNotifier,
  WebhookProductNotifier,
} from './product/notifier.js';
import { ProductService } from './product/product-service.js';
import { CutoverProductService } from './product/cutover-product-service.js';
import type { ProductQualitySink } from './product/quality-sink.js';
import { productPlanConfigFromEnv } from './product/plans.js';
import { ModelSupplyProductCopyProvider } from './product/model-supply-copy-provider.js';
import { ProductPublishContentSnapshotPort } from './product/publish-content-snapshot.js';
import {
  ProductAssetDataClassResolver,
  ProductCreativeGroundingResolver,
  ProductStateEntitlementPolicy,
} from './product/p1-model-policy.js';
import { createCoreServer } from './server.js';
import {
  AdminConfigFoundationModule,
  AdminConfigEntitlementCatalogSource,
  ModeGateExecutionPort,
  ModeGateMediaLifecyclePort,
  createModelExecutionModeGate,
  PostgresAdminConfigRepository,
  modelRuntimeAssemblyFromSources,
  integrationAdapterEnvFromSources,
  runtimeModeValidatorsFromEnv,
} from './p1/admin-config/index.js';
import {
  CompositeProductEntitlementPolicy,
  DEFAULT_ADD_ON_OFFERS,
  DEFAULT_PLAN_OFFERS,
  P1ApplicationService,
  PostgresFoundationRepository,
  ProductEntitlementApplicationService,
  ProductEntitlementFoundationModule,
  RecordedAutoTopUpPaymentPort,
} from './p1/foundation/index.js';
import {
  P1CutoverExecutionService,
  PostgresLegacyInFlightDecisionPort,
} from './p1/cutover/index.js';
import {
  IntegrationsFoundationModule,
  IntegrationApplicationService,
  PostgresIntegrationRepository,
  RecordedDouyinAdapter,
  FoundationStrictByokLedger,
  OperationsConfirmationTaskAdapter,
  byokExecutionRuntimeFromEnv,
  feishuMcpAdapterFromEnv,
  integrationSecretStoreFromEnv,
  providerConnectivityProbeFromEnv,
  providerCredentialEnvFromVault,
  registerDouyinOAuthLifecycleSchedule,
  registerDouyinObserveSyncSchedule,
  registerDouyinPublishPollingSchedule,
  registerFeishuIntentReconciliationSchedule,
  registerFeishuToolLifecycleSchedule,
} from './p1/integrations/index.js';
import {
  EntitlementAwareJobPort,
  JobRuntimeFoundationModule,
  PgBossJobPort,
  PostgresOperationalMetricsCollector,
  PostgresOperationalTelemetryStore,
  PostgresTracerJobRepository,
  TracerJobApplicationService,
} from './p1/job-runtime/index.js';
import {
  DurableComposedVideoApplicationService,
  DurableMediaGenerationApplicationService,
  fileSystemAssetStorageFromEnv,
  FixtureAiStreamingRunner,
  FoundationModelSupplyLedger,
  MediaActivationProbeExecutor,
  ModelSupplyApplicationService,
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
  OpenAiCompatibleAiSdkRunner,
  PersistentContentWorkflowRunner,
  PostgresDurableVideoWorkflowStore,
  ProductCopyProviderBridge,
  PostgresModelSupplyRepository,
  ProductReferenceAssetResolver,
  RECORDED_CATALOG_REVISION_ID,
  RecordedHumanCalibratedVideoQualityScorer,
  createDefaultCapabilityRevisions,
  createDefaultExecutionChannels,
  createDefaultPriceRevisions,
  createDefaultProviderProfiles,
  createDefaultRouteRevisions,
  modelMediaExecutionMode,
  videoCompositionRuntimeFromEnv,
} from './p1/model-supply/index.js';
import {
  OperationsApplicationService,
  OperationsFoundationModule,
  OperationsVideoContentPackageAdapter,
  ModelSupplyCreationExecutor,
  ModelSupplyImageGenerationAdapter,
  MediaCustodyStorageAdapter,
  OperationsProductSearchProjection,
  OperationsProductPackageRightsAdapter,
  ProductContentPackageRightsResolver,
  ContentPackageMigrationService,
  ContentPackageZipExportAdapter,
  OperationsContentPackageExportAssetReader,
  PostgresContentPackageMigrationRunRepository,
  PostgresContentPackageMigrationSource,
  PostgresOperationsRepository,
  PostgresContentPackageWriteOwnership,
  ProductOperationsBatchExecutionAdapter,
  PersistentCanvasExportAdapter,
} from './p1/operations/index.js';
import {
  migrateProStudioSchema,
  PostgresAdvancedCanvasProjectRepository,
} from './pro-studio/index.js';
import {
  AdvancedCanvasAdoptionFoundationModule,
  migrateProStudioWorkspaceState,
  PostgresAdvancedCanvasAdoptionService,
} from './pro-studio-runtime/index.js';
import { migratePostgresSchema } from './postgres-schema-migration.js';

const databaseUrl = process.env.DATABASE_URL;
const serviceToken = process.env.CORE_SERVICE_TOKEN;
const douyinCallbackToken = process.env.DOUYIN_CALLBACK_TOKEN;
const recordedCommerceEnabled =
  process.env.P1_RECORDED_COMMERCE_ENABLED === '1';
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!serviceToken) throw new Error('CORE_SERVICE_TOKEN is required.');
if (!douyinCallbackToken) throw new Error('DOUYIN_CALLBACK_TOKEN is required.');
if (douyinCallbackToken === serviceToken) {
  throw new Error('DOUYIN_CALLBACK_TOKEN must differ from CORE_SERVICE_TOKEN.');
}

const pool = new Pool({ connectionString: databaseUrl });
const canvasProjects = new PostgresAdvancedCanvasProjectRepository(pool);
const diagnosticRepository = new PostgresDiagnosticRepository(pool);
const productRepository = new PostgresProductRepository(pool);
const relationalProductRepository = new PostgresRelationalProductRepository(
  pool
);
const referenceAssets = new ProductReferenceAssetResolver(
  relationalProductRepository,
  {
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    serviceToken,
  }
);
const foundationRepository = new PostgresFoundationRepository(pool);
const operationsRepository = new PostgresOperationsRepository(pool);
const contentPackageWriteOwnership = new PostgresContentPackageWriteOwnership(
  pool
);
const contentPackageMigrationRuns =
  new PostgresContentPackageMigrationRunRepository(pool);
const contentPackageMigration = new ContentPackageMigrationService({
  ownership: contentPackageWriteOwnership,
  repository: operationsRepository,
  runs: contentPackageMigrationRuns,
  source: new PostgresContentPackageMigrationSource({
    operations: operationsRepository,
    pool,
    product: relationalProductRepository,
  }),
});
const adminConfigRepository = new PostgresAdminConfigRepository(pool);
const integrationRepository = new PostgresIntegrationRepository(pool);
await migratePostgresSchema(pool, [
  adminConfigRepository,
  integrationRepository,
]);
const integrationSecrets = integrationSecretStoreFromEnv(process.env);
const providerCredentialRuntime = await providerCredentialEnvFromVault(
  integrationRepository,
  integrationSecrets,
  process.env,
);
const modelSupplyRepository = new PostgresModelSupplyRepository(pool);
const cutoverExecution = new P1CutoverExecutionService(pool);
const legacyInFlightDecisions = new PostgresLegacyInFlightDecisionPort(pool);

const port = Number(process.env.CORE_PORT ?? 4100);
const notificationWebhook =
  process.env.FEISHU_WEBHOOK_URL ?? process.env.WECOM_WEBHOOK_URL;
const downstreamNotifier = notificationWebhook
  ? new WebhookProductNotifier(
      notificationWebhook,
      process.env.APP_BASE_URL ?? 'http://localhost:3000'
    )
  : noOpProductNotifier;
const notifier = new PostgresIdempotentProductNotifier(
  pool,
  downstreamNotifier
);
const productPlans = productPlanConfigFromEnv(process.env);
const runtimeAssembly = await modelRuntimeAssemblyFromSources(
  adminConfigRepository,
  providerCredentialRuntime.env,
  { processKind: 'http' }
);
const {
  deployments,
  models,
  runtime: modelRuntime,
  runtimeCapabilities,
} = runtimeAssembly.assembly;
const mediaExecutionMode = modelMediaExecutionMode(modelRuntime);
const gatedModelExecution = new ModeGateExecutionPort(
  modelRuntime.execution,
  adminConfigRepository,
  modelRuntime.mode
);
// 流式 copy / assistant 的 runner 方法是同步签名，无法走 ProviderExecutionPort
// 装饰器；用同一 model.execution.mode 头做一个独立止血阀，注入两条流式 choke point，
// 使「停用」对锁定不变量的 token 流式主链也立即生效（P0-2）。
const streamingModeGate = createModelExecutionModeGate(
  adminConfigRepository,
  modelRuntime.mode
);
const gatedMediaExecution = modelRuntime.media
  ? new ModeGateMediaLifecyclePort(
      modelRuntime.media,
      adminConfigRepository,
      mediaExecutionMode
    )
  : undefined;
const integrationAssembly = await integrationAdapterEnvFromSources(
  adminConfigRepository,
  process.env
);
const byokRuntime = byokExecutionRuntimeFromEnv(integrationAssembly.env);
const planConfigDefaults = Object.fromEntries(
  DEFAULT_PLAN_OFFERS.map(({ id, ...value }) => [id, value]),
);
const adminConfigRuntime = {
  'byok.adapter.assembly': byokRuntime.mode,
  'compliance.aigc_label.default': true,
  'compliance.regulated_mode.default': false,
  'compliance.watermark.default': false,
  'douyin.adapter.assembly': 'recorded',
  'model.execution.mode': modelRuntime.mode,
  'model.media.execution.mode': mediaExecutionMode,
  'plan.addons': DEFAULT_ADD_ON_OFFERS,
  'plan.allowances.starter': planConfigDefaults.starter,
  'plan.allowances.growth': planConfigDefaults.growth,
  'plan.allowances.pro': planConfigDefaults.pro,
} satisfies Readonly<Record<string, unknown>>;
const aiStreamingRunner =
  modelRuntime.mode === 'fixture'
    ? new FixtureAiStreamingRunner()
    : modelRuntime.activation === 'live_verified' && modelRuntime.direct
      ? new OpenAiCompatibleAiSdkRunner(modelRuntime.direct)
      : undefined;
const assetStorage = fileSystemAssetStorageFromEnv(process.env);
const foundationLedgerService = new P1ApplicationService(foundationRepository);
const productEntitlementPolicy = new ProductStateEntitlementPolicy(
  relationalProductRepository,
  productPlans
);
const productEntitlements = new ProductEntitlementApplicationService(
  foundationRepository,
  recordedCommerceEnabled ? new RecordedAutoTopUpPaymentPort() : undefined
);
const executionEntitlementPolicy = new CompositeProductEntitlementPolicy(
  productEntitlementPolicy,
  productEntitlements,
  {
    allowFoundationPlan: recordedCommerceEnabled,
    allowFoundationSupplements: recordedCommerceEnabled,
  }
);
const p1ModelSupplyService = new ModelSupplyApplicationService({
  assetStorage,
  catalogRevisionId: RECORDED_CATALOG_REVISION_ID,
  deployments,
  execution: gatedModelExecution,
  ledger: new FoundationModelSupplyLedger(
    foundationLedgerService,
    executionEntitlementPolicy
  ),
  models,
  resultSink: modelSupplyRepository,
  runtimeCapabilities,
  submissionGate: streamingModeGate,
});
const legacyModelSupplyService = new ModelSupplyApplicationService({
  assetStorage,
  catalogRevisionId: RECORDED_CATALOG_REVISION_ID,
  deployments,
  execution: gatedModelExecution,
  models,
  resultSink: modelSupplyRepository,
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
  allowRecordedExecution: modelRuntime.activation === 'local_fixture_verified',
  application: p1ModelSupplyService,
  canvasProjects,
  configurationRevisions: runtimeAssembly.assembly.configurationRevisions,
  durationSamples: foundationRepository,
  fallbackCatalog: {
    payload: {
      capabilities: createDefaultCapabilityRevisions(),
      deployments,
      executionChannels: createDefaultExecutionChannels(),
      models,
      prices: createDefaultPriceRevisions(),
      providerProfiles: createDefaultProviderProfiles(),
      routes: createDefaultRouteRevisions(),
    },
    revisionId: RECORDED_CATALOG_REVISION_ID,
  },
  repository: modelSupplyRepository,
});
const legacyModelControlPlane = new ModelSupplyControlPlaneService({
  allowRecordedExecution: modelRuntime.activation === 'local_fixture_verified',
  application: legacyModelSupplyService,
  fallbackCatalog: {
    payload: {
      capabilities: createDefaultCapabilityRevisions(),
      deployments,
      executionChannels: createDefaultExecutionChannels(),
      models,
      prices: createDefaultPriceRevisions(),
      providerProfiles: createDefaultProviderProfiles(),
      routes: createDefaultRouteRevisions(),
    },
    revisionId: RECORDED_CATALOG_REVISION_ID,
  },
  repository: modelSupplyRepository,
});
const initializeWorkspaceCatalog = async (workspaceId: string) => {
  await Promise.all([
    modelControlPlane.initialize(workspaceId),
    legacyModelControlPlane.initialize(workspaceId),
  ]);
};
const resolveCopySelection = async (request: {
  workspaceId: string;
  userId: string;
}) => {
  const preferences = await modelControlPlane.getPreferences(
    request.workspaceId,
    request.userId,
    'copy.generate'
  );
  const modelId = preferences.userDefault ?? preferences.workspaceDefault;
  return modelId
    ? ({ catalogModelId: modelId, mode: 'fixed' } as const)
    : undefined;
};
const resolveCopyPrompt = (request: { workspaceId: string }) =>
  modelControlPlane.getPromptRevision(request.workspaceId);
const p1CopyBridge = new ProductCopyProviderBridge(
  p1ModelSupplyService,
  initializeWorkspaceCatalog
);
const legacyCopyBridge = new ProductCopyProviderBridge(
  legacyModelSupplyService,
  initializeWorkspaceCatalog
);
const modelAdminActorIds = (process.env.P1_ADMIN_ACTOR_IDS ?? '')
  .split(',')
  .map((actorId) => actorId.trim())
  .filter(Boolean);
const jobRuntimeWorkerActorIds = (
  process.env.P1_JOB_RUNTIME_WORKER_ACTOR_IDS ?? ''
)
  .split(',')
  .map((actorId) => actorId.trim())
  .filter(Boolean);
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
const entitlementJobRuntime = new EntitlementAwareJobPort(
  jobRuntime,
  executionEntitlementPolicy
);
const tracerJobRepository = new PostgresTracerJobRepository(
  pool,
  entitlementJobRuntime
);
const operationalTelemetryStore = new PostgresOperationalTelemetryStore(pool);
await migratePostgresSchema(pool, [
  diagnosticRepository,
  productRepository,
  relationalProductRepository,
  foundationRepository,
  adminConfigRepository,
  operationsRepository,
  contentPackageWriteOwnership,
  contentPackageMigrationRuns,
  modelSupplyRepository,
  integrationRepository,
  cutoverExecution,
  tracerJobRepository,
  operationalTelemetryStore,
  notifier,
]);
await migrateProStudioSchema(pool);
await migrateProStudioWorkspaceState(pool);
const tracerJobs = new TracerJobApplicationService(tracerJobRepository);
if (gatedMediaExecution) {
  p1ModelSupplyService.attachDurableMediaRuntime(
    new DurableMediaGenerationApplicationService({
      jobs: tracerJobs,
      models: p1ModelSupplyService,
      provider: gatedMediaExecution,
    })
  );
}
const videoComposition = videoCompositionRuntimeFromEnv(
  process.env,
  assetStorage
);
const videoRunnerForWorkspace = async (workspaceId: string) => {
  await modelControlPlane.initialize(workspaceId);
  return new PersistentContentWorkflowRunner(
    p1ModelSupplyService,
    videoComposition,
    new PostgresDurableVideoWorkflowStore(pool, workspaceId),
    new RecordedHumanCalibratedVideoQualityScorer()
  );
};
let operationsService: OperationsApplicationService;
const packageRightsPropagation = new OperationsProductPackageRightsAdapter(
  () => operationsService
);
const videoContentPackages = new OperationsVideoContentPackageAdapter(
  () => operationsService
);
const composedVideo = new DurableComposedVideoApplicationService({
  contentPackages: videoContentPackages,
  jobs: tracerJobs,
  runnerForWorkspace: videoRunnerForWorkspace,
});

const feishuMcp = feishuMcpAdapterFromEnv(process.env);
const integrationService = new IntegrationApplicationService({
  byok: byokRuntime.adapter,
  byokExecutionMode: byokRuntime.mode,
  byokLedger: new FoundationStrictByokLedger(
    foundationLedgerService,
    executionEntitlementPolicy
  ),
  contentSnapshots: new ProductPublishContentSnapshotPort(
    relationalProductRepository
  ),
  douyin: new RecordedDouyinAdapter(),
  endpointProfiles: [
    {
      apiFamily: 'openai-compatible',
      endpoint:
        process.env.BYOK_OPENAI_COMPATIBLE_ENDPOINT ??
        'https://api.openai.com/v1',
      id: 'openai-compatible-default',
      permittedModels:
        byokRuntime.mode === 'live'
          ? byokRuntime.permittedModels
          : models
              .filter((model) => model.modality === 'llm')
              .map((model) => model.id),
    },
  ],
  feishu: feishuMcp,
  providerConnectivity: providerConnectivityProbeFromEnv(
    providerCredentialRuntime.env,
  ),
  repository: integrationRepository,
  secrets: integrationSecrets,
});
await registerFeishuToolLifecycleSchedule(jobRuntime, {
  ...(process.env.FEISHU_TOOL_CATALOG_CRON
    ? { cron: process.env.FEISHU_TOOL_CATALOG_CRON }
    : {}),
  ...(process.env.FEISHU_TOOL_CATALOG_TIMEZONE
    ? { timezone: process.env.FEISHU_TOOL_CATALOG_TIMEZONE }
    : {}),
});
await registerFeishuIntentReconciliationSchedule(jobRuntime, {
  ...(process.env.FEISHU_INTENT_RECONCILIATION_CRON
    ? { cron: process.env.FEISHU_INTENT_RECONCILIATION_CRON }
    : {}),
  ...(process.env.FEISHU_INTENT_RECONCILIATION_TIMEZONE
    ? { timezone: process.env.FEISHU_INTENT_RECONCILIATION_TIMEZONE }
    : {}),
});
await registerDouyinOAuthLifecycleSchedule(jobRuntime, {
  ...(process.env.DOUYIN_OAUTH_LIFECYCLE_CRON
    ? { cron: process.env.DOUYIN_OAUTH_LIFECYCLE_CRON }
    : {}),
  ...(process.env.DOUYIN_OAUTH_LIFECYCLE_TIMEZONE
    ? { timezone: process.env.DOUYIN_OAUTH_LIFECYCLE_TIMEZONE }
    : {}),
});
await registerDouyinObserveSyncSchedule(jobRuntime, {
  ...(process.env.DOUYIN_OBSERVE_SYNC_CRON
    ? { cron: process.env.DOUYIN_OBSERVE_SYNC_CRON }
    : {}),
  ...(process.env.DOUYIN_OBSERVE_SYNC_TIMEZONE
    ? { timezone: process.env.DOUYIN_OBSERVE_SYNC_TIMEZONE }
    : {}),
});
await registerDouyinPublishPollingSchedule(jobRuntime, {
  ...(process.env.DOUYIN_PUBLISH_POLLING_CRON
    ? { cron: process.env.DOUYIN_PUBLISH_POLLING_CRON }
    : {}),
  ...(process.env.DOUYIN_PUBLISH_POLLING_TIMEZONE
    ? { timezone: process.env.DOUYIN_PUBLISH_POLLING_TIMEZONE }
    : {}),
});
const createCopyProviders = (bridge: ProductCopyProviderBridge) => ({
  domestic: new ModelSupplyProductCopyProvider(
    bridge,
    { catalogModelId: 'llm-domestic', mode: 'fixed' },
    'domestic',
    resolveCopySelection,
    resolveCopyPrompt
  ),
  standard: new ModelSupplyProductCopyProvider(
    bridge,
    { mode: 'auto', profile: 'quality' },
    'overseas',
    resolveCopySelection,
    resolveCopyPrompt
  ),
});
const qualitySink: ProductQualitySink = {
  async record(workspaceId, event) {
    await modelControlPlane.recordQuality(workspaceId, event);
  },
};
const legacyProductService = new ProductService(
  productRepository,
  notifier,
  productPlans,
  createCopyProviders(legacyCopyBridge),
  qualitySink,
  legacyInFlightDecisions,
  'legacy',
  {
    contentWriteOwnership: contentPackageWriteOwnership,
    packageRightsPropagation,
  }
);
const relationalProductService = new ProductService(
  relationalProductRepository,
  notifier,
  productPlans,
  createCopyProviders(p1CopyBridge),
  qualitySink,
  legacyInFlightDecisions,
  'p1',
  {
    contentWriteOwnership: contentPackageWriteOwnership,
    copyUsageAuthority: 'foundation_ledger',
    legacyVideoPath: 'disabled',
    packageRightsPropagation,
    searchProjection: new OperationsProductSearchProjection(
      operationsRepository
    ),
    usageProjection: {
      async getCopyProjection(context) {
        const { actor: _actor, ...foundationContext } = context;
        const projection = await foundationLedgerService.getUsageProjection(
          foundationContext,
          'copy'
        );
        return {
          allowance: projection.allowance,
          available: projection.available,
        };
      },
    },
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
  () => operationsService
);
operationsService = new OperationsApplicationService(operationsRepository, {
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
  contentPackageMigration,
  contentWriteOwnership: contentPackageWriteOwnership,
  assetDataClassResolver: new ProductAssetDataClassResolver(
    relationalProductRepository
  ),
  batchExecutor,
  canvasExporter: new PersistentCanvasExportAdapter(assetStorage),
  creationExecutor: new ModelSupplyCreationExecutor(
    modelControlPlane,
    aiStreamingRunner,
    referenceAssets
  ),
  groundingResolver: new ProductCreativeGroundingResolver(
    relationalProductRepository
  ),
  imageGenerator: new ModelSupplyImageGenerationAdapter(
    p1ModelSupplyService,
    initializeWorkspaceCatalog
  ),
  mediaCustodyStorage: new MediaCustodyStorageAdapter(
    referenceAssets,
    assetStorage
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
  triggerScheduler: entitlementJobRuntime,
});
const integrationTaskAdapter = new OperationsConfirmationTaskAdapter(
  operationsService
);
integrationService.attachConfirmationTaskPort(integrationTaskAdapter);
integrationService.attachAnomalyTaskPort(integrationTaskAdapter);
await operationsService.seedOfficialTemplateFamilies({
  actor: 'admin',
  correlationId: 'system-template-seed',
  userId: 'system-template-admin',
  workspaceId: '__system__',
});
const p1ApplicationService = new P1ApplicationService(foundationRepository, {
  operations: [
    new AdvancedCanvasAdoptionFoundationModule(
      new PostgresAdvancedCanvasAdoptionService(pool)
    ),
    new AdminConfigFoundationModule(adminConfigRepository, {
      activationEvidenceStatus: modelRuntime.activation,
      adminActorIds: modelAdminActorIds,
      runtime: adminConfigRuntime,
      valueValidators: runtimeModeValidatorsFromEnv(process.env),
      hotReadKeys: [
        'plan.addons',
        'plan.allowances.starter',
        'plan.allowances.growth',
        'plan.allowances.pro',
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
      ],
      wiredKeys: [
        'byok.adapter.assembly',
        'douyin.adapter.assembly',
        'model.execution.mode',
        'model.media.execution.mode',
        'plan.addons',
        'plan.allowances.starter',
        'plan.allowances.growth',
        'plan.allowances.pro',
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
      ],
    }),
    new ProductEntitlementFoundationModule(productEntitlements, undefined, {
      recordedCommerceEnabled,
      catalogSource: new AdminConfigEntitlementCatalogSource(
        adminConfigRepository,
      ),
    }),
    new IntegrationsFoundationModule(integrationService, {
      adminActorIds: modelAdminActorIds,
      providerCredentialSources: providerCredentialRuntime.sources,
    }),
    new JobRuntimeFoundationModule(tracerJobs, entitlementJobRuntime, {
      adminActorIds: modelAdminActorIds,
      operationalMetrics: new PostgresOperationalMetricsCollector(
        pool,
        entitlementJobRuntime,
        operationalTelemetryStore
      ),
      workerActorIds: jobRuntimeWorkerActorIds,
    }),
    new ModelSupplyFoundationModule(modelControlPlane, {
      adminActorIds: modelAdminActorIds,
      composedVideo,
    }),
    new OperationsFoundationModule(operationsService, {
      adminActorIds: modelAdminActorIds,
    }),
  ],
  writeOwnershipReader: async (workspaceId) => {
    const result = await pool.query<{
      owner: 'legacy' | 'frozen' | 'p1';
    }>('SELECT owner FROM p1_write_ownership WHERE workspace_id = $1', [
      workspaceId,
    ]);
    return result.rows[0]?.owner ?? null;
  },
});
const server = createCoreServer({
  aiStreamingRunner,
  executionModeGate: streamingModeGate,
  assetReader: assetStorage,
  diagnosticRepository,
  douyinCallbackToken,
  integrationService,
  operationsService,
  productService,
  p1ApplicationService,
  serviceToken,
});
server.listen(port, '0.0.0.0', () => {
  console.log(`meiye-core listening on http://0.0.0.0:${port}`);
});

const shutdown = () => {
  server.close(() => {
    void jobRuntime
      .stop({ graceful: true })
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

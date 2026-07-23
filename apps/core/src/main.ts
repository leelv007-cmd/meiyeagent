import { DBOS } from '@dbos-inc/dbos-sdk';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresDiagnosticRepository } from './diagnostics/postgres-repository.js';
import { assertStrongSecret } from './security/secret-hardening.js';
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
  assembleCapabilitiesFromEnv,
  composeRuntimeTruth,
  isProtectedAppEnv,
} from './runtime-truth/index.js';
import {
  closeHttpServerWithDeadline,
  shutdownCoreRuntime,
} from './server-shutdown.js';
import {
  AdminConfigFoundationModule,
  AdminConfigEntitlementCatalogSource,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
  ModeGateExecutionPort,
  ModeGateMediaLifecyclePort,
  createModelExecutionModeGate,
  PostgresAdminConfigRepository,
  modelRuntimeAssemblyFromSources,
  integrationAdapterEnvFromSources,
  runtimeModeValidatorsFromProviderCredentials,
} from './p1/admin-config/index.js';
import {
  CompositeProductEntitlementPolicy,
  DEFAULT_ADD_ON_OFFERS,
  DEFAULT_PLAN_OFFERS,
  GrantLotAwareProductEntitlementService,
  P1DomainError,
  P1ApplicationService,
  PostgresFoundationRepository,
  ProductEntitlementFoundationModule,
  RecordedAutoTopUpPaymentPort,
  PostgresGrantLotLedger,
  PostgresRedemptionStore,
  RedemptionApplicationService,
  RedemptionFoundationModule,
} from './p1/foundation/index.js';
import { e2ePlatformModelDefaultsFromEnv } from './p1/foundation/e2e-platform-model-defaults.js';
import {
  CloudflareInventoryAdapter,
  runCloudflareSelfProbes,
} from './p1/cloudflare-read/index.js';
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
  createProviderCredentialSecretBroker,
  migrateProviderCredentialAccountsFromIntegrations,
  ProviderCredentialAccountProvisioner,
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
  type ActivationEvidence,
  CompositeReferenceAssetResolver,
  DurableComposedVideoApplicationService,
  DurableMediaGenerationApplicationService,
  modelAssetStorageFromEnv,
  FixtureAiStreamingRunner,
  FoundationModelSupplyLedger,
  MediaActivationProbeExecutor,
  ModelSupplyFoundationModule,
  isLiveVerifiedActivationEvidence,
  OwnedAssetReferenceResolver,
  OpenAiCompatibleAiSdkRunner,
  PersistentContentWorkflowRunner,
  PostgresCanonicalVideoRunStore,
  PostgresCanonicalVideoWorkflowSchema,
  ProductCopyProviderBridge,
  PostgresModelSupplyRepository,
  PostgresVideoRegenerationRepository,
  ProductReferenceAssetResolver,
  RecordedFixtureVideoQualityScorer,
  VideoRegenerationApplicationService,
  VideoRegenerationFoundationModule,
  VersionedHumanCalibratedVideoQualityScorer,
  createModelSupplyRuntime,
  modelMediaExecutionMode,
  seedCapabilityHotAssemblyFromCatalog,
  RECORDED_CATALOG_REVISION_ID,
  videoCompositionRuntimeFromEnv,
} from './p1/model-supply/index.js';
import { createPermissionAuthorizer } from './p1/capability-permission/index.js';
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
  createPostgresAdminSupplyControlPlane,
  PostgresAdminSupplyMigration,
  PostgresCredentialRotationReceiptStore,
  PostgresCapabilityHotAssemblyMigration,
  PostgresCapabilityHotAssemblyPort,
  ProductionAdminProviderEvidence,
  PostgresSupplyControlPlaneRepository,
  PostgresSupplyPlanningControlPlane,
  PostgresSupplyPlanningMigration,
} from './p1/supply-registry/index.js';
import {
  ModelSupplyStructuredNodeRunner,
} from './p1/model-supply/structured-node-runner.js';
import { HarnessApplicationService } from './p1/harness/application-service.js';
import { HarnessDecisionService } from './p1/harness/decision-service.js';
import { HarnessDbosWorkflowEventReader } from './p1/harness/dbos-workflow-events.js';
import { HarnessLangfuseOutboxWorker } from './p1/harness/outbox-worker.js';
import { langfuseSenderFromEnv } from './p1/harness/langfuse-sender.js';
import { langfusePromptResolverFromEnv } from './p1/harness/langfuse-prompts.js';
import { PostgresHarnessResumeReconcilerStore } from './p1/harness/postgres-resume-reconciler-store.js';
import { HarnessResumeReconciler } from './p1/harness/resume-reconciler.js';
import {
  DbosHarnessWorkflowStarter,
  registerHarnessDbosWorkflow,
  resumeHarnessDbosWorkflow,
} from './p1/harness/dbos-workflow.js';
import { LedgerBackedHarnessContextPort } from './p1/harness/production-context-port.js';
import { ProductionHarnessStagePorts } from './p1/harness/production-stage-ports.js';
import {
  ModelSupplyHarnessMediaExecutionPort,
  UnifiedHarnessStagePorts,
} from './p1/harness/unified-media-stage-ports.js';
import { PostgresHarnessStore } from './p1/harness/postgres-store.js';
import {
  assertPendingActionsShareDatabase,
  readHarnessRuntimeConfig,
} from './p1/harness/runtime-config.js';
import {
  createHarnessStructuredModelExecutor,
} from './p1/harness/structured-model-runtime.js';
import { HarnessTaskAdmissionService } from './p1/harness/task-admission.js';
import {
  CapabilityHotAssemblyComposerReadiness,
  ComposerSubmissionAdmissionGate,
} from './p1/execution-spine/composer-submission-gate.js';
import { PostgresContentPackageRevisionWritePort } from './p1/execution-spine/content-package-revision-port.js';
import { CreationStagePort } from './p1/execution-spine/creation-stage-port.js';
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from './p1/execution-spine/postgres-creation-submission-store.js';
import { ExecutionSourceContentPackageResolver } from './p1/execution-spine/source-content-package-resolver.js';
import { CreationSubmissionCoordinator } from './p1/execution-spine/submission-coordinator.js';
import { PendingActionsService } from './p1/pending-actions.js';
import {
  AssetIntakeService,
  AssetMemoryFoundationModule,
  OperationsApplicationService,
  OperationsFoundationModule,
  OperationsVideoContentPackageAdapter,
  ModelSupplyCreationExecutor,
  ModelSupplyImageGenerationAdapter,
  MediaCustodyStorageAdapter,
  MarketingIdentityFoundationModule,
  OperationsProductSearchProjection,
  OperationsProductPackageRightsAdapter,
  ProductContentPackageRightsResolver,
  OperationsReusableAssetSourceVerifier,
  ReuseMemoryService,
  ReuseTaskHarnessAdapter,
  ContentPackageMigrationService,
  ContentPackageDeliveryService,
  createContextInvalidationRuntime,
  ExpiredFactInvalidationWorker,
  ContextBundleApprovalPolicyResolver,
  ProductLegacyDeliveryProjection,
  ContextFoundationModule,
  ContentPackageZipExportAdapter,
  HeadGetContentPackageOwnedReceiptVerifier,
  OperationsCanvasExportAssetAccessService,
  OperationsContentPackageExportAssetReader,
  PostgresContentPackageMigrationRunRepository,
  PostgresContentPackageMigrationSource,
  PostgresOperationsRepository,
  PostgresContentPackageWriteOwnership,
  PostgresAssetIntakeRepository,
  PostgresContextBundleRepository,
  PostgresContextSourceRevisionRepository,
  PostgresMarketingIdentityRepository,
  PostgresReuseMemoryRepository,
  PostgresStoreFactLedger,
  contentPackageDeliveryCapability,
  ProductOperationsBatchExecutionAdapter,
  PersistentCanvasExportAdapter,
} from './p1/operations/index.js';
import { LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY } from './pro-studio-runtime/provider-reference-policy.js';
import {
  migrateProStudioSchema,
  PostgresAdvancedCanvasProjectRepository,
  PostgresCanvasAssetRepository,
} from './pro-studio/index.js';
import {
  AdvancedCanvasAdoptionFoundationModule,
  migrateProStudioWorkspaceState,
  PostgresAdvancedCanvasAdoptionService,
} from './pro-studio-runtime/index.js';
import { migratePostgresSchema } from './postgres-schema-migration.js';
import {
  HarnessWorkflowEventSource,
  VideoWorkflowEventSource,
  WorkflowEventApplicationService,
} from './p1/workflow-events.js';
import {
  createDurableCreationExperienceRuntime,
} from './p1/creation-experience/index.js';
import {
  CatalogProductQuoteAuthority,
  DurableProductBillingService,
  PostgresProductBillingRepository,
  ProductBillingFoundationModule,
} from './p1/product-billing/index.js';
import {
  createDurableResultDeliveryRuntime,
  ResultDeliveryFoundationModule,
} from './p1/result-delivery/index.js';
import {
  OperationsResultCommandPort,
  OperationsVisualAdoptionPort,
} from './p1/result-delivery/operations-visual-adoption.js';

const databaseUrl = process.env.DATABASE_URL;
const serviceToken = process.env.CORE_SERVICE_TOKEN;
const douyinCallbackToken = process.env.DOUYIN_CALLBACK_TOKEN;
const recordedCommerceEnabled =
  process.env.P1_RECORDED_COMMERCE_ENABLED === '1';
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
assertStrongSecret('CORE_SERVICE_TOKEN', serviceToken);
assertStrongSecret('DOUYIN_CALLBACK_TOKEN', douyinCallbackToken);
if (douyinCallbackToken === serviceToken) {
  throw new Error('DOUYIN_CALLBACK_TOKEN must differ from CORE_SERVICE_TOKEN.');
}

const harnessRuntimeConfig = process.env.HARNESS_DBOS_SYSTEM_DATABASE_URL
  ? readHarnessRuntimeConfig(process.env)
  : undefined;
const pool = new Pool({
  connectionString: databaseUrl,
  ...(harnessRuntimeConfig
    ? { max: harnessRuntimeConfig.businessPoolMax }
    : {}),
});
const canvasProjects = new PostgresAdvancedCanvasProjectRepository(pool);
const diagnosticRepository = new PostgresDiagnosticRepository(pool);
const productRepository = new PostgresProductRepository(pool);
const relationalProductRepository = new PostgresRelationalProductRepository(
  pool
);
const assetStorage = modelAssetStorageFromEnv(process.env);
const canvasAssetRepository = new PostgresCanvasAssetRepository(pool);
const ownedReferenceAssets = new OwnedAssetReferenceResolver(
  canvasAssetRepository,
  {
    async head(objectKey) {
      return assetStorage.head(objectKey);
    },
    async read(objectKey) {
      return (await assetStorage.read(objectKey)).bytes;
    },
  },
);
const productReferenceAssets = new ProductReferenceAssetResolver(
  relationalProductRepository,
  {
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    serviceToken,
  },
);
const referenceAssets = new CompositeReferenceAssetResolver([
  ownedReferenceAssets,
  productReferenceAssets,
]);
const foundationRepository = new PostgresFoundationRepository(pool);
const grantLotLedger = new PostgresGrantLotLedger(pool);
const redemptionStore = new PostgresRedemptionStore(pool);
const operationsRepository = new PostgresOperationsRepository(pool);
const productBillingRepository = new PostgresProductBillingRepository(pool);
const storeFactLedger = new PostgresStoreFactLedger(pool);
const contextBundleRepository = new PostgresContextBundleRepository(pool);
const contextSourceRevisions = new PostgresContextSourceRevisionRepository(pool);
const marketingIdentities = new PostgresMarketingIdentityRepository(pool);
const assetIntakeRepository = new PostgresAssetIntakeRepository(pool);
const reuseMemoryRepository = new PostgresReuseMemoryRepository(pool);
const contentPackageWriteOwnership = new PostgresContentPackageWriteOwnership(
  pool
);
const contentPackageMigrationRuns =
  new PostgresContentPackageMigrationRunRepository(pool);
const contentPackageMigration = new ContentPackageMigrationService({
  ownedReceiptVerifier: new HeadGetContentPackageOwnedReceiptVerifier({
    async get(objectKey) {
      return (await assetStorage.read(objectKey)).bytes;
    },
    async head(objectKey) {
      try {
        const stored = await assetStorage.read(objectKey);
        return {
          contentType: stored.contentType,
          sizeBytes: stored.bytes.byteLength,
        };
      } catch {
        return null;
      }
    },
  }),
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
const cloudflareMapping = {
  internalRef: process.env.CLOUDFLARE_MAPPING_REF ?? 'shell-production',
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  scriptName: process.env.CLOUDFLARE_SCRIPT_NAME,
  r2BucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
  hyperdriveConfigId: process.env.CLOUDFLARE_HYPERDRIVE_CONFIG_ID,
  verified: process.env.CLOUDFLARE_MAPPING_VERIFIED === 'true',
};
const cloudflareInventory = new CloudflareInventoryAdapter({
  apiToken: process.env.CLOUDFLARE_INVENTORY_READ_TOKEN,
  mapping: cloudflareMapping,
});
const integrationRepository = new PostgresIntegrationRepository(pool);
const supplyControlRepository = new PostgresSupplyControlPlaneRepository(pool);
const supplyPlanningControlPlane = new PostgresSupplyPlanningControlPlane(
  pool,
  PLATFORM_SUPPLY_SCOPE_ID,
);
await migratePostgresSchema(pool, [
  adminConfigRepository,
  integrationRepository,
  supplyControlRepository,
  new PostgresCapabilityHotAssemblyMigration(),
  new PostgresSupplyPlanningMigration(),
  new PostgresEntitlementPoolsMigration(),
  new PostgresAdminSupplyMigration(),
]);
const integrationSecrets = integrationSecretStoreFromEnv(process.env);
const credentialRotationReceipts = new PostgresCredentialRotationReceiptStore(
  pool,
  async (binding) => {
    await integrationSecrets.use(binding.secretReference, {
      workspaceId: binding.workspaceId,
      credentialId: binding.credentialId,
      version: binding.secretVersion,
      provider: binding.provider,
    });
  },
);
const providerCredentialOperator = new ProviderCredentialAccountProvisioner(
  supplyControlRepository,
  credentialRotationReceipts,
  integrationSecrets,
);
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
const modelSupplyRepository = new PostgresModelSupplyRepository(pool);
const videoRegenerationRepository =
  new PostgresVideoRegenerationRepository(pool);
const canonicalVideoWorkflowSchema =
  new PostgresCanonicalVideoWorkflowSchema(pool);
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
} = runtimeAssembly.assembly;
// G3 hot assembly: seed process-local capability head from boot catalog so
// HTTP reports the same boot fingerprint Worker seeds (dual-process alignment).
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
// #92 one durable ProductQuote/ProductUsage/ProviderCost lifecycle shared by
// HTTP, Operations, and model-supply across process restarts.
const productQuoteService = new DurableProductBillingService(
  productBillingRepository,
);
const billingLifecycle = productQuoteService;
const permissionAuthorizer = createPermissionAuthorizer();
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
const e2ePlatformModelDefaults = e2ePlatformModelDefaultsFromEnv(process.env);
const adminConfigRuntime = {
  'byok.adapter.assembly': byokRuntime.mode,
  'compliance.aigc_label.default': true,
  'compliance.regulated_mode.default': false,
  'compliance.watermark.default': false,
  'douyin.adapter.assembly': 'recorded',
  'model.execution.mode': modelRuntime.mode,
  'model.media.execution.mode': mediaExecutionMode,
  ...Object.fromEntries(
    Object.entries(e2ePlatformModelDefaults).map(([operation, modelId]) => [
      `platform.defaultModel.${operation}`,
      modelId,
    ])
  ),
  'plan.addons': DEFAULT_ADD_ON_OFFERS,
  'plan.allowances.trial': planConfigDefaults.trial,
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
const foundationLedgerService = new P1ApplicationService(foundationRepository);
const productEntitlementPolicy = new ProductStateEntitlementPolicy(
  relationalProductRepository,
  productPlans
);
const productEntitlements = new GrantLotAwareProductEntitlementService(
  foundationRepository,
  grantLotLedger,
  recordedCommerceEnabled ? new RecordedAutoTopUpPaymentPort() : undefined
);
const executionEntitlementPolicy = new CompositeProductEntitlementPolicy(
  productEntitlementPolicy,
  productEntitlements,
  {
    allowFoundationPlan: true,
    allowFoundationSupplements: recordedCommerceEnabled,
  }
);
const modelSupplyProviderAdmission =
  new PostgresModelSupplyProviderAdmission({
    productEntitlements: executionEntitlementPolicy,
    entitlementPolicies: entitlementPolicyStore,
    accountAllocations: accountAllocationStore,
    supplyPools: supplyPoolStore,
    capacityLeases: capacityLeaseStore,
  });
const p1ModelSupplyRuntime = createModelSupplyRuntime({
  application: {
    assetStorage,
    execution: gatedModelExecution,
    ledger: new FoundationModelSupplyLedger(
      foundationLedgerService,
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
    resultSink: modelSupplyRepository,
    submissionGate: streamingModeGate,
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
    canvasProjects,
    durationSamples: foundationRepository,
    planningControlPlane: supplyPlanningControlPlane,
    repository: modelSupplyRepository,
    supplyRegistry: supplyControlRepository,
  },
});
const p1ModelSupplyService = p1ModelSupplyRuntime.application;
const modelControlPlane = p1ModelSupplyRuntime.controlPlane;
const productQuoteAuthority = new CatalogProductQuoteAuthority(modelControlPlane);
const providerConnectivity = providerConnectivityProbeFromEnv(
  providerCredentialRuntime.env,
);
const adminProviderEvidence = new ProductionAdminProviderEvidence({
  registry: supplyControlRepository,
  pools: supplyPoolStore,
  credentials: providerCredentialSecretBroker,
  connectivity: providerConnectivity,
  conformance: modelControlPlane,
  health: supplyPlanningControlPlane.health,
  verification: providerCredentialOperator,
  credentialWorkspaceId: '__global__',
});
const adminSupplyControlPlane = createPostgresAdminSupplyControlPlane({
  pool,
  permission: permissionAuthorizer,
  registry: supplyControlRepository,
  pools: supplyPoolStore,
  entitlementPolicies: entitlementPolicyStore,
  accountAllocations: accountAllocationStore,
  planning: supplyPlanningControlPlane,
  hotAssembly: capabilityHotAssembly,
  modelControlPlane,
  modelRepository: modelSupplyRepository,
  credentialRotations: credentialRotationReceipts,
  providerProbes: adminProviderEvidence,
  operationalEvidence: adminProviderEvidence,
});
{
  const view = await capabilityHotAssembly.reportProcessView('http');
  const defaultSupplyPool = await supplyPoolStore.get('pool-shared-default');
  console.log(
    `[z2-wiring] http capability revision=${view.effectiveCapabilityRevisionId ?? 'none'} catalog=${view.effectiveCatalogRevisionId ?? 'none'} supplyPool=${defaultSupplyPool?.id ?? 'missing'}`,
  );
}
const legacyModelSupplyRuntime = createModelSupplyRuntime({
  application: {
    assetStorage,
    execution: gatedModelExecution,
    resultSink: modelSupplyRepository,
  },
  catalog: runtimeAssembly.assembly,
  controlPlane: { repository: modelSupplyRepository },
});
const legacyModelSupplyService = legacyModelSupplyRuntime.application;
const legacyModelControlPlane = legacyModelSupplyRuntime.controlPlane;
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
  grantLotLedger,
  redemptionStore,
  adminConfigRepository,
  operationsRepository,
  productBillingRepository,
  storeFactLedger,
  contextBundleRepository,
  contextSourceRevisions,
  marketingIdentities,
  assetIntakeRepository,
  reuseMemoryRepository,
  contentPackageWriteOwnership,
  contentPackageMigrationRuns,
  modelSupplyRepository,
  canonicalVideoWorkflowSchema,
  videoRegenerationRepository,
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
      ...(modelRuntime.mode === 'fixture'
        ? { referencePolicy: LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY }
        : {}),
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
    new PostgresCanonicalVideoRunStore(pool, workspaceId),
    modelRuntime.mode === 'fixture'
      ? new RecordedFixtureVideoQualityScorer()
      : new VersionedHumanCalibratedVideoQualityScorer()
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
const videoRegeneration = new VideoRegenerationApplicationService({
  approvalAuthority: {
    async approve(input) {
      const membership = await pool.query<{ role: string }>(
        `SELECT role
           FROM workspace_memberships
          WHERE workspace_id = $1
            AND user_id = $2`,
        [input.workspaceId, input.actorId],
      );
      const actor = membership.rows[0]?.role;
      if (
        actor !== 'admin' &&
        actor !== 'owner' &&
        actor !== 'operator' &&
        actor !== 'reviewer'
      ) {
        throw new Error(
          'Video regeneration approval requires an active workspace membership.',
        );
      }
      return operationsService.approveCreativeGeneration(
        {
          actor,
          correlationId: input.approvalKey,
          userId: input.actorId,
          workspaceId: input.workspaceId,
        },
        {
          approvalKey: input.approvalKey,
          contract: input.contract,
          workId: input.workId,
        },
      );
    },
  },
  billing: productQuoteService,
  quoteAuthority: productQuoteAuthority,
  repository: videoRegenerationRepository,
  workflows: composedVideo,
});
const videoWorkflowEventSource = new VideoWorkflowEventSource({
  async owns(workspaceId, workflowId) {
    const result = await pool.query(
      `SELECT 1 FROM p1_creative_jobs
        WHERE workspace_id = $1
          AND payload->>'videoWorkflowId' = $2`,
      [workspaceId, workflowId]
    );
    return result.rowCount === 1;
  },
  readSnapshot(workspaceId, workflowId) {
    return composedVideo.query({ workspaceId, workflowId });
  },
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
        const projection = await productEntitlements.getProjection(
          foundationContext
        );
        return {
          allowance: projection.usage.copy.allowance,
          available: projection.usage.copy.available,
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
const contentPackageRightsResolver = new ProductContentPackageRightsResolver(
  relationalProductRepository
);
const contentPackageExportAssets = new OperationsContentPackageExportAssetReader(
  operationsRepository,
  assetStorage,
  referenceAssets
);
const canvasExportAssetAccess = new OperationsCanvasExportAssetAccessService({
  canvasAssets: canvasAssetRepository,
  contentPackageAssets: contentPackageExportAssets,
  contentPackageRights: contentPackageRightsResolver,
  ownedAssetStorage: assetStorage,
  productAssets: productReferenceAssets,
  productPolicy: contentPackageRightsResolver,
});
const sourceContentPackageReader = {
  async get(input: { packageId: string; workspaceId: string }) {
    return (
      (await operationsRepository.loadWorkspace(input.workspaceId))?.contentPackages.find(
        (contentPackage) => contentPackage.id === input.packageId
      ) ?? null
    );
  },
};
const sourceContentPackages = new ExecutionSourceContentPackageResolver(
  sourceContentPackageReader,
  contentPackageRightsResolver
);
const sourceContentPackageAdmissionReader = {
  async get(input: { packageId: string; workspaceId: string }) {
    const contentPackage = await sourceContentPackageReader.get(input);
    return contentPackage
      ? {
          id: contentPackage.id,
          revision: contentPackage.revision,
          rightsState: contentPackage.rights.state,
          status: contentPackage.status,
          workspaceId: contentPackage.workspaceId,
        }
      : null;
  },
};
operationsService = new OperationsApplicationService(operationsRepository, {
  billingLifecycle,
  canvasExportAssetAccess,
  contentPackageExporter: new ContentPackageZipExportAdapter(
    assetStorage,
    contentPackageExportAssets,
    {
      allowRecordedSyntheticVideoCompliance: process.env.APP_ENV === 'e2e',
      appEnv: process.env.APP_ENV,
    },
  ),
  contentPackageRightsResolver,
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
    referenceAssets,
    composedVideo
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
const assetIntakeService = new AssetIntakeService(
  assetIntakeRepository,
  storeFactLedger,
  undefined,
  {
    async isAuthorized(workspaceId, assetId) {
      const [inspection] = await referenceAssets.inspect(workspaceId, [
        assetId,
      ]);
      return inspection?.kind === 'resolved';
    },
  }
);
const reuseMemoryService = new ReuseMemoryService(
  reuseMemoryRepository,
  new OperationsReusableAssetSourceVerifier(
    operationsService,
    contentPackageRightsResolver,
    contextBundleRepository
  )
);
let harnessService: HarnessApplicationService | undefined;
let composerSubmissionCoordinator: CreationSubmissionCoordinator | undefined;
// Pending-actions is an unconditional platform service (Z2-WIRING / #94 handoff).
// Harness questions need the harness_runtime schema; approvals come from operations.
const pendingActionsQuestionStore = new PostgresHarnessStore(pool);
await pendingActionsQuestionStore.applySchema();
if (harnessRuntimeConfig) {
  assertPendingActionsShareDatabase({
    approvalRequestsDatabaseUrl: databaseUrl,
    pendingQuestionsDatabaseUrl: harnessRuntimeConfig.businessDatabaseUrl,
  });
}
const pendingActions: PendingActionsService = new PendingActionsService(
  pendingActionsQuestionStore,
  operationsRepository
);
const resultDeliveryRuntime = await createDurableResultDeliveryRuntime({
  operations: operationsRepository,
  pendingActions: {
    async list(input) {
      return (await pendingActions.list(input)).filter(
        (item) =>
          'kind' in item &&
          (item.kind === 'question' || item.kind === 'approval'),
      );
    },
  },
  pool,
});
const reuseTaskHarnessAdapter = new ReuseTaskHarnessAdapter(
  () => harnessService
);
const contentPackageDelivery = new ContentPackageDeliveryService(
  operationsRepository,
  {
    approvalPolicy: new ContextBundleApprovalPolicyResolver(
      contextBundleRepository,
      {
        sourceRevisions: contextSourceRevisions,
        facts: storeFactLedger,
      }
    ),
    capability: async (platform) =>
      contentPackageDeliveryCapability({
        accountAndScopeVerified: false,
        callbackVerified: false,
        exportAvailable: true,
        liveAdapter: false,
        platform,
        publishRecoveryVerified: false,
        snapshotSource: 'legacy_handoff',
        submitAndPollVerified: false,
      }),
    legacy: new ProductLegacyDeliveryProjection(productRepository),
    publisher: {
      async publish() {
        throw new Error(
          'Automatic ContentPackage publishing is not live-verified.'
        );
      },
    },
  }
);
const contextInvalidationRuntime = createContextInvalidationRuntime({
  bundles: contextBundleRepository,
  sinks: [contentPackageDelivery],
});
const expiredFactInvalidationWorker = new ExpiredFactInvalidationWorker(
  storeFactLedger,
  contextInvalidationRuntime.service,
);
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

// Z1/#105 thin wiring — independent FoundationModules (S1 freeze discipline).
const creationExperienceRuntime =
  await createDurableCreationExperienceRuntime({
    modelCatalog: modelSupplyRepository,
    pool,
    productQuotes: productBillingRepository,
  });
operationsService.attachBriefSubmissionGate(
  creationExperienceRuntime.briefSubmissionGate,
);
const visualAdoptionService = new OperationsVisualAdoptionPort(
  operationsService,
);
const resultCommands = new OperationsResultCommandPort(
  operationsService,
  productQuoteService,
);

const p1ApplicationService = new P1ApplicationService(foundationRepository, {
  // K1 authorizer port — internal executeModule/queryModule default-deny (Z2-WIRING).
  authorizer: permissionAuthorizer,
  operations: [
    new AdvancedCanvasAdoptionFoundationModule(
      new PostgresAdvancedCanvasAdoptionService(pool)
    ),
    creationExperienceRuntime.foundationModule,
    new ProductBillingFoundationModule(
      productQuoteService,
      productQuoteAuthority,
    ),
    new ResultDeliveryFoundationModule(
      visualAdoptionService,
      { ...resultDeliveryRuntime, commands: resultCommands },
    ),
    new AdminConfigFoundationModule(adminConfigRepository, {
      activationEvidenceStatus: modelRuntime.activation,
      adminActorIds: modelAdminActorIds,
      cloudflareInventory,
      cloudflareSelfProbes: () =>
        runCloudflareSelfProbes({
          shellBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
          databasePing: async () => {
            await pool.query('SELECT 1');
            return { ok: true, detail: 'select_1' };
          },
          mapping: cloudflareMapping,
          hyperdriveId: cloudflareMapping.hyperdriveConfigId,
        }),
      runtime: adminConfigRuntime,
      valueValidators: runtimeModeValidatorsFromProviderCredentials(
        providerCredentialRuntime,
      ),
      hotReadKeys: [
        HARNESS_WOZ_RECIPE_CONFIG_KEY,
        'plan.addons',
        'plan.allowances.trial',
        'plan.allowances.starter',
        'plan.allowances.growth',
        'plan.allowances.pro',
        'platform.defaultModel.copy',
        'platform.defaultModel.image',
        'platform.defaultModel.video',
        'platform.defaultModel.audio',
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
      ],
      wiredKeys: [
        HARNESS_WOZ_RECIPE_CONFIG_KEY,
        'byok.adapter.assembly',
        'douyin.adapter.assembly',
        'model.execution.mode',
        'model.media.execution.mode',
        'plan.addons',
        'plan.allowances.trial',
        'plan.allowances.starter',
        'plan.allowances.growth',
        'plan.allowances.pro',
        'platform.defaultModel.copy',
        'platform.defaultModel.image',
        'platform.defaultModel.video',
        'platform.defaultModel.audio',
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
      ],
    }),
    new ContextFoundationModule(
      storeFactLedger,
      contextBundleRepository,
      contextSourceRevisions,
      undefined,
      async (workspaceId) =>
        (
          await adminConfigRepository.get(
            'workspace',
            workspaceId,
            HARNESS_WOZ_RECIPE_CONFIG_KEY,
          )
        )?.revision ?? 0,
    ),
    new ProductEntitlementFoundationModule(productEntitlements, undefined, {
      recordedCommerceEnabled,
      catalogSource: new AdminConfigEntitlementCatalogSource(
        adminConfigRepository,
      ),
      modelDefaults: {
        async getDefaults() {
          const keys = [
            'copy',
            'image',
            'video',
            'audio',
          ] as const;
          const entries = await Promise.all(
            keys.map(async (operation) => {
              const row = await adminConfigRepository.get(
                'global',
                '__global__',
                `platform.defaultModel.${operation}`,
              );
              const value =
                typeof row?.value === 'string' ? row.value.trim() : '';
              const resolvedValue =
                value || e2ePlatformModelDefaults[operation];
              return resolvedValue
                ? ([operation, resolvedValue] as const)
                : null;
            }),
          );
          return Object.fromEntries(
            entries.filter((entry): entry is readonly [typeof keys[number], string] => entry !== null),
          );
        },
        async validateDefault(operation, modelId) {
          const model = models.find(
            (candidate) =>
              candidate.id === modelId && candidate.operations.includes(operation),
          );
          if (!model) {
            throw new P1DomainError(
              'INVALID_STATE',
              `Platform default model ${modelId} does not support ${operation}.`,
            );
          }
          const candidates = deployments.filter(
            (deployment) =>
              deployment.catalogModelId === modelId &&
              deployment.status === 'active' &&
              deployment.credentialMode !== 'byok_strict' &&
              deployment.credentialOwner !== 'workspace_byok',
          );
          if (
            modelRuntime.mode === 'fixture' &&
            Object.values(e2ePlatformModelDefaults).includes(modelId) &&
            candidates.length > 0
          ) {
            return;
          }
          for (const deployment of candidates) {
            const configurationRevision =
              runtimeAssembly.assembly.configurationRevisions[deployment.id];
            if (!configurationRevision) continue;
            const evidence = await adminConfigRepository.get(
              'global',
              '__global__',
              `model.activation.evidence.${deployment.id}`,
            );
            const activationEvidence = evidence?.value as
              | ActivationEvidence
              | undefined;
            if (
              isLiveVerifiedActivationEvidence(activationEvidence) &&
              activationEvidence?.configurationRevision === configurationRevision
            ) {
              return;
            }
          }
          throw new P1DomainError(
            'INVALID_STATE',
            `Platform default model ${modelId} is not live verified for ${operation}.`,
          );
        },
        async setWorkspaceDefault(workspaceId, operation, modelId) {
          // Preference only — does not copy platform probe evidence into tenant catalog (GL-16).
          await modelSupplyRepository.setWorkspaceDefault(
            workspaceId,
            operation,
            modelId,
          );
        },
      },
    }),
    new RedemptionFoundationModule(
      new RedemptionApplicationService(redemptionStore),
    ),
    new IntegrationsFoundationModule(integrationService, {
      adminActorIds: modelAdminActorIds,
      providerCredentialOperator,
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
      adminSupply: adminSupplyControlPlane,
      composedVideo,
    }),
    new VideoRegenerationFoundationModule(videoRegeneration),
    new MarketingIdentityFoundationModule(marketingIdentities),
    new AssetMemoryFoundationModule(
      assetIntakeService,
      contextBundleRepository,
      reuseMemoryService,
      reuseTaskHarnessAdapter
    ),
    new OperationsFoundationModule(operationsService, {
      adminActorIds: modelAdminActorIds,
      delivery: contentPackageDelivery,
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
let harnessWorkflowEventSource: HarnessWorkflowEventSource | undefined;
let harnessCompensationInterval: ReturnType<typeof setInterval> | undefined;
let expirationInvalidationInterval: ReturnType<typeof setInterval> | undefined;
let expirationInvalidationRunning = false;
const expirationInvalidationWorkerId =
  process.env.P1_FACT_EXPIRATION_WORKER_ID ?? `core-${randomUUID()}`;
const runExpirationInvalidation = async () => {
  if (expirationInvalidationRunning) return;
  expirationInvalidationRunning = true;
  try {
    const result = await expiredFactInvalidationWorker.runOnce(
      expirationInvalidationWorkerId,
    );
    if (result.deadLettered > 0) {
      console.error('Expired fact invalidation reached dead letter.', result);
    }
    if (result.lost > 0) {
      console.warn('Expired fact invalidation claim was lost.', result);
    }
  } catch (error) {
    console.error('Expired fact invalidation iteration failed.', error);
  } finally {
    expirationInvalidationRunning = false;
  }
};
expirationInvalidationInterval = setInterval(
  () => void runExpirationInvalidation(),
  Number(process.env.P1_FACT_EXPIRATION_POLL_MS ?? 1_000),
);
expirationInvalidationInterval.unref();
void runExpirationInvalidation();
if (harnessRuntimeConfig) {
  const structuredExecutor = createHarnessStructuredModelExecutor(modelRuntime);
  // Reuse the unconditionally applied pending-actions harness store for DBOS.
  const harnessStore = pendingActionsQuestionStore;
  const contentPackageRevisionWriter =
    new PostgresContentPackageRevisionWritePort(
      pool,
      contentPackageRightsResolver
    );
  await contentPackageRevisionWriter.applySchema();
  const creationSubmissionStore = new PostgresCreationSubmissionStore(
    pool,
    new PostgresCreationSubmissionPersistence(
      new PostgresProductBillingUsageReservation(pool)
    )
  );
  await creationSubmissionStore.migrate();
  const structuredNodeRunnerFactory = {
    create({ workspaceId, actorId }: { workspaceId: string; actorId: string }) {
      return new ModelSupplyStructuredNodeRunner({
        application: p1ModelSupplyService,
        executor: structuredExecutor,
        workspaceId,
        actorId,
        selection: { mode: 'auto', profile: 'quality' },
      });
    },
  };
  const copyHarnessStages = new ProductionHarnessStagePorts(
    structuredNodeRunnerFactory,
    new LedgerBackedHarnessContextPort(
      storeFactLedger,
      contextBundleRepository,
      () => new Date().toISOString(),
      contextSourceRevisions,
      async (workspaceId) =>
        (
          await adminConfigRepository.get(
            'workspace',
            workspaceId,
            HARNESS_WOZ_RECIPE_CONFIG_KEY
          )
        )?.revision ?? 0,
      reuseMemoryService,
      contentPackageRightsResolver,
      marketingIdentities,
      sourceContentPackages
    ),
    harnessStore,
    () => new Date().toISOString(),
    reuseMemoryService,
    contentPackageRevisionWriter,
    sourceContentPackages
  );
  // Single wiring owner: wrap copy ports so image/video share the same
  // Coordinator → StagePort → Harness path (#139/#140).
  const harnessStages = new UnifiedHarnessStagePorts(
    copyHarnessStages,
    structuredNodeRunnerFactory,
    new ModelSupplyHarnessMediaExecutionPort(p1ModelSupplyService),
    contentPackageRevisionWriter,
    () => new Date().toISOString()
  );
  DBOS.setConfig(harnessRuntimeConfig.dbos);
  const harnessWorkflow = registerHarnessDbosWorkflow(
    harnessStages,
    harnessStore,
  );
  await DBOS.launch();
  const workflowResumer = {
    resume: (
      workspaceId: string,
      workflowId: string,
      command: Parameters<HarnessDecisionService['submit']>[2]
    ) =>
      resumeHarnessDbosWorkflow(
        workspaceId,
        workflowId,
        command,
        harnessStore,
      ),
  };
  harnessService = new HarnessApplicationService(
    new HarnessTaskAdmissionService(
      harnessStore,
      new DbosHarnessWorkflowStarter(harnessWorkflow),
      langfusePromptResolverFromEnv(process.env),
    ),
    new HarnessDecisionService(harnessStore, workflowResumer),
    harnessStore,
    harnessStore,
    harnessStore,
  );
  composerSubmissionCoordinator = new CreationSubmissionCoordinator(
    creationSubmissionStore,
    new CreationStagePort(harnessService),
    {
      createId(prefix) {
        return `${prefix}-${randomUUID()}`;
      },
      now() {
        return new Date().toISOString();
      },
    },
    new ComposerSubmissionAdmissionGate({
      assets: referenceAssets,
      briefs: creationExperienceRuntime.briefSubmissionGate,
      briefConfirmations: creationExperienceRuntime.audit,
      capabilities: new CapabilityHotAssemblyComposerReadiness(
        capabilityHotAssembly
      ),
      catalog: creationExperienceRuntime.repository,
      identities: marketingIdentities,
      quotes: productQuoteService,
      rights: contentPackageRightsResolver,
      routes: foundationRepository,
      sourcePackages: sourceContentPackageAdmissionReader,
    })
  );
  await composerSubmissionCoordinator.recoverPendingStarts();
  harnessWorkflowEventSource = new HarnessWorkflowEventSource(
    new HarnessDbosWorkflowEventReader(harnessStore),
  );
  const outboxWorker = new HarnessLangfuseOutboxWorker(
    harnessStore,
    langfuseSenderFromEnv(process.env),
  );
  const resumeReconciler = new HarnessResumeReconciler(
    new PostgresHarnessResumeReconcilerStore(pool),
    workflowResumer,
  );
  let compensationRunning = false;
  const runCompensation = async () => {
    if (compensationRunning) return;
    compensationRunning = true;
    try {
      const results = await Promise.allSettled([
        outboxWorker.runOnce(),
        resumeReconciler.runOnce(),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('Harness compensation iteration failed.', result.reason);
        }
      }
    } finally {
      compensationRunning = false;
    }
  };
  harnessCompensationInterval = setInterval(
    () => void runCompensation(),
    Number(process.env.HARNESS_COMPENSATION_POLL_MS ?? 1_000),
  );
  harnessCompensationInterval.unref();
  void runCompensation();
}
const workflowEvents = new WorkflowEventApplicationService([
  ...(harnessWorkflowEventSource ? [harnessWorkflowEventSource] : []),
  videoWorkflowEventSource,
]);

// Rebuild this lightweight projection for every truth-surface request so an
// evidence artifact that expires or is replaced cannot stay verified in memory.
const resolveRuntimeTruth = () => {
  const providerEvidence = assembleCapabilitiesFromEnv(process.env);
  const providerEvidenceConfigured =
    process.env.PROVIDER_LIVE_REQUIRE_EVIDENCE === '1' ||
    Boolean(process.env.PROVIDER_LIVE_EVIDENCE_PATH?.trim()) ||
    Boolean(process.env.PROVIDER_LIVE_EVIDENCE_DIR?.trim()) ||
    isProtectedAppEnv(process.env);

  return composeRuntimeTruth({
    capabilityRecords: providerEvidence.capabilityRecords,
    env: process.env,
    probes: providerEvidenceConfigured
      ? {
          providerLive: () => providerEvidence.providerLiveReadiness,
        }
      : undefined,
    release: providerEvidence.release,
  });
};
const runtimeTruth = {
  evaluateReadiness: () => resolveRuntimeTruth().evaluateReadiness(),
  listMerchantCapabilities: () =>
    resolveRuntimeTruth().listMerchantCapabilities(),
  releaseIdentity: () => resolveRuntimeTruth().releaseIdentity(),
};

const server = createCoreServer({
  aiStreamingRunner,
  canvasTextStreams: modelControlPlane,
  executionModeGate: streamingModeGate,
  assetReader: assetStorage,
  composerSubmission: composerSubmissionCoordinator
    ? { coordinator: composerSubmissionCoordinator }
    : undefined,
  contentPackageReader: {
    read(context, packageId) {
      return operationsService.getContentPackage(context, packageId);
    },
  },
  diagnosticRepository,
  douyinCallbackToken,
  integrationService,
  harnessService,
  pendingActions,
  operationsService,
  productService,
  p1ApplicationService,
  runtimeTruth,
  serviceToken,
  workflowEvents,
});
server.listen(port, '0.0.0.0', () => {
  console.log(`meiye-core listening on http://0.0.0.0:${port}`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (expirationInvalidationInterval) {
    clearInterval(expirationInvalidationInterval);
  }
  if (harnessCompensationInterval) clearInterval(harnessCompensationInterval);
  void shutdownCoreRuntime({
    closeHttp: () => closeHttpServerWithDeadline(server, 5_000),
    shutdownDbos: () =>
      harnessRuntimeConfig ? DBOS.shutdown() : Promise.resolve(),
    stopJobs: () => jobRuntime.stop({ graceful: true }),
    closePool: () => pool.end(),
  }).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error('Core runtime shutdown failed.', error);
      process.exit(1);
    },
  );
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

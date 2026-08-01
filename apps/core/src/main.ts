import { shutdownLangfuseTracing } from './instrumentation.js';

import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
  confirmationCardTimeoutSecondsSchema,
  NOTE_STYLE_CONFIG_KEY,
} from '@meiye/contracts';
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
import { defaultProductPlanConfig } from './product/plans.js';
import {
  ModelSupplyProductCopyProvider,
  resolveCanonicalCopySelection,
} from './product/model-supply-copy-provider.js';
import {
  ProductAssetDataClassResolver,
  ProductCreativeGroundingResolver,
} from './product/p1-model-policy.js';
import { createCoreServer } from './server.js';
import {
  assembleCapabilitiesFromEnv,
  composeRuntimeTruth,
  dbosSystemDbProbe,
  isProtectedAppEnv,
  objectStorageProbe,
  outboxBacklogProbe,
  postgresqlProbe,
  schemaCompatibilityProbe,
  workerFreshnessProbe,
} from './runtime-truth/index.js';
import {
  closeHttpServerWithDeadline,
  shutdownCoreRuntime,
} from './server-shutdown.js';
import {
  AdminConfigFoundationModule,
  AdminConfigBoundedExecutionContinuationResolver,
  AdminConfigBoundedExecutionLimitsResolver,
  AdminConfigBoundedExecutionLimitsSource,
  AdminConfigEntitlementCatalogSource,
  AdminConfigNotePlanSettingsSource,
  BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  DEFAULT_HARNESS_LANGFUSE_OUTBOX_CONFIG,
  DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
  HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
  HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
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
  PostgresSensitiveWordsRepository,
  SensitiveWordsFoundationModule,
} from './p1/sensitive-words/index.js';
import {
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
  PLATFORM_DEFAULT_MODEL_CONFIG_KEY_BY_OPERATION,
  PLATFORM_DEFAULT_MODEL_CONFIG_KEYS,
  platformDefaultModelConfigName,
  type PlatformDefaultModelConfigKey,
  type PlatformDefaultModelSourcePort,
} from './p1/foundation/workspace-provision.js';
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
  DurableMediaGenerationApplicationService,
  modelAssetStorageFromEnv,
  FixtureAiStreamingRunner,
  FixtureAiStructuredObjectExecutor,
  FoundationModelSupplyLedger,
  MediaActivationProbeExecutor,
  ModelSupplyFoundationModule,
  isLiveVerifiedActivationEvidence,
  foundationOwnedReferenceAssetRepository,
  OwnedAssetReferenceResolver,
  OpenAiCompatibleAiSdkRunner,
  PostgresCanonicalVideoRunStore,
  PostgresCanonicalVideoWorkflowSchema,
  ProductCopyProviderBridge,
  PostgresModelSupplyRepository,
  ProductReferenceAssetPolicyResolver,
  ProductReferenceAssetResolver,
  createModelSupplyRuntime,
  modelMediaExecutionMode,
  projectDurableVideoWorkflow,
  seedCapabilityHotAssemblyFromCatalog,
  RECORDED_CATALOG_REVISION_ID,
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
  platformDefaultsForOperation,
  resolvePlatformDefaultBindings,
} from './p1/supply-registry/index.js';
import {
  AiSdkStructuredObjectExecutor,
  ModelSupplyStructuredNodeRunner,
} from './p1/model-supply/structured-node-runner.js';
import { HarnessApplicationService } from './p1/harness/application-service.js';
import {
  HarnessDecisionService,
} from './p1/harness/decision-service.js';
import {
  HarnessInteractionService,
  HarnessSystemDefaultProducer,
} from './p1/harness/interaction-service.js';
import { HarnessDbosWorkflowEventReader } from './p1/harness/dbos-workflow-events.js';
import { HarnessBillingCompensationWorker } from './p1/harness/billing-compensation.js';
import {
  HarnessLangfuseOutboxLoop,
  HarnessLangfuseOutboxWorker,
} from './p1/harness/outbox-worker.js';
import { langfuseSenderFromEnv } from './p1/harness/langfuse-sender.js';
import {
  assertLangfusePromptRuntimePolicy,
  langfusePromptResolverFromEnv,
  modelSupplyPromptResolverFromHarness,
  requireHarnessFrozenPrompt,
} from './p1/harness/langfuse-prompts.js';
import { PostgresHarnessResumeReconcilerStore } from './p1/harness/postgres-resume-reconciler-store.js';
import { PostgresHarnessBillingCompensationStore } from './p1/harness/postgres-billing-compensation-store.js';
import { HarnessProductBillingSettlementExecutor } from './p1/harness/product-billing-settlement.js';
import {
  DEFAULT_HOLD_RESERVATION_TTL_SECONDS,
  HarnessReservationSweeper,
} from './p1/harness/reservation-sweeper.js';
import { PostgresNoteMediaAdmissionCoordinator } from './p1/harness/note-media-admission.js';
import { unconfiguredNotePlanEnhancementJudgeResolver } from './p1/harness/note-plan-structured-port.js';
import {
  HarnessResumeReconciler,
  type HarnessResumeWorkflow,
} from './p1/harness/resume-reconciler.js';
import {
  HarnessObservabilityReconciler,
  shouldPublishObservabilityDeliverySnapshot,
} from './p1/harness/observability-reconciliation.js';
import {
  DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS,
  DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS,
  DbosHarnessWorkflowStarter,
  abandonReleasedHarnessReservation,
  registerHarnessDbosWorkflow,
  resumeHarnessDbosInteractionWorkflow,
  resumeHarnessDbosWorkflow,
} from './p1/harness/dbos-workflow.js';
import {
  LedgerBackedFactRightsAuthorizationPort,
  LedgerBackedHarnessContextPort,
} from './p1/harness/production-context-port.js';
import { createProductionHarnessMediaAssembly } from './p1/harness/production-media-assembly.js';
import { ProductionHarnessFrozenRouteSnapshotResolver } from './p1/harness/production-frozen-route.js';
import {
  ProductionHarnessStagePorts,
  type HarnessStructuredNodeRunnerFactory,
} from './p1/harness/production-stage-ports.js';
import { IMAGE_MODEL_RECIPE_PROFILE } from './p1/harness/image-intent-compiler.js';
import {
  FixtureImageExactTextVerifier,
  ModelSupplyImageExactTextVerifier,
} from './p1/harness/unified-media-stage-ports.js';
import { PostgresHarnessStore } from './p1/harness/postgres-store.js';
import { PostgresDueDeliveryRepository } from './p1/due-delivery/postgres-repository.js';
import { DueAwareHarnessRecommendationReader } from './p1/due-delivery/recommendation-reader.js';
import { TaskRecallDueProducer } from './p1/due-delivery/task-recall-producer.js';
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
import {
  StructuredComposerDestinationMapper,
  type ComposerDestinationMappingPort,
} from './p1/execution-spine/composer-destination-mapper.js';
import { ModelSupplyComposerRouteResolver } from './p1/execution-spine/composer-route-resolver.js';
import { PostgresContentPackageDestinationProjection } from './p1/execution-spine/content-package-destination-projection.js';
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
  ModelSupplyCreationExecutor,
  ModelSupplyCreationInputResolver,
  ModelSupplyImageGenerationAdapter,
  MediaCustodyStorageAdapter,
  MarketingIdentityFoundationModule,
  MemoryFoundationModule,
  ProductionMemorySedimentationCoordinator,
  StructuredMarketingIdentityDrafter,
  AdminConfigAssetIntakeGuidanceSource,
  documentParseProviderFromEnv,
  FixtureAssetDraftCompiler,
  FixtureVisualAssetClassifier,
  StoredParseSourceAssetAuthorizer,
  OperationsProductSearchProjection,
  OperationsProductPackageRightsAdapter,
  ContentPackageRightsBasisResolver,
  ProductContentPackageRightsResolver,
  OperationsReusableAssetSourceVerifier,
  ReuseMemoryService,
  ReuseMemoryComposerConversationDeletionNotifier,
  ReuseMemoryRecordProposalPort,
  CanonicalMemoryProposalRedline,
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
  PostgresParseRepository,
  PostgresReuseMemoryRepository,
  PostgresStoreFactLedger,
  contentPackageDeliveryCapability,
  ProductOperationsBatchExecutionAdapter,
  PersistentCanvasExportAdapter,
  ParseService,
} from './p1/operations/index.js';
import { LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY } from './p1/model-supply/reference-asset-delivery.js';
import {
  PostgresStoreIntakeFinalizationRepository,
  StoreIntakeFinalizer,
} from './p1/operations/store-intake-finalizer.js';
import { StoreProfileImportPreparer } from './p1/operations/store-profile-import.js';
import {
  migratePostgresSchema,
  runIfPostgresSchemaStable,
} from './postgres-schema-migration.js';
import {
  HarnessWorkflowEventSource,
  VideoWorkflowEventSource,
  WorkflowEventApplicationService,
} from './p1/workflow-events.js';
import {
  AgentPrimitiveObservabilityAdapter,
  createDurableCreationExperienceRuntime,
  HarnessObservabilityEventAudit,
} from './p1/creation-experience/index.js';
import { HarnessCheckTargetScope } from './p1/agent-primitives/harness-check-target-scope.js';
import {
  HarnessQuestionRequestPort,
} from './p1/agent-primitives/harness-question-request-port.js';
import { P1HarnessAskInvoker } from './p1/agent-primitives/p1-harness-ask-invoker.js';
import { P1HarnessCandidateRunnerScope } from './p1/agent-primitives/p1-harness-candidate-runner.js';
import { P1HarnessCheckInvoker } from './p1/agent-primitives/p1-harness-check-invoker.js';
import { createProductionAgentPrimitiveAssembly } from './p1/agent-primitives/production-assembly.js';
import {
  CompositeRecordProposalPort,
  createDurableSkillRuntime,
  PostgresSkillRepository,
  PostgresStoreWorkflowCaptureRepository,
  StoreWorkflowCaptureService,
  StoreWorkflowRecordProposalPort,
} from './p1/skills/index.js';
import {
  CatalogProductQuoteAuthority,
  DurableProductBillingService,
  PostgresProductBillingRepository,
  ProductBillingFoundationModule,
} from './p1/product-billing/index.js';
import { PostgresCreditLedger } from './p1/credit-billing/postgres-credit-ledger.js';
import { PostgresCreditSubscriptionStore } from './p1/credit-billing/credit-subscription-scheduler.js';
import { CreditBillingService } from './p1/credit-billing/credit-billing-service.js';
import { CreditSubscriptionEntitlementPolicy } from './p1/credit-billing/credit-entitlement-policy.js';
import { creditPlanConcurrencyTiers } from './p1/credit-billing/credit-plan-catalog.js';
import { AdminConfigCreditPlanCatalogSource } from './p1/admin-config/credit-plan-catalog-source.js';
import {
  createDurableResultDeliveryRuntime,
  ResultDeliveryFoundationModule,
} from './p1/result-delivery/index.js';
import {
  OperationsResultCommandPort,
  OperationsVisualAdoptionPort,
} from './p1/result-delivery/operations-visual-adoption.js';
import { PostgresResultAdjustSnapshotReadPort } from './p1/result-delivery/postgres-result-adjust-snapshot.js';

assertLangfusePromptRuntimePolicy(process.env);
const harnessPromptResolver = langfusePromptResolverFromEnv(process.env);
const modelSupplyPromptResolver =
  modelSupplyPromptResolverFromHarness(harnessPromptResolver);

const databaseUrl = process.env.DATABASE_URL;
const serviceToken = process.env.CORE_SERVICE_TOKEN;
const recordedCommerceEnabled =
  process.env.P1_RECORDED_COMMERCE_ENABLED === '1';
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
assertStrongSecret('CORE_SERVICE_TOKEN', serviceToken);

const harnessRuntimeConfig = process.env.HARNESS_DBOS_SYSTEM_DATABASE_URL
  ? readHarnessRuntimeConfig(process.env)
  : undefined;
const pool = new Pool({
  connectionString: databaseUrl,
  ...(harnessRuntimeConfig
    ? { max: harnessRuntimeConfig.businessPoolMax }
    : {}),
});
const diagnosticRepository = new PostgresDiagnosticRepository(pool);
const productRepository = new PostgresProductRepository(pool);
const relationalProductRepository = new PostgresRelationalProductRepository(
  pool
);
const creativeGroundingResolver = new ProductCreativeGroundingResolver(
  relationalProductRepository,
);
const assetStorage = modelAssetStorageFromEnv(process.env);
const foundationRepository = new PostgresFoundationRepository(pool);
const ownedReferenceAssets = new OwnedAssetReferenceResolver(
  foundationOwnedReferenceAssetRepository(foundationRepository),
  {
    async head(objectKey) {
      return assetStorage.head(objectKey);
    },
    async read(objectKey) {
      return (await assetStorage.read(objectKey)).bytes;
    },
  },
  {
    productPolicyResolver: new ProductReferenceAssetPolicyResolver(
      relationalProductRepository,
    ),
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
const grantLotLedger = new PostgresGrantLotLedger(pool);
const creditLedger = new PostgresCreditLedger(pool);
const creditSubscriptionStore = new PostgresCreditSubscriptionStore(pool);
const redemptionStore = new PostgresRedemptionStore(pool, creditLedger);
const operationsRepository = new PostgresOperationsRepository(pool);
const productBillingRepository = new PostgresProductBillingRepository(pool);
const storeFactLedger = new PostgresStoreFactLedger(pool);
const contextBundleRepository = new PostgresContextBundleRepository(pool);
const contextSourceRevisions = new PostgresContextSourceRevisionRepository(pool);
const marketingIdentities = new PostgresMarketingIdentityRepository(pool);
const assetIntakeRepository = new PostgresAssetIntakeRepository(pool);
const storeIntakeFinalizations =
  new PostgresStoreIntakeFinalizationRepository(pool);
const parseRepository = new PostgresParseRepository(pool);
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
const sensitiveWordsRepository = new PostgresSensitiveWordsRepository(pool);
const creditPlanCatalog = new AdminConfigCreditPlanCatalogSource(
  adminConfigRepository,
);
const creditBilling = new CreditBillingService(
  creditLedger,
  creditSubscriptionStore,
  creditPlanCatalog,
  new AdminConfigEntitlementCatalogSource(adminConfigRepository),
);
const dueDeliveryRepository = new PostgresDueDeliveryRepository(
  pool,
  adminConfigRepository
);
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
const skillRepository = new PostgresSkillRepository(pool);
const storeWorkflowCaptureRepository =
  new PostgresStoreWorkflowCaptureRepository(pool);
const supplyControlRepository = new PostgresSupplyControlPlaneRepository(pool);
const supplyPlanningControlPlane = new PostgresSupplyPlanningControlPlane(
  pool,
  PLATFORM_SUPPLY_SCOPE_ID,
);
const promptAuditStore = new PostgresHarnessStore(
  pool,
  storeFactLedger,
  adminConfigRepository,
);
await migratePostgresSchema(pool, [
  adminConfigRepository,
  sensitiveWordsRepository,
  dueDeliveryRepository,
  integrationRepository,
  promptAuditStore,
  skillRepository,
  storeWorkflowCaptureRepository,
  supplyControlRepository,
  new PostgresCapabilityHotAssemblyMigration(),
  new PostgresSupplyPlanningMigration(),
  new PostgresEntitlementPoolsMigration(),
  new PostgresAdminSupplyMigration(),
]);
await sensitiveWordsRepository.ensurePlatformBaseline();
await promptAuditStore.activateObservabilityReconciliationCutover();
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
const productPlans = defaultProductPlanConfig;
const modelCatalogTenantAllowlist = (
  process.env.MODEL_CATALOG_TENANT_ALLOWLIST ?? ''
)
  .split(',')
  .map((workspaceId) => workspaceId.trim())
  .filter(Boolean);
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
const e2ePlatformModelDefaults = e2ePlatformModelDefaultsFromEnv(process.env);
/**
 * The one runtime source of platform default catalog models (#240①).
 *
 * Day-0 provisioning and the composer's preference projection both read this,
 * so the model a new workspace is provisioned onto and the model the composer
 * falls back to are the same fact, edited in one place by operations.
 */
const platformDefaultModelSource: PlatformDefaultModelSourcePort = {
  async getSnapshot() {
    const entries = await Promise.all(
      PLATFORM_DEFAULT_MODEL_CONFIG_KEYS.map(async (configKey) => {
        const configName = platformDefaultModelConfigName(configKey);
        const row = await adminConfigRepository.get(
          'global',
          '__global__',
          configName,
        );
        const value = typeof row?.value === 'string' ? row.value.trim() : '';
        const resolvedValue = value || e2ePlatformModelDefaults[configKey];
        return resolvedValue
          ? ([
              configKey,
              {
                catalogModelId: resolvedValue,
                configRevision: row && value
                  ? `admin-config:${row.revision}`
                  : `runtime-default:${configName}:${resolvedValue}`,
              },
            ] as const)
          : null;
      }),
    );
    return Object.fromEntries(
      entries.filter(
        (
          entry,
        ): entry is readonly [
          PlatformDefaultModelConfigKey,
          { catalogModelId: string; configRevision: string },
        ] =>
          entry !== null,
      ),
    );
  },
};
const adminConfigRuntime = {
  'byok.adapter.assembly': byokRuntime.mode,
  'compliance.aigc_label.default': true,
  'compliance.regulated_mode.default': false,
  'compliance.watermark.default': false,
  'model.execution.mode': modelRuntime.mode,
  'model.media.execution.mode': mediaExecutionMode,
  [HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY]:
    DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS,
  [HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY]:
    DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS,
  [HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY]:
    DEFAULT_HOLD_RESERVATION_TTL_SECONDS,
  [HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY]:
    DEFAULT_HARNESS_LANGFUSE_OUTBOX_CONFIG,
  [HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY]:
    DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  ...Object.fromEntries(
    Object.entries(e2ePlatformModelDefaults).map(([configKey, modelId]) => [
      platformDefaultModelConfigName(configKey as PlatformDefaultModelConfigKey),
      modelId,
    ])
  ),
} satisfies Readonly<Record<string, unknown>>;
const aiStreamingRunner =
  modelRuntime.mode === 'fixture'
    ? new FixtureAiStreamingRunner()
    : modelRuntime.activation === 'live_verified' && modelRuntime.direct
      ? new OpenAiCompatibleAiSdkRunner(modelRuntime.direct)
      : undefined;
const foundationLedgerService = new P1ApplicationService(foundationRepository);
const productEntitlements = new GrantLotAwareProductEntitlementService(
  foundationRepository,
  grantLotLedger,
  recordedCommerceEnabled ? new RecordedAutoTopUpPaymentPort() : undefined,
  undefined,
  productQuoteService
);
const executionEntitlementPolicy = new CreditSubscriptionEntitlementPolicy(
  creditSubscriptionStore,
  creditPlanCatalog,
);
const modelSupplyProviderAdmission =
  new PostgresModelSupplyProviderAdmission({
    productEntitlements: executionEntitlementPolicy,
    entitlementPolicies: entitlementPolicyStore,
    accountAllocations: accountAllocationStore,
    supplyPools: supplyPoolStore,
    capacityLeases: capacityLeaseStore,
    creditMeteringEnabled: true,
  });
const p1ModelSupplyRuntime = createModelSupplyRuntime({
  application: {
    assetStorage,
    execution: gatedModelExecution,
    ledger: new FoundationModelSupplyLedger(
      foundationLedgerService,
      executionEntitlementPolicy,
      undefined,
      {
        billingLifecycle,
        defaultSupplyPoolId: 'pool-shared-default',
        productUsage: billingLifecycle,
        supplyFreezes: supplyFreezeStore,
      },
    ),
    merchantExecutionBilling: billingLifecycle,
    providerAdmission: modelSupplyProviderAdmission,
    promptAudits: promptAuditStore,
    promptResolver: modelSupplyPromptResolver,
    referenceAssets,
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
    durationSamples: foundationRepository,
    planningControlPlane: supplyPlanningControlPlane,
    platformDefaultModels: platformDefaultModelSource,
    repository: modelSupplyRepository,
    supplyRegistry: supplyControlRepository,
    modelCatalogTenantAllowlist,
    warn: (message) => console.warn(message),
  },
});
const p1ModelSupplyService = p1ModelSupplyRuntime.application;
const marketingIdentityStructuredExecutor =
  modelRuntime.mode === 'fixture'
    ? new FixtureAiStructuredObjectExecutor()
    : modelRuntime.activation === 'live_verified' && modelRuntime.direct
      ? new AiSdkStructuredObjectExecutor(modelRuntime.direct)
      : undefined;
const marketingIdentityDrafter = marketingIdentityStructuredExecutor
  ? new StructuredMarketingIdentityDrafter({
      create({ workspaceId, actorId }) {
        return new ModelSupplyStructuredNodeRunner({
          application: p1ModelSupplyService,
          executor: marketingIdentityStructuredExecutor,
          workspaceId,
          actorId,
          selection: { mode: 'auto', profile: 'quality' },
        });
      },
    })
  : undefined;
const modelControlPlane = p1ModelSupplyRuntime.controlPlane;
const productQuoteAuthority = new CatalogProductQuoteAuthority({
  getCatalog(workspaceId, operation) {
    return modelControlPlane.getCatalog(
      workspaceId,
      operation === 'image.reference_transform' ? 'image.edit' : operation,
    );
  },
});
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
    merchantExecutionBilling: billingLifecycle,
    promptAudits: promptAuditStore,
    promptResolver: modelSupplyPromptResolver,
    resultSink: modelSupplyRepository,
  },
  catalog: runtimeAssembly.assembly,
  controlPlane: {
    repository: modelSupplyRepository,
    modelCatalogTenantAllowlist,
    warn: (message) => console.warn(message),
  },
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
  return resolveCanonicalCopySelection(preferences);
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
  workspaceConcurrencyLimits: creditPlanConcurrencyTiers(),
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
  creditLedger,
  creditSubscriptionStore,
  redemptionStore,
  adminConfigRepository,
  sensitiveWordsRepository,
  operationsRepository,
  productBillingRepository,
  storeFactLedger,
  contextBundleRepository,
  contextSourceRevisions,
  marketingIdentities,
  assetIntakeRepository,
  storeIntakeFinalizations,
  parseRepository,
  reuseMemoryRepository,
  contentPackageWriteOwnership,
  contentPackageMigrationRuns,
  modelSupplyRepository,
  canonicalVideoWorkflowSchema,
  integrationRepository,
  skillRepository,
  storeWorkflowCaptureRepository,
  cutoverExecution,
  tracerJobRepository,
  operationalTelemetryStore,
  notifier,
]);
if (modelRuntime.mode === 'fixture') {
  await initializeWorkspaceCatalog(PLATFORM_SUPPLY_SCOPE_ID);
}
const tracerJobs = new TracerJobApplicationService(tracerJobRepository);
const parseService = new ParseService(
  parseRepository,
  documentParseProviderFromEnv(process.env),
  new FixtureAssetDraftCompiler(),
  new FixtureVisualAssetClassifier(),
  new StoredParseSourceAssetAuthorizer(assetStorage),
  new AdminConfigAssetIntakeGuidanceSource(adminConfigRepository),
  tracerJobs,
);
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
let operationsService: OperationsApplicationService;
const packageRightsPropagation = new OperationsProductPackageRightsAdapter(
  () => operationsService
);
const canonicalVideoWorkflow = {
  async edit(input: {
    actorId: string;
    correlationId: string;
    edit: Parameters<PostgresCanonicalVideoRunStore['editRun']>[0]['edit'];
    expectedRevision: number;
    workflowId: string;
    workspaceId: string;
  }) {
    const store = new PostgresCanonicalVideoRunStore(pool, input.workspaceId);
    const workflow = projectDurableVideoWorkflow(
      await store.editRun(input, new Date().toISOString()),
    );
    return { workflow };
  },
  async list(input: { actorId: string; workspaceId: string }) {
    const store = new PostgresCanonicalVideoRunStore(pool, input.workspaceId);
    return (await store.listRuns(input.workspaceId, input.actorId)).map(
      (run) => ({ workflow: projectDurableVideoWorkflow(run) }),
    );
  },
  async query(input: { workflowId: string; workspaceId: string }) {
    const store = new PostgresCanonicalVideoRunStore(pool, input.workspaceId);
    const run = await store.getRun(input.workflowId);
    if (!run) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Video workflow ${input.workflowId} was not found.`,
      );
    }
    return { workflow: projectDurableVideoWorkflow(run) };
  },
};
const videoWorkflowEventSource = new VideoWorkflowEventSource({
  async owns(workspaceId, workflowId) {
    const result = await pool.query(
      `SELECT 1 FROM p1_creative_jobs
        WHERE workspace_id = $1
          AND payload->>'videoWorkflowId' = $2`,
      [workspaceId, workflowId],
    );
    return result.rowCount === 1;
  },
  async readSnapshot(workspaceId, workflowId) {
    return canonicalVideoWorkflow.query({ workspaceId, workflowId });
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
const createCopyProviders = (bridge: ProductCopyProviderBridge) => ({
  domestic: new ModelSupplyProductCopyProvider(
    bridge,
    undefined,
    'domestic',
    resolveCopySelection,
    resolveCopyPrompt
  ),
  standard: new ModelSupplyProductCopyProvider(
    bridge,
    undefined,
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
    legacyBillingReadOnly: true,
    packageRightsPropagation,
    storageEntitlements: executionEntitlementPolicy,
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
    legacyBillingReadOnly: true,
    legacyVideoPath: 'disabled',
    packageRightsPropagation,
    storageEntitlements: executionEntitlementPolicy,
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
const contentPackageRightsBasisResolver =
  new ContentPackageRightsBasisResolver(
    contentPackageRightsResolver,
    supplyControlRepository,
    {
      allowLocalFixtureTerms: p1ModelSupplyRuntime.allowRecordedExecution,
    },
  );
const contentPackageExportAssets = new OperationsContentPackageExportAssetReader(
  operationsRepository,
  assetStorage,
  referenceAssets
);
const canvasExportAssetAccess = new OperationsCanvasExportAssetAccessService({
  contentPackageAssets: contentPackageExportAssets,
  contentPackageRights: contentPackageRightsResolver,
  generationJobs: foundationRepository,
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
const contentPackageApprovalPolicy = new ContextBundleApprovalPolicyResolver(
  contextBundleRepository,
  {
    sourceRevisions: contextSourceRevisions,
    facts: storeFactLedger,
  }
);
operationsService = new OperationsApplicationService(operationsRepository, {
  billingLifecycle,
  canvasExportAssetAccess,
  contentPackageDestinationProjection:
    new PostgresContentPackageDestinationProjection(pool),
  contentPackageExporter: new ContentPackageZipExportAdapter(
    assetStorage,
    contentPackageExportAssets,
    {
      allowRecordedSyntheticVideoCompliance: process.env.APP_ENV === 'e2e',
      appEnv: process.env.APP_ENV,
    },
  ),
  contentPackageApprovalPolicy,
  contentPackageRightsBasisResolver,
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
    referenceAssets,
    productQuoteService,
  ),
  groundingResolver: creativeGroundingResolver,
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
  storeFactLedger
);
const storeIntakeFinalizer = new StoreIntakeFinalizer(
  assetIntakeService,
  storeIntakeFinalizations,
  {
    completedRevision: (context, patch, idempotencyKey) =>
      productService.completedStoreProfileMergeRevision(
        { ...context, actor: 'user' },
        patch,
        idempotencyKey,
      ),
    currentRevision: async (context) =>
      (
        await productService.bootstrap({
          ...context,
          actor: 'user',
        })
      ).store?.revision ?? 0,
    merge: (context, patch, idempotencyKey) =>
      productService.mergeStoreProfile(
        { ...context, actor: 'user' },
        patch,
        idempotencyKey,
      ),
  },
);
const storeProfileImportPreparer = new StoreProfileImportPreparer(
  {
    read: async (context) =>
      (await productService.bootstrap({ ...context, actor: 'user' })).store,
  },
  assetIntakeService
);
const reuseMemoryService = new ReuseMemoryService(
  reuseMemoryRepository,
  new OperationsReusableAssetSourceVerifier(
    operationsService,
    contentPackageRightsResolver,
    contextBundleRepository
  )
);
operationsService.attachComposerConversationDeletionNotifier(
  new ReuseMemoryComposerConversationDeletionNotifier(reuseMemoryService)
);
let harnessService: HarnessApplicationService | undefined;
let composerDestinationMapper: ComposerDestinationMappingPort | undefined;
let composerSubmissionCoordinator: CreationSubmissionCoordinator | undefined;
// Pending-actions is an unconditional platform service (Z2-WIRING / #94 handoff).
// Harness questions need the harness_runtime schema; approvals come from operations.
const pendingActionsQuestionStore = promptAuditStore;
const dueAwareRecommendations = new DueAwareHarnessRecommendationReader(
  pendingActionsQuestionStore,
  dueDeliveryRepository,
);
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
const contentPackageDelivery = new ContentPackageDeliveryService(
  operationsRepository,
  {
    approvalPolicy: contentPackageApprovalPolicy,
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
const skillRuntime = await createDurableSkillRuntime({
  pool,
  promptResolver: harnessPromptResolver,
  provisionPlatformRecipes: true,
  repository: skillRepository,
});
const harnessObservabilityEvents = new HarnessObservabilityEventAudit(
  promptAuditStore,
);
const creationExperienceRuntime =
  await createDurableCreationExperienceRuntime({
    modelCatalog: modelSupplyRepository,
    observabilityEvents: harnessObservabilityEvents,
    taskObservability: promptAuditStore,
    pool,
    productQuotes: productBillingRepository,
    skillRevisionValidation: skillRuntime.revisionValidation,
  });
const harnessCheckTargetScope = new HarnessCheckTargetScope();
/** Production check path attaches the shared sensitive-words lexicon (P2-08 / #320). */
const harnessCheckTargetWithSensitiveLexicon = {
  async resolve(
    input: Parameters<HarnessCheckTargetScope['resolve']>[0],
  ) {
    const base = await harnessCheckTargetScope.resolve(input);
    const sensitiveLexicon = await sensitiveWordsRepository.listEnabled();
    return {
      ...base,
      sensitiveLexicon,
    };
  },
};
const harnessCandidatePrimitiveScope =
  new P1HarnessCandidateRunnerScope('harness-copy-primitive-worker');
const memoryProposalRedline = new CanonicalMemoryProposalRedline(
  {
    async resolve(input) {
      const active = harnessCheckTargetScope.activeTarget();
      if (active.policyInput.bundle.workspaceId !== input.workspaceId) {
        throw new Error(
          'Active Harness policy does not belong to the memory workspace.',
        );
      }
      return active.policyInput;
    },
  },
  {
    async append(input) {
      const active = harnessCheckTargetScope.activeTarget();
      if (!active.taskId) {
        throw new Error(
          'Memory redline audit requires an active Harness task.',
        );
      }
      await promptAuditStore.recordStageTrace({
        workspaceId: input.workspaceId,
        id: `${active.taskId}:memory-redline:${input.candidateId}:${input.gateId}`,
        taskId: active.taskId,
        stage: 'execution_selection',
        payload: {
          candidateId: input.candidateId,
          gateId: input.gateId,
          reason: input.reason,
        },
      });
    },
  },
);
const agentPrimitiveAssembly = createProductionAgentPrimitiveAssembly({
  audit: harnessObservabilityEvents,
  askMerchant: new HarnessQuestionRequestPort(),
  checkTarget: harnessCheckTargetWithSensitiveLexicon,
  checkViolationAudit: {
    async append(input) {
      const active = harnessCheckTargetScope.activeTarget();
      if (!active.taskId) {
        throw new Error(
          'Harness primitive violation audit requires a task identity.',
        );
      }
      await promptAuditStore.recordStageTrace({
        workspaceId: input.workspaceId,
        id:
          `${active.taskId}:primitive-check:${input.targetRef}:` +
          input.violation.gateId,
        taskId: active.taskId,
        stage: 'execution_selection',
        payload: {
          primitiveId: 'check',
          strategy: input.strategy,
          targetRef: input.targetRef,
          violation: structuredClone(input.violation),
        },
      });
    },
  },
  generate: harnessCandidatePrimitiveScope,
  readContext: {
    async read(input) {
      if (
        input.scope !== 'workspace' &&
        input.scope !== 'store.current' &&
        input.scope !== 'conversation.current'
      ) {
        throw new Error(
          `Unsupported production context scope: ${input.scope}`,
        );
      }
      const offset = input.query?.offset ?? 0;
      const limit = input.query?.limit ?? 20;
      const results = await operationsService.search(
        {
          actor: 'worker',
          correlationId: 'agent-primitive:read-context',
          userId: 'agent-primitive-worker',
          workspaceId: input.workspaceId,
        },
        {
          ...(input.query?.text ? { query: input.query.text } : {}),
          limit: offset + limit + 1,
        },
      );
      return {
        facts: results.slice(offset, offset + limit),
        ...(results.length > offset + limit
          ? { nextOffset: offset + limit }
          : {}),
      };
    },
  },
  recordProposal: new CompositeRecordProposalPort(
    new ReuseMemoryRecordProposalPort(
      reuseMemoryService,
      memoryProposalRedline,
    ),
    new StoreWorkflowRecordProposalPort(storeWorkflowCaptureRepository),
  ),
  revise: harnessCandidatePrimitiveScope,
  reviseTarget: harnessCandidatePrimitiveScope,
});
skillRuntime.foundationModule.attachCaptureWorkflow(
  new StoreWorkflowCaptureService(
    storeWorkflowCaptureRepository,
    agentPrimitiveAssembly.runtime,
    skillRepository,
  ),
);
operationsService.attachBriefSubmissionGate(
  creationExperienceRuntime.briefSubmissionGate,
);
const visualAdoptionService = new OperationsVisualAdoptionPort(
  operationsService,
);
const resultCommands = new OperationsResultCommandPort(
  operationsService,
  productQuoteService,
  new PostgresResultAdjustSnapshotReadPort(pool),
  {
    async prepareTextSelection(input) {
      if (!composerSubmissionCoordinator) {
        throw new Error('Composer Result adjustment is unavailable.');
      }
      return composerSubmissionCoordinator.prepareResultTextSelection(input);
    },
    async submit(input) {
      if (!composerSubmissionCoordinator) {
        throw new Error('Composer Result adjustment is unavailable.');
      }
      return composerSubmissionCoordinator.submitResultAdjustment(input);
    },
  },
);

const p1ApplicationService = new P1ApplicationService(foundationRepository, {
  // K1 authorizer port — internal executeModule/queryModule default-deny (Z2-WIRING).
  authorizer: permissionAuthorizer,
  operations: [
    agentPrimitiveAssembly.foundationModule,
    creationExperienceRuntime.foundationModule,
    skillRuntime.foundationModule,
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
        ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
        DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
        HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
        HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
        HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
        HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
        HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
        HARNESS_WOZ_RECIPE_CONFIG_KEY,
        BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
        BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
        // 笔记风格集合每次编译都现读（AdminConfigNotePlanSettingsSource.read），
        // 不登记的话后台会告诉运营「重启后生效」——与事实相反（D-116）。
        NOTE_STYLE_CONFIG_KEY,
        'plan.credits.trial',
        'plan.credits.starter',
        'plan.credits.growth',
        'plan.credits.pro',
        'plan.credits.addons',
        'plan.credits.trial.enabled',
        ...PLATFORM_DEFAULT_MODEL_CONFIG_KEYS.map(
          platformDefaultModelConfigName,
        ),
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
      ],
      wiredKeys: [
        ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
        DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
        HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
        HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
        HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
        HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
        HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
        HARNESS_WOZ_RECIPE_CONFIG_KEY,
        BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
        BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
        NOTE_STYLE_CONFIG_KEY,
        'byok.adapter.assembly',
        'model.execution.mode',
        'model.media.execution.mode',
        'plan.credits.trial',
        'plan.credits.starter',
        'plan.credits.growth',
        'plan.credits.pro',
        'plan.credits.addons',
        'plan.credits.trial.enabled',
        ...PLATFORM_DEFAULT_MODEL_CONFIG_KEYS.map(
          platformDefaultModelConfigName,
        ),
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
      ],
      readOnlyKeys: [
        'plan.addons',
        'plan.trial.enabled',
        'plan.allowances.trial',
        'plan.allowances.starter',
        'plan.allowances.growth',
        'plan.allowances.pro',
      ],
    }),
    new ContextFoundationModule(storeFactLedger),
    new ProductEntitlementFoundationModule(productEntitlements, undefined, {
      recordedCommerceEnabled,
      catalogSource: new AdminConfigEntitlementCatalogSource(
        adminConfigRepository,
      ),
      creditBilling,
      creditEntitlements: executionEntitlementPolicy,
      monthlyOutput: productQuoteService,
      modelCatalogTenantAllowlist,
      warn: (message) => console.warn(message),
      modelDefaults: {
        getSnapshot: () => platformDefaultModelSource.getSnapshot(),
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
        async setWorkspaceDefault(
          workspaceId,
          operation,
          modelId,
          metadata,
        ) {
          // Preference only — does not copy platform probe evidence into tenant catalog (GL-16).
          await modelSupplyRepository.setWorkspaceDefault(
            workspaceId,
            operation,
            modelId,
            metadata,
          );
        },
      },
    }),
    new RedemptionFoundationModule(
      new RedemptionApplicationService(
        redemptionStore,
        undefined,
        undefined,
        creditLedger,
      ),
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
      requireReservedBilling: true,
      reservedBilling: billingLifecycle,
      videoWorkflow: canonicalVideoWorkflow,
    }),
    new SensitiveWordsFoundationModule(sensitiveWordsRepository),
    new MarketingIdentityFoundationModule(
      marketingIdentities,
      undefined,
      marketingIdentityDrafter,
      {
        async resolve({ workspaceId, draftId, revision }) {
          const draft = await parseService.draftView(
            workspaceId,
            draftId,
            revision
          );
          const summary = draft.fields.find(
            (field) => field.key === 'brand_reference.summary'
          );
          if (
            draft.target !== 'brand_reference' ||
            draft.origin !== 'parsed' ||
            !draft.parsedDocumentId ||
            typeof summary?.value !== 'string' ||
            !summary.value.trim()
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              'The identity reference must be an exact parsed brand reference revision.'
            );
          }
          return {
            draftId: draft.draftId,
            draftRevision: draft.revision,
            parsedDocumentId: draft.parsedDocumentId,
            text: summary.value.trim(),
          };
        },
      }
    ),
    new AssetMemoryFoundationModule(
      assetIntakeService,
      parseService,
      storeIntakeFinalizer,
      storeProfileImportPreparer
    ),
    new MemoryFoundationModule(reuseMemoryService),
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
const p1HarnessCheckInvoker = new P1HarnessCheckInvoker(
  p1ApplicationService,
  harnessCheckTargetScope,
  'harness-check-primitive-worker',
);
const p1HarnessAskInvoker = new P1HarnessAskInvoker(
  p1ApplicationService,
  'harness-ask-primitive-worker',
);
const p1HarnessCandidateRunner = {
  wrap(
    input: Omit<
      Parameters<P1HarnessCandidateRunnerScope['wrap']>[0],
      'application'
    >,
  ) {
    return harnessCandidatePrimitiveScope.wrap({
      ...input,
      application: p1ApplicationService,
    });
  },
};
let harnessWorkflowEventSource: HarnessWorkflowEventSource | undefined;
let harnessCompensationInterval: ReturnType<typeof setInterval> | undefined;
let harnessPendingStartRecoveryInterval:
  | ReturnType<typeof setInterval>
  | undefined;
let observabilityReconciliationInterval:
  | ReturnType<typeof setInterval>
  | undefined;
let expirationInvalidationInterval: ReturnType<typeof setInterval> | undefined;
let expirationInvalidationRunning = false;
const promptOutboxWorker = new HarnessLangfuseOutboxWorker(
  promptAuditStore,
  langfuseSenderFromEnv(process.env),
  { config: adminConfigRepository },
);
const promptOutboxLoop = new HarnessLangfuseOutboxLoop(
  promptOutboxWorker,
  {
    onError(error) {
      console.error('Langfuse prompt outbox iteration failed.', error);
    },
    pollMs: Number(process.env.HARNESS_COMPENSATION_POLL_MS ?? 1_000),
  },
);
promptOutboxLoop.start();
const observabilityReconciler = new HarnessObservabilityReconciler(
  promptAuditStore,
  {
    onDeliverySnapshot(snapshot) {
      if (!shouldPublishObservabilityDeliverySnapshot(snapshot)) {
        return;
      }
      console.log('Harness observability delivery snapshot.', snapshot);
    },
    onViolation(violation) {
      console.warn('Harness observability drift detected.', violation);
    },
  },
);
let observabilityReconciliationRunning = false;
const runObservabilityReconciliation = async () => {
  if (observabilityReconciliationRunning) return;
  observabilityReconciliationRunning = true;
  try {
    await observabilityReconciler.runOnce();
  } catch (error) {
    console.error('Harness observability reconciliation failed.', error);
  } finally {
    observabilityReconciliationRunning = false;
  }
};
observabilityReconciliationInterval = setInterval(
  () => void runObservabilityReconciliation(),
  5 * 60_000,
);
observabilityReconciliationInterval.unref();
void runObservabilityReconciliation();
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
  composerDestinationMapper = new StructuredComposerDestinationMapper(
    structuredExecutor,
    {
      async resolve() {
        return requireHarnessFrozenPrompt(
          await harnessPromptResolver.resolve(),
          'destinationMapping',
        );
      },
    },
    promptAuditStore,
  );
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
      new PostgresProductBillingUsageReservation(
        pool,
        grantLotLedger,
        creditLedger,
        new ModelSupplyCreationInputResolver(creativeGroundingResolver),
      )
    )
  );
  await creationSubmissionStore.migrate();
  const structuredNodeRunnerFactory = {
    create({
      workspaceId,
      actorId,
      billingTaskId,
      billingQuoteRevision,
      frozenRouteSnapshot,
      providerOptions,
      selection,
    }: Parameters<HarnessStructuredNodeRunnerFactory['create']>[0]) {
      if (!billingTaskId || !billingQuoteRevision) {
        throw new Error(
          'Structured model jobs require the Coordinator billing lineage.',
        );
      }
      return new ModelSupplyStructuredNodeRunner({
        application: p1ModelSupplyService,
        executor: structuredExecutor,
        workspaceId,
        actorId,
        ...(frozenRouteSnapshot
          ? { frozenRouteSnapshot }
          : {
              selection:
                selection ??
                ({ mode: 'auto', profile: 'quality' } as const),
            }),
        ...(providerOptions ? { providerOptions } : {}),
        billingTaskId,
        billingQuoteRevision,
      });
    },
  };
  const harnessExecutionChildObservability = {
    create(request: import('./p1/harness/task-admission.js').HarnessWorkflowInput) {
      return new AgentPrimitiveObservabilityAdapter(
        harnessObservabilityEvents,
        {
          resolve() {
            const snapshot = request.executionSnapshot;
            return snapshot
              ? {
                  kind: 'product_usage' as const,
                  productUsageTaskId: snapshot.task.id,
                  quoteId: snapshot.quote.id,
                }
              : { kind: 'not_billed' as const };
          },
        },
      );
    },
  };
  const harnessMemorySedimentation =
    new ProductionMemorySedimentationCoordinator(
      reuseMemoryRepository,
      structuredNodeRunnerFactory,
      ({ request, proposal }) =>
        p1ApplicationService.executeModule<
          Record<string, unknown>,
          { proposalRef?: string; status: string }
        >(
          {
            actor: 'worker',
            correlationId: proposal.execution.correlationId,
            userId: proposal.execution.actorId,
            workspaceId: proposal.workspaceId,
          },
          'agent-primitives',
          {
            action: 'execute',
            payload: {
              primitiveId: 'record',
              modelInput: {
                kind: proposal.kind,
                payload: proposal.payload,
                provenance: proposal.provenance,
              },
              observability: request.executionAssembly?.rootAxes,
              taskId: proposal.execution.taskId,
            },
          },
          proposal.idempotencyKey,
        ),
      harnessCheckTargetScope,
    );
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
      sourceContentPackages,
      reuseMemoryService
    ),
    harnessStore,
    () => new Date().toISOString(),
    reuseMemoryService,
    contentPackageRevisionWriter,
    sourceContentPackages,
    skillRuntime.instructionResolver,
    creationExperienceRuntime.repository,
    new LedgerBackedFactRightsAuthorizationPort(
      storeFactLedger,
      contextSourceRevisions,
      () => new Date().toISOString()
    ),
    harnessExecutionChildObservability,
    p1HarnessCheckInvoker,
    p1HarnessCandidateRunner,
    harnessObservabilityEvents,
    harnessMemorySedimentation,
    sensitiveWordsRepository,
  );
  // Single wiring owner: wrap copy ports so image/video share the same
  // Coordinator → StagePort → Harness path (#139/#140).
  const notePlanSettings = new AdminConfigNotePlanSettingsSource(
    adminConfigRepository
  );
  const noteMediaAdmission =
    new PostgresNoteMediaAdmissionCoordinator(pool);
  await noteMediaAdmission.migrate();
  const harnessStages = createProductionHarnessMediaAssembly({
    contentPackages: contentPackageRevisionWriter,
    copy: copyHarnessStages,
    exactText:
      modelRuntime.mode === 'fixture'
        ? new FixtureImageExactTextVerifier()
        : new ModelSupplyImageExactTextVerifier(
            p1ModelSupplyService,
            harnessExecutionChildObservability,
          ),
    imageProfile: IMAGE_MODEL_RECIPE_PROFILE,
    models: p1ModelSupplyService,
    noteAdmission: noteMediaAdmission,
    noteEnhancementJudge: unconfiguredNotePlanEnhancementJudgeResolver,
    noteSettings: notePlanSettings,
    now: () => new Date().toISOString(),
    runners: structuredNodeRunnerFactory,
    sensitiveLexicon: sensitiveWordsRepository,
    executionChildObservability: harnessExecutionChildObservability,
  });
  DBOS.setConfig(harnessRuntimeConfig.dbos);
  const harnessBilling = new HarnessProductBillingSettlementExecutor(
    productQuoteService,
    grantLotLedger,
    undefined,
    {
      events: harnessObservabilityEvents,
      context: harnessStore,
    },
    creditLedger,
  );
  const billingCompensations =
    new PostgresHarnessBillingCompensationStore(pool);
  await billingCompensations.migrate();
  const workflowResumer: HarnessResumeWorkflow = {
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
    resumeInteraction: (
      workspaceId,
      workflowId,
      signal,
    ) =>
      resumeHarnessDbosInteractionWorkflow(
        workspaceId,
        workflowId,
        signal,
        harnessStore,
      ),
    async startSuccessor(input) {
      if (!composerSubmissionCoordinator) {
        throw new Error('Composer semantic successor is unavailable.');
      }
      await composerSubmissionCoordinator.submitSemanticSuccessor(input);
    },
    abandonReleasedReservation: (input) =>
      abandonReleasedHarnessReservation(
        input.workspaceId,
        input.taskId,
        input.questionId,
        harnessStore,
      ),
  };
  const harnessDecisions = new HarnessDecisionService(
    harnessStore,
    workflowResumer,
  );
  const resumeReconciler = new HarnessResumeReconciler(
    new PostgresHarnessResumeReconcilerStore(pool),
    workflowResumer,
  );
  const harnessInteractions = new HarnessInteractionService(harnessStore, {
    async resume(input) {
      if (!(await resumeReconciler.resumeEvent(input.eventId))) {
        throw new Error('The persisted interaction resume is unavailable.');
      }
    },
  });
  const harnessSystemDefaults = new HarnessSystemDefaultProducer(
    harnessStore,
    harnessInteractions,
  );
  const boundedExecutionLimits =
    new AdminConfigBoundedExecutionLimitsSource(adminConfigRepository);
  const harnessWorkflow = registerHarnessDbosWorkflow(
    harnessStages,
    harnessStore,
    {
      semanticResumptions: creationSubmissionStore,
      billing: {
        commit: (input) => harnessBilling.commit(input),
        refund: (input) => harnessBilling.refund(input),
        async scheduleCompensation(input) {
          await billingCompensations.enqueue(input);
        },
        async completeCompensation(input) {
          await billingCompensations.markCompleted(input);
        },
      },
      config: adminConfigRepository,
      decisions: harnessDecisions,
      boundedContinuations:
        new AdminConfigBoundedExecutionContinuationResolver(
          boundedExecutionLimits,
        ),
      taskRecallDue: new TaskRecallDueProducer(dueDeliveryRepository),
      askMerchant: p1HarnessAskInvoker,
      interactions: harnessInteractions,
    },
  );
  await DBOS.launch();
  harnessService = new HarnessApplicationService(
    new HarnessTaskAdmissionService(
      harnessStore,
      new DbosHarnessWorkflowStarter(harnessWorkflow),
      harnessPromptResolver,
      harnessStore,
      new AdminConfigBoundedExecutionLimitsResolver(
        boundedExecutionLimits,
      ),
      new ProductionHarnessFrozenRouteSnapshotResolver(
        foundationRepository,
        p1ModelSupplyService,
        {
          async resolve(operation) {
            const [registry, defaultsSnapshot] = await Promise.all([
              supplyControlRepository.getCurrentRegistryRevision(
                PLATFORM_SUPPLY_SCOPE_ID,
              ),
              platformDefaultModelSource.getSnapshot(),
            ]);
            if (!registry) {
              throw new Error(
                'The platform supply registry has no published revision.',
              );
            }
            // Only the requested operation's default is resolved. Resolving
            // every modality here meant an unusable image default rejected a
            // copy request, and the copy default's own live-verified/active
            // check below is unaffected by narrowing the scope.
            const defaults = platformDefaultsForOperation(
              Object.fromEntries(
                Object.entries(defaultsSnapshot).map(([key, value]) => [
                  key,
                  value.catalogModelId,
                ]),
              ),
              operation,
            );
            const { bindings, errors } = resolvePlatformDefaultBindings(
              registry,
              defaults,
              { operation },
            );
            if (errors.length > 0) {
              throw new Error(errors.join(' '));
            }
            const binding = bindings.find(
              (candidate) => candidate.operation === operation,
            );
            const deployment = binding
              ? registry.deployments.find(
                  (candidate) =>
                    candidate.id === binding.deploymentId,
                )
              : undefined;
            if (
              !binding ||
              binding.activationEvidenceStatus !== 'live_verified' ||
              deployment?.lifecycleStatus !== 'active'
            ) {
              throw new Error(
                `No active live-verified platform default is available for ${operation}.`,
              );
            }
            return {
              catalogModelId: binding.catalogModelId,
              deploymentId: binding.deploymentId,
              activationEvidenceStatus: 'live_verified' as const,
              ...(binding.activationEvidenceRef
                ? {
                    activationEvidenceRef:
                      binding.activationEvidenceRef,
                  }
                : {}),
              ...(binding.configurationRevision
                ? {
                    configurationRevision:
                      binding.configurationRevision,
                  }
                : {}),
            };
          },
        },
      ),
      {
        async select({ request, stage }) {
          const recipe = request.executionSnapshot?.recipe;
          const industryCategory =
            request.decisionReferences?.find(
              (reference) =>
                reference.field === 'industry_category',
            )?.value;
          return skillRuntime.instructionResolver.selectManifests({
            workspaceId: request.workspaceId,
            workflowId:
              request.executionSnapshot?.task.id ??
              request.packageId,
            workflowRevision: request.workflowRevision,
            ...(recipe
              ? {
                  recipeId: recipe.id,
                  recipeRevisionId: recipe.revision,
                }
              : {}),
            stage,
            ...(industryCategory ? { industryCategory } : {}),
          });
        },
        async materialize({ manifests }) {
          return skillRuntime.instructionResolver.materializeManifests(
            manifests,
          );
        },
      },
      harnessStore,
    ),
    harnessDecisions,
    harnessStore,
    dueAwareRecommendations,
    harnessStore,
    {
      async readTimeoutSeconds() {
        const revision = await adminConfigRepository.get(
          'global',
          '__global__',
          HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
        );
        return confirmationCardTimeoutSecondsSchema.parse(
          revision?.value ?? DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS,
        );
      },
    },
    harnessInteractions,
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
      modelPreferences: modelControlPlane,
      noteSettings: notePlanSettings,
      quotes: productQuoteService,
      rights: contentPackageRightsResolver,
      routeResolver: new ModelSupplyComposerRouteResolver(
        p1ModelSupplyService,
        foundationRepository
      ),
      sourcePackages: sourceContentPackageAdmissionReader,
    }),
    productQuoteService,
  );
  const pendingStartCoordinator = composerSubmissionCoordinator;
  await runIfPostgresSchemaStable(pool, async () => {
    await pendingStartCoordinator.recoverPendingStarts();
  });
  let pendingStartRecoveryRunning = false;
  const runPendingStartRecovery = async () => {
    if (pendingStartRecoveryRunning) return;
    pendingStartRecoveryRunning = true;
    try {
      await runIfPostgresSchemaStable(pool, async () => {
        const result = await pendingStartCoordinator.recoverPendingStarts();
        if (result.failed > 0) {
          console.error('Harness pending-start recovery failed.', result);
        }
      });
    } catch (error) {
      console.error('Harness pending-start recovery iteration failed.', error);
    } finally {
      pendingStartRecoveryRunning = false;
    }
  };
  harnessPendingStartRecoveryInterval = setInterval(
    () => void runPendingStartRecovery(),
    Number(process.env.HARNESS_COMPENSATION_POLL_MS ?? 1_000),
  );
  harnessPendingStartRecoveryInterval.unref();
  harnessWorkflowEventSource = new HarnessWorkflowEventSource(
    new HarnessDbosWorkflowEventReader(
      harnessStore,
      undefined,
      undefined,
      productQuoteService,
    ),
  );
  const billingCompensationWorker = new HarnessBillingCompensationWorker(
    billingCompensations,
    harnessBilling,
  );
  const reservationSweeper = new HarnessReservationSweeper(
    harnessStore,
    harnessBilling,
    {
      async reservationTtlSeconds() {
        const revision = await adminConfigRepository.get(
          'global',
          '__global__',
          HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
        );
        return Number(
          revision?.value ?? DEFAULT_HOLD_RESERVATION_TTL_SECONDS,
        );
      },
    },
  );
  let compensationRunning = false;
  const runCompensation = async () => {
    if (compensationRunning) return;
    compensationRunning = true;
    try {
      await runIfPostgresSchemaStable(pool, async () => {
        const results = await Promise.allSettled([
          resumeReconciler.runOnce(),
          harnessSystemDefaults.runOnce(),
          billingCompensationWorker.runOnce(),
          reservationSweeper.runOnce(),
        ]);
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error(
              'Harness compensation iteration failed.',
              result.reason,
            );
          }
        }
      });
    } catch (error) {
      console.error('Harness compensation iteration failed.', error);
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

// Readiness probe assembly. Protected environments require all nine checks, so
// every axis is wired to the real dependency it claims to prove: the probe
// factories in runtime-truth/probes.ts existed but had no production call site,
// which left six of nine checks reporting "Required readiness probe is not
// configured" in staging/production.
const dbosSystemPool = harnessRuntimeConfig
  ? new Pool({
      connectionString: harnessRuntimeConfig.dbos.systemDatabaseUrl,
      max: 1,
    })
  : undefined;

const READINESS_PROBE_WORKSPACE_ID = 'readiness-probe';
// A 1x1 PNG: the shared storage seam validates media magic bytes, so the probe
// has to write a real media payload.
const READINESS_PROBE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);

const probeObjectStorageReadWrite = async () => {
  if (!assetStorage.persistOwnedAsset) {
    throw new Error('Owned asset storage is unavailable for readiness probe.');
  }
  const persisted = await assetStorage.persistOwnedAsset({
    bytes: READINESS_PROBE_BYTES,
    contentType: 'image/png',
    workspaceId: READINESS_PROBE_WORKSPACE_ID,
  });
  try {
    const stored = await assetStorage.read(persisted.objectKey);
    if (
      stored.bytes.byteLength !== READINESS_PROBE_BYTES.byteLength ||
      stored.bytes.some(
        (byte, index) => byte !== READINESS_PROBE_BYTES[index],
      )
    ) {
      throw new Error(
        'Object storage returned different bytes than were written.',
      );
    }
  } finally {
    const deleteCached = (
      assetStorage as { deleteCachedAsset?: (objectKey: string) => Promise<void> }
    ).deleteCachedAsset;
    if (deleteCached) {
      await deleteCached.call(assetStorage, persisted.objectKey);
    }
  }
};

const readinessProbes = {
  dbos: dbosSystemPool
    ? dbosSystemDbProbe(dbosSystemPool)
    : () => ({
        name: 'dbos' as const,
        status: 'fail' as const,
        detail:
          'HARNESS_DBOS_SYSTEM_DATABASE_URL is not configured; the DBOS system database cannot be proven.',
      }),
  objectStorage: objectStorageProbe({
    env: process.env,
    probeReadWrite: probeObjectStorageReadWrite,
  }),
  outbox: outboxBacklogProbe({
    async criticalBacklog() {
      const result = await pool.query<{ backlog: string }>(
        `select count(*)::text as backlog
           from harness_runtime.langfuse_outbox
          where status in ('queued', 'failed', 'sending')
            and dead_lettered_at is null
            and next_attempt_at <= now()`,
      );
      return Number(result.rows[0]?.backlog ?? 0);
    },
    maxBacklog: Number(process.env.P1_OUTBOX_CRITICAL_MAX_BACKLOG ?? 500),
  }),
  postgresql: postgresqlProbe(pool),
  schema: schemaCompatibilityProbe(pool),
  workerFreshness: workerFreshnessProbe({
    async latestHeartbeatAt() {
      const sample = await operationalTelemetryStore.latestWorkerSample();
      return sample?.sampledAt ?? null;
    },
    staleAfterMs: Number(process.env.P1_WORKER_HEARTBEAT_STALE_MS ?? 30_000),
  }),
};

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
    probes: {
      ...readinessProbes,
      ...(providerEvidenceConfigured
        ? {
            providerLive: () => providerEvidence.providerLiveReadiness,
          }
        : {}),
    },
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
  executionModeGate: streamingModeGate,
  assetReader: assetStorage,
  composerDestinationMapper,
  composerSubmission: composerSubmissionCoordinator
    ? { coordinator: composerSubmissionCoordinator }
    : undefined,
  contentPackageReader: {
    read(context, packageId) {
      return operationsService.getContentPackage(context, packageId);
    },
  },
  diagnosticRepository,
  integrationService,
  harnessService,
  pendingActions,
  operationsService,
  planCatalog: creditPlanCatalog,
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
  if (harnessPendingStartRecoveryInterval) {
    clearInterval(harnessPendingStartRecoveryInterval);
  }
  if (observabilityReconciliationInterval) {
    clearInterval(observabilityReconciliationInterval);
  }
  promptOutboxLoop.stop();
  void shutdownCoreRuntime({
    closeHttp: () => closeHttpServerWithDeadline(server, 5_000),
    shutdownDbos: () =>
      harnessRuntimeConfig ? DBOS.shutdown() : Promise.resolve(),
    shutdownTracing: shutdownLangfuseTracing,
    stopJobs: () => jobRuntime.stop({ graceful: true }),
    closePool: async () => {
      await pool.end();
      if (dbosSystemPool) await dbosSystemPool.end();
    },
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

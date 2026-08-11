import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';
import { PostgresDiagnosticRepository } from '../diagnostics/postgres-repository.js';
import {
  AdminConfigCreditPlanCatalogSource,
  ensureCreditPlanCatalogDefaults,
  migrateCreditPlanCatalogCurrencyToHkd,
} from '../p1/admin-config/credit-plan-catalog-source.js';
import {
  AdminConfigEntitlementCatalogSource,
  createModelExecutionModeGate,
  DEFAULT_HARNESS_LANGFUSE_OUTBOX_CONFIG,
  DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
  HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
  HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
  integrationAdapterEnvFromSources,
  ModeGateExecutionPort,
  ModeGateMediaLifecyclePort,
  modelRuntimeAssemblyFromSources,
  PostgresAdminConfigRepository,
} from '../p1/admin-config/index.js';
import {
  AgentSessionHarnessService,
  confirmationCreditPortFromPostgresLedger,
  PostgresProductReservationReplacement,
  ConfirmationAuthorityAssembler,
  ExecutionConfirmationService,
  PostgresAgentSessionStore,
  PostgresExecutionConfirmationMigration,
  PostgresConfirmationAuthorityStore,
  PostgresMarketingPlanStore,
  createIntentRetrievalPolicies,
  createProductionPlanCompiler,
  createProductionPlanCompilerPorts,
  createRetrievalToolRegistry,
  createSessionAgentKernel,
  createSessionRetrievalPorts,
  type SessionBillingQuoteFacts,
} from '../p1/agent-session/index.js';
import { ExecutionPlanAdmissionService } from '../p1/harness/execution-plan-admission.js';
import { PostgresExecutionPlanAdmissionMigration } from '../p1/harness/postgres-execution-plan-admission-store.js';
import { PostgresInterruptStore } from '../p1/harness/postgres-interrupt-store.js';
import { PostgresSteeringCommandStore } from '../p1/agent-session/postgres-steering-command-store.js';
import {
  SteeringService,
  SteeringServiceError,
  resolveMakeSteeringGate,
} from '../p1/agent-session/steering-service.js';
import { PostgresAgentSemanticEventStore } from '../p1/agent-semantic-events/index.js';
import {
  PostgresMarketingGoalStore,
  PostgresOpportunityDecisionStore,
} from '../p1/goal-proactive/index.js';
import { createPermissionAuthorizer } from '../p1/capability-permission/index.js';
import { CloudflareInventoryAdapter } from '../p1/cloudflare-read/index.js';
import { CreditBillingService } from '../p1/credit-billing/credit-billing-service.js';
import { CreditSubscriptionEntitlementPolicy } from '../p1/credit-billing/credit-entitlement-policy.js';
import { creditPlanConcurrencyTiers } from '../p1/credit-billing/credit-plan-catalog.js';
import { PostgresCreditSubscriptionStore } from '../p1/credit-billing/credit-subscription-scheduler.js';
import { PostgresCreditLedger } from '../p1/credit-billing/postgres-credit-ledger.js';
import {
  P1CutoverExecutionService,
  PostgresLegacyInFlightDecisionPort,
} from '../p1/cutover/index.js';
import { PostgresDueDeliveryRepository } from '../p1/due-delivery/postgres-repository.js';
import {
  ensureDefaultRuntimeSupplyPool,
  PostgresAccountAllocationStore,
  PostgresCapacityLeaseStore,
  PostgresEntitlementPolicyStore,
  PostgresEntitlementPoolsMigration,
  PostgresModelSupplyProviderAdmission,
  PostgresSupplyFreezeStore,
  PostgresSupplyPoolStore,
} from '../p1/entitlement-pools/index.js';
import { PostgresContentPackageDestinationProjection } from '../p1/execution-spine/content-package-destination-projection.js';
import { ExecutionSourceContentPackageResolver } from '../p1/execution-spine/source-content-package-resolver.js';
import { e2ePlatformModelDefaultsFromEnv } from '../p1/foundation/e2e-platform-model-defaults.js';
import {
  GrantLotAwareProductEntitlementService,
  P1ApplicationService,
  P1DomainError,
  PostgresFoundationRepository,
  PostgresGrantLotLedger,
  PostgresRedemptionStore,
  PostgresWorkspaceBootstrapper,
  RecordedAutoTopUpPaymentPort,
} from '../p1/foundation/index.js';
import {
  PLATFORM_DEFAULT_MODEL_CONFIG_KEYS,
  platformDefaultModelConfigName,
  type PlatformDefaultModelConfigKey,
  type PlatformDefaultModelSourcePort,
} from '../p1/foundation/workspace-provision.js';
import {
  DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS,
  DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS,
  sendHarnessMediaJobTerminal,
} from '../p1/harness/dbos-workflow.js';
import {
  assertLangfusePromptRuntimePolicy,
  langfusePromptResolverFromEnv,
  modelSupplyPromptResolverFromHarness,
} from '../p1/harness/langfuse-prompts.js';
import { PostgresHarnessReleaseStore } from '../p1/harness/postgres-harness-release.js';
import {
  HarnessReleaseService,
} from '../p1/harness/harness-release.js';
import { resolveSessionRunRelease } from '../p1/harness/session-run-release.js';
import { ensureSeedProductionRelease } from '../p1/harness/seed-harness-release.js';
import {
  assertProductionReleasePromptResolvable,
} from '../p1/harness/prompt-packs.js';
import {
  createProductionEvalLayersAssembly,
  evalLangfuseOutboxFromAuditStore,
  OutboxLangfuseEvalWriter,
  PostgresEvalVerdictStore,
} from '../p1/eval/index.js';
import { PostgresOpsConsoleStore } from '../p1/ops-console/postgres-ops-console.js';
import {
  PostgresHarnessAuditStore,
  PostgresHarnessInteractionStore,
  PostgresHarnessObservabilityStore,
  PostgresHarnessStore,
} from '../p1/harness/postgres-store.js';
import {
  resolveShadowReconciliationConfigFromAdmin,
  ShadowReconciliationService,
} from '../p1/harness/shadow-reconciliation.js';
import { PostgresShadowReconciliationStore } from '../p1/harness/shadow-reconciliation-store.js';
import { DEFAULT_HOLD_RESERVATION_TTL_SECONDS } from '../p1/harness/reservation-sweeper.js';
import {
  initializeJobWorkerHarnessRuntime,
  readHarnessRuntimeConfig,
} from '../p1/harness/runtime-config.js';
import {
  byokExecutionRuntimeFromEnv,
  createProviderCredentialSecretBroker,
  feishuMcpAdapterFromEnv,
  FoundationStrictByokLedger,
  IntegrationApplicationService,
  integrationSecretStoreFromEnv,
  migrateProviderCredentialAccountsFromIntegrations,
  PostgresIntegrationRepository,
  providerConnectivityProbeFromEnv,
  ProviderCredentialAccountProvisioner,
  providerCredentialEnvFromVault,
  registerFeishuIntentReconciliationSchedule,
  registerFeishuToolLifecycleSchedule,
} from '../p1/integrations/index.js';
import {
  EntitlementAwareJobPort,
  PgBossJobPort,
  PostgresOperationalTelemetryStore,
  PostgresTracerJobRepository,
  TracerJobApplicationService,
} from '../p1/job-runtime/index.js';
import {
  CompositeReferenceAssetResolver,
  createModelSupplyRuntime,
  DurableMediaGenerationApplicationService,
  FixtureAiStreamingRunner,
  FixtureAiStructuredObjectExecutor,
  FoundationModelSupplyLedger,
  foundationOwnedReferenceAssetRepository,
  MediaActivationProbeExecutor,
  modelAssetStorageFromEnv,
  modelMediaExecutionMode,
  OpenAiCompatibleAiSdkRunner,
  OwnedAssetReferenceResolver,
  PostgresCanonicalVideoRunStore,
  PostgresCanonicalVideoWorkflowSchema,
  PostgresModelSupplyRepository,
  ProductCopyProviderBridge,
  ProductReferenceAssetPolicyResolver,
  ProductReferenceAssetResolver,
  projectDurableVideoWorkflow,
  RECORDED_CATALOG_REVISION_ID,
  seedCapabilityHotAssemblyFromCatalog,
} from '../p1/model-supply/index.js';
import { LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY } from '../p1/model-supply/reference-asset-delivery.js';
import {
  AiSdkStructuredObjectExecutor,
  ModelSupplyStructuredNodeRunner,
} from '../p1/model-supply/structured-node-runner.js';
import {
  AdminConfigAssetIntakeGuidanceSource,
  ContentPackageMigrationService,
  ContentPackageRightsBasisResolver,
  ContentPackageZipExportAdapter,
  ContextBundleApprovalPolicyResolver,
  documentParseProviderFromEnv,
  FixtureAssetDraftCompiler,
  FixtureVisualAssetClassifier,
  HeadGetContentPackageOwnedReceiptVerifier,
  MediaCustodyStorageAdapter,
  ModelSupplyCreationExecutor,
  ModelSupplyImageGenerationAdapter,
  OperationsApplicationService,
  OperationsCanvasExportAssetAccessService,
  OperationsContentPackageExportAssetReader,
  OperationsProductPackageRightsAdapter,
  OperationsProductSearchProjection,
  ParseService,
  PersistentCanvasExportAdapter,
  PostgresAssetIntakeRepository,
  PostgresContentPackageMigrationRunRepository,
  PostgresContentPackageMigrationSource,
  PostgresContentPackageWriteOwnership,
  PostgresContextBundleRepository,
  PostgresContextSourceRevisionRepository,
  PostgresMarketingIdentityRepository,
  PostgresOperationsRepository,
  PostgresParseRepository,
  PostgresMemoryInjectionReceiptStore,
  PostgresReuseMemoryRepository,
  PostgresStoreFactLedger,
  ProductContentPackageRightsResolver,
  ProductOperationsBatchExecutionAdapter,
  StoredParseSourceAssetAuthorizer,
  StructuredMarketingIdentityDrafter,
} from '../p1/operations/index.js';
import { PostgresStoreIntakeFinalizationRepository } from '../p1/operations/store-intake-finalizer.js';
import {
  CatalogProductQuoteAuthority,
  DurableProductBillingService,
  PostgresProductBillingRepository,
} from '../p1/product-billing/index.js';
import { PostgresSensitiveWordsRepository } from '../p1/sensitive-words/index.js';
import {
  PostgresSkillRepository,
  PostgresStoreWorkflowCaptureRepository,
} from '../p1/skills/index.js';
import {
  createPostgresAdminSupplyControlPlane,
  PLATFORM_SUPPLY_SCOPE_ID,
  PostgresAdminSupplyMigration,
  PostgresCapabilityHotAssemblyMigration,
  PostgresCapabilityHotAssemblyPort,
  PostgresCredentialRotationReceiptStore,
  PostgresSupplyControlPlaneRepository,
  PostgresSupplyPlanningControlPlane,
  PostgresSupplyPlanningMigration,
  ProductionAdminProviderEvidence,
} from '../p1/supply-registry/index.js';
import { VideoWorkflowEventSource } from '../p1/workflow-events.js';
import { migratePostgresSchema } from '../postgres-schema-migration.js';
import { CutoverProductService } from '../product/cutover-product-service.js';
import {
  ModelSupplyProductCopyProvider,
  resolveCanonicalCopySelection,
} from '../product/model-supply-copy-provider.js';
import {
  noOpProductNotifier,
  PostgresIdempotentProductNotifier,
  WebhookProductNotifier,
} from '../product/notifier.js';
import {
  ProductAssetDataClassResolver,
  ProductCreativeGroundingResolver,
} from '../product/p1-model-policy.js';
import { defaultProductPlanConfig } from '../product/plans.js';
import { PostgresProductRepository } from '../product/postgres-repository.js';
import { ProductService } from '../product/product-service.js';
import type { ProductQualitySink } from '../product/quality-sink.js';
import { PostgresRelationalProductRepository } from '../product/relational-product-repository.js';
import { assertStrongSecret } from '../security/secret-hardening.js';
export type CoreRole = 'api' | 'worker';

export async function assembleCoreGraph(
  env: NodeJS.ProcessEnv,
  options: { role: CoreRole }
) {
  assertLangfusePromptRuntimePolicy(env);
  const harnessPromptResolver = langfusePromptResolverFromEnv(env);
  const modelSupplyPromptResolver = modelSupplyPromptResolverFromHarness(
    harnessPromptResolver
  );

  const databaseUrl = env.DATABASE_URL;
  const serviceToken = env.CORE_SERVICE_TOKEN;
  const recordedCommerceEnabled = env.P1_RECORDED_COMMERCE_ENABLED === '1';
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  assertStrongSecret('CORE_SERVICE_TOKEN', serviceToken);

  const harnessRuntimeConfig =
    options.role === 'worker'
      ? await initializeJobWorkerHarnessRuntime(env, {
          setConfig: (config) => DBOS.setConfig(config),
          launch: () => DBOS.launch(),
        })
      : env.HARNESS_DBOS_SYSTEM_DATABASE_URL
        ? readHarnessRuntimeConfig(env)
        : undefined;
  // Both roles share the governed business-pool cap. Worker concurrency is
  // already reflected by the harness runtime config and does not justify an
  // unbounded PostgreSQL pool.
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
    relationalProductRepository
  );
  const assetStorage = modelAssetStorageFromEnv(env);
  const foundationRepository = new PostgresFoundationRepository(pool);
  const workspaceBootstrapper = new PostgresWorkspaceBootstrapper(pool);
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
        relationalProductRepository
      ),
    }
  );
  const productReferenceAssets = new ProductReferenceAssetResolver(
    relationalProductRepository,
    {
      appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:3000',
      serviceToken,
    }
  );
  // Reference resolution is role-neutral; API and worker must use the same
  // owned-asset policy and product fallback order.
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
  const contextSourceRevisions = new PostgresContextSourceRevisionRepository(
    pool
  );
  const marketingIdentities = new PostgresMarketingIdentityRepository(pool);
  const assetIntakeRepository = new PostgresAssetIntakeRepository(pool);
  const storeIntakeFinalizations =
    new PostgresStoreIntakeFinalizationRepository(pool);
  const parseRepository = new PostgresParseRepository(pool);
  const reuseMemoryRepository = new PostgresReuseMemoryRepository(pool);
  // V31-18: MemoryInjectionReceipt durable store (production; memory store stays for unit tests).
  const memoryInjectionReceiptStore = new PostgresMemoryInjectionReceiptStore(
    pool
  );
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
    adminConfigRepository
  );
  const creditBilling = new CreditBillingService(
    creditLedger,
    creditSubscriptionStore,
    creditPlanCatalog,
    new AdminConfigEntitlementCatalogSource(adminConfigRepository)
  );
  const dueDeliveryRepository = new PostgresDueDeliveryRepository(
    pool,
    adminConfigRepository
  );
  const cloudflareMapping = {
    internalRef: env.CLOUDFLARE_MAPPING_REF ?? 'shell-production',
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    scriptName: env.CLOUDFLARE_SCRIPT_NAME,
    r2BucketName: env.CLOUDFLARE_R2_BUCKET_NAME,
    hyperdriveConfigId: env.CLOUDFLARE_HYPERDRIVE_CONFIG_ID,
    verified: env.CLOUDFLARE_MAPPING_VERIFIED === 'true',
  };
  const cloudflareInventory = new CloudflareInventoryAdapter({
    apiToken: env.CLOUDFLARE_INVENTORY_READ_TOKEN,
    mapping: cloudflareMapping,
  });
  const integrationRepository = new PostgresIntegrationRepository(pool);
  const skillRepository = new PostgresSkillRepository(pool);
  const storeWorkflowCaptureRepository =
    new PostgresStoreWorkflowCaptureRepository(pool);
  const supplyControlRepository = new PostgresSupplyControlPlaneRepository(
    pool
  );
  const supplyPlanningControlPlane = new PostgresSupplyPlanningControlPlane(
    pool,
    PLATFORM_SUPPLY_SCOPE_ID
  );
  const harnessSchemaStore = new PostgresHarnessStore(
    pool,
    storeFactLedger,
    adminConfigRepository
  );
  const harnessReleaseStore = new PostgresHarnessReleaseStore(pool);
  const opsConsoleStore = new PostgresOpsConsoleStore(pool);
  const evalVerdictStore = new PostgresEvalVerdictStore(pool);
  const promptAuditStore = new PostgresHarnessAuditStore(pool);
  const harnessInteractionStore = new PostgresHarnessInteractionStore(pool);
  const harnessObservabilityStore = new PostgresHarnessObservabilityStore(pool);
  await migratePostgresSchema(pool, [
    adminConfigRepository,
    sensitiveWordsRepository,
    dueDeliveryRepository,
    integrationRepository,
    harnessSchemaStore,
    harnessReleaseStore,
    opsConsoleStore,
    evalVerdictStore,
    skillRepository,
    storeWorkflowCaptureRepository,
    supplyControlRepository,
    new PostgresCapabilityHotAssemblyMigration(),
    new PostgresSupplyPlanningMigration(),
    new PostgresEntitlementPoolsMigration(),
    new PostgresAdminSupplyMigration(),
  ]);
  await sensitiveWordsRepository.ensurePlatformBaseline();
  await harnessObservabilityStore.activateObservabilityReconciliationCutover();
  /** Boot upgrades only absent/legacy-empty production to the checked-in seed. */
  const harnessReleaseService = new HarnessReleaseService(harnessReleaseStore);
  await ensureSeedProductionRelease({
    store: harnessReleaseStore,
    service: harnessReleaseService,
  });
  const bootProductionLifecycle =
    await harnessReleaseStore.getLifecycleByStatus('production');
  const bootProductionArtifact = bootProductionLifecycle
    ? await harnessReleaseStore.getArtifact(bootProductionLifecycle.releaseId)
    : null;
  assertProductionReleasePromptResolvable({
    productionRelease: bootProductionArtifact ?? null,
  });
  const integrationSecrets = integrationSecretStoreFromEnv(env);
  const credentialRotationReceipts = new PostgresCredentialRotationReceiptStore(
    pool,
    async (binding) => {
      await integrationSecrets.use(binding.secretReference, {
        workspaceId: binding.workspaceId,
        credentialId: binding.credentialId,
        version: binding.secretVersion,
        provider: binding.provider,
      });
    }
  );
  const providerCredentialOperator = new ProviderCredentialAccountProvisioner(
    supplyControlRepository,
    credentialRotationReceipts,
    integrationSecrets
  );
  await migrateProviderCredentialAccountsFromIntegrations(
    integrationRepository,
    supplyControlRepository
  );
  const providerCredentialRuntime = await providerCredentialEnvFromVault(
    supplyControlRepository,
    integrationSecrets,
    env
  );
  const providerCredentialSecretBroker = createProviderCredentialSecretBroker(
    supplyControlRepository,
    integrationSecrets
  );
  const modelSupplyRepository = new PostgresModelSupplyRepository(pool);
  const canonicalVideoWorkflowSchema = new PostgresCanonicalVideoWorkflowSchema(
    pool
  );
  const cutoverExecution = new P1CutoverExecutionService(pool);
  const legacyInFlightDecisions = new PostgresLegacyInFlightDecisionPort(pool);

  const port = Number(env.CORE_PORT ?? 4100);
  const notificationWebhook = env.FEISHU_WEBHOOK_URL ?? env.WECOM_WEBHOOK_URL;
  const downstreamNotifier = notificationWebhook
    ? new WebhookProductNotifier(
        notificationWebhook,
        env.APP_BASE_URL ?? 'http://localhost:3000'
      )
    : noOpProductNotifier;
  const notifier = new PostgresIdempotentProductNotifier(
    pool,
    downstreamNotifier
  );
  const productPlans = defaultProductPlanConfig;
  const modelCatalogTenantAllowlist = (env.MODEL_CATALOG_TENANT_ALLOWLIST ?? '')
    .split(',')
    .map((workspaceId) => workspaceId.trim())
    .filter(Boolean);
  const runtimeAssembly = await modelRuntimeAssemblyFromSources(
    adminConfigRepository,
    providerCredentialRuntime.env,
    { processKind: options.role === 'api' ? 'http' : 'job-worker' }
  );
  const {
    deployments,
    models,
    runtime: modelRuntime,
  } = runtimeAssembly.assembly;
  // G3 hot assembly: seed process-local capability head from boot catalog so
  // HTTP reports the same boot fingerprint Worker seeds (dual-process alignment).
  const bootCapabilityHotAssembly = seedCapabilityHotAssemblyFromCatalog(
    runtimeAssembly.assembly
  );
  const capabilityHotAssembly = new PostgresCapabilityHotAssemblyPort(
    pool,
    supplyControlRepository,
    PLATFORM_SUPPLY_SCOPE_ID,
    providerCredentialSecretBroker
  );
  await capabilityHotAssembly.seedIfEmpty(
    bootCapabilityHotAssembly.bootRevision
  );
  capabilityHotAssembly.applyCatalogRevisionHead(RECORDED_CATALOG_REVISION_ID);
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
    productBillingRepository
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
    env
  );
  const byokRuntime = byokExecutionRuntimeFromEnv(integrationAssembly.env);
  const e2ePlatformModelDefaults = e2ePlatformModelDefaultsFromEnv(env);
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
            configName
          );
          const value = typeof row?.value === 'string' ? row.value.trim() : '';
          const resolvedValue = value || e2ePlatformModelDefaults[configKey];
          return resolvedValue
            ? ([
                configKey,
                {
                  catalogModelId: resolvedValue,
                  configRevision:
                    row && value
                      ? `admin-config:${row.revision}`
                      : `runtime-default:${configName}:${resolvedValue}`,
                },
              ] as const)
            : null;
        })
      );
      return Object.fromEntries(
        entries.filter(
          (
            entry
          ): entry is readonly [
            PlatformDefaultModelConfigKey,
            { catalogModelId: string; configRevision: string },
          ] => entry !== null
        )
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
        platformDefaultModelConfigName(
          configKey as PlatformDefaultModelConfigKey
        ),
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
  /** V31-06 Session Harness AgentKernel (fixture always green; live = AI SDK). */
  const sessionAgentKernel = createSessionAgentKernel({
    mode: modelRuntime.mode,
    activation: modelRuntime.activation,
    direct: modelRuntime.direct,
    ...(env.APP_ENV === 'e2e'
      ? {
          fixtureDecision: (request: { prompt: string }) =>
            /三页|3\s*页/u.test(request.prompt)
              ? {
                  merchantMessage: 'E2E three-page plan fixture',
                  action: {
                    kind: 'propose_plan' as const,
                    proposal: {
                      goalNarrative: /图文持续冲突样本/u.test(request.prompt)
                        ? '图文持续冲突样本'
                        : 'Create a three-page merchant content plan.',
                      recommendedDeliverables: [
                        {
                          carrier: 'note' as const,
                          platform: 'xiaohongshu',
                          quantity: 3,
                          purpose: 'Three-page image-text note',
                        },
                      ],
                      expressionStrategy: {},
                      factIntentions: [],
                      assetIntentions: [],
                    },
                  },
                  evidenceRefs: [],
                  assumptions: [],
                }
              : {
                  merchantMessage: 'fixture-session-turn',
                  action: { kind: 'finish_turn' as const },
                  evidenceRefs: [],
                  assumptions: [],
                },
        }
      : {}),
  });
  /**
   * V31-07: retrieval ports wrap product / store-fact / identity (no re-query).
   * Memory experience is attached after AgentMemoryPlatform is available below
   * (sessionHarnessService factory closes over mutable experience port).
   */
  const sessionRetrievalExperiencePort: {
    current?: {
      retrieveForInjection: (query: {
        workspaceId: string;
        scope: Record<string, unknown>;
        threadId?: string;
        limit?: number;
      }) => Promise<
        Array<{
          memoryId: string;
          statement: string;
          revision: number;
          kind?: string;
          authority?: string;
        }>
      >;
    };
  } = {};
  const sessionRetrievalPorts = createSessionRetrievalPorts({
    product: relationalProductRepository,
    storeFacts: storeFactLedger,
    identities: marketingIdentities,
    experience: {
      retrieveForInjection: async (query) => {
        if (!sessionRetrievalExperiencePort.current) {
          throw new Error(
            'Confirmed experience retrieval is not bound in the Core assembly.',
          );
        }
        return sessionRetrievalExperiencePort.current.retrieveForInjection(
          query,
        );
      },
    },
    // Late-bound: operationsService is assembled further down; port is only
    // invoked at turn time, after assembleCoreGraph completes.
    contentPackages: {
      list: async (workspaceId) => {
        if (!operationsService) return [];
        return operationsService.listContentPackages({
          actor: 'worker',
          correlationId: 'session-retrieval:read-recent-content',
          userId: 'session-harness-worker',
          workspaceId,
        });
      },
    },
    now: () => new Date().toISOString(),
  });
  /**
   * V31-18 P0-2: server-owned confirmed-experience retrieval. It is assembled
   * unconditionally — the Composer needs it on every deploy, while the Session
   * kernel only exists in fixture mode or after `live_verified` activation.
   * Both the Session Harness tool path and the Composer plan path consume this
   * single definition, so retrieval and its MemoryInjectionReceipt cannot be
   * present on one path and silently absent on the other.
   */
  const sessionConfirmedExperienceRetrieval = async (input: {
    workspaceId: string;
    threadId: string;
    taskId: string;
    runId: string;
    harnessReleaseId: string;
    storeId: string;
    platform: string;
  }) => {
    if (!sessionRetrievalPorts.listConfirmedExperience) {
      throw new Error(
        'Confirmed experience retrieval is not available in the Core assembly.',
      );
    }
    return sessionRetrievalPorts.listConfirmedExperience({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      limit: 8,
      injectionContext: {
        taskId: input.taskId,
        runId: input.runId,
        harnessReleaseId: input.harnessReleaseId,
      },
      scope: {
        storeId: input.storeId,
        platform: input.platform,
      },
    });
  };
  /** Durable agent session store (V31-02) — also backs Session Harness service. */
  const agentSessionStore = new PostgresAgentSessionStore(pool);
  /** V31-24 MarketingGoal + opportunity decision log (production PG only). */
  const marketingGoalStore = new PostgresMarketingGoalStore(pool);
  const opportunityDecisionStore = new PostgresOpportunityDecisionStore(pool);
  /** Append-only MarketingPlanRevision store (V31-09 Plan Compiler). */
  const marketingPlanStore = new PostgresMarketingPlanStore(pool);
  /**
   * V31-11: ExecutionConfirmationRequest + PlanConfirmationDecision.
   * createRequest runs balance check + FEFO reserve under workspace credit lock.
   */
  const executionConfirmationMigration =
    new PostgresExecutionConfirmationMigration(pool);
  const executionConfirmationAuthorityStore =
    new PostgresConfirmationAuthorityStore(pool);
  const executionConfirmationService = new ExecutionConfirmationService(
    executionConfirmationMigration.requestStore,
    executionConfirmationMigration.decisionStore,
    confirmationCreditPortFromPostgresLedger(
      creditLedger,
      new PostgresProductReservationReplacement(pool),
    ),
    executionConfirmationAuthorityStore,
  );
  /**
   * V31-12: ExecutionPlanSnapshot admission (sole writer of execution_plan_snapshot).
   * One-shot write on task-admission; DBOS re-verifies before run.
   */
  const executionPlanAdmissionMigration =
    new PostgresExecutionPlanAdmissionMigration(pool);
  const executionPlanAdmissionService = new ExecutionPlanAdmissionService(
    executionPlanAdmissionMigration.store,
  );
  const executionConfirmationAuthority = new ConfirmationAuthorityAssembler(
    executionConfirmationService,
    executionConfirmationAuthorityStore,
    productQuoteService,
  );
  /** V31-14: durable pending interrupts (CAS resume / listPending). */
  const interruptStore = new PostgresInterruptStore(pool);
  /**
   * V31-13: shadow reconciliation evidence + program state (PG production).
   * Memory store is test-only; sampling hangs off Make complete path (no daemon).
   */
  const shadowReconciliationStore = new PostgresShadowReconciliationStore(pool);
  const shadowReconciliationService = new ShadowReconciliationService({
    store: shadowReconciliationStore,
    audit: opsConsoleStore,
    resolveConfig: () =>
      resolveShadowReconciliationConfigFromAdmin(adminConfigRepository),
  });
  /**
   * V31-16: append-only Make steering commands (Postgres sole writer).
   * Gate hot-reads make_steering_v1 + disable_make_steering.
   */
  const steeringCommandStore = new PostgresSteeringCommandStore(pool);
  const steeringService = new SteeringService({
    store: steeringCommandStore,
    resolveGate: () => resolveMakeSteeringGate(adminConfigRepository),
    resolveAuthority: async ({ workspaceId, threadId, taskId }) => {
      const admitted =
        await executionPlanAdmissionMigration.store.getByWorkflowId(taskId);
      if (!admitted || admitted.workspaceId !== workspaceId) {
        throw new SteeringServiceError(
          'NOT_FOUND',
          `No admitted execution plan exists for task ${taskId} in this workspace.`,
          404,
        );
      }
      const bound = await pool.query<{
        thread_id: string;
        snapshot_hash: string | null;
        work_id: string;
      }>(
        `SELECT run.thread_id, run.snapshot_hash, submission.work_id
           FROM p1_agent_runs run
           JOIN p1_agent_threads thread ON thread.thread_id = run.thread_id
           JOIN execution_spine.creation_submissions submission
             ON submission.workspace_id = thread.resource_id
            AND submission.task_id = run.workflow_id
          WHERE thread.resource_id = $1
            AND run.workflow_id = $2
            AND run.thread_id = $3
            AND run.durability = 'sync'
          ORDER BY submission.snapshot_revision DESC
          LIMIT 1`,
        [workspaceId, taskId, threadId],
      );
      const binding = bound.rows[0];
      if (
        !binding ||
        binding.thread_id !== threadId ||
        binding.snapshot_hash !== admitted.snapshot.snapshotHash
      ) {
        throw new SteeringServiceError(
          'INVALID_INPUT',
          'Steering thread/task binding does not match the admitted execution run.',
          409,
        );
      }
      const progress = await steeringCommandStore.getTaskProgress({
        workspaceId,
        taskId,
      });
      if (progress.length === 0) {
        throw new SteeringServiceError(
          'QUEUE_NOT_READY',
          'No execution-unit progress has been observed for this Make run.',
          409,
        );
      }
      return {
        workId: binding.work_id,
        sourcePlanRevision: admitted.snapshot.planRevision,
        sourceContentVersionIds: [],
        snapshotHash: admitted.snapshot.snapshotHash,
        units: progress,
      };
    },
  });
  /**
   * V31-08: late-bound billing quote resolver. productQuoteAuthority is
   * assembled further down; ports are only invoked at turn time.
   */
  const sessionBillingQuoteBridge: {
    resolve?: (input: {
      workspaceId: string;
      runId: string;
      merchantMessage: string;
      level: 0 | 1 | 2 | 3;
      isPureCopy: boolean;
    }) => Promise<SessionBillingQuoteFacts | null>;
  } = {};
  /**
   * V31-07 Session Harness service: kernel + retrieval tools + intent policies.
   * V31-08: progressive levels + billing UX ports (A5) on the production path.
   * Only assembled when a kernel is available (fixture always; live when verified).
   * V31-09 PlanCompiler is late-bound after rights/model ports assemble.
   */
  const sessionAgentHarness = sessionAgentKernel
    ? new AgentSessionHarnessService({
        store: agentSessionStore,
        kernel: sessionAgentKernel,
        // Lifecycle-aware resolution is fail-closed: a frozen run must always
        // resolve its exact immutable release. Rollback only changes new runs.
        resolveRelease: (harnessReleaseId) =>
          resolveSessionRunRelease({
            service: harnessReleaseService,
            harnessReleaseId,
          }),
        createToolRegistry: (turn) =>
          createRetrievalToolRegistry({
            ports: sessionRetrievalPorts,
            context: {
              workspaceId: turn.workspaceId,
              threadId: turn.threadId,
              creationMode: turn.creationMode ?? 'customized',
              platform: turn.platform,
              ...(turn.memoryScope ?? {}),
            },
          }),
        retrieveConfirmedExperience: sessionConfirmedExperienceRetrieval,
        createPolicies: (_turn, authority) =>
          createIntentRetrievalPolicies({
            knownFields: authority?.knownFields ?? [],
            ...(authority?.impactByKey
              ? { impactByKey: authority.impactByKey }
              : {}),
            ...(authority?.authoritativeKeys
              ? { authoritativeKeys: authority.authoritativeKeys }
              : {}),
          }),
        resolveCreationMode: (turn) => turn.creationMode,
        registerCheckpointWriter: true,
        // Kill switch can only tighten pure-copy exemption (U1 / A13).
        forceConfirmationKillSwitch: () => {
          const raw =
            env.MEIYE_SESSION_FORCE_CONFIRMATION ??
            env.SESSION_FORCE_CONFIRMATION;
          return raw === '1' || raw === 'true';
        },
        billingBalancePort: {
          resolveBalance: async ({ workspaceId }) => {
            const projection = await creditLedger.project(workspaceId);
            return { availableCredits: projection.availableCredits };
          },
        },
        billingQuotePort: {
          resolveQuote: async (input) => {
            if (!sessionBillingQuoteBridge.resolve) return null;
            return sessionBillingQuoteBridge.resolve(input);
          },
        },
      })
    : undefined;
  const foundationLedgerService = new P1ApplicationService(
    foundationRepository
  );
  const productEntitlements = new GrantLotAwareProductEntitlementService(
    foundationRepository,
    grantLotLedger,
    recordedCommerceEnabled ? new RecordedAutoTopUpPaymentPort() : undefined,
    undefined,
    productQuoteService
  );
  const executionEntitlementPolicy = new CreditSubscriptionEntitlementPolicy(
    creditSubscriptionStore,
    creditPlanCatalog
  );
  const modelSupplyProviderAdmission = new PostgresModelSupplyProviderAdmission(
    {
      productEntitlements: executionEntitlementPolicy,
      entitlementPolicies: entitlementPolicyStore,
      accountAllocations: accountAllocationStore,
      supplyPools: supplyPoolStore,
      capacityLeases: capacityLeaseStore,
      creditMeteringEnabled: true,
    }
  );
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
        }
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
              { deployments, models }
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
        operation === 'image.reference_transform' ? 'image.edit' : operation
      );
    },
  });
  /**
   * V31-08 production quote bridge for confirmation-exempt paths (A5).
   * Resolves only pure-copy default pricing from catalog authority — never
   * invents creditCost / failureRefundsCredits outside product quote facts.
   */
  sessionBillingQuoteBridge.resolve = async (input) => {
    if (!input.isPureCopy) return null;
    try {
      const snapshot = await platformDefaultModelSource.getSnapshot();
      const catalogModelId =
        snapshot.copy?.catalogModelId ??
        e2ePlatformModelDefaults.copy ??
        undefined;
      if (!catalogModelId) return null;
      const buildInput = await productQuoteAuthority.resolve({
        workspaceId: input.workspaceId,
        catalogModelId,
        operation: 'copy.generate',
        quoteId: `session-level:${input.runId}`,
        quantity: 1,
      });
      if (
        !Number.isSafeInteger(buildInput.creditCost) ||
        (buildInput.creditCost ?? 0) <= 0 ||
        typeof buildInput.failureRefundsCredits !== 'boolean'
      ) {
        return null;
      }
      return {
        creditCost: buildInput.creditCost as number,
        failureRefundsCredits: buildInput.failureRefundsCredits,
      };
    } catch {
      // Fail closed: missing catalog/model → chip hidden + submit blocked.
      return null;
    }
  };
  const providerConnectivity = providerConnectivityProbeFromEnv(
    providerCredentialRuntime.env
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
    const processKind = options.role === 'api' ? 'http' : 'job-worker';
    const view = await capabilityHotAssembly.reportProcessView(processKind);
    const defaultSupplyPool = await supplyPoolStore.get('pool-shared-default');
    console.log(
      `[z2-wiring] ${processKind} capability revision=${view.effectiveCapabilityRevisionId ?? 'none'} catalog=${view.effectiveCatalogRevisionId ?? 'none'} supplyPool=${defaultSupplyPool?.id ?? 'missing'}`
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
  const modelAdminActorIds = (env.P1_ADMIN_ACTOR_IDS ?? '')
    .split(',')
    .map((actorId) => actorId.trim())
    .filter(Boolean);
  const jobRuntimeWorkerActorIds = (env.P1_JOB_RUNTIME_WORKER_ACTOR_IDS ?? '')
    .split(',')
    .map((actorId) => actorId.trim())
    .filter(Boolean);
  const jobRuntime = PgBossJobPort.connect({
    connection: databaseUrl,
    queuePrefix: env.JOB_QUEUE_PREFIX ?? 'meiye-p1',
    workspaceConcurrencyLimits: creditPlanConcurrencyTiers(),
    ...(options.role === 'worker' && harnessRuntimeConfig
      ? {
          terminalNotifier: async ({ envelope, status, output }) => {
            await sendHarnessMediaJobTerminal({
              workspaceId: envelope.workspaceId,
              jobId: envelope.jobId,
              kind: envelope.kind,
              payload: envelope.payload,
              status,
              ...(output ? { output } : {}),
            });
          },
        }
      : {}),
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
    workspaceBootstrapper,
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
    memoryInjectionReceiptStore,
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
    // Agent session + semantic event tables (V31-02/03). Shadow: no Task/billing/UI write path.
    agentSessionStore,
    new PostgresAgentSemanticEventStore(pool),
    // V31-24 MarketingGoal + opportunity decision append-only log (no candidate table).
    marketingGoalStore,
    opportunityDecisionStore,
    // Marketing plan revisions (V31-09 Plan Compiler) — append-only, no status column.
    marketingPlanStore,
    // V31-11 confirmation objects (request + immutable decision).
    executionConfirmationMigration,
    executionConfirmationAuthorityStore,
    // V31-12 ExecutionPlanSnapshot admission (one-shot immutable).
    executionPlanAdmissionMigration,
    // V31-14 durable Interrupt store (pending confirm survives restart).
    interruptStore,
    // V31-13 shadow reconciliation samples + program state (ops audit reuse).
    shadowReconciliationStore,
    // V31-16 append-only Make steering commands (PG sole writer).
    steeringCommandStore,
  ]);
  await ensureCreditPlanCatalogDefaults(adminConfigRepository);
  await migrateCreditPlanCatalogCurrencyToHkd(adminConfigRepository);
  if (modelRuntime.mode === 'fixture') {
    await initializeWorkspaceCatalog(PLATFORM_SUPPLY_SCOPE_ID);
  }
  const tracerJobs = new TracerJobApplicationService(tracerJobRepository);
  const parseService = new ParseService(
    parseRepository,
    documentParseProviderFromEnv(env),
    new FixtureAssetDraftCompiler(),
    new FixtureVisualAssetClassifier(),
    new StoredParseSourceAssetAuthorizer(assetStorage),
    new AdminConfigAssetIntakeGuidanceSource(adminConfigRepository),
    tracerJobs
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
        await store.editRun(input, new Date().toISOString())
      );
      return { workflow };
    },
    async list(input: { actorId: string; workspaceId: string }) {
      const store = new PostgresCanonicalVideoRunStore(pool, input.workspaceId);
      return (await store.listRuns(input.workspaceId, input.actorId)).map(
        (run) => ({ workflow: projectDurableVideoWorkflow(run) })
      );
    },
    async query(input: { workflowId: string; workspaceId: string }) {
      const store = new PostgresCanonicalVideoRunStore(pool, input.workspaceId);
      const run = await store.getRun(input.workflowId);
      if (!run) {
        throw new P1DomainError(
          'NOT_FOUND',
          `Video workflow ${input.workflowId} was not found.`
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
        [workspaceId, workflowId]
      );
      return result.rowCount === 1;
    },
    async readSnapshot(workspaceId, workflowId) {
      return canonicalVideoWorkflow.query({ workspaceId, workflowId });
    },
  });
  const feishuMcp = feishuMcpAdapterFromEnv(env);
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
          env.BYOK_OPENAI_COMPATIBLE_ENDPOINT ?? 'https://api.openai.com/v1',
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
      providerCredentialRuntime.env
    ),
    repository: integrationRepository,
    secrets: integrationSecrets,
  });
  if (options.role === 'api') {
    await registerFeishuToolLifecycleSchedule(jobRuntime, {
      ...(env.FEISHU_TOOL_CATALOG_CRON
        ? { cron: env.FEISHU_TOOL_CATALOG_CRON }
        : {}),
      ...(env.FEISHU_TOOL_CATALOG_TIMEZONE
        ? { timezone: env.FEISHU_TOOL_CATALOG_TIMEZONE }
        : {}),
    });
    await registerFeishuIntentReconciliationSchedule(jobRuntime, {
      ...(env.FEISHU_INTENT_RECONCILIATION_CRON
        ? { cron: env.FEISHU_INTENT_RECONCILIATION_CRON }
        : {}),
      ...(env.FEISHU_INTENT_RECONCILIATION_TIMEZONE
        ? { timezone: env.FEISHU_INTENT_RECONCILIATION_TIMEZONE }
        : {}),
    });
  }
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
  // The projection adapter is stateless. Each process owns one instance, built
  // from this shared recipe, because API and worker run in separate processes.
  const searchProjection = new OperationsProductSearchProjection(
    operationsRepository
  );
  // Worker batch execution reaches Product commands, including copy generation,
  // ownership gates, quality feedback, and projections. Both roles therefore
  // receive the complete ProductService dependency set.
  const legacyProductService = new ProductService({
    repository: productRepository,
    notifier,
    planConfig: productPlans,
    copyProviders: createCopyProviders(legacyCopyBridge),
    qualitySink,
    inFlightDecisions: legacyInFlightDecisions,
    acceptedWriteOwner: 'legacy',
    contentWriteOwnership: contentPackageWriteOwnership,
    legacyBillingReadOnly: true,
    packageRightsPropagation,
    storageEntitlements: executionEntitlementPolicy,
  });
  const relationalProductService = new ProductService({
    repository: relationalProductRepository,
    notifier,
    planConfig: productPlans,
    copyProviders: createCopyProviders(p1CopyBridge),
    qualitySink,
    inFlightDecisions: legacyInFlightDecisions,
    acceptedWriteOwner: 'p1',
    contentWriteOwnership: contentPackageWriteOwnership,
    copyUsageAuthority: 'foundation_ledger',
    legacyBillingReadOnly: true,
    legacyVideoPath: 'disabled',
    packageRightsPropagation,
    storageEntitlements: executionEntitlementPolicy,
    searchProjection,
    // Billing write-lock makes syncFoundationCopyUsage return before this read,
    // so usage projection is currently unreachable in both roles. It remains
    // wired here to preserve the previously complete API configuration.
    productEntitlements,
  });
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
  /**
   * V31-09 Plan Compiler — deterministic ports over rights + model catalog.
   * Bound onto Session Harness when the kernel is assembled (harness surface).
   */
  const planCompiler = createProductionPlanCompiler({
    store: marketingPlanStore,
    ports: createProductionPlanCompilerPorts({
      rights: contentPackageRightsResolver,
      models: {
        getCatalog: async (workspaceId, operation) => {
          const view = await modelControlPlane.getCatalog(
            workspaceId,
            operation,
          );
          return {
            revisionId: view.revisionId,
            models: view.models.map((model) => ({ id: model.id })),
          };
        },
      },
      // V31-38: skill receipt binds the skill-repository-issued revision + hash.
      skills: {
        async resolveSkill({ skillId }) {
          const revision = await skillRepository.getRevisionHead(skillId);
          if (!revision) return null;
          const skillRevisionRef = revision.skillRevisionRef?.trim() ?? '';
          const contentHash = revision.contentHash?.trim() ?? '';
          if (!skillRevisionRef || !contentHash) return null;
          return {
            skillId: revision.skillId,
            skillRevisionRef,
            contentHash,
          };
        },
      },
      // Multi-carrier package pricing remains server-only: the compiler can
      // use this authority only when a caller supplies every authenticated
      // carrier authority and final deliverable explicitly.
      packageQuotes: productQuoteAuthority,
      billing: productQuoteService,
    }),
  });
  sessionAgentHarness?.bindPlanCompiler(planCompiler);
  // V31-11: confirmation objects on the Session confirmation path (create/decide/expire).
  sessionAgentHarness?.bindExecutionConfirmation(executionConfirmationService);

  const contentPackageRightsBasisResolver =
    new ContentPackageRightsBasisResolver(
      contentPackageRightsResolver,
      supplyControlRepository,
      {
        allowLocalFixtureTerms: p1ModelSupplyRuntime.allowRecordedExecution,
      }
    );
  const contentPackageExportAssets =
    new OperationsContentPackageExportAssetReader(
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
        (
          await operationsRepository.loadWorkspace(input.workspaceId)
        )?.contentPackages.find(
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
        allowRecordedSyntheticVideoCompliance: env.APP_ENV === 'e2e',
        appEnv: env.APP_ENV,
      }
    ),
    contentPackageApprovalPolicy,
    contentPackageRightsBasisResolver,
    contentPackageRightsResolver,
    contentWriteOwnership: contentPackageWriteOwnership,
    assetDataClassResolver: new ProductAssetDataClassResolver(
      relationalProductRepository
    ),
    batchExecutor,
    canvasExporter: new PersistentCanvasExportAdapter(assetStorage),
    creationExecutor: new ModelSupplyCreationExecutor(
      modelControlPlane,
      referenceAssets
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

  const evalLayersAssembly = createProductionEvalLayersAssembly({
    releases: harnessReleaseStore,
    verdicts: evalVerdictStore,
    // Enqueue into harness langfuse_outbox; worker/sender own delivery.
    langfuseWriter: new OutboxLangfuseEvalWriter(
      evalLangfuseOutboxFromAuditStore(promptAuditStore),
    ),
    rollbackDrills: opsConsoleStore,
  });

  return {
    harnessPromptResolver,
    modelSupplyPromptResolver,
    databaseUrl,
    serviceToken,
    harnessRuntimeConfig,
    pool,
    diagnosticRepository,
    productRepository,
    relationalProductRepository,
    creativeGroundingResolver,
    assetStorage,
    foundationRepository,
    workspaceBootstrapper,
    ownedReferenceAssets,
    productReferenceAssets,
    referenceAssets,
    grantLotLedger,
    creditLedger,
    creditSubscriptionStore,
    redemptionStore,
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
    memoryInjectionReceiptStore,
    contentPackageWriteOwnership,
    contentPackageMigrationRuns,
    contentPackageMigration,
    adminConfigRepository,
    sensitiveWordsRepository,
    creditPlanCatalog,
    creditBilling,
    dueDeliveryRepository,
    cloudflareMapping,
    cloudflareInventory,
    integrationRepository,
    skillRepository,
    storeWorkflowCaptureRepository,
    supplyControlRepository,
    supplyPlanningControlPlane,
    harnessSchemaStore,
    harnessReleaseStore,
    harnessReleaseService,
    opsConsoleStore,
    evalVerdictStore,
    evalLayersAssembly,
    promptAuditStore,
    harnessInteractionStore,
    harnessObservabilityStore,
    integrationSecrets,
    credentialRotationReceipts,
    providerCredentialOperator,
    providerCredentialRuntime,
    providerCredentialSecretBroker,
    modelSupplyRepository,
    canonicalVideoWorkflowSchema,
    cutoverExecution,
    legacyInFlightDecisions,
    port,
    notificationWebhook,
    downstreamNotifier,
    notifier,
    productPlans,
    modelCatalogTenantAllowlist,
    runtimeAssembly,
    deployments,
    models,
    modelRuntime,
    bootCapabilityHotAssembly,
    capabilityHotAssembly,
    supplyPoolStore,
    entitlementPolicyStore,
    accountAllocationStore,
    capacityLeaseStore,
    supplyFreezeStore,
    bootDeploymentIds,
    productQuoteService,
    billingLifecycle,
    permissionAuthorizer,
    mediaExecutionMode,
    gatedModelExecution,
    streamingModeGate,
    gatedMediaExecution,
    integrationAssembly,
    byokRuntime,
    e2ePlatformModelDefaults,
    platformDefaultModelSource,
    adminConfigRuntime,
    aiStreamingRunner,
    sessionAgentKernel,
    agentSessionStore,
    sessionRetrievalPorts,
    sessionRetrievalExperiencePort,
    sessionConfirmedExperienceRetrieval,
    sessionAgentHarness,
    marketingPlanStore,
    planCompiler,
    executionConfirmationService,
    executionConfirmationAuthority,
    executionConfirmationAuthorityStore,
    executionConfirmationRequestStore:
      executionConfirmationMigration.requestStore,
    planConfirmationDecisionStore: executionConfirmationMigration.decisionStore,
    executionPlanAdmissionService,
    executionPlanSnapshotStore: executionPlanAdmissionMigration.store,
    interruptStore,
    shadowReconciliationStore,
    shadowReconciliationService,
    steeringCommandStore,
    steeringService,
    foundationLedgerService,
    productEntitlements,
    executionEntitlementPolicy,
    modelSupplyProviderAdmission,
    p1ModelSupplyRuntime,
    p1ModelSupplyService,
    marketingIdentityStructuredExecutor,
    marketingIdentityDrafter,
    modelControlPlane,
    productQuoteAuthority,
    providerConnectivity,
    adminProviderEvidence,
    adminSupplyControlPlane,
    legacyModelSupplyRuntime,
    legacyModelSupplyService,
    legacyModelControlPlane,
    initializeWorkspaceCatalog,
    resolveCopySelection,
    resolveCopyPrompt,
    p1CopyBridge,
    legacyCopyBridge,
    modelAdminActorIds,
    jobRuntimeWorkerActorIds,
    jobRuntime,
    entitlementJobRuntime,
    tracerJobRepository,
    operationalTelemetryStore,
    tracerJobs,
    parseService,
    operationsService,
    packageRightsPropagation,
    canonicalVideoWorkflow,
    videoWorkflowEventSource,
    feishuMcp,
    integrationService,
    createCopyProviders,
    qualitySink,
    searchProjection,
    legacyProductService,
    relationalProductService,
    productService,
    batchExecutor,
    contentPackageRightsResolver,
    contentPackageRightsBasisResolver,
    contentPackageExportAssets,
    canvasExportAssetAccess,
    sourceContentPackageReader,
    sourceContentPackages,
    sourceContentPackageAdmissionReader,
    contentPackageApprovalPolicy,
  };
}

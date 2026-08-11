import { shutdownLangfuseTracing } from '../instrumentation.js';

import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  confirmationCardTimeoutSecondsSchema,
  contentPackageSchema,
} from '@meiye/contracts';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  ADMIN_CONFIG_KEY_CLASSIFICATION,
  createMarketingIdentityReferenceResolver,
  createWriteOwnershipReader,
  probeObjectStorageReadWrite,
  validatePlatformDefaultModel,
} from '../assembly/domain-rules.js';
import { noteEnhancementJudgeResolverForMode } from './note-enhancement-judge.js';
import {
  AdminConfigBoundedExecutionContinuationResolver,
  AdminConfigBoundedExecutionLimitsResolver,
  AdminConfigBoundedExecutionLimitsSource,
  AdminConfigEntitlementCatalogSource,
  AdminConfigFoundationModule,
  AdminConfigNotePlanSettingsSource,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
  runtimeModeValidatorsFromProviderCredentials,
} from '../p1/admin-config/index.js';
import { HarnessCheckTargetScope } from '../p1/agent-primitives/harness-check-target-scope.js';
import { HarnessQuestionRequestPort } from '../p1/agent-primitives/harness-question-request-port.js';
import { P1HarnessAskInvoker } from '../p1/agent-primitives/p1-harness-ask-invoker.js';
import { P1HarnessCandidateRunnerScope } from '../p1/agent-primitives/p1-harness-candidate-runner.js';
import { P1HarnessCheckInvoker } from '../p1/agent-primitives/p1-harness-check-invoker.js';
import { createProductionAgentPrimitiveAssembly } from '../p1/agent-primitives/production-assembly.js';
import { runCloudflareSelfProbes } from '../p1/cloudflare-read/index.js';
import {
  AgentPrimitiveObservabilityAdapter,
  createDurableCreationExperienceRuntime,
  HarnessObservabilityEventAudit,
} from '../p1/creation-experience/index.js';
import type { CreditPlanReferenceNumbers } from '../p1/credit-billing/credit-plan-catalog.js';
import { E2ECreditDetailFixture } from '../p1/credit-billing/e2e-credit-detail-fixture.js';
import { assertReferenceModelsArePriced } from '../p1/credit-billing/reference-number-model-validation.js';
import { DueAwareHarnessRecommendationReader } from '../p1/due-delivery/recommendation-reader.js';
import { TaskRecallDueProducer } from '../p1/due-delivery/task-recall-producer.js';
import { fingerprintValue } from '../p1/job-runtime/job-contracts.js';
import {
  StructuredComposerDestinationMapper,
  type ComposerDestinationMappingPort,
} from '../p1/execution-spine/composer-destination-mapper.js';
import { ModelSupplyComposerRouteResolver } from '../p1/execution-spine/composer-route-resolver.js';
import {
  CapabilityHotAssemblyComposerReadiness,
  ComposerSubmissionAdmissionGate,
} from '../p1/execution-spine/composer-submission-gate.js';
import { PostgresContentPackageRevisionWritePort } from '../p1/execution-spine/content-package-revision-port.js';
import { CreationStagePort } from '../p1/execution-spine/creation-stage-port.js';
import type { ComposerSubmissionRequest } from '../p1/execution-spine/creation-execution-snapshot.js';
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from '../p1/execution-spine/postgres-creation-submission-store.js';
import { PostgresRepricedPaidExecutionSuccessorBuilder } from '../p1/execution-spine/postgres-repriced-paid-execution-successor-builder.js';
import {
  CreationSubmissionCoordinator,
  type CreationSubmissionRecord,
} from '../p1/execution-spine/submission-coordinator.js';
import { CampaignPaidWorkApplication } from '../p1/goal-proactive/campaign-paid-work-application.js';
import { CampaignPlanApprovalService } from '../p1/goal-proactive/campaign-plan-approval.js';
import {
  CampaignPaidWorkLifecycle,
  type CampaignPaidWorkResult,
} from '../p1/goal-proactive/campaign-paid-work-lifecycle.js';
import { CampaignPaidWorkProducer } from '../p1/goal-proactive/campaign-weekly-schedule.js';
import { createCampaignWorkQuoteMinter } from '../p1/goal-proactive/campaign-work-quote.js';
import { PostgresCampaignPaidWorkLifecycleStore } from '../p1/goal-proactive/postgres-campaign-paid-work-lifecycle.js';
import {
  P1ApplicationService,
  ProductEntitlementFoundationModule,
  RedemptionApplicationService,
  RedemptionFoundationModule,
} from '../p1/foundation/index.js';
import { HarnessApplicationService } from '../p1/harness/application-service.js';
import { HarnessBillingCompensationWorker } from '../p1/harness/billing-compensation.js';
import { HarnessDbosWorkflowEventReader } from '../p1/harness/dbos-workflow-events.js';
import {
  abandonReleasedHarnessReservation,
  createHarnessInterruptProtocolPort,
  createHarnessInterruptResumeBridge,
  confirmationCardHoldExpired,
  DbosHarnessWorkflowStarter,
  DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS,
  registerHarnessDbosWorkflow,
  resumeHarnessDbosInteractionWorkflow,
  resumeHarnessDbosWorkflow,
} from '../p1/harness/dbos-workflow.js';
import { HarnessDecisionService } from '../p1/harness/decision-service.js';
import { IMAGE_MODEL_RECIPE_PROFILE } from '../p1/harness/image-intent-compiler.js';
import {
  HarnessInteractionService,
  HarnessSystemDefaultProducer,
} from '../p1/harness/interaction-service.js';
import { requireHarnessFrozenPrompt } from '../p1/harness/langfuse-prompts.js';
import { resolveDestinationMappingPrompt } from '../p1/harness/destination-prompt-release.js';
import { langfuseSenderFromEnv } from '../p1/harness/langfuse-sender.js';
import {
  createAuthoritativeExecutionPlanLiveFactsPorts,
  createResolveExecutionPlanLiveFacts,
} from '../p1/harness/execution-plan-live-facts.js';
import { InterruptProtocolService } from '../p1/harness/interrupt-protocol.js';
import { PostgresNoteMediaAdmissionCoordinator } from '../p1/harness/note-media-admission.js';
import {
  HarnessObservabilityReconciler,
  shouldPublishObservabilityDeliverySnapshot,
} from '../p1/harness/observability-reconciliation.js';
import {
  HarnessLangfuseOutboxLoop,
  HarnessLangfuseOutboxWorker,
} from '../p1/harness/outbox-worker.js';
import { HarnessCarrierSettlementWorker } from '../p1/harness/carrier-settlement-worker.js';
import { PostgresHarnessBillingCompensationStore } from '../p1/harness/postgres-billing-compensation-store.js';
import { PostgresHarnessCarrierSettlementCoordinator } from '../p1/harness/postgres-carrier-settlement-coordinator.js';
import { PostgresHarnessResumeReconcilerStore } from '../p1/harness/postgres-resume-reconciler-store.js';
import { HarnessProductBillingSettlementExecutor } from '../p1/harness/product-billing-settlement.js';
import {
  LedgerBackedFactRightsAuthorizationPort,
  LedgerBackedHarnessContextPort,
} from '../p1/harness/production-context-port.js';
import { ProductionHarnessFrozenRouteSnapshotResolver } from '../p1/harness/production-frozen-route.js';
import { createProductionHarnessMediaAssembly } from '../p1/harness/production-media-assembly.js';
import { PostgresLegacyShadowObservationReader } from '../p1/harness/legacy-shadow-observation-reader.js';
import {
  ProductionHarnessStagePorts,
  type HarnessStructuredNodeRunnerFactory,
} from '../p1/harness/production-stage-ports.js';
import {
  DEFAULT_HOLD_RESERVATION_TTL_SECONDS,
  HarnessReservationSweeper,
  type HarnessReservationSweep,
} from '../p1/harness/reservation-sweeper.js';
import {
  HarnessResumeReconciler,
  type HarnessResumeWorkflow,
} from '../p1/harness/resume-reconciler.js';
import { assertPendingActionsShareDatabase } from '../p1/harness/runtime-config.js';
import { createHarnessStructuredModelExecutor } from '../p1/harness/structured-model-runtime.js';
import { createProductionSkillManifestResolver } from '../p1/harness/production-skill-manifest-resolver.js';
import {
  resolveShadowReconciliationConfigFromAdmin,
  shouldSampleShadowReconciliation,
} from '../p1/harness/shadow-reconciliation.js';
import { HarnessTaskAdmissionService } from '../p1/harness/task-admission.js';
import type { HarnessWorkflowInput } from '../p1/harness/task-admission.js';
import {
  FixtureImageExactTextVerifier,
  ModelSupplyImageExactTextVerifier,
} from '../p1/harness/unified-media-stage-ports.js';
import {
  IntegrationsFoundationModule,
  OperationsConfirmationTaskAdapter,
} from '../p1/integrations/index.js';
import {
  JobRuntimeFoundationModule,
  PostgresOperationalMetricsCollector,
} from '../p1/job-runtime/index.js';
import {
  ModelSupplyFoundationModule,
  type ActivationEvidence,
} from '../p1/model-supply/index.js';
import { ModelSupplyStructuredNodeRunner } from '../p1/model-supply/structured-node-runner.js';
import {
  AssetIntakeService,
  AssetMemoryFoundationModule,
  CanonicalMemoryProposalRedline,
  contentPackageDeliveryCapability,
  ContentPackageDeliveryService,
  ContextFoundationModule,
  createContextInvalidationRuntime,
  ExpiredFactInvalidationWorker,
  AgentMemoryPlatform,
  MarketingIdentityFoundationModule,
  MemoryFoundationModule,
  OperationsFoundationModule,
  OperationsReusableAssetSourceVerifier,
  ProductionMemorySedimentationCoordinator,
  ProductLegacyDeliveryProjection,
  PublishHandoffService,
  resolveAgentMemoryKillSwitch,
  ReuseMemoryComposerConversationDeletionNotifier,
  ReuseMemoryRecordProposalPort,
  ReuseMemoryService,
} from '../p1/operations/index.js';
import { StoreIntakeFinalizer } from '../p1/operations/store-intake-finalizer.js';
import { StoreProfileImportPreparer } from '../p1/operations/store-profile-import.js';
import { PendingActionsService } from '../p1/pending-actions.js';
import { ProductBillingFoundationModule } from '../p1/product-billing/index.js';
import {
  createDurableResultDeliveryRuntime,
  ResultDeliveryFoundationModule,
} from '../p1/result-delivery/index.js';
import {
  OperationsResultCommandPort,
  OperationsVisualAdoptionPort,
} from '../p1/result-delivery/operations-visual-adoption.js';
import { PostgresResultAdjustSnapshotReadPort } from '../p1/result-delivery/postgres-result-adjust-snapshot.js';
import {
  OpsConsoleFoundationModule,
  OpsConsoleService,
  PostgresLegacyReplayInventory,
  resolveWorkspaceHarnessRelease,
} from '../p1/ops-console/index.js';
import { HarnessReleaseService } from '../p1/harness/harness-release.js';
import {
  AgentSessionFoundationModule,
  PlanEventOutboxDispatcher,
  PlanEventOutboxLoop,
  PostgresAgentSessionStore,
  PostgresSteeringDerivedWorkflowStore,
  SteeringDerivedWorkflowCoordinator,
  findActiveExitRun,
  projectThreadToSession,
  resolveMakeSteeringGate,
} from '../p1/agent-session/index.js';
import {
  ContentPackageEvidenceCoveragePort,
  GoalProactiveFoundationModule,
  GoalService,
  OwnedDataProactiveSignalSource,
  PostgresMarketingGoalStore,
  PostgresOpportunityDecisionStore,
  ProactiveService,
  resolveProactiveGateConfig,
  type OwnedContentPackageFact,
} from '../p1/goal-proactive/index.js';
import { createMakeSteeringBoundaryPort } from '../p1/harness/make-steering-boundary.js';
import { SensitiveWordsFoundationModule } from '../p1/sensitive-words/index.js';
import {
  CompositeRecordProposalPort,
  createDurableSkillRuntime,
  E2EUserSelectedSkillEvidenceReader,
  E2EUserSelectedSkillFixture,
  StoreWorkflowCaptureService,
  StoreWorkflowRecordProposalPort,
} from '../p1/skills/index.js';
import {
  PLATFORM_SUPPLY_SCOPE_ID,
  platformDefaultsForOperation,
  resolvePlatformDefaultBindings,
} from '../p1/supply-registry/index.js';
import {
  AgentSemanticEventProjector,
  AgentSemanticLiveHub,
  PostgresAgentSemanticEventStore,
  resolveAgentSemanticEventAdapterEnabled,
  ShadowSemanticWorkflowEventReader,
} from '../p1/agent-semantic-events/index.js';
import {
  HarnessWorkflowEventSource,
  WorkflowEventApplicationService,
} from '../p1/workflow-events.js';
import {
  migratePostgresSchema,
  runIfPostgresSchemaStable,
} from '../postgres-schema-migration.js';
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
} from '../runtime-truth/index.js';
import {
  closeHttpServerWithDeadline,
  shutdownCoreRuntime,
} from '../server-shutdown.js';
import { createCoreServer } from '../server.js';

import { assembleCoreGraph } from './core-assembly.js';
import { assembleProductionComposerPlanSession } from './composer-plan-runtime-assembly.js';

/**
 * Legacy durable requests admitted before agentRunId use the Composer's
 * original task id. A prepared re-plan's DBOS workflowId is its per-revision
 * attempt id, while sourceTaskId remains the id used to mint the Agent Run.
 */
export function interruptProjectionTaskId(
  workflowId: string,
  request: HarnessWorkflowInput,
): string {
  return request.sourceTaskId ?? workflowId;
}

interface InterruptAgentRunLookup {
  getRun(input: {
    resourceId: string;
    runId: string;
  }): Promise<{ runId: string; threadId: string } | null>;
}

export async function resolveInterruptAgentCoordinates(
  runs: InterruptAgentRunLookup,
  input: {
    workspaceId: string;
    workflowId: string;
    request: HarnessWorkflowInput;
  },
): Promise<{ runId: string; threadId: string }> {
  if (input.request.agentRunId && !input.request.agentThreadId) {
    throw new Error(
      `Agent Run ${input.request.agentRunId} requires an Agent Thread identity.`,
    );
  }
  const runId =
    input.request.agentRunId ??
    `run:composer:${fingerprintValue({
      workspaceId: input.workspaceId,
      taskId: interruptProjectionTaskId(input.workflowId, input.request),
    }).slice(0, 32)}`;
  const run = await runs.getRun({
    resourceId: input.workspaceId,
    runId,
  });
  if (!run) {
    throw new Error(
      `Agent Run ${runId} is unavailable for interrupt projection.`,
    );
  }
  if (run.runId !== runId) {
    throw new Error(
      `Agent Run lookup returned ${run.runId} for requested ${runId}.`,
    );
  }
  if (
    input.request.agentThreadId &&
    run.threadId !== input.request.agentThreadId
  ) {
    throw new Error(
      `Agent Run ${runId} belongs to Thread ${run.threadId}, not ${input.request.agentThreadId}.`,
    );
  }
  return { threadId: run.threadId, runId: run.runId };
}

function isDerivedComposerSubmission(value: unknown): value is {
  contentPackage: { id: string };
  task: { id: string };
  work: { id: string };
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isIdRecord(candidate.contentPackage) &&
    isIdRecord(candidate.task) &&
    isIdRecord(candidate.work)
  );
}

function isIdRecord(value: unknown): value is { id: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim().length > 0;
}

export async function startApi(env: NodeJS.ProcessEnv) {
  const {
    harnessPromptResolver,
    databaseUrl,
    serviceToken,
    harnessRuntimeConfig,
    pool,
    diagnosticRepository,
    productRepository,
    assetStorage,
    foundationRepository,
    workspaceBootstrapper,
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
    reuseMemoryRepository,
    memoryInjectionReceiptStore,
    contentPackageMigration,
    adminConfigRepository,
    sensitiveWordsRepository,
    creditPlanCatalog,
    creditBilling,
    dueDeliveryRepository,
    cloudflareMapping,
    cloudflareInventory,
    skillRepository,
    storeWorkflowCaptureRepository,
    supplyControlRepository,
    harnessSchemaStore,
    harnessReleaseStore,
    harnessReleaseService,
    opsConsoleStore,
    evalLayersAssembly,
    promptAuditStore,
    harnessInteractionStore,
    harnessObservabilityStore,
    providerCredentialOperator,
    providerCredentialRuntime,
    modelSupplyRepository,
    port,
    modelCatalogTenantAllowlist,
    runtimeAssembly,
    deployments,
    models,
    modelRuntime,
    capabilityHotAssembly,
    productQuoteService,
    billingLifecycle,
    permissionAuthorizer,
    streamingModeGate,
    e2ePlatformModelDefaults,
    platformDefaultModelSource,
    adminConfigRuntime,
    aiStreamingRunner,
    sessionAgentKernel,
    agentSessionStore,
    sessionAgentHarness,
    sessionConfirmedExperienceRetrieval,
    executionConfirmationService,
    executionConfirmationAuthority,
    executionConfirmationAuthorityStore,
    sessionRetrievalExperiencePort,
    marketingPlanStore,
    planCompiler,
    executionPlanAdmissionService,
    interruptStore,
    shadowReconciliationService,
    steeringService,
    productEntitlements,
    executionEntitlementPolicy,
    p1ModelSupplyService,
    marketingIdentityDrafter,
    modelControlPlane,
    productQuoteAuthority,
    adminSupplyControlPlane,
    modelAdminActorIds,
    jobRuntimeWorkerActorIds,
    jobRuntime,
    entitlementJobRuntime,
    operationalTelemetryStore,
    tracerJobs,
    parseService,
    operationsService,
    canonicalVideoWorkflow,
    videoWorkflowEventSource,
    integrationService,
    productService,
    contentPackageRightsResolver,
    sourceContentPackages,
    sourceContentPackageAdmissionReader,
    contentPackageApprovalPolicy,
  } = await assembleCoreGraph(env, { role: 'api' });
  const legacyReplayInventory = new PostgresLegacyReplayInventory(pool);
  await legacyReplayInventory.migrateInstallationLedger();
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
          idempotencyKey
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
          idempotencyKey
        ),
    }
  );
  const storeProfileImportPreparer = new StoreProfileImportPreparer(
    {
      // V31-51: the product projection emits `store: null` for absence; the
      // internal legacy import port speaks `undefined`. This single adapter
      // normalizes the semantics instead of mixing them at call sites.
      read: async (context) => {
        const store = (
          await productService.bootstrap({ ...context, actor: 'user' })
        ).store;
        return store ?? undefined;
      },
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
  // V31-12/V31-14: rights and fact heads come from one authoritative,
  // fail-closed adapter (createAuthoritativeExecutionPlanLiveFactsPorts).
  // The earlier plan-assetUsage / echoing resolvers were removed so a frozen
  // ref can never be reported back as its own live head.
  // V31-18: production AgentMemoryPlatform — Postgres injection receipts + admin-config kill switches.
  const agentMemoryPlatform = new AgentMemoryPlatform(
    reuseMemoryService,
    memoryInjectionReceiptStore,
    () => resolveAgentMemoryKillSwitch(adminConfigRepository)
  );
  // V31-07: session retrieval `read_confirmed_experience` consumes Memory platform.
  sessionRetrievalExperiencePort.current = agentMemoryPlatform;
  // Constructive assembly guard: kernel and harness must co-exist (fixture always).
  if (Boolean(sessionAgentKernel) !== Boolean(sessionAgentHarness)) {
    throw new Error(
      'Session harness assembly mismatch: sessionAgentKernel and sessionAgentHarness must both be set or both unset.',
    );
  }
  operationsService.attachComposerConversationDeletionNotifier(
    new ReuseMemoryComposerConversationDeletionNotifier(reuseMemoryService)
  );
  let harnessService: HarnessApplicationService | undefined;
  let harnessTaskAdmissionService: HarnessTaskAdmissionService | undefined;
  let interruptProtocolService: InterruptProtocolService | undefined;
  let composerDestinationMapper: ComposerDestinationMappingPort | undefined;
  let composerSubmissionCoordinator: CreationSubmissionCoordinator | undefined;
  let campaignPaidWorks: CampaignPaidWorkApplication | undefined;
  let agentSemanticEventProjector: AgentSemanticEventProjector | undefined;
  let e2eInterruptExpiryRunner:
    | {
        expire(input: {
          workspaceId: string;
          interruptId: string;
        }): Promise<{ expired: true }>;
      }
    | undefined;
  // Pending-actions is an unconditional platform service (Z2-WIRING / #94 handoff).
  // Harness questions need the harness_runtime schema; approvals come from operations.
  const pendingActionsQuestionStore = harnessInteractionStore;
  const dueAwareRecommendations = new DueAwareHarnessRecommendationReader(
    harnessSchemaStore,
    dueDeliveryRepository
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
            (item.kind === 'question' || item.kind === 'approval')
        );
      },
    },
    pool,
  });
  const contentPackageDeliveryCapabilityResolver = async (
    platform: Parameters<typeof contentPackageDeliveryCapability>[0]['platform']
  ) =>
    contentPackageDeliveryCapability({
      accountAndScopeVerified: false,
      callbackVerified: false,
      exportAvailable: true,
      liveAdapter: false,
      platform,
      publishRecoveryVerified: false,
      snapshotSource: 'legacy_handoff',
      submitAndPollVerified: false,
    });
  const contentPackageDelivery = new ContentPackageDeliveryService(
    operationsRepository,
    {
      approvalPolicy: contentPackageApprovalPolicy,
      capability: contentPackageDeliveryCapabilityResolver,
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
  const publishHandoffService = new PublishHandoffService(
    operationsRepository,
    contentPackageDelivery,
    {
      resolveCapability: async (platform) =>
        contentPackageDeliveryCapabilityResolver(
          platform as Parameters<
            typeof contentPackageDeliveryCapability
          >[0]['platform'],
        ),
    }
  );
  const contextInvalidationRuntime = createContextInvalidationRuntime({
    bundles: contextBundleRepository,
    sinks: [contentPackageDelivery],
  });
  const expiredFactInvalidationWorker = new ExpiredFactInvalidationWorker(
    storeFactLedger,
    contextInvalidationRuntime.service
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
    promptAuditStore
  );
  const creationExperienceRuntime =
    await createDurableCreationExperienceRuntime({
      modelCatalog: modelSupplyRepository,
      observabilityEvents: harnessObservabilityEvents,
      taskObservability: harnessSchemaStore,
      pool,
      productQuotes: productBillingRepository,
      skillRevisionValidation: skillRuntime.revisionValidation,
    });
  const harnessCheckTargetScope = new HarnessCheckTargetScope();
  /** Production check path attaches the shared sensitive-words lexicon (P2-08 / #320). */
  const harnessCheckTargetWithSensitiveLexicon = {
    async resolve(input: Parameters<HarnessCheckTargetScope['resolve']>[0]) {
      const base = await harnessCheckTargetScope.resolve(input);
      const sensitiveLexicon = await sensitiveWordsRepository.listEnabled();
      return {
        ...base,
        sensitiveLexicon,
      };
    },
  };
  const harnessCandidatePrimitiveScope = new P1HarnessCandidateRunnerScope(
    'harness-copy-primitive-worker'
  );
  const memoryProposalRedline = new CanonicalMemoryProposalRedline(
    {
      async resolve(input) {
        const active = harnessCheckTargetScope.activeTarget();
        if (active.policyInput.bundle.workspaceId !== input.workspaceId) {
          throw new Error(
            'Active Harness policy does not belong to the memory workspace.'
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
            'Memory redline audit requires an active Harness task.'
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
    }
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
            'Harness primitive violation audit requires a task identity.'
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
            `Unsupported production context scope: ${input.scope}`
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
          }
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
        memoryProposalRedline
      ),
      new StoreWorkflowRecordProposalPort(storeWorkflowCaptureRepository)
    ),
    revise: harnessCandidatePrimitiveScope,
    reviseTarget: harnessCandidatePrimitiveScope,
  });
  skillRuntime.foundationModule.attachCaptureWorkflow(
    new StoreWorkflowCaptureService(
      storeWorkflowCaptureRepository,
      agentPrimitiveAssembly.runtime,
      skillRepository
    )
  );
  operationsService.attachBriefSubmissionGate(
    creationExperienceRuntime.briefSubmissionGate
  );
  const visualAdoptionService = new OperationsVisualAdoptionPort(
    operationsService
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
    }
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
        productQuoteAuthority
      ),
      new ResultDeliveryFoundationModule(visualAdoptionService, {
        ...resultDeliveryRuntime,
        commands: resultCommands,
      }),
      new AdminConfigFoundationModule(adminConfigRepository, {
        activationEvidenceStatus: modelRuntime.activation,
        adminActorIds: modelAdminActorIds,
        cloudflareInventory,
        cloudflareMapping,
        cloudflareSelfProbes: () =>
          runCloudflareSelfProbes({
            shellBaseUrl: env.APP_BASE_URL ?? 'http://localhost:3000',
            databasePing: async () => {
              await pool.query('SELECT 1');
              return { ok: true, detail: 'select_1' };
            },
            mapping: cloudflareMapping,
            hyperdriveId: cloudflareMapping.hyperdriveConfigId,
          }),
        runtime: adminConfigRuntime,
        valueValidators: {
          ...runtimeModeValidatorsFromProviderCredentials(
            providerCredentialRuntime
          ),
          'plan.credits.reference_numbers': (value) =>
            assertReferenceModelsArePriced(
              value as CreditPlanReferenceNumbers,
              modelControlPlane
            ),
        },
        ...ADMIN_CONFIG_KEY_CLASSIFICATION,
      }),
      new ContextFoundationModule(storeFactLedger),
      new ProductEntitlementFoundationModule(productEntitlements, undefined, {
        catalogSource: new AdminConfigEntitlementCatalogSource(
          adminConfigRepository
        ),
        creditBilling,
        creditEntitlements: executionEntitlementPolicy,
        creditUsage: productBillingRepository,
        modelCatalogTenantAllowlist,
        warn: (message) => console.warn(message),
        modelDefaults: {
          getSnapshot: () => platformDefaultModelSource.getSnapshot(),
          validateDefault(operation, modelId) {
            return validatePlatformDefaultModel({
              operation,
              modelId,
              models,
              deployments,
              mode: modelRuntime.mode,
              fixtureDefaultModelIds: Object.values(e2ePlatformModelDefaults),
              configurationRevisions:
                runtimeAssembly.assembly.configurationRevisions,
              async readActivationEvidence(deploymentId) {
                const evidence = await adminConfigRepository.get(
                  'global',
                  '__global__',
                  `model.activation.evidence.${deploymentId}`
                );
                return evidence?.value as ActivationEvidence | undefined;
              },
            });
          },
          async setWorkspaceDefault(workspaceId, operation, modelId, metadata) {
            // Preference only — does not copy platform probe evidence into tenant catalog (GL-16).
            await modelSupplyRepository.setWorkspaceDefault(
              workspaceId,
              operation,
              modelId,
              metadata
            );
          },
        },
      }),
      new RedemptionFoundationModule(
        new RedemptionApplicationService(
          redemptionStore,
          undefined,
          undefined,
          creditLedger
        )
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
      // V31-05: Thread list + Workbench session restore (consumes V31-02 store).
      // V31-16: steering_submit / list_steering_commands on the same module.
      new AgentSessionFoundationModule(
        new PostgresAgentSessionStore(pool),
        steeringService,
      ),
      // V31-24: MarketingGoal product surface + Proactive pipeline (PG stores only).
      (() => {
        const agentSessionStoreForGoals = new PostgresAgentSessionStore(pool);
        const marketingGoalStore = new PostgresMarketingGoalStore(pool);
        const opportunityDecisionStore = new PostgresOpportunityDecisionStore(
          pool,
        );
        const goalService = new GoalService({
          goals: marketingGoalStore,
          threads: agentSessionStoreForGoals,
        });
        /** Read-only ContentPackage facts for coverage + signals (ops PG-backed). */
        const contentPackageFactsReader = {
          async listPackages(input: { resourceId: string }) {
            const rows = await operationsService.listContentPackages({
              actor: 'worker',
              correlationId: 'goal-proactive:content-package-facts',
              userId: 'goal-proactive-worker',
              workspaceId: input.resourceId,
            });
            return rows as OwnedContentPackageFact[];
          },
        };
        const proactiveService = new ProactiveService({
          decisions: opportunityDecisionStore,
          threads: agentSessionStoreForGoals,
          configReader: {
            get: (scope, workspaceId, key) =>
              adminConfigRepository.get(scope, workspaceId, key),
          },
          // Coverage denominator/numerator from delivered CP + active resultSignals.
          coverage: new ContentPackageEvidenceCoveragePort(
            contentPackageFactsReader,
          ),
          // Owned-data signals: goal_stalled + unpublished + published-without-evidence.
          signals: new OwnedDataProactiveSignalSource({
            goals: marketingGoalStore,
            contentPackages: contentPackageFactsReader,
          }),
        });
        // Hot-read probe at assembly time keeps the kill-switch path wired.
        void resolveProactiveGateConfig(
          {
            get: (scope, workspaceId, key) =>
              adminConfigRepository.get(scope, workspaceId, key),
          },
          '__assembly_probe__',
        ).catch(() => undefined);
        return new GoalProactiveFoundationModule(goalService, proactiveService);
      })(),
      new OpsConsoleFoundationModule(
        new OpsConsoleService({
          releases: new HarnessReleaseService(harnessReleaseStore),
          catalog: harnessReleaseStore,
          toolPolicies: opsConsoleStore,
          audit: opsConsoleStore,
          killSwitches: opsConsoleStore,
          trials: opsConsoleStore,
          drills: opsConsoleStore,
          verdicts: evalLayersAssembly.verdicts,
          evaluator: {
            async sample(input) {
              const outcome = await evalLayersAssembly.sampler.sample(input);
              await evalLayersAssembly.langfuseWriter.writeEvalResult(
                outcome.result,
              );
              return outcome;
            },
          },
          rollbackOperations: opsConsoleStore,
          runPins: opsConsoleStore,
          langfuseBaseUrl: env.LANGFUSE_BASE_URL ?? null,
          // V31-26a / U14: production PG inventory for legacy replay archive gate.
          legacyReplayInventory: legacyReplayInventory,
          resolveLegacyReplayInstallationEvidence: () =>
            legacyReplayInventory.installationEvidence(),
          // V31-26a: dual-write admin-config for kill switches runtime hot-reads there.
          killSwitchAdminConfigMirror: {
            async applyBoolean(input) {
              const current = await adminConfigRepository.get(
                'global',
                '__global__',
                input.key,
              );
              await adminConfigRepository.apply({
                key: input.key,
                scope: 'global',
                workspaceId: '__global__',
                value: input.value,
                expectedRevision: current?.revision ?? null,
                actorId: input.actorId,
                reason: input.reason,
                correlationId: input.correlationId,
              });
            },
            async getBoolean(key) {
              const row = await adminConfigRepository.get(
                'global',
                '__global__',
                key,
              );
              if (!row) return null;
              return row.value === true;
            },
          },
          async resolveLegacyReplayOpsBufferDays() {
            const row = await adminConfigRepository.get(
              'global',
              '__global__',
              'legacy.replay.archive_ops_buffer_days',
            );
            return typeof row?.value === 'number' ? row.value : 7;
          },
        }),
      ),
      new MarketingIdentityFoundationModule(
        marketingIdentities,
        undefined,
        marketingIdentityDrafter,
        createMarketingIdentityReferenceResolver(parseService)
      ),
      new AssetMemoryFoundationModule(
        assetIntakeService,
        parseService,
        storeIntakeFinalizer,
        storeProfileImportPreparer
      ),
      new MemoryFoundationModule(reuseMemoryService, agentMemoryPlatform),
      new OperationsFoundationModule(operationsService, {
        adminActorIds: modelAdminActorIds,
        contentPackageMigration,
        delivery: contentPackageDelivery,
        publishHandoff: publishHandoffService,
      }),
    ],
    writeOwnershipReader: createWriteOwnershipReader(pool),
  });
  const p1HarnessCheckInvoker = new P1HarnessCheckInvoker(
    p1ApplicationService,
    harnessCheckTargetScope,
    'harness-check-primitive-worker'
  );
  const p1HarnessAskInvoker = new P1HarnessAskInvoker(
    p1ApplicationService,
    'harness-ask-primitive-worker'
  );
  const p1HarnessCandidateRunner = {
    wrap(
      input: Omit<
        Parameters<P1HarnessCandidateRunnerScope['wrap']>[0],
        'application'
      >
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
  let campaignPaidWorkRecoveryInterval:
    | ReturnType<typeof setInterval>
    | undefined;
  let observabilityReconciliationInterval:
    | ReturnType<typeof setInterval>
    | undefined;
  let expirationInvalidationInterval:
    | ReturnType<typeof setInterval>
    | undefined;
  let expirationInvalidationRunning = false;
  /** V31-40 plan semantic outbox poll loop (set when composer/projector path wires). */
  let planEventOutboxLoop: PlanEventOutboxLoop | undefined;
  const promptOutboxWorker = new HarnessLangfuseOutboxWorker(
    harnessObservabilityStore,
    langfuseSenderFromEnv(env),
    { config: adminConfigRepository }
  );
  const promptOutboxLoop = new HarnessLangfuseOutboxLoop(promptOutboxWorker, {
    onError(error) {
      console.error('Langfuse prompt outbox iteration failed.', error);
    },
    pollMs: Number(env.HARNESS_COMPENSATION_POLL_MS ?? 1_000),
  });
  promptOutboxLoop.start();
  const observabilityReconciler = new HarnessObservabilityReconciler(
    harnessObservabilityStore,
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
    }
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
    5 * 60_000
  );
  observabilityReconciliationInterval.unref();
  void runObservabilityReconciliation();
  const expirationInvalidationWorkerId =
    env.P1_FACT_EXPIRATION_WORKER_ID ?? `core-${randomUUID()}`;
  const runExpirationInvalidation = async () => {
    if (expirationInvalidationRunning) return;
    expirationInvalidationRunning = true;
    try {
      const result = await expiredFactInvalidationWorker.runOnce(
        expirationInvalidationWorkerId
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
    Number(env.P1_FACT_EXPIRATION_POLL_MS ?? 1_000)
  );
  expirationInvalidationInterval.unref();
  void runExpirationInvalidation();
  if (harnessRuntimeConfig) {
    const structuredExecutor =
      createHarnessStructuredModelExecutor(modelRuntime);
    composerDestinationMapper = new StructuredComposerDestinationMapper(
      structuredExecutor,
      {
        async resolve({ workspaceId }) {
          return resolveDestinationMappingPrompt({
            releases: harnessReleaseService,
            prompts: harnessPromptResolver,
            workspaceId,
          });
        },
      },
      promptAuditStore
    );
    const contentPackageRevisionWriter =
      new PostgresContentPackageRevisionWritePort(
        pool,
        contentPackageRightsResolver
      );
    await contentPackageRevisionWriter.applySchema();
    const steeringDerivedWorkflowStore =
      new PostgresSteeringDerivedWorkflowStore(pool);
    await steeringDerivedWorkflowStore.migrate();
    const steeringDerivedWorkflow = new SteeringDerivedWorkflowCoordinator({
      billing: productQuoteService,
      commands: {
        prepareAdjust: (...args) => resultCommands.prepareAdjust(...args),
        async adjust(...args) {
          const result = await resultCommands.adjust(...args);
          if (
            !isDerivedComposerSubmission(result)
          ) {
            throw new Error(
              'Derived steering adjustment did not enter the Composer submission path.',
            );
          }
          return result;
        },
      },
      operations: operationsService,
      quoteAuthority: productQuoteAuthority,
      resolveSource: async ({ workspaceId, taskId, workId }) => {
        const result = await pool.query<{ payload: unknown }>(
          `SELECT package.payload
             FROM execution_spine.creation_submissions submission
             JOIN p1_content_packages package
               ON package.workspace_id = submission.workspace_id
              AND package.id = submission.content_package_id
            WHERE submission.workspace_id = $1
              AND submission.task_id = $2
              AND submission.work_id = $3
            ORDER BY submission.snapshot_revision DESC
            LIMIT 1`,
          [workspaceId, taskId, workId],
        );
        if (!result.rows[0]) {
          throw new Error('Steering source ContentPackage was not found.');
        }
        const source = contentPackageSchema.parse(result.rows[0].payload);
        if (!source.currentVersionId) {
          throw new Error('Steering source ContentPackage has no current version.');
        }
        return {
          currentVersionId: source.currentVersionId,
          generated: {
            assetIds: [...source.generated.assetIds],
            ...(source.generated.ownedAssets
              ? {
                  ownedAssets: source.generated.ownedAssets.map((asset) => ({
                    id: asset.id,
                  })),
                }
              : {}),
          },
          id: source.id,
          revision: source.revision,
          source: {
            ...(source.source.creationExecutionSnapshot
              ? {
                  creationExecutionSnapshot: {
                    id: source.source.creationExecutionSnapshot.id,
                  },
                }
              : {}),
            ...(source.source.workflowId
              ? { workflowId: source.source.workflowId }
              : {}),
            ...(source.source.workId ? { workId: source.source.workId } : {}),
          },
          versions: source.versions.map((version) => ({
            id: version.id,
            orderedAssetIds: [...version.orderedAssetIds],
            ...(version.note
              ? {
                  note: {
                    plan: {
                      pages: version.note.plan.pages.map((page) => ({
                        id: page.id,
                        ...(page.imageAssetId
                          ? { imageAssetId: page.imageAssetId }
                          : {}),
                      })),
                    },
                  },
                }
              : {}),
          })),
        };
      },
      store: steeringDerivedWorkflowStore,
    });
    steeringService.bindActionConsumers({
      derivedWorkflow: steeringDerivedWorkflow.consumer(),
    });
    const creationSubmissionStore = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(
          pool,
          grantLotLedger,
          creditLedger
        )
      ),
		{
			creditLedger,
			repricedSuccessorBuilder:
				new PostgresRepricedPaidExecutionSuccessorBuilder(
					pool,
					marketingPlanStore,
					planCompiler,
				),
		}
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
            'Structured model jobs require the Coordinator billing lineage.'
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
                  selection ?? ({ mode: 'auto', profile: 'quality' } as const),
              }),
          ...(providerOptions ? { providerOptions } : {}),
          billingTaskId,
          billingQuoteRevision,
        });
      },
    };
    const harnessExecutionChildObservability = {
      create(
        request: import('../p1/harness/task-admission.js').HarnessWorkflowInput
      ) {
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
          }
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
            proposal.idempotencyKey
          ),
        harnessCheckTargetScope
      );
    const copyHarnessStages = new ProductionHarnessStagePorts({
      core: {
        runners: structuredNodeRunnerFactory,
        context: new LedgerBackedHarnessContextPort(
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
        delivery: promptAuditStore,
        now: () => new Date().toISOString(),
      },
      reuse: {
        tasks: reuseMemoryService,
      },
      execution: {
        delivery: contentPackageRevisionWriter,
        sourceContentPackages: sourceContentPackages,
      },
      skills: {
        instructions: skillRuntime.instructionResolver,
        recipeFacts: creationExperienceRuntime.repository,
      },
      authorization: {
        factRights: new LedgerBackedFactRightsAuthorizationPort(
          storeFactLedger,
          contextSourceRevisions,
          () => new Date().toISOString()
        ),
      },
      // Preserve the existing wiring guard across the positional-to-options move:
      // harnessExecutionChildObservability, p1HarnessCheckInvoker, p1HarnessCandidateRunner,
      observability: {
        children: harnessExecutionChildObservability,
        primitiveCheck: p1HarnessCheckInvoker,
        candidateRunner: p1HarnessCandidateRunner,
        events: harnessObservabilityEvents,
      },
      memory: {
        sedimentation: harnessMemorySedimentation,
      },
      policy: {
        sensitiveLexicon: sensitiveWordsRepository,
      },
      // V31-14 (§23.4): mid-execution fence — rights revocation safe-stops
      // without re-charge; referenced price/date drift pauses with a prompt.
      fence: {
        resolveLiveFacts: async ({ request }) => {
          const authoritative = createAuthoritativeExecutionPlanLiveFactsPorts({
            facts: storeFactLedger,
            identities: marketingIdentities,
            request,
            rights: contentPackageRightsResolver,
          });
          return createResolveExecutionPlanLiveFacts({
            async resolveQuoteHead({ workspaceId, quoteId }) {
              const quote = await productQuoteService.getQuote(
                quoteId,
                workspaceId,
              );
              if (!quote) return null;
              return {
                quoteId,
                revision: quote.revision,
              };
            },
            ...authoritative,
          })({
            workflowId: request.workflowRevision
              ? String(request.workflowRevision)
              : '',
            request,
          });
        },
      },
    });
    // Single wiring owner: wrap copy ports so image/video share the same
    // Coordinator → StagePort → Harness path (#139/#140).
    const notePlanSettings = new AdminConfigNotePlanSettingsSource(
      adminConfigRepository
    );
    const noteMediaAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
    await noteMediaAdmission.migrate();
    const harnessStages = createProductionHarnessMediaAssembly({
      contentPackages: contentPackageRevisionWriter,
      copy: copyHarnessStages,
      exactText:
        modelRuntime.mode === 'fixture'
          ? new FixtureImageExactTextVerifier()
          : new ModelSupplyImageExactTextVerifier(
              p1ModelSupplyService,
              harnessExecutionChildObservability
            ),
      imageProfile: IMAGE_MODEL_RECIPE_PROFILE,
      models: p1ModelSupplyService,
      noteAdmission: noteMediaAdmission,
      noteEnhancementJudge: noteEnhancementJudgeResolverForMode(
        env.APP_ENV === 'e2e' ? 'gateway' : modelRuntime.mode
      ),
      noteSettings: notePlanSettings,
      now: () => new Date().toISOString(),
      runners: structuredNodeRunnerFactory,
      sensitiveLexicon: sensitiveWordsRepository,
      executionChildObservability: harnessExecutionChildObservability,
      sourceContentPackages,
    });
    DBOS.setConfig(harnessRuntimeConfig.dbos);
    const billingCompensations = new PostgresHarnessBillingCompensationStore(
      pool
    );
    await billingCompensations.migrate();
    const carrierSettlements = new PostgresHarnessCarrierSettlementCoordinator(pool);
    await carrierSettlements.migrate();
    const harnessBilling = new HarnessProductBillingSettlementExecutor(
      productQuoteService,
      grantLotLedger,
      undefined,
      {
        events: harnessObservabilityEvents,
        context: harnessSchemaStore,
      },
      creditLedger,
      creationSubmissionStore,
      carrierSettlements
    );
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
          harnessSchemaStore
        ),
      resumeInteraction: (workspaceId, workflowId, signal) =>
        resumeHarnessDbosInteractionWorkflow(
          workspaceId,
          workflowId,
          signal,
          harnessSchemaStore
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
          harnessSchemaStore
        ),
    };
    const harnessDecisions = new HarnessDecisionService(
      harnessInteractionStore,
      workflowResumer
    );
    const resumeReconciler = new HarnessResumeReconciler(
      new PostgresHarnessResumeReconcilerStore(pool),
      workflowResumer
    );
    const harnessInteractions = new HarnessInteractionService(
      harnessInteractionStore,
      {
        async resume(input) {
          if (!(await resumeReconciler.resumeEvent(input.eventId))) {
            throw new Error('The persisted interaction resume is unavailable.');
          }
        },
      }
    );
    const harnessSystemDefaults = new HarnessSystemDefaultProducer(
      harnessInteractionStore,
      harnessInteractions
    );
    const boundedExecutionLimits = new AdminConfigBoundedExecutionLimitsSource(
      adminConfigRepository
    );
    // V31-14: typed Interrupt protocol — durable Postgres store (restart-safe).
    // Constructed before registerHarnessDbosWorkflow so the DBOS pending
    // mirror port can capture awaitDecision questions into p1_agent_interrupts.
    interruptProtocolService = new InterruptProtocolService(
      interruptStore,
      {
        async hasMembership(userId, workspaceId) {
          return operationsRepository.hasMembership(userId, workspaceId);
        },
      },
      () => new Date().toISOString(),
      // Resume CAS → durable PlanConfirmationDecision (paid) → DBOS recv.
      createHarnessInterruptResumeBridge(undefined, harnessInteractions, {
        getDecisionForWorkspace: (workspaceId, requestId) =>
          executionConfirmationService.getDecisionForWorkspace(
            workspaceId,
            requestId,
          ),
        decideForWorkspace: (input) =>
          executionConfirmationService.decideForWorkspace(input),
      }),
      {
        async project(candidate) {
          if (!agentSemanticEventProjector) {
            throw new Error('Agent semantic interrupt projector is unavailable.');
          }
          return agentSemanticEventProjector.project(candidate);
        },
      },
    );
    const harnessWorkflow = registerHarnessDbosWorkflow(
      harnessStages,
      harnessInteractionStore,
      {
        semanticResumptions: creationSubmissionStore,
        // V31-14: DBOS pending questions mirrored into p1_agent_interrupts so
        // home/mobile "pending confirmations" list and resume stay alive
        // across refresh/reconnect; lifecycle syncs via resolveByWorkflow.
        interrupts: createHarnessInterruptProtocolPort({
          request: (input) => interruptProtocolService!.request(input),
          resolveByWorkflow: (input) =>
            interruptProtocolService!.resolveByWorkflow(input),
          getById: (id) => interruptStore.getById(id),
          async resolveAgentCoordinates(input) {
            return resolveInterruptAgentCoordinates(agentSessionStore, input);
          },
        }),
        // V31-11: confirmation gate binds ExecutionConfirmationService; the
        // same credit operation id makes execution-time settlement a no-op
        // (U8=A — reserve before confirm, single debit).
        executionConfirmation: {
          createRequest: (input) =>
            executionConfirmationAuthority.createRequest(input),
          putCurrent: (input) =>
            executionConfirmationAuthorityStore.putCurrent(input),
          getRequest: (requestId) =>
            executionConfirmationService.getRequest(requestId),
          getDecisionForWorkspace: (workspaceId, requestId) =>
            executionConfirmationService.getDecisionForWorkspace(
              workspaceId,
              requestId,
            ),
        },
        billing: {
          commit: (input) => harnessBilling.commit(input),
          promoteMerchantExecution: (input) =>
            productQuoteService.promoteMerchantExecution(input),
          refund: (input) => harnessBilling.refund(input),
          getUsage: (taskId, workspaceId) =>
            productQuoteService.getUsage(taskId, workspaceId),
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
            boundedExecutionLimits
          ),
        taskRecallDue: new TaskRecallDueProducer(dueDeliveryRepository),
        askMerchant: p1HarnessAskInvoker,
        interactions: harnessInteractions,
        // V31-12: DBOS pre-run re-verification of admitted ExecutionPlanSnapshot.
        executionPlanAdmission: executionPlanAdmissionService,
        // V31-14: production live fence reader (quote + rights heads).
        resolveExecutionPlanLiveFacts: async ({ workflowId, request }) => {
          const authoritative = createAuthoritativeExecutionPlanLiveFactsPorts({
            facts: storeFactLedger,
            identities: marketingIdentities,
            request,
            rights: contentPackageRightsResolver,
          });
          return createResolveExecutionPlanLiveFacts({
            async resolveQuoteHead({ workspaceId, quoteId }) {
              const quote = await productQuoteService.getQuote(
                quoteId,
                workspaceId,
              );
              if (!quote) return null;
              return { quoteId, revision: quote.revision };
            },
            ...authoritative,
          })({ workflowId, request });
        },
        refreshExecutionPlanLiveBindings: (input) =>
          planCompiler.refreshLiveBindings(input),
		createRepricedPaidExecutionSuccessor: async (input) => {
			if (!composerSubmissionCoordinator) {
				throw new Error('Confirmed price-drift successor coordinator is unavailable.');
			}
			return composerSubmissionCoordinator.createRepricedPaidExecutionSuccessor(
				input,
			);
		},
        // V31-14: force_legacy_five_stage kill switch (landed).
        async resolveForceLegacyFiveStage() {
          const state = await opsConsoleStore.getKillSwitch(
            'force_legacy_five_stage',
          );
          return state?.enabled === true;
        },
        // V31-13: shadow reconcil sample on Make complete (PG store + ops audit).
        shadowReconciliation: shadowReconciliationService,
        legacyShadowObservationReader:
          new PostgresLegacyShadowObservationReader(pool),
        // V31-23 L0.5: production sample on Make complete (same sampling point,
        // same admin-config sample rate as shadow reconciliation). Verdicts are
        // bound to the release and written through the eval assembly.
        productionSampling: {
          shouldSample: async (sampleKey) => {
            const config =
              await resolveShadowReconciliationConfigFromAdmin(
                adminConfigRepository,
              );
            return shouldSampleShadowReconciliation({
              sampleRate: config.sampleRate,
              sampleKey,
            });
          },
          sample: (input) => evalLayersAssembly.sampler.sample(input),
          recordAndEmit: (input) => evalLayersAssembly.recordAndEmit(input),
        },
        // V31-16: dual-queue Make steering at unit/terminal boundaries.
        makeSteeringBoundary: createMakeSteeringBoundaryPort({
          service: steeringService,
          resolveGate: () => resolveMakeSteeringGate(adminConfigRepository),
        }),
      }
    );
    await DBOS.launch();
    harnessTaskAdmissionService = new HarnessTaskAdmissionService(
        harnessSchemaStore,
        new DbosHarnessWorkflowStarter(harnessWorkflow),
        harnessPromptResolver,
        promptAuditStore,
        new AdminConfigBoundedExecutionLimitsResolver(boundedExecutionLimits),
        new ProductionHarnessFrozenRouteSnapshotResolver(
          foundationRepository,
          p1ModelSupplyService,
          {
            async resolve(operation) {
              const [registry, defaultsSnapshot] = await Promise.all([
                supplyControlRepository.getCurrentRegistryRevision(
                  PLATFORM_SUPPLY_SCOPE_ID
                ),
                platformDefaultModelSource.getSnapshot(),
              ]);
              if (!registry) {
                throw new Error(
                  'The platform supply registry has no published revision.'
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
                  ])
                ),
                operation
              );
              const { bindings, errors } = resolvePlatformDefaultBindings(
                registry,
                defaults,
                { operation }
              );
              if (errors.length > 0) {
                throw new Error(errors.join(' '));
              }
              const binding = bindings.find(
                (candidate) => candidate.operation === operation
              );
              const deployment = binding
                ? registry.deployments.find(
                    (candidate) => candidate.id === binding.deploymentId
                  )
                : undefined;
              if (
                !binding ||
                binding.activationEvidenceStatus !== 'live_verified' ||
                deployment?.lifecycleStatus !== 'active'
              ) {
                throw new Error(
                  `No active live-verified platform default is available for ${operation}.`
                );
              }
              return {
                catalogModelId: binding.catalogModelId,
                deploymentId: binding.deploymentId,
                activationEvidenceStatus: 'live_verified' as const,
                ...(binding.activationEvidenceRef
                  ? {
                      activationEvidenceRef: binding.activationEvidenceRef,
                    }
                  : {}),
                ...(binding.configurationRevision
                  ? {
                      configurationRevision: binding.configurationRevision,
                    }
                  : {}),
              };
            },
          }
        ),
        // Spec E / #379: production select must forward userSelectedSkillRefs.
        createProductionSkillManifestResolver(skillRuntime.instructionResolver),
        promptAuditStore,
        // V31-12: one-shot ExecutionPlanSnapshot write on the real admission path.
        executionPlanAdmissionService,
        {
          createRequest: (input) =>
            executionConfirmationAuthority.createRequest(input),
          createRequestInTransaction: (input, ledger) =>
            executionConfirmationAuthority.createRequestInTransaction(input, ledger),
          putCurrent: (input) =>
            executionConfirmationAuthorityStore.putCurrent(input),
          getRequest: (requestId) =>
            executionConfirmationService.getRequest(requestId),
          getDecisionForWorkspace: (workspaceId, requestId) =>
            executionConfirmationService.getDecisionForWorkspace(
              workspaceId,
              requestId,
            ),
        },
        {
          async resolvePromptBindings(request) {
            const frozenReleaseId = request.executionPlanFreeze?.harnessReleaseId;
            const resolved = frozenReleaseId
              ? await harnessReleaseService.resolveForRun({ frozenReleaseId })
              : await resolveWorkspaceHarnessRelease({
                  workspaceId: request.workspaceId,
                  runId: request.taskId,
                  releases: harnessReleaseService,
                  trials: opsConsoleStore,
                  rollbackOperations: opsConsoleStore,
                });
            return resolved.artifact.promptBindings;
          },
        }
      ),
    harnessService = new HarnessApplicationService(
      harnessTaskAdmissionService,
      harnessDecisions,
      harnessSchemaStore,
      dueAwareRecommendations,
      promptAuditStore,
      {
        async readTimeoutSeconds() {
          const revision = await adminConfigRepository.get(
            'global',
            '__global__',
            HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY
          );
          return confirmationCardTimeoutSecondsSchema.parse(
            revision?.value ?? DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS
          );
        },
      },
      harnessInteractions
    );
    // V31-28: one projector instance owns durable writes, replay, and live SSE.
    const agentSemanticEventStore = new PostgresAgentSemanticEventStore(pool);
    const agentSemanticLiveHub = new AgentSemanticLiveHub();
    const semanticProjectorForHarness = new AgentSemanticEventProjector(
      agentSemanticEventStore,
      agentSemanticLiveHub
    );
    agentSemanticEventProjector = semanticProjectorForHarness;
    planCompiler.bindSemanticEventProjector(semanticProjectorForHarness);
    // V31-40: plan revision outbox → projector (pending/dispatched lifecycle).
    // Append writes the candidate in the same TX; this loop closes the crash window.
    const planEventOutboxDispatcher = new PlanEventOutboxDispatcher(
      marketingPlanStore,
      {
        project: (candidate) => semanticProjectorForHarness.project(candidate),
        getByEventId: (input) => agentSemanticEventStore.getByEventId(input),
      },
    );
    planEventOutboxLoop = new PlanEventOutboxLoop(planEventOutboxDispatcher, {
      onError(error) {
        console.error('Plan event outbox iteration failed.', error);
      },
      pollMs: Number(env.HARNESS_COMPENSATION_POLL_MS ?? 1_000),
    });
    planEventOutboxLoop.start();
    const composerPlanSession = assembleProductionComposerPlanSession({
      sessions: agentSessionStore,
      plans: marketingPlanStore,
      sessionHarness: sessionAgentHarness,
      quoteAuthority: productQuoteAuthority,
      quoteService: productQuoteService,
      releaseResolver: harnessReleaseService,
      semanticEvents: {
        store: agentSemanticEventStore,
        projector: semanticProjectorForHarness,
      },
      // The fixture kernel returns one canned decision for every turn and its
      // request carries no submission, so it can neither propose this
      // merchant's plan nor ask about it. Falling back to the submission is the
      // only honest exit; with a live model the same silence stays a failure.
      compileFromSubmissionWithoutProposal: modelRuntime.mode === 'fixture',
      onMemoryDegraded: (event) => {
        // Never silent: a flipped kill switch and an outage are both visible
        // and distinguishable, while the paid submission still proceeds.
        console.warn(
          `[memory] plan compiled without injected memory (${event.reason})`,
          {
            workspaceId: event.workspaceId,
            taskId: event.taskId,
            runId: event.runId,
            detail: event.detail,
          },
        );
      },
      // V31-21 P1-a: new submissions pin the current production release
      // (canary workspace-allowlist applies here). The pinned releaseId is
      // then frozen on the Run + ExecutionPlanSnapshot — rollback changes
      // only what *new* runs resolve to, never in-flight pins.
      resolveHarnessReleaseId: async (submission, runId) => {
        const resolved = await resolveWorkspaceHarnessRelease({
          workspaceId: submission.snapshot.workspaceId,
          runId,
          releases: harnessReleaseService,
          trials: opsConsoleStore,
          rollbackOperations: opsConsoleStore,
        });
        return resolved.releaseId;
      },
    });
    composerSubmissionCoordinator = new CreationSubmissionCoordinator(
      creationSubmissionStore,
      new CreationStagePort(harnessTaskAdmissionService),
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
      composerPlanSession,
      {
        getDecision: (workspaceId, requestId) =>
          executionConfirmationService.getDecisionForWorkspace(
            workspaceId,
            requestId,
          ),
        decide: (input) =>
          executionConfirmationService.decideForWorkspace(input),
        getRequest: (requestId) =>
          executionConfirmationService.getRequest(requestId),
        getCurrentByWorkflowId: (workflowId) =>
          executionConfirmationAuthorityStore.getCurrentByWorkflowId(
            workflowId
          ),
      },
    );
    const campaignPaidWorkStore =
      new PostgresCampaignPaidWorkLifecycleStore<
        ComposerSubmissionRequest,
        CampaignPaidWorkResult
      >(pool);
    await migratePostgresSchema(pool, [campaignPaidWorkStore]);
    const campaignPlanApproval = new CampaignPlanApprovalService(
      executionConfirmationService,
      executionConfirmationAuthorityStore
    );
    // Work2 (and any slot whose intent differs from the merchant preview quote)
    // must mint a ProductQuote whose submissionContractHash matches its signed
    // fields — reusing Work1's quote fails the composer admission gate.
    const campaignWorkQuoteMinter = createCampaignWorkQuoteMinter({
      authority: productQuoteAuthority,
      quotes: productQuoteService,
      briefContexts: creationExperienceRuntime.briefRevisionContexts,
    });
    const campaignPaidWorkLifecycle = new CampaignPaidWorkLifecycle(
      campaignPaidWorkStore,
      new CampaignPaidWorkProducer<
        ComposerSubmissionRequest,
        CampaignPaidWorkResult
      >({
        async submitCampaignWork(input) {
          const submission =
            await campaignWorkQuoteMinter.ensureQuoteForSubmission(
              input.submission,
            );
          const result =
            await composerSubmissionCoordinator!.submitCampaignWork({
              ...input,
              submission,
            });
          if (!result.threadId || !result.runId) {
            throw new Error(
              'Campaign paid Work requires a production Agent Thread binding.'
            );
          }
          return { ...result, threadId: result.threadId, runId: result.runId };
        },
      }),
      campaignPlanApproval
    );
    campaignPaidWorks = new CampaignPaidWorkApplication(
      campaignPaidWorkLifecycle,
      campaignPlanApproval
    );
    let campaignPaidWorkRecoveryRunning = false;
    const runCampaignPaidWorkRecovery = async () => {
      if (campaignPaidWorkRecoveryRunning) return;
      campaignPaidWorkRecoveryRunning = true;
      try {
        await runIfPostgresSchemaStable(pool, async () => {
          await campaignPaidWorkLifecycle.advanceOpen();
        });
      } catch (error) {
        console.error('Campaign paid Work recovery iteration failed.', error);
      } finally {
        campaignPaidWorkRecoveryRunning = false;
      }
    };
    campaignPaidWorkRecoveryInterval = setInterval(
      () => void runCampaignPaidWorkRecovery(),
      Number(env.CAMPAIGN_PAID_WORK_POLL_MS ?? 1_000)
    );
    campaignPaidWorkRecoveryInterval.unref();
    const pendingStartCoordinator = composerSubmissionCoordinator;
    // V31-41: terminal prepare failures release reserved product usage + credits.
    const onPrepareTerminalRefund = async (
      submission: CreationSubmissionRecord,
    ) => {
      await creationSubmissionStore.refundPrepareTerminalReservation(submission);
    };
    await runIfPostgresSchemaStable(pool, async () => {
      await pendingStartCoordinator.recoverPendingStarts(100, {
        onPrepareTerminalRefund,
      });
    });
    let pendingStartRecoveryRunning = false;
    const runPendingStartRecovery = async () => {
      if (pendingStartRecoveryRunning) return;
      pendingStartRecoveryRunning = true;
      try {
        await runIfPostgresSchemaStable(pool, async () => {
          const result = await pendingStartCoordinator.recoverPendingStarts(
            100,
            { onPrepareTerminalRefund },
          );
          if (result.failed > 0) {
            // V31-41: log full result including failureDetails when present
            // (workspaceId, submissionId, reason, terminal) — not bare counts.
            console.error('Harness pending-start recovery failed.', result);
          }
        });
      } catch (error) {
        console.error(
          'Harness pending-start recovery iteration failed.',
          error
        );
      } finally {
        pendingStartRecoveryRunning = false;
      }
    };
    harnessPendingStartRecoveryInterval = setInterval(
      () => void runPendingStartRecovery(),
      Number(env.HARNESS_COMPENSATION_POLL_MS ?? 1_000)
    );
    harnessPendingStartRecoveryInterval.unref();
    // V31-03: shadow dual-write of workflow progress/token → semantic projector.
    // Gated by agent_semantic_event_adapter_v1 (default off = zero projection writes).
    // V31-14 / V31-15 producer: note page progress → artifact.revised via projector.
    harnessStages.note.artifactProgressEmitter = {
      project: (candidate) => semanticProjectorForHarness.project(candidate),
    };
    harnessStages.media.artifactProgressEmitter =
      harnessStages.note.artifactProgressEmitter;
    // V31-16: page-unit boundary drains steer queue (follow_up also at last page /
    // terminal success via registerHarnessDbosWorkflow.makeSteeringBoundary).
    harnessStages.note.makeSteeringBoundary = createMakeSteeringBoundaryPort({
      service: steeringService,
      resolveGate: () => resolveMakeSteeringGate(adminConfigRepository),
    });
    const harnessEventReader = new HarnessDbosWorkflowEventReader(
      harnessSchemaStore,
      undefined,
      undefined,
      productQuoteService,
    );
    harnessWorkflowEventSource = new HarnessWorkflowEventSource(
      new ShadowSemanticWorkflowEventReader(
        harnessEventReader,
        semanticProjectorForHarness,
        () => resolveAgentSemanticEventAdapterEnabled(adminConfigRepository),
      ),
    );
    const billingCompensationWorker = new HarnessBillingCompensationWorker(
      billingCompensations,
      harnessBilling
    );
    const carrierSettlementWorker = new HarnessCarrierSettlementWorker(
      carrierSettlements,
      harnessBilling
    );
    const reservationSweeperOptions = {
      async expireHold(sweep: HarnessReservationSweep) {
        const target = await harnessDecisions.readDecisionTarget(
          sweep.workspaceId,
          sweep.taskId
        );
        if (!target || target.question.questionId !== sweep.questionId) {
          throw new Error(
            `Expired hold ${sweep.questionId} is not the authoritative decision target.`
          );
        }
        await harnessDecisions.submitCoreHoldExpired(
          sweep.workspaceId,
          sweep.taskId,
          confirmationCardHoldExpired(target.question),
          { resumeWorkflow: true },
        );
        await interruptProtocolService!.resolveByWorkflow({
          workspaceId: sweep.workspaceId,
          interruptId: target.question.questionId,
          revision: target.question.workflowRevision,
          source: 'core_hold_expired',
        });
      },
      async reservationTtlSeconds() {
        const revision = await adminConfigRepository.get(
          'global',
          '__global__',
          HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY
        );
        return Number(
          revision?.value ?? DEFAULT_HOLD_RESERVATION_TTL_SECONDS
        );
      },
    };
    const reservationSweeper = new HarnessReservationSweeper(
      harnessInteractionStore,
      harnessBilling,
      reservationSweeperOptions
    );
    e2eInterruptExpiryRunner = {
      async expire({ workspaceId, interruptId }) {
        const pending = await interruptStore.getById(interruptId);
        if (
          !pending ||
          pending.workspaceId !== workspaceId ||
          pending.status !== 'pending'
        ) {
          throw new Error('Pending interrupt was not found for expiry.');
        }
        const taskId = pending.payload.workflowId;
        const ttlSeconds =
          await reservationSweeperOptions.reservationTtlSeconds();
        const advancedNow = new Date(
          Date.now() + (ttlSeconds + 1) * 1_000
        );
        const exactSweeper = new HarnessReservationSweeper(
          harnessInteractionStore,
          harnessBilling,
          {
            ...reservationSweeperOptions,
            batchSize: 1,
            now: () => advancedNow,
          }
        );
        const outcome = await exactSweeper.runOnce({ workspaceId, taskId });
        if (
          outcome.claimed !== 1 ||
          outcome.completed !== 1 ||
          outcome.failed !== 0
        ) {
          throw new Error(
            `Exact reservation expiry did not complete: ${JSON.stringify(outcome)}.`
          );
        }
        const decision = await harnessDecisions.readDecisionTarget(
          workspaceId,
          taskId
        );
        const resolvedInterrupt = await interruptStore.getById(interruptId);
        if (
          decision?.status !== 'resolved' ||
          decision.resolutionSource !== 'core_hold_expired' ||
          decision.question.questionId !== interruptId ||
          resolvedInterrupt?.status !== 'resolved'
        ) {
          throw new Error(
            'Exact reservation expiry did not resolve the authoritative decision and typed interrupt.'
          );
        }
        return { expired: true as const };
      },
    };
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
            carrierSettlementWorker.runOnce(),
            reservationSweeper.runOnce(),
            interruptProtocolService!.recoverUndelivered(),
          ]);
          for (const result of results) {
            if (result.status === 'rejected') {
              console.error(
                'Harness compensation iteration failed.',
                result.reason
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
      Number(env.HARNESS_COMPENSATION_POLL_MS ?? 1_000)
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
      env: env,
      probeReadWrite: () => probeObjectStorageReadWrite(assetStorage),
    }),
    outbox: outboxBacklogProbe({
      async criticalBacklog() {
        const result = await pool.query<{ backlog: string }>(
          `select count(*)::text as backlog
             from harness_runtime.langfuse_outbox
            where status in ('queued', 'failed', 'sending')
              and dead_lettered_at is null
              and next_attempt_at <= now()`
        );
        return Number(result.rows[0]?.backlog ?? 0);
      },
      maxBacklog: Number(env.P1_OUTBOX_CRITICAL_MAX_BACKLOG ?? 500),
    }),
    postgresql: postgresqlProbe(pool),
    schema: schemaCompatibilityProbe(pool),
    workerFreshness: workerFreshnessProbe({
      async latestHeartbeatAt() {
        const sample = await operationalTelemetryStore.latestWorkerSample();
        return sample?.sampledAt ?? null;
      },
      staleAfterMs: Number(env.P1_WORKER_HEARTBEAT_STALE_MS ?? 30_000),
    }),
  };

  // Rebuild this lightweight projection for every truth-surface request so an
  // evidence artifact that expires or is replaced cannot stay verified in memory.
  const resolveRuntimeTruth = () => {
    const providerEvidence = assembleCapabilitiesFromEnv(env);
    const providerEvidenceConfigured =
      env.PROVIDER_LIVE_REQUIRE_EVIDENCE === '1' ||
      Boolean(env.PROVIDER_LIVE_EVIDENCE_PATH?.trim()) ||
      Boolean(env.PROVIDER_LIVE_EVIDENCE_DIR?.trim()) ||
      isProtectedAppEnv(env);

    return composeRuntimeTruth({
      capabilityRecords: providerEvidence.capabilityRecords,
      env: env,
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

  const e2eFixtureEnabled =
    env.APP_ENV === 'e2e' && env.NODE_ENV !== 'production';

  const e2eUserSelectedSkillFixture = e2eFixtureEnabled
    ? new E2EUserSelectedSkillFixture({
        prompt: requireHarnessFrozenPrompt(
          await harnessPromptResolver.resolve(),
          'intentNaming',
        ),
        repository: skillRuntime.repository,
        service: skillRuntime.service,
      })
    : undefined;
  const e2eUserSelectedSkillEvidence = e2eFixtureEnabled
    ? new E2EUserSelectedSkillEvidenceReader(pool)
    : undefined;

  const semanticProjector = agentSemanticEventProjector;
  const server = createCoreServer({
    aiStreamingRunner,
    executionModeGate: streamingModeGate,
    assetReader: assetStorage,
    composerDestinationMapper,
    composerSubmission: composerSubmissionCoordinator
      ? { coordinator: composerSubmissionCoordinator }
      : undefined,
    campaignPaidWorks,
    agentSemanticEvents: semanticProjector
      ? {
		  ...(e2eFixtureEnabled ? { e2eFaultInjectionEnabled: true } : {}),
          async resolveSession({ workspaceId, threadId }) {
            const thread = await agentSessionStore.getThread({
              resourceId: workspaceId,
              threadId,
            });
            if (!thread) return null;
            const activeRun = await findActiveExitRun(agentSessionStore, {
              resourceId: workspaceId,
              threadId,
            });
            return projectThreadToSession(thread, activeRun);
          },
          loadReplay: (input) => semanticProjector.loadReplay(input),
          streamReplay: (input) => semanticProjector.streamReplay(input),
        }
      : undefined,
    contentPackageReader: {
      read(context, packageId) {
        return operationsService.getContentPackage(context, packageId);
      },
    },
    diagnosticRepository,
    e2eCreditDetailFixture: e2eFixtureEnabled
      ? new E2ECreditDetailFixture({
          ledger: creditLedger,
          productBilling: productQuoteService,
          subscriptions: creditSubscriptionStore,
        })
      : undefined,
    e2eInterruptExpiryFixture: e2eFixtureEnabled
      ? e2eInterruptExpiryRunner
      : undefined,
    e2eUserSelectedSkillFixture,
    e2eUserSelectedSkillEvidence,
    e2eFixtureEnabled,
    // V31-11: confirmation-card HTTP surface via the bound session harness.
    executionConfirmation: sessionAgentHarness
      ? {
          create: (input) =>
            executionConfirmationAuthority.createRequest(input),
          decide: (input) =>
            sessionAgentHarness.decideExecutionConfirmation(input),
          expire: (input) =>
            sessionAgentHarness.expireExecutionConfirmationHold(input),
          listPending: (workspaceId) =>
            executionConfirmationService.listPendingByWorkspace(workspaceId),
        }
      : undefined,
    integrationService,
    harnessService,
    pendingActions,
    interruptProtocol: interruptProtocolService
      ? {
          listPending: (input) =>
            interruptProtocolService.listPending({
              userId: input.userId,
              workspaceId: input.workspaceId,
              query: {
                resourceId: input.query.resourceId as never,
                ...(input.query.threadId
                  ? { threadId: input.query.threadId as never }
                  : {}),
              },
            }),
          resume: (input) =>
            interruptProtocolService.resume({
              userId: input.userId,
              workspaceId: input.workspaceId,
              command: input.command as never,
            }),
        }
      : undefined,
    operationsService,
    planCatalog: creditPlanCatalog,
    productService,
    p1ApplicationService,
    runtimeTruth,
    serviceToken,
    workspaceBootstrapper,
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
    if (campaignPaidWorkRecoveryInterval) {
      clearInterval(campaignPaidWorkRecoveryInterval);
    }
    if (observabilityReconciliationInterval) {
      clearInterval(observabilityReconciliationInterval);
    }
    promptOutboxLoop.stop();
    planEventOutboxLoop?.stop();
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
      }
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

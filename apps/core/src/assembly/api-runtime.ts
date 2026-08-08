import { shutdownLangfuseTracing } from '../instrumentation.js';

import { DBOS } from '@dbos-inc/dbos-sdk';
import { confirmationCardTimeoutSecondsSchema } from '@meiye/contracts';
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
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from '../p1/execution-spine/postgres-creation-submission-store.js';
import { CreationSubmissionCoordinator } from '../p1/execution-spine/submission-coordinator.js';
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
import { langfuseSenderFromEnv } from '../p1/harness/langfuse-sender.js';
import { PostgresNoteMediaAdmissionCoordinator } from '../p1/harness/note-media-admission.js';
import {
  HarnessObservabilityReconciler,
  shouldPublishObservabilityDeliverySnapshot,
} from '../p1/harness/observability-reconciliation.js';
import {
  HarnessLangfuseOutboxLoop,
  HarnessLangfuseOutboxWorker,
} from '../p1/harness/outbox-worker.js';
import { PostgresHarnessBillingCompensationStore } from '../p1/harness/postgres-billing-compensation-store.js';
import { PostgresHarnessResumeReconcilerStore } from '../p1/harness/postgres-resume-reconciler-store.js';
import { HarnessProductBillingSettlementExecutor } from '../p1/harness/product-billing-settlement.js';
import {
  LedgerBackedFactRightsAuthorizationPort,
  LedgerBackedHarnessContextPort,
} from '../p1/harness/production-context-port.js';
import { ProductionHarnessFrozenRouteSnapshotResolver } from '../p1/harness/production-frozen-route.js';
import { createProductionHarnessMediaAssembly } from '../p1/harness/production-media-assembly.js';
import {
  ProductionHarnessStagePorts,
  type HarnessStructuredNodeRunnerFactory,
} from '../p1/harness/production-stage-ports.js';
import {
  DEFAULT_HOLD_RESERVATION_TTL_SECONDS,
  HarnessReservationSweeper,
} from '../p1/harness/reservation-sweeper.js';
import {
  HarnessResumeReconciler,
  type HarnessResumeWorkflow,
} from '../p1/harness/resume-reconciler.js';
import { assertPendingActionsShareDatabase } from '../p1/harness/runtime-config.js';
import { createHarnessStructuredModelExecutor } from '../p1/harness/structured-model-runtime.js';
import { createProductionSkillManifestResolver } from '../p1/harness/production-skill-manifest-resolver.js';
import { HarnessTaskAdmissionService } from '../p1/harness/task-admission.js';
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
} from '../p1/ops-console/index.js';
import { HarnessReleaseService } from '../p1/harness/harness-release.js';
import {
  AgentSessionFoundationModule,
  PostgresAgentSessionStore,
} from '../p1/agent-session/index.js';
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
  PostgresAgentSemanticEventStore,
  resolveAgentSemanticEventAdapterEnabled,
  ShadowSemanticWorkflowEventReader,
} from '../p1/agent-semantic-events/index.js';
import {
  HarnessWorkflowEventSource,
  WorkflowEventApplicationService,
} from '../p1/workflow-events.js';
import { runIfPostgresSchemaStable } from '../postgres-schema-migration.js';
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

export async function startApi(env: NodeJS.ProcessEnv) {
  const {
    harnessPromptResolver,
    databaseUrl,
    serviceToken,
    recordedCommerceEnabled,
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
    opsConsoleStore,
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
    sessionAgentHarness,
    sessionRetrievalExperiencePort,
    planCompiler,
    executionPlanAdmissionService,
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
  let composerDestinationMapper: ComposerDestinationMappingPort | undefined;
  let composerSubmissionCoordinator: CreationSubmissionCoordinator | undefined;
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
        recordedCommerceEnabled,
        catalogSource: new AdminConfigEntitlementCatalogSource(
          adminConfigRepository
        ),
        creditBilling,
        creditEntitlements: executionEntitlementPolicy,
        creditUsage: productBillingRepository,
        monthlyOutput: productQuoteService,
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
      new AgentSessionFoundationModule(new PostgresAgentSessionStore(pool)),
      new OpsConsoleFoundationModule(
        new OpsConsoleService({
          releases: new HarnessReleaseService(harnessReleaseStore),
          catalog: harnessReleaseStore,
          toolPolicies: opsConsoleStore,
          audit: opsConsoleStore,
          killSwitches: opsConsoleStore,
          trials: opsConsoleStore,
          drills: opsConsoleStore,
          langfuseBaseUrl: env.LANGFUSE_BASE_URL ?? null,
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
  let observabilityReconciliationInterval:
    | ReturnType<typeof setInterval>
    | undefined;
  let expirationInvalidationInterval:
    | ReturnType<typeof setInterval>
    | undefined;
  let expirationInvalidationRunning = false;
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
        async resolve() {
          return requireHarnessFrozenPrompt(
            await harnessPromptResolver.resolve(),
            'destinationMapping'
          );
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
    const creationSubmissionStore = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(
          pool,
          grantLotLedger,
          creditLedger
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
      noteEnhancementJudge: noteEnhancementJudgeResolverForMode(modelRuntime.mode),
      noteSettings: notePlanSettings,
      now: () => new Date().toISOString(),
      runners: structuredNodeRunnerFactory,
      sensitiveLexicon: sensitiveWordsRepository,
      executionChildObservability: harnessExecutionChildObservability,
      sourceContentPackages,
    });
    DBOS.setConfig(harnessRuntimeConfig.dbos);
    const harnessBilling = new HarnessProductBillingSettlementExecutor(
      productQuoteService,
      grantLotLedger,
      undefined,
      {
        events: harnessObservabilityEvents,
        context: harnessSchemaStore,
      },
      creditLedger
    );
    const billingCompensations = new PostgresHarnessBillingCompensationStore(
      pool
    );
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
    const harnessWorkflow = registerHarnessDbosWorkflow(
      harnessStages,
      harnessInteractionStore,
      {
        semanticResumptions: creationSubmissionStore,
        billing: {
          commit: (input) => harnessBilling.commit(input),
          promoteMerchantExecution: (input) =>
            productQuoteService.promoteMerchantExecution(input),
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
            boundedExecutionLimits
          ),
        taskRecallDue: new TaskRecallDueProducer(dueDeliveryRepository),
        askMerchant: p1HarnessAskInvoker,
        interactions: harnessInteractions,
        // V31-12: DBOS pre-run re-verification of admitted ExecutionPlanSnapshot.
        executionPlanAdmission: executionPlanAdmissionService,
      }
    );
    await DBOS.launch();
    harnessService = new HarnessApplicationService(
      new HarnessTaskAdmissionService(
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
        executionPlanAdmissionService
      ),
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
      productQuoteService
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
    const agentSemanticEventStore = new PostgresAgentSemanticEventStore(pool);
    const agentSemanticEventProjector = new AgentSemanticEventProjector(
      agentSemanticEventStore,
    );
    // V31-10: PlanCompiler → plan.created/plan.revised after append-only revision.
    // Not gated by shadow flag — Living Plan is first-class Workstream truth once compiled.
    planCompiler.bindSemanticEventProjector(agentSemanticEventProjector);
    const harnessEventReader = new HarnessDbosWorkflowEventReader(
      harnessSchemaStore,
      undefined,
      undefined,
      productQuoteService,
    );
    harnessWorkflowEventSource = new HarnessWorkflowEventSource(
      new ShadowSemanticWorkflowEventReader(
        harnessEventReader,
        agentSemanticEventProjector,
        () => resolveAgentSemanticEventAdapterEnabled(adminConfigRepository),
      ),
    );
    const billingCompensationWorker = new HarnessBillingCompensationWorker(
      billingCompensations,
      harnessBilling
    );
    const reservationSweeper = new HarnessReservationSweeper(
      harnessInteractionStore,
      harnessBilling,
      {
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
      }
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
    e2eCreditDetailFixture: e2eFixtureEnabled
      ? new E2ECreditDetailFixture({
          ledger: creditLedger,
          productBilling: productQuoteService,
          subscriptions: creditSubscriptionStore,
        })
      : undefined,
    e2eUserSelectedSkillFixture,
    e2eUserSelectedSkillEvidence,
    e2eFixtureEnabled,
    integrationService,
    harnessService,
    pendingActions,
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
      }
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

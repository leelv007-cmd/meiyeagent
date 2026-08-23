import { createHash } from 'node:crypto';

import type {
  AssetRevision,
  ContentPackageRevisionDelivery,
  CreativeRecommendationDecisionTrace,
  MarketingPackageEvidence,
  ObservabilityAxisBinding,
  ReuseTaskSeed,
  SensitiveWordRecord,
  StoreFactKind,
  HarnessStage,
  ThinkingProviderOptions,
} from '@meiye/contracts';
import type { RequestedSelection } from '../model-supply/index.js';

import type {
  ContentPackageRevisionWriteInput,
  ContentPackageRevisionWritePort,
} from '../execution-spine/content-package-revision-port.js';
import { harnessCopyWorkAssetId } from '../operations/harness-copy-work-asset.js';
import {
  SourceContentPackageUnavailableError,
  type ExecutionSourceContentPackageResolverPort,
  type ResolvedSourceContentPackage,
} from '../execution-spine/source-content-package-resolver.js';
import { isOfficialNeutralIdentity } from '../execution-spine/creation-execution-snapshot.js';

import {
  executePlatformCopySelection,
  HarnessSelectionError,
  harnessSelectionBlockDiagnostics,
  isCopySelectionCurrentBest,
} from './execution-selection.js';
import {
  validateHarnessPolicy,
  type HarnessFactClaim,
  type HarnessGateFailure,
  type HarnessPolicyInput,
  type VisibleClaimExtraction,
} from './policy-gates.js';
import type { CheckResult } from './check.js';
import {
  compileExecutionBrief,
  InMemoryStructuredNodeMetrics,
  nameHarnessIntent,
  type StructuredNodeRunner,
  type StructuredNodeRunnerRequest,
  type StructuredNodeRunnerResult,
  type IntentDeclaration,
} from './structured-nodes.js';
import type {
  HarnessContextSnapshot,
  HarnessStagePorts,
} from './workflow-core.js';

type FirstArgument<Method> = Method extends (
  input: infer Input,
  ...rest: never[]
) => unknown
  ? Input
  : never;
import {
  ExecutionAttemptBudget,
  ExecutionAttemptBudgetExceeded,
  withExecutionAttemptBudget,
} from '../model-supply/execution-attempt-budget.js';
import { StructuredNodeRunError } from '../model-supply/structured-node-runner.js';
import {
  assertHarnessExecutionAssemblyPinned,
  type HarnessExecutionAssemblyStep,
  type HarnessSkillManifestSnapshot,
  type HarnessWorkflowInput,
} from './task-admission.js';
import { createMarketingPackageEvidence } from './marketing-package-evidence.js';
import {
  assertCopyRevisionAssemblyComplete,
  buildCopyPlatformVariants,
} from './output-compiler.js';
import type {
  ResolvedSkillInstruction,
  SkillInvocationReceipt,
} from '../skills/types.js';
import {
  assessRecipeFactSatisfaction,
  type FactRightsAuthorizationPort,
} from './fact-satisfaction.js';
import {
  evaluateMidExecutionContextFence,
  HarnessExecutionFencePauseError,
  HarnessExecutionFenceSafeStopError,
} from './context-fence.js';
import type { SnapshotLiveFacts } from './execution-plan-admission.js';
import type {
  AgentPrimitiveLifecycleInput,
  AgentPrimitiveObservabilityAdapter,
} from '../creation-experience/agent-primitive-observability.js';
import {
  canonicalObservabilityEvent,
  type ObservabilityEventAuditPort,
} from '../creation-experience/observability-events.js';

export interface ProductionHarnessContextPort {
  compileAndFreeze(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: Parameters<
      HarnessStagePorts['injectContext']
    >[0]['declaration'];
  }): Promise<HarnessContextSnapshot>;
  fence(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: Parameters<
      HarnessStagePorts['fenceContext']
    >[0]['declaration'];
    context: HarnessContextSnapshot;
  }): Promise<HarnessContextSnapshot>;
}

export interface HarnessPrimitiveCheckPort {
  execute(input: {
    correlationId: string;
    observability: ObservabilityAxisBinding;
    policyInput: HarnessPolicyInput;
    taskId: string;
    workflowId: string;
    workflowRevision: number;
    workspaceId: string;
  }): Promise<CheckResult<'block', HarnessGateFailure>>;
}

export interface SensitiveLexiconReadPort {
  listEnabled(): Promise<SensitiveWordRecord[]>;
}

export interface HarnessCandidatePrimitiveRunnerFactory {
  wrap(input: {
    billing: {
      productUsageTaskId: string;
      quoteId: string;
    };
    boundedExecution: NonNullable<HarnessWorkflowInput['boundedExecution']>;
    observability: ObservabilityAxisBinding;
    resumeCandidate?: {
      revision: number;
      sourceEffectIdempotencyKey: string;
    };
    runner: StructuredNodeRunner;
    taskId: string;
    workspaceId: string;
  }): StructuredNodeRunner;
}

export interface HarnessCopyDeliveryPort {
  deliverCopyRevision(input: {
    workflowId: string;
    workspaceId: string;
    packageId: string;
    expectedRevision: number;
    platform?: 'xiaohongshu' | 'douyin' | 'video_account';
    occurredAt: string;
    workflowRevision: number;
    winner: {
      candidateId: string;
      title: string;
      body: string;
      conversionHook: string;
    };
    candidates: Array<{
      candidateId: string;
      title: string;
      body: string;
      conversionHook: string;
      score: number;
    }>;
    recommendation: Omit<CreativeRecommendationDecisionTrace, 'deliverables'>;
    assetIds: string[];
    claimExtraction: VisibleClaimExtraction;
    marketing: MarketingPackageEvidence;
    reuseSeed?: ReuseTaskSeed;
  }): Promise<ContentPackageRevisionDelivery>;
}

export interface HarnessMemorySedimentationPort {
  summarize(
    input: FirstArgument<HarnessStagePorts['assembleAndDeliver']>,
  ): Promise<Array<{ itemId: string; candidate: unknown; decision: unknown }>>;
  complete(
    input: FirstArgument<HarnessStagePorts['assembleAndDeliver']>,
  ): Promise<void>;
}

export interface HarnessStructuredNodeRunnerFactory {
  create(input: {
    workspaceId: string;
    actorId: string;
    billingTaskId?: string;
    billingQuoteRevision?: string;
    frozenRouteSnapshot?: NonNullable<
      HarnessWorkflowInput['frozenRouteSnapshot']
    >;
    selection?: RequestedSelection;
    providerOptions?: Pick<
      ThinkingProviderOptions,
      'reasoningEffort' | 'thinking'
    >;
  }): StructuredNodeRunner;
}

export interface HarnessSkillInstructionResolverPort {
  resolve(input: {
    workspaceId: string;
    workflowId: string;
    workflowRevision: number;
    recipeId?: string;
    recipeRevisionId?: string;
    stage: HarnessStage;
    industryCategory?: string;
    userSelectedSkillRefs?: readonly string[];
    skillRevisionRefs?: readonly string[];
    skillManifestSnapshots?: readonly HarnessSkillManifestSnapshot[];
  }): Promise<{
    instructions: ResolvedSkillInstruction[];
    receipts: SkillInvocationReceipt[];
  }>;
}

export interface HarnessRecipeFactRequirementPort {
  getRecipeByRevisionId(revisionId: string): Promise<{
    recipeId: string;
    revisionId: string;
    factTypes: StoreFactKind[];
  } | null>;
}

export interface HarnessExecutionChildObservabilityFactory {
  create(
    request: HarnessWorkflowInput,
  ): Pick<AgentPrimitiveObservabilityAdapter, 'append'>;
}

export class HarnessCopyScopeError extends Error {
  readonly code = 'HARNESS_COPY_ONLY';
  readonly status = 409;

  constructor() {
    super('The first production tracer supports only the copy delivery layer.');
    this.name = 'HarnessCopyScopeError';
  }
}

export class HarnessIdentityPreflightError extends Error {
  readonly code = 'HARNESS_IDENTITY_INVALID';
  readonly status = 409;

  constructor(readonly invalidIdentityRefs: string[]) {
    super('The copy brief references an unregistered or withdrawn identity.');
    this.name = 'HarnessIdentityPreflightError';
  }
}

export class HarnessSnapshotIdentityBindingError extends Error {
  readonly code = 'HARNESS_IDENTITY_SNAPSHOT_MISMATCH';
  readonly status = 409;

  constructor(
    readonly expectedIdentityRef: string,
    readonly actualIdentityRefs: string[],
  ) {
    super(
      'The copy brief and frozen context must bind exactly to the execution snapshot identity.',
    );
    this.name = 'HarnessSnapshotIdentityBindingError';
  }
}

export class HarnessSnapshotAssetReferenceError extends Error {
  readonly code = 'HARNESS_ASSET_SNAPSHOT_MISMATCH';
  readonly status = 409;

  constructor(readonly assetIds: string[]) {
    super(
      'The copy brief references assets outside the frozen execution snapshot.',
    );
    this.name = 'HarnessSnapshotAssetReferenceError';
  }
}

export class HarnessTextSelectionConflictError extends Error {
  readonly code = 'HARNESS_TEXT_SELECTION_CONFLICT';
  readonly status = 409;

  constructor() {
    super(
      'The frozen text selection no longer matches its source ContentPackage version.',
    );
    this.name = 'HarnessTextSelectionConflictError';
  }
}

class SourceContentPackageGuardedRunner implements StructuredNodeRunner {
  constructor(
    private readonly runner: StructuredNodeRunner,
    private readonly verify: () => Promise<void>,
  ) {}

  async run<Output>(
    request: StructuredNodeRunnerRequest<Output>,
  ): Promise<StructuredNodeRunnerResult<Output>> {
    const beforeProviderAttempt = async () => {
      await this.verify();
      await request.beforeProviderAttempt?.();
    };
    await this.verify();
    return this.runner.run({ ...request, beforeProviderAttempt });
  }
}

class ExecutionChildObservedRunner implements StructuredNodeRunner {
  constructor(
    private readonly runner: StructuredNodeRunner,
    private readonly observer: Pick<
      AgentPrimitiveObservabilityAdapter,
      'append'
    >,
    private readonly request: HarnessWorkflowInput,
    private readonly stage: HarnessStage,
  ) {}

  async run<Output>(
    request: StructuredNodeRunnerRequest<Output>,
  ): Promise<StructuredNodeRunnerResult<Output>> {
    assertHarnessExecutionAssemblyPinned(this.request);
    const beforeProviderAttempt = async () => {
      assertHarnessExecutionAssemblyPinned(this.request);
      await request.beforeProviderAttempt?.();
    };
    const lifecycle = executionChildLifecycleInput(
      this.request,
      this.stage,
      request,
    );
    await this.observer.append({ ...lifecycle, phase: 'invoked' });
    let result: StructuredNodeRunnerResult<Output>;
    try {
      result = await this.runner.run({
        ...request,
        beforeProviderAttempt,
      });
    } catch (error) {
      await this.observer.append({
        ...lifecycle,
        phase: 'rejected',
        rejectionClass:
          error instanceof ExecutionAttemptBudgetExceeded
            ? 'execution_budget_exceeded'
            : error instanceof StructuredNodeRunError &&
                error.status === 'unknown'
              ? 'execution_uncertain'
              : 'execution_failed',
      });
      throw error;
    }
    await this.observer.append({ ...lifecycle, phase: 'succeeded' });
    return result;
  }
}

export function observeHarnessStructuredNodeRunner(input: {
  runner: StructuredNodeRunner;
  observer: Pick<AgentPrimitiveObservabilityAdapter, 'append'>;
  request: HarnessWorkflowInput;
  stage: HarnessStage;
}) {
  return new ExecutionChildObservedRunner(
    input.runner,
    input.observer,
    input.request,
    input.stage,
  );
}

export interface ProductionHarnessStagePortsOptions {
  core: {
    runners: HarnessStructuredNodeRunnerFactory;
    context: ProductionHarnessContextPort;
    delivery: HarnessCopyDeliveryPort;
    now: () => string;
  };
  reuse?: {
    tasks: {
      verifyReuseTaskSeed(
        workspaceId: string,
        seed: ReuseTaskSeed,
      ): Promise<AssetRevision>;
    };
  };
  execution?: {
    delivery?: ContentPackageRevisionWritePort;
    sourceContentPackages?: ExecutionSourceContentPackageResolverPort;
  };
  skills?: {
    instructions?: HarnessSkillInstructionResolverPort;
    recipeFacts?: HarnessRecipeFactRequirementPort;
  };
  authorization?: {
    factRights: FactRightsAuthorizationPort;
  };
  observability?: {
    children?: HarnessExecutionChildObservabilityFactory;
    events?: ObservabilityEventAuditPort;
    primitiveCheck?: HarnessPrimitiveCheckPort;
    candidateRunner?: HarnessCandidatePrimitiveRunnerFactory;
  };
  memory?: {
    sedimentation: HarnessMemorySedimentationPort;
  };
  policy?: {
    sensitiveLexicon: SensitiveLexiconReadPort;
  };
  /**
   * V31-14 P1-b: mid-execution Context Fence (§23.4) live-facts head reader.
   * When wired, fenceContext classifies rights revocation (safe stop, no
   * re-charge) and referenced price/date drift (pause prompt) BEFORE the
   * existing recompile fallback. Not wired ⇒ zero behavior change.
   */
  fence?: {
    resolveLiveFacts?: (input: {
      workspaceId: string;
      request: HarnessWorkflowInput;
    }) =>
      | Promise<SnapshotLiveFacts | undefined>
      | SnapshotLiveFacts
      | undefined;
  };
}

export class ProductionHarnessStagePorts implements HarnessStagePorts {
  private readonly acknowledgedContextFences = new Set<string>();
  private readonly runners: HarnessStructuredNodeRunnerFactory;
  private readonly context: ProductionHarnessContextPort;
  private readonly delivery: HarnessCopyDeliveryPort;
  private readonly now: () => string;
  private readonly reuseTasks?: NonNullable<
    ProductionHarnessStagePortsOptions['reuse']
  >['tasks'];
  private readonly executionDelivery?: ContentPackageRevisionWritePort;
  private readonly sourceContentPackages?: ExecutionSourceContentPackageResolverPort;
  private readonly skillInstructions?: HarnessSkillInstructionResolverPort;
  private readonly recipeFacts?: HarnessRecipeFactRequirementPort;
  private readonly factRights?: FactRightsAuthorizationPort;
  private readonly executionChildObservability?: HarnessExecutionChildObservabilityFactory;
  private readonly primitiveCheck?: HarnessPrimitiveCheckPort;
  private readonly candidatePrimitiveRunner?: HarnessCandidatePrimitiveRunnerFactory;
  private readonly observabilityEvents?: ObservabilityEventAuditPort;
  private readonly memorySedimentation?: HarnessMemorySedimentationPort;
  private readonly sensitiveLexicon?: SensitiveLexiconReadPort;
  private readonly resolveFenceLiveFacts?: NonNullable<
    ProductionHarnessStagePortsOptions['fence']
  >['resolveLiveFacts'];

  constructor(options: ProductionHarnessStagePortsOptions) {
    this.runners = options.core.runners;
    this.context = options.core.context;
    this.delivery = options.core.delivery;
    this.now = options.core.now;
    this.reuseTasks = options.reuse?.tasks;
    this.executionDelivery = options.execution?.delivery;
    this.sourceContentPackages = options.execution?.sourceContentPackages;
    this.skillInstructions = options.skills?.instructions;
    this.recipeFacts = options.skills?.recipeFacts;
    this.factRights = options.authorization?.factRights;
    this.executionChildObservability = options.observability?.children;
    this.primitiveCheck = options.observability?.primitiveCheck;
    this.candidatePrimitiveRunner = options.observability?.candidateRunner;
    this.observabilityEvents = options.observability?.events;
    this.memorySedimentation = options.memory?.sedimentation;
    this.sensitiveLexicon = options.policy?.sensitiveLexicon;
    this.resolveFenceLiveFacts = options.fence?.resolveLiveFacts;
  }

  async recordObservabilityEvent(
    input: Parameters<
      NonNullable<HarnessStagePorts['recordObservabilityEvent']>
    >[0],
  ) {
    if (!this.observabilityEvents) {
      throw new Error('Canonical Harness observability is not configured.');
    }
    const event = canonicalObservabilityEvent({
      taskId: input.workflowId,
      binding: harnessCanonicalChildAxes({
        request: input.request,
        stage: 'execution_selection',
        ...(input.promptKey ? { promptKey: input.promptKey } : {}),
      }),
      eventType: input.event.eventType,
      payload: input.event.payload,
    });
    await this.observabilityEvents.append(
      input.request.workspaceId,
      event,
      input.idempotencyKey,
    );
  }

  async recordExecutionAssemblyStep(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    step: Extract<
      HarnessExecutionAssemblyStep,
      'execution_check' | 'event_persistence'
    >;
  }) {
    const assembly = input.request.executionAssembly;
    if (!assembly) return;
    assertHarnessExecutionAssemblyPinned(input.request);
    if (!this.executionChildObservability) {
      throw new Error(
        'Execution assembly requires observability for workflow completion.',
      );
    }
    await this.executionChildObservability.create(input.request).append({
      context: {
        actor: 'worker',
        correlationId: `harness-assembly:${input.step}`,
        userId: 'harness-workflow-worker',
        workspaceId: input.request.workspaceId,
      },
      taskId: input.workflowId,
      primitiveId: `harness-assembly:${input.step}`,
      baseIdempotencyKey: `harness-assembly:${input.workflowId}:${input.step}`,
      axes: {
        axisScope: 'execution_child',
        skillRevision: { kind: 'absent' },
        promptVersion: { kind: 'absent' },
        catalogRevision: { kind: 'absent' },
        scene: { kind: 'absent' },
      },
      phase: 'succeeded',
    });
  }

  async resolveStageSkills(
    input: Parameters<NonNullable<HarnessStagePorts['resolveStageSkills']>>[0],
  ) {
    if (!this.skillInstructions) {
      return { instructions: [], receipts: [] };
    }
    const recipe = input.request.executionSnapshot?.recipe;
    const industryCategory = input.request.decisionReferences?.find(
      (reference) => reference.field === 'industry_category',
    )?.value;
    return this.skillInstructions.resolve({
      workspaceId: input.request.workspaceId,
      workflowId: input.workflowId,
      workflowRevision: input.request.workflowRevision,
      ...(recipe
        ? {
            recipeId: recipe.id,
            recipeRevisionId: recipe.revision,
          }
        : {}),
      stage: input.stage,
      ...(industryCategory ? { industryCategory } : {}),
      ...(input.userSelectedSkillRefs
        ? { userSelectedSkillRefs: input.userSelectedSkillRefs }
        : {}),
      ...(input.skillRevisionRefs
        ? { skillRevisionRefs: input.skillRevisionRefs }
        : {}),
      ...(input.skillManifestSnapshots
        ? {
            skillManifestSnapshots: input.skillManifestSnapshots,
          }
        : {}),
    });
  }

  async nameIntent(
    input: FirstArgument<HarnessStagePorts['nameIntent']>,
  ): ReturnType<HarnessStagePorts['nameIntent']> {
    await this.resolveLiveSourceContentPackage(input.request);
    const runner = this.runnerWithSourceFence(input.request, 'intent_naming');
    const metrics = new InMemoryStructuredNodeMetrics();
    const result = await nameHarnessIntent(
      {
        workflowId: input.workflowId,
        workflowRevision: input.request.workflowRevision,
        // Replay fallback only for durable workflows enqueued before creationMode existed.
        creationMode: input.request.creationMode ?? 'customized',
        deliveryLayer:
          input.request.executionSnapshot?.lens === 'image' ||
          input.request.executionSnapshot?.lens === 'image_text_note' ||
          input.request.executionSnapshot?.lens === 'video'
            ? 'finished_media'
            : 'copy',
        intent: input.request.intent,
        round: input.round,
        prompt: input.request.prompts?.intentNaming,
        ...(input.skillInstructions?.length
          ? { skillInstructions: input.skillInstructions }
          : {}),
      },
      runner,
      metrics,
    );
    const measured = { ...result, metrics: metrics.snapshot() };
    if (
      result.declaration.deliveryLayer !== 'copy' &&
      input.request.executionSnapshot?.lens !== 'image' &&
      input.request.executionSnapshot?.lens !== 'image_text_note' &&
      input.request.executionSnapshot?.lens !== 'video'
    ) {
      throw new HarnessCopyScopeError();
    }
    if (result.blockingQuestion) {
      const snapshot = await this.context.compileAndFreeze({
        workflowId: input.workflowId,
        request: input.request,
        declaration: {
          ...result.declaration,
          route: 'customized',
        },
      });
      const factKey = result.blockingQuestion.questionId.split(':s1:')[1];
      const activeFactReferences =
        snapshot.activeFactReferences ??
        Object.entries(snapshot.bundle.dimensions.store_facts_assets).map(
          ([key, item]) => ({ key, sourceRef: item.sourceRef }),
        );
      const activeConfirmedFacts = activeFactReferences.filter(
        ({ sourceRef }) => sourceRef.startsWith('store_fact:'),
      );
      const matchingFacts = factKey
        ? activeConfirmedFacts.filter(({ key }) => factKeysMatch(key, factKey))
        : [];
      if (matchingFacts.length === 1) {
        return {
          ...measured,
          declaration: {
            ...measured.declaration,
            route: 'customized' as const,
            routingSource: 'policy' as const,
            usedAssetCategories:
              measured.declaration.usedAssetCategories.length > 0
                ? measured.declaration.usedAssetCategories
                : ['store' as const],
          },
          blockingQuestion: null,
        };
      }
      return {
        ...measured,
        gapGrounding: {
          activeConfirmedFactCount: activeConfirmedFacts.length,
          answerableConfirmedFactCount: matchingFacts.length,
        },
      };
    }
    return measured;
  }

  async injectContext(
    input: FirstArgument<HarnessStagePorts['injectContext']>,
  ) {
    return this.context.compileAndFreeze(input);
  }

  async fenceContext(input: FirstArgument<HarnessStagePorts['fenceContext']>) {
    await this.evaluateMidExecutionFence(input);
    return this.context.fence(input);
  }

  acknowledgeContextFence(input: {
    workflowId: string;
    diff: import('./execution-plan-admission.js').SnapshotStaleDiff;
  }) {
    this.acknowledgedContextFences.add(
      this.contextFenceAcknowledgementKey(input.workflowId, input.diff),
    );
  }

  private contextFenceAcknowledgementKey(
    workflowId: string,
    diff: import('./execution-plan-admission.js').SnapshotStaleDiff,
  ) {
    return `${workflowId}:${createHash('sha256')
      .update(JSON.stringify(diff))
      .digest('hex')}`;
  }

  /**
   * V31-14 P1-b (§23.4): classify in-flight execution against live facts
   * before the recompile fallback. safe_stop → typed error (the DBOS failure
   * settlement refunds the reservation, never re-charges). pause_prompt →
   * typed pause error carrying the merchant-visible prompt. All other
   * classifications (continue / soft drift) fall through to the existing
   * recompile port unchanged.
   */
  private async evaluateMidExecutionFence(
    input: FirstArgument<HarnessStagePorts['fenceContext']>,
  ) {
    const snapshot = input.request.executionPlanSnapshot;
    if (!snapshot) return;
    if (!this.resolveFenceLiveFacts) return;
    const live = await this.resolveFenceLiveFacts({
      workspaceId: input.request.workspaceId,
      request: input.request,
    });
    if (!live) return;
    const action = evaluateMidExecutionContextFence({
      snapshot,
      live,
      // The plan's frozen fact refs are the facts this run will cite; drift on
      // any of them is a referenced-fact change (§37.4-F/E precise interrupt).
      referencedFactRevisionIds: snapshot.factRevisionRefs,
    });
    switch (action.action) {
      case 'continue':
      case 'complete_with_review':
        return;
      case 'safe_stop':
        throw new HarnessExecutionFenceSafeStopError(action.message);
      case 'pause_prompt':
        {
          const key = this.contextFenceAcknowledgementKey(
            input.workflowId,
            action.diff,
          );
          // Sticky per exact live-facts diff: the merchant already accepted
          // continuing with this drift. One-shot consume broke post-ack
          // restart (DBOS reuses the same fence effect key and the durable
          // pause rethrows without re-evaluating). A *new* diff hashes to a
          // different key and still pauses.
          if (this.acknowledgedContextFences.has(key)) return;
        }
        throw new HarnessExecutionFencePauseError(
          action.message,
          action.diff,
          input.request,
        );
      case 'auto_update_plan':
      case 'stale_reconfirm':
        // Pre/post-confirm classifications are owned by admission-time gates;
        // mid-execution must not mutate the plan silently.
        return;
    }
  }

  async assessFacts(
    input: Parameters<NonNullable<HarnessStagePorts['assessFacts']>>[0],
  ) {
    const recipeRef = input.request.executionSnapshot?.recipe;
    if (!recipeRef || !this.recipeFacts || !this.factRights) return null;
    const recipe = await this.recipeFacts.getRecipeByRevisionId(
      recipeRef.revision,
    );
    if (
      !recipe ||
      recipe.recipeId !== recipeRef.id ||
      recipe.revisionId !== recipeRef.revision
    ) {
      throw new Error(
        'The frozen Recipe fact requirements are missing or at a different revision.',
      );
    }
    return assessRecipeFactSatisfaction(
      {
        workflowId: input.workflowId,
        workflowRevision: input.request.workflowRevision,
        intent: input.declaration.normalizedIntent,
        factTypes: recipe.factTypes,
        bundle: input.context.bundle,
        at: this.now(),
        skipMerchantAsk:
          input.request.executionSnapshot?.lens === 'copy' ||
          input.request.executionPlanSnapshot?.approvalBasis ===
            'policy_exempt_copy',
        prompts: {
          factSatisfaction: input.request.prompts?.factSatisfaction,
          factCriticality: input.request.prompts?.factCriticality,
        },
      },
      this.runnerWithSourceFence(input.request, 'context_injection'),
      this.factRights,
    );
  }

  async compileBrief(input: FirstArgument<HarnessStagePorts['compileBrief']>) {
    const snapshot = input.request.executionSnapshot;
    if (snapshot && snapshot.lens !== 'copy') {
      throw new HarnessCopyScopeError();
    }
    const sourceContentPackage = await this.resolveLiveSourceContentPackage(
      input.request,
    );
    const runner = this.runnerWithSourceFence(
      input.request,
      'brief_compilation',
    );
    const metrics = new InMemoryStructuredNodeMetrics();
    let degraded = false;
    const brief = await compileExecutionBrief(
      {
        workflowId: input.workflowId,
        unitId: copyUnit(input.context.bundle.revision),
        unitKind: 'copy',
        declaration: input.declaration,
        bundle: input.context.bundle,
        ...(input.allowedFactRefs
          ? { allowedFactRefs: input.allowedFactRefs }
          : {}),
        ...(snapshot ? { executionSnapshot: snapshot } : {}),
        prompt: input.request.prompts?.briefCompilation,
        ...(input.skillInstructions?.length
          ? { skillInstructions: input.skillInstructions }
          : {}),
      },
      runner,
      metrics,
      () => {
        degraded = true;
      },
    );
    if (brief.kind !== 'copy') {
      throw new Error('The first production tracer accepts only copy briefs.');
    }
    const boundBrief = snapshot
      ? bindComposerSnapshotBrief(brief, snapshot, sourceContentPackage?.assets)
      : brief;
    return {
      brief: boundBrief,
      metrics: metrics.snapshot(),
      ...(degraded ? { degraded: true } : {}),
    };
  }

  executeAndSelect(
    input: FirstArgument<HarnessStagePorts['executeAndSelect']>,
  ) {
    this.assertExecutionSelectionInput(input);
    return this.executeAndSelectLive(input);
  }

  private assertExecutionSelectionInput(
    input: FirstArgument<HarnessStagePorts['executeAndSelect']>,
  ) {
    const registeredIdentityRefs = new Set(
      input.context.policyReferences.identityRefs
        .filter((reference) => reference.status === 'registered')
        .map((reference) => reference.id),
    );
    const snapshot = input.request.executionSnapshot;
    if (snapshot) {
      assertComposerSnapshotIdentityBinding(
        snapshot,
        registeredIdentityRefs,
        input.brief.identityRefs,
      );
      if (!snapshot.sources.contentPackage) {
        assertComposerSnapshotAssetBinding(snapshot, input.brief.assetRefs);
      }
    }
    const invalidIdentityRefs = input.brief.identityRefs.filter(
      (reference) => !registeredIdentityRefs.has(reference),
    );
    if (invalidIdentityRefs.length > 0) {
      throw new HarnessIdentityPreflightError(invalidIdentityRefs);
    }
  }

  executeAndSelectBounded(
    input: Parameters<
      NonNullable<HarnessStagePorts['executeAndSelectBounded']>
    >[0],
  ) {
    this.assertExecutionSelectionInput(input);
    const boundedExecution = input.request.boundedExecution;
    if (!boundedExecution || boundedExecution.maxIterations === 'unset') {
      throw new Error(
        'Bounded copy selection requires an explicit maxIterations pin.',
      );
    }
    const resumeFrom = input.boundedResume?.currentBest;
    if (resumeFrom !== undefined && !isCopySelectionCurrentBest(resumeFrom)) {
      throw new Error('Bounded copy continuation has an invalid checkpoint.');
    }
    return this.executeAndSelectLive(input, boundedExecution, resumeFrom);
  }

  private async executeAndSelectLive(
    input: FirstArgument<HarnessStagePorts['executeAndSelect']>,
    boundedExecution?: NonNullable<HarnessWorkflowInput['boundedExecution']>,
    resumeFrom?: import('./execution-selection.js').CopySelectionCurrentBest,
  ) {
    const sourceContentPackage = await this.resolveLiveSourceContentPackage(
      input.request,
    );
    const snapshot = input.request.executionSnapshot;
    const textSelectionSource = snapshot
      ? resolveTextSelectionSource(snapshot, sourceContentPackage)
      : undefined;
    const executionBrief = bindTextSelectionCandidateBrief(
      input.brief,
      textSelectionSource,
    );
    if (snapshot) {
      assertComposerSnapshotAssetBinding(
        snapshot,
        executionBrief.assetRefs,
        sourceContentPackage?.assets,
      );
    }
    const hasAuthorizedOffer = hasAuthorizedOfferEvidence(
      input.context,
      executionBrief.factRefs,
    );
    const unboundedRunner = this.runnerWithSourceFence(
      input.request,
      'execution_selection',
    );
    let runner =
      boundedExecution && boundedExecution.maxIterations !== 'unset'
        ? withExecutionAttemptBudget(
            unboundedRunner,
            new ExecutionAttemptBudget({
              maxAttempts: boundedExecution.maxIterations,
              consumedAttempts: boundedExecution.consumption.iterations,
            }),
          )
        : unboundedRunner;
    if (this.candidatePrimitiveRunner) {
      const snapshot = input.request.executionSnapshot;
      if (!boundedExecution || !snapshot) {
        throw new Error(
          'Primitive copy generation requires bounded execution and billing lineage.',
        );
      }
      const lifecycle = harnessExecutionChildLifecycleInput({
        request: input.request,
        stage: 'execution_selection',
        primitiveId: 'generate',
        baseIdempotencyKey: `wf:${input.workflowId}:s4:agent-generate`,
        promptKey: 'copyCandidate',
      });
      const resumeCandidate = resumeFrom?.candidate
        ? primitiveCandidateResumeFence({
            candidateId: resumeFrom.candidate.candidateId,
            taskId: input.workflowId,
            unitId: copyUnit(input.context.bundle.revision),
          })
        : undefined;
      runner = this.candidatePrimitiveRunner.wrap({
        billing: {
          productUsageTaskId: snapshot.task.id,
          quoteId: snapshot.quote.id,
        },
        boundedExecution,
        observability: lifecycle.axes,
        ...(resumeCandidate ? { resumeCandidate } : {}),
        runner,
        taskId: lifecycle.taskId,
        workspaceId: input.request.workspaceId,
      });
    }
    const selection = await executePlatformCopySelection(
      {
        workflowId: input.workflowId,
        unitId: copyUnit(input.context.bundle.revision),
        brief: executionBrief,
        workspaceId: input.request.workspaceId,
        intendedUse: 'public_content',
        generationContext: {
          bundle: input.context.bundle,
        },
        prompt: input.request.prompts?.copyCandidate,
        ...(boundedExecution ? { boundedExecution } : {}),
        ...(resumeFrom ? { resumeFrom } : {}),
        ...(input.skillInstructions?.length
          ? { skillInstructions: input.skillInstructions }
          : {}),
        onToken: input.onToken,
        allowConcreteOffer: hasAuthorizedOffer,
        policy: {
          phase: 'execution',
          bundle: {
            workspaceId: input.request.workspaceId,
            revision: input.context.bundle.revision,
          },
          brief: { ...executionBrief },
          ...input.context.policyReferences,
        },
      },
      { runner },
    );
    if ('state' in selection) {
      return selection;
    }
    const selected = snapshot
      ? {
          ...selection,
          merchantExecutionEffectKey: `merchant-execution:${snapshot.task.id}:wf:${input.workflowId}:s4:${copyUnit(input.context.bundle.revision)}:${selection.winner.candidateId}`,
        }
      : selection;
    if (!this.primitiveCheck) return selected;
    const correlationId = `wf:${input.workflowId}:s4:agent-check`;
    const lifecycle = harnessExecutionChildLifecycleInput({
      request: input.request,
      stage: 'execution_selection',
      primitiveId: 'check',
      baseIdempotencyKey: correlationId,
      promptKey: 'copyCandidate',
    });
    const checked = await this.primitiveCheck.execute({
      correlationId,
      observability: lifecycle.axes,
      policyInput: {
        phase: 'execution',
        bundle: {
          workspaceId: input.request.workspaceId,
          revision: input.context.bundle.revision,
        },
        brief: structuredClone(executionBrief),
        candidate: structuredClone(selection.winner),
        ...input.context.policyReferences,
      },
      taskId: lifecycle.taskId,
      workflowId: input.workflowId,
      workflowRevision: input.request.workflowRevision,
      workspaceId: input.request.workspaceId,
    });
    if (!checked.allowed) {
      throw new HarnessSelectionError(
        checked.violations.map(({ gateId }) => gateId),
        checked.violations[0]?.reason,
        [],
        checked.violations.flatMap(({ alternativePath }) => alternativePath),
        structuredClone(checked.violations),
      );
    }
    return selected;
  }

  async assembleAndDeliver(
    input: FirstArgument<HarnessStagePorts['assembleAndDeliver']>,
  ) {
    if (input.request.reuseSeed) {
      if (!this.reuseTasks) {
        throw new Error('Reuse Task verification is unavailable.');
      }
      await this.reuseTasks.verifyReuseTaskSeed(
        input.request.workspaceId,
        input.request.reuseSeed,
      );
    }
    const occurredAt = this.now();
    const sensitiveLexicon = await this.sensitiveLexicon?.listEnabled();
    if (input.request.executionSnapshot) {
      if (input.request.executionSnapshot.lens !== 'copy') {
        throw new HarnessCopyScopeError();
      }
      if (!this.executionDelivery) {
        throw new Error('Composer ContentPackage delivery is unavailable.');
      }
      const sourceContentPackage = await this.resolveLiveSourceContentPackage(
        input.request,
      );
      assertComposerSnapshotAssetBinding(
        input.request.executionSnapshot,
        input.brief.assetRefs,
        sourceContentPackage?.assets,
      );
      const claimExtraction = assertDeliverableCandidatesPassVisibleRedlines(
        input,
        occurredAt,
        sensitiveLexicon,
      );
      const delivery = await this.executionDelivery.write(
        copyContentPackageRevisionWriteInput(
          input,
          occurredAt,
          sourceContentPackage?.assets,
          claimExtraction,
          sourceContentPackage,
        ),
      );
      await this.memorySedimentation?.complete(input).catch((error) => {
        console.error('Memory sedimentation failed after delivery.', error);
      });
      return delivery;
    }
    const marketing = createMarketingPackageEvidence({
      declaration: input.declaration,
      context: input.context,
      authorizedFactRefs: input.allowedFactRefs ?? [],
      at: occurredAt,
    });
    const platform = publicationPlatform(input.brief.platform);
    const claimExtraction = assertDeliverableCandidatesPassVisibleRedlines(
      input,
      occurredAt,
      sensitiveLexicon,
    );
    const delivery = await this.delivery.deliverCopyRevision({
      workflowId: input.workflowId,
      workspaceId: input.request.workspaceId,
      packageId: input.request.packageId,
      expectedRevision: input.request.expectedRevision,
      ...(platform ? { platform } : {}),
      occurredAt,
      workflowRevision: input.request.workflowRevision,
      winner: input.selection.winner,
      candidates: input.selection.candidates,
      assetIds: [...input.brief.assetRefs],
      claimExtraction,
      marketing,
      ...(input.request.reuseSeed
        ? { reuseSeed: input.request.reuseSeed }
        : {}),
      recommendation: {
        whyPost: input.declaration.taskType,
        expressionIdentity:
          input.brief.identityRefs.join(',') ||
          'no_expression_identity_reference',
        factReferences: [...input.brief.factRefs],
        platforms: [input.brief.platform],
        customerAction: input.brief.cta,
        complianceStatus: 'seven_gates_passed',
      },
    });
    await this.memorySedimentation?.complete(input).catch((error) => {
      console.error('Memory sedimentation failed after delivery.', error);
    });
    return delivery;
  }

  private runner(request: HarnessWorkflowInput) {
    const snapshot = request.executionSnapshot;
    const frozenRouteSnapshot = structuredControllerFrozenRoute(request);
    return this.runners.create({
      workspaceId: request.workspaceId,
      actorId: request.actorId,
      ...(snapshot
        ? {
            billingTaskId: snapshot.task.id,
            billingQuoteRevision: snapshot.quote.revision,
          }
        : {}),
      ...(frozenRouteSnapshot
        ? {
            frozenRouteSnapshot: structuredClone(frozenRouteSnapshot),
          }
        : {}),
    });
  }

  private runnerWithSourceFence(
    request: HarnessWorkflowInput,
    stage: HarnessStage,
  ) {
    assertHarnessExecutionAssemblyPinned(request);
    const runner = this.runner(request);
    const guarded = new SourceContentPackageGuardedRunner(runner, async () => {
      assertHarnessExecutionAssemblyPinned(request);
      if (request.executionSnapshot?.sources.contentPackage) {
        await this.resolveLiveSourceContentPackage(request);
      }
    });
    if (!request.executionAssembly) return guarded;
    if (!this.executionChildObservability) {
      throw new Error(
        'Execution assembly requires child observability before provider execution.',
      );
    }
    return new ExecutionChildObservedRunner(
      guarded,
      this.executionChildObservability.create(request),
      request,
      stage,
    );
  }

  private async resolveLiveSourceContentPackage(
    request: HarnessWorkflowInput,
  ): Promise<ResolvedSourceContentPackage | undefined> {
    const source = request.executionSnapshot?.sources.contentPackage;
    if (!source) return;
    if (!this.sourceContentPackages) {
      throw new SourceContentPackageUnavailableError(source);
    }
    const textSelection = request.executionSnapshot?.sources.textSelection;
    return this.sourceContentPackages.resolve({
      ...(textSelection && request.executionSnapshot
        ? {
            textSelection: {
              contentPackagePlatform:
                request.executionSnapshot.contentPackagePlatform,
              ...(textSelection.platform
                ? { platform: textSelection.platform }
                : {}),
            },
          }
        : {}),
      workspaceId: request.workspaceId,
      source,
    });
  }
}

const PROMPT_KEY_BY_SCHEMA_NAME = {
  harness_intent_naming_v1: 'intentNaming',
  harness_fact_satisfaction_v1: 'factSatisfaction',
  harness_fact_criticality_v1: 'factCriticality',
  harness_copy_brief_v1: 'briefCompilation',
  harness_image_brief_v1: 'briefImage',
  harness_video_brief_v1: 'briefVideo',
  harness_copy_candidate_v1: 'copyCandidate',
  harness_note_plan_v1: 'notePlan',
  harness_note_text_block_v1: 'noteTextBlock',
  harness_note_consistency_v1: 'noteConsistency',
} as const;

function executionChildLifecycleInput(
  request: HarnessWorkflowInput,
  stage: HarnessStage,
  node: StructuredNodeRunnerRequest<unknown>,
): Omit<AgentPrimitiveLifecycleInput, 'phase'> {
  const promptKey =
    node.promptKey ??
    PROMPT_KEY_BY_SCHEMA_NAME[
      node.schemaName as keyof typeof PROMPT_KEY_BY_SCHEMA_NAME
    ];
  return harnessExecutionChildLifecycleInput({
    request,
    stage,
    primitiveId: node.schemaName,
    baseIdempotencyKey: `${node.effectIdempotencyKey}:structured-node`,
    ...(promptKey ? { promptKey } : {}),
  });
}

export function harnessExecutionChildLifecycleInput(input: {
  request: HarnessWorkflowInput;
  stage: HarnessStage;
  primitiveId: string;
  baseIdempotencyKey: string;
  promptKey?: keyof NonNullable<HarnessWorkflowInput['prompts']>;
}): Omit<AgentPrimitiveLifecycleInput, 'phase'> {
  const { request, stage } = input;
  const assembly = request.executionAssembly;
  if (!assembly) {
    throw new Error(
      'Execution child observability requires the frozen assembly.',
    );
  }
  const skillPrompts = [
    ...new Map(
      assembly.skillStages[stage].flatMap((skill) => {
        const prompt = skill.resolvedInstruction?.prompt;
        return prompt
          ? [[`${prompt.name}@${prompt.version}`, prompt] as const]
          : [];
      }),
    ).values(),
  ];
  if (skillPrompts.length > 1) {
    throw new Error(
      `Execution child has multiple effective Skill prompts for ${input.primitiveId}.`,
    );
  }
  const prompt =
    skillPrompts[0] ??
    (input.promptKey
      ? assembly.promptRevisionRefs[input.promptKey]
      : undefined);
  if (input.promptKey && !prompt) {
    throw new Error(
      `Execution child prompt lineage is missing for ${input.primitiveId}.`,
    );
  }
  const skillRefs = [
    ...new Set(
      assembly.skillStages[stage].map((skill) => skill.skillRevisionRef),
    ),
  ];
  const binding = (
    values: string[],
  ): ObservabilityAxisBinding['skillRevision'] =>
    values.length === 1
      ? { kind: 'bound', value: values[0]! }
      : { kind: 'absent' };
  const scene = assembly.rootAxes.scene;
  const axes: ObservabilityAxisBinding = {
    axisScope: 'execution_child',
    skillRevision: binding(skillRefs),
    promptVersion: prompt
      ? {
          kind: 'bound',
          value: `${prompt.name}@${prompt.version}`,
        }
      : { kind: 'absent' },
    catalogRevision: request.executionSnapshot?.catalogModel.revision
      ? {
          kind: 'bound',
          value: request.executionSnapshot.catalogModel.revision,
        }
      : { kind: 'absent' },
    scene:
      scene.kind === 'bound'
        ? { kind: 'bound', value: scene.value }
        : { kind: 'absent' },
  };
  return {
    context: {
      actor: 'worker',
      correlationId: input.baseIdempotencyKey,
      userId: 'harness-structured-worker',
      workspaceId: request.workspaceId,
    },
    taskId: assembly.workflowId,
    primitiveId: input.primitiveId,
    baseIdempotencyKey: input.baseIdempotencyKey,
    axes,
  };
}

export function harnessCanonicalChildAxes(input: {
  request: HarnessWorkflowInput;
  stage: HarnessStage;
  promptKey?: keyof NonNullable<HarnessWorkflowInput['prompts']>;
}): ObservabilityAxisBinding {
  return harnessExecutionChildLifecycleInput({
    request: input.request,
    stage: input.stage,
    primitiveId: 'canonical-observability',
    baseIdempotencyKey: 'canonical-observability',
    ...(input.promptKey ? { promptKey: input.promptKey } : {}),
  }).axes;
}

function structuredControllerFrozenRoute(
  request: HarnessWorkflowInput,
): HarnessWorkflowInput['frozenRouteSnapshot'] {
  return request.executionSnapshot?.lens === 'copy'
    ? request.frozenRouteSnapshot
    : undefined;
}

function assertDeliverableCandidatesPassVisibleRedlines(
  input: FirstArgument<HarnessStagePorts['assembleAndDeliver']>,
  evaluatedAt: string,
  sensitiveLexicon?: readonly SensitiveWordRecord[],
) {
  const result = validateHarnessVisibleDelivery({
    assetRefs: input.brief.assetRefs,
    brief: input.brief,
    candidateId: input.selection.winner.candidateId,
    context: input.context,
    allowedFactRefs: input.allowedFactRefs ?? [],
    evaluatedAt,
    ...(sensitiveLexicon ? { sensitiveLexicon } : {}),
    expressionIdentityRef: input.brief.identityRefs[0],
    visibleText: input.selection.candidates.flatMap((candidate) => [
      { field: `${candidate.candidateId}.title`, text: candidate.title },
      { field: `${candidate.candidateId}.body`, text: candidate.body },
      { field: `${candidate.candidateId}.cta`, text: candidate.conversionHook },
    ]),
    workspaceId: input.request.workspaceId,
  });
  if (!result.passed) {
    const blocked = new HarnessSelectionError(
      [...new Set(result.failures.map(({ gateId }) => gateId))],
      result.failures[0]?.reason,
      result.failures.flatMap(({ triggeredClaims }) => triggeredClaims ?? []),
      [
        ...new Set(
          result.failures.flatMap(({ alternativePath }) => alternativePath),
        ),
      ],
      structuredClone(result.failures),
    );
    // Printed before the throw because nothing downstream prints it: the
    // handlers log `error.message` and the stack, so the gate that actually
    // said no never reached a log line.
    console.error(
      JSON.stringify(
        harnessSelectionBlockDiagnostics(blocked, {
          candidateCount: input.selection.candidates.length,
          candidateId: input.selection.winner.candidateId,
          workspaceId: input.request.workspaceId,
        }),
      ),
    );
    throw blocked;
  }
  return result.claimExtraction!;
}

export function validateHarnessVisibleDelivery(input: {
  assetRefs: string[];
  brief: Record<string, unknown>;
  candidateId: string;
  context: HarnessContextSnapshot;
  allowedFactRefs?: readonly string[];
  evaluatedAt?: string;
  expressionIdentityRef?: string;
  sensitiveLexicon?: readonly SensitiveWordRecord[];
  visibleText: Array<{ field: string; text: string }>;
  workspaceId: string;
}) {
  const authorizedFactRefs = new Set(input.allowedFactRefs ?? []);
  const auditableFactRefs = currentFactReferences(input.context);
  const allowedFactRefs = new Set(
    [...authorizedFactRefs].filter((reference) =>
      auditableFactRefs.has(reference),
    ),
  );
  return validateHarnessPolicy({
    phase: 'delivery',
    ...(input.evaluatedAt ? { evaluatedAt: input.evaluatedAt } : {}),
    bundle: {
      workspaceId: input.workspaceId,
      revision: input.context.bundle.revision,
    },
    brief: structuredClone(input.brief),
    candidate: {
      assetRefs: [...input.assetRefs],
      candidateId: input.candidateId,
      factClaims: [],
      intendedUse: 'public_content',
      ...(input.expressionIdentityRef
        ? { expressionIdentityRef: input.expressionIdentityRef }
        : {}),
      visibleText: structuredClone(input.visibleText),
      workspaceId: input.workspaceId,
    },
    trustedFactClaims: trustedClaimsFromContext(input.context, allowedFactRefs),
    ...(input.sensitiveLexicon
      ? { sensitiveLexicon: input.sensitiveLexicon }
      : {}),
    ...input.context.policyReferences,
    sourceRefs: input.context.policyReferences.sourceRefs.filter((reference) =>
      allowedFactRefs.has(reference.id),
    ),
  });
}

function trustedClaimsFromContext(
  context: HarnessContextSnapshot,
  allowedFactRefs: ReadonlySet<string>,
): HarnessFactClaim[] {
  const facts =
    context.activeFacts ??
    Object.entries(context.bundle.dimensions.store_facts_assets).map(
      ([key, value]) => ({
        key,
        value: value.value,
        sourceRef: value.sourceRef,
      }),
    );
  return facts.flatMap(({ key, value, sourceRef }) => {
    if (!allowedFactRefs.has(sourceRef)) return [];
    const kind = policyFactKind(key);
    return kind ? [{ kind, sourceRef, value: JSON.stringify(value) }] : [];
  });
}

function currentFactReferences(context: HarnessContextSnapshot) {
  return new Set(
    Object.values(context.bundle.dimensions.store_facts_assets)
      .filter(
        (contribution) =>
          contribution.layer === 'current_fact' &&
          contribution.pool === 'store_personal' &&
          contribution.factSnapshot !== undefined,
      )
      .map((contribution) => contribution.sourceRef),
  );
}

function policyFactKind(key: string): HarnessFactClaim['kind'] | null {
  const normalized = key.toLowerCase();
  if (normalized.includes('price')) return 'price';
  if (
    normalized.includes('offer') ||
    normalized.includes('group_buy') ||
    normalized.includes('discount')
  ) {
    return 'offer';
  }
  if (normalized.includes('benefit')) return 'benefit';
  if (
    normalized.includes('qualification') ||
    normalized.includes('certification') ||
    normalized.includes('license')
  ) {
    return 'qualification';
  }
  return null;
}

export function copyContentPackageRevisionWriteInput(
  input: FirstArgument<HarnessStagePorts['assembleAndDeliver']>,
  occurredAt: string,
  sourceAssets: ReadonlyArray<{ id: string; role: 'source' | 'selected' }> = [],
  claimExtraction?: VisibleClaimExtraction,
  sourceContentPackage?: ResolvedSourceContentPackage,
): ContentPackageRevisionWriteInput {
  const snapshot = input.request.executionSnapshot;
  if (!snapshot) {
    throw new Error('Composer delivery requires an execution snapshot.');
  }
  assertComposerSnapshotAssetBinding(
    snapshot,
    input.brief.assetRefs,
    sourceAssets,
  );
  const authorizedFactRefs = composerDeliveryFactRefs(input);
  const marketing = createMarketingPackageEvidence({
    declaration: input.declaration,
    context: input.context,
    authorizedFactRefs,
    at: occurredAt,
  });
  const textSelectionSource = resolveTextSelectionSource(
    snapshot,
    sourceContentPackage,
  );
  const versions = input.selection.candidates.map((candidate) => {
    const sourceDocument = textSelectionSource?.document;
    return {
      id: copyRevisionVersionId(
        input.workflowId,
        input.request.packageId,
        candidate,
      ),
      title: sourceDocument?.title ?? candidate.title,
      body: textSelectionSource
        ? assertTextSelectionCandidateBody(candidate.body, textSelectionSource)
        : candidate.body,
      ...(sourceDocument
        ? sourceDocument.conversionHook
          ? { conversionHook: sourceDocument.conversionHook }
          : {}
        : { conversionHook: candidate.conversionHook }),
      harnessCandidateId: candidate.candidateId,
      harnessScore: candidate.score,
      orderedAssetIds: sourceDocument
        ? [...sourceDocument.orderedAssetIds]
        : [...new Set(input.brief.assetRefs)],
      topics: sourceDocument ? [...sourceDocument.topics] : [],
      createdAt: occurredAt,
      createdBy: `harness-${input.workflowId}`,
      source: 'ai_generated' as const,
    };
  });
  const winner = versions.find(
    (candidate) =>
      candidate.harnessCandidateId === input.selection.winner.candidateId,
  );
  if (!winner) {
    throw new Error('The Harness winner must be a delivered candidate.');
  }
  const workAssetId = harnessCopyWorkAssetId({
    revisionId: winner.id,
    workId: snapshot.work.id,
    workspaceId: input.request.workspaceId,
  });
  const revision: ContentPackageRevisionWriteInput = {
    additionalVersions: versions.filter(
      (candidate) => candidate.id !== winner.id,
    ),
    ...(claimExtraction ? { claimExtraction } : {}),
    expectedRevision: input.request.expectedRevision,
    generated: {
      assetIds: [workAssetId],
      childRuns: [],
      ...(sourceContentPackage?.ownedAssets?.length
        ? { ownedAssets: structuredClone(sourceContentPackage.ownedAssets) }
        : {}),
    },
    harnessSelection: {
      recommendedCandidateId: input.selection.winner.candidateId,
    },
    idempotencyKey: `harness-copy:${input.workflowId}`,
    kind: 'image_text',
    marketing,
    occurredAt,
    packageId: input.request.packageId,
    ...(publicationPlatform(snapshot.platform.id)
      ? { platform: publicationPlatform(snapshot.platform.id) }
      : {}),
    snapshotId: snapshot.id,
    snapshot: {
      id: snapshot.id,
      revision: snapshot.revision,
      schemaVersion: snapshot.schemaVersion,
      ...(snapshot.semanticDecision
        ? {
            semanticDecision: {
              sourceSnapshotId: snapshot.semanticDecision.sourceSnapshotId,
            },
          }
        : {}),
    },
    ...(snapshot.sources.contentPackage
      ? { sourceContentPackage: snapshot.sources.contentPackage }
      : {}),
    taskId: snapshot.task.id,
    version: winner,
    variants: buildCopyPlatformVariants({
      currentVersionId: winner.id,
      packageId: input.request.packageId,
      versions,
    }),
    workAsset: {
      body: winner.body,
      candidateIndex: 0,
      ...(winner.conversionHook
        ? { conversionHook: winner.conversionHook }
        : {}),
      createdAt: occurredAt,
      id: workAssetId,
      jobId: snapshot.task.id,
      kind: 'text',
      title: winner.title,
      workId: snapshot.work.id,
      workspaceId: input.request.workspaceId,
    },
    workId: snapshot.work.id,
    workflowId: input.workflowId,
    workflowRevision: input.request.workflowRevision,
    workspaceId: input.request.workspaceId,
    ...(input.context.factsRevision !== undefined
      ? { factsRevision: input.context.factsRevision }
      : {}),
    ...(authorizedFactRefs.length > 0 ? { factRefs: authorizedFactRefs } : {}),
  };
  assertCopyRevisionAssemblyComplete(revision);
  return revision;
}

function composerDeliveryFactRefs(
  input: FirstArgument<HarnessStagePorts['assembleAndDeliver']>,
) {
  const granted = [
    ...input.brief.factRefs,
    ...(input.allowedFactRefs ?? []),
  ].filter((ref) => typeof ref === 'string' && ref.trim());
  const active =
    granted.length > 0
      ? []
      : (input.context.activeFactReferences ?? [])
          .map((fact) => fact.sourceRef)
          .filter((ref) => typeof ref === 'string' && ref.trim());
  return [...new Set([...granted, ...active])];
}

function resolveTextSelectionSource(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
  sourceContentPackage?: ResolvedSourceContentPackage,
) {
  const scope = snapshot.sources.textSelection;
  if (!scope) return undefined;
  const sourceReference = snapshot.sources.contentPackage;
  const document = sourceContentPackage?.document;
  const digest = document
    ? createHash('sha256').update(document.body).digest('hex')
    : undefined;
  if (
    !sourceReference ||
    !sourceContentPackage ||
    sourceReference.id !== scope.packageId ||
    sourceContentPackage.reference.id !== sourceReference.id ||
    sourceContentPackage.reference.revision !== sourceReference.revision ||
    !document ||
    document.platform !== scope.platform ||
    document.id !== scope.versionId ||
    scope.end > document.body.length ||
    digest !== scope.sourceTextSha256 ||
    document.body.slice(scope.start, scope.end) !== scope.selectedText
  ) {
    throw new HarnessTextSelectionConflictError();
  }
  return { document, end: scope.end, start: scope.start };
}

function assertTextSelectionCandidateBody(
  candidateBody: string,
  source: {
    document: NonNullable<ResolvedSourceContentPackage['document']>;
    end: number;
    start: number;
  },
) {
  const prefix = source.document.body.slice(0, source.start);
  const suffix = source.document.body.slice(source.end);
  if (
    candidateBody.length < prefix.length + suffix.length ||
    !candidateBody.startsWith(prefix) ||
    !candidateBody.endsWith(suffix)
  ) {
    throw new HarnessTextSelectionConflictError();
  }
  return candidateBody;
}

function bindTextSelectionCandidateBrief(
  brief: Extract<
    Awaited<ReturnType<typeof compileExecutionBrief>>,
    { kind: 'copy' }
  >,
  source?: {
    document: NonNullable<ResolvedSourceContentPackage['document']>;
    end: number;
    start: number;
  },
) {
  if (!source) return brief;
  const selectedText = source.document.body.slice(source.start, source.end);
  const machineContract = `result_text_selection_v1:${JSON.stringify({
    end: source.end,
    sourceBody: source.document.body,
    start: source.start,
  })}`;
  return {
    ...brief,
    constraints: [...brief.constraints, machineContract],
    instructions: `${brief.instructions}\n\n选区调整的生产合同（必须严格执行）：\n原始完整正文：${source.document.body}\n允许变更的区间：${source.start}-${source.end}\n选中文字：${selectedText}\ncandidate.body 必须返回完整正文，仅该区间可变；区间外的前缀和后缀必须逐字保留。`,
  };
}

function copyRevisionVersionId(
  workflowId: string,
  packageId: string,
  candidate: { candidateId: string; title: string; body: string },
) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        workflowId,
        candidateId: candidate.candidateId,
        title: candidate.title,
        body: candidate.body,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return `${packageId}-harness-${digest}`;
}

export function publicationPlatform(platform: string) {
  if (
    platform === 'xiaohongshu' ||
    platform === 'douyin' ||
    platform === 'video_account'
  ) {
    return platform;
  }
  // Moments handoff + offline material export never enter delivery-approval
  // platforms. Returning undefined keeps ContentPackage write on the export /
  // handoff path instead of failing the whole run (QA ISSUE offline delivery).
  if (platform === 'wechat_moments' || platform === 'offline') {
    return undefined;
  }
  throw new Error(`Platform ${platform} does not support delivery approval.`);
}

function bindComposerSnapshotBrief(
  brief: Extract<
    Awaited<ReturnType<typeof compileExecutionBrief>>,
    { kind: 'copy' }
  >,
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
  sourceAssets: ReadonlyArray<{ id: string; role: 'source' | 'selected' }> = [],
) {
  const expectedIdentityRef = snapshotIdentityReference(snapshot);
  if (expectedIdentityRef === null) {
    if (brief.identityRefs.length > 0) {
      throw new HarnessSnapshotIdentityBindingError(
        'official-neutral',
        brief.identityRefs,
      );
    }
    assertComposerSnapshotAssetBinding(snapshot, brief.assetRefs, sourceAssets);
    return {
      ...brief,
      identityRefs: [],
      platform: snapshot.platform.id,
    };
  }
  const foreignIdentityRefs = brief.identityRefs.filter(
    (identityRef) => identityRef !== expectedIdentityRef,
  );
  if (foreignIdentityRefs.length > 0) {
    throw new HarnessSnapshotIdentityBindingError(
      expectedIdentityRef,
      brief.identityRefs,
    );
  }
  assertComposerSnapshotAssetBinding(snapshot, brief.assetRefs, sourceAssets);
  return {
    ...brief,
    identityRefs: [expectedIdentityRef],
    platform: snapshot.platform.id,
  };
}

function assertComposerSnapshotIdentityBinding(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
  registeredIdentityRefs: Set<string>,
  briefIdentityRefs: string[],
) {
  const expectedIdentityRef = snapshotIdentityReference(snapshot);
  if (expectedIdentityRef === null) {
    if (registeredIdentityRefs.size !== 0 || briefIdentityRefs.length !== 0) {
      throw new HarnessSnapshotIdentityBindingError(
        'official-neutral',
        briefIdentityRefs,
      );
    }
    return;
  }
  if (
    registeredIdentityRefs.size !== 1 ||
    !registeredIdentityRefs.has(expectedIdentityRef) ||
    briefIdentityRefs.length !== 1 ||
    briefIdentityRefs[0] !== expectedIdentityRef
  ) {
    throw new HarnessSnapshotIdentityBindingError(
      expectedIdentityRef,
      briefIdentityRefs,
    );
  }
}

function assertComposerSnapshotAssetBinding(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
  briefAssetRefs: string[],
  sourceAssets: ReadonlyArray<{ id: string; role: 'source' | 'selected' }> = [],
) {
  const snapshotAssetIds = new Set(
    snapshot.sources.assets.map((asset) => asset.id),
  );
  for (const asset of sourceAssets) {
    if (asset.role === 'selected') snapshotAssetIds.add(asset.id);
  }
  const foreignAssetIds = [...new Set(briefAssetRefs)].filter(
    (assetId) => !snapshotAssetIds.has(assetId),
  );
  if (foreignAssetIds.length > 0) {
    throw new HarnessSnapshotAssetReferenceError(foreignAssetIds);
  }
}

function snapshotIdentityReference(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
) {
  if (isOfficialNeutralIdentity(snapshot.identity)) return null;
  return `marketing_identity:${snapshot.identity.id}:${snapshot.identity.revision}`;
}

function hasAuthorizedOfferEvidence(
  context: HarnessContextSnapshot,
  authorizedFactRefs: readonly string[],
) {
  const authorized = new Set(authorizedFactRefs);
  return Object.values(context.bundle.dimensions.store_facts_assets).some(
    (contribution) =>
      contribution.layer === 'current_fact' &&
      contribution.pool === 'store_personal' &&
      contribution.factSnapshot !== undefined &&
      authorized.has(contribution.sourceRef) &&
      (contribution.factSnapshot.kind === 'price' ||
        contribution.factSnapshot.kind === 'group_buy' ||
        contribution.factSnapshot.kind === 'discount'),
  );
}

function copyUnit(revision: number) {
  return revision === 1 ? 'copy-primary' : `copy-primary-r${revision}`;
}

function primitiveCandidateResumeFence(input: {
  candidateId: string;
  taskId: string;
  unitId: string;
}) {
  const retrySuffix = '-retry';
  const isRevision = input.candidateId.endsWith(retrySuffix);
  const sourceCandidateId = isRevision
    ? input.candidateId.slice(0, -retrySuffix.length)
    : input.candidateId;
  if (!sourceCandidateId) {
    throw new Error('Primitive copy resume candidate identity is invalid.');
  }
  return {
    revision: isRevision ? 2 : 1,
    sourceEffectIdempotencyKey: `wf:${input.taskId}:s4:${input.unitId}:${sourceCandidateId}`,
  };
}

function normalizedFactKey(value: string) {
  return (
    value
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .match(/[\p{L}\p{N}]+/gu)
      ?.join('.') ?? ''
  );
}

const FACT_KEY_ALIASES = new Map<string, string>([
  ['amount', 'price'],
  ['cost', 'price'],
  ['fee', 'price'],
  ['price', 'price'],
  ['discount', 'discount'],
  ['groupbuy', 'group_buy'],
  ['qualification', 'qualification'],
  ['fulfillment', 'fulfillment'],
  ['experience', 'staff_experience'],
  ['case', 'customer_case'],
]);

function factKeysMatch(storedKey: string, requestedKey: string) {
  const stored = normalizedFactKey(storedKey);
  const requested = normalizedFactKey(requestedKey);
  if (stored === requested) return true;
  return factConcept(stored) === factConcept(requested);
}

function factConcept(normalizedKey: string) {
  const tokens = normalizedKey.split('.');
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const concept = FACT_KEY_ALIASES.get(tokens[index]!);
    if (concept) return concept;
  }
  return normalizedKey;
}

import { createHash } from 'node:crypto';

import type {
  AssetRevision,
  ContentPackageRevisionDelivery,
  CreativeRecommendationDecisionTrace,
  MarketingPackageEvidence,
  ObservabilityAxisBinding,
  ReuseTaskSeed,
  StoreFactKind,
  HarnessStage,
} from '@meiye/contracts';

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
    input: Parameters<HarnessStagePorts['assembleAndDeliver']>[0],
  ): Promise<
    Array<{ itemId: string; candidate: unknown; decision: unknown }>
  >;
  complete(
    input: Parameters<HarnessStagePorts['assembleAndDeliver']>[0],
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

export class ProductionHarnessStagePorts implements HarnessStagePorts {
  constructor(
    private readonly runners: HarnessStructuredNodeRunnerFactory,
    private readonly context: ProductionHarnessContextPort,
    private readonly delivery: HarnessCopyDeliveryPort,
    private readonly now: () => string,
    private readonly reuseTasks?: {
      verifyReuseTaskSeed(
        workspaceId: string,
        seed: ReuseTaskSeed,
      ): Promise<AssetRevision>;
    },
    private readonly executionDelivery?: ContentPackageRevisionWritePort,
    private readonly sourceContentPackages?: ExecutionSourceContentPackageResolverPort,
    private readonly skillInstructions?: HarnessSkillInstructionResolverPort,
    private readonly recipeFacts?: HarnessRecipeFactRequirementPort,
    private readonly factRights?: FactRightsAuthorizationPort,
    private readonly executionChildObservability?: HarnessExecutionChildObservabilityFactory,
    private readonly primitiveCheck?: HarnessPrimitiveCheckPort,
    private readonly candidatePrimitiveRunner?: HarnessCandidatePrimitiveRunnerFactory,
    private readonly observabilityEvents?: ObservabilityEventAuditPort,
    private readonly memorySedimentation?: HarnessMemorySedimentationPort,
  ) {}

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
    input: Parameters<HarnessStagePorts['nameIntent']>[0],
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
    input: Parameters<HarnessStagePorts['injectContext']>[0],
  ) {
    return this.context.compileAndFreeze(input);
  }

  fenceContext(input: Parameters<HarnessStagePorts['fenceContext']>[0]) {
    return this.context.fence(input);
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
        prompts: {
          factSatisfaction: input.request.prompts?.factSatisfaction,
          factCriticality: input.request.prompts?.factCriticality,
        },
      },
      this.runnerWithSourceFence(input.request, 'context_injection'),
      this.factRights,
    );
  }

  async compileBrief(input: Parameters<HarnessStagePorts['compileBrief']>[0]) {
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
    input: Parameters<HarnessStagePorts['executeAndSelect']>[0],
  ) {
    this.assertExecutionSelectionInput(input);
    return this.executeAndSelectLive(input);
  }

  private assertExecutionSelectionInput(
    input: Parameters<HarnessStagePorts['executeAndSelect']>[0],
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
    input: Parameters<HarnessStagePorts['executeAndSelect']>[0],
    boundedExecution?: NonNullable<HarnessWorkflowInput['boundedExecution']>,
    resumeFrom?: import('./execution-selection.js').CopySelectionCurrentBest,
  ) {
    const sourceContentPackage = await this.resolveLiveSourceContentPackage(
      input.request,
    );
    const snapshot = input.request.executionSnapshot;
    if (snapshot) {
      assertComposerSnapshotAssetBinding(
        snapshot,
        input.brief.assetRefs,
        sourceContentPackage?.assets,
      );
    }
    const hasAuthorizedOffer = hasAuthorizedOfferEvidence(
      input.context,
      input.brief.factRefs,
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
        brief: input.brief,
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
          brief: { ...input.brief },
          ...input.context.policyReferences,
        },
      },
      { runner },
    );
    if ('state' in selection || !this.primitiveCheck) {
      return selection;
    }
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
        brief: structuredClone(input.brief),
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
      );
    }
    return selection;
  }

  async assembleAndDeliver(
    input: Parameters<HarnessStagePorts['assembleAndDeliver']>[0],
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
      );
      const delivery = await this.executionDelivery.write(
        copyContentPackageRevisionWriteInput(
          input,
          occurredAt,
          sourceContentPackage?.assets,
          claimExtraction,
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
    return this.sourceContentPackages.resolve({
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
  input: Parameters<HarnessStagePorts['assembleAndDeliver']>[0],
  evaluatedAt: string,
) {
  const result = validateHarnessVisibleDelivery({
    assetRefs: input.brief.assetRefs,
    brief: input.brief,
    candidateId: input.selection.winner.candidateId,
    context: input.context,
    allowedFactRefs: input.allowedFactRefs ?? [],
    evaluatedAt,
    expressionIdentityRef: input.brief.identityRefs[0],
    visibleText: input.selection.candidates.flatMap((candidate) => [
      { field: `${candidate.candidateId}.title`, text: candidate.title },
      { field: `${candidate.candidateId}.body`, text: candidate.body },
      { field: `${candidate.candidateId}.cta`, text: candidate.conversionHook },
    ]),
    workspaceId: input.request.workspaceId,
  });
  if (!result.passed) {
    throw new HarnessSelectionError(
      [...new Set(result.failures.map(({ gateId }) => gateId))],
      result.failures[0]?.reason,
      result.failures.flatMap(({ triggeredClaims }) => triggeredClaims ?? []),
    );
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
  input: Parameters<HarnessStagePorts['assembleAndDeliver']>[0],
  occurredAt: string,
  sourceAssets: ReadonlyArray<{ id: string; role: 'source' | 'selected' }> = [],
  claimExtraction?: VisibleClaimExtraction,
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
  const marketing = createMarketingPackageEvidence({
    declaration: input.declaration,
    context: input.context,
    authorizedFactRefs: input.allowedFactRefs ?? [],
    at: occurredAt,
  });
  const versions = input.selection.candidates.map((candidate) => ({
    id: copyRevisionVersionId(
      input.workflowId,
      input.request.packageId,
      candidate,
    ),
    title: candidate.title,
    body: candidate.body,
    conversionHook: candidate.conversionHook,
    harnessCandidateId: candidate.candidateId,
    harnessScore: candidate.score,
    orderedAssetIds: [...new Set(input.brief.assetRefs)],
    topics: [],
    createdAt: occurredAt,
    createdBy: `harness-${input.workflowId}`,
    source: 'ai_generated' as const,
  }));
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
    generated: { assetIds: [workAssetId], childRuns: [] },
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
      conversionHook: winner.conversionHook,
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
  };
  assertCopyRevisionAssemblyComplete(revision);
  return revision;
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

function publicationPlatform(platform: string) {
  if (
    platform === 'xiaohongshu' ||
    platform === 'douyin' ||
    platform === 'video_account'
  ) {
    return platform;
  }
  if (platform === 'wechat_moments') return undefined;
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
    sourceEffectIdempotencyKey:
      `wf:${input.taskId}:s4:${input.unitId}:${sourceCandidateId}`,
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

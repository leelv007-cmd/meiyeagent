/**
 * Deterministic Plan Compiler (V3.1 §13 / §22 / V31-09).
 *
 * LLM outputs PlanProposal (strategy only). Compiler alone fills:
 * quote / rights / model availability / capability / bound revisions / expiry.
 * Model-proposed money/rights/availability fields are ignored (exit gate).
 *
 * Outputs:
 * - MarketingPlanRevision (append-only, no status column)
 * - CompiledExecutionPlan (plan-as-data: typed units + honest current serial
 *   capability; retry/cache remain disabled until an executor consumes them)
 *
 * No grammar interpreter. Conditional positions forbid side effects (A18).
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  compiledExecutionPlanSchema,
  CURRENT_COMPILED_EXECUTION_CAPABILITIES,
  MARKETING_PLAN_REVISION_SCHEMA_VERSION,
  marketingPlanIdSchema,
  marketingPlanRevisionSchema,
  type AgentRevisionRef,
  type CompiledExecutionPlan,
  type MarketingPlanReadiness,
  type MarketingPlanRevision,
  type PlanDeliverable,
  type PlanMemoryContext,
  type ExecutionPlanPackageBilling,
} from '@meiye/contracts';

import { createCanonicalCarrierUnitRecipeRegistry } from '../harness/carrier-unit-recipes.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { SemanticEventCandidate } from '../agent-semantic-events/semantic-event-store.js';
import {
  createCanonicalExecutionUnitRegistry,
  type ExecutionUnitRegistry,
} from './execution-unit-registry.js';
import {
  projectMarketingPlanReadiness,
  type PlanReadinessFacts,
} from './plan-readiness.js';
import {
  buildPlanSemanticEventCandidate,
  planSemanticEventId,
  type PlanLivingPlanBillingOverlay,
  type PlanSemanticEventSink,
} from './plan-semantic-event.js';
import type {
  MarketingPlanCompileArtifact,
  MarketingPlanStore,
} from './plan-store.js';
import type { ServerPackageQuoteIntent } from '../product-billing/server-quote-authority.js';
import {
  canonicalPlanPatchFromMerchantInstruction,
  planProposalSchema,
  type PlanPatchProposal,
  type PlanProposal,
} from './turn-contracts.js';

// ─── Ports (deterministic authorities; model never implements these) ────────

export type PlanCompilerQuoteResolution = {
  quoteRef: AgentRevisionRef;
  /** Absolute expiry for the plan quote binding. */
  expiresAt: string;
  /** Opaque billing-domain facts for capabilitySummary.quote (no amounts required). */
  summary?: Record<string, unknown>;
  /** Server-only package allocation authority copied into the compile freeze. */
  packageBilling?: ExecutionPlanPackageBilling;
};

/**
 * The narrow plan-store surface safe to join a caller-owned PostgreSQL
 * transaction. It deliberately excludes semantic projection: the append
 * outbox is durable, while projection remains an after-commit concern.
 */
export type LiveBindingRefreshTransactionPort = Pick<
  MarketingPlanStore,
  'append' | 'getRevision' | 'getLatest'
>;

export type PlanCompilerQuotePort = {
  resolveQuote(input: {
    workspaceId: string;
    planId: string;
    planRevision: number;
    deliverables: PlanDeliverable[];
    harnessReleaseId: string;
    quoteRefHint?: AgentRevisionRef;
    quoteResolutionHint?: PlanCompilerQuoteResolution;
    /** Server-admitted billing quote; never sourced from PlanProposal/model output. */
    billingQuoteRef?: AgentRevisionRef;
    /**
     * Server-only package authority. Browser/public intent has no equivalent
     * field; production callers must provide every carrier authority and final
     * deliverable explicitly or the quote port fails closed.
     */
    packageQuoteInput?: ServerPackageQuoteIntent;
  }): Promise<PlanCompilerQuoteResolution>;
};

export type PlanCompilerRightsResolution = {
  rightsSummary: Record<string, unknown>;
  rightsRevisionIds: string[];
  assetUsages: unknown[];
  factUsages: unknown[];
  blocked?: boolean;
  blockReason?: string;
};

export type PlanCompilerRightsPort = {
  resolveRights(input: {
    workspaceId: string;
    assetIntentions: readonly string[];
    factIntentions: readonly string[];
    deliverables: PlanDeliverable[];
  }): Promise<PlanCompilerRightsResolution>;
};

export type PlanCompilerModelResolution = {
  capabilitySummary: Record<string, unknown>;
  modelRevisionIds: string[];
  available: boolean;
  unavailableReason?: string;
};

export type PlanCompilerModelPort = {
  resolveAvailability(input: {
    workspaceId: string;
    deliverables: PlanDeliverable[];
    harnessReleaseId: string;
  }): Promise<PlanCompilerModelResolution>;
};

export type SkillInvocationReceipt = {
  skillId: string;
  skillRevisionRef: string;
  contentHash: string;
  harnessReleaseId: string;
  stage: 'plan_compile';
  invokedAt: string;
};

export type PlanCompilerRecipeSkillResolution = {
  recipeRevisionIds: string[];
  catalogRevisionId: string;
  sourceRevisionIds: string[];
  skillInvocationReceipts: SkillInvocationReceipt[];
  complianceSummary?: Record<string, unknown>;
};

/**
 * Submission-bound recipe / source / catalog pins. Production resolves these
 * from CreationExecutionSnapshot (and related repository authority) — never
 * invents empty arrays or literal catalog fallbacks (V31-38).
 */
export type PlanCompilerRecipeAuthorityHint = {
  recipeRevisionIds: string[];
  catalogRevisionId: string;
  sourceRevisionIds: string[];
};

export type PlanCompilerRecipeSkillPort = {
  resolveRecipeSkills(input: {
    workspaceId: string;
    deliverables: PlanDeliverable[];
    harnessReleaseId: string;
    now: string;
    /** Exact recipe/source/catalog pins from submission / catalog authority. */
    recipeAuthorityHint?: PlanCompilerRecipeAuthorityHint;
  }): Promise<PlanCompilerRecipeSkillResolution>;
};

export type PlanCompilerPorts = {
  quote: PlanCompilerQuotePort;
  rights: PlanCompilerRightsPort;
  models: PlanCompilerModelPort;
  recipeSkills: PlanCompilerRecipeSkillPort;
};

// ─── Input / result ─────────────────────────────────────────────────────────

export type CompilePlanInput = {
  workspaceId: string;
  /**
   * Tenant boundary for semantic event projection. Defaults to workspaceId
   * (same as shadow workflow projector resourceId mapping).
   */
  resourceId?: string;
  threadId: string;
  goalIds?: string[];
  scope?: MarketingPlanRevision['scope'];
  /** New plan id; generated when omitted. */
  planId?: string;
  /** When adjusting: continue the same planId and append revision. */
  existingPlanId?: string;
  proposal: PlanProposal;
  /**
   * Natural-language adjust path: only produces a new revision (never mutates old).
   * Applied as expression / narrative overlay after proposal parse.
   */
  patch?: PlanPatchProposal;
  intentRevision: number;
  contextBundleId: string;
  contextRevision: string;
  harnessReleaseId: string;
  /** Server-owned quote authority already admitted for this submission. */
  quoteRefHint?: AgentRevisionRef;
  /** Exact ProductQuote authority snapshot, including its validity window. */
  quoteResolutionHint?: PlanCompilerQuoteResolution;
  /**
   * Exact recipe / source / catalog pins from the admitted submission snapshot.
   * Production plan compilation fails closed when this authority is absent.
   */
  recipeAuthorityHint?: PlanCompilerRecipeAuthorityHint;
  /** Server-admitted billing quote; never sourced from PlanProposal/model output. */
  billingQuoteRef?: AgentRevisionRef;
  /** Explicit server package authority; never populated from browser intent. */
  packageQuoteInput?: ServerPackageQuoteIntent;
  /** Confirmed memories returned by this Session turn, with exact receipt binding. */
  memoryContext?: PlanMemoryContext | null;
  now?: string;
  /** Optional merchant billing overlay for Living Plan cost section (no invention). */
  livingPlanBilling?: PlanLivingPlanBillingOverlay;
  /**
   * Contamination channel for constructive tests: anything the model might
   * illegally put in a proposal envelope. Compiler MUST ignore these.
   */
  modelContamination?: {
    quote?: unknown;
    quoteRef?: unknown;
    balance?: unknown;
    rightsStatus?: unknown;
    rightsSummary?: unknown;
    modelAvailability?: unknown;
    expiresAt?: unknown;
  };
};

/** One carrier's durable execution plan (see CompilePlanResult.executionPlans). */
export type CompiledCarrierExecutionPlan = {
  carrier: PlanDeliverable['kind'];
  executionPlan: CompiledExecutionPlan;
  /** Reserved compatibility surface; empty until cache execution lands. */
  unitCacheKeys: Record<string, string>;
};

export type CompilePlanResult = {
  revision: MarketingPlanRevision;
  /**
   * The plan revision may span carriers (a merchant can order copy and notes in
   * one Plan, and the Living Plan / quote / credit projections all model that),
   * but one durable Make execution targets exactly one carrier: the executor
   * resolves a single carrier recipe per run and namespaces its durable effect
   * keys under it. So compilation emits one execution plan per carrier here, in
   * deliverable order, and a Make submission carries exactly one of them.
   */
  executionPlans: CompiledCarrierExecutionPlan[];
  /**
   * First carrier's plan. Convenience for the single-carrier case; on a
   * multi-carrier revision callers must pick from `executionPlans`. Submitting
   * the wrong carrier's plan is refused by the executor's carrier binding rather
   * than silently executed.
   */
  executionPlan: CompiledExecutionPlan;
  readiness: MarketingPlanReadiness;
  skillInvocationReceipts: SkillInvocationReceipt[];
  /** Reserved compatibility surface; current serial plans always return {}. */
  unitCacheKeys: Record<string, string>;
  /** Exact package allocation contract copied to every carrier freeze. */
  packageBilling?: ExecutionPlanPackageBilling;
};

export type RefreshPlanLiveBindingsInput = {
  planId: string;
  expectedRevision: number;
  quoteRef: AgentRevisionRef;
  rightsRevisionRefs: readonly string[];
  factRevisionRefs: readonly string[];
  now?: string;
  /**
   * Tenant resource for plan.revised projection (workspaceId). Required for
   * Living Plan UI to append the successor revision and show agent-plan-diff
   * after a live-facts fence refresh (V31-14 / §37.4-E).
   */
  workspaceId: string;
};

export type RefreshPlanLiveBindingsResult = MarketingPlanCompileArtifact & {
  factRevisionRefs: readonly string[];
};

export class PlanCompilerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlanCompilerError';
    this.code = code;
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deliverableId(index: number, kind: string): string {
  return `d${index + 1}-${kind}`;
}

// ─── Compiler ───────────────────────────────────────────────────────────────

export class PlanCompiler {
  private readonly registry: ExecutionUnitRegistry;
  private readonly ports: PlanCompilerPorts;
  private readonly store: MarketingPlanStore;
  private semanticEvents: PlanSemanticEventSink | undefined;

  constructor(options: {
    store: MarketingPlanStore;
    ports: PlanCompilerPorts;
    registry?: ExecutionUnitRegistry;
    /** Optional: projector.project sink (late-bound in production assembly). */
    semanticEvents?: PlanSemanticEventSink;
  }) {
    this.store = options.store;
    this.ports = options.ports;
    this.registry =
      options.registry ?? createCanonicalExecutionUnitRegistry();
    this.semanticEvents = options.semanticEvents;
  }

  get unitRegistry(): ExecutionUnitRegistry {
    return this.registry;
  }

  /**
   * Late-bind AgentSemanticEventProjector (api-runtime creates projector after
   * core graph). No-op when unset: unit tests without projector stay silent.
   */
  bindSemanticEventProjector(sink: PlanSemanticEventSink): void {
    this.semanticEvents = sink;
  }

  getSemanticEventProjector(): PlanSemanticEventSink | undefined {
    return this.semanticEvents;
  }

  /**
   * Compile a PlanProposal into an append-only MarketingPlanRevision +
   * plan-as-data CompiledExecutionPlan. Always writes via the store.
   */
  async compile(input: CompilePlanInput): Promise<CompilePlanResult> {
    const now = input.now ?? new Date().toISOString();
    const proposal = planProposalSchema.parse(input.proposal);

    // Exit gate: model contamination is observed then discarded.
    void input.modelContamination;

    const planId = marketingPlanIdSchema.parse(
      input.existingPlanId?.trim() ||
        input.planId?.trim() ||
        `plan_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    );

    const latest = await this.store.getLatest(planId);
    const expectedGoalSummary =
      input.patch !== undefined
        ? `${proposal.goalNarrative} · 调整：${input.patch.summary}`.slice(0, 2_000)
        : proposal.goalNarrative;
    if (
      latest &&
      latest.revision.boundRevisions.intentRevision === input.intentRevision &&
      latest.revision.boundRevisions.contextBundleId === input.contextBundleId &&
      latest.revision.boundRevisions.contextRevision === input.contextRevision &&
      latest.revision.boundRevisions.harnessReleaseId === input.harnessReleaseId &&
      latest.revision.goal.summary === expectedGoalSummary
    ) {
      const readiness = projectMarketingPlanReadiness({
        revision: latest.revision,
        facts: {
          contextRevision: input.contextRevision,
          recipeRevisionIds: latest.revision.boundRevisions.recipeRevisionIds,
          catalogRevisionId: latest.revision.boundRevisions.catalogRevisionId,
          modelRevisionIds: latest.revision.boundRevisions.modelRevisionIds,
          sourceRevisionIds: latest.revision.boundRevisions.sourceRevisionIds,
          rightsRevisionIds: latest.revision.boundRevisions.rightsRevisionIds,
        },
        now,
      });
      // Explicit repair seam: append may have committed before projector I/O
      // failed. Stable eventId makes this replay idempotent and, critically,
      // the same compile intent never fabricates a second plan revision.
      await this.emitPlanSemanticEvent(
        await this.persistedPlanEventCandidateOrFallback({
          eventId: planSemanticEventId(
            latest.revision.planId,
            latest.revision.revision,
          ),
          buildFixtureFallback: () =>
            this.buildPlanSemanticEventCandidate({
              resourceId: this.requirePlanEventResourceId(
                input.workspaceId,
                input.resourceId,
              ),
              revision: latest.revision,
              readiness,
              adjustmentSummary: input.patch?.summary,
              billing: input.livingPlanBilling,
              correlationId: input.threadId,
              occurredAt: latest.revision.createdAt,
            }),
        }),
      );
      // Same doctrine as the fresh path: rebuild the carrier plans
      // deterministically and let the stored primary win round-trip identity.
      const executionPlans = this.buildExecutionPlans({
        revision: latest.revision,
        workspaceId: input.workspaceId,
        deliverables: latest.revision.deliverables,
      }).map((compiled, index) =>
        index === 0
          ? { ...compiled, executionPlan: latest.executionPlan }
          : compiled,
      );
      return {
        revision: latest.revision,
        executionPlans,
        executionPlan: latest.executionPlan,
        readiness,
        skillInvocationReceipts: [],
        unitCacheKeys: {},
        ...(latest.packageBilling
          ? { packageBilling: structuredClone(latest.packageBilling) }
          : {}),
      };
    }
    const nextRevision = latest ? latest.revision.revision + 1 : 1;

    const canonicalPatch = input.patch
      ? canonicalPlanPatchFromMerchantInstruction(input.patch.instructions)
      : undefined;
    const deliverables = this.buildDeliverables(proposal).map((deliverable) =>
      canonicalPatch?.deliverableQuantity !== undefined
        ? { ...deliverable, quantity: canonicalPatch.deliverableQuantity }
        : deliverable,
    );
    const [rights, models, recipeSkills, quote] = await Promise.all([
      this.ports.rights.resolveRights({
        workspaceId: input.workspaceId,
        assetIntentions: proposal.assetIntentions ?? [],
        factIntentions: proposal.factIntentions ?? [],
        deliverables,
      }),
      this.ports.models.resolveAvailability({
        workspaceId: input.workspaceId,
        deliverables,
        harnessReleaseId: input.harnessReleaseId,
      }),
      this.ports.recipeSkills.resolveRecipeSkills({
        workspaceId: input.workspaceId,
        deliverables,
        harnessReleaseId: input.harnessReleaseId,
        now,
        ...(input.recipeAuthorityHint
          ? { recipeAuthorityHint: input.recipeAuthorityHint }
          : {}),
      }),
      this.ports.quote.resolveQuote({
        workspaceId: input.workspaceId,
        planId,
        planRevision: nextRevision,
        deliverables,
        harnessReleaseId: input.harnessReleaseId,
        quoteRefHint: input.quoteRefHint,
        quoteResolutionHint: input.quoteResolutionHint,
        ...(input.billingQuoteRef
          ? { billingQuoteRef: input.billingQuoteRef }
          : {}),
        ...(input.packageQuoteInput
          ? { packageQuoteInput: input.packageQuoteInput }
          : {}),
      }),
    ]);

    // Deterministic authorities always win — never take model quote/rights/etc.
    const expression = {
      ...(proposal.expressionStrategy ?? {}),
      ...(input.patch
        ? {
            // Patch is narrative only; does not rewrite quote/rights.
            narrativeStructure:
              input.patch.summary.slice(0, 500) ||
              proposal.expressionStrategy?.narrativeStructure,
          }
        : {}),
    };

    const goalSummary = expectedGoalSummary;

    const revisionDraft: MarketingPlanRevision = marketingPlanRevisionSchema.parse(
      {
        schemaVersion: MARKETING_PLAN_REVISION_SCHEMA_VERSION,
        planId,
        revision: nextRevision,
        threadId: input.threadId,
        goalIds: input.goalIds ?? [],
        scope: input.scope ?? 'single_work',
        intent: {
          summary: proposal.goalNarrative,
          assumptions: proposal.assumptions,
          desiredActions: deliverables
            .map((item) => item.purpose)
            .filter((value): value is string => Boolean(value)),
          platformHints: deliverables
            .map((item) => item.platform)
            .filter((value): value is string => Boolean(value)),
        },
        memoryContext: input.memoryContext ?? null,
        goal: {
          summary: goalSummary,
          whyNow: proposal.whyNow ?? null,
          desiredAction:
            deliverables[0]?.purpose ??
            deliverables.map((item) => item.kind).join('+'),
        },
        deliverables,
        expression,
        factUsages: rights.factUsages,
        assetUsages: rights.assetUsages,
        rightsSummary: rights.rightsSummary,
        complianceSummary: recipeSkills.complianceSummary ?? {
          stage: 'plan_compile',
        },
        capabilitySummary: {
          ...models.capabilitySummary,
          modelAvailable: models.available,
          ...(quote.summary ? { quote: quote.summary } : {}),
        },
        quoteRef: quote.quoteRef,
        boundRevisions: {
          intentRevision: input.intentRevision,
          contextBundleId: input.contextBundleId,
          contextRevision: input.contextRevision,
          recipeRevisionIds: recipeSkills.recipeRevisionIds,
          catalogRevisionId: recipeSkills.catalogRevisionId,
          modelRevisionIds: models.modelRevisionIds,
          sourceRevisionIds: recipeSkills.sourceRevisionIds,
          rightsRevisionIds: rights.rightsRevisionIds,
          harnessReleaseId: input.harnessReleaseId,
        },
        contentHash: 'pending',
        expiresAt: quote.expiresAt,
        createdAt: now,
      },
    );

    const contentHash = sha256Hex(
      fingerprintValue({
        planId: revisionDraft.planId,
        revision: revisionDraft.revision,
        intent: revisionDraft.intent,
        goal: revisionDraft.goal,
        deliverables: revisionDraft.deliverables,
        expression: revisionDraft.expression,
        memoryContext: revisionDraft.memoryContext,
        quoteRef: revisionDraft.quoteRef,
        boundRevisions: revisionDraft.boundRevisions,
        rightsSummary: revisionDraft.rightsSummary,
        capabilitySummary: revisionDraft.capabilitySummary,
      }),
    );

    const revision = marketingPlanRevisionSchema.parse({
      ...revisionDraft,
      contentHash,
    });

    const executionPlans = this.buildExecutionPlans({
      revision,
      workspaceId: input.workspaceId,
      deliverables,
    });
    const [primary] = executionPlans;
    if (!primary) {
      throw new PlanCompilerError(
        'EMPTY_PLAN_NO_CARRIER',
        'A plan revision must compile at least one carrier execution plan.',
      );
    }
    const { executionPlan, unitCacheKeys } = primary;

    // A18: reject any plan that would place side-effect units in conditionals.
    for (const compiled of executionPlans) {
      assertNoConditionalSideEffects(compiled.executionPlan, this.registry);
    }

    const readinessFacts: PlanReadinessFacts = {
      contextRevision: input.contextRevision,
      recipeRevisionIds: recipeSkills.recipeRevisionIds,
      catalogRevisionId: recipeSkills.catalogRevisionId,
      modelRevisionIds: models.modelRevisionIds,
      sourceRevisionIds: recipeSkills.sourceRevisionIds,
      rightsRevisionIds: rights.rightsRevisionIds,
      blocked: rights.blocked === true,
      modelUnavailable: models.available === false,
    };

    const readiness = projectMarketingPlanReadiness({
      revision,
      facts: readinessFacts,
      now,
    });

    const semanticEventCandidate = this.buildPlanSemanticEventCandidate({
      resourceId: this.requirePlanEventResourceId(
        input.workspaceId,
        input.resourceId,
      ),
      revision,
      readiness,
      adjustmentSummary: input.patch?.summary,
      billing: input.livingPlanBilling,
      correlationId: input.threadId,
      occurredAt: revision.createdAt,
    });
    const stored = await this.store.append({
      revision,
      executionPlan,
      workspaceId: input.workspaceId,
      semanticEventCandidate,
      ...(quote.packageBilling
        ? { packageBilling: structuredClone(quote.packageBilling) }
        : {}),
    });

    await this.emitPlanSemanticEvent(semanticEventCandidate);

    return {
      revision: stored.revision,
      // The store round-trips the primary plan; the remaining carriers keep the
      // freshly compiled artifacts.
      executionPlans: executionPlans.map((compiled, index) =>
        index === 0
          ? { ...compiled, executionPlan: stored.executionPlan }
          : compiled,
      ),
      executionPlan: stored.executionPlan,
      readiness,
      skillInvocationReceipts: recipeSkills.skillInvocationReceipts,
      unitCacheKeys,
      ...(quote.packageBilling
        ? { packageBilling: structuredClone(quote.packageBilling) }
        : {}),
    };
  }

  /**
   * Natural-language adjust: compile a new revision from the latest proposal
   * overlay. Old revisions remain readable and unmodified.
   */
  async adjust(input: CompilePlanInput & { existingPlanId: string }) {
    if (!input.existingPlanId.trim()) {
      throw new PlanCompilerError(
        'PLAN_ADJUST_REQUIRES_ID',
        'adjust requires existingPlanId',
      );
    }
    const latest = await this.store.getLatest(input.existingPlanId);
    if (!latest) {
      throw new PlanCompilerError(
        'PLAN_NOT_FOUND',
        `No plan revisions for ${input.existingPlanId}`,
      );
    }
    return this.compile(input);
  }

  /**
   * Persist a post-confirm live-authority refresh as an append-only
   * MarketingPlanRevision. This is intentionally compiler-owned: the Harness
   * may detect drift, but it never invents an in-memory revision number.
   *
   * Re-entry after a committed append returns the exact matching successor;
   * an unrelated newer revision fails closed.
   */
  async refreshLiveBindings(
    input: RefreshPlanLiveBindingsInput,
  ): Promise<RefreshPlanLiveBindingsResult> {
    return this.refreshLiveBindingsWithStore(input, this.store, true);
  }

  /**
   * Same authority algorithm as refreshLiveBindings, but it never projects a
   * semantic event before the caller-owned transaction commits. Production
   * successor admission uses this with PostgresMarketingPlanStore's
   * client-bound adapter so quote, plan revision, confirmation hold and task
   * request either all commit or all roll back.
   */
  async refreshLiveBindingsInTransaction(
    input: RefreshPlanLiveBindingsInput,
    store: LiveBindingRefreshTransactionPort,
  ): Promise<RefreshPlanLiveBindingsResult> {
    return this.refreshLiveBindingsWithStore(input, store, false);
  }

  private async refreshLiveBindingsWithStore(
    input: RefreshPlanLiveBindingsInput,
    store: LiveBindingRefreshTransactionPort,
    emitAfterAppend: boolean,
  ): Promise<RefreshPlanLiveBindingsResult> {
    const source = await store.getRevision(
      input.planId,
      input.expectedRevision,
    );
    if (!source) {
      throw new PlanCompilerError(
        'PLAN_NOT_FOUND',
        `Plan revision ${input.planId}@${input.expectedRevision} was not found.`,
      );
    }
    const workspaceId = this.requirePlanEventResourceId(input.workspaceId);
    const targetRevision = input.expectedRevision + 1;
    const existing = await store.getLatest(input.planId);
    if (existing?.revision.revision === targetRevision) {
      const matched = this.assertMatchingLiveRefresh(existing, input);
      // Idempotent re-entry: re-emit so a prior process crash after append but
      // before projector.project still lands plan.revised for the UI.
      if (emitAfterAppend) {
        await this.emitLiveRefreshPlanSemanticEvent(
          await this.persistedPlanEventCandidateOrFallback({
            eventId: planSemanticEventId(
              matched.revision.planId,
              matched.revision.revision,
            ),
            buildFixtureFallback: () =>
              this.buildLiveRefreshPlanSemanticEventCandidate(
                matched.revision,
                workspaceId,
              ),
          }),
        );
      }
      return matched;
    }
    if (existing?.revision.revision !== input.expectedRevision) {
      throw new PlanCompilerError(
        'PLAN_LIVE_REFRESH_CONFLICT',
        `Plan ${input.planId} advanced to revision ${existing?.revision.revision ?? 'missing'} before live binding refresh.`,
      );
    }

    const now = input.now ?? new Date().toISOString();
    const liveBindingRefresh = {
      sourcePlanRevision: input.expectedRevision,
      quoteRef: input.quoteRef,
      rightsRevisionRefs: [...input.rightsRevisionRefs],
      factRevisionRefs: [...input.factRevisionRefs],
    };
    const draft = marketingPlanRevisionSchema.parse({
      ...source.revision,
      revision: targetRevision,
      quoteRef: input.quoteRef,
      factUsages: input.factRevisionRefs.map((factRef) => ({ factRef })),
      rightsSummary: {
        source: 'live_execution_fence',
        revisionIds: [...input.rightsRevisionRefs],
        previous: source.revision.rightsSummary,
      },
      capabilitySummary: {
        source: 'live_execution_fence',
        previous: source.revision.capabilitySummary,
        liveBindingRefresh,
      },
      boundRevisions: {
        ...source.revision.boundRevisions,
        rightsRevisionIds: [...input.rightsRevisionRefs],
      },
      contentHash: 'pending',
      createdAt: now,
    });
    const revision = marketingPlanRevisionSchema.parse({
      ...draft,
      contentHash: sha256Hex(
        fingerprintValue({
          ...draft,
          contentHash: undefined,
        }),
      ),
    });
    const semanticEventCandidate = this.buildLiveRefreshPlanSemanticEventCandidate(
      revision,
      workspaceId,
    );
    try {
      const stored = await store.append({
        revision,
        executionPlan: source.executionPlan,
        workspaceId,
        semanticEventCandidate,
      });
      if (emitAfterAppend) {
        await this.emitLiveRefreshPlanSemanticEvent(semanticEventCandidate);
      }
      return { ...stored, factRevisionRefs: [...input.factRevisionRefs] };
    } catch (error) {
      const raced = await store.getLatest(input.planId);
      if (raced?.revision.revision === targetRevision) {
        const matched = this.assertMatchingLiveRefresh(raced, input);
        if (emitAfterAppend) {
          await this.emitLiveRefreshPlanSemanticEvent(
            await this.persistedPlanEventCandidateOrFallback({
              eventId: planSemanticEventId(
                matched.revision.planId,
                matched.revision.revision,
              ),
              buildFixtureFallback: () =>
                this.buildLiveRefreshPlanSemanticEventCandidate(
                  matched.revision,
                  workspaceId,
                ),
            }),
          );
        }
        return matched;
      }
      throw error;
    }
  }

  /**
   * Live-fence refresh is also an append-only plan revision. Without projecting
   * plan.revised, Workstream never appends rN+1 and agent-plan-diff stays empty
   * even though the authority + re-confirm interrupt advanced.
   */
  private buildLiveRefreshPlanSemanticEventCandidate(
    revision: MarketingPlanRevision,
    workspaceId: string,
  ): SemanticEventCandidate {
    return this.buildPlanSemanticEventCandidate({
      resourceId: workspaceId,
      revision,
      readiness: 'stale',
      adjustmentSummary: '方案依据已更新，请重新确认后再执行',
      correlationId: revision.threadId,
      occurredAt: revision.createdAt,
    });
  }

  private async emitLiveRefreshPlanSemanticEvent(
    candidate: SemanticEventCandidate,
  ): Promise<void> {
    await this.emitPlanSemanticEvent(candidate);
  }

  projectReadiness(input: {
    revision: MarketingPlanRevision;
    facts: PlanReadinessFacts;
    now: string;
  }): MarketingPlanReadiness {
    return projectMarketingPlanReadiness(input);
  }

  /**
   * Low-latency path after append: project plan.created (r1) or plan.revised (r>1).
   *
   * V31-40: Postgres append writes an outbox candidate in the same transaction
   * as the revision, so a crash after commit still leaves a durable dispatch
   * candidate. PlanEventOutboxDispatcher recovers pending rows; projector is
   * idempotent on eventId (planSemanticEventId). This emit remains the fast path
   * and marks the outbox dispatched when the store supports it.
   */
  private async emitPlanSemanticEvent(
    candidate: SemanticEventCandidate,
  ): Promise<void> {
    if (!this.semanticEvents) return;
    await this.semanticEvents.project(candidate);
    await this.store.markPlanEventOutboxProjected?.({
      eventId: candidate.eventId,
      candidate,
    });
  }

  private buildPlanSemanticEventCandidate(input: Parameters<
    typeof buildPlanSemanticEventCandidate
  >[0]): SemanticEventCandidate {
    return buildPlanSemanticEventCandidate(input);
  }

  private requirePlanEventResourceId(
    workspaceId: string,
    resourceId?: string,
  ): string {
    const workspace = workspaceId.trim();
    const explicitResource = resourceId?.trim();
    const resolved = explicitResource || workspace;
    if (!resolved) {
      throw new PlanCompilerError(
        'PLAN_EVENT_WORKSPACE_REQUIRED',
        'A durable plan semantic event requires an explicit workspace resource.',
      );
    }
    if (explicitResource && explicitResource !== workspace) {
      throw new PlanCompilerError(
        'PLAN_EVENT_WORKSPACE_MISMATCH',
        'A plan semantic event resource must match its admitted workspace.',
      );
    }
    return resolved;
  }

  private async persistedPlanEventCandidateOrFallback(input: {
    eventId: string;
    /** Memory fixtures have no durable outbox; production never invokes it. */
    buildFixtureFallback: () => SemanticEventCandidate;
  }): Promise<SemanticEventCandidate> {
    if (!this.store.getPlanEventOutboxCandidate) {
      return input.buildFixtureFallback();
    }
    const stored = await this.store.getPlanEventOutboxCandidate(
      input.eventId,
    );
    if (!stored) {
      throw new PlanCompilerError(
        'PLAN_EVENT_CANDIDATE_MISSING',
        `Plan semantic event ${input.eventId} has no durable canonical candidate.`,
      );
    }
    return stored;
  }

  private assertMatchingLiveRefresh(
    artifact: MarketingPlanCompileArtifact,
    input: RefreshPlanLiveBindingsInput,
  ): RefreshPlanLiveBindingsResult {
    const summary = artifact.revision.capabilitySummary;
    const marker =
      summary && typeof summary === 'object' && !Array.isArray(summary)
        ? (summary as { liveBindingRefresh?: unknown }).liveBindingRefresh
        : undefined;
    const expected = {
      sourcePlanRevision: input.expectedRevision,
      quoteRef: input.quoteRef,
      rightsRevisionRefs: [...input.rightsRevisionRefs],
      factRevisionRefs: [...input.factRevisionRefs],
    };
    if (fingerprintValue(marker) !== fingerprintValue(expected)) {
      throw new PlanCompilerError(
        'PLAN_LIVE_REFRESH_CONFLICT',
        `Plan ${input.planId}@${artifact.revision.revision} is not the requested live binding successor.`,
      );
    }
    return {
      ...artifact,
      factRevisionRefs: [...input.factRevisionRefs],
    };
  }

  private buildDeliverables(proposal: PlanProposal): PlanDeliverable[] {
    return proposal.recommendedDeliverables.map((item, index) => ({
      deliverableId: deliverableId(index, item.carrier),
      kind: item.carrier,
      ...(item.platform ? { platform: item.platform } : {}),
      quantity: item.quantity,
      ...(item.purpose ? { purpose: item.purpose } : {}),
    }));
  }

  /**
   * One execution plan per carrier present in the revision, in deliverable
   * order. Splitting here (rather than rejecting the revision) is the deliberate
   * decision: the Plan is allowed to span carriers, a single Make execution is
   * not.
   */
  private buildExecutionPlans(input: {
    revision: MarketingPlanRevision;
    workspaceId: string;
    deliverables: PlanDeliverable[];
  }): CompiledCarrierExecutionPlan[] {
    return buildCompiledCarrierExecutionPlans({
      ...input,
      registry: this.registry,
    });
  }
}

/**
 * Deterministic per-carrier plans from a stored revision (V31-47).
 * Used by freeze rebuild when the plan store only round-trips the primary plan.
 */
export function buildCompiledCarrierExecutionPlans(input: {
  revision: MarketingPlanRevision;
  workspaceId: string;
  deliverables?: PlanDeliverable[];
  registry?: ExecutionUnitRegistry;
  /** When present, index 0 reuses the store-round-tripped primary plan. */
  primaryExecutionPlan?: CompiledExecutionPlan;
}): CompiledCarrierExecutionPlan[] {
  const registry = input.registry ?? createCanonicalExecutionUnitRegistry();
  const deliverables = input.deliverables ?? input.revision.deliverables;
  const carriers = [...new Set(deliverables.map((item) => item.kind))];
  return carriers.map((carrier, index) => {
    const compiled = buildOneCarrierExecutionPlan(
      {
        revision: input.revision,
        workspaceId: input.workspaceId,
        carrier,
        deliverables: deliverables.filter((item) => item.kind === carrier),
      },
      registry,
    );
    if (index === 0 && input.primaryExecutionPlan) {
      return {
        carrier,
        executionPlan: input.primaryExecutionPlan,
        unitCacheKeys: compiled.unitCacheKeys,
      };
    }
    return { carrier, ...compiled };
  });
}

function buildOneCarrierExecutionPlan(
  input: {
    revision: MarketingPlanRevision;
    workspaceId: string;
    carrier: PlanDeliverable['kind'];
    /** Only the deliverables of this carrier. */
    deliverables: PlanDeliverable[];
  },
  registry: ExecutionUnitRegistry,
): {
  executionPlan: CompiledExecutionPlan;
  unitCacheKeys: Record<string, string>;
} {
  const carrier = input.carrier;
  const recipe = createCanonicalCarrierUnitRecipeRegistry().resolve(carrier);
  const canonical = structuredClone(recipe.plan);
  const repeatableSteps = new Set(
    recipe.stepCatalog
      .filter((step) => step.repeatable)
      .map((step) => `${step.primitive}:${step.role}`),
  );
  const commonInput = {
    planId: input.revision.planId,
    planRevision: input.revision.revision,
    deliverables: input.deliverables,
    quoteRef: input.revision.quoteRef,
  };

  // Per-deliverable expansion: a repeatable step runs once per requested
  // deliverable unit, so quantity 1 and quantity 7 are different plans. The
  // executor keys each instance's durable effects on deliverableId +
  // deliverableIndex, which is why they must be carried on the unit itself.
  const expansions = input.deliverables.flatMap((deliverable) =>
    Array.from({ length: deliverable.quantity }, (_, index) => ({
      deliverableId: deliverable.deliverableId,
      deliverableIndex: index,
    })),
  );
  const expandedIds = new Map<string, string[]>();
  const units = canonical.units.flatMap((unit) => {
    const declaredInput =
      unit.input && typeof unit.input === 'object' ? unit.input : {};
    const role = (declaredInput as { role?: unknown }).role;
    const stepKey = `${unit.primitive}:${typeof role === 'string' ? role : ''}`;
    if (!repeatableSteps.has(stepKey) || expansions.length <= 1) {
      return [
        {
          ...unit,
          input: {
            ...declaredInput,
            ...commonInput,
            ...(repeatableSteps.has(stepKey) && expansions[0]
              ? expansions[0]
              : {}),
          },
        },
      ];
    }
    const instances = expansions.map((expansion, index) => ({
      ...unit,
      unitId: `${unit.unitId}-${index + 1}` as typeof unit.unitId,
      input: { ...declaredInput, ...commonInput, ...expansion },
    }));
    expandedIds.set(
      unit.unitId,
      instances.map((instance) => instance.unitId),
    );
    return instances;
  });
  // V31-18: confirmed-memory context rides the units that read context or
  // generate content — the same units whose cache keys must change when the
  // injected memory changes.
  if (input.revision.memoryContext) {
    for (const unit of units) {
      if (unit.primitive === 'generate' || unit.unitType === 'context.read') {
        (unit.input as Record<string, unknown>).memoryContext =
          input.revision.memoryContext;
      }
    }
  }
  const dependencyGroups = canonical.dependencyGroups.map((group) => ({
    ...group,
    unitIds: group.unitIds.flatMap(
      (unitId) => (expandedIds.get(unitId) ?? [unitId]) as typeof unitId[],
    ),
  }));
  const serialGroups = dependencyGroups.flatMap((group) =>
    group.unitIds.map((unitId, index) => ({
      groupId: index === 0 ? group.groupId : `${group.groupId}-${index + 1}`,
      unitIds: [unitId],
    })),
  );

  // Closing parse: the compiler's output is a contract, so it is validated
  // here rather than trusted because it started from a canonical recipe.
  const executionPlan = compiledExecutionPlanSchema.parse({
    ...canonical,
    units,
    executionCapabilities: CURRENT_COMPILED_EXECUTION_CAPABILITIES,
    dependencyGroups: serialGroups,
    boundedRetry: {},
  });
  return { executionPlan, unitCacheKeys: {} };
}

/**
 * A18 constructive check: no side-effect unit may be used as a conditional
 * judgment position. Plan-as-data has no grammar ConditionalNode; this guards
 * the registry-level mayAppearInConditional contract for future code branches.
 */
export function assertNoConditionalSideEffects(
  plan: CompiledExecutionPlan,
  registry: ExecutionUnitRegistry,
): void {
  for (const unit of plan.units) {
    const definition = registry.resolve(unit.unitType);
    if (
      definition.mayAppearInConditional &&
      definition.sideEffectClass !== 'none' &&
      definition.sideEffectClass !== 'read'
    ) {
      throw new PlanCompilerError(
        'CONDITIONAL_SIDE_EFFECT',
        `Unit ${unit.unitId} (${unit.unitType}) violates A18.`,
      );
    }
  }
  // Grammar interpreter absence: plan must not carry conditional node shapes.
  const forbiddenKeys = [
    'conditionalNodes',
    'ConditionalNode',
    'grammar',
    'ifElse',
  ];
  const serialized = JSON.stringify(plan);
  for (const key of forbiddenKeys) {
    if (serialized.includes(`"${key}"`)) {
      throw new PlanCompilerError(
        'GRAMMAR_INTERPRETER_FORBIDDEN',
        `CompiledExecutionPlan must not embed ${key} (plan-as-data only).`,
      );
    }
  }
}

// ─── Fixture / production port helpers ──────────────────────────────────────

export function createFixturePlanCompilerPorts(
  overrides: Partial<PlanCompilerPorts> = {},
): PlanCompilerPorts {
  const nowIso = () => new Date().toISOString();
  return {
    quote: {
      async resolveQuote(input) {
        return {
          quoteRef: {
            id: `quote-${input.planId}`,
            revision: input.planRevision,
          },
          expiresAt: new Date(
            Date.parse(nowIso()) + 60 * 60 * 1000,
          ).toISOString(),
          summary: {
            source: 'fixture_quote_port',
            deliverableCount: input.deliverables.length,
          },
        };
      },
    },
    rights: {
      async resolveRights(input) {
        return {
          rightsSummary: {
            source: 'fixture_rights_port',
            assetIntentionCount: input.assetIntentions.length,
            status: 'resolved',
          },
          rightsRevisionIds: ['rights-rev-fixture-1'],
          assetUsages: input.assetIntentions.map((intention, index) => ({
            intention,
            assetRef: `asset-intent-${index + 1}`,
          })),
          factUsages: input.factIntentions.map((intention, index) => ({
            intention,
            factRef: `fact-intent-${index + 1}`,
          })),
          blocked: false,
        };
      },
    },
    models: {
      async resolveAvailability(input) {
        return {
          capabilitySummary: {
            source: 'fixture_model_port',
            carriers: input.deliverables.map((item) => item.kind),
          },
          modelRevisionIds: ['model-rev-fixture-1'],
          available: true,
        };
      },
    },
    recipeSkills: {
      async resolveRecipeSkills(input) {
        const receipts: SkillInvocationReceipt[] = [
          {
            skillId: 'platform.beauty-copywriting',
            skillRevisionRef: 'skill:beauty-copywriting@1',
            contentHash: 'fixture-skill-hash',
            harnessReleaseId: input.harnessReleaseId,
            stage: 'plan_compile',
            invokedAt: input.now,
          },
        ];
        return {
          recipeRevisionIds: ['recipe-rev-fixture-1'],
          catalogRevisionId: 'catalog-rev-fixture-1',
          sourceRevisionIds: ['source-rev-fixture-1'],
          skillInvocationReceipts: receipts,
          complianceSummary: { source: 'fixture_recipe_port' },
        };
      },
    },
    ...overrides,
  };
}

export function createProductionPlanCompiler(options: {
  store: MarketingPlanStore;
  ports: PlanCompilerPorts;
  registry?: ExecutionUnitRegistry;
  semanticEvents?: PlanSemanticEventSink;
}): PlanCompiler {
  for (const key of ['quote', 'rights', 'models', 'recipeSkills'] as const) {
    if (!options.ports[key]) {
      throw new PlanCompilerError(
        'PLAN_COMPILER_PORT_MISSING',
        `PlanCompiler production assembly requires ports.${key}`,
      );
    }
  }
  return new PlanCompiler(options);
}

export type { MarketingPlanCompileArtifact };

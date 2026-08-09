/**
 * Deterministic Plan Compiler (V3.1 §13 / §22 / V31-09).
 *
 * LLM outputs PlanProposal (strategy only). Compiler alone fills:
 * quote / rights / model availability / capability / bound revisions / expiry.
 * Model-proposed money/rights/availability fields are ignored (exit gate).
 *
 * Outputs:
 * - MarketingPlanRevision (append-only, no status column)
 * - CompiledExecutionPlan (plan-as-data: typed units + dependency groups +
 *   retry default-off + workspace cache policies with releaseId)
 *
 * No grammar interpreter. Conditional positions forbid side effects (A18).
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  MARKETING_PLAN_REVISION_SCHEMA_VERSION,
  compiledExecutionPlanSchema,
  executionUnitIdSchema,
  marketingPlanIdSchema,
  marketingPlanRevisionSchema,
  type AgentRevisionRef,
  type CompiledExecutionPlan,
  type ExecutionUnit,
  type ExecutionUnitId,
  type MarketingPlanReadiness,
  type MarketingPlanRevision,
  type PlanDeliverable,
} from '@meiye/contracts';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  buildExecutionUnitCacheKey,
  createCanonicalExecutionUnitRegistry,
  ExecutionUnitRegistry,
  type ExecutionUnitTypeDefinition,
} from './execution-unit-registry.js';
import {
  projectMarketingPlanReadiness,
  type PlanReadinessFacts,
} from './plan-readiness.js';
import {
  buildPlanSemanticEventCandidate,
  type PlanLivingPlanBillingOverlay,
  type PlanSemanticEventSink,
} from './plan-semantic-event.js';
import type {
  MarketingPlanCompileArtifact,
  MarketingPlanStore,
} from './plan-store.js';
import {
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
};

export type PlanCompilerQuotePort = {
  resolveQuote(input: {
    workspaceId: string;
    planId: string;
    planRevision: number;
    deliverables: PlanDeliverable[];
    harnessReleaseId: string;
    /** Server-admitted billing quote; never sourced from PlanProposal/model output. */
    billingQuoteRef?: AgentRevisionRef;
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

export type PlanCompilerRecipeSkillPort = {
  resolveRecipeSkills(input: {
    workspaceId: string;
    deliverables: PlanDeliverable[];
    harnessReleaseId: string;
    now: string;
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
  now?: string;
  /** Optional merchant billing overlay for Living Plan cost section (no invention). */
  livingPlanBilling?: PlanLivingPlanBillingOverlay;
  /** Server-admitted Composer billing quote to freeze into this plan revision. */
  billingQuoteRef?: AgentRevisionRef;
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

export type CompilePlanResult = {
  revision: MarketingPlanRevision;
  executionPlan: CompiledExecutionPlan;
  readiness: MarketingPlanReadiness;
  skillInvocationReceipts: SkillInvocationReceipt[];
  /** Cache keys for units that are cacheable (workspace + releaseId). */
  unitCacheKeys: Record<string, string>;
};

export class PlanCompilerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlanCompilerError';
    this.code = code;
  }
}

const CARRIER_TO_UNIT: Record<PlanDeliverable['kind'], string> = {
  copy: 'copy.generate',
  note: 'note.generate',
  media: 'media.generate',
};

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deliverableId(index: number, kind: string): string {
  return `d${index + 1}-${kind}`;
}

function unitId(value: string): ExecutionUnitId {
  return executionUnitIdSchema.parse(value);
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
    const nextRevision = latest ? latest.revision.revision + 1 : 1;

    const deliverables = this.buildDeliverables(proposal);
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
      }),
      this.ports.quote.resolveQuote({
        workspaceId: input.workspaceId,
        planId,
        planRevision: nextRevision,
        deliverables,
        harnessReleaseId: input.harnessReleaseId,
        ...(input.billingQuoteRef
          ? { billingQuoteRef: input.billingQuoteRef }
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

    const goalSummary =
      input.patch !== undefined
        ? `${proposal.goalNarrative} · 调整：${input.patch.summary}`.slice(
            0,
            2_000,
          )
        : proposal.goalNarrative;

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

    const { executionPlan, unitCacheKeys } = this.buildExecutionPlan({
      revision,
      workspaceId: input.workspaceId,
      deliverables,
    });

    // A18: reject any plan that would place side-effect units in conditionals.
    assertNoConditionalSideEffects(executionPlan, this.registry);

    const stored = await this.store.append({ revision, executionPlan });

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
      revision: stored.revision,
      facts: readinessFacts,
      now,
    });

    await this.emitPlanSemanticEvent({
      input,
      revision: stored.revision,
      readiness,
    });

    return {
      revision: stored.revision,
      executionPlan: stored.executionPlan,
      readiness,
      skillInvocationReceipts: recipeSkills.skillInvocationReceipts,
      unitCacheKeys,
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

  projectReadiness(input: {
    revision: MarketingPlanRevision;
    facts: PlanReadinessFacts;
    now: string;
  }): MarketingPlanReadiness {
    return projectMarketingPlanReadiness(input);
  }

  /**
   * After append-only store write: project plan.created (r1) or plan.revised (r>1).
   * Failures surface to caller — plan row already committed; projector is
   * idempotent on eventId so retry is safe.
   */
  private async emitPlanSemanticEvent(input: {
    input: CompilePlanInput;
    revision: MarketingPlanRevision;
    readiness: MarketingPlanReadiness;
  }): Promise<void> {
    if (!this.semanticEvents) return;
    const resourceId =
      input.input.resourceId?.trim() || input.input.workspaceId;
    const candidate = buildPlanSemanticEventCandidate({
      resourceId,
      revision: input.revision,
      readiness: input.readiness,
      adjustmentSummary: input.input.patch?.summary,
      billing: input.input.livingPlanBilling,
      correlationId: input.input.threadId,
      occurredAt: input.revision.createdAt,
    });
    await this.semanticEvents.project(candidate);
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

  private buildExecutionPlan(input: {
    revision: MarketingPlanRevision;
    workspaceId: string;
    deliverables: PlanDeliverable[];
  }): {
    executionPlan: CompiledExecutionPlan;
    unitCacheKeys: Record<string, string>;
  } {
    const units: ExecutionUnit[] = [];
    const unitCacheKeys: Record<string, string> = {};
    const boundedRetry: CompiledExecutionPlan['boundedRetry'] = {};
    const cachePolicies: NonNullable<CompiledExecutionPlan['cachePolicies']> =
      {};

    // Group 0: context read (parallel-safe, single unit)
    const contextUnitId = unitId('unit-context-read');
    const contextDef = this.registry.resolve('context.read');
    units.push({
      unitId: contextUnitId,
      unitType: contextDef.unitType,
      primitive: contextDef.primitive,
      input: {
        contextBundleId: input.revision.boundRevisions.contextBundleId,
        contextRevision: input.revision.boundRevisions.contextRevision,
      },
    });
    boundedRetry[contextUnitId] = defaultRetryOff();
    this.applyCachePolicy({
      unitId: contextUnitId,
      definition: contextDef,
      workspaceId: input.workspaceId,
      harnessReleaseId: input.revision.boundRevisions.harnessReleaseId,
      input: units[0]!.input,
      cachePolicies,
      unitCacheKeys,
    });

    // Group 1: generate units (one per deliverable quantity expanded lightly)
    const generateUnitIds: ExecutionUnitId[] = [];
    for (const deliverable of input.deliverables) {
      const unitType = CARRIER_TO_UNIT[deliverable.kind];
      const definition = this.registry.resolve(unitType);
      for (let i = 0; i < deliverable.quantity; i += 1) {
        const generateUnitId = unitId(
          `unit-${deliverable.deliverableId}-${i + 1}`,
        );
        const unitInput = {
          deliverableId: deliverable.deliverableId,
          kind: deliverable.kind,
          index: i,
          quoteRef: input.revision.quoteRef,
        };
        units.push({
          unitId: generateUnitId,
          unitType: definition.unitType,
          primitive: definition.primitive,
          input: unitInput,
        });
        boundedRetry[generateUnitId] = defaultRetryOff();
        this.applyCachePolicy({
          unitId: generateUnitId,
          definition,
          workspaceId: input.workspaceId,
          harnessReleaseId: input.revision.boundRevisions.harnessReleaseId,
          input: unitInput,
          cachePolicies,
          unitCacheKeys,
        });
        generateUnitIds.push(generateUnitId);
      }
    }

    // Group 2: compliance check
    const checkUnitId = unitId('unit-compliance-check');
    const checkDef = this.registry.resolve('compliance.check');
    units.push({
      unitId: checkUnitId,
      unitType: checkDef.unitType,
      primitive: checkDef.primitive,
      input: {
        rightsRevisionIds: input.revision.boundRevisions.rightsRevisionIds,
      },
    });
    boundedRetry[checkUnitId] = defaultRetryOff();
    this.applyCachePolicy({
      unitId: checkUnitId,
      definition: checkDef,
      workspaceId: input.workspaceId,
      harnessReleaseId: input.revision.boundRevisions.harnessReleaseId,
      input: units[units.length - 1]!.input,
      cachePolicies,
      unitCacheKeys,
    });

    const dependencyGroups = [
      { groupId: 'g-context', unitIds: [contextUnitId] },
      { groupId: 'g-generate', unitIds: generateUnitIds },
      { groupId: 'g-check', unitIds: [checkUnitId] },
    ];

    const executionPlan = compiledExecutionPlanSchema.parse({
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units,
      dependencyGroups,
      boundedRetry,
      ...(Object.keys(cachePolicies).length > 0
        ? { cachePolicies }
        : {}),
    });

    return { executionPlan, unitCacheKeys };
  }

  private applyCachePolicy(input: {
    unitId: string;
    definition: ExecutionUnitTypeDefinition;
    workspaceId: string;
    harnessReleaseId: string;
    input: unknown;
    cachePolicies: NonNullable<CompiledExecutionPlan['cachePolicies']>;
    unitCacheKeys: Record<string, string>;
  }) {
    if (!input.definition.cacheDefault.cacheable) {
      return;
    }
    const inputHash = sha256Hex(fingerprintValue(input.input ?? {}));
    const cacheKey = buildExecutionUnitCacheKey({
      workspaceId: input.workspaceId,
      unitType: input.definition.unitType,
      inputHash,
      harnessReleaseId: input.harnessReleaseId,
    });
    input.unitCacheKeys[input.unitId] = cacheKey;
    input.cachePolicies[input.unitId] = {
      ttlSeconds: input.definition.cacheDefault.ttlSeconds,
      scope: 'workspace',
      dependsOn: [...input.definition.cacheDefault.dependsOn],
    };
  }
}

function defaultRetryOff(): CompiledExecutionPlan['boundedRetry'][string] {
  // D-167③ / BLOCK-06: unit retry default off.
  return {
    maxAttempts: 1,
    maxCostCents: 0,
    retry: { enabled: false },
  };
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
          quoteRef: input.billingQuoteRef ?? {
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

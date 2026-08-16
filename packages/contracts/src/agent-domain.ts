/**
 * V3.1 Agent-domain contracts (V31-01).
 *
 * Ten domains: thread / run / goal / plan / memory / event / execution-plan /
 * release / steering / outcome. Shapes follow
 * docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md
 * §7–§10, §12.5, §13–§14.2, §21.2, §22.2, §23.3–§24, §26–§27, §29.
 *
 * Pure contract layer — no runtime, DB, or UI.
 */

import { z } from 'zod';

import { boundedExecutionSnapshotSchema } from './bounded-execution.js';
import {
  agentExecutionConfirmationRequestIdSchema,
  agentRunIdSchema,
  agentSemanticEventIdSchema,
  agentThreadIdSchema,
  executionUnitIdSchema,
  harnessReleaseIdSchema,
  identifierSchema,
  interruptIdSchema,
  marketingGoalIdSchema,
  marketingPlanIdSchema,
  memoryIdSchema,
  merchantResourceIdSchema,
  nonEmptyTrimmedStringSchema,
  outcomeEvidenceIdSchema,
  planConfirmationDecisionIdSchema,
  steeringCommandIdSchema,
} from './identifiers.js';

const timestampSchema = z.iso.datetime();
const revisionNumberSchema = z.number().int().nonnegative().safe();
const positiveRevisionSchema = z.number().int().positive().safe();
const hashStringSchema = nonEmptyTrimmedStringSchema.max(128);
const jsonValueSchema = z.json();

// ─── Shared refs ────────────────────────────────────────────────────────────

/** Opaque revision pointer (quote / policy / content package). */
export const agentRevisionRefSchema = z
  .object({
    id: identifierSchema,
    revision: z.union([revisionNumberSchema, nonEmptyTrimmedStringSchema]),
  })
  .strict();

export type AgentRevisionRef = z.infer<typeof agentRevisionRefSchema>;

/** Evidence pointer used by Goal / Memory / Outcome. */
export const agentEvidenceRefSchema = z
  .object({
    kind: nonEmptyTrimmedStringSchema.max(100),
    ref: nonEmptyTrimmedStringSchema.max(500),
  })
  .strict();

export type AgentEvidenceRef = z.infer<typeof agentEvidenceRefSchema>;

// ─── 1. Thread (V3.1 §9 + U6 sessionRevision) ───────────────────────────────

export const AGENT_THREAD_SCHEMA_VERSION = 'agent-thread/v1' as const;

export const agentThreadStatusSchema = z.enum(['active', 'archived']);

export const agentThreadSchema = z
  .object({
    schemaVersion: z.literal(AGENT_THREAD_SCHEMA_VERSION),
    threadId: agentThreadIdSchema,
    resourceId: merchantResourceIdSchema,
    title: nonEmptyTrimmedStringSchema.max(500),
    status: agentThreadStatusSchema,
    activeGoalIds: z.array(marketingGoalIdSchema).max(50),
    /** Summary compaction generation — does not participate in OCC. */
    summaryRevision: revisionNumberSchema,
    /**
     * OCC cursor for single active write turn (U6). Independent column from
     * summaryRevision — summary updates must not arbitrate concurrency.
     */
    sessionRevision: revisionNumberSchema,
    summary: nonEmptyTrimmedStringSchema.max(8_000).optional(),
    lastRunAt: timestampSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type AgentThread = z.infer<typeof agentThreadSchema>;

// ─── 2. Run (V3.1 §10 + durability/executionLink) ───────────────────────────

export const AGENT_RUN_SCHEMA_VERSION = 'agent-run/v1' as const;

export const agentRunTriggerSchema = z.enum([
  'merchant_turn',
  'proactive_signal',
  'follow_up',
  'system_resume',
]);

export const agentRunStatusSchema = z.enum([
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);

export const agentRunDurabilitySchema = z.enum(['exit', 'sync']);

/**
 * Session run → DBOS execution link. Required when durability=sync; immutable
 * after create (parentRunId + workflowId + snapshotHash association).
 */
export const agentRunExecutionLinkSchema = z
  .object({
    workflowId: identifierSchema,
    snapshotHash: hashStringSchema,
  })
  .strict();

export type AgentRunExecutionLink = z.infer<typeof agentRunExecutionLinkSchema>;

export const agentRunSchema = z
  .object({
    schemaVersion: z.literal(AGENT_RUN_SCHEMA_VERSION),
    runId: agentRunIdSchema,
    threadId: agentThreadIdSchema,
    parentRunId: agentRunIdSchema.optional(),
    trigger: agentRunTriggerSchema,
    status: agentRunStatusSchema,
    /**
     * Immutable after create. exit = read-only session turn; sync = paid-side
     * effect child run linked to DBOS via executionLink.
     */
    durability: agentRunDurabilitySchema,
    harnessReleaseId: harnessReleaseIdSchema,
    /**
     * Present iff durability=sync. Creation-time immutable link to workflow +
     * frozen ExecutionPlanSnapshot hash.
     */
    executionLink: agentRunExecutionLinkSchema.optional(),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.optional(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.durability === 'sync' && !run.executionLink) {
      context.addIssue({
        code: 'custom',
        message:
          'sync AgentRun requires immutable executionLink (workflowId + snapshotHash).',
        path: ['executionLink'],
      });
    }
    if (run.durability === 'exit' && run.executionLink) {
      context.addIssue({
        code: 'custom',
        message: 'exit AgentRun must not carry executionLink (no paid side effects).',
        path: ['executionLink'],
      });
    }
  });

export type AgentRun = z.infer<typeof agentRunSchema>;

// ─── 3. Goal (V3.1 §11) ─────────────────────────────────────────────────────

export const MARKETING_GOAL_SCHEMA_VERSION = 'marketing-goal/v1' as const;

export const marketingGoalObjectiveSchema = z.enum([
  'exposure',
  'inquiry',
  'booking',
  'group_buy',
  'ip_growth',
  'retention',
  'custom',
]);

export type MarketingGoalObjective = z.infer<
  typeof marketingGoalObjectiveSchema
>;

export const marketingGoalPrioritySchema = z.enum(['low', 'normal', 'high']);

export type MarketingGoalPriority = z.infer<typeof marketingGoalPrioritySchema>;

export const marketingGoalStatusSchema = z.enum([
  'active',
  'paused',
  'completed',
  'abandoned',
]);

export type MarketingGoalStatus = z.infer<typeof marketingGoalStatusSchema>;

export const marketingGoalSchema = z
  .object({
    schemaVersion: z.literal(MARKETING_GOAL_SCHEMA_VERSION),
    goalId: marketingGoalIdSchema,
    resourceId: merchantResourceIdSchema,
    objective: marketingGoalObjectiveSchema,
    statement: nonEmptyTrimmedStringSchema.max(2_000),
    horizon: z
      .object({
        from: timestampSchema.optional(),
        until: timestampSchema.optional(),
      })
      .strict()
      .optional(),
    priority: marketingGoalPrioritySchema,
    status: marketingGoalStatusSchema,
    evidenceRefs: z.array(agentEvidenceRefSchema).max(100),
    revision: revisionNumberSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type MarketingGoal = z.infer<typeof marketingGoalSchema>;

/**
 * Goal product surface commands (V31-24 / V3.1 §11).
 * Create / attach / status migration all go propose → merchant confirm.
 * Status confirm uses revision OCC; conflict returns current revision.
 */
export const MARKETING_GOAL_PROPOSAL_SCHEMA_VERSION =
  'marketing-goal-proposal/v1' as const;

export const marketingGoalProposalKindSchema = z.enum([
  'create',
  'attach_works',
  'status_transition',
]);

export const marketingGoalCreateDraftSchema = z
  .object({
    objective: marketingGoalObjectiveSchema,
    statement: nonEmptyTrimmedStringSchema.max(2_000),
    horizon: z
      .object({
        from: timestampSchema.optional(),
        until: timestampSchema.optional(),
      })
      .strict()
      .optional(),
    priority: marketingGoalPrioritySchema.default('normal'),
    evidenceRefs: z.array(agentEvidenceRefSchema).max(100).default([]),
  })
  .strict();

export type MarketingGoalCreateDraft = z.infer<
  typeof marketingGoalCreateDraftSchema
>;

export const marketingGoalProposalSchema = z
  .object({
    schemaVersion: z.literal(MARKETING_GOAL_PROPOSAL_SCHEMA_VERSION),
    proposalId: identifierSchema,
    resourceId: merchantResourceIdSchema,
    kind: marketingGoalProposalKindSchema,
    /** Present for attach_works / status_transition. */
    goalId: marketingGoalIdSchema.optional(),
    /** create draft when kind=create. */
    create: marketingGoalCreateDraftSchema.optional(),
    /** Work / content package ids proposed for attach_works. */
    workRefs: z.array(identifierSchema).max(50).optional(),
    /** Target status when kind=status_transition. */
    nextStatus: marketingGoalStatusSchema.optional(),
    /** OCC cursor expected on confirm (status_transition / attach may omit for create). */
    expectedRevision: revisionNumberSchema.optional(),
    why: nonEmptyTrimmedStringSchema.max(2_000).optional(),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.kind === 'create' && !proposal.create) {
      context.addIssue({
        code: 'custom',
        message: 'create proposal requires create draft.',
        path: ['create'],
      });
    }
    if (proposal.kind !== 'create' && !proposal.goalId) {
      context.addIssue({
        code: 'custom',
        message: `${proposal.kind} proposal requires goalId.`,
        path: ['goalId'],
      });
    }
    if (proposal.kind === 'attach_works' && (!proposal.workRefs || proposal.workRefs.length === 0)) {
      context.addIssue({
        code: 'custom',
        message: 'attach_works proposal requires workRefs.',
        path: ['workRefs'],
      });
    }
    if (proposal.kind === 'status_transition' && !proposal.nextStatus) {
      context.addIssue({
        code: 'custom',
        message: 'status_transition proposal requires nextStatus.',
        path: ['nextStatus'],
      });
    }
  });

export type MarketingGoalProposal = z.infer<typeof marketingGoalProposalSchema>;

/** Progress is a projection over delivered Work + OutcomeEvidence — not a new truth. */
export const marketingGoalProgressSchema = z
  .object({
    goalId: marketingGoalIdSchema,
    resourceId: merchantResourceIdSchema,
    status: marketingGoalStatusSchema,
    priority: marketingGoalPrioritySchema,
    statement: nonEmptyTrimmedStringSchema.max(2_000),
    deliveredWorkCount: z.number().int().nonnegative().safe(),
    evidenceCount: z.number().int().nonnegative().safe(),
    lastDeliveredAt: timestampSchema.optional(),
    lastEvidenceAt: timestampSchema.optional(),
  })
  .strict();

export type MarketingGoalProgress = z.infer<typeof marketingGoalProgressSchema>;

// ─── 3b. Proactive Opportunity (V3.1 §25 / V31-24) ───────────────────────────

export const OPPORTUNITY_CANDIDATE_SCHEMA_VERSION =
  'opportunity-candidate/v1' as const;

export const opportunityCandidateStatusSchema = z.enum([
  'proposed',
  'accepted',
  'dismissed',
  'expired',
]);

export type OpportunityCandidateStatus = z.infer<
  typeof opportunityCandidateStatusSchema
>;

/**
 * Derived projection only — not a core aggregate, no candidate table.
 * status is computed: detector output + latest decision + expiresAt clock.
 */
export const opportunityCandidateSchema = z
  .object({
    schemaVersion: z.literal(OPPORTUNITY_CANDIDATE_SCHEMA_VERSION),
    candidateId: identifierSchema,
    resourceId: merchantResourceIdSchema,
    goalId: marketingGoalIdSchema.optional(),
    /** Merchant-facing "why now" line — required for every proactive suggestion. */
    reason: nonEmptyTrimmedStringSchema.max(2_000),
    evidenceRefs: z.array(agentEvidenceRefSchema).min(1).max(50),
    signalKinds: z.array(nonEmptyTrimmedStringSchema.max(100)).max(20).default([]),
    expiresAt: timestampSchema.optional(),
    status: opportunityCandidateStatusSchema,
    rankScore: z.number().finite().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export type OpportunityCandidate = z.infer<typeof opportunityCandidateSchema>;

/**
 * Minimal append-only decision log (narrow reading of §33.1:
 * forbids candidate aggregate table, not the decision log).
 * accept idempotency key = candidateId (one Thread turn per accept).
 */
export const OPPORTUNITY_DECISION_SCHEMA_VERSION =
  'opportunity-decision/v1' as const;

export const opportunityDecisionKindSchema = z.enum(['accepted', 'dismissed']);

export const opportunityDecisionSchema = z
  .object({
    schemaVersion: z.literal(OPPORTUNITY_DECISION_SCHEMA_VERSION),
    decisionId: identifierSchema,
    candidateId: identifierSchema,
    resourceId: merchantResourceIdSchema,
    actorId: nonEmptyTrimmedStringSchema.max(200),
    decision: opportunityDecisionKindSchema,
    decidedAt: timestampSchema,
    /** Set when decision=accepted — the single Thread turn created for this accept. */
    threadId: agentThreadIdSchema.optional(),
    runId: agentRunIdSchema.optional(),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.decision === 'accepted' && !row.threadId) {
      context.addIssue({
        code: 'custom',
        message: 'accepted decision must bind the created Thread turn (threadId).',
        path: ['threadId'],
      });
    }
  });

export type OpportunityDecision = z.infer<typeof opportunityDecisionSchema>;

/** Owned signal kinds for the proactive detector (V3.1 §25). */
export const PROACTIVE_SIGNAL_KINDS = [
  'unpublished_duration',
  'campaign_approaching',
  'asset_accumulation',
  'project_added',
  'goal_stalled',
  'historical_performance',
  'merchant_hot_topic',
] as const;

export type ProactiveSignalKind = (typeof PROACTIVE_SIGNAL_KINDS)[number];

export const proactiveSignalSchema = z
  .object({
    kind: z.enum(PROACTIVE_SIGNAL_KINDS),
    resourceId: merchantResourceIdSchema,
    observedAt: timestampSchema,
    summary: nonEmptyTrimmedStringSchema.max(500),
    evidenceRefs: z.array(agentEvidenceRefSchema).min(1).max(20),
    goalId: marketingGoalIdSchema.optional(),
    weight: z.number().finite().nonnegative().default(1),
  })
  .strict();

export type ProactiveSignal = z.infer<typeof proactiveSignalSchema>;

// ─── 4. Plan revision (V3.1 §13) ─────────────────────────────────────────────

export const MARKETING_PLAN_REVISION_SCHEMA_VERSION =
  'marketing-plan-revision/v1' as const;

export const marketingPlanScopeSchema = z.enum([
  'single_work',
  'multi_work',
  'campaign',
]);

export const planDeliverableCarrierSchema = z.enum(['copy', 'note', 'media']);

export const planDeliverableSchema = z
  .object({
    deliverableId: identifierSchema,
    kind: planDeliverableCarrierSchema,
    platform: nonEmptyTrimmedStringSchema.max(100).optional(),
    quantity: z.number().int().positive().max(50),
    purpose: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();

export type PlanDeliverable = z.infer<typeof planDeliverableSchema>;

/** Intent as frozen on a plan revision (compiler-owned fields). */
export const intentDeclarationSchema = z
  .object({
    summary: nonEmptyTrimmedStringSchema.max(2_000),
    normalizedGoal: nonEmptyTrimmedStringSchema.max(2_000).optional(),
    desiredActions: z.array(nonEmptyTrimmedStringSchema.max(500)).max(20).optional(),
    platformHints: z.array(nonEmptyTrimmedStringSchema.max(100)).max(20).optional(),
    assumptions: z
      .array(
        z
          .object({
            key: nonEmptyTrimmedStringSchema.max(100),
            statement: nonEmptyTrimmedStringSchema.max(1_000),
            risk: z.enum(['low', 'medium', 'high']).optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export type IntentDeclaration = z.infer<typeof intentDeclarationSchema>;

export const planMemoryContextSchema = z
  .object({
    receiptRef: z
      .object({
        taskId: identifierSchema,
        runId: agentRunIdSchema,
        harnessReleaseId: harnessReleaseIdSchema,
      })
      .strict(),
    entries: z
      .array(
        z
          .object({
            memoryId: memoryIdSchema,
            revision: revisionNumberSchema,
          })
          .strict(),
      )
      .max(100),
    styleConstraints: z
      .object({
        tones: z.array(z.enum(['concise', 'restrained'])).max(2),
        maxTitleChars: z.number().int().positive().max(500),
        maxBodyChars: z.number().int().positive().max(4_000),
        maxSentenceChars: z.number().int().positive().max(500),
        forbiddenPhrases: z.array(nonEmptyTrimmedStringSchema.max(100)).max(20),
      })
      .strict(),
    /**
     * Confirmed preferences that produced no constraint above.
     *
     * `entries` says which memories were referenced; it has never said whether
     * their content reached the model. The compiler recognises two intents
     * (concise, restrained) and everything else is dropped on the floor, so a
     * merchant who said 「别用感叹号」 gets a receipt that reads as injected and a
     * brief that never heard it. Carrying the misses makes injection coverage
     * measurable instead of assumed, and gives the recognisers a regression
     * baseline the next time they are widened.
     *
     * `undefined` and `[]` are different facts and must not be merged: absent
     * means the revision predates coverage tracking, empty means every
     * confirmed preference was translated.
     */
    unmapped: z
      .array(
        z
          .object({
            memoryId: memoryIdSchema,
            statement: z.string().max(4_000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export type PlanMemoryContext = z.infer<typeof planMemoryContextSchema>;

export const marketingPlanRevisionSchema = z
  .object({
    schemaVersion: z.literal(MARKETING_PLAN_REVISION_SCHEMA_VERSION),
    planId: marketingPlanIdSchema,
    revision: positiveRevisionSchema,
    threadId: agentThreadIdSchema,
    goalIds: z.array(marketingGoalIdSchema).max(50),
    scope: marketingPlanScopeSchema,
    // No lifecycle status column — append-only; readiness is projection (BLOCK-07).
    intent: intentDeclarationSchema,
    /** Exact confirmed-memory inputs and their durable injection receipt binding. */
    memoryContext: planMemoryContextSchema.nullable().optional(),
    goal: z
      .object({
        summary: nonEmptyTrimmedStringSchema.max(2_000),
        whyNow: nonEmptyTrimmedStringSchema.max(2_000).nullable(),
        desiredAction: nonEmptyTrimmedStringSchema.max(2_000),
      })
      .strict(),
    deliverables: z.array(planDeliverableSchema).min(1).max(50),
    expression: z
      .object({
        voice: nonEmptyTrimmedStringSchema.max(500).optional(),
        openingMechanism: nonEmptyTrimmedStringSchema.max(500).optional(),
        narrativeStructure: nonEmptyTrimmedStringSchema.max(500).optional(),
        promotionIntensity: nonEmptyTrimmedStringSchema.max(100).optional(),
        cta: nonEmptyTrimmedStringSchema.max(500).optional(),
      })
      .strict(),
    factUsages: z.array(jsonValueSchema).max(200),
    assetUsages: z.array(jsonValueSchema).max(200),
    rightsSummary: jsonValueSchema,
    complianceSummary: jsonValueSchema,
    capabilitySummary: jsonValueSchema,
    /** Quote revision reference only — amounts live in billing domain. */
    quoteRef: agentRevisionRefSchema,
    boundRevisions: z
      .object({
        intentRevision: revisionNumberSchema,
        contextBundleId: identifierSchema,
        contextRevision: nonEmptyTrimmedStringSchema,
        recipeRevisionIds: z.array(identifierSchema).max(50),
        catalogRevisionId: identifierSchema,
        modelRevisionIds: z.array(identifierSchema).max(50),
        sourceRevisionIds: z.array(identifierSchema).max(50),
        rightsRevisionIds: z.array(identifierSchema).max(50),
        harnessReleaseId: harnessReleaseIdSchema,
      })
      .strict(),
    contentHash: hashStringSchema,
    expiresAt: timestampSchema,
    createdAt: timestampSchema,
  })
  .strict();

export type MarketingPlanRevision = z.infer<typeof marketingPlanRevisionSchema>;

/** Readiness is always a projection — never stored as plan lifecycle state. */
export const marketingPlanReadinessSchema = z.enum([
  'ready',
  'stale',
  'blocked',
  'reprice_required',
]);

export type MarketingPlanReadiness = z.infer<typeof marketingPlanReadinessSchema>;

// ─── 5. Memory (V3.1 §12.5) ─────────────────────────────────────────────────

export const AGENT_MEMORY_ENTRY_SCHEMA_VERSION = 'agent-memory-entry/v1' as const;

export const agentMemoryKindSchema = z.enum([
  'working',
  'preference',
  'episode',
  'procedure',
  'correction',
]);

export const agentMemoryAuthoritySchema = z.enum([
  'observation',
  'session',
  'strong',
  'confirmed',
]);

export const agentMemoryStateSchema = z.enum([
  'active',
  'proposed',
  'superseded',
  'revoked',
  'expired',
]);

export const agentMemoryScopeSchema = z
  .object({
    storeId: identifierSchema.optional(),
    personaId: identifierSchema.optional(),
    scene: identifierSchema.optional(),
    platform: identifierSchema.optional(),
  })
  .strict();

export type AgentMemoryScope = z.infer<typeof agentMemoryScopeSchema>;

export const agentMemoryEntrySchema = z
  .object({
    schemaVersion: z.literal(AGENT_MEMORY_ENTRY_SCHEMA_VERSION),
    memoryId: memoryIdSchema,
    resourceId: merchantResourceIdSchema,
    kind: agentMemoryKindSchema,
    scope: agentMemoryScopeSchema,
    authority: agentMemoryAuthoritySchema,
    state: agentMemoryStateSchema,
    statement: nonEmptyTrimmedStringSchema.max(4_000),
    evidenceRefs: z.array(agentEvidenceRefSchema).max(100),
    confidence: z.number().min(0).max(1),
    effectiveFrom: timestampSchema,
    expiresAt: timestampSchema.optional(),
    revision: revisionNumberSchema,
  })
  .strict();

export type AgentMemoryEntry = z.infer<typeof agentMemoryEntrySchema>;

export const MEMORY_INJECTION_RECEIPT_SCHEMA_VERSION =
  'memory-injection-receipt/v1' as const;

/** Trace projection: which memories were injected into a run/task (MAJOR-12). */
export const memoryInjectionReceiptSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_INJECTION_RECEIPT_SCHEMA_VERSION),
    taskId: identifierSchema,
    runId: agentRunIdSchema,
    harnessReleaseId: harnessReleaseIdSchema,
    entries: z
      .array(
        z
          .object({
            memoryId: memoryIdSchema,
            statement: nonEmptyTrimmedStringSchema.max(4_000),
            revision: revisionNumberSchema,
            /** Optional on put-once v1 rows written before source projection. */
            source: z
              .object({
                preview: nonEmptyTrimmedStringSchema.max(500).optional(),
                observedAt: timestampSchema.optional(),
                deleted: z.boolean(),
              })
              .strict()
              .optional(),
            /**
             * V31-34 / FIX-P1-02: read-time authority only. Never persisted as
             * the receipt identity — derived from the workspace preference head
             * so the panel survives refresh without local mutation state.
             */
            currentStatus: z
              .enum(['confirmed', 'revoked', 'superseded', 'unavailable'])
              .optional(),
          })
          .strict(),
      )
      .max(100),
    injectedAt: timestampSchema,
  })
  .strict();

export type MemoryInjectionReceipt = z.infer<typeof memoryInjectionReceiptSchema>;

// ─── 6. Event (V3.1 §27) ────────────────────────────────────────────────────

export const AGENT_SEMANTIC_EVENT_SCHEMA_VERSION =
  'agent-semantic-event/v1' as const;

export const agentEventContextRoleSchema = z.enum([
  'included',
  'excluded',
  'summarized',
]);

export const AGENT_SEMANTIC_EVENT_TYPES = [
  'run.started',
  'message.final',
  'activity.snapshot',
  'goal.updated',
  'plan.created',
  'plan.revised',
  'interrupt.requested',
  'interrupt.resolved',
  'artifact.revised',
  'memory.proposed',
  'memory.promoted',
  'work.waiting',
  'work.delivered',
  'outcome.recorded',
] as const;

export const agentSemanticEventTypeSchema = z.enum(AGENT_SEMANTIC_EVENT_TYPES);

/**
 * Domain schema: streamOffset is bigint (per-thread monotonic).
 * Wire schema uses decimal string — see agentSemanticEventWireSchema.
 */
export const agentSemanticEventSchema = z
  .object({
    schemaVersion: z.literal(AGENT_SEMANTIC_EVENT_SCHEMA_VERSION),
    eventId: agentSemanticEventIdSchema,
    threadId: agentThreadIdSchema,
    streamOffset: z.bigint(),
    contextRole: agentEventContextRoleSchema,
    sourceDomain: nonEmptyTrimmedStringSchema.max(100),
    sourceEntityId: identifierSchema,
    sourceRevision: nonEmptyTrimmedStringSchema.max(200),
    correlationId: identifierSchema,
    causationId: identifierSchema.optional(),
    eventType: z.union([
      agentSemanticEventTypeSchema,
      nonEmptyTrimmedStringSchema.max(100),
    ]),
    payload: jsonValueSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export type AgentSemanticEvent = z.infer<typeof agentSemanticEventSchema>;

/** Decimal-string streamOffset for JSON/SSE (MAJOR-02). Compare numerically. */
export const agentSemanticEventWireSchema = z
  .object({
    schemaVersion: z.literal(AGENT_SEMANTIC_EVENT_SCHEMA_VERSION),
    eventId: agentSemanticEventIdSchema,
    threadId: agentThreadIdSchema,
    streamOffset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/u, 'streamOffset wire must be non-negative decimal'),
    contextRole: agentEventContextRoleSchema,
    sourceDomain: nonEmptyTrimmedStringSchema.max(100),
    sourceEntityId: identifierSchema,
    sourceRevision: nonEmptyTrimmedStringSchema.max(200),
    correlationId: identifierSchema,
    causationId: identifierSchema.optional(),
    eventType: z.union([
      agentSemanticEventTypeSchema,
      nonEmptyTrimmedStringSchema.max(100),
    ]),
    payload: jsonValueSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export type AgentSemanticEventWire = z.infer<typeof agentSemanticEventWireSchema>;

export const AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION =
  'agent-ephemeral-event/v1' as const;

/**
 * Ephemeral frames are emitter-side transient=true and never persist.
 * Not part of recovery correctness.
 */
export const agentEphemeralEventWireSchema = z
  .object({
    schemaVersion: z.literal(AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION),
    eventId: identifierSchema,
    threadId: agentThreadIdSchema,
    runId: agentRunIdSchema.optional(),
    eventType: nonEmptyTrimmedStringSchema.max(100),
    payload: jsonValueSchema,
    occurredAt: timestampSchema,
    /** Emission-side mark: never write to PostgreSQL (B2). */
    transient: z.literal(true),
  })
  .strict();

export type AgentEphemeralEventWire = z.infer<typeof agentEphemeralEventWireSchema>;

export function agentSemanticEventToWire(
  event: AgentSemanticEvent,
): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    ...event,
    streamOffset: event.streamOffset.toString(),
  });
}

export function agentSemanticEventFromWire(
  wire: AgentSemanticEventWire,
): AgentSemanticEvent {
  return agentSemanticEventSchema.parse({
    ...wire,
    streamOffset: BigInt(wire.streamOffset),
  });
}

/** Compare wire cursors by numeric order (not lexicographic). */
export function compareStreamOffsetWire(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// ─── 6b. Artifact protocol (V3.1 §5.5 / §27.5, V31-15) ───────────────────────
//
// Wire = discriminated union snapshot|delta. Payload of semantic event
// `artifact.revised`. Patch schemas are controlled by artifactType (not unknown).
// Reconciliation: same artifactId in-place; same revision idempotent; skip
// revision → needs_snapshot; ready content never silent-overwritten (derived).

export const ARTIFACT_UPDATE_SCHEMA_VERSION = 'artifact-update/v1' as const;

export const artifactTypeSchema = z.enum([
  'plan',
  'copy',
  'note',
  'image',
  'video',
  'publish',
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const artifactStatusSchema = z.enum([
  'skeleton',
  'partial',
  'ready',
  'failed',
]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const artifactMediaStageSchema = z.enum([
  'pending',
  'generating',
  'ready',
  'failed',
]);

/** Note page: skeleton → copy → image status (V3.1 §5.5). */
export const notePageStateSchema = z
  .object({
    pageIndex: z.number().int().nonnegative().max(50),
    stage: z.enum(['skeleton', 'copy', 'image']),
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
    body: z.string().max(8_000).optional(),
    imageStatus: artifactMediaStageSchema.optional(),
    imageRef: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();
export type NotePageState = z.infer<typeof notePageStateSchema>;

/** Video scene: storyboard / keyframe only (V3.1 §5.5; V31-37 path A / V31-60). */
export const videoSceneStateSchema = z
  .object({
    sceneIndex: z.number().int().nonnegative().max(200),
    storyboard: z.string().max(4_000).optional(),
    keyframeStatus: artifactMediaStageSchema.optional(),
    keyframeRef: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();
export type VideoSceneState = z.infer<typeof videoSceneStateSchema>;

export const copyBlockStateSchema = z
  .object({
    blockId: identifierSchema,
    role: z.enum(['title', 'body', 'topic', 'cta', 'other']),
    text: z.string().max(8_000).optional(),
    status: z.enum(['skeleton', 'partial', 'ready', 'failed']).optional(),
  })
  .strict();
export type CopyBlockState = z.infer<typeof copyBlockStateSchema>;

export const planSectionStateSchema = z
  .object({
    sectionId: identifierSchema,
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
    body: z.string().max(8_000).optional(),
    status: z.enum(['skeleton', 'partial', 'ready', 'failed']).optional(),
  })
  .strict();
export type PlanSectionState = z.infer<typeof planSectionStateSchema>;

export const publishItemStateSchema = z
  .object({
    itemId: identifierSchema,
    label: nonEmptyTrimmedStringSchema.max(200),
    ready: z.boolean(),
  })
  .strict();
export type PublishItemState = z.infer<typeof publishItemStateSchema>;

export const noteArtifactFullSchema = z
  .object({
    pages: z.array(notePageStateSchema).max(50),
  })
  .strict();

export const videoArtifactFullSchema = z
  .object({
    scenes: z.array(videoSceneStateSchema).max(200),
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();

export const copyArtifactFullSchema = z
  .object({
    blocks: z.array(copyBlockStateSchema).max(50),
  })
  .strict();

export const planArtifactFullSchema = z
  .object({
    sections: z.array(planSectionStateSchema).max(50),
  })
  .strict();

export const imageArtifactFullSchema = z
  .object({
    imageStatus: artifactMediaStageSchema,
    imageRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    caption: z.string().max(2_000).optional(),
  })
  .strict();

export const publishArtifactFullSchema = z
  .object({
    items: z.array(publishItemStateSchema).max(50),
  })
  .strict();

export const artifactFullBodySchema = z.union([
  noteArtifactFullSchema,
  videoArtifactFullSchema,
  copyArtifactFullSchema,
  planArtifactFullSchema,
  imageArtifactFullSchema,
  publishArtifactFullSchema,
]);
export type ArtifactFullBody = z.infer<typeof artifactFullBodySchema>;

/** Partial page upsert keyed by pageIndex. */
export const notePagePatchSchema = notePageStateSchema
  .partial()
  .required({ pageIndex: true })
  .strict();

export const noteArtifactPatchSchema = z
  .object({
    pages: z.array(notePagePatchSchema).min(1).max(50).optional(),
  })
  .strict();

export const videoScenePatchSchema = videoSceneStateSchema
  .partial()
  .required({ sceneIndex: true })
  .strict();

export const videoArtifactPatchSchema = z
  .object({
    scenes: z.array(videoScenePatchSchema).min(1).max(200).optional(),
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();

export const copyArtifactPatchSchema = z
  .object({
    blocks: z.array(copyBlockStateSchema).min(1).max(50).optional(),
  })
  .strict();

export const planArtifactPatchSchema = z
  .object({
    sections: z.array(planSectionStateSchema).min(1).max(50).optional(),
  })
  .strict();

export const imageArtifactPatchSchema = z
  .object({
    imageStatus: artifactMediaStageSchema.optional(),
    imageRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    caption: z.string().max(2_000).optional(),
  })
  .strict();

export const publishArtifactPatchSchema = z
  .object({
    items: z.array(publishItemStateSchema).min(1).max(50).optional(),
  })
  .strict();

export const artifactPatchBodySchema = z.union([
  noteArtifactPatchSchema,
  videoArtifactPatchSchema,
  copyArtifactPatchSchema,
  planArtifactPatchSchema,
  imageArtifactPatchSchema,
  publishArtifactPatchSchema,
]);
export type ArtifactPatchBody = z.infer<typeof artifactPatchBodySchema>;

const artifactUpdateSharedFields = {
  schemaVersion: z.literal(ARTIFACT_UPDATE_SCHEMA_VERSION),
  artifactId: identifierSchema,
  artifactType: artifactTypeSchema,
  /** Monotonic per artifactId; same value re-apply is idempotent. */
  revision: positiveRevisionSchema,
  status: artifactStatusSchema,
  summary: nonEmptyTrimmedStringSchema.max(500).optional(),
  /**
   * When advancing past a ready head, producer must set parentRevision to the
   * ready revision (derived version). Missing parentRevision = silent overwrite
   * and is rejected by applyArtifactUpdate.
   */
  parentRevision: positiveRevisionSchema.optional(),
};

function fullMatchesType(
  artifactType: ArtifactType,
  full: ArtifactFullBody,
): boolean {
  switch (artifactType) {
    case 'note':
      return 'pages' in full && !('scenes' in full) && !('blocks' in full);
    case 'video':
      return 'scenes' in full;
    case 'copy':
      return 'blocks' in full && !('pages' in full);
    case 'plan':
      return 'sections' in full;
    case 'image':
      return 'imageStatus' in full && !('pages' in full) && !('scenes' in full);
    case 'publish':
      return 'items' in full;
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return false;
    }
  }
}

function patchMatchesType(
  artifactType: ArtifactType,
  patch: ArtifactPatchBody,
): boolean {
  switch (artifactType) {
    case 'note':
      return 'pages' in patch || Object.keys(patch).length === 0;
    case 'video':
      return 'scenes' in patch || 'title' in patch || Object.keys(patch).length === 0;
    case 'copy':
      return 'blocks' in patch || Object.keys(patch).length === 0;
    case 'plan':
      return 'sections' in patch || Object.keys(patch).length === 0;
    case 'image':
      return (
        'imageStatus' in patch ||
        'imageRef' in patch ||
        'caption' in patch ||
        Object.keys(patch).length === 0
      );
    case 'publish':
      return 'items' in patch || Object.keys(patch).length === 0;
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return false;
    }
  }
}

export const artifactUpdateSnapshotSchema = z
  .object({
    ...artifactUpdateSharedFields,
    mode: z.literal('snapshot'),
    full: artifactFullBodySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!fullMatchesType(value.artifactType, value.full)) {
      context.addIssue({
        code: 'custom',
        message: `snapshot full body does not match artifactType=${value.artifactType}`,
        path: ['full'],
      });
    }
  });

export const artifactUpdateDeltaSchema = z
  .object({
    ...artifactUpdateSharedFields,
    mode: z.literal('delta'),
    /** Client head revision this delta expects; mismatch → needs_snapshot. */
    baseRevision: revisionNumberSchema,
    patch: artifactPatchBodySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!patchMatchesType(value.artifactType, value.patch)) {
      context.addIssue({
        code: 'custom',
        message: `delta patch does not match artifactType=${value.artifactType}`,
        path: ['patch'],
      });
    }
    if (value.baseRevision >= value.revision) {
      context.addIssue({
        code: 'custom',
        message: 'delta baseRevision must be < revision',
        path: ['baseRevision'],
      });
    }
  });

/** Discriminated wire union for ArtifactUpdate (MAJOR-08 / V31-15). */
export const artifactUpdateWireSchema = z.discriminatedUnion('mode', [
  artifactUpdateSnapshotSchema,
  artifactUpdateDeltaSchema,
]);
export type ArtifactUpdateWire = z.infer<typeof artifactUpdateWireSchema>;

/** Immutable ready/failed head kept for version browse. */
export type ArtifactVersionRecord = {
  revision: number;
  status: ArtifactStatus;
  body: ArtifactFullBody;
  summary?: string;
  parentRevision?: number;
};

/** Client/core projection after reconciliation (stable artifactId). */
export type ArtifactProjectionState = {
  artifactId: string;
  artifactType: ArtifactType;
  revision: number;
  status: ArtifactStatus;
  body: ArtifactFullBody;
  summary?: string;
  parentRevision?: number;
  /** Completed (ready/failed) heads retained for version 回看. */
  versionHistory: ArtifactVersionRecord[];
};

export type ApplyArtifactUpdateFailureReason =
  | 'needs_snapshot'
  | 'silent_overwrite'
  | 'type_mismatch'
  | 'invalid_patch';

export type ApplyArtifactUpdateResult =
  | { ok: true; state: ArtifactProjectionState; duplicate: boolean }
  | {
      ok: false;
      reason: ApplyArtifactUpdateFailureReason;
      detail?: string;
    };

function emptyBodyForType(artifactType: ArtifactType): ArtifactFullBody {
  switch (artifactType) {
    case 'note':
      return { pages: [] };
    case 'video':
      return { scenes: [] };
    case 'copy':
      return { blocks: [] };
    case 'plan':
      return { sections: [] };
    case 'image':
      return { imageStatus: 'pending' };
    case 'publish':
      return { items: [] };
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return { pages: [] };
    }
  }
}

function mergeNotePages(
  current: NotePageState[],
  patches: Array<z.infer<typeof notePagePatchSchema>>,
): NotePageState[] {
  const byIndex = new Map<number, NotePageState>();
  for (const page of current) {
    byIndex.set(page.pageIndex, page);
  }
  for (const patch of patches) {
    const prev = byIndex.get(patch.pageIndex);
    const next: NotePageState = {
      pageIndex: patch.pageIndex,
      stage: patch.stage ?? prev?.stage ?? 'skeleton',
      title: patch.title ?? prev?.title,
      body: patch.body ?? prev?.body,
      imageStatus: patch.imageStatus ?? prev?.imageStatus,
      imageRef: patch.imageRef ?? prev?.imageRef,
    };
    byIndex.set(patch.pageIndex, notePageStateSchema.parse(next));
  }
  return [...byIndex.values()].sort((a, b) => a.pageIndex - b.pageIndex);
}

function mergeVideoScenes(
  current: VideoSceneState[],
  patches: Array<z.infer<typeof videoScenePatchSchema>>,
): VideoSceneState[] {
  const byIndex = new Map<number, VideoSceneState>();
  for (const scene of current) {
    byIndex.set(scene.sceneIndex, scene);
  }
  for (const patch of patches) {
    const prev = byIndex.get(patch.sceneIndex);
    const next: VideoSceneState = {
      sceneIndex: patch.sceneIndex,
      storyboard: patch.storyboard ?? prev?.storyboard,
      keyframeStatus: patch.keyframeStatus ?? prev?.keyframeStatus,
      keyframeRef: patch.keyframeRef ?? prev?.keyframeRef,
    };
    byIndex.set(patch.sceneIndex, videoSceneStateSchema.parse(next));
  }
  return [...byIndex.values()].sort((a, b) => a.sceneIndex - b.sceneIndex);
}

function mergeCopyBlocks(
  current: CopyBlockState[],
  patches: CopyBlockState[],
): CopyBlockState[] {
  const byId = new Map<string, CopyBlockState>();
  for (const block of current) {
    byId.set(block.blockId, block);
  }
  for (const patch of patches) {
    const prev = byId.get(patch.blockId);
    byId.set(
      patch.blockId,
      copyBlockStateSchema.parse({
        blockId: patch.blockId,
        role: patch.role ?? prev?.role ?? 'other',
        text: patch.text ?? prev?.text,
        status: patch.status ?? prev?.status,
      }),
    );
  }
  return [...byId.values()];
}

function mergePlanSections(
  current: PlanSectionState[],
  patches: PlanSectionState[],
): PlanSectionState[] {
  const byId = new Map<string, PlanSectionState>();
  for (const section of current) {
    byId.set(section.sectionId, section);
  }
  for (const patch of patches) {
    const prev = byId.get(patch.sectionId);
    byId.set(
      patch.sectionId,
      planSectionStateSchema.parse({
        sectionId: patch.sectionId,
        title: patch.title ?? prev?.title,
        body: patch.body ?? prev?.body,
        status: patch.status ?? prev?.status,
      }),
    );
  }
  return [...byId.values()];
}

function mergePublishItems(
  current: PublishItemState[],
  patches: PublishItemState[],
): PublishItemState[] {
  const byId = new Map<string, PublishItemState>();
  for (const item of current) {
    byId.set(item.itemId, item);
  }
  for (const patch of patches) {
    byId.set(patch.itemId, publishItemStateSchema.parse(patch));
  }
  return [...byId.values()];
}

function applyPatchToBody(
  artifactType: ArtifactType,
  body: ArtifactFullBody,
  patch: ArtifactPatchBody,
): ArtifactFullBody | null {
  if (!patchMatchesType(artifactType, patch)) {
    return null;
  }
  switch (artifactType) {
    case 'note': {
      const current = 'pages' in body ? body.pages : [];
      const pages =
        'pages' in patch && patch.pages
          ? mergeNotePages(current, patch.pages)
          : current;
      return noteArtifactFullSchema.parse({ pages });
    }
    case 'video': {
      const current = 'scenes' in body ? body.scenes : [];
      const scenes =
        'scenes' in patch && patch.scenes
          ? mergeVideoScenes(current, patch.scenes)
          : current;
      const title =
        'title' in patch && patch.title !== undefined
          ? patch.title
          : 'title' in body
            ? body.title
            : undefined;
      return videoArtifactFullSchema.parse({ scenes, title });
    }
    case 'copy': {
      const current = 'blocks' in body ? body.blocks : [];
      const blocks =
        'blocks' in patch && patch.blocks
          ? mergeCopyBlocks(current, patch.blocks)
          : current;
      return copyArtifactFullSchema.parse({ blocks });
    }
    case 'plan': {
      const current = 'sections' in body ? body.sections : [];
      const sections =
        'sections' in patch && patch.sections
          ? mergePlanSections(current, patch.sections)
          : current;
      return planArtifactFullSchema.parse({ sections });
    }
    case 'image': {
      const currentStatus =
        'imageStatus' in body ? body.imageStatus : ('pending' as const);
      const currentRef = 'imageRef' in body ? body.imageRef : undefined;
      const currentCaption = 'caption' in body ? body.caption : undefined;
      return imageArtifactFullSchema.parse({
        imageStatus:
          'imageStatus' in patch && patch.imageStatus
            ? patch.imageStatus
            : currentStatus,
        imageRef:
          'imageRef' in patch && patch.imageRef !== undefined
            ? patch.imageRef
            : currentRef,
        caption:
          'caption' in patch && patch.caption !== undefined
            ? patch.caption
            : currentCaption,
      });
    }
    case 'publish': {
      const current = 'items' in body ? body.items : [];
      const items =
        'items' in patch && patch.items
          ? mergePublishItems(current, patch.items)
          : current;
      return publishArtifactFullSchema.parse({ items });
    }
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return null;
    }
  }
}

function archiveIfTerminal(
  state: ArtifactProjectionState,
): ArtifactVersionRecord[] {
  if (state.status !== 'ready' && state.status !== 'failed') {
    return state.versionHistory;
  }
  const already = state.versionHistory.some(
    (entry) => entry.revision === state.revision,
  );
  if (already) return state.versionHistory;
  return [
    ...state.versionHistory,
    {
      revision: state.revision,
      status: state.status,
      body: structuredClone(state.body),
      summary: state.summary,
      parentRevision: state.parentRevision,
    },
  ];
}

/**
 * Pure Artifact reconciliation (V31-15).
 *
 * - same artifactId only (caller keys the map)
 * - same revision → idempotent (duplicate=true)
 * - cold delta with baseRevision=0 bootstraps from the typed empty body
 *   (producer cold-start marker; prevents infinite resync on first frame)
 * - cold delta with baseRevision>0 / baseRevision mismatch → needs_snapshot
 * - ready head advanced without parentRevision → silent_overwrite
 */
export function applyArtifactUpdate(
  current: ArtifactProjectionState | null,
  update: ArtifactUpdateWire,
): ApplyArtifactUpdateResult {
  if (current && current.artifactId !== update.artifactId) {
    return {
      ok: false,
      reason: 'type_mismatch',
      detail: 'artifactId mismatch',
    };
  }
  if (current && current.artifactType !== update.artifactType) {
    return {
      ok: false,
      reason: 'type_mismatch',
      detail: `artifactType ${current.artifactType} vs ${update.artifactType}`,
    };
  }

  // Same revision: idempotent (no silent body rewrite under same revision).
  if (current && update.revision === current.revision) {
    return { ok: true, state: current, duplicate: true };
  }

  // Stale update (lower revision): ignore as duplicate-no-op.
  if (current && update.revision < current.revision) {
    return { ok: true, state: current, duplicate: true };
  }

  // Ready content: advancing requires explicit derived lineage.
  if (
    current &&
    current.status === 'ready' &&
    update.revision > current.revision
  ) {
    if (update.parentRevision !== current.revision) {
      return {
        ok: false,
        reason: 'silent_overwrite',
        detail:
          'ready artifact requires parentRevision=current.revision for derived version',
      };
    }
  }

  if (update.mode === 'delta') {
    if (!current) {
      if (update.baseRevision !== 0) {
        return {
          ok: false,
          reason: 'needs_snapshot',
          detail: 'delta without local head',
        };
      }
      // Cold-start delta: baseRevision=0 is the producer's explicit bootstrap
      // marker for the first frame of a fresh artifact. Apply the patch onto
      // the typed empty body — the same projection a full replay would build
      // for the first event — so a cold client converges instead of looping
      // on needs_snapshot.
      const nextBody = applyPatchToBody(
        update.artifactType,
        emptyBodyForType(update.artifactType),
        update.patch,
      );
      if (!nextBody) {
        return {
          ok: false,
          reason: 'invalid_patch',
          detail: 'patch failed for artifactType',
        };
      }
      return {
        ok: true,
        duplicate: false,
        state: {
          artifactId: update.artifactId,
          artifactType: update.artifactType,
          revision: update.revision,
          status: update.status,
          body: nextBody,
          summary: update.summary,
          parentRevision: update.parentRevision,
          versionHistory: [],
        },
      };
    }
    if (update.baseRevision !== current.revision) {
      return {
        ok: false,
        reason: 'needs_snapshot',
        detail: `baseRevision ${update.baseRevision} != head ${current.revision}`,
      };
    }
    const nextBody = applyPatchToBody(
      update.artifactType,
      current.body,
      update.patch,
    );
    if (!nextBody) {
      return {
        ok: false,
        reason: 'invalid_patch',
        detail: 'patch failed for artifactType',
      };
    }
    const versionHistory = archiveIfTerminal(current);
    return {
      ok: true,
      duplicate: false,
      state: {
        artifactId: update.artifactId,
        artifactType: update.artifactType,
        revision: update.revision,
        status: update.status,
        body: nextBody,
        summary: update.summary ?? current.summary,
        parentRevision: update.parentRevision,
        versionHistory,
      },
    };
  }

  // snapshot
  if (!fullMatchesType(update.artifactType, update.full)) {
    return {
      ok: false,
      reason: 'type_mismatch',
      detail: 'snapshot full mismatch',
    };
  }
  const versionHistory = current ? archiveIfTerminal(current) : [];
  return {
    ok: true,
    duplicate: false,
    state: {
      artifactId: update.artifactId,
      artifactType: update.artifactType,
      revision: update.revision,
      status: update.status,
      body: structuredClone(update.full),
      summary: update.summary,
      parentRevision: update.parentRevision,
      versionHistory,
    },
  };
}

/** Helper for cold start skeleton without a wire event. */
export function createEmptyArtifactProjection(
  artifactId: string,
  artifactType: ArtifactType,
): ArtifactProjectionState {
  return {
    artifactId,
    artifactType,
    revision: 0,
    status: 'skeleton',
    body: emptyBodyForType(artifactType),
    versionHistory: [],
  };
}

/**
 * Stable-id uniqueness metric: duplicate object rate among a projection map.
 * Acceptance: must be 0 (one entry per artifactId).
 */
export function artifactDuplicateObjectRate(
  artifacts: Readonly<Record<string, ArtifactProjectionState>>,
): number {
  const ids = Object.values(artifacts).map((item) => item.artifactId);
  if (ids.length === 0) return 0;
  const unique = new Set(ids);
  // Map keyed by artifactId ⇒ unique.size === ids.length always when well-formed.
  // Also count key≠artifactId mismatches as duplicates for the gate.
  let mismatches = 0;
  for (const [key, value] of Object.entries(artifacts)) {
    if (key !== value.artifactId) mismatches += 1;
  }
  const idDupes = ids.length - unique.size;
  return (idDupes + mismatches) / ids.length;
}

// ─── 7. Execution plan (V3.1 §14.2 / §22.2) ──────────────────────────────────

export const COMPILED_EXECUTION_PLAN_SCHEMA_VERSION =
  'compiled-execution-plan/v1' as const;

export const executionUnitSchema = z
  .object({
    unitId: executionUnitIdSchema,
    unitType: nonEmptyTrimmedStringSchema.max(100),
    primitive: z
      .enum([
        'read_context',
        'generate',
        'revise',
        'record',
        'check',
        'ask_merchant',
      ])
      .optional(),
    input: jsonValueSchema.optional(),
  })
  .strict();

export type ExecutionUnit = z.infer<typeof executionUnitSchema>;

export const compiledExecutionPlanSchema = z
  .object({
    schemaVersion: z.literal(COMPILED_EXECUTION_PLAN_SCHEMA_VERSION),
    units: z.array(executionUnitSchema).min(1).max(200),
    dependencyGroups: z
      .array(
        z
          .object({
            groupId: identifierSchema,
            unitIds: z.array(executionUnitIdSchema).min(1).max(100),
          })
          .strict(),
      )
      .max(100),
    boundedRetry: z.record(
      nonEmptyTrimmedStringSchema,
      z
        .object({
          maxAttempts: z.number().int().positive().max(20),
          maxCostCents: z.number().int().nonnegative().safe(),
          retry: z.union([
            z.object({ enabled: z.literal(false) }).strict(),
            z
              .object({
                enabled: z.literal(true),
                predicateRef: nonEmptyTrimmedStringSchema.max(200),
              })
              .strict(),
          ]),
        })
        .strict(),
    ),
    cachePolicies: z
      .record(
        nonEmptyTrimmedStringSchema,
        z
          .object({
            ttlSeconds: z.number().int().positive().max(86_400),
            scope: z.literal('workspace'),
            dependsOn: z.array(nonEmptyTrimmedStringSchema.max(200)).max(50),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type CompiledExecutionPlan = z.infer<typeof compiledExecutionPlanSchema>;

export const EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION =
  'execution-plan-snapshot/v1' as const;

export const executionPlanApprovalBasisSchema = z.enum([
  'merchant_confirmed',
  'policy_exempt_copy',
]);

export type ExecutionPlanApprovalBasis = z.infer<
  typeof executionPlanApprovalBasisSchema
>;

/**
 * Server-frozen package billing allocation bound to one executable carrier
 * unit. `carrierUnitId` is an explicit join key, never a carrier-name guess:
 * the same package may eventually contain more than one allocation of a kind.
 */
export const executionPlanPackageBillingAllocationSchema = z
  .object({
    carrierUnitId: nonEmptyTrimmedStringSchema.max(200),
    allocationId: nonEmptyTrimmedStringSchema.max(200),
    carrier: planDeliverableCarrierSchema,
    deliveryUnits: z.number().int().positive().safe(),
    creditCost: z.number().int().nonnegative().safe(),
    failureRefundsCredits: z.boolean(),
    operation: nonEmptyTrimmedStringSchema.max(200),
    catalogModel: z
      .object({
        id: nonEmptyTrimmedStringSchema.max(200),
        revision: nonEmptyTrimmedStringSchema.max(200),
      })
      .strict(),
    routeSnapshotRef: nonEmptyTrimmedStringSchema.max(500),
    rightsRevisionRefs: z
      .array(nonEmptyTrimmedStringSchema.max(500))
      .min(1)
      .max(100),
  })
  .strict();

export type ExecutionPlanPackageBillingAllocation = z.infer<
  typeof executionPlanPackageBillingAllocationSchema
>;

/**
 * The package quote contract copied into the plan freeze. It is internal
 * execution authority, and therefore participates in snapshot hashing.
 */
export const executionPlanPackageBillingSchema = z
  .object({
    contractHash: nonEmptyTrimmedStringSchema.max(128),
    allocations: z
      .array(executionPlanPackageBillingAllocationSchema)
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((packageBilling, context) => {
    const allocationIds = new Set<string>();
    const carrierUnitIds = new Set<string>();
    for (const allocation of packageBilling.allocations) {
      if (allocationIds.has(allocation.allocationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate package billing allocation ${allocation.allocationId}.`,
          path: ['allocations'],
        });
      }
      if (carrierUnitIds.has(allocation.carrierUnitId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate package billing carrier unit ${allocation.carrierUnitId}.`,
          path: ['allocations'],
        });
      }
      allocationIds.add(allocation.allocationId);
      carrierUnitIds.add(allocation.carrierUnitId);
    }
  });

export type ExecutionPlanPackageBilling = z.infer<
  typeof executionPlanPackageBillingSchema
>;

/**
 * Fields covered by snapshotHash — frozen execution content only.
 * confirmationDecisionRef is intentionally excluded so hash is stable across
 * pre-confirm freeze and post-confirm admission (U9 / V31-01 / V31-12).
 */
export const EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS = [
  'planId',
  'planRevision',
  'intentDeclaration',
  'contextBundleRef',
  'executionPlan',
  'deliverables',
  'promptRevisionRefs',
  'skillManifestRefs',
  'routeRequirements',
  'quoteRef',
  'packageBilling',
  'rightsRevisionRefs',
  'factRevisionRefs',
  'boundedExecution',
  'harnessReleaseId',
  'approvalBasis',
] as const;

export const EXECUTION_PLAN_SNAPSHOT_HASH_EXCLUDED_FIELDS = [
  'confirmationDecisionRef',
  'snapshotHash',
  'schemaVersion',
] as const;

export const promptRevisionRefSchema = z
  .object({
    key: nonEmptyTrimmedStringSchema.max(200),
    version: nonEmptyTrimmedStringSchema.max(200),
  })
  .strict();

export const skillManifestRefSchema = z
  .object({
    skillId: nonEmptyTrimmedStringSchema.max(200),
    revision: nonEmptyTrimmedStringSchema.max(200),
  })
  .strict();

export const capabilityRequirementSchema = z
  .object({
    capability: nonEmptyTrimmedStringSchema.max(200),
    requirement: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();

export const executionPlanSnapshotSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION),
    planId: marketingPlanIdSchema,
    planRevision: positiveRevisionSchema,
    intentDeclaration: intentDeclarationSchema,
    contextBundleRef: z
      .object({
        bundleId: identifierSchema,
        revision: positiveRevisionSchema,
        hash: hashStringSchema,
      })
      .strict(),
    executionPlan: compiledExecutionPlanSchema,
    deliverables: z.array(planDeliverableSchema).min(1).max(50),
    promptRevisionRefs: z.record(nonEmptyTrimmedStringSchema, promptRevisionRefSchema),
    skillManifestRefs: z.record(
      nonEmptyTrimmedStringSchema,
      z.array(skillManifestRefSchema).max(50),
    ),
    routeRequirements: z.array(capabilityRequirementSchema).max(100),
    quoteRef: agentRevisionRefSchema,
    /**
     * Allocation authority for a heterogeneous package quote. Omitted only for
     * legacy/single-carrier quote rows; when present it is hash-covered.
     */
    packageBilling: executionPlanPackageBillingSchema.optional(),
    rightsRevisionRefs: z.array(identifierSchema).max(100),
    factRevisionRefs: z.array(identifierSchema).max(200),
    boundedExecution: boundedExecutionSnapshotSchema,
    harnessReleaseId: harnessReleaseIdSchema,
    approvalBasis: executionPlanApprovalBasisSchema,
    /**
     * Required when approvalBasis=merchant_confirmed. Never enters snapshotHash.
     */
    confirmationDecisionRef: planConfirmationDecisionIdSchema.optional(),
    snapshotHash: hashStringSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.approvalBasis === 'merchant_confirmed' &&
      !snapshot.confirmationDecisionRef
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'merchant_confirmed snapshots require confirmationDecisionRef.',
        path: ['confirmationDecisionRef'],
      });
    }
    if (
      snapshot.approvalBasis === 'policy_exempt_copy' &&
      snapshot.confirmationDecisionRef
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'policy_exempt_copy snapshots must not carry confirmationDecisionRef.',
        path: ['confirmationDecisionRef'],
      });
    }
  });

export type ExecutionPlanSnapshot = z.infer<typeof executionPlanSnapshotSchema>;

/**
 * V3.1 §14.3 pending confirmation request (reserve+hold domain object).
 * Distinct from harness UI `executionConfirmationRequestSchema` (card protocol).
 *
 * Campaign fields (U7): plan_only approves schedule only; each paid Work uses
 * single_work with its own request (no pre-authorization of future charges).
 * holdExpiresAt is business TTL on the *request* only (1h–30d, D-153 / U8).
 * Decisions never carry wait-period TTL.
 */
export const AGENT_EXECUTION_CONFIRMATION_REQUEST_SCHEMA_VERSION =
  'agent-execution-confirmation-request/v1' as const;

/** Hold window bounds for ExecutionConfirmationRequest (seconds). */
export const CONFIRMATION_HOLD_MIN_SECONDS = 60 * 60; // 1h
export const CONFIRMATION_HOLD_MAX_SECONDS = 30 * 24 * 60 * 60; // 30d

export const confirmationApprovalScopeSchema = z.enum([
  'plan_only',
  'single_work',
]);

export type ConfirmationApprovalScope = z.infer<
  typeof confirmationApprovalScopeSchema
>;

export const agentExecutionConfirmationRequestSchema = z
  .object({
    schemaVersion: z.literal(AGENT_EXECUTION_CONFIRMATION_REQUEST_SCHEMA_VERSION),
    requestId: agentExecutionConfirmationRequestIdSchema,
    workspaceId: identifierSchema,
    planId: marketingPlanIdSchema,
    planRevision: positiveRevisionSchema,
    snapshotHash: hashStringSchema,
    quoteRef: agentRevisionRefSchema,
    reservationIdempotencyKey: identifierSchema,
    /** Exact predecessor hold replaced atomically by a repriced successor. */
    predecessorRequestId: agentExecutionConfirmationRequestIdSchema.optional(),
    replacesReservationIdempotencyKey: identifierSchema.optional(),
    createdAt: timestampSchema,
    holdExpiresAt: timestampSchema,
    status: z.enum(['pending', 'decided', 'expired']),
    /**
     * U7 Campaign: which plan this derived Work belongs to.
     * Required together with workOrdinal + approvalScope when any is set.
     */
    campaignPlanRef: agentRevisionRefSchema.optional(),
    workOrdinal: z.number().int().positive().safe().optional(),
    approvalScope: confirmationApprovalScopeSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      (request.predecessorRequestId === undefined) !==
      (request.replacesReservationIdempotencyKey === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Successor confirmation replacement requires both predecessor request and reservation identities.',
        path: ['predecessorRequestId'],
      });
    }
    const campaignBits = [
      request.campaignPlanRef !== undefined,
      request.workOrdinal !== undefined,
      request.approvalScope !== undefined,
    ];
    const present = campaignBits.filter(Boolean).length;
    if (present > 0 && present < 3) {
      context.addIssue({
        code: 'custom',
        message:
          'Campaign confirmation requires campaignPlanRef, workOrdinal, and approvalScope together.',
        path: ['approvalScope'],
      });
    }
    const createdMs = Date.parse(request.createdAt);
    const expiresMs = Date.parse(request.holdExpiresAt);
    if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs)) {
      return;
    }
    const holdSeconds = Math.floor((expiresMs - createdMs) / 1000);
    if (
      holdSeconds < CONFIRMATION_HOLD_MIN_SECONDS ||
      holdSeconds > CONFIRMATION_HOLD_MAX_SECONDS
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'holdExpiresAt must be between 1 hour and 30 days after createdAt (D-153).',
        path: ['holdExpiresAt'],
      });
    }
  });

export type AgentExecutionConfirmationRequest = z.infer<
  typeof agentExecutionConfirmationRequestSchema
>;

/**
 * Immutable merchant confirm/reject decision (V3.1 §14.3).
 * No holdExpiresAt / TTL — wait-period belongs only on the pending request.
 */
export const PLAN_CONFIRMATION_DECISION_SCHEMA_VERSION =
  'plan-confirmation-decision/v1' as const;

export const planConfirmationDecisionSchema = z
  .object({
    schemaVersion: z.literal(PLAN_CONFIRMATION_DECISION_SCHEMA_VERSION),
    decisionId: planConfirmationDecisionIdSchema,
    requestId: agentExecutionConfirmationRequestIdSchema,
    actorId: identifierSchema,
    decision: z.enum(['confirmed', 'rejected']),
    decidedAt: timestampSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    // Constructive: decision payload must not grow wait-period fields.
    const forbidden = ['holdExpiresAt', 'expiresAt', 'timeoutSeconds'] as const;
    for (const key of forbidden) {
      if (key in (decision as Record<string, unknown>)) {
        context.addIssue({
          code: 'custom',
          message: `PlanConfirmationDecision must not carry ${key} (U8).`,
          path: [key],
        });
      }
    }
  });

export type PlanConfirmationDecision = z.infer<
  typeof planConfirmationDecisionSchema
>;

// ─── 8. Release (V3.1 §29 + §21.2 controlLimits) ─────────────────────────────

export const HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION =
  'harness-release-artifact/v1' as const;

export const agentControlLimitsSchema = z
  .object({
    maxLlmSteps: z.number().int().positive().max(100),
    maxToolCalls: z.number().int().positive().max(200),
    maxRetrievalCalls: z.number().int().positive().max(100),
    maxMerchantQuestions: z.number().int().positive().max(20),
    maxReplans: z.number().int().nonnegative().max(20),
    maxSchemaRepairs: z.number().int().nonnegative().max(20),
    maxContextTokens: z.number().int().positive().max(2_000_000),
    maxDelegations: z.number().int().nonnegative().max(50),
  })
  .strict();

export type AgentControlLimits = z.infer<typeof agentControlLimitsSchema>;

export const harnessMiddlewareBindingSchema = z
  .object({
    policyId: nonEmptyTrimmedStringSchema.max(200),
    revision: nonEmptyTrimmedStringSchema.max(200),
    kind: z.enum([
      'before_model',
      'after_model',
      'wrap_model',
      'wrap_tool_call',
    ]),
    order: z.number().int().nonnegative().safe(),
    allowedControlActions: z
      .array(z.enum(['continue', 'end_turn', 'ask_merchant']))
      .min(1)
      .max(3),
  })
  .strict();

export type HarnessMiddlewareBinding = z.infer<
  typeof harnessMiddlewareBindingSchema
>;

export const harnessReleaseArtifactSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION),
    releaseId: harnessReleaseIdSchema,
    version: positiveRevisionSchema,
    manifestHash: hashStringSchema,
    agentSessionHarnessVersion: nonEmptyTrimmedStringSchema.max(100),
    makeHarnessVersion: nonEmptyTrimmedStringSchema.max(100),
    /** MAJOR-01: policy composition frozen with the release. */
    middlewareBindings: z.array(harnessMiddlewareBindingSchema).max(100),
    /** U11: calibrated control limits published with the release (no unset). */
    controlLimits: agentControlLimitsSchema,
    supervisorPolicyRef: agentRevisionRefSchema,
    memoryPolicyRef: agentRevisionRefSchema,
    contextCompilerRef: agentRevisionRefSchema,
    planSchemaRevision: nonEmptyTrimmedStringSchema.max(200),
    promptBindings: z.record(nonEmptyTrimmedStringSchema, promptRevisionRefSchema),
    promptPackBindings: z.record(
      nonEmptyTrimmedStringSchema,
      z.array(nonEmptyTrimmedStringSchema.max(200)).max(50),
    ),
    schemaBindings: z.record(
      nonEmptyTrimmedStringSchema,
      nonEmptyTrimmedStringSchema.max(200),
    ),
    skillBindings: z.record(
      nonEmptyTrimmedStringSchema,
      z.array(skillManifestRefSchema).max(50),
    ),
    toolPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    modelPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    factPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    rightsPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    budgetPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    evalSuiteRevision: nonEmptyTrimmedStringSchema.max(200),
    createdAt: timestampSchema,
  })
  .strict();

export type HarnessReleaseArtifact = z.infer<typeof harnessReleaseArtifactSchema>;

export const HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION =
  'harness-release-lifecycle/v1' as const;

export const harnessReleaseLifecycleStatusSchema = z.enum([
  'draft',
  'evaluating',
  'canary',
  'production',
  'retired',
]);

export const harnessReleaseLifecycleSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION),
    releaseId: harnessReleaseIdSchema,
    status: harnessReleaseLifecycleStatusSchema,
    approvedBy: identifierSchema.optional(),
    approvedAt: timestampSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict();

export type HarnessReleaseLifecycle = z.infer<
  typeof harnessReleaseLifecycleSchema
>;

export const HARNESS_RELEASE_ROLLOUT_SCHEMA_VERSION =
  'harness-release-rollout/v1' as const;

export const harnessReleaseRolloutSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_RELEASE_ROLLOUT_SCHEMA_VERSION),
    releaseId: harnessReleaseIdSchema,
    workspaceAllowlist: z.array(identifierSchema).max(10_000),
    percentage: z.number().int().min(0).max(100).optional(),
    industryAllowlist: z.array(nonEmptyTrimmedStringSchema.max(100)).max(100).optional(),
    updatedAt: timestampSchema,
  })
  .strict();

export type HarnessReleaseRollout = z.infer<typeof harnessReleaseRolloutSchema>;

// ─── 9. Steering (V3.1 §23.3 / §24) ──────────────────────────────────────────

export const STEERING_COMMAND_SCHEMA_VERSION = 'steering-command/v1' as const;

export const steeringClassificationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('future_step_patch'),
      affectedUnits: z.array(executionUnitIdSchema).min(1).max(100),
      requiresRequote: z.literal(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('derived_revision'),
      completedUnits: z.array(executionUnitIdSchema).max(100),
      requiresRequote: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('plan_change'),
      reason: nonEmptyTrimmedStringSchema.max(2_000),
      requiresReplan: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unsafe_or_conflicting'),
      reason: nonEmptyTrimmedStringSchema.max(2_000),
    })
    .strict(),
]);

export type SteeringClassification = z.infer<typeof steeringClassificationSchema>;

/** Dual queue: steer = interrupt-after-unit; follow_up = after all units (B7). */
export const steeringQueueModeSchema = z.enum(['steer', 'follow_up']);

export const makeSteeringCommandSchema = z
  .object({
    schemaVersion: z.literal(STEERING_COMMAND_SCHEMA_VERSION),
    commandId: steeringCommandIdSchema,
    threadId: agentThreadIdSchema,
    taskId: identifierSchema,
    workId: identifierSchema.optional(),
    sourcePlanRevision: positiveRevisionSchema,
    sourceContentVersionIds: z.array(identifierSchema).max(50),
    snapshotHash: hashStringSchema.optional(),
    instruction: nonEmptyTrimmedStringSchema.max(4_000),
    classification: steeringClassificationSchema,
    affectedUnitIds: z.array(executionUnitIdSchema).max(100),
    queueMode: steeringQueueModeSchema,
    createdAt: timestampSchema,
    actorId: identifierSchema,
  })
  .strict();

export type MakeSteeringCommand = z.infer<typeof makeSteeringCommandSchema>;

// ─── 10. Outcome (V3.1 §26 + V31-19) ─────────────────────────────────────────
//
// Canonical write contract for result evidence (MAJOR-13 / V31-19).
// Physical store = existing ContentPackage.resultSignals / manual outcome path;
// result ledger and observability may only project — never dual-write.
// Deletion (D-168② for evidence): append-only withdraw only; no hard delete.

export const OUTCOME_EVIDENCE_SCHEMA_VERSION = 'outcome-evidence/v1' as const;

/**
 * Operating signals for OutcomeEvidence.
 * `no_activity` is the explicit U2「没动静」chip — never encode via `feedback`.
 */
export const outcomeSignalSchema = z.enum([
  'published',
  'attention',
  'inquiry',
  'wechat',
  'booking',
  'purchase',
  'redeemed',
  'visit',
  'feedback',
  /** Explicit negative chip: merchant reports no activity (U2 / V31-19). */
  'no_activity',
]);

export type OutcomeSignal = z.infer<typeof outcomeSignalSchema>;

/** Merchant-facing self-report chips (U2 six chips). */
export const OUTCOME_SELF_REPORT_CHIP_SIGNALS = [
  'inquiry',
  'wechat',
  'booking',
  'purchase',
  'visit',
  'no_activity',
] as const satisfies readonly OutcomeSignal[];

export type OutcomeSelfReportChipSignal =
  (typeof OUTCOME_SELF_REPORT_CHIP_SIGNALS)[number];

/**
 * Three evidence tiers (V3.1 §26.1).
 * `inferred` = temporal correlation only — never causality.
 */
export const outcomeSourceSchema = z.enum([
  'verified',
  'merchant_reported',
  'inferred',
]);

export type OutcomeSource = z.infer<typeof outcomeSourceSchema>;

/**
 * Append-only lifecycle of a ledger row.
 * Superseded is usually derived by latest projection from later supersedes links;
 * withdrawn rows are explicit negative appends (D-168② — no hard delete).
 */
export const outcomeEvidenceLifecycleStatusSchema = z.enum([
  'active',
  'superseded',
  'withdrawn',
]);

export type OutcomeEvidenceLifecycleStatus = z.infer<
  typeof outcomeEvidenceLifecycleStatusSchema
>;

export const outcomeEvidenceWriteActionSchema = z.enum([
  'record',
  'correct',
  'withdraw',
]);

export type OutcomeEvidenceWriteAction = z.infer<
  typeof outcomeEvidenceWriteActionSchema
>;

export const outcomeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(OUTCOME_EVIDENCE_SCHEMA_VERSION),
    evidenceId: outcomeEvidenceIdSchema,
    /** Tenant isolation key — required for P1 write path. */
    workspaceId: identifierSchema,
    /** Exact ContentPackage id + revision binding (V31-19). */
    contentPackageRef: agentRevisionRefSchema,
    goalId: marketingGoalIdSchema.optional(),
    signal: outcomeSignalSchema,
    source: outcomeSourceSchema,
    value: z.number().finite().optional(),
    /** Merchant clock for when the signal happened. */
    observedAt: timestampSchema,
    /**
     * Optional external source pointer (receipt / screenshot ref / link id).
     * Participates in the submit idempotency key with observedAt.
     */
    sourceRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    /** When the ledger row was written (server clock). */
    recordedAt: timestampSchema,
    actorId: identifierSchema,
    note: nonEmptyTrimmedStringSchema.max(120).optional(),
    status: outcomeEvidenceLifecycleStatusSchema,
    /** Append-only correction/withdraw chain. */
    supersedesEvidenceId: outcomeEvidenceIdSchema.optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.source === 'inferred') {
      // Inferred may only express temporal association — reject causal value framing.
      // value is allowed as a mirrored quantity from merchant, but signal must not
      // be a negative "no activity" inventing absence as causality.
      if (evidence.signal === 'no_activity') {
        context.addIssue({
          code: 'custom',
          message:
            'inferred outcome evidence cannot use no_activity (absence is merchant-reported only).',
          path: ['signal'],
        });
      }
    }
    if (evidence.status === 'withdrawn' && !evidence.supersedesEvidenceId) {
      context.addIssue({
        code: 'custom',
        message: 'withdrawn evidence must reference the superseded row.',
        path: ['supersedesEvidenceId'],
      });
    }
    if (evidence.status === 'active' && evidence.supersedesEvidenceId) {
      // Correct appends stay active and point at the prior row.
      return;
    }
  });

export type OutcomeEvidence = z.infer<typeof outcomeEvidenceSchema>;

/**
 * Submit idempotency key (V3.1 §26.1 / MAJOR-13):
 * contentPackageRef + signal + observedAt/sourceRef
 */
export function buildOutcomeEvidenceIdempotencyKey(input: {
  contentPackageId: string;
  contentPackageRevision: number | string;
  signal: OutcomeSignal;
  observedAt: string;
  sourceRef?: string;
}): string {
  const sourcePart = input.sourceRef?.trim() || '_';
  return [
    input.contentPackageId,
    String(input.contentPackageRevision),
    input.signal,
    input.observedAt,
    sourcePart,
  ].join('|');
}

/** Reject encoding「没动静」via the catch-all feedback signal. */
export function isForbiddenNoActivityEncoding(
  signal: OutcomeSignal,
  note?: string,
): boolean {
  if (signal === 'no_activity') return false;
  if (signal !== 'feedback') return false;
  const text = (note ?? '').trim();
  return /没动静|无反馈|没有人问|无人问|no[_ ]?activity/iu.test(text);
}

/**
 * Map legacy ContentPackage.resultSignals.kind → OutcomeEvidence.signal.
 * `no_activity` is first-class; feedback is never a stand-in.
 */
export function mapContentPackageResultKindToOutcomeSignal(
  kind: string,
): OutcomeSignal | null {
  switch (kind) {
    case 'attention':
      return 'attention';
    case 'inquiry':
    case 'private_message':
      return 'inquiry';
    case 'wechat':
    case 'wechat_added':
    case 'contact_added':
      return 'wechat';
    case 'booking':
    case 'appointment':
      return 'booking';
    case 'purchase':
    case 'voucher_purchase':
    case 'voucher_purchased':
      return 'purchase';
    case 'redeemed':
    case 'redemption':
      return 'redeemed';
    case 'visit':
    case 'store_visit':
      return 'visit';
    case 'published':
      return 'published';
    case 'feedback':
      return 'feedback';
    case 'no_activity':
      return 'no_activity';
    default:
      return null;
  }
}

/** Map OutcomeEvidence.signal → preferred ContentPackage.resultSignals.kind. */
export function mapOutcomeSignalToContentPackageResultKind(
  signal: OutcomeSignal,
): string {
  switch (signal) {
    case 'attention':
      return 'attention';
    case 'inquiry':
      return 'inquiry';
    case 'wechat':
      return 'wechat_added';
    case 'booking':
      return 'appointment';
    case 'purchase':
      return 'voucher_purchase';
    case 'redeemed':
      return 'redeemed';
    case 'visit':
      return 'store_visit';
    case 'no_activity':
      return 'no_activity';
    case 'published':
      return 'published';
    case 'feedback':
      return 'feedback';
  }
}

export function mapContentPackageResultSourceToOutcomeSource(
  source: string,
): OutcomeSource | null {
  switch (source) {
    case 'verified_adapter':
    case 'verified':
      return 'verified';
    case 'merchant_recorded':
    case 'merchant_reported':
      return 'merchant_reported';
    case 'inferred_temporal':
    case 'inferred_association':
    case 'inferred':
      return 'inferred';
    default:
      return null;
  }
}

export function mapOutcomeSourceToContentPackageResultSource(
  source: OutcomeSource,
): 'verified_adapter' | 'merchant_recorded' | 'inferred_temporal' {
  switch (source) {
    case 'verified':
      return 'verified_adapter';
    case 'merchant_reported':
      return 'merchant_recorded';
    case 'inferred':
      return 'inferred_temporal';
  }
}

/**
 * Latest projection over an append-only evidence log.
 * Superseded = referenced by a later supersedesEvidenceId;
 * withdrawn supersedes target is excluded; withdrawn rows themselves excluded.
 */
export function projectLatestOutcomeEvidence(
  history: readonly OutcomeEvidence[],
): OutcomeEvidence[] {
  const superseded = new Set<string>();
  for (const row of history) {
    if (row.supersedesEvidenceId) {
      superseded.add(row.supersedesEvidenceId);
    }
  }
  return history.filter(
    (row) =>
      row.status !== 'withdrawn' &&
      row.status !== 'superseded' &&
      !superseded.has(row.evidenceId),
  );
}

/**
 * U2 self-report frequency parameters (contract surface for V31-17).
 * 40% first-window coverage is observation-only — never a hard gate here.
 */
export const OUTCOME_SELF_REPORT_FREQUENCY_PARAMS = Object.freeze({
  schemaVersion: 'outcome-self-report-frequency/v1' as const,
  /** Next calendar day after publish handoff — single ask (U2=A). */
  askTiming: 'next_day_once' as const,
  /** Same Work is asked at most once. */
  maxAsksPerWork: 1,
  /** After this many consecutive ignores, store-level backoff applies. */
  consecutiveIgnoreThresholdForStoreBackoff: 2,
  /**
   * Pilot coverage target is observation only (U2).
   * Consumers must not hard-gate product journeys on this number until a later
   * baseline promotion decision.
   */
  coverageGateMode: 'observation_only' as const,
  coverageObservationTarget: 0.4,
});

export const outcomeSelfReportFrequencyParamsSchema = z
  .object({
    schemaVersion: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.schemaVersion,
    ),
    askTiming: z.literal(OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.askTiming),
    maxAsksPerWork: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.maxAsksPerWork,
    ),
    consecutiveIgnoreThresholdForStoreBackoff: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.consecutiveIgnoreThresholdForStoreBackoff,
    ),
    coverageGateMode: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.coverageGateMode,
    ),
    coverageObservationTarget: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.coverageObservationTarget,
    ),
  })
  .strict();

export type OutcomeSelfReportFrequencyParams = z.infer<
  typeof outcomeSelfReportFrequencyParamsSchema
>;

/**
 * Canonical write command for OutcomeEvidence (manual outcome contract extension).
 * Bound to exact ContentPackage revision; result ledger / observability project only.
 */
export const recordOutcomeEvidenceCommandSchema = z
  .object({
    schemaVersion: z.literal(OUTCOME_EVIDENCE_SCHEMA_VERSION),
    action: outcomeEvidenceWriteActionSchema.default('record'),
    workspaceId: identifierSchema,
    contentPackageRef: agentRevisionRefSchema,
    goalId: marketingGoalIdSchema.optional(),
    signal: outcomeSignalSchema,
    /** Write path is merchant_reported by default; verified adapters use their own path later. */
    source: outcomeSourceSchema.default('merchant_reported'),
    value: z.number().finite().optional(),
    observedAt: timestampSchema.optional(),
    sourceRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    note: nonEmptyTrimmedStringSchema.max(120).optional(),
    actorId: identifierSchema,
    /** Required for correct / withdraw. */
    supersedesEvidenceId: outcomeEvidenceIdSchema.optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      (command.action === 'correct' || command.action === 'withdraw') &&
      !command.supersedesEvidenceId
    ) {
      context.addIssue({
        code: 'custom',
        message: `${command.action} requires supersedesEvidenceId.`,
        path: ['supersedesEvidenceId'],
      });
    }
    if (command.action === 'record' && command.supersedesEvidenceId) {
      context.addIssue({
        code: 'custom',
        message: 'record must not set supersedesEvidenceId; use correct.',
        path: ['supersedesEvidenceId'],
      });
    }
    if (command.source === 'inferred') {
      context.addIssue({
        code: 'custom',
        message:
          'inferred evidence is projection-only and cannot be written via the manual contract.',
        path: ['source'],
      });
    }
    if (isForbiddenNoActivityEncoding(command.signal, command.note)) {
      context.addIssue({
        code: 'custom',
        message:
          'no_activity must use signal=no_activity; do not encode via feedback.',
        path: ['signal'],
      });
    }
  });

export type RecordOutcomeEvidenceCommand = z.infer<
  typeof recordOutcomeEvidenceCommandSchema
>;

// ─── 11. Interrupt protocol (V3.1 §27.6 / D-169① / V31-14) ───────────────────
//
// Typed HITL envelope for DBOS suspend/resume. Resume is always by stable
// interruptId + revision CAS — never by list position (dependency groups can
// emit multiple pending interrupts in one batch).
// expiresAt is optional and only appears when a business rule itself has a
// deadline (e.g. D-153 paid confirmation hold). Ordinary ask_merchant must not
// expire because of a carrier TTL.

export const INTERRUPT_PAYLOAD_SCHEMA_VERSION = 'interrupt-payload/v1' as const;

export const interruptActionSchema = z.enum([
  'confirm_paid_execution',
  'resolve_rights',
  'answer_question',
  'confirm_plan',
  'bounded_execution_continuation',
  'fact_change_ack',
  'other',
]);

export type InterruptAction = z.infer<typeof interruptActionSchema>;

export const interruptConfigSchema = z
  .object({
    allowAccept: z.boolean(),
    allowEdit: z.boolean(),
    allowReject: z.boolean(),
    allowRespond: z.boolean(),
  })
  .strict();

export type InterruptConfig = z.infer<typeof interruptConfigSchema>;

export const interruptPayloadSchema = z
  .object({
    schemaVersion: z.literal(INTERRUPT_PAYLOAD_SCHEMA_VERSION),
    interruptId: interruptIdSchema,
    threadId: agentThreadIdSchema,
    runId: agentRunIdSchema,
    workflowId: identifierSchema,
    /** D-169① resume triple coordinate with runId + resumeData. */
    step: nonEmptyTrimmedStringSchema.max(200),
    /** CAS cursor (maps to QuestionCard.workflowRevision). */
    revision: revisionNumberSchema,
    action: interruptActionSchema,
    args: jsonValueSchema,
    config: interruptConfigSchema,
    description: nonEmptyTrimmedStringSchema.max(4_000),
    /**
     * Optional business deadline only (e.g. confirmation hold). Must not be set
     * for ordinary ask_merchant (D-116 / D-169① carrier TTL ban).
     */
    expiresAt: timestampSchema.optional(),
    /** Workspace/resource that owns this interrupt (listPending auth boundary). */
    resourceId: merchantResourceIdSchema,
  })
  .strict();

export type InterruptPayload = z.infer<typeof interruptPayloadSchema>;

export const resumeInterruptTypeSchema = z.enum([
  'accept',
  'edit',
  'reject',
  'respond',
]);

export type ResumeInterruptType = z.infer<typeof resumeInterruptTypeSchema>;

/** Client → server resume. CAS on interruptId + revision; no position index. */
export const resumeInterruptCommandSchema = z
  .object({
    schemaVersion: z.literal(INTERRUPT_PAYLOAD_SCHEMA_VERSION),
    interruptId: interruptIdSchema,
    revision: revisionNumberSchema,
    type: resumeInterruptTypeSchema,
    args: jsonValueSchema.optional(),
    /** Optional client idempotency key for at-least-once submit. */
    idempotencyKey: identifierSchema.optional(),
  })
  .strict();

export type ResumeInterruptCommand = z.infer<typeof resumeInterruptCommandSchema>;

/** listPendingInterrupts query: workspace/resource auth; threadId is filter only. */
export const listPendingInterruptsQuerySchema = z
  .object({
    resourceId: merchantResourceIdSchema,
    threadId: agentThreadIdSchema.optional(),
  })
  .strict();

export type ListPendingInterruptsQuery = z.infer<
  typeof listPendingInterruptsQuerySchema
>;

/**
 * Minimal workbench session projection for reconnect/replay — the cross-tier
 * shape shared by Core session resolve, semantic-event snapshot replay and the
 * App Shell reducer (three byte-identical local copies until 2026-08-12).
 */
export type WorkbenchSessionProjection = {
  resourceId: string;
  threadId: string;
  sessionRevision: number;
  activeRunId?: string;
  title?: string;
};

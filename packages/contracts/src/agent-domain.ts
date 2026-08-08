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

export const marketingGoalPrioritySchema = z.enum(['low', 'normal', 'high']);

export const marketingGoalStatusSchema = z.enum([
  'active',
  'paused',
  'completed',
  'abandoned',
]);

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
 */
export const AGENT_EXECUTION_CONFIRMATION_REQUEST_SCHEMA_VERSION =
  'agent-execution-confirmation-request/v1' as const;

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
    createdAt: timestampSchema,
    holdExpiresAt: timestampSchema,
    status: z.enum(['pending', 'decided', 'expired']),
  })
  .strict();

export type AgentExecutionConfirmationRequest = z.infer<
  typeof agentExecutionConfirmationRequestSchema
>;

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
  .strict();

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

// ─── 10. Outcome (V3.1 §26) ──────────────────────────────────────────────────

export const OUTCOME_EVIDENCE_SCHEMA_VERSION = 'outcome-evidence/v1' as const;

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
]);

export const outcomeSourceSchema = z.enum([
  'verified',
  'merchant_reported',
  'inferred',
]);

export const outcomeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(OUTCOME_EVIDENCE_SCHEMA_VERSION),
    evidenceId: outcomeEvidenceIdSchema,
    contentPackageRef: agentRevisionRefSchema,
    goalId: marketingGoalIdSchema.optional(),
    signal: outcomeSignalSchema,
    source: outcomeSourceSchema,
    value: z.number().finite().optional(),
    observedAt: timestampSchema,
    sourceRef: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();

export type OutcomeEvidence = z.infer<typeof outcomeEvidenceSchema>;

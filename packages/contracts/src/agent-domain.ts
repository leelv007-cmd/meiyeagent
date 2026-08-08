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

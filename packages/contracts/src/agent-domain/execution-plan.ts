/**
 * Agent-domain: Execution plan (V3.1 §14.2 / §22.2).
 */

import { z } from 'zod';

import { boundedExecutionSnapshotSchema } from '../bounded-execution.js';
import {
  agentExecutionConfirmationRequestIdSchema,
  executionUnitIdSchema,
  harnessReleaseIdSchema,
  identifierSchema,
  marketingPlanIdSchema,
  nonEmptyTrimmedStringSchema,
  planConfirmationDecisionIdSchema,
} from '../identifiers.js';
import { agentRevisionRefSchema } from './shared.js';
import {
  hashStringSchema,
  jsonValueSchema,
  positiveRevisionSchema,
  timestampSchema,
} from './internal.js';
import {
  intentDeclarationSchema,
  planDeliverableCarrierSchema,
  planDeliverableSchema,
} from './plan.js';

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

/**
 * Capabilities consumed by the current compiled-plan executor.
 *
 * Optional only so already-frozen v1 snapshots keep their byte-for-byte hash
 * and remain replayable. Every newly compiled/admitted plan must carry this
 * declaration; admission owns that publication rule.
 */
export const compiledExecutionCapabilitiesSchema = z
  .object({
    scheduling: z.literal('serial'),
    retry: z.literal('none'),
    cache: z.literal('none'),
  })
  .strict();

export type CompiledExecutionCapabilities = z.infer<
  typeof compiledExecutionCapabilitiesSchema
>;

export const CURRENT_COMPILED_EXECUTION_CAPABILITIES = Object.freeze({
  scheduling: 'serial',
  retry: 'none',
  cache: 'none',
} satisfies CompiledExecutionCapabilities);

export const compiledExecutionPlanSchema = z
  .object({
    schemaVersion: z.literal(COMPILED_EXECUTION_PLAN_SCHEMA_VERSION),
    executionCapabilities: compiledExecutionCapabilitiesSchema.optional(),
    units: z.array(executionUnitSchema).min(1).max(200),
    /**
     * Legacy field name retained for v1 hash compatibility. Current published
     * serial plans require one unit per group in exact execution order.
     */
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
    /** Current published plans require this compatibility field to be empty. */
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
    /** Current published plans omit this until cache consumption is implemented. */
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

/**
 * Returns why a plan contradicts the current declared capabilities.
 * Missing declarations are legacy v1 and are classified by the caller:
 * replay may allow them, while every new publication must reject them.
 */
export function currentExecutionPlanCapabilityViolation(
  plan: CompiledExecutionPlan,
): string | null {
  if (!plan.executionCapabilities) {
    return 'missing current execution capability declaration';
  }
  if (
    plan.executionCapabilities.scheduling !== 'serial' ||
    plan.executionCapabilities.retry !== 'none' ||
    plan.executionCapabilities.cache !== 'none'
  ) {
    return 'unsupported execution capability declaration';
  }

  const scheduled = plan.dependencyGroups.flatMap((group) => group.unitIds);
  const declared = plan.units.map((unit) => unit.unitId);
  if (plan.dependencyGroups.some((group) => group.unitIds.length !== 1)) {
    return 'serial scheduling requires singleton dependency groups';
  }
  if (
    scheduled.length !== declared.length ||
    scheduled.some((unitId, index) => unitId !== declared[index])
  ) {
    return 'serial schedule must list every unit once in execution order';
  }
  if (Object.keys(plan.boundedRetry).length > 0) {
    return 'retry is disabled but boundedRetry is not empty';
  }
  if (
    plan.cachePolicies !== undefined &&
    Object.keys(plan.cachePolicies).length > 0
  ) {
    return 'cache is disabled but cachePolicies is not empty';
  }
  return null;
}

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
  'authorityRevisionRefs',
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
    /**
     * Identity/Brief execution authorities. Optional only for byte-compatible
     * replay of snapshots written before this additive v1 field existed.
     * Every current compile-finalize producer writes it and it is hash-covered.
     */
    authorityRevisionRefs: z.array(identifierSchema).max(200).optional(),
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


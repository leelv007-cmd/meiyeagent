/**
 * Agent-domain: Proactive Opportunity (V3.1 §25 / V31-24).
 */

import { z } from 'zod';

import {
  agentRunIdSchema,
  agentThreadIdSchema,
  identifierSchema,
  marketingGoalIdSchema,
  merchantResourceIdSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { agentEvidenceRefSchema } from './shared.js';
import { timestampSchema } from './internal.js';

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


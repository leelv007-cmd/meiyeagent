/**
 * Agent-domain: Goal (V3.1 §11).
 */

import { z } from 'zod';

import {
  identifierSchema,
  marketingGoalIdSchema,
  merchantResourceIdSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { agentEvidenceRefSchema } from './shared.js';
import { revisionNumberSchema, timestampSchema } from './internal.js';

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


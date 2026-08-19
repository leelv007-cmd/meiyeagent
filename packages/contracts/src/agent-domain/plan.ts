/**
 * Agent-domain: Plan revision (V3.1 §13).
 */

import { z } from 'zod';

import {
  agentRunIdSchema,
  agentThreadIdSchema,
  harnessReleaseIdSchema,
  identifierSchema,
  marketingGoalIdSchema,
  marketingPlanIdSchema,
  memoryIdSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { agentRevisionRefSchema } from './shared.js';
import {
  hashStringSchema,
  jsonValueSchema,
  positiveRevisionSchema,
  revisionNumberSchema,
  timestampSchema,
} from './internal.js';

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
    /** Identity/Brief and similar execution authorities are not fact usages. */
    authorityRefs: z.array(identifierSchema).max(200).default([]),
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


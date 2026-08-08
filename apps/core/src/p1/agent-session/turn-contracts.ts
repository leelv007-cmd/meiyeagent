/**
 * Agent Session Harness LLM I/O contracts (V31-06 / V3.1 §18–§19).
 *
 * AgentTurnInput = authority for a single control turn.
 * AgentTurnDecision = model final action (retrieval is tools-in-turn, not action).
 * Strict Zod only — no silent defaults on action kinds.
 */

import {
  agentControlLimitsSchema,
  type AgentControlLimits,
} from '@meiye/contracts';
import { z } from 'zod';

export const AGENT_TURN_PHASES = [
  'intent',
  'plan',
  'make',
  'delivered',
  'publish',
] as const;

export type AgentTurnPhase = (typeof AGENT_TURN_PHASES)[number];

export const agentTurnPhaseSchema = z.enum(AGENT_TURN_PHASES);

export const proactiveModeSchema = z.enum([
  'cautious',
  'balanced',
  'proactive',
]);

export type ProactiveMode = z.infer<typeof proactiveModeSchema>;

const revisionRefSchema = z
  .object({
    planId: z.string().min(1).max(200),
    revision: z.number().int().positive().safe(),
  })
  .strict();

const taskRefSchema = z
  .object({
    taskId: z.string().min(1).max(200),
    workflowId: z.string().min(1).max(200),
  })
  .strict();

export const agentTurnInputSchema = z
  .object({
    threadId: z.string().min(1).max(200),
    runId: z.string().min(1).max(200),
    parentRunId: z.string().min(1).max(200).optional(),
    workspaceId: z.string().min(1).max(200),
    actorId: z.string().min(1).max(200),
    phase: agentTurnPhaseSchema,
    merchantMessage: z.string().min(1).max(8_000),
    proactiveMode: proactiveModeSchema,
    /**
     * D-175 free vs customized fact layering (V31-07).
     * free: store/project facts waived; never invent store claims.
     */
    creationMode: z.enum(['customized', 'free']).optional(),
    sessionRevision: z.number().int().nonnegative().safe(),
    activePlanRef: revisionRefSchema.optional(),
    activeTaskRef: taskRefSchema.optional(),
    /** Server-owned allowlist only — never trust client tool names alone. */
    approvedToolNames: z.array(z.string().min(1).max(200)).max(100),
    limits: agentControlLimitsSchema,
    harnessReleaseId: z.string().min(1).max(200),
  })
  .strict();

export type AgentTurnInput = z.infer<typeof agentTurnInputSchema>;

/** Minimal MerchantQuestion for turn decision (V31-07 expands UX). */
export const merchantQuestionSchema = z
  .object({
    itemId: z.string().min(1).max(200),
    question: z.string().min(1).max(2_000),
    options: z
      .array(
        z
          .object({
            label: z.string().min(1).max(500),
            description: z.string().min(1).max(1_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12)
      .optional(),
  })
  .strict();

export type MerchantQuestion = z.infer<typeof merchantQuestionSchema>;

/** PlanProposal: strategy only — no quote/rights/availability (V3.1 §19.2). */
export const planProposalSchema = z
  .object({
    goalNarrative: z.string().min(1).max(2_000),
    whyNow: z.string().min(1).max(2_000).optional(),
    recommendedDeliverables: z
      .array(
        z
          .object({
            carrier: z.enum(['copy', 'note', 'media']),
            platform: z.string().min(1).max(100).optional(),
            quantity: z.number().int().positive().max(50),
            purpose: z.string().min(1).max(500).optional(),
            rationale: z.string().min(1).max(1_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    expressionStrategy: z
      .object({
        voice: z.string().min(1).max(500).optional(),
        openingMechanism: z.string().min(1).max(500).optional(),
        narrativeStructure: z.string().min(1).max(500).optional(),
        promotionIntensity: z.string().min(1).max(100).optional(),
        cta: z.string().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
    factIntentions: z.array(z.string().min(1).max(500)).max(50).optional(),
    assetIntentions: z.array(z.string().min(1).max(500)).max(50).optional(),
    assumptions: z
      .array(
        z
          .object({
            key: z.string().min(1).max(100),
            statement: z.string().min(1).max(1_000),
            risk: z.enum(['low', 'medium', 'high']).optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export type PlanProposal = z.infer<typeof planProposalSchema>;

export const planPatchProposalSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    instructions: z.string().min(1).max(4_000),
  })
  .strict();

export type PlanPatchProposal = z.infer<typeof planPatchProposalSchema>;

export const makeSteeringProposalSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    instructions: z.string().min(1).max(4_000),
  })
  .strict();

export type MakeSteeringProposal = z.infer<typeof makeSteeringProposalSchema>;

export const experienceCandidateSchema = z
  .object({
    statement: z.string().min(1).max(2_000),
    kind: z.enum(['preference', 'procedural', 'correction']).optional(),
  })
  .strict();

export type ExperienceCandidate = z.infer<typeof experienceCandidateSchema>;

export const agentTurnActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ask_merchant'),
      question: merchantQuestionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('propose_plan'),
      proposal: planProposalSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('patch_plan'),
      patch: planPatchProposalSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('steer_make'),
      patch: makeSteeringProposalSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('propose_experience'),
      candidates: z.array(experienceCandidateSchema).min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal('finish_turn'),
    })
    .strict(),
]);

export type AgentTurnAction = z.infer<typeof agentTurnActionSchema>;

export const agentTurnDecisionSchema = z
  .object({
    merchantMessage: z.string().min(1).max(8_000),
    action: agentTurnActionSchema,
    evidenceRefs: z.array(z.string().min(1).max(500)).max(100),
    assumptions: z
      .array(
        z
          .object({
            key: z.string().min(1).max(100),
            statement: z.string().min(1).max(1_000),
            risk: z.enum(['low', 'medium', 'high']),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type AgentTurnDecision = z.infer<typeof agentTurnDecisionSchema>;

export function parseAgentTurnInput(value: unknown): AgentTurnInput {
  return agentTurnInputSchema.parse(value);
}

export function parseAgentTurnDecision(value: unknown): AgentTurnDecision {
  return agentTurnDecisionSchema.parse(value);
}

export type { AgentControlLimits };

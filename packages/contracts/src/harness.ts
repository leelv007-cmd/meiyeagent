import { z } from 'zod';

import {
  assistantContextSchema,
  assistantFieldPatchBaseSchema,
} from './p1.js';
import { hotTopicOpportunityCardSchema } from './marketing-package.js';

const harnessIdSchema = z.string().trim().min(1);
const harnessTimestampSchema = z.iso.datetime();
const workflowRevisionSchema = z.number().int().nonnegative();

export const HARNESS_STAGES = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
] as const;

export const harnessStageSchema = z.enum(HARNESS_STAGES);
export const workflowStateSchema = z.enum([
  'waiting',
  'running',
  'suspended',
  'success',
  'failed',
]);

export const creationModeSchema = z.enum(['customized', 'free']);

export const taskIntentInputSchema = z
  .object({
    context: assistantContextSchema,
    assetReferences: z.array(harnessIdSchema).max(50),
  })
  .strict();

export const harnessTaskSubmissionSchema = z
  .object({
    taskId: harnessIdSchema,
    packageId: harnessIdSchema,
    expectedRevision: workflowRevisionSchema,
    workflowRevision: workflowRevisionSchema,
    creationMode: creationModeSchema,
    rawInput: z.string().trim().min(1).max(4_000),
    intent: taskIntentInputSchema,
  })
  .strict();

export const assistantPatchDecisionSchema = z
  .object({
    state: z.enum(['pending', 'accepted', 'editing', 'ignored']),
    value: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const structuredDecisionInputSchema = z
  .object({
    idempotencyKey: harnessIdSchema,
    questionId: harnessIdSchema,
    workflowRevision: workflowRevisionSchema,
    patch: assistantFieldPatchBaseSchema,
    decision: assistantPatchDecisionSchema,
  })
  .strict();

/**
 * Browser-observed Day-0 product metrics. The server binds these values to the
 * authenticated workspace + Harness task before writing the audit/outbox fact.
 */
export const firstUsableDraftMetricSchema = z
  .object({
    idempotencyKey: harnessIdSchema.max(200),
    path: z.enum(['canonical_mouse', 'keyboard', 'conflict']),
    timeToFirstUsableDraftMs: z.number().int().nonnegative().max(3_600_000),
    userActivationCount: z.number().int().nonnegative().max(100),
  })
  .strict();

export const chipsSignalInputSchema = z
  .object({
    chipId: harnessIdSchema,
    kind: z.enum(['adopted', 'modified', 'rejected']),
    taskId: harnessIdSchema,
    value: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const workflowProgressEnvelopeSchema = z
  .object({
    eventId: harnessIdSchema,
    workflowId: harnessIdSchema,
    workflowType: harnessIdSchema,
    sequence: z.number().int().nonnegative(),
    sourceRevision: workflowRevisionSchema.optional(),
    stage: harnessStageSchema,
    state: workflowStateSchema,
    occurredAt: harnessTimestampSchema,
    message: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const workflowProgressFrameSchema = z
  .object({
    event: z.literal('workflow.progress'),
    data: workflowProgressEnvelopeSchema,
  })
  .strict();

/**
 * Merchant-visible copy channels. Candidate identity stays separate so a
 * consumer can render multiple drafts without concatenating their deltas.
 */
export const workflowTokenChannelSchema = z.enum([
  'copy.title',
  'copy.body',
  'copy.cta',
]);

export const workflowTokenEnvelopeSchema = z
  .object({
    eventId: harnessIdSchema,
    workflowId: harnessIdSchema,
    sequence: z.number().int().nonnegative(),
    sourceRevision: workflowRevisionSchema.optional(),
    candidateId: harnessIdSchema,
    channel: workflowTokenChannelSchema,
    delta: z.string().min(1).max(8_000),
    occurredAt: harnessTimestampSchema,
  })
  .strict();

export const workflowTokenFrameSchema = z
  .object({
    event: z.literal('workflow.token'),
    data: workflowTokenEnvelopeSchema,
  })
  .strict();

export const workflowStateEnvelopeSchema = z
  .object({
    workflowId: harnessIdSchema,
    sourceRevision: workflowRevisionSchema,
    status: workflowStateSchema,
    occurredAt: harnessTimestampSchema,
    snapshot: z.record(z.string(), z.unknown()),
  })
  .strict();

export const workflowStateFrameSchema = z
  .object({
    event: z.literal('workflow.state'),
    data: workflowStateEnvelopeSchema,
  })
  .strict();

export const questionCardSchema = z
  .object({
    questionId: harnessIdSchema,
    workflowId: harnessIdSchema,
    workflowRevision: workflowRevisionSchema,
    question: z.string().trim().min(1).max(2_000),
    options: z
      .array(
        z
          .object({
            id: harnessIdSchema,
            label: z.string().trim().min(1).max(500),
            description: z.string().trim().min(1).max(1_000).optional(),
          })
          .strict()
      )
      .max(12),
    freeText: z
      .object({
        enabled: z.boolean(),
        placeholder: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
    response: z
      .object({
        field: harnessIdSchema.max(200),
        reason: z.string().trim().min(1).max(500),
      })
      .strict(),
    continuation: z
      .object({
        autoContinue: z.boolean(),
        timeoutSeconds: z.number().int().positive().max(3_600),
        defaultValue: z.string().trim().min(1).max(2_000),
        pauseOnEdit: z.literal(true),
        blocker: z
          .enum([
            'editing_paused',
            'quota_confirmation_required',
            'external_side_effect_confirmation_required',
          ])
          .nullable(),
      })
      .strict()
      .optional(),
    scope: z.enum(['current_task', 'current_series', 'workspace']),
  })
  .strict()
  .superRefine((card, context) => {
    if (card.options.length === 0 && !card.freeText.enabled) {
      context.addIssue({
        code: 'custom',
        message: 'A question card must offer options or free-text input.',
        path: ['freeText', 'enabled'],
      });
    }
    if (!card.freeText.enabled && card.freeText.placeholder) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled free-text input cannot have a placeholder.',
        path: ['freeText', 'placeholder'],
      });
    }
    if (
      card.continuation &&
      card.continuation.autoContinue !== (card.continuation.blocker === null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Question auto-continuation must agree with its safety blocker.',
        path: ['continuation', 'autoContinue'],
      });
    }
  });

export const contentPackageRevisionDeliverySchema = z
  .object({
    packageId: harnessIdSchema,
    versionId: harnessIdSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const todayRecommendationSchema = z
  .object({
    workspaceId: harnessIdSchema,
    taskId: harnessIdSchema,
    factsRevision: workflowRevisionSchema,
    packageId: harnessIdSchema,
    versionId: harnessIdSchema,
    title: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(20_000),
    whyNow: z.string().trim().min(1).max(2_000),
    factReferences: z.array(harnessIdSchema).min(1).max(100),
    customerAction: z.string().trim().min(1).max(2_000),
    sourceLabel: z.string().trim().min(1).max(2_000),
    createdAt: harnessTimestampSchema,
    opportunity: hotTopicOpportunityCardSchema.optional(),
  })
  .strict();

export const todayRecommendationStateSchema = z
  .object({
    workspaceId: harnessIdSchema,
    currentFactsRevision: workflowRevisionSchema,
    recommendation: todayRecommendationSchema.nullable(),
    stale: z.boolean(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.currentFactsRevision === 0 && state.recommendation) {
      context.addIssue({
        code: 'custom',
        message: 'A zero-fact workspace cannot expose a current recommendation.',
        path: ['recommendation'],
      });
    }
    if (
      state.recommendation &&
      (state.recommendation.workspaceId !== state.workspaceId ||
        state.recommendation.factsRevision !== state.currentFactsRevision)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A current recommendation must match workspace and fact revision.',
        path: ['recommendation'],
      });
    }
    if (state.stale && state.recommendation) {
      context.addIssue({
        code: 'custom',
        message: 'A stale recommendation cannot be exposed as current.',
        path: ['recommendation'],
      });
    }
  });

export type HarnessStage = z.infer<typeof harnessStageSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type CreationMode = z.infer<typeof creationModeSchema>;
export type TaskIntentInput = z.infer<typeof taskIntentInputSchema>;
export type HarnessTaskSubmission = z.infer<
  typeof harnessTaskSubmissionSchema
>;
export type AssistantPatchDecision = z.infer<
  typeof assistantPatchDecisionSchema
>;
export type StructuredDecisionInput = z.infer<
  typeof structuredDecisionInputSchema
>;
export type FirstUsableDraftMetric = z.infer<
  typeof firstUsableDraftMetricSchema
>;
export type ChipsSignalInput = z.infer<typeof chipsSignalInputSchema>;
export type WorkflowProgressEnvelope = z.infer<
  typeof workflowProgressEnvelopeSchema
>;
export type WorkflowProgressFrame = z.infer<typeof workflowProgressFrameSchema>;
export type WorkflowTokenChannel = z.infer<typeof workflowTokenChannelSchema>;
export type WorkflowTokenEnvelope = z.infer<
  typeof workflowTokenEnvelopeSchema
>;
export type WorkflowTokenFrame = z.infer<typeof workflowTokenFrameSchema>;
export type WorkflowStateEnvelope = z.infer<typeof workflowStateEnvelopeSchema>;
export type WorkflowStateFrame = z.infer<typeof workflowStateFrameSchema>;
export type QuestionCard = z.infer<typeof questionCardSchema>;
export type ContentPackageRevisionDelivery = z.infer<
  typeof contentPackageRevisionDeliverySchema
>;
export type TodayRecommendation = z.infer<typeof todayRecommendationSchema>;
export type TodayRecommendationState = z.infer<
  typeof todayRecommendationStateSchema
>;

import { z } from 'zod';

import {
  assistantContextSchema,
  assistantFieldPatchBaseSchema,
} from './p1.js';
import {
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
} from './agent-primitives.js';
import { hotTopicOpportunityCardSchema } from './marketing-package.js';
import { actionUsageSchema } from './observability-event.js';

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

/**
 * 商家申报 — what a merchant is told when a run does not end the way it was
 * meant to (D-096/D-116/D-122). Kept as a first-class envelope field rather
 * than as free text inside the snapshot: the browser must be able to render a
 * 申报卡 without reading Core's internal failure shape, and a category plus a
 * closed set of recovery actions is what lets it offer a way forward instead of
 * a dead end.
 *
 * `partial` is the 诚实交付 track: part of the deliverable landed, the rest did
 * not, and the run still ends in `success` because the merchant has something
 * usable in hand.
 */
export const merchantReportKindSchema = z.enum(['failure', 'partial']);

export const merchantReportCategorySchema = z.enum([
  'media_generation',
  'exact_text',
  'content_source',
  'consistency',
  'timeout',
  'unknown',
]);

/** What the merchant can do next. The browser maps each to one entry. */
export const merchantRecoveryActionSchema = z.enum([
  'retry',
  'adjust_intent',
  'switch_form',
  'review_partial',
]);

export const merchantReportSchema = z
  .object({
    kind: merchantReportKindSchema,
    category: merchantReportCategorySchema,
    /** 白话原因 — never an error code, never an internal identifier. */
    message: z.string().trim().min(1).max(2_000),
    /** 下一步动作, stated as a sentence the merchant can act on. */
    nextStep: z.string().trim().min(1).max(2_000),
    actions: z.array(merchantRecoveryActionSchema).min(1).max(4),
    /** True when the reserved 额度 went back — stated, never implied. */
    quotaRefunded: z.boolean(),
  })
  .strict();

export const workflowStateEnvelopeSchema = z
  .object({
    workflowId: harnessIdSchema,
    sourceRevision: workflowRevisionSchema,
    status: workflowStateSchema,
    occurredAt: harnessTimestampSchema,
    snapshot: z.record(z.string(), z.unknown()),
    merchantReport: merchantReportSchema.optional(),
    actionUsage: actionUsageSchema.optional(),
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
    /** Missing means hold; only an explicit continue may auto-release. */
    unattended: z.enum(['continue', 'hold']).optional(),
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
  });

export const questionCardUnattendedSchema = z.enum(['continue', 'hold']);

/**
 * Missing is the backwards-compatible fail-closed value. Producers should
 * write the field explicitly; consumers must never interpret absence as
 * permission to continue.
 */
export function questionCardUnattended<T extends object>(
  question: T & { unattended?: QuestionCardUnattended }
) {
  return question.unattended ?? 'hold';
}

export const confirmationCardTimeoutSecondsSchema = z
  .number()
  .int()
  .min(1)
  .max(3_600);

const executionConfirmationParamSchema = z
  .object({
    key: z.enum([
      'model',
      'aspectRatio',
      'quantity',
      'durationSeconds',
      'destination',
      'deliverable',
    ]),
    label: z.string().trim().min(1).max(500),
    value: z.string().trim().min(1).max(1_000),
    hint: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

export const executionConfirmationRequestSchema = z
  .object({
    requestId: harnessIdSchema,
    runId: harnessIdSchema,
    step: z.literal('execution_selection'),
    revision: workflowRevisionSchema,
    kind: z.literal('execution_confirmation'),
    frozen: z
      .object({
        executionSnapshotRef: z
          .object({
            id: harnessIdSchema,
            revision: workflowRevisionSchema,
          })
          .strict(),
        quoteRevision: harnessIdSchema,
        params: z.array(executionConfirmationParamSchema).max(12),
        debitPreview: z
          .array(
            z
              .object({
                resource: z.enum(['copy', 'image', 'video']),
                quantity: z.number().int().positive(),
              })
              .strict()
          )
          .max(3),
        condition: z
          .object({
            kind: z.enum([
              'existing_gate',
              'quote_threshold',
              'external_action',
            ]),
            required: z.boolean(),
            serverEvaluated: z.literal(true),
          })
          .strict(),
        timeoutPolicy: z.union([
          z.object({ kind: z.literal('hold') }).strict(),
          z
            .object({
              kind: z.literal('semantic_default'),
              timeoutSeconds: confirmationCardTimeoutSecondsSchema,
            })
            .strict(),
        ]),
      })
      .strict(),
    presentation: z
      .object({
        carriers: z
          .array(z.enum(['conversation', 'task_card']))
          .min(1)
          .max(2),
        notification: z.literal('none'),
        renderer: z.literal('execution_confirmation'),
      })
      .strict(),
  })
  .strict();

export const executionConfirmationAnswerSchema = z
  .object({
    requestId: harnessIdSchema,
    revision: workflowRevisionSchema,
    idempotencyKey: harnessIdSchema,
    resume: z
      .object({
        runId: harnessIdSchema,
        step: z.literal('execution_selection'),
      })
      .strict(),
    response: z.union([
      z.object({ kind: z.literal('approved') }).strict(),
      z
        .object({
          kind: z.literal('rejected'),
          feedback: z.string().trim().min(1).max(2_000).optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const harnessInteractionRequestSchema = z.union([
  askMerchantQuestionRequestSchema,
  executionConfirmationRequestSchema,
]);

export const harnessInteractionAnswerSchema = z.union([
  askMerchantAnswerSchema,
  executionConfirmationAnswerSchema,
]);

export const harnessDecisionResolutionSourceSchema = z.enum([
  'decision',
  'core_timeout',
  'core_hold_expired',
  'system_default',
  'late_answer',
]);

/**
 * Read model for the decision endpoint. The timeout is a Core projection of
 * the same admin-config value used by the durable recv. A null timeout means
 * Core did not arm automatic continuation; `hold` never carries a countdown.
 */
export const harnessDecisionSnapshotSchema = z
  .object({
    question: questionCardSchema.nullable(),
    resolutionSource: harnessDecisionResolutionSourceSchema.nullable(),
    status: z.enum(['absent', 'pending', 'resolved']),
    timeoutSeconds: confirmationCardTimeoutSecondsSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.status === 'absent') {
      if (
        snapshot.question !== null ||
        snapshot.resolutionSource !== null ||
        snapshot.timeoutSeconds !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'An absent decision snapshot cannot carry decision data.',
        });
      }
      return;
    }

    if (snapshot.status === 'pending' && snapshot.resolutionSource !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A pending decision cannot have a resolution source.',
        path: ['resolutionSource'],
      });
    }
    if (snapshot.status === 'resolved' && snapshot.resolutionSource === null) {
      context.addIssue({
        code: 'custom',
        message: 'A resolved decision requires a resolution source.',
        path: ['resolutionSource'],
      });
    }

    if (!snapshot.question) {
      if (snapshot.status === 'pending') {
        context.addIssue({
          code: 'custom',
          message: 'A pending decision requires its question.',
          path: ['question'],
        });
      }
      if (snapshot.timeoutSeconds !== null) {
        context.addIssue({
          code: 'custom',
          message: 'A snapshot without a question cannot carry a timeout.',
          path: ['timeoutSeconds'],
        });
      }
      return;
    }

    const unattended = questionCardUnattended(snapshot.question);
    if (unattended === 'hold' && snapshot.timeoutSeconds !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A held question cannot carry a browser countdown.',
        path: ['timeoutSeconds'],
      });
    }
  });

export const harnessDecisionSubmitResultSchema = z.union([
  z
    .object({
      consumedByOther: z.literal(true),
      eventId: z.null(),
    })
    .strict(),
  z
    .object({
      eventId: harnessIdSchema,
      replayed: z.boolean(),
      successor: z
        .object({
          snapshotId: harnessIdSchema,
          workflowId: harnessIdSchema,
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

/**
 * 时间桥把手 (D-145). A run that is still on the server after the browser went
 * away. The server is the only truth: the browser re-subscribes to the event
 * log and rebuilds the transcript from the replay, so this list carries only
 * what is needed to *re-open* the conversation — never a second copy of it.
 */
export const harnessActiveTaskSchema = z
  .object({
    taskId: harnessIdSchema,
    workId: harnessIdSchema,
    packageId: harnessIdSchema,
    /** What the merchant typed to start the run — rebuilds the first turn. */
    merchantText: z.string().trim().min(1).max(4_000),
    submittedAt: harnessTimestampSchema,
  })
  .strict();

export const harnessActiveTaskListSchema = z
  .object({
    tasks: z.array(harnessActiveTaskSchema).max(20),
  })
  .strict();

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
export type MerchantReportKind = z.infer<typeof merchantReportKindSchema>;
export type MerchantReportCategory = z.infer<
  typeof merchantReportCategorySchema
>;
export type MerchantRecoveryAction = z.infer<
  typeof merchantRecoveryActionSchema
>;
export type MerchantReport = z.infer<typeof merchantReportSchema>;
export type HarnessActiveTask = z.infer<typeof harnessActiveTaskSchema>;
export type HarnessActiveTaskList = z.infer<typeof harnessActiveTaskListSchema>;
export type WorkflowStateEnvelope = z.infer<typeof workflowStateEnvelopeSchema>;
export type WorkflowStateFrame = z.infer<typeof workflowStateFrameSchema>;
export type QuestionCard = z.infer<typeof questionCardSchema>;
export type QuestionCardUnattended = z.infer<
  typeof questionCardUnattendedSchema
>;
export type ExecutionConfirmationRequest = z.infer<
  typeof executionConfirmationRequestSchema
>;
export type ExecutionConfirmationAnswer = z.infer<
  typeof executionConfirmationAnswerSchema
>;
export type HarnessInteractionRequest = z.infer<
  typeof harnessInteractionRequestSchema
>;
export type HarnessInteractionAnswer = z.infer<
  typeof harnessInteractionAnswerSchema
>;
export type HarnessDecisionResolutionSource = z.infer<
  typeof harnessDecisionResolutionSourceSchema
>;
export type HarnessDecisionSnapshot = z.infer<
  typeof harnessDecisionSnapshotSchema
>;
export type HarnessDecisionSubmitResult = z.infer<
  typeof harnessDecisionSubmitResultSchema
>;
export type ContentPackageRevisionDelivery = z.infer<
  typeof contentPackageRevisionDeliverySchema
>;
export type TodayRecommendation = z.infer<typeof todayRecommendationSchema>;
export type TodayRecommendationState = z.infer<
  typeof todayRecommendationStateSchema
>;

import { z } from 'zod';
import { identifierSchema, nonEmptyTrimmedStringSchema } from './identifiers.js';

import {
  assistantContextSchema,
  assistantFieldPatchBaseSchema,
} from './p1.js';
import {
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
  interactionTimeoutPolicySchema,
} from './agent-primitives.js';
import { hotTopicOpportunityCardSchema } from './marketing-package.js';
import { actionUsageSchema } from './observability-event.js';

const harnessIdSchema = identifierSchema;
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
const workflowStateSchema = z.enum([
  'waiting',
  'running',
  'suspended',
  'success',
  'failed',
]);

export const creationModeSchema = z.enum(['customized', 'free']);

/**
 * Merchant-confirmed Skill revision refs for one Composer draft.
 * Optional on input; parse always yields an array (default empty) so
 * undefined never leaks downstream. Keep strict at every carrier.
 */
export const userSelectedSkillRefsSchema = z
  .array(nonEmptyTrimmedStringSchema.max(200))
  .max(50)
  .default([]);

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
    rawInput: nonEmptyTrimmedStringSchema.max(4_000),
    intent: taskIntentInputSchema,
    userSelectedSkillRefs: userSelectedSkillRefsSchema,
  })
  .strict();

export const assistantPatchDecisionSchema = z
  .object({
    state: z.enum(['pending', 'accepted', 'editing', 'ignored']),
    value: nonEmptyTrimmedStringSchema.max(2_000),
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

export const harnessExperienceBasisSchema = z
  .object({
    taskId: harnessIdSchema,
    contextBundleId: harnessIdSchema,
    contextBundleRevision: z.number().int().positive(),
    confirmedPreferences: z.array(
      z
        .object({
          sourceRef: harnessIdSchema,
          label: nonEmptyTrimmedStringSchema,
          value: z.json(),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * Optional note-plan outline projection for running-phase timeline hydration.
 * Backward compatible: absent on historical frames / non-note stages.
 */
const workflowProgressNotePlanPreviewSchema = z
  .object({
    styleId: harnessIdSchema,
    styleName: nonEmptyTrimmedStringSchema.max(200),
    themeAnchor: nonEmptyTrimmedStringSchema.max(500),
    pages: z
      .array(
        z
          .object({
            pageId: harnessIdSchema,
            order: z.number().int().positive().max(20),
            pageRole: z.enum([
              'cover',
              'pain_scene',
              'solution_show',
              'work_case',
              'price_offer',
              'cta_guide',
            ]),
            title: nonEmptyTrimmedStringSchema.max(200),
            body: nonEmptyTrimmedStringSchema.max(4_000),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict();

/**
 * Optional note outline summary for paid-media execution confirmation.
 * Backward compatible: absent for copy/image/video paths.
 */
const executionConfirmationOutlineSchema = z
  .object({
    pageCount: z.number().int().positive().max(20),
    pages: z
      .array(
        z
          .object({
            order: z.number().int().positive().max(20),
            title: nonEmptyTrimmedStringSchema.max(200),
          })
          .strict()
      )
      .min(1)
      .max(20),
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
    message: nonEmptyTrimmedStringSchema.max(2_000).optional(),
    experienceBasis: harnessExperienceBasisSchema.optional(),
    /**
     * Per-page note image progress (#319 L1-2). Absent = batch-level frame
     * (legacy consumers keep treating stage/state for all pages).
     */
    pageId: harnessIdSchema.optional(),
    /** Outline projection so the running-phase timeline can mount (L1-3). */
    notePlanPreview: workflowProgressNotePlanPreviewSchema.optional(),
  })
  .strict()
  .superRefine((progress, context) => {
    if (!progress.experienceBasis) return;
    if (
      progress.stage !== 'context_injection' ||
      progress.state !== 'success'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Experience basis may only ride successful context injection progress.',
        path: ['experienceBasis'],
      });
    }
    if (progress.experienceBasis.taskId !== progress.workflowId) {
      context.addIssue({
        code: 'custom',
        message: 'Experience basis task must match the workflow.',
        path: ['experienceBasis', 'taskId'],
      });
    }
  });

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
const workflowTokenChannelSchema = z.enum([
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
const merchantReportKindSchema = z.enum(['failure', 'partial']);

const merchantReportCategorySchema = z.enum([
  'media_generation',
  'exact_text',
  'content_source',
  'consistency',
  'timeout',
  'unknown',
]);

/** What the merchant can do next. The browser maps each to one entry. */
const merchantRecoveryActionSchema = z.enum([
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
    message: nonEmptyTrimmedStringSchema.max(2_000),
    /** 下一步动作, stated as a sentence the merchant can act on. */
    nextStep: nonEmptyTrimmedStringSchema.max(2_000),
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
    question: nonEmptyTrimmedStringSchema.max(2_000),
    options: z
      .array(
        z
          .object({
            id: harnessIdSchema,
            label: nonEmptyTrimmedStringSchema.max(500),
            description: nonEmptyTrimmedStringSchema.max(1_000).optional(),
          })
          .strict()
      )
      .max(12),
    freeText: z
      .object({
        enabled: z.boolean(),
        placeholder: nonEmptyTrimmedStringSchema.max(500).optional(),
      })
      .strict(),
    response: z
      .object({
        field: harnessIdSchema.max(200),
        reason: nonEmptyTrimmedStringSchema.max(500),
      })
      .strict(),
    /** Missing means hold; only an explicit continue may auto-release. */
    unattended: z.enum(['continue', 'hold']).optional(),
    semanticDefaultAuthority: z
      .object({
        kind: z.literal('non_resource_no_effect'),
        source: z.literal('intent_gap'),
        revision: z.literal('intent-gap/v1'),
      })
      .strict()
      .optional(),
    executionConfirmationAuthority: z
      .object({
        kind: z.literal('external_action'),
        revision: z.literal('execution-external-action/v1'),
        /** Credits already reserved by the server before the card is shown. */
        reservedCredits: z.number().int().positive().optional(),
        /** Note paid-media outline summary for the confirm card (L1-4). */
        outline: executionConfirmationOutlineSchema.optional(),
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
  });

const questionCardUnattendedSchema = z.enum(['continue', 'hold']);

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
    label: nonEmptyTrimmedStringSchema.max(500),
    value: nonEmptyTrimmedStringSchema.max(1_000),
    hint: nonEmptyTrimmedStringSchema.max(1_000).nullable(),
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
        /** Optional note outline rows for confirm-card display (L1-4). */
        outline: executionConfirmationOutlineSchema.optional(),
        /** Server-owned credit hold backing this exact confirmation attempt. */
        reservedCredits: z.number().int().positive().optional(),
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
              'unknown',
            ]),
            required: z.boolean(),
            serverEvaluated: z.literal(true),
          })
          .strict(),
        timeoutPolicy: interactionTimeoutPolicySchema,
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
          feedback: nonEmptyTrimmedStringSchema.max(2_000).optional(),
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

export const harnessInteractionRendererAckSchema = z
  .object({
    requestId: harnessIdSchema,
    revision: workflowRevisionSchema,
    step: harnessIdSchema,
    carrier: z.enum(['conversation', 'store_page', 'task_card']),
  })
  .strict();

export const harnessInteractionEditingSchema =
  harnessInteractionRendererAckSchema.extend({
    editing: z.boolean(),
    editingSessionId: harnessIdSchema,
  });

export const harnessInteractionMerchantMessageSchema = z
  .object({
    requestId: harnessIdSchema,
    revision: workflowRevisionSchema,
    step: z.literal('execution_selection'),
    carrier: z.enum(['conversation', 'store_page', 'task_card']),
    idempotencyKey: harnessIdSchema,
    message: nonEmptyTrimmedStringSchema.max(2_000),
  })
  .strict();

const harnessDecisionResolutionSourceSchema = z.enum([
  'decision',
  'core_timeout',
  'core_hold_expired',
  'system_default',
  'late_answer',
  'reservation_released',
]);

/**
 * Read model for the decision endpoint. The timeout is a Core projection of
 * the same admin-config value used by the durable recv. A null timeout means
 * Core did not arm automatic continuation; `hold` never carries a countdown.
 */
export const harnessDecisionSnapshotSchema = z
  .object({
    question: questionCardSchema.nullable(),
    reservationReleased: z.boolean().default(false),
    resolutionSource: harnessDecisionResolutionSourceSchema.nullable(),
    status: z.enum(['absent', 'pending', 'resolved']),
    timeoutSeconds: confirmationCardTimeoutSecondsSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.status === 'absent') {
      if (
        snapshot.question !== null ||
        snapshot.reservationReleased ||
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
const harnessActiveTaskSchema = z
  .object({
    taskId: harnessIdSchema,
    workId: harnessIdSchema,
    packageId: harnessIdSchema,
    /** Exact semantic conversation authority for cross-device Composer replay. */
    agentThreadId: harnessIdSchema.optional(),
    /** Present for current Composer runs; legacy thread-only runs remain readable. */
    agentRunId: harnessIdSchema.optional(),
    /** Paid plan authority needed to restore the same confirmation card. */
    executionConfirmationRequestId: harnessIdSchema.optional(),
    /** What the merchant typed to start the run — rebuilds the first turn. */
    merchantText: nonEmptyTrimmedStringSchema.max(4_000),
    submittedAt: harnessTimestampSchema,
  })
  .strict()
  .superRefine((task, context) => {
    if (task.agentRunId && !task.agentThreadId) {
      context.addIssue({
        code: 'custom',
        path: ['agentThreadId'],
        message: 'agentRunId requires agentThreadId.',
      });
    }
  });

/**
 * V31-105 §12 — 时间桥的第二根把手：刚跑完的 run。
 *
 * `harnessActiveTaskSchema` only lists what is *still running*, so a run that
 * finished before the tab's first successful read had already left the list for
 * good and the merchant could never get back to it (short fixture runs, or a
 * merchant who reopened the tab a moment late). This is the same handle, for a
 * run whose end the server already recorded: enough to reopen the conversation
 * on its terminal card, never a second copy of the transcript.
 */
const harnessRecentlyCompletedTaskSchema = z
  .object({
    taskId: harnessIdSchema,
    workId: harnessIdSchema,
    packageId: harnessIdSchema,
    agentThreadId: harnessIdSchema.optional(),
    agentRunId: harnessIdSchema.optional(),
    executionConfirmationRequestId: harnessIdSchema.optional(),
    merchantText: nonEmptyTrimmedStringSchema.max(4_000),
    submittedAt: harnessTimestampSchema,
    /** Which terminal card the browser must come back to. */
    outcome: z.enum(['delivered', 'failed']),
    completedAt: harnessTimestampSchema,
    /**
     * Failed runs reopen on the 申报卡. Optional so older Cores that only
     * named the outcome still parse; the browser then remounts a failed
     * session without the card (V31-108 reload).
     */
    merchantReport: merchantReportSchema.optional(),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.agentRunId && !task.agentThreadId) {
      context.addIssue({
        code: 'custom',
        path: ['agentThreadId'],
        message: 'agentRunId requires agentThreadId.',
      });
    }
  });

/**
 * How far back a finished run is still worth reopening.
 *
 * One number, read by the Core query that selects the rows and by every test
 * that reasons about the edge — a window defined twice is a window that drifts.
 * Half an hour is the span in which a merchant who closed the tab is plausibly
 * still working on the same thing; past that, the Result Center is the honest
 * way back, not a conversation that reopens itself.
 */
export const RECENTLY_COMPLETED_RESTORE_WINDOW_MINUTES = 30;

export const harnessActiveTaskListSchema = z
  .object({
    tasks: z.array(harnessActiveTaskSchema).max(20),
    /**
     * Optional so a browser can still read a Core that predates this field:
     * the restore path treats an absent list exactly like an empty one.
     */
    recentlyCompleted: z
      .array(harnessRecentlyCompletedTaskSchema)
      .max(20)
      .default([]),
  })
  .strict();

export const contentPackageRevisionDeliverySchema = z
  .object({
    packageId: harnessIdSchema,
    versionId: harnessIdSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

const todayRecommendationSchema = z
  .object({
    workspaceId: harnessIdSchema,
    taskId: harnessIdSchema,
    factsRevision: workflowRevisionSchema,
    packageId: harnessIdSchema,
    versionId: harnessIdSchema,
    title: nonEmptyTrimmedStringSchema.max(500),
    body: nonEmptyTrimmedStringSchema.max(20_000),
    whyNow: nonEmptyTrimmedStringSchema.max(2_000),
    factReferences: z.array(harnessIdSchema).min(1).max(100),
    customerAction: nonEmptyTrimmedStringSchema.max(2_000),
    sourceLabel: nonEmptyTrimmedStringSchema.max(2_000),
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
/** Request payload input: defaulted fields may be omitted by callers. */
export type HarnessTaskSubmission = z.input<
  typeof harnessTaskSubmissionSchema
>;
export type StructuredDecisionInput = z.infer<
  typeof structuredDecisionInputSchema
>;
export type FirstUsableDraftMetric = z.infer<
  typeof firstUsableDraftMetricSchema
>;
export type HarnessExperienceBasis = z.infer<
  typeof harnessExperienceBasisSchema
>;
export type WorkflowProgressEnvelope = z.infer<
  typeof workflowProgressEnvelopeSchema
>;
export type WorkflowProgressFrame = z.infer<typeof workflowProgressFrameSchema>;
export type WorkflowTokenEnvelope = z.infer<
  typeof workflowTokenEnvelopeSchema
>;
export type WorkflowTokenFrame = z.infer<typeof workflowTokenFrameSchema>;
export type MerchantRecoveryAction = z.infer<
  typeof merchantRecoveryActionSchema
>;
export type MerchantReport = z.infer<typeof merchantReportSchema>;
export type HarnessActiveTask = z.infer<typeof harnessActiveTaskSchema>;
export type HarnessRecentlyCompletedTask = z.infer<
  typeof harnessRecentlyCompletedTaskSchema
>;
export type WorkflowStateEnvelope = z.infer<typeof workflowStateEnvelopeSchema>;
export type WorkflowStateFrame = z.infer<typeof workflowStateFrameSchema>;
export type QuestionCard = z.infer<typeof questionCardSchema>;
type QuestionCardUnattended = z.infer<typeof questionCardUnattendedSchema>;
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
export type HarnessInteractionRendererAck = z.infer<
  typeof harnessInteractionRendererAckSchema
>;
export type HarnessInteractionEditing = z.infer<
  typeof harnessInteractionEditingSchema
>;
export type HarnessInteractionMerchantMessage = z.infer<
  typeof harnessInteractionMerchantMessageSchema
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

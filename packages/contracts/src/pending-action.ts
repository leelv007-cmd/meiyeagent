import { z } from 'zod';

import { pendingApprovalRequestSchema } from './approval-receipt.js';

const idSchema = z.string().trim().min(1);
const pendingActionBaseSchema = z.object({
  createdAt: z.iso.datetime(),
  nodeId: idSchema,
  questionOrApprovalRef: idSchema,
  taskId: idSchema,
  workflowId: idSchema,
  workflowRevision: z.number().int().nonnegative(),
});

export const pendingActionSchema = z.discriminatedUnion('kind', [
  pendingActionBaseSchema
    .extend({
      kind: z.literal('question'),
    })
    .strict(),
  pendingActionBaseSchema
    .extend({
      approvalRequest: pendingApprovalRequestSchema,
      kind: z.literal('approval'),
    })
    .strict(),
]);

export const pendingActionsSchema = z.array(pendingActionSchema);

const actionableInboxEventSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('task_terminal'),
      taskId: idSchema,
      taskStatus: z.enum(['completed', 'failed', 'acceptance_unknown']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('delivery_event'),
      packageId: idSchema,
      eventId: idSchema,
      eventType: z.enum([
        'assisted_handoff_prepared',
        'automatic_publish_result',
        'manual_publish_result',
        'legacy_handoff_event',
      ]),
      deliveryStatus: z.enum(['published', 'failed', 'unknown']).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pending_action'),
      pendingActionKind: z.enum(['question', 'approval']),
      taskId: idSchema,
      questionOrApprovalRef: idSchema,
    })
    .strict(),
]);

export const actionableInboxItemSchema = z
  .object({
    statusKind: z.enum([
      'result_available',
      'needs_choice_or_confirm',
      'acceptance_unknown_recovery',
      'task_failed',
      'delivery_partial_or_unknown',
      'delivery_completed',
    ]),
    createdAt: z.iso.datetime(),
    title: idSchema,
    nextActionLabel: z.enum([
      '查看进度',
      '处理当前问题',
      '继续调整',
      '继续交付',
      '查看结果',
    ]),
    target: z
      .object({
        workId: idSchema,
        contentId: idSchema.optional(),
        versionId: idSchema.optional(),
        panel: z
          .enum(['result', 'adjust', 'delivery', 'history', 'run'])
          .optional(),
        focusKey: idSchema.optional(),
      })
      .strict()
      .optional(),
    eventSource: actionableInboxEventSourceSchema,
    pendingAction: pendingActionSchema.optional(),
    workspaceId: idSchema.optional(),
    contentRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export const pendingActionsResponseSchema = z.array(
  z.union([pendingActionSchema, actionableInboxItemSchema]),
);

export type PendingAction = z.infer<typeof pendingActionSchema>;

/**
 * Actionable inbox types (D-097 / #94).
 * Re-exported here so consumers get them via the frozen contracts barrel
 * without adding a new index.ts export (S1 freeze).
 */
export {
  ACTIONABLE_INBOX_STATUS_LABEL,
  RECENT_DESKTOP_LIMIT,
  RECENT_MOBILE_LIMIT,
  actionableInboxStatusKinds,
  recentNextActionLabels,
  type ActionableInboxEventSource,
  type ActionableInboxItem,
  type ActionableInboxItems,
  type ActionableInboxStatusKind,
  type RecentActivitySource,
  type RecentMedium,
  type RecentNextActionLabel,
  type RecentProjectionItem,
  type RecentViewport,
} from './actionable-inbox.js';

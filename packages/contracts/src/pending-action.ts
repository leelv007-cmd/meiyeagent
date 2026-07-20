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

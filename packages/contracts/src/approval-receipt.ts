import { z } from 'zod';

const idSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime();

export const approvalActionKindSchema = z.enum(['publish', 'paid_action']);
const pendingApprovalRequestBaseSchema = z.object({
  actionKind: approvalActionKindSchema,
  contentPackageRevision: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  id: idSchema,
  nodeId: idSchema,
  packageId: idSchema,
  platform: z.enum(['xiaohongshu', 'douyin', 'video_account']),
  purpose: idSchema,
  taskId: idSchema,
  variantVersionId: idSchema,
  workflowId: idSchema,
  workflowRevision: z.number().int().nonnegative(),
  workspaceId: idSchema,
});
export const pendingApprovalRequestSchema = z.discriminatedUnion('status', [
  pendingApprovalRequestBaseSchema
    .extend({
      status: z.literal('pending'),
    })
    .strict(),
  pendingApprovalRequestBaseSchema
    .extend({
      consumedAt: timestampSchema,
      receiptId: idSchema,
      status: z.literal('consumed'),
    })
    .strict(),
]);
export const approvalReceiptStatusSchema = z.enum([
  'approved',
  'consumed',
  'invalidated',
]);
export const approvalBindingSchema = z
  .object({
    accountId: idSchema,
    actionKind: approvalActionKindSchema,
    actionScheduledAt: timestampSchema,
    contextBundle: z.object({
      bundleId: idSchema,
      hash: idSchema,
      revision: z.number().int().positive(),
    }),
    cost: z.object({
      amount: z.number().nonnegative(),
      currency: z.enum(['CNY', 'USD']),
    }),
    contentRevision: z.number().int().positive(),
    packageId: idSchema,
    platform: z.enum(['xiaohongshu', 'douyin', 'video_account']),
    purpose: idSchema,
    variantVersionId: idSchema,
    workspaceId: idSchema,
  })
  .strict();

export const approvalReceiptEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      actorId: idSchema,
      eventId: idSchema,
      occurredAt: timestampSchema,
      type: z.literal('approved'),
    })
    .strict(),
  z
    .object({
      actorId: idSchema,
      eventId: idSchema,
      externalEffectId: idSchema,
      occurredAt: timestampSchema,
      type: z.literal('consumed'),
    })
    .strict(),
  z
    .object({
      actorId: idSchema,
      eventId: idSchema,
      occurredAt: timestampSchema,
      reason: z.enum([
        'context_invalidated',
        'content_revision_changed',
        'revoked_by_actor',
      ]),
      sourceEventId: idSchema.optional(),
      type: z.literal('invalidated'),
    })
    .strict(),
]);

export const approvalReceiptSchema = z
  .object({
    binding: approvalBindingSchema,
    events: z.array(approvalReceiptEventSchema).min(1),
    expiresAt: timestampSchema.optional(),
    id: idSchema,
    idempotencyKey: idSchema,
    payloadFingerprint: idSchema,
    status: approvalReceiptStatusSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.events[0]?.type !== 'approved') {
      context.addIssue({
        code: 'custom',
        message: 'An ApprovalReceipt must begin with an approval event.',
        path: ['events', 0],
      });
    }
    const terminal = receipt.events.at(-1)?.type;
    if (terminal !== receipt.status) {
      context.addIssue({
        code: 'custom',
        message: 'ApprovalReceipt status must match its latest event.',
        path: ['status'],
      });
    }
  });

export const creativeGenerationApprovalBindingSchema = z
  .object({
    actionKind: z.literal('high_cost_generation'),
    catalogModelId: idSchema,
    catalogRevision: idSchema,
    contractFingerprint: idSchema,
    cost: z.object({
      amount: z.number().nonnegative(),
      currency: idSchema,
    }),
    operation: z.literal('video.generate'),
    purpose: z.literal('creative_generation'),
    quoteRevision: idSchema,
    workId: idSchema,
    workUpdatedAt: timestampSchema,
    workspaceId: idSchema,
  })
  .strict();

export const creativeGenerationApprovalReceiptSchema = z
  .object({
    binding: creativeGenerationApprovalBindingSchema,
    events: z.array(approvalReceiptEventSchema).min(1),
    expiresAt: timestampSchema.optional(),
    id: idSchema,
    idempotencyKey: idSchema,
    payloadFingerprint: idSchema,
    status: approvalReceiptStatusSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.events[0]?.type !== 'approved') {
      context.addIssue({
        code: 'custom',
        message: 'A generation ApprovalReceipt must begin with approval.',
        path: ['events', 0],
      });
    }
    if (receipt.events.at(-1)?.type !== receipt.status) {
      context.addIssue({
        code: 'custom',
        message: 'Generation ApprovalReceipt status must match its latest event.',
        path: ['status'],
      });
    }
  });

export type ApprovalActionKind = z.infer<typeof approvalActionKindSchema>;
export type ApprovalBinding = z.infer<typeof approvalBindingSchema>;
export type PendingApprovalRequest = z.infer<
  typeof pendingApprovalRequestSchema
>;
export type ApprovalReceipt = z.infer<typeof approvalReceiptSchema>;
export type ApprovalReceiptEvent = z.infer<
  typeof approvalReceiptEventSchema
>;
export type CreativeGenerationApprovalReceipt = z.infer<
  typeof creativeGenerationApprovalReceiptSchema
>;

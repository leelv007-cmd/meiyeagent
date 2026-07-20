import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Assisted delivery receipt state machine (D-086 / D-096 / B3).
 *
 * States (honest Chinese product semantics):
 * - materials_ready     资料已准备  — local package prepared; NOT handed over
 * - handed_over         已交接      — materials given to owner/account; NOT published
 * - pending_manual_publish 待人工发布
 * - publish_result_recorded 已记录发布结果 — requires external receipt or manual record
 *
 * "已交接" ≠ "已发布". Automatic publish attempt SM is intentionally absent (D-098 C2).
 */

export const ASSISTED_RECEIPT_STATUSES = [
  'materials_ready',
  'handed_over',
  'pending_manual_publish',
  'publish_result_recorded',
] as const;

export const assistedReceiptStatusSchema = z.enum(ASSISTED_RECEIPT_STATUSES);
export type AssistedReceiptStatus = z.infer<typeof assistedReceiptStatusSchema>;

/** User-facing status labels — keep exact product wording. */
export const ASSISTED_RECEIPT_STATUS_LABEL: Record<
  AssistedReceiptStatus,
  string
> = {
  handed_over: '已交接',
  materials_ready: '资料已准备',
  pending_manual_publish: '待人工发布',
  publish_result_recorded: '已记录发布结果',
};

export const assistedResponsibilityRoleSchema = z.enum([
  'self_publish',
  'external_owner',
]);
export type AssistedResponsibilityRole = z.infer<
  typeof assistedResponsibilityRoleSchema
>;

export const assistedCostRangeSchema = z
  .object({
    currency: z.enum(['CNY', 'USD']),
    maxAmount: z.number().nonnegative(),
    minAmount: z.number().nonnegative(),
  })
  .strict()
  .superRefine((range, context) => {
    if (range.minAmount > range.maxAmount) {
      context.addIssue({
        code: 'custom',
        message: 'Cost range minAmount must be <= maxAmount.',
        path: ['minAmount'],
      });
    }
  });

/**
 * Binding required when materials leave the device (hand_over).
 * Exact platform + account OR owner + revision + purpose + time + cost range +
 * one-shot ApprovalReceipt.
 */
export const assistedReceiptBindingSchema = z
  .object({
    accountId: z.string().trim().min(1).optional(),
    approvalReceiptId: z.string().trim().min(1),
    contentPackageRevision: z.number().int().nonnegative(),
    costRange: assistedCostRangeSchema,
    ownerId: z.string().trim().min(1).optional(),
    packageId: z.string().trim().min(1),
    platform: z.enum(['xiaohongshu', 'douyin', 'video_account']),
    purpose: z.string().trim().min(1),
    responsibilityRole: assistedResponsibilityRoleSchema,
    scheduledAt: z.iso.datetime(),
    variantVersionId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.responsibilityRole === 'self_publish' && !binding.accountId) {
      context.addIssue({
        code: 'custom',
        message: 'self_publish requires accountId.',
        path: ['accountId'],
      });
    }
    if (binding.responsibilityRole === 'external_owner' && !binding.ownerId) {
      context.addIssue({
        code: 'custom',
        message: 'external_owner requires ownerId.',
        path: ['ownerId'],
      });
    }
    if (!binding.accountId && !binding.ownerId) {
      context.addIssue({
        code: 'custom',
        message: 'Binding requires accountId or ownerId.',
        path: ['accountId'],
      });
    }
  });

export type AssistedReceiptBinding = z.infer<
  typeof assistedReceiptBindingSchema
>;

export const assistedPublishResultSourceSchema = z.enum([
  'external_receipt',
  'manual_record',
]);

export const assistedPublishResultSchema = z
  .object({
    note: z.string().trim().min(1).optional(),
    platformUrl: z.url().optional(),
    recordedAt: z.iso.datetime(),
    source: assistedPublishResultSourceSchema,
    status: z.enum(['published', 'failed', 'unknown', 'not_published']),
  })
  .strict();

export type AssistedPublishResult = z.infer<typeof assistedPublishResultSchema>;

export const ONE_SHOT_HANDOFF_LINK_TTL_MS = 72 * 60 * 60 * 1000;
export const PENDING_CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;

export const assistedHandoffLinkSchema = z
  .object({
    consumedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    token: z.string().trim().min(16),
  })
  .strict();

export type AssistedHandoffLink = z.infer<typeof assistedHandoffLinkSchema>;

export const assistedReceiptEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      actorId: z.string().trim().min(1),
      occurredAt: z.iso.datetime(),
      type: z.literal('materials_prepared'),
    })
    .strict(),
  z
    .object({
      actorId: z.string().trim().min(1),
      occurredAt: z.iso.datetime(),
      type: z.literal('handed_over'),
    })
    .strict(),
  z
    .object({
      actorId: z.string().trim().min(1),
      occurredAt: z.iso.datetime(),
      type: z.literal('marked_pending_manual_publish'),
    })
    .strict(),
  z
    .object({
      actorId: z.string().trim().min(1),
      occurredAt: z.iso.datetime(),
      result: assistedPublishResultSchema,
      type: z.literal('publish_result_recorded'),
    })
    .strict(),
  z
    .object({
      occurredAt: z.iso.datetime(),
      type: z.literal('handoff_link_consumed'),
    })
    .strict(),
]);

export type AssistedReceiptEvent = z.infer<typeof assistedReceiptEventSchema>;

export const assistedReceiptSchema = z
  .object({
    binding: assistedReceiptBindingSchema.optional(),
    events: z.array(assistedReceiptEventSchema).min(1),
    exportReceiptId: z.string().trim().min(1).optional(),
    handoffLink: assistedHandoffLinkSchema.optional(),
    id: z.string().trim().min(1),
    packageId: z.string().trim().min(1),
    status: assistedReceiptStatusSchema,
    workspaceId: z.string().trim().min(1),
    publishResult: assistedPublishResultSchema.optional(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.status === 'handed_over' ||
      receipt.status === 'pending_manual_publish' ||
      receipt.status === 'publish_result_recorded'
    ) {
      if (!receipt.binding) {
        context.addIssue({
          code: 'custom',
          message: 'Hand-over and later statuses require a complete binding.',
          path: ['binding'],
        });
      }
    }
    if (receipt.status === 'publish_result_recorded' && !receipt.publishResult) {
      context.addIssue({
        code: 'custom',
        message: 'publish_result_recorded requires a publish result.',
        path: ['publishResult'],
      });
    }
    // Hard invariant: handed_over is never "published".
    if (receipt.status === 'handed_over' && receipt.publishResult) {
      context.addIssue({
        code: 'custom',
        message: 'handed_over must not carry a publish result.',
        path: ['publishResult'],
      });
    }
  });

export type AssistedReceipt = z.infer<typeof assistedReceiptSchema>;

export class AssistedReceiptError extends Error {
  constructor(
    readonly code:
      | 'INVALID_TRANSITION'
      | 'INVALID_BINDING'
      | 'LINK_EXPIRED'
      | 'LINK_ALREADY_CONSUMED'
      | 'LINK_NOT_FOUND'
      | 'RECEIPT_NOT_FOUND'
      | 'PUBLISH_RESULT_REQUIRED'
      | 'NOT_PUBLISHED_WITHOUT_RESULT',
    message: string,
  ) {
    super(message);
    this.name = 'AssistedReceiptError';
  }
}

export type PrepareMaterialsInput = {
  actorId: string;
  exportReceiptId?: string;
  id?: string;
  occurredAt: string;
  packageId: string;
  workspaceId: string;
};

export function prepareAssistedMaterials(
  input: PrepareMaterialsInput,
): AssistedReceipt {
  return assistedReceiptSchema.parse({
    events: [
      {
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        type: 'materials_prepared',
      },
    ],
    ...(input.exportReceiptId
      ? { exportReceiptId: input.exportReceiptId }
      : {}),
    id: input.id ?? `assisted-receipt-${randomUUID()}`,
    packageId: input.packageId,
    status: 'materials_ready',
    workspaceId: input.workspaceId,
  });
}

export type HandOverInput = {
  actorId: string;
  binding: AssistedReceiptBinding;
  occurredAt: string;
  /** When true (default), create a one-shot handoff link with 72h TTL. */
  issueHandoffLink?: boolean;
  linkToken?: string;
};

export function handOverAssistedReceipt(
  receipt: AssistedReceipt,
  input: HandOverInput,
): AssistedReceipt {
  if (receipt.status !== 'materials_ready') {
    throw new AssistedReceiptError(
      'INVALID_TRANSITION',
      `Cannot hand over from status ${receipt.status}.`,
    );
  }
  const binding = assistedReceiptBindingSchema.parse(input.binding);
  if (binding.packageId !== receipt.packageId) {
    throw new AssistedReceiptError(
      'INVALID_BINDING',
      'Binding packageId must match the receipt packageId.',
    );
  }
  if (binding.workspaceId !== receipt.workspaceId) {
    throw new AssistedReceiptError(
      'INVALID_BINDING',
      'Binding workspaceId must match the receipt workspaceId.',
    );
  }

  const issueLink = input.issueHandoffLink !== false;
  const handoffLink = issueLink
    ? createOneShotHandoffLink({
        createdAt: input.occurredAt,
        token: input.linkToken,
      })
    : undefined;

  return assistedReceiptSchema.parse({
    ...receipt,
    binding,
    events: [
      ...receipt.events,
      {
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        type: 'handed_over',
      },
    ],
    ...(handoffLink ? { handoffLink } : {}),
    status: 'handed_over',
  });
}

export function markPendingManualPublish(
  receipt: AssistedReceipt,
  input: { actorId: string; occurredAt: string },
): AssistedReceipt {
  if (
    receipt.status !== 'handed_over' &&
    receipt.status !== 'pending_manual_publish'
  ) {
    throw new AssistedReceiptError(
      'INVALID_TRANSITION',
      `Cannot mark pending manual publish from status ${receipt.status}.`,
    );
  }
  if (receipt.status === 'pending_manual_publish') {
    return receipt;
  }
  return assistedReceiptSchema.parse({
    ...receipt,
    events: [
      ...receipt.events,
      {
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        type: 'marked_pending_manual_publish',
      },
    ],
    status: 'pending_manual_publish',
  });
}

export type RecordPublishResultInput = {
  actorId: string;
  result: AssistedPublishResult;
};

/**
 * Record publish outcome. Requires external receipt or manual record.
 * This is the ONLY transition that can represent "已发布".
 */
export function recordAssistedPublishResult(
  receipt: AssistedReceipt,
  input: RecordPublishResultInput,
): AssistedReceipt {
  if (
    receipt.status !== 'handed_over' &&
    receipt.status !== 'pending_manual_publish'
  ) {
    throw new AssistedReceiptError(
      'INVALID_TRANSITION',
      `Cannot record publish result from status ${receipt.status}.`,
    );
  }
  const result = assistedPublishResultSchema.parse(input.result);
  if (
    result.status === 'published' &&
    result.source !== 'external_receipt' &&
    result.source !== 'manual_record'
  ) {
    throw new AssistedReceiptError(
      'PUBLISH_RESULT_REQUIRED',
      'Published status requires external_receipt or manual_record.',
    );
  }

  return assistedReceiptSchema.parse({
    ...receipt,
    events: [
      ...receipt.events,
      {
        actorId: input.actorId,
        occurredAt: result.recordedAt,
        result,
        type: 'publish_result_recorded',
      },
    ],
    publishResult: result,
    status: 'publish_result_recorded',
  });
}

/**
 * True only when a publish result has been recorded with status published.
 * handed_over / pending_manual_publish are never "published".
 */
export function isAssistedPublished(receipt: AssistedReceipt): boolean {
  return (
    receipt.status === 'publish_result_recorded' &&
    receipt.publishResult?.status === 'published'
  );
}

export function isAssistedHandedOver(receipt: AssistedReceipt): boolean {
  return (
    receipt.status === 'handed_over' ||
    receipt.status === 'pending_manual_publish' ||
    receipt.status === 'publish_result_recorded'
  );
}

export function createOneShotHandoffLink(input: {
  createdAt: string;
  token?: string;
  ttlMs?: number;
}): AssistedHandoffLink {
  const createdAtMs = Date.parse(input.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    throw new AssistedReceiptError(
      'INVALID_BINDING',
      'createdAt must be a valid ISO datetime.',
    );
  }
  const ttlMs = input.ttlMs ?? ONE_SHOT_HANDOFF_LINK_TTL_MS;
  const token =
    input.token ??
    createHash('sha256')
      .update(`${randomUUID()}:${input.createdAt}`)
      .digest('hex')
      .slice(0, 32);
  return assistedHandoffLinkSchema.parse({
    createdAt: input.createdAt,
    expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
    token,
  });
}

export type ConsumeHandoffLinkResult =
  | { kind: 'ok'; receipt: AssistedReceipt }
  | { kind: 'replay'; receipt: AssistedReceipt }
  | { kind: 'expired' }
  | { kind: 'not_found' };

/**
 * One-shot handoff link semantics:
 * - unknown token → not_found
 * - past expiresAt → expired (even if previously unused)
 * - first consume → ok (marks consumedAt)
 * - same token after consume → replay (idempotent, does not re-open)
 */
export function consumeOneShotHandoffLink(
  receipt: AssistedReceipt,
  input: { now: string; token: string },
): ConsumeHandoffLinkResult {
  const link = receipt.handoffLink;
  if (!link || link.token !== input.token) {
    return { kind: 'not_found' };
  }
  const nowMs = Date.parse(input.now);
  const expiresMs = Date.parse(link.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) {
    return { kind: 'expired' };
  }
  if (nowMs > expiresMs) {
    return { kind: 'expired' };
  }
  if (link.consumedAt) {
    return { kind: 'replay', receipt };
  }
  const updated = assistedReceiptSchema.parse({
    ...receipt,
    events: [
      ...receipt.events,
      {
        occurredAt: input.now,
        type: 'handoff_link_consumed',
      },
    ],
    handoffLink: {
      ...link,
      consumedAt: input.now,
    },
  });
  return { kind: 'ok', receipt: updated };
}

export function assertBindingFieldsComplete(
  binding: AssistedReceiptBinding,
): void {
  assistedReceiptBindingSchema.parse(binding);
}

/**
 * Passive inbox projection for 24h pending confirm (event source for B4).
 * Does not create an independent Notification table — pure projection.
 */
export type PendingConfirmInboxItem = {
  assistedReceiptId: string;
  handedOverAt: string;
  packageId: string;
  pendingSince: string;
  platform: AssistedReceiptBinding['platform'];
  purpose: string;
  reason: 'awaiting_confirm_24h';
  responsibilityRole: AssistedResponsibilityRole;
  status: AssistedReceiptStatus;
  workspaceId: string;
};

export function projectPendingConfirmInbox(
  receipts: readonly AssistedReceipt[],
  nowIso: string,
): PendingConfirmInboxItem[] {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [];

  const items: PendingConfirmInboxItem[] = [];
  for (const receipt of receipts) {
    if (
      receipt.status !== 'handed_over' &&
      receipt.status !== 'pending_manual_publish'
    ) {
      continue;
    }
    if (!receipt.binding) continue;
    if (isAssistedPublished(receipt)) continue;

    const handedOver = [...receipt.events]
      .reverse()
      .find((event) => event.type === 'handed_over');
    if (!handedOver || handedOver.type !== 'handed_over') continue;

    const handedOverMs = Date.parse(handedOver.occurredAt);
    if (!Number.isFinite(handedOverMs)) continue;
    if (nowMs - handedOverMs < PENDING_CONFIRM_AFTER_MS) continue;

    items.push({
      assistedReceiptId: receipt.id,
      handedOverAt: handedOver.occurredAt,
      packageId: receipt.packageId,
      pendingSince: new Date(
        handedOverMs + PENDING_CONFIRM_AFTER_MS,
      ).toISOString(),
      platform: receipt.binding.platform,
      purpose: receipt.binding.purpose,
      reason: 'awaiting_confirm_24h',
      responsibilityRole: receipt.binding.responsibilityRole,
      status: receipt.status,
      workspaceId: receipt.workspaceId,
    });
  }

  return items.sort((a, b) => a.pendingSince.localeCompare(b.pendingSince));
}

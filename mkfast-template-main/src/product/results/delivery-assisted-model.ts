/**
 * Assisted handoff UI projection over B3 assisted receipt (#101).
 *
 * Dual responsibility roles, receipt binding, 24h pending confirm,
 * and hard invariant: 已交接 ≠ 已发布.
 */

import {
  ASSISTED_RECEIPT_STATUS_LABEL,
  ASSISTED_RESPONSIBILITY_ROLE_LABEL,
  PENDING_CONFIRM_AFTER_MS,
  assertAssistedBindingComplete,
  isAssistedHandedOver,
  isAssistedPublished,
  type AssistedReceipt,
  type AssistedReceiptBinding,
  type AssistedReceiptStatus,
  type AssistedResponsibilityRole,
} from './delivery-b3-types';

export type AssistedRoleOption = {
  role: AssistedResponsibilityRole;
  label: string;
  /** Field required when this role is selected. */
  requires: 'accountId' | 'ownerId';
};

/** Dual responsibility roles shown in assisted handoff UI. */
export function assistedResponsibilityRoleOptions(): AssistedRoleOption[] {
  return [
    {
      role: 'self_publish',
      label: ASSISTED_RESPONSIBILITY_ROLE_LABEL.self_publish,
      requires: 'accountId',
    },
    {
      role: 'external_owner',
      label: ASSISTED_RESPONSIBILITY_ROLE_LABEL.external_owner,
      requires: 'ownerId',
    },
  ];
}

export type PendingConfirmProjection = {
  visible: boolean;
  assistedReceiptId: string;
  handedOverAt: string;
  pendingSince: string;
  reason: 'awaiting_confirm_24h';
  message: string;
};

export type AssistedHandoffUiProjection = {
  receiptId: string;
  packageId: string;
  status: AssistedReceiptStatus;
  /** Exact product status label from B3. */
  statusLabel: string;
  /** True only with publish_result_recorded + published. */
  isPublished: boolean;
  /** True for handed_over and later. */
  isHandedOver: boolean;
  /**
   * Hard product rule: handed-over must never be projected as published.
   * Always true when isHandedOver && !isPublished for mid-states.
   */
  handedOverIsNotPublished: boolean;
  responsibilityRole?: AssistedResponsibilityRole;
  responsibilityRoleLabel?: string;
  bindingComplete: boolean;
  binding?: AssistedReceiptBinding;
  oneShotLinkToken?: string;
  oneShotLinkExpiresAt?: string;
  pendingConfirm: PendingConfirmProjection | null;
  roleOptions: AssistedRoleOption[];
  /** User-facing primary CTA for current status. */
  primaryCta: {
    id:
      | 'prepare_materials'
      | 'hand_over'
      | 'mark_pending'
      | 'record_publish'
      | 'done';
    label: string;
    enabled: boolean;
  };
  /** Publish result summary when recorded. */
  publishResultLabel?: string;
};

function handedOverAtIso(receipt: AssistedReceipt): string | undefined {
  const event = [...receipt.events]
    .reverse()
    .find((item) => item.type === 'handed_over');
  return event && event.type === 'handed_over' ? event.occurredAt : undefined;
}

/**
 * Passive 24h pending confirm projection (B3 / D-096).
 * No independent Notification table — pure projection.
 */
export function projectPendingConfirm(
  receipt: AssistedReceipt,
  nowIso: string
): PendingConfirmProjection | null {
  if (
    receipt.status !== 'handed_over' &&
    receipt.status !== 'pending_manual_publish'
  ) {
    return null;
  }
  if (isAssistedPublished(receipt)) return null;

  const handedOverAt = handedOverAtIso(receipt);
  if (!handedOverAt) return null;

  const nowMs = Date.parse(nowIso);
  const handedMs = Date.parse(handedOverAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(handedMs)) return null;
  if (nowMs - handedMs < PENDING_CONFIRM_AFTER_MS) return null;

  const pendingSince = new Date(
    handedMs + PENDING_CONFIRM_AFTER_MS
  ).toISOString();

  return {
    visible: true,
    assistedReceiptId: receipt.id,
    handedOverAt,
    pendingSince,
    reason: 'awaiting_confirm_24h',
    message: '交接已超过 24 小时，待确认是否已人工发布',
  };
}

function primaryCtaFor(
  receipt: AssistedReceipt,
  bindingComplete: boolean
): AssistedHandoffUiProjection['primaryCta'] {
  switch (receipt.status) {
    case 'materials_ready':
      return {
        id: 'hand_over',
        label: '确认交接',
        enabled: bindingComplete,
      };
    case 'handed_over':
      return {
        id: 'mark_pending',
        label: '标记待人工发布',
        enabled: true,
      };
    case 'pending_manual_publish':
      return {
        id: 'record_publish',
        label: '记录发布结果',
        enabled: true,
      };
    case 'publish_result_recorded':
      return {
        id: 'done',
        label: isAssistedPublished(receipt) ? '已发布' : '已记录结果',
        enabled: false,
      };
  }
}

function publishResultLabel(receipt: AssistedReceipt): string | undefined {
  if (!receipt.publishResult) return undefined;
  switch (receipt.publishResult.status) {
    case 'published':
      return '已发布';
    case 'failed':
      return '发布失败';
    case 'not_published':
      return '未发布';
    case 'unknown':
      return '结果未知';
  }
}

/**
 * Project assisted handoff UI from a B3 assisted receipt.
 * Enforces 已交接 ≠ 已发布 at the projection layer.
 */
export function projectAssistedHandoffUi(
  receipt: AssistedReceipt,
  nowIso: string
): AssistedHandoffUiProjection {
  const published = isAssistedPublished(receipt);
  const handedOver = isAssistedHandedOver(receipt);
  let bindingComplete = false;
  if (receipt.binding) {
    try {
      assertAssistedBindingComplete(receipt.binding);
      bindingComplete = true;
    } catch {
      bindingComplete = false;
    }
  }

  // Invariant: mid-handover states must never claim published.
  const handedOverIsNotPublished =
    !published &&
    (receipt.status === 'handed_over' ||
      receipt.status === 'pending_manual_publish' ||
      receipt.status === 'materials_ready');

  return {
    receiptId: receipt.id,
    packageId: receipt.packageId,
    status: receipt.status,
    statusLabel: ASSISTED_RECEIPT_STATUS_LABEL[receipt.status],
    isPublished: published,
    isHandedOver: handedOver,
    handedOverIsNotPublished,
    ...(receipt.binding
      ? {
          responsibilityRole: receipt.binding.responsibilityRole,
          responsibilityRoleLabel:
            ASSISTED_RESPONSIBILITY_ROLE_LABEL[
              receipt.binding.responsibilityRole
            ],
          binding: receipt.binding,
        }
      : {}),
    bindingComplete,
    ...(receipt.handoffLink
      ? {
          oneShotLinkToken: receipt.handoffLink.token,
          oneShotLinkExpiresAt: receipt.handoffLink.expiresAt,
        }
      : {}),
    pendingConfirm: projectPendingConfirm(receipt, nowIso),
    roleOptions: assistedResponsibilityRoleOptions(),
    primaryCta: primaryCtaFor(receipt, bindingComplete),
    ...(publishResultLabel(receipt)
      ? { publishResultLabel: publishResultLabel(receipt) }
      : {}),
  };
}

/** Build a materials_ready receipt fixture for UI tests. */
export function materialsReadyReceiptFixture(
  overrides: Partial<AssistedReceipt> = {}
): AssistedReceipt {
  return {
    id: 'assisted-receipt-1',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
    status: 'materials_ready',
    exportReceiptId: 'export-1',
    events: [
      {
        actorId: 'owner-1',
        occurredAt: '2026-07-20T09:00:00.000Z',
        type: 'materials_prepared',
      },
    ],
    ...overrides,
  };
}

export function handedOverReceiptFixture(
  overrides: Partial<AssistedReceipt> = {}
): AssistedReceipt {
  const binding: AssistedReceiptBinding = {
    accountId: 'acct-xhs-1',
    approvalReceiptId: 'approval-receipt-1',
    contentPackageRevision: 5,
    costRange: { currency: 'CNY', maxAmount: 20, minAmount: 0 },
    packageId: 'pkg-1',
    platform: 'xiaohongshu',
    purpose: 'public_content',
    responsibilityRole: 'self_publish',
    scheduledAt: '2026-07-20T10:00:00.000Z',
    variantVersionId: 'variant-v1',
    workspaceId: 'ws-1',
  };

  return {
    id: 'assisted-receipt-2',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
    status: 'handed_over',
    binding,
    handoffLink: {
      token: 'a'.repeat(32),
      createdAt: '2026-07-20T09:05:00.000Z',
      expiresAt: '2026-07-23T09:05:00.000Z',
    },
    events: [
      {
        actorId: 'owner-1',
        occurredAt: '2026-07-20T09:00:00.000Z',
        type: 'materials_prepared',
      },
      {
        actorId: 'owner-1',
        occurredAt: '2026-07-20T09:05:00.000Z',
        type: 'handed_over',
      },
    ],
    ...overrides,
  };
}

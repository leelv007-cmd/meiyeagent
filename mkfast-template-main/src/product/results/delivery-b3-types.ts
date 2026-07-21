/**
 * Client-side types consuming B3 delivery-manifest / assisted-receipt (#93 / #101).
 *
 * Pure shapes only — no I/O. Mirrors apps/core result-delivery contracts so
 * Result Center can project delivery UI without importing core modules.
 */

/** beauty-delivery-manifest/v1 schema id (B3). */
export const BEAUTY_DELIVERY_MANIFEST_SCHEMA =
  'beauty-delivery-manifest/v1' as const;

export const DELIVERY_MANIFEST_FILE_ROLES = [
  'manifest',
  'caption',
  'cover',
  'image',
  'video',
  'subtitles',
  'checklist',
  'rights_evidence',
] as const;

export type DeliveryManifestFileRole =
  (typeof DELIVERY_MANIFEST_FILE_ROLES)[number];

/** Platforms that ship a full ZIP package under B3. */
export const DELIVERY_ZIP_PLATFORMS = [
  'xiaohongshu',
  'douyin',
  'video_account',
] as const;

export type DeliveryZipPlatform = (typeof DELIVERY_ZIP_PLATFORMS)[number];

/**
 * Distribution targets shown in the delivery panel.
 * wechat_moments is export/distribution only (D-086) — never automatic_verified.
 */
export const DELIVERY_PANEL_TARGETS = [
  'xiaohongshu',
  'douyin',
  'video_account',
  'wechat_moments',
] as const;

export type DeliveryPanelTarget = (typeof DELIVERY_PANEL_TARGETS)[number];

export type DeliveryPackageKind = 'image_text' | 'video' | 'moments_segments';

export type DeliveryManifestFileEntry = {
  mimeType: string;
  order: number;
  path: string;
  role: DeliveryManifestFileRole;
  sha256?: string;
  sizeBytes?: number;
};

export type DeliveryManifestRightsSummary = {
  aigcLabelEnabled: boolean;
  factSummary?: string;
  state: string;
  watermarkEnabled: boolean;
};

/** Minimal beauty-delivery-manifest/v1 document for client projection. */
export type BeautyDeliveryManifestV1 = {
  contentPackageRevision: number;
  files: DeliveryManifestFileEntry[];
  generatedAt: string;
  kind: 'image_text' | 'video';
  packageId: string;
  platform: DeliveryZipPlatform;
  rightsSummary: DeliveryManifestRightsSummary;
  schema: typeof BEAUTY_DELIVERY_MANIFEST_SCHEMA;
  variantVersionId: string;
};

// ---------------------------------------------------------------------------
// Assisted receipt (B3) — client mirror
// ---------------------------------------------------------------------------

export const ASSISTED_RECEIPT_STATUSES = [
  'materials_ready',
  'handed_over',
  'pending_manual_publish',
  'publish_result_recorded',
] as const;

export type AssistedReceiptStatus = (typeof ASSISTED_RECEIPT_STATUSES)[number];

/** Exact product wording from B3. */
export const ASSISTED_RECEIPT_STATUS_LABEL: Record<
  AssistedReceiptStatus,
  string
> = {
  handed_over: '已交接',
  materials_ready: '资料已准备',
  pending_manual_publish: '待人工发布',
  publish_result_recorded: '已记录发布结果',
};

export const ASSISTED_RESPONSIBILITY_ROLES = [
  'self_publish',
  'external_owner',
] as const;

export type AssistedResponsibilityRole =
  (typeof ASSISTED_RESPONSIBILITY_ROLES)[number];

export const ASSISTED_RESPONSIBILITY_ROLE_LABEL: Record<
  AssistedResponsibilityRole,
  string
> = {
  external_owner: '外部责任人发布',
  self_publish: '本人账号发布',
};

export type AssistedCostRange = {
  currency: 'CNY' | 'USD';
  maxAmount: number;
  minAmount: number;
};

/**
 * Binding required when materials leave the device (hand_over).
 * Exact platform + account OR owner + revision + purpose + time + cost + approval.
 */
export type AssistedReceiptBinding = {
  accountId?: string;
  approvalReceiptId: string;
  contentPackageRevision: number;
  costRange: AssistedCostRange;
  ownerId?: string;
  packageId: string;
  platform: DeliveryZipPlatform;
  purpose: string;
  responsibilityRole: AssistedResponsibilityRole;
  scheduledAt: string;
  variantVersionId: string;
  workspaceId: string;
};

export type AssistedPublishResult = {
  note?: string;
  platformUrl?: string;
  recordedAt: string;
  source: 'external_receipt' | 'manual_record';
  status: 'published' | 'failed' | 'unknown' | 'not_published';
};

export type AssistedHandoffLink = {
  consumedAt?: string;
  createdAt: string;
  expiresAt: string;
  token: string;
};

export type AssistedReceiptEvent =
  | {
      actorId: string;
      occurredAt: string;
      type: 'materials_prepared';
    }
  | {
      actorId: string;
      occurredAt: string;
      type: 'handed_over';
    }
  | {
      actorId: string;
      occurredAt: string;
      type: 'marked_pending_manual_publish';
    }
  | {
      actorId: string;
      occurredAt: string;
      result: AssistedPublishResult;
      type: 'publish_result_recorded';
    }
  | {
      occurredAt: string;
      type: 'handoff_link_consumed';
    };

export type AssistedReceipt = {
  binding?: AssistedReceiptBinding;
  events: AssistedReceiptEvent[];
  exportReceiptId?: string;
  handoffLink?: AssistedHandoffLink;
  id: string;
  packageId: string;
  publishResult?: AssistedPublishResult;
  status: AssistedReceiptStatus;
  workspaceId: string;
};

/** One-shot handoff link TTL (72h) and 24h pending confirm — B3 constants. */
export const ONE_SHOT_HANDOFF_LINK_TTL_MS = 72 * 60 * 60 * 1000;
export const PENDING_CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;

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

/**
 * Validate binding completeness for hand-over (client-side mirror of B3).
 * Throws with a stable code when incomplete.
 */
export function assertAssistedBindingComplete(
  binding: AssistedReceiptBinding
): void {
  if (!binding.approvalReceiptId?.trim()) {
    throw new Error('ASSISTED_BINDING_MISSING_APPROVAL');
  }
  if (!binding.packageId?.trim() || !binding.workspaceId?.trim()) {
    throw new Error('ASSISTED_BINDING_MISSING_PACKAGE');
  }
  if (!binding.purpose?.trim() || !binding.scheduledAt?.trim()) {
    throw new Error('ASSISTED_BINDING_MISSING_PURPOSE_OR_TIME');
  }
  if (
    binding.costRange.minAmount < 0 ||
    binding.costRange.maxAmount < binding.costRange.minAmount
  ) {
    throw new Error('ASSISTED_BINDING_INVALID_COST');
  }
  if (binding.responsibilityRole === 'self_publish' && !binding.accountId) {
    throw new Error('ASSISTED_BINDING_SELF_REQUIRES_ACCOUNT');
  }
  if (binding.responsibilityRole === 'external_owner' && !binding.ownerId) {
    throw new Error('ASSISTED_BINDING_EXTERNAL_REQUIRES_OWNER');
  }
  if (!binding.accountId && !binding.ownerId) {
    throw new Error('ASSISTED_BINDING_REQUIRES_ACCOUNT_OR_OWNER');
  }
}

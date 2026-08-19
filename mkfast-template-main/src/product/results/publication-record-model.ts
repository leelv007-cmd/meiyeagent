/**
 * Publication record pure projection (P1-D2 / #157).
 *
 * Only verified platform callback or explicit manual record may create a
 * publication record. shared / handed_off / submitted / reviewing stay distinct.
 * Edits to published content create a new revision — never rewrite history.
 */

import type { ContentPackagePlatform } from '@meiye/contracts';
import { projectMerchantRevision } from '@/product/merchant-vocabulary';

export const PUBLICATION_SOURCE_TIERS = [
  'verified_callback',
  'manual_record',
] as const;

export type PublicationSourceTier = (typeof PUBLICATION_SOURCE_TIERS)[number];

export const PUBLICATION_SOURCE_TIER_LABEL: Record<
  PublicationSourceTier,
  string
> = {
  verified_callback: '已验证平台回执',
  manual_record: '人工补记',
};

export const PUBLICATION_LIFECYCLE_STATES = [
  'shared',
  'handed_off',
  'submitted',
  'reviewing',
  'published',
  'failed',
  'unknown',
] as const;

export type PublicationLifecycleState =
  (typeof PUBLICATION_LIFECYCLE_STATES)[number];

export const PUBLICATION_LIFECYCLE_LABEL: Record<
  PublicationLifecycleState,
  string
> = {
  shared: '已分享（未发布）',
  handed_off: '已交接（未发布）',
  submitted: '已提交审核',
  reviewing: '平台审核中',
  published: '已发布',
  failed: '发布失败',
  unknown: '结果未知',
};

export type PublicationRecordFact = {
  id: string;
  contentPackageId: string;
  /** Exact ContentPackage revision frozen at record time. */
  contentPackageRevision: number;
  platform: string;
  /** Merchant-safe account display label — never a raw secret. */
  accountDisplayLabel: string;
  publishedAt: string;
  platformUrl?: string;
  actorId: string;
  sourceTier: PublicationSourceTier;
  createdAt: string;
  status: 'published' | 'failed' | 'unknown';
  variantVersionId?: string;
  note?: string;
  /**
   * When this record supersedes an earlier incorrect record.
   * Original remains visible; never in-place rewrite.
   */
  supersedesRecordId?: string;
};

export type ManualPublicationFormInput = {
  platform: string;
  accountDisplayLabel: string;
  publishedAt: string;
  platformUrl?: string;
  note?: string;
  status: 'published' | 'failed' | 'unknown';
};

export type PublicationVariantBinding = {
  platform: ContentPackagePlatform;
  variantVersionId: string;
};

export type ManualPublicationFormValidation =
  | {
      ok: true;
      normalized: ManualPublicationFormInput;
      idempotencyKey: string;
    }
  | {
      ok: false;
      errors: string[];
    };

export type PublicationRecordPanelView =
  | {
      kind: 'ready';
      heading: string;
      summary: string;
      records: Array<{
        id: string;
        platformLabel: string;
        accountDisplayLabel: string;
        publishedAtLabel: string;
        sourceTierLabel: string;
        statusLabel: string;
        revisionLabel: string;
        platformUrl?: string;
        isSuperseded: boolean;
        supersedesLabel?: string;
      }>;
      /** Current package revision shown for new manual records. */
      currentRevisionLabel: string;
      /** Warning shown when merchant edits after publish. */
      editCreatesNewRevisionNotice: string;
      /** True when platform is not live-gated — only manual allowed. */
      automaticPublishAllowed: boolean;
      automaticPublishBlockedReason?: string;
      canRecordManual: boolean;
    }
  | {
      kind: 'fail_closed';
      heading: string;
      reason:
        | 'missing_package_revision'
        | 'missing_variant'
        | 'no_records_yet'
        | 'workspace_mismatch';
      message: string;
      canRecordManual: boolean;
      automaticPublishAllowed: boolean;
      automaticPublishBlockedReason?: string;
    };

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  video_account: '视频号',
  wechat_moments: '朋友圈',
};

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return iso.slice(0, 16);
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Map delivery / handoff semantics onto lifecycle states.
 * shared and handed_off never become published.
 */
export function publicationLifecycleFromDelivery(input: {
  deliveryKind?:
    | 'shared'
    | 'handed_off'
    | 'submitted'
    | 'reviewing'
    | 'copied'
    | 'downloaded'
    | 'prepared';
  publicationStatus?: 'published' | 'failed' | 'unknown';
}): PublicationLifecycleState {
  if (input.publicationStatus === 'published') return 'published';
  if (input.publicationStatus === 'failed') return 'failed';
  if (input.publicationStatus === 'unknown') return 'unknown';
  switch (input.deliveryKind) {
    case 'shared':
      return 'shared';
    case 'handed_off':
      return 'handed_off';
    case 'submitted':
      return 'submitted';
    case 'reviewing':
      return 'reviewing';
    default:
      return 'unknown';
  }
}

/**
 * Validate a manual publication form before the command is sent.
 * Server still re-validates URL, platform and workspace permission.
 */
export function validateManualPublicationForm(
  input: ManualPublicationFormInput,
  context: {
    contentPackageId: string;
    contentPackageRevision: number;
    variantVersionId: string;
  }
): ManualPublicationFormValidation {
  const errors: string[] = [];
  const platform = input.platform.trim();
  const account = input.accountDisplayLabel.trim();
  const publishedAt = input.publishedAt.trim();
  const platformUrl = input.platformUrl?.trim();
  const note = input.note?.trim();

  if (!platform) errors.push('请选择发布平台');
  if (!account) errors.push('请填写账号显示标识');
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    errors.push('请填写有效的发布时间');
  }
  if (platformUrl && !isHttpUrl(platformUrl)) {
    errors.push('发布链接格式无效');
  }
  if (!context.contentPackageId.trim()) {
    errors.push('缺少成品标识');
  }
  if (
    !Number.isInteger(context.contentPackageRevision) ||
    context.contentPackageRevision < 0
  ) {
    errors.push('缺少精确成品版本');
  }
  if (!context.variantVersionId.trim()) {
    errors.push('缺少平台版本');
  }

  if (errors.length > 0) return { ok: false, errors };

  const normalized: ManualPublicationFormInput = {
    platform,
    accountDisplayLabel: account,
    publishedAt,
    status: input.status,
    ...(platformUrl ? { platformUrl } : {}),
    ...(note ? { note } : {}),
  };

  // Core/BFF Idempotency-Key: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
  // Never embed free-text URL/note (or non-ASCII package labels) — those can
  // fail the header regex. Fingerprint the binding fields into a short key.
  const digestSource = [
    context.contentPackageId,
    String(context.contentPackageRevision),
    platform,
    context.variantVersionId,
    publishedAt,
    input.status,
    platformUrl ?? '',
  ].join('|');
  let hash = 0;
  for (let i = 0; i < digestSource.length; i += 1) {
    hash = (Math.imul(31, hash) + digestSource.charCodeAt(i)) | 0;
  }
  const fingerprint = Math.abs(hash).toString(36);
  const idempotencyKey =
    `pub.${platform}.${context.contentPackageRevision}.${fingerprint}.${crypto.randomUUID()}`.slice(
      0,
      200
    );
  return {
    ok: true,
    normalized,
    idempotencyKey,
  };
}

/**
 * Project publication records for Content / Result / Delivery (same seam).
 */
export function projectPublicationRecordPanel(input: {
  contentPackageId?: string;
  contentPackageRevision?: number;
  variantVersionId?: string;
  variantBindings?: readonly PublicationVariantBinding[];
  workspaceId?: string;
  recordsWorkspaceId?: string;
  records?: readonly PublicationRecordFact[];
  /**
   * Live-gate: only automatic_verified platforms may show auto success.
   * Default false — launch stays manual-only.
   */
  automaticVerifiedPlatformCount?: number;
}): PublicationRecordPanelView {
  const heading = '发布记录';
  const autoCount = input.automaticVerifiedPlatformCount ?? 0;
  const automaticPublishAllowed = autoCount > 0;
  const automaticPublishBlockedReason = automaticPublishAllowed
    ? undefined
    : '当前平台未通过 live gate，仅支持人工补记，不会显示自动发布成功';

  if (
    input.contentPackageId === undefined ||
    input.contentPackageRevision === undefined ||
    !Number.isInteger(input.contentPackageRevision) ||
    input.contentPackageRevision < 0
  ) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'missing_package_revision',
      message: '尚未绑定精确成品版本，无法补记发布。',
      canRecordManual: false,
      automaticPublishAllowed,
      automaticPublishBlockedReason,
    };
  }

  const hasVariantBinding =
    Boolean(input.variantVersionId?.trim()) ||
    Boolean(
      input.variantBindings?.some(
        (binding) => binding.variantVersionId.trim().length > 0
      )
    );
  if (!hasVariantBinding) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'missing_variant',
      message: '缺少平台版本，无法补记发布。',
      canRecordManual: false,
      automaticPublishAllowed,
      automaticPublishBlockedReason,
    };
  }

  if (
    input.workspaceId &&
    input.recordsWorkspaceId &&
    input.workspaceId !== input.recordsWorkspaceId
  ) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'workspace_mismatch',
      message: '发布记录不属于当前工作区，已隐藏。',
      canRecordManual: false,
      automaticPublishAllowed,
      automaticPublishBlockedReason,
    };
  }

  const records = [...(input.records ?? [])]
    .filter((r) => r.contentPackageId === input.contentPackageId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const supersededIds = new Set(
    records
      .map((r) => r.supersedesRecordId)
      .filter((id): id is string => Boolean(id))
  );

  const editCreatesNewRevisionNotice =
    '修改已发布成品会生成新版本，不会改写旧的发布记录。';

  if (records.length === 0) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'no_records_yet',
      message: automaticPublishAllowed
        ? '还没有发布记录。可通过已验证回执或人工补记写入。'
        : '还没有发布记录。当前仅支持人工补记真实发布结果。',
      canRecordManual: true,
      automaticPublishAllowed,
      automaticPublishBlockedReason,
    };
  }

  return {
    kind: 'ready',
    heading,
    summary: '只有已验证平台回执或明确人工补记才会形成发布记录。',
    records: records.map((record) => ({
      id: record.id,
      platformLabel: platformLabel(record.platform),
      accountDisplayLabel: record.accountDisplayLabel,
      publishedAtLabel: formatTime(record.publishedAt),
      sourceTierLabel: PUBLICATION_SOURCE_TIER_LABEL[record.sourceTier],
      statusLabel:
        record.status === 'published'
          ? PUBLICATION_LIFECYCLE_LABEL.published
          : record.status === 'failed'
            ? PUBLICATION_LIFECYCLE_LABEL.failed
            : PUBLICATION_LIFECYCLE_LABEL.unknown,
      revisionLabel: projectMerchantRevision(record.contentPackageRevision),
      ...(record.platformUrl ? { platformUrl: record.platformUrl } : {}),
      isSuperseded: supersededIds.has(record.id),
      ...(record.supersedesRecordId
        ? { supersedesLabel: `更正自 ${record.supersedesRecordId.slice(0, 8)}` }
        : {}),
    })),
    currentRevisionLabel: `当前${projectMerchantRevision(input.contentPackageRevision)}`,
    editCreatesNewRevisionNotice,
    automaticPublishAllowed,
    automaticPublishBlockedReason,
    canRecordManual: true,
  };
}

/**
 * Project publication records from existing ContentPackage delivery events.
 * assisted_handoff / shared / copied never become publication records.
 */
export function publicationRecordsFromDeliveryEvents(input: {
  contentPackageId: string;
  contentPackageRevision: number;
  events: readonly {
    id: string;
    type: string;
    status?: string;
    platform: string;
    platformUrl?: string;
    accountDisplayLabel?: string;
    actorId: string;
    occurredAt: string;
    note?: string;
    variantVersionId?: string;
    providerReceiptId?: string;
  }[];
  accountDisplayLabelByPlatform?: Record<string, string>;
}): PublicationRecordFact[] {
  const out: PublicationRecordFact[] = [];
  for (const event of input.events) {
    if (
      event.type !== 'manual_publish_result' &&
      event.type !== 'automatic_publish_result'
    ) {
      continue;
    }
    if (
      event.status !== 'published' &&
      event.status !== 'failed' &&
      event.status !== 'unknown'
    ) {
      continue;
    }
    out.push({
      id: event.id,
      contentPackageId: input.contentPackageId,
      contentPackageRevision: input.contentPackageRevision,
      platform: event.platform,
      accountDisplayLabel:
        event.accountDisplayLabel ??
        input.accountDisplayLabelByPlatform?.[event.platform] ??
        platformLabel(event.platform),
      publishedAt: event.occurredAt,
      ...(event.platformUrl ? { platformUrl: event.platformUrl } : {}),
      actorId: event.actorId,
      sourceTier:
        event.type === 'automatic_publish_result'
          ? 'verified_callback'
          : 'manual_record',
      createdAt: event.occurredAt,
      status: event.status,
      ...(event.variantVersionId
        ? { variantVersionId: event.variantVersionId }
        : {}),
      ...(event.note ? { note: event.note } : {}),
    });
  }
  return out;
}

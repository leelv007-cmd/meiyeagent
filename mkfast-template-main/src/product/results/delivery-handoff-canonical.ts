/**
 * Canonical handoff page data source (D-086 / D-096 / #101).
 *
 * Reuses dashboard/handoff/$token four-section paradigm:
 * share / download / copy / report — but reads canonical delivery data,
 * NOT legacy ProductState.handoffPackages.
 */

import {
  ASSISTED_RECEIPT_STATUS_LABEL,
  isAssistedPublished,
  type AssistedPublishResult,
  type AssistedReceipt,
  type DeliveryPanelTarget,
} from './delivery-b3-types';

/** Copyable field row in the copy section. */
export type CanonicalHandoffCopyField = {
  id: string;
  label: string;
  value: string;
};

/** Media item in the download section. */
export type CanonicalHandoffMedia = {
  id: string;
  kind: 'image' | 'video' | 'file';
  label: string;
  href: string;
  downloadName: string;
  mimeType?: string;
};

/**
 * Canonical delivery handoff record — the only data source for the handoff page.
 * Built from assisted receipt + adopted package materials (B3).
 */
export type CanonicalDeliveryHandoff = {
  token: string;
  expiresAt: string;
  packageId: string;
  contentPackageRevision: number;
  variantVersionId: string;
  platform: DeliveryPanelTarget;
  title: string;
  body: string;
  topics: readonly string[];
  conversionText: string;
  checklist: readonly string[];
  media: readonly CanonicalHandoffMedia[];
  /** One-shot share URL for degrade path. */
  shareUrl: string;
  fullPackageDownloadHref?: string;
  fullPackageFileName?: string;
  /** Bound assisted receipt (required for report section honesty). */
  assistedReceipt: AssistedReceipt;
  storeName?: string;
  aigcLabelEnabled?: boolean;
};

export type CanonicalHandoffSectionId =
  | 'share'
  | 'download'
  | 'copy'
  | 'report';

export type CanonicalHandoffShareSection = {
  id: 'share';
  title: string;
  shareUrl: string;
  canShareFiles: boolean;
  mediaForShare: readonly CanonicalHandoffMedia[];
};

export type CanonicalHandoffDownloadSection = {
  id: 'download';
  title: string;
  media: readonly CanonicalHandoffMedia[];
  fullPackageHref?: string;
  fullPackageFileName?: string;
};

export type CanonicalHandoffCopySection = {
  id: 'copy';
  title: string;
  fields: CanonicalHandoffCopyField[];
};

export type CanonicalHandoffReportSection = {
  id: 'report';
  title: string;
  statusLabel: string;
  /** Never "已发布" unless receipt actually published. */
  isPublished: boolean;
  isHandedOver: boolean;
  handedOverIsNotPublished: boolean;
  awaitingReport: boolean;
  publishResult?: AssistedPublishResult;
  description: string;
};

export type CanonicalHandoffPageView = {
  kind: 'ready';
  token: string;
  platform: DeliveryPanelTarget;
  heading: string;
  description: string;
  expired: boolean;
  sections: {
    share: CanonicalHandoffShareSection;
    download: CanonicalHandoffDownloadSection;
    copy: CanonicalHandoffCopySection;
    report: CanonicalHandoffReportSection;
  };
  /** a11y live region for action outcomes. */
  outcomeLiveRegionId: 'handoff-outcome-live';
  assistedReceiptId: string;
};

export type CanonicalHandoffResolveResult =
  | CanonicalHandoffPageView
  | { kind: 'not_found' }
  | { kind: 'expired'; token: string };

const PLATFORM_HEADING: Record<DeliveryPanelTarget, string> = {
  xiaohongshu: '小红书交接包',
  douyin: '抖音交接包',
  video_account: '视频号交接包',
  wechat_moments: '朋友圈交接包',
};

/**
 * Project the four-section handoff page from a canonical delivery record.
 * Does not accept legacy HandoffPackage.
 */
export function projectCanonicalHandoffPage(
  source: CanonicalDeliveryHandoff,
  options: {
    nowIso: string;
    /** Device canShare for current media files. */
    canShareFiles?: boolean;
  }
): CanonicalHandoffResolveResult {
  const nowMs = Date.parse(options.nowIso);
  const expiresMs = Date.parse(source.expiresAt);
  if (
    !Number.isFinite(expiresMs) ||
    (Number.isFinite(nowMs) && nowMs > expiresMs)
  ) {
    return { kind: 'expired', token: source.token };
  }

  const receipt = source.assistedReceipt;
  const published = isAssistedPublished(receipt);
  const handedOver =
    receipt.status === 'handed_over' ||
    receipt.status === 'pending_manual_publish' ||
    receipt.status === 'publish_result_recorded';

  const copyFields: CanonicalHandoffCopyField[] = [
    { id: 'title', label: '标题', value: source.title },
    { id: 'body', label: '正文', value: source.body },
    {
      id: 'topics',
      label: '话题',
      value: source.topics.map((t) => `#${t}`).join(' '),
    },
    { id: 'conversion', label: '转化语', value: source.conversionText },
  ].filter((field) => field.value.trim().length > 0);

  return {
    kind: 'ready',
    token: source.token,
    platform: source.platform,
    heading: PLATFORM_HEADING[source.platform],
    description: '分享、下载、复制文案，并回报发布结果。已交接不等于已发布。',
    expired: false,
    assistedReceiptId: receipt.id,
    outcomeLiveRegionId: 'handoff-outcome-live',
    sections: {
      share: {
        id: 'share',
        title: '分享',
        shareUrl: source.shareUrl,
        canShareFiles: Boolean(options.canShareFiles),
        mediaForShare: source.media,
      },
      download: {
        id: 'download',
        title: '下载',
        media: source.media,
        ...(source.fullPackageDownloadHref
          ? { fullPackageHref: source.fullPackageDownloadHref }
          : {}),
        ...(source.fullPackageFileName
          ? { fullPackageFileName: source.fullPackageFileName }
          : {}),
      },
      copy: {
        id: 'copy',
        title: '复制',
        fields: copyFields,
      },
      report: {
        id: 'report',
        title: '回报发布结果',
        statusLabel: published
          ? '已发布'
          : ASSISTED_RECEIPT_STATUS_LABEL[receipt.status],
        isPublished: published,
        isHandedOver: handedOver,
        handedOverIsNotPublished: handedOver && !published,
        awaitingReport:
          !published && receipt.status !== 'publish_result_recorded',
        ...(receipt.publishResult
          ? { publishResult: receipt.publishResult }
          : {}),
        description: published
          ? '已记录外部发布结果。'
          : '交接完成后请回报是否已在平台发布；未回报前不会显示为已发布。',
      },
    },
  };
}

/**
 * Resolve handoff by token from a canonical index only.
 * Explicitly refuses legacy handoffPackages (retired data source).
 */
export function resolveCanonicalHandoffByToken(
  token: string,
  index: readonly CanonicalDeliveryHandoff[],
  options: { nowIso: string; canShareFiles?: boolean }
): CanonicalHandoffResolveResult {
  const found = index.find((item) => item.token === token);
  if (!found) return { kind: 'not_found' };
  return projectCanonicalHandoffPage(found, options);
}

/**
 * Type-level / runtime guard: legacy handoff package shape is not accepted.
 * Used by tests to prove the page data path does not read handoffPackages.
 */
export type LegacyHandoffPackageRetired = {
  /** @deprecated Retired — do not use as handoff page source. */
  readonly __legacyHandoffPackagesRetired: true;
};

export function assertNotLegacyHandoffSource(source: unknown): void {
  if (
    source &&
    typeof source === 'object' &&
    'route' in source &&
    (source as { route?: string }).route === 'L3_HANDOFF_PACKAGE'
  ) {
    throw new Error(
      'LEGACY_HANDOFF_SOURCE_RETIRED: use CanonicalDeliveryHandoff instead of handoffPackages'
    );
  }
}

/** Build a canonical handoff fixture for page unit tests. */
export function canonicalHandoffFixture(
  overrides: Partial<CanonicalDeliveryHandoff> = {}
): CanonicalDeliveryHandoff {
  const token = overrides.token ?? 'canonical-token-abc123def456';
  const receipt: AssistedReceipt = overrides.assistedReceipt ?? {
    id: 'assisted-receipt-h1',
    packageId: 'pkg-handoff-1',
    workspaceId: 'ws-1',
    status: 'handed_over',
    binding: {
      accountId: 'acct-1',
      approvalReceiptId: 'approval-1',
      contentPackageRevision: 4,
      costRange: { currency: 'CNY', maxAmount: 0, minAmount: 0 },
      packageId: 'pkg-handoff-1',
      platform: 'xiaohongshu',
      purpose: 'public_content',
      responsibilityRole: 'self_publish',
      scheduledAt: '2026-07-20T12:00:00.000Z',
      variantVersionId: 'v1',
      workspaceId: 'ws-1',
    },
    handoffLink: {
      token,
      createdAt: '2026-07-20T09:00:00.000Z',
      expiresAt: '2026-07-23T09:00:00.000Z',
    },
    events: [
      {
        actorId: 'u1',
        occurredAt: '2026-07-20T08:50:00.000Z',
        type: 'materials_prepared',
      },
      {
        actorId: 'u1',
        occurredAt: '2026-07-20T09:00:00.000Z',
        type: 'handed_over',
      },
    ],
  };

  return {
    token,
    expiresAt: '2026-07-23T09:00:00.000Z',
    packageId: 'pkg-handoff-1',
    contentPackageRevision: 4,
    variantVersionId: 'v1',
    platform: 'xiaohongshu',
    title: '夏日美甲套餐',
    body: '到店立减 50',
    topics: ['美甲'],
    conversionText: '私信预约',
    checklist: ['核对价格', '预览全部媒体', '确认 AIGC 标识'],
    media: [
      {
        id: 'media-1',
        kind: 'image',
        label: '封面',
        href: '/api/storage/file?key=cover.jpg',
        downloadName: 'cover.jpg',
        mimeType: 'image/jpeg',
      },
    ],
    shareUrl: `https://app.example/dashboard/handoff/${token}`,
    fullPackageDownloadHref: '/api/export/pkg-handoff-1.zip',
    fullPackageFileName: '花间美甲-图文-小红书-20260720-r4.zip',
    assistedReceipt: receipt,
    storeName: '花间美甲',
    aigcLabelEnabled: true,
    ...overrides,
  };
}

/**
 * Four-section functional projection for e2e-style unit tests.
 * Asserts each section exposes the expected affordances.
 */
export function assertFourSectionParity(view: CanonicalHandoffPageView): {
  share: boolean;
  download: boolean;
  copy: boolean;
  report: boolean;
} {
  return {
    share:
      view.sections.share.id === 'share' &&
      view.sections.share.shareUrl.length > 0,
    download:
      view.sections.download.id === 'download' &&
      (view.sections.download.media.length > 0 ||
        Boolean(view.sections.download.fullPackageHref)),
    copy:
      view.sections.copy.id === 'copy' && view.sections.copy.fields.length > 0,
    report:
      view.sections.report.id === 'report' &&
      view.sections.report.handedOverIsNotPublished ===
        (view.sections.report.isHandedOver &&
          !view.sections.report.isPublished),
  };
}

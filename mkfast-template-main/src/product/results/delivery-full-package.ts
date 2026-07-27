/**
 * Full delivery package plans for three modalities (D-096 / #101).
 *
 * - 小红书图文包 → beauty-delivery-manifest/v1 + deterministic ZIP layout
 * - 抖音视频包 → beauty-delivery-manifest/v1 video full package
 * - 朋友圈分段 → segmented caption/media (distribution target, not ZIP platform)
 *
 * Consumes B3 manifest roles/order/schema. Client projects the package plan;
 * actual ZIP bytes are produced by core export adapter (same layout).
 */

import {
  BEAUTY_DELIVERY_MANIFEST_SCHEMA,
  type BeautyDeliveryManifestV1,
  type DeliveryManifestFileEntry,
  type DeliveryManifestFileRole,
  type DeliveryPackageKind,
  type DeliveryPanelTarget,
  type DeliveryZipPlatform,
} from './delivery-b3-types';

/**
 * The ZIP *layout*, named after the platform it was designed for — not the
 * platform this particular package goes to. 视频号 ships the same video layout
 * as 抖音; which platform it is for is `target` / `manifest.platform`, and that
 * is what the file name and the manifest state.
 */
export type DeliveryPackageModality =
  | 'xiaohongshu_image_text'
  | 'douyin_video'
  | 'wechat_moments_segments';

export type DeliveryPackageCaption = {
  body: string;
  conversionHook?: string;
  title: string;
  topics: readonly string[];
};

export type DeliveryPackageMediaFile = {
  bytes?: Uint8Array;
  mimeType: string;
  path: string;
  role: DeliveryManifestFileRole;
  sizeBytes?: number;
};

export type MomentsSegment = {
  id: string;
  label: string;
  /** Text to copy for this segment (caption parts). */
  text?: string;
  /** Optional media for this segment. */
  media?: DeliveryPackageMediaFile[];
};

export type FullPackagePlan = {
  modality: DeliveryPackageModality;
  kind: DeliveryPackageKind;
  target: DeliveryPanelTarget;
  packageId: string;
  contentPackageRevision: number;
  variantVersionId: string;
  generatedAt: string;
  storeName: string;
  caption: DeliveryPackageCaption;
  /** Ordered payload files (excluding embedded manifest.json for ZIP kinds). */
  files: DeliveryPackageMediaFile[];
  /** Present for ZIP modalities. */
  manifest?: BeautyDeliveryManifestV1;
  /** Deterministic ZIP download name for ZIP modalities. */
  zipFileName?: string;
  /** Moments only — sequential handoff segments. */
  segments?: MomentsSegment[];
  /** Schema marker for assertions. */
  schema: typeof BEAUTY_DELIVERY_MANIFEST_SCHEMA | 'moments-segments/v1';
};

export type FullPackageDownloadOutcome = {
  modality: DeliveryPackageModality;
  /** Download started (browser took over) — not "published". */
  downloadStarted: boolean;
  /** Marks local file delivery only — never platform published. */
  deliveredAs: 'full_package_download';
  fileName: string;
  packageId: string;
  contentPackageRevision: number;
};

// ---------------------------------------------------------------------------
// ZIP naming (B3 mirror)
// ---------------------------------------------------------------------------

const PLATFORM_LABEL: Record<DeliveryZipPlatform, string> = {
  douyin: '抖音',
  video_account: '视频号',
  xiaohongshu: '小红书',
};

const KIND_LABEL: Record<'image_text' | 'video', string> = {
  image_text: '图文',
  video: '视频',
};

const MAX_ZIP_NAME_LENGTH = 120;

export function sanitizeDeliveryZipSegment(
  value: string,
  fallback: string
): string {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]|\p{Cc}/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^\.+|\.+$/gu, '')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function shortRevisionToken(revision: number | string): string {
  if (typeof revision === 'number') return `r${revision}`;
  const hex = revision.replace(/[^a-f0-9]/giu, '').toLowerCase();
  if (hex.length >= 8) return hex.slice(0, 8);
  return sanitizeDeliveryZipSegment(revision, 'rev').slice(0, 8);
}

export function formatDeliveryDateToken(isoDatetime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(isoDatetime);
  if (!match) {
    throw new Error('generatedAt must be an ISO datetime for ZIP naming.');
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

/** ZIP name: `{门店}-{内容类型}-{平台}-{YYYYMMDD}-{短revision}.zip` */
export function buildDeliveryZipFileName(input: {
  contentPackageRevision: number | string;
  generatedAt: string;
  kind: 'image_text' | 'video';
  platform: DeliveryZipPlatform;
  storeName: string;
}): string {
  const parts = [
    sanitizeDeliveryZipSegment(input.storeName, '门店'),
    sanitizeDeliveryZipSegment(KIND_LABEL[input.kind], input.kind),
    sanitizeDeliveryZipSegment(PLATFORM_LABEL[input.platform], input.platform),
    formatDeliveryDateToken(input.generatedAt),
    shortRevisionToken(input.contentPackageRevision),
  ];
  let base = parts.join('-');
  if (base.length > MAX_ZIP_NAME_LENGTH - 4) {
    base = base.slice(0, MAX_ZIP_NAME_LENGTH - 4);
  }
  return `${base}.zip`;
}

export function buildCaptionText(caption: DeliveryPackageCaption): string {
  const topics =
    caption.topics.length > 0
      ? caption.topics.map((topic) => `#${topic}`).join(' ')
      : '';
  const lines = [
    caption.title,
    '',
    caption.body,
    ...(topics ? ['', topics] : []),
    ...(caption.conversionHook ? ['', caption.conversionHook] : []),
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Package builders
// ---------------------------------------------------------------------------

export type ImageTextPackageInput = {
  caption: DeliveryPackageCaption;
  compliance: { aigcLabelEnabled: boolean; watermarkEnabled: boolean };
  contentPackageRevision: number;
  generatedAt: string;
  /** Ordered images with paths like images/01.jpg */
  images: readonly { mimeType: string; path: string; sizeBytes?: number }[];
  packageId: string;
  /** ZIP platform this package is for. Defaults to the modality's home 平台. */
  platform?: DeliveryZipPlatform;
  storeName: string;
  variantVersionId: string;
  factSummary?: string;
  rightsState?: string;
};

export type VideoPackageInput = {
  caption: DeliveryPackageCaption;
  compliance: { aigcLabelEnabled: boolean; watermarkEnabled: boolean };
  contentPackageRevision: number;
  generatedAt: string;
  packageId: string;
  /** ZIP platform this package is for. Defaults to the modality's home 平台. */
  platform?: DeliveryZipPlatform;
  storeName: string;
  variantVersionId: string;
  hasCover?: boolean;
  hasSubtitles?: boolean;
  subtitleFormat?: 'srt' | 'vtt';
  videoSizeBytes?: number;
  factSummary?: string;
  rightsState?: string;
};

export type MomentsSegmentsInput = {
  caption: DeliveryPackageCaption;
  contentPackageRevision: number;
  generatedAt: string;
  packageId: string;
  storeName: string;
  variantVersionId: string;
  /** Ordered media for sequential publish (朋友圈分段). */
  media: readonly { mimeType: string; path: string; sizeBytes?: number }[];
};

function orderedEntries(
  files: DeliveryPackageMediaFile[]
): DeliveryManifestFileEntry[] {
  return files.map((file, order) => ({
    mimeType: file.mimeType,
    order,
    path: file.path,
    role: file.role,
    ...(file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {}),
  }));
}

/**
 * 小红书图文完整发布包 plan (manifest/v1 layout).
 */
export function buildXiaohongshuImageTextPackage(
  input: ImageTextPackageInput
): FullPackagePlan {
  if (input.images.length === 0) {
    throw new Error(
      'An image_text delivery package requires at least one image.'
    );
  }
  const platform = input.platform ?? 'xiaohongshu';
  const first = input.images[0]!;
  const coverExt =
    first.mimeType === 'image/jpeg'
      ? 'jpg'
      : first.mimeType === 'image/webp'
        ? 'webp'
        : 'png';
  const coverPath = `cover.${coverExt}`;

  const files: DeliveryPackageMediaFile[] = [
    {
      mimeType: 'text/plain; charset=utf-8',
      path: 'caption.txt',
      role: 'caption',
    },
    {
      mimeType: first.mimeType,
      path: coverPath,
      role: 'cover',
      ...(first.sizeBytes !== undefined ? { sizeBytes: first.sizeBytes } : {}),
    },
    ...input.images.map((image) => ({
      mimeType: image.mimeType,
      path: image.path,
      role: 'image' as const,
      ...(image.sizeBytes !== undefined ? { sizeBytes: image.sizeBytes } : {}),
    })),
    {
      mimeType: 'text/markdown; charset=utf-8',
      path: 'platform-checklist.md',
      role: 'checklist',
    },
    {
      mimeType: 'application/json',
      path: 'evidence/rights-and-facts.json',
      role: 'rights_evidence',
    },
  ];

  const manifest: BeautyDeliveryManifestV1 = {
    contentPackageRevision: input.contentPackageRevision,
    files: orderedEntries(files),
    generatedAt: input.generatedAt,
    kind: 'image_text',
    packageId: input.packageId,
    platform,
    rightsSummary: {
      aigcLabelEnabled: input.compliance.aigcLabelEnabled,
      ...(input.factSummary ? { factSummary: input.factSummary } : {}),
      state: input.rightsState ?? 'authorized',
      watermarkEnabled: input.compliance.watermarkEnabled,
    },
    schema: BEAUTY_DELIVERY_MANIFEST_SCHEMA,
    variantVersionId: input.variantVersionId,
  };

  return {
    modality: 'xiaohongshu_image_text',
    kind: 'image_text',
    target: platform,
    packageId: input.packageId,
    contentPackageRevision: input.contentPackageRevision,
    variantVersionId: input.variantVersionId,
    generatedAt: input.generatedAt,
    storeName: input.storeName,
    caption: input.caption,
    files,
    manifest,
    zipFileName: buildDeliveryZipFileName({
      contentPackageRevision: input.contentPackageRevision,
      generatedAt: input.generatedAt,
      kind: 'image_text',
      platform,
      storeName: input.storeName,
    }),
    schema: BEAUTY_DELIVERY_MANIFEST_SCHEMA,
  };
}

/**
 * 抖音视频完整发布包 plan (manifest/v1 layout).
 */
export function buildDouyinVideoPackage(
  input: VideoPackageInput
): FullPackagePlan {
  const platform = input.platform ?? 'douyin';
  const files: DeliveryPackageMediaFile[] = [
    {
      mimeType: 'video/mp4',
      path: 'video.mp4',
      role: 'video',
      ...(input.videoSizeBytes !== undefined
        ? { sizeBytes: input.videoSizeBytes }
        : {}),
    },
    {
      mimeType: 'text/plain; charset=utf-8',
      path: 'caption.txt',
      role: 'caption',
    },
  ];

  if (input.hasCover !== false) {
    files.push({
      mimeType: 'image/jpeg',
      path: 'cover.jpg',
      role: 'cover',
    });
  }

  if (input.hasSubtitles) {
    const format = input.subtitleFormat ?? 'srt';
    files.push({
      mimeType: format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
      path: format === 'vtt' ? 'subtitles.vtt' : 'subtitles.srt',
      role: 'subtitles',
    });
  }

  files.push(
    {
      mimeType: 'text/markdown; charset=utf-8',
      path: 'platform-checklist.md',
      role: 'checklist',
    },
    {
      mimeType: 'application/json',
      path: 'evidence/rights-and-facts.json',
      role: 'rights_evidence',
    }
  );

  const manifest: BeautyDeliveryManifestV1 = {
    contentPackageRevision: input.contentPackageRevision,
    files: orderedEntries(files),
    generatedAt: input.generatedAt,
    kind: 'video',
    packageId: input.packageId,
    platform,
    rightsSummary: {
      aigcLabelEnabled: input.compliance.aigcLabelEnabled,
      ...(input.factSummary ? { factSummary: input.factSummary } : {}),
      state: input.rightsState ?? 'authorized',
      watermarkEnabled: input.compliance.watermarkEnabled,
    },
    schema: BEAUTY_DELIVERY_MANIFEST_SCHEMA,
    variantVersionId: input.variantVersionId,
  };

  return {
    modality: 'douyin_video',
    kind: 'video',
    target: platform,
    packageId: input.packageId,
    contentPackageRevision: input.contentPackageRevision,
    variantVersionId: input.variantVersionId,
    generatedAt: input.generatedAt,
    storeName: input.storeName,
    caption: input.caption,
    files,
    manifest,
    zipFileName: buildDeliveryZipFileName({
      contentPackageRevision: input.contentPackageRevision,
      generatedAt: input.generatedAt,
      kind: 'video',
      platform,
      storeName: input.storeName,
    }),
    schema: BEAUTY_DELIVERY_MANIFEST_SCHEMA,
  };
}

/**
 * 朋友圈分段交接包 — distribution/export target (not ZIP platform).
 * Sequential segments: title → body → topics/CTA → media.
 */
export function buildWechatMomentsSegmentsPackage(
  input: MomentsSegmentsInput
): FullPackagePlan {
  const segments: MomentsSegment[] = [
    {
      id: 'title',
      label: '标题',
      text: input.caption.title,
    },
    {
      id: 'body',
      label: '正文',
      text: input.caption.body,
    },
  ];

  if (input.caption.topics.length > 0) {
    segments.push({
      id: 'topics',
      label: '话题',
      text: input.caption.topics.map((t) => `#${t}`).join(' '),
    });
  }

  if (input.caption.conversionHook) {
    segments.push({
      id: 'cta',
      label: '转化语',
      text: input.caption.conversionHook,
    });
  }

  if (input.media.length > 0) {
    segments.push({
      id: 'media',
      label: '媒体',
      media: input.media.map((m, index) => ({
        mimeType: m.mimeType,
        path: m.path || `media/${String(index + 1).padStart(2, '0')}.jpg`,
        role: 'image' as const,
        ...(m.sizeBytes !== undefined ? { sizeBytes: m.sizeBytes } : {}),
      })),
    });
  }

  // Full caption as a single downloadable text file for convenience.
  const files: DeliveryPackageMediaFile[] = [
    {
      mimeType: 'text/plain; charset=utf-8',
      path: 'caption.txt',
      role: 'caption',
    },
    ...input.media.map((m, index) => ({
      mimeType: m.mimeType,
      path: m.path || `media/${String(index + 1).padStart(2, '0')}.jpg`,
      role: 'image' as const,
      ...(m.sizeBytes !== undefined ? { sizeBytes: m.sizeBytes } : {}),
    })),
  ];

  return {
    modality: 'wechat_moments_segments',
    kind: 'moments_segments',
    target: 'wechat_moments',
    packageId: input.packageId,
    contentPackageRevision: input.contentPackageRevision,
    variantVersionId: input.variantVersionId,
    generatedAt: input.generatedAt,
    storeName: input.storeName,
    caption: input.caption,
    files,
    segments,
    schema: 'moments-segments/v1',
  };
}

/**
 * Record that a full package download has started.
 * Never projects as platform "published".
 */
export function recordFullPackageDownload(
  plan: FullPackagePlan
): FullPackageDownloadOutcome {
  return {
    modality: plan.modality,
    downloadStarted: true,
    deliveredAs: 'full_package_download',
    fileName:
      plan.zipFileName ??
      `${sanitizeDeliveryZipSegment(plan.storeName, '门店')}-朋友圈分段.txt`,
    packageId: plan.packageId,
    contentPackageRevision: plan.contentPackageRevision,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures (three-modal acceptance)
// ---------------------------------------------------------------------------

export function xiaohongshuPackageFixture(
  overrides: Partial<ImageTextPackageInput> = {}
): FullPackagePlan {
  return buildXiaohongshuImageTextPackage({
    caption: {
      title: '夏日美甲套餐',
      body: '到店立减 50，预约从速。',
      topics: ['美甲', '夏日活动'],
      conversionHook: '私信“美甲”领优惠',
    },
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    contentPackageRevision: 3,
    generatedAt: '2026-07-18T09:00:00.000Z',
    images: [
      { mimeType: 'image/jpeg', path: 'images/01.jpg', sizeBytes: 1200 },
      { mimeType: 'image/jpeg', path: 'images/02.jpg', sizeBytes: 1300 },
    ],
    packageId: 'pkg-xhs-1',
    storeName: '花间美甲',
    variantVersionId: 'xhs-v1',
    factSummary: '价格已核对',
    ...overrides,
  });
}

export function douyinVideoPackageFixture(
  overrides: Partial<VideoPackageInput> = {}
): FullPackagePlan {
  return buildDouyinVideoPackage({
    caption: {
      title: '夏日美甲 15 秒',
      body: '跟我一起看今日款式',
      topics: ['美甲教程'],
      conversionHook: '评论区扣1预约',
    },
    compliance: { aigcLabelEnabled: true, watermarkEnabled: true },
    contentPackageRevision: 5,
    generatedAt: '2026-07-18T10:00:00.000Z',
    packageId: 'pkg-dy-1',
    storeName: '花间美甲',
    variantVersionId: 'dy-v1',
    hasCover: true,
    hasSubtitles: true,
    subtitleFormat: 'srt',
    videoSizeBytes: 50_000,
    factSummary: '成片与封面同 revision',
    ...overrides,
  });
}

export function wechatMomentsSegmentsFixture(
  overrides: Partial<MomentsSegmentsInput> = {}
): FullPackagePlan {
  return buildWechatMomentsSegmentsPackage({
    caption: {
      title: '本周活动',
      body: '朋友圈专属：老客带新立减 30',
      topics: ['门店活动'],
      conversionHook: '到店报暗号“朋友圈”',
    },
    contentPackageRevision: 2,
    generatedAt: '2026-07-18T11:00:00.000Z',
    packageId: 'pkg-moments-1',
    storeName: '花间美甲',
    variantVersionId: 'moments-v1',
    media: [
      { mimeType: 'image/jpeg', path: 'media/01.jpg', sizeBytes: 900 },
      { mimeType: 'image/jpeg', path: 'media/02.jpg', sizeBytes: 950 },
    ],
    ...overrides,
  });
}

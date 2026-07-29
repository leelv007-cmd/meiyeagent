import type { RightsBasis } from '@meiye/contracts';
import { strToU8, zipSync } from 'fflate';

import {
  buildBeautyDeliveryManifest,
  serializeBeautyDeliveryManifest,
  type BeautyDeliveryManifestV1,
  type DeliveryManifestBuildFile,
  type DeliveryManifestRightsSummary,
} from './delivery-manifest.js';

/** Fixed ZIP entry mtime for byte-identical replay (same as export adapter). */
export const DELIVERY_ZIP_ENTRY_MTIME = new Date(1980, 0, 1);

const MAX_ZIP_NAME_LENGTH = 120;

export type DeliveryPackagePlatform = BeautyDeliveryManifestV1['platform'];
export type DeliveryPackageKind = BeautyDeliveryManifestV1['kind'];

export type DeliveryPackageCaption = {
  body: string;
  conversionHook?: string;
  title: string;
  topics: readonly string[];
};

export type ImageTextDeliveryPackageInput = {
  caption: DeliveryPackageCaption;
  compliance: {
    aigcLabelEnabled: boolean;
    watermarkEnabled: boolean;
    watermarkText?: string;
  };
  contentPackageRevision: number;
  generatedAt: string;
  /** Ordered prepared image files: path like images/01.jpg and bytes. */
  images: readonly { bytes: Uint8Array; mimeType: string; path: string }[];
  packageId: string;
  platform: DeliveryPackagePlatform;
  rightsBasis?: RightsBasis;
  rightsState?: string;
  factSummary?: string;
  storeName: string;
  variantVersionId: string;
};

export type CopyDeliveryPackageInput = Omit<
  ImageTextDeliveryPackageInput,
  'images'
>;

export type VideoFullDeliveryPackageInput = {
  caption: DeliveryPackageCaption;
  compliance: {
    aigcLabelEnabled: boolean;
    watermarkEnabled: boolean;
    watermarkText?: string;
  };
  contentPackageRevision: number;
  generatedAt: string;
  packageId: string;
  platform: DeliveryPackagePlatform;
  rightsBasis?: RightsBasis;
  rightsState?: string;
  factSummary?: string;
  storeName: string;
  /** Optional subtitles track. */
  subtitles?: { format: 'srt' | 'vtt'; text: string };
  variantVersionId: string;
  video: { bytes: Uint8Array };
};

export type BuiltDeliveryPackage = {
  files: Record<string, Uint8Array>;
  fileName: string;
  manifest: BeautyDeliveryManifestV1;
  zipBytes: Uint8Array;
};

const PLATFORM_LABEL: Record<DeliveryPackagePlatform, string> = {
  douyin: '抖音',
  video_account: '视频号',
  xiaohongshu: '小红书',
};

const KIND_LABEL: Record<DeliveryPackageKind, string> = {
  image_text: '图文',
  video: '视频',
};

/**
 * Deterministic sanitize for ZIP download names.
 * Strips path separators and illegal characters; collapses whitespace;
 * falls back to a stable placeholder when empty.
 */
export function sanitizeDeliveryZipSegment(
  value: string,
  fallback: string,
): string {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^\.+|\.+$/gu, '')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function shortRevisionToken(revision: number | string): string {
  if (typeof revision === 'number') {
    return `r${revision}`;
  }
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

/**
 * ZIP name: `{门店}-{内容类型}-{平台}-{YYYYMMDD}-{短revision}.zip`
 */
export function buildDeliveryZipFileName(input: {
  contentPackageRevision: number | string;
  generatedAt: string;
  kind: DeliveryPackageKind;
  platform: DeliveryPackagePlatform;
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

export function buildPlatformChecklistMarkdown(input: {
  kind: DeliveryPackageKind;
  platform: DeliveryPackagePlatform;
}): string {
  const common = [
    '- [ ] 核对门店名称、价格与活动事实',
    '- [ ] 预览全部媒体清晰度与顺序',
    '- [ ] 确认 AIGC / 品牌水印展示符合平台规则',
  ];
  const platformLines: Record<
    DeliveryPackageKind,
    Record<DeliveryPackagePlatform, string[]>
  > = {
    image_text: {
      douyin: [
        '- [ ] 按 images/ 编号顺序上传图片',
        '- [ ] 粘贴 caption 文案与话题',
        '- [ ] 在发布页确认图片顺序',
      ],
      video_account: [
        '- [ ] 按 images/ 编号顺序上传图片',
        '- [ ] 粘贴 caption 文案',
        '- [ ] 确认视频号发布可见范围',
      ],
      xiaohongshu: [
        '- [ ] 按 images/ 编号顺序上传图片',
        '- [ ] 粘贴标题、正文与话题',
        '- [ ] 确认封面为第 1 张图',
      ],
    },
    video: {
      douyin: [
        '- [ ] 上传 video.mp4',
        '- [ ] 粘贴 caption 文案与话题',
        '- [ ] 封面与字幕可在抖音发布页自选/自动生成',
      ],
      video_account: [
        '- [ ] 上传 video.mp4',
        '- [ ] 粘贴 caption 文案',
        '- [ ] 确认视频号发布可见范围',
      ],
      xiaohongshu: [
        '- [ ] 上传 video.mp4',
        '- [ ] 粘贴标题、正文与话题',
        '- [ ] 在发布页确认展示效果',
      ],
    },
  };
  const kindLine =
    input.kind === 'video'
      ? '- [ ] 确认成片内容、门店信息与本次发布一致'
      : '- [ ] 确认图文套图顺序与封面一致';
  return [
    `# ${PLATFORM_LABEL[input.platform]}发布核对清单`,
    '',
    ...common,
    kindLine,
    ...platformLines[input.kind][input.platform],
    '',
  ].join('\n');
}

export function buildRightsAndFactsJson(input: {
  compliance: ImageTextDeliveryPackageInput['compliance'];
  contentPackageRevision: number;
  factSummary?: string;
  packageId: string;
  platform: DeliveryPackagePlatform;
  rightsBasis?: RightsBasis;
  rightsState: string;
  variantVersionId: string;
}): string {
  return `${JSON.stringify(
    {
      aigcLabelEnabled: input.compliance.aigcLabelEnabled,
      contentPackageRevision: input.contentPackageRevision,
      factSummary: input.factSummary ?? '发布前请核对门店与价格事实。',
      packageId: input.packageId,
      platform: input.platform,
      ...(input.rightsBasis ? { basis: input.rightsBasis.kind } : {}),
      rightsState: input.rightsState,
      variantVersionId: input.variantVersionId,
      watermarkEnabled: input.compliance.watermarkEnabled,
      ...(input.compliance.watermarkText
        ? { watermarkText: input.compliance.watermarkText }
        : {}),
    },
    null,
    2,
  )}\n`;
}

function rightsSummaryFrom(input: {
  compliance: ImageTextDeliveryPackageInput['compliance'];
  factSummary?: string;
  rightsBasis?: RightsBasis;
  rightsState?: string;
}): DeliveryManifestRightsSummary {
  return {
    aigcLabelEnabled: input.compliance.aigcLabelEnabled,
    ...(input.rightsBasis ? { basis: input.rightsBasis.kind } : {}),
    ...(input.factSummary ? { factSummary: input.factSummary } : {}),
    state: input.rightsState ?? 'authorized',
    watermarkEnabled: input.compliance.watermarkEnabled,
  };
}

/**
 * Pack files into a deterministic ZIP (fixed mtime + stable path order).
 */
export function packDeterministicZip(
  files: Record<string, Uint8Array>,
): Uint8Array {
  const ordered: Record<string, Uint8Array> = {};
  for (const path of Object.keys(files).sort()) {
    ordered[path] = files[path]!;
  }
  return zipSync(ordered, { level: 6, mtime: DELIVERY_ZIP_ENTRY_MTIME });
}

/**
 * Deterministic finalize: media files listed in the manifest; manifest.json
 * is embedded in the archive and describes payload files only.
 */
function finalizePackage(input: {
  contentPackageRevision: number;
  fileEntries: DeliveryManifestBuildFile[];
  files: Record<string, Uint8Array>;
  generatedAt: string;
  kind: DeliveryPackageKind;
  packageId: string;
  platform: DeliveryPackagePlatform;
  rightsSummary: DeliveryManifestRightsSummary;
  storeName: string;
  variantVersionId: string;
}): BuiltDeliveryPackage {
  const manifest = buildBeautyDeliveryManifest({
    contentPackageRevision: input.contentPackageRevision,
    files: input.fileEntries,
    generatedAt: input.generatedAt,
    kind: input.kind,
    packageId: input.packageId,
    platform: input.platform,
    rightsSummary: input.rightsSummary,
    variantVersionId: input.variantVersionId,
  });
  const manifestBytes = strToU8(serializeBeautyDeliveryManifest(manifest));
  const files = {
    ...input.files,
    'manifest.json': manifestBytes,
  };
  return {
    fileName: buildDeliveryZipFileName({
      contentPackageRevision: input.contentPackageRevision,
      generatedAt: input.generatedAt,
      kind: input.kind,
      platform: input.platform,
      storeName: input.storeName,
    }),
    files,
    manifest,
    zipBytes: packDeterministicZip(files),
  };
}

/**
 * Build an image_text full delivery package (manifest/v1 + caption + images +
 * cover + checklist + rights evidence).
 */
export function buildImageTextDeliveryPackage(
  input: ImageTextDeliveryPackageInput,
): BuiltDeliveryPackage {
  if (input.images.length === 0) {
    throw new Error(
      'An image_text delivery package requires at least one image.',
    );
  }

  const captionText = buildCaptionText(input.caption);
  const checklist = buildPlatformChecklistMarkdown({
    kind: 'image_text',
    platform: input.platform,
  });
  const rightsJson = buildRightsAndFactsJson({
    compliance: input.compliance,
    contentPackageRevision: input.contentPackageRevision,
    factSummary: input.factSummary,
    packageId: input.packageId,
    platform: input.platform,
    rightsBasis: input.rightsBasis,
    rightsState: input.rightsState ?? 'authorized',
    variantVersionId: input.variantVersionId,
  });

  const first = input.images[0]!;
  const coverExt =
    first.mimeType === 'image/jpeg'
      ? 'jpg'
      : first.mimeType === 'image/webp'
        ? 'webp'
        : 'png';
  const coverPath = `cover.${coverExt}`;

  const files: Record<string, Uint8Array> = {
    'caption.txt': strToU8(captionText),
    [coverPath]: first.bytes,
    'platform-checklist.md': strToU8(checklist),
    'evidence/rights-and-facts.json': strToU8(rightsJson),
  };

  const fileEntries: DeliveryManifestBuildFile[] = [
    {
      bytes: files['caption.txt']!,
      mimeType: 'text/plain; charset=utf-8',
      path: 'caption.txt',
      role: 'caption',
    },
    {
      bytes: files[coverPath]!,
      mimeType: first.mimeType,
      path: coverPath,
      role: 'cover',
    },
  ];

  for (const image of input.images) {
    files[image.path] = image.bytes;
    fileEntries.push({
      bytes: image.bytes,
      mimeType: image.mimeType,
      path: image.path,
      role: 'image',
    });
  }

  fileEntries.push(
    {
      bytes: files['platform-checklist.md']!,
      mimeType: 'text/markdown; charset=utf-8',
      path: 'platform-checklist.md',
      role: 'checklist',
    },
    {
      bytes: files['evidence/rights-and-facts.json']!,
      mimeType: 'application/json',
      path: 'evidence/rights-and-facts.json',
      role: 'rights_evidence',
    },
  );

  return finalizePackage({
    contentPackageRevision: input.contentPackageRevision,
    fileEntries,
    files,
    generatedAt: input.generatedAt,
    kind: 'image_text',
    packageId: input.packageId,
    platform: input.platform,
    rightsSummary: rightsSummaryFrom(input),
    storeName: input.storeName,
    variantVersionId: input.variantVersionId,
  });
}

/**
 * Build the text-only form of an image_text ContentPackage.
 *
 * ContentPackage v1 represents Composer copy and image-text output with the
 * same `image_text` kind. A copy revision therefore has no ordered image
 * assets, but still needs the canonical manifest, checklist and rights
 * evidence instead of failing export or inventing a cover image.
 */
export function buildCopyDeliveryPackage(
  input: CopyDeliveryPackageInput,
): BuiltDeliveryPackage {
  const captionText = buildCaptionText(input.caption);
  const checklist = [
    `# ${PLATFORM_LABEL[input.platform]}文案发布核对清单`,
    '',
    '- [ ] 核对门店名称、价格与活动事实',
    '- [ ] 复制 caption 文案与话题',
    '- [ ] 确认 AIGC 标识符合平台规则',
    '',
  ].join('\n');
  const rightsJson = buildRightsAndFactsJson({
    compliance: input.compliance,
    contentPackageRevision: input.contentPackageRevision,
    factSummary: input.factSummary,
    packageId: input.packageId,
    platform: input.platform,
    rightsBasis: input.rightsBasis,
    rightsState: input.rightsState ?? 'authorized',
    variantVersionId: input.variantVersionId,
  });
  const files = {
    'caption.txt': strToU8(captionText),
    'evidence/rights-and-facts.json': strToU8(rightsJson),
    'platform-checklist.md': strToU8(checklist),
  };
  return finalizePackage({
    contentPackageRevision: input.contentPackageRevision,
    fileEntries: [
      {
        bytes: files['caption.txt'],
        mimeType: 'text/plain; charset=utf-8',
        path: 'caption.txt',
        role: 'caption',
      },
      {
        bytes: files['platform-checklist.md'],
        mimeType: 'text/markdown; charset=utf-8',
        path: 'platform-checklist.md',
        role: 'checklist',
      },
      {
        bytes: files['evidence/rights-and-facts.json'],
        mimeType: 'application/json',
        path: 'evidence/rights-and-facts.json',
        role: 'rights_evidence',
      },
    ],
    files,
    generatedAt: input.generatedAt,
    kind: 'image_text',
    packageId: input.packageId,
    platform: input.platform,
    rightsSummary: rightsSummaryFrom(input),
    storeName: input.storeName,
    variantVersionId: input.variantVersionId,
  });
}

/**
 * Build a video full delivery package:
 * video.mp4 / caption.txt / subtitles / checklist / manifest.
 */
export function buildVideoFullDeliveryPackage(
  input: VideoFullDeliveryPackageInput,
): BuiltDeliveryPackage {
  const captionText = buildCaptionText(input.caption);
  const checklist = buildPlatformChecklistMarkdown({
    kind: 'video',
    platform: input.platform,
  });
  const rightsJson = buildRightsAndFactsJson({
    compliance: input.compliance,
    contentPackageRevision: input.contentPackageRevision,
    factSummary: input.factSummary,
    packageId: input.packageId,
    platform: input.platform,
    rightsBasis: input.rightsBasis,
    rightsState: input.rightsState ?? 'authorized',
    variantVersionId: input.variantVersionId,
  });

  const files: Record<string, Uint8Array> = {
    'video.mp4': input.video.bytes,
    'caption.txt': strToU8(captionText),
    'platform-checklist.md': strToU8(checklist),
    'evidence/rights-and-facts.json': strToU8(rightsJson),
  };

  const fileEntries: DeliveryManifestBuildFile[] = [
    {
      bytes: input.video.bytes,
      mimeType: 'video/mp4',
      path: 'video.mp4',
      role: 'video',
    },
    {
      bytes: files['caption.txt']!,
      mimeType: 'text/plain; charset=utf-8',
      path: 'caption.txt',
      role: 'caption',
    },
  ];

  if (input.subtitles) {
    const subPath =
      input.subtitles.format === 'vtt' ? 'subtitles.vtt' : 'subtitles.srt';
    const subBytes = strToU8(input.subtitles.text);
    files[subPath] = subBytes;
    fileEntries.push({
      bytes: subBytes,
      mimeType:
        input.subtitles.format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
      path: subPath,
      role: 'subtitles',
    });
  }

  fileEntries.push(
    {
      bytes: files['platform-checklist.md']!,
      mimeType: 'text/markdown; charset=utf-8',
      path: 'platform-checklist.md',
      role: 'checklist',
    },
    {
      bytes: files['evidence/rights-and-facts.json']!,
      mimeType: 'application/json',
      path: 'evidence/rights-and-facts.json',
      role: 'rights_evidence',
    },
  );

  return finalizePackage({
    contentPackageRevision: input.contentPackageRevision,
    fileEntries,
    files,
    generatedAt: input.generatedAt,
    kind: 'video',
    packageId: input.packageId,
    platform: input.platform,
    rightsSummary: rightsSummaryFrom(input),
    storeName: input.storeName,
    variantVersionId: input.variantVersionId,
  });
}

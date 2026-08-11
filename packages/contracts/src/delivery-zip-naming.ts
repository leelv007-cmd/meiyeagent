/**
 * Delivery ZIP naming + caption text — the single cross-tier authority.
 * Core builds the real ZIP bytes; the App Shell pre-computes the same names
 * and caption text for its delivery UI. Both consume this module; neither
 * keeps a local copy.
 *
 * History: until 2026-08-12 the two tiers carried hand-copied twins whose
 * sanitize regexes had drifted (Core stripped only C0 controls, the Shell
 * also stripped C1 via \p{Cc}) — the same store name produced different ZIP
 * names per tier. The stricter behavior is canonical.
 */

export type DeliveryZipPlatform = 'douyin' | 'video_account' | 'xiaohongshu';
/** Delivery wire kind (legacy alias vocabulary is the wire contract here). */
export type DeliveryZipKind = 'image_text' | 'video';

export type DeliveryPackageCaption = {
  body: string;
  conversionHook?: string;
  title: string;
  topics: readonly string[];
};

const PLATFORM_LABEL: Record<DeliveryZipPlatform, string> = {
  douyin: '抖音',
  video_account: '视频号',
  xiaohongshu: '小红书',
};

const KIND_LABEL: Record<DeliveryZipKind, string> = {
  image_text: '图文',
  video: '视频',
};

export const MAX_ZIP_NAME_LENGTH = 120;

/**
 * Deterministic sanitize for ZIP download names.
 * Strips path separators, illegal characters and all Unicode control
 * characters (C0 and C1); collapses whitespace; falls back to a stable
 * placeholder when empty.
 */
export function sanitizeDeliveryZipSegment(
  value: string,
  fallback: string,
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
  kind: DeliveryZipKind;
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

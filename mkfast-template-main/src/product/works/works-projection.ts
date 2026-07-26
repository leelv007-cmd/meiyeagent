/**
 * 作品面投影 — T32 / #226.
 *
 * 唯一投影纪律 (ADR-0011 / D-127): the works surface reads the canonical
 * ContentPackage projection (`operations.content_packages`) and the canonical
 * canvas-work projection (`operations.canonical_history`). It never touches
 * the named-legacy projection strings, `legacy-content-package-projection`, or
 * the old `content-package-card` IA — those are the delete-after-reshell
 * bucket, and a second projection is exactly the 「新旧投影矛盾」 defect this
 * ticket closes. `scripts/uiux/works-canonical-projection-guard.mjs` holds the
 * line in `pnpm check`.
 *
 * Everything here is pure: same inputs → same list, same detail, same labels.
 * The pages below only render it.
 */

import type {
  ContentPackageStatus,
  ContentPackageVersion,
  PublicContentPackage,
} from '@meiye/contracts';
import { contentPackageStatusLabel } from '@meiye/contracts';

import type { RawCanvasWorkSummary } from '@/product/canonical-history-model';

/**
 * 四类输出 (D-118). Derived from what was actually delivered, not from a
 * declared intent: the merchant's 作品 is the thing in their hands, and a run
 * that promised a note but delivered only copy must not be filed as a note.
 */
export type WorkOutputShape = 'copy' | 'image' | 'note' | 'video';

export const WORK_OUTPUT_SHAPE_LABELS: Record<WorkOutputShape, string> = {
  copy: '文案',
  image: '图片',
  note: '图文',
  video: '视频',
};

export const WORK_OUTPUT_SHAPE_ORDER: WorkOutputShape[] = [
  'copy',
  'image',
  'note',
  'video',
];

/** One media item in the 作品 gallery. */
export type WorkMedia = {
  assetId: string;
  kind: 'image' | 'video';
  src: string;
  title: string;
};

export type WorkListItem = {
  /** Route param for the detail page. */
  detailId: string;
  excerpt: string;
  media: WorkMedia[];
  outputShape: WorkOutputShape;
  /** 成品版本号 — absent while a package has not delivered a version yet. */
  revision: number | null;
  statusLabel: string;
  title: string;
  updatedAt: string;
  /** `package` rows carry a ContentPackage; `canvas` rows are 轻编辑 works. */
  kind: 'package' | 'canvas';
};

export type WorkEvidenceChip = { id: string; label: string };

export type WorkPackageDetail = {
  kind: 'package';
  /** The revision the actions execute against — 我确认的就是我拿到的 (D-117). */
  confirmedRevision: {
    packageId: string;
    revision: number;
    versionId: string;
  } | null;
  /** 使用导购 — what to do with this 作品 next. */
  guidance: string[];
  /** 生成依据 — merchant-language provenance, never internal ids. */
  evidence: WorkEvidenceChip[];
  body: string;
  media: WorkMedia[];
  outputShape: WorkOutputShape;
  packageId: string;
  /** Platform the canonical export/handoff commands are bound to. */
  platform: 'xiaohongshu' | 'douyin' | 'video_account' | null;
  rightsRevoked: boolean;
  status: ContentPackageStatus;
  statusLabel: string;
  title: string;
  topics: string[];
  updatedAt: string;
  workId: string | null;
};

export type WorkCanvasDetail = {
  kind: 'canvas';
  workId: string;
};

export type WorkDetail =
  | WorkPackageDetail
  | WorkCanvasDetail
  | { kind: 'missing' };

const PLATFORM_LABELS: Record<
  'xiaohongshu' | 'douyin' | 'video_account',
  string
> = {
  douyin: '抖音',
  video_account: '视频号',
  xiaohongshu: '小红书',
};

function currentVersion(
  contentPackage: PublicContentPackage
): ContentPackageVersion | undefined {
  if (!contentPackage.currentVersionId) return undefined;
  return contentPackage.versions.find(
    (version) => version.id === contentPackage.currentVersionId
  );
}

/**
 * Media the package actually delivered. Ordered the way the adopted version
 * ordered it, so the gallery's first frame is the cover the merchant chose.
 */
export function deliveredMedia(
  contentPackage: PublicContentPackage
): WorkMedia[] {
  const owned = new Map(
    (contentPackage.generated.ownedAssets ?? []).map((asset) => [
      asset.id,
      asset,
    ])
  );
  const version = currentVersion(contentPackage);
  const ordered = version?.orderedAssetIds ?? [];
  const ids = [
    ...ordered,
    ...contentPackage.generated.assetIds.filter((id) => !ordered.includes(id)),
  ];
  const title = version?.title?.trim() || '作品';
  const media: WorkMedia[] = [];
  for (const id of ids) {
    const asset = owned.get(id);
    if (!asset) continue;
    media.push({
      assetId: asset.id,
      kind: asset.contentType.startsWith('video/') ? 'video' : 'image',
      src: `/api/core/p1/assets?objectKey=${encodeURIComponent(asset.objectKey)}`,
      title,
    });
  }
  return media;
}

/**
 * 四形态判定. `kind: 'video'` is the only shape core states outright; the other
 * three are read off the delivered version — copy with no media is 文案, media
 * with no words is 图片, both together is 图文.
 */
export function workOutputShape(
  contentPackage: PublicContentPackage
): WorkOutputShape {
  if (contentPackage.kind === 'video') return 'video';
  const media = deliveredMedia(contentPackage);
  if (media.some((item) => item.kind === 'video')) return 'video';
  const body = currentVersion(contentPackage)?.body.trim() ?? '';
  if (media.length === 0) return 'copy';
  return body === '' ? 'image' : 'note';
}

function excerptOf(text: string, limit = 60) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}…`;
}

/**
 * 生成依据 — why this 作品 looks the way it does, in merchant words.
 * Only canonical, merchant-safe facts: no prompt, no model id, no route
 * snapshot, no cost (D-123). Absent evidence is simply omitted, never guessed.
 */
export function workEvidence(
  contentPackage: PublicContentPackage
): WorkEvidenceChip[] {
  const chips: WorkEvidenceChip[] = [];
  const version = currentVersion(contentPackage);
  const marketing = contentPackage.marketing;
  if (
    (marketing?.factRefs.length ?? 0) > 0 ||
    contentPackage.source.storeProfileId
  ) {
    chips.push({ id: 'store', label: '用了本店已确认的门店事实' });
  }
  if (contentPackage.source.groundingId) {
    chips.push({ id: 'grounding', label: '内容基于本次确认的创作依据' });
  }
  if ((marketing?.identityRefs.length ?? 0) > 0) {
    chips.push({ id: 'identity', label: '按已选营销身份的口吻表达' });
  } else if (marketing?.identityFallback === 'brand_official') {
    // M-03 / D-117: 「未选择」 is stated as the neutral store voice, never as a
    // silently seeded identity.
    chips.push({ id: 'identity-fallback', label: '按门店官方中性口吻表达' });
  }
  if ((contentPackage.source.assetIds ?? []).length > 0) {
    chips.push({ id: 'assets', label: '用了你上传的真实素材' });
  }
  if (contentPackage.source.targetPlatform) {
    chips.push({
      id: 'platform',
      label: `按${PLATFORM_LABELS[contentPackage.source.targetPlatform]}的发布习惯适配`,
    });
  }
  if (version?.source === 'merchant_edited') {
    chips.push({ id: 'edited', label: '这一版含你自己的修改' });
  }
  if (contentPackage.source.aigcLabelEnabled) {
    chips.push({ id: 'aigc', label: '已带 AI 生成标识' });
  }
  return chips;
}

/**
 * 使用导购 — the next move, stated as advice rather than as a status readout.
 * Order matters: the blocking sentence (rights revoked) always comes first.
 */
export function workUsageGuidance(
  contentPackage: PublicContentPackage,
  shape: WorkOutputShape
): string[] {
  const lines: string[] = [];
  if (contentPackage.rights.state === 'revoked') {
    lines.push('这份作品里的素材授权已撤回，先换掉素材再导出。');
    return lines;
  }
  switch (contentPackage.status) {
    case 'accepted':
      lines.push('这一版已确认，可以直接导出或交给同事去发。');
      break;
    case 'review_ready':
      lines.push('成品已就绪，确认满意后再导出。');
      break;
    case 'export_failed':
      lines.push('上次导出没成功，成品还在，重试导出即可。');
      break;
    case 'partial':
      lines.push('这次只完成了一部分，其余可以在结果面里接着补。');
      break;
    default:
      lines.push('这份作品还在流程里，完成后会出现在这里。');
      break;
  }
  switch (shape) {
    case 'copy':
      lines.push('复制正文就能贴到平台或发给顾客。');
      break;
    case 'image':
      lines.push('图片可以直接下载去发，也可以进轻编辑改字改版式。');
      break;
    case 'note':
      lines.push('图和文是一整份，导出时会一起带走。');
      break;
    case 'video':
      lines.push('成片可以直接下载发布，封面与字幕一并交付。');
      break;
  }
  return lines;
}

/**
 * Platform the canonical delivery commands bind to. Prefers what the merchant
 * asked for; falls back to the only variant when there is exactly one, so a
 * single-variant package still has a working 导出 button.
 */
export function workDeliveryPlatform(contentPackage: PublicContentPackage) {
  const target = contentPackage.source.targetPlatform;
  if (
    target &&
    contentPackage.variants.some((variant) => variant.platform === target)
  ) {
    return target;
  }
  return contentPackage.variants[0]?.platform ?? null;
}

function packageListItem(contentPackage: PublicContentPackage): WorkListItem {
  const version = currentVersion(contentPackage);
  const shape = workOutputShape(contentPackage);
  return {
    detailId: contentPackage.id,
    excerpt: excerptOf(version?.body ?? ''),
    kind: 'package',
    media: deliveredMedia(contentPackage),
    outputShape: shape,
    revision: version ? contentPackage.revision : null,
    statusLabel: contentPackageStatusLabel(contentPackage.status),
    title: version?.title?.trim() || `未命名${WORK_OUTPUT_SHAPE_LABELS[shape]}`,
    updatedAt: contentPackage.updatedAt,
  };
}

function canvasListItem(work: RawCanvasWorkSummary): WorkListItem {
  return {
    detailId: work.id,
    excerpt: '在轻编辑里做的图文作品',
    kind: 'canvas',
    media: [],
    outputShape: 'image',
    revision:
      work.revisions.find((revision) => revision.id === work.currentRevisionId)
        ?.revision ?? null,
    statusLabel: '可继续编辑',
    title: work.name,
    updatedAt: work.updatedAt,
  };
}

/**
 * The one list behind 作品: every delivered ContentPackage plus every 轻编辑
 * canvas work, newest first. Both are 作品 to the merchant, so both are here —
 * D07 keeps Work/Job/Session/Asset objects out of this surface.
 */
export function worksListItems(input: {
  canvasWorks?: readonly RawCanvasWorkSummary[];
  contentPackages: readonly PublicContentPackage[];
  shape?: WorkOutputShape | 'all';
  query?: string;
}): WorkListItem[] {
  const items = [
    ...input.contentPackages.map(packageListItem),
    ...(input.canvasWorks ?? []).map(canvasListItem),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const shaped =
    !input.shape || input.shape === 'all'
      ? items
      : items.filter((item) => item.outputShape === input.shape);
  const normalized = input.query?.trim().toLocaleLowerCase() ?? '';
  if (!normalized) return shaped;
  return shaped.filter((item) =>
    [item.title, item.excerpt, WORK_OUTPUT_SHAPE_LABELS[item.outputShape]].some(
      (value) => value.toLocaleLowerCase().includes(normalized)
    )
  );
}

/** Per-shape counts for the list filter, computed before the shape filter. */
export function worksShapeCounts(input: {
  canvasWorks?: readonly RawCanvasWorkSummary[];
  contentPackages: readonly PublicContentPackage[];
}): Record<WorkOutputShape, number> {
  const counts: Record<WorkOutputShape, number> = {
    copy: 0,
    image: 0,
    note: 0,
    video: 0,
  };
  for (const item of worksListItems(input)) counts[item.outputShape] += 1;
  return counts;
}

/**
 * Detail resolution. The route param is a ContentPackage id, a Work id, or a
 * canvas work id — 交付卡 hands over a workId, the list hands over a packageId,
 * and both must land on the same 作品.
 */
export function workDetail(input: {
  canvasWorks?: readonly RawCanvasWorkSummary[];
  contentPackages: readonly PublicContentPackage[];
  id: string;
}): WorkDetail {
  const byId = input.contentPackages.find(
    (contentPackage) => contentPackage.id === input.id
  );
  const byWorkId = byId
    ? undefined
    : [...input.contentPackages]
        .filter((contentPackage) => contentPackage.source.workId === input.id)
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            right.revision - left.revision
        )[0];
  const contentPackage = byId ?? byWorkId;
  if (contentPackage) return packageDetail(contentPackage);
  if ((input.canvasWorks ?? []).some((work) => work.id === input.id)) {
    return { kind: 'canvas', workId: input.id };
  }
  return { kind: 'missing' };
}

function packageDetail(
  contentPackage: PublicContentPackage
): WorkPackageDetail {
  const version = currentVersion(contentPackage);
  const shape = workOutputShape(contentPackage);
  return {
    body: version?.body ?? '',
    confirmedRevision:
      version && contentPackage.currentVersionId
        ? {
            packageId: contentPackage.id,
            revision: contentPackage.revision,
            versionId: contentPackage.currentVersionId,
          }
        : null,
    evidence: workEvidence(contentPackage),
    guidance: workUsageGuidance(contentPackage, shape),
    kind: 'package',
    media: deliveredMedia(contentPackage),
    outputShape: shape,
    packageId: contentPackage.id,
    platform: workDeliveryPlatform(contentPackage),
    rightsRevoked: contentPackage.rights.state === 'revoked',
    status: contentPackage.status,
    statusLabel: contentPackageStatusLabel(contentPackage.status),
    title: version?.title?.trim() || `未命名${WORK_OUTPUT_SHAPE_LABELS[shape]}`,
    topics: [...(version?.topics ?? [])],
    updatedAt: contentPackage.updatedAt,
    workId: contentPackage.source.workId ?? null,
  };
}

/** 复制 payload — what a merchant would paste, nothing else. */
export function workCopyText(detail: WorkPackageDetail): string {
  return [
    detail.title,
    detail.body,
    detail.topics.map((topic) => `#${topic}`).join(' '),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 协办交接 doorway. ADR-0014 forbids a second submit truth, so handoff stays
 * one flow: the works surface opens the canonical delivery panel already bound
 * to the revision it was showing.
 */
export function workHandoffHref(detail: WorkPackageDetail): string | null {
  if (!detail.workId || !detail.confirmedRevision) return null;
  const search = new URLSearchParams({
    contentId: detail.confirmedRevision.packageId,
    panel: 'delivery',
    versionId: detail.confirmedRevision.versionId,
  });
  return `/dashboard/results/${encodeURIComponent(detail.workId)}?${search}`;
}

/** Idempotency key for 导出 — one key per (package, revision, platform). */
export function workExportIdempotencyKey(
  detail: WorkPackageDetail
): string | null {
  if (!detail.confirmedRevision || !detail.platform) return null;
  const { packageId, revision } = detail.confirmedRevision;
  return `works-export:${packageId}:${revision}:${detail.platform}`;
}

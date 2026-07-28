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

import { canvasName } from '@/p1/canvas-name';
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
  /**
   * Whether core will accept a 导出 for this 作品 right now.
   * `needs_adoption` is the common case straight out of a run: core exports an
   * adopted 成品 only (assertContentPackageExportAllowed), so offering 导出 there
   * would hand the merchant a server error instead of a file.
   * `text_only` is the 文案 case: the delivery package is a ZIP of images plus
   * the caption, and core refuses to build one without an image — 复制文字 is
   * how a words-only 作品 gets used.
   */
  exportability: 'ready' | 'needs_adoption' | 'text_only' | 'blocked';
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
  const title = version?.title?.trim() || '内容';
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

/** The shape 血缘 needs off a CreativeWork — nothing else is read. */
export type WorkLineageSource = {
  id: string;
  sourceReferences: readonly { id: string; kind: string }[];
};

/**
 * Which ContentPackage this 作品 was made from, or undefined for a first draft.
 *
 * W08 has two writers and they do not meet. `source.sourceContentPackage` is
 * the canonical field, and only a Composer submission can set it: it is frozen
 * into the creation execution snapshot before the package shell exists, and the
 * revision port refuses a package whose shell does not already carry it.
 * 「基于此再创作」/「下一轮」 go the other way — `derive_creative_work` mints a
 * draft Work with the source package on `sourceReferences`, and no snapshot is
 * produced at that moment (the Composer coordinator mints its own Work id, so a
 * derived Work can never become that snapshot's Work). On that path the
 * canonical field stays empty, which is why both 「基于 X」 surfaces stayed
 * silent on exactly the flow that creates lineage.
 *
 * So both writers are read, canonical first. One predicate, so 结果中心 and
 * 作品面 can never disagree about whether a 作品 is a re-creation.
 */
export function workLineageSourcePackageId(input: {
  contentPackage?: Pick<PublicContentPackage, 'source'> | undefined;
  /** The Work this surface is showing, when it has one. */
  work?: WorkLineageSource | undefined;
}): string | undefined {
  return (
    input.contentPackage?.source.sourceContentPackage?.id ??
    input.work?.sourceReferences.find(
      (reference) => reference.kind === 'content'
    )?.id
  );
}

/**
 * 生成依据 — why this 作品 looks the way it does, in merchant words.
 * Only canonical, merchant-safe facts: no prompt, no model id, no route
 * snapshot, no cost (D-123). Absent evidence is simply omitted, never guessed.
 */
export function workEvidence(
  contentPackage: PublicContentPackage,
  work?: WorkLineageSource
): WorkEvidenceChip[] {
  const chips: WorkEvidenceChip[] = [];
  const version = currentVersion(contentPackage);
  const marketing = contentPackage.marketing;
  if (
    (marketing?.factRefs.length ?? 0) > 0 ||
    contentPackage.source.storeProfileId
  ) {
    chips.push({ id: 'store', label: '用了本店已确认的门店信息' });
  }
  if (contentPackage.source.groundingId) {
    chips.push({ id: 'grounding', label: '内容基于本次确认的创作依据' });
  }
  if ((marketing?.identityRefs.length ?? 0) > 0) {
    chips.push({ id: 'identity', label: '按已选营销身份的口吻表达' });
  } else if (marketing) {
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
  // W08: a re-creation used to look exactly like a first draft. Read through
  // both lineage writers (workLineageSourcePackageId) — the canonical field is
  // empty on the 再创作 path that produces most of this surface's lineage.
  if (workLineageSourcePackageId({ contentPackage, work })) {
    chips.push({ id: 'lineage', label: '基于你之前的一条内容再创作' });
  }
  if (contentPackage.source.aigcLabelEnabled) {
    chips.push({ id: 'aigc', label: '已带 AI 生成标识' });
  }
  return chips;
}

/**
 * 使用导购 — the next move, stated as advice rather than as a status readout.
 *
 * The action line switches on `exportability`, which is the same key the action
 * row switches on. That is the point: a merchant read a line telling them to
 * 先采用 on a 文案 作品 whose 采用 doorway is not rendered, and the page had no
 * way out. Deriving both from one key makes that state unreachable — a branch
 * that says 导出 only exists where the 导出 button exists.
 */
export function workUsageGuidance(
  contentPackage: PublicContentPackage,
  shape: WorkOutputShape,
  exportability: WorkPackageDetail['exportability']
): string[] {
  const lines: string[] = [];
  if (contentPackage.rights.state === 'revoked') {
    lines.push('这份内容里的素材授权已撤回，先换掉素材再导出。');
    return lines;
  }
  if (!currentVersion(contentPackage)) {
    // Nothing was delivered yet, so no action line would be true.
    lines.push('这份内容还在流程里，完成后会出现在这里。');
    return lines;
  }
  const canHandoff = Boolean(contentPackage.source.workId);
  switch (exportability) {
    case 'blocked':
      lines.push('这份内容得先换掉不能用的素材，之后才能接着用。');
      break;
    case 'needs_adoption':
      // 采用 is what unlocks export server-side, and the 采用 doorway is on
      // screen in exactly this branch.
      lines.push(
        canHandoff
          ? '成品已就绪，先采用这一版，之后就能导出或协办交接。'
          : '成品已就绪，先采用这一版，之后就能导出。'
      );
      break;
    case 'text_only':
      // There is no delivery package for this 作品 and no 采用 doorway either,
      // so the line names what the page actually offers: the words themselves.
      lines.push(
        canHandoff
          ? '这一版的文字已经能直接用，可以复制文字或协办交接。'
          : '这一版的文字已经能直接用，可以复制文字。'
      );
      break;
    case 'ready':
      lines.push(
        contentPackage.status === 'export_failed'
          ? '上次导出没成功，成品还在，重试导出即可。'
          : canHandoff
            ? '这一版已确认，可以直接导出或协办交接。'
            : '这一版已确认，可以直接导出。'
      );
      break;
  }
  switch (shape) {
    case 'copy':
      lines.push('复制正文就能贴到平台或发给顾客。');
      break;
    case 'image':
      lines.push(
        exportability === 'ready'
          ? '图片可以导出使用，也可以进轻编辑改字改版式。'
          : '图片可以进轻编辑改字改版式。'
      );
      break;
    case 'note':
      lines.push('图和文是一整份，导出时会一起带走。');
      break;
    case 'video':
      lines.push(
        exportability === 'ready'
          ? '成片可以导出使用，封面与字幕一并交付。'
          : '成片与封面、字幕会作为一整份内容交付。'
      );
      break;
  }
  return lines;
}

/**
 * Assets the 导出 would actually package, read the way core reads them: off the
 * platform variant's current version, not off the package.
 */
function exportVariantAssetCount(
  contentPackage: PublicContentPackage,
  platform: NonNullable<WorkPackageDetail['platform']>
): number {
  const variant = contentPackage.variants.find(
    (candidate) => candidate.platform === platform
  );
  const version = variant?.versions.find(
    (candidate) => candidate.id === variant.currentVersionId
  );
  return (version?.orderedAssetIds ?? []).length;
}

/**
 * Mirrors core's export preconditions. Kept as a projection rather than a
 * try-and-see so the surface can offer the honest next step (采用, or just
 * 复制文字) instead of a button that is going to fail.
 *
 * Two rules, both of them core's:
 *  - `assertContentPackageExportAllowed` — only an adopted 成品 exports.
 *  - the delivery package builders need the variant's ordered assets. 图文 is
 *    `buildImageTextDeliveryPackage`, which refuses a package with no image;
 *    video reads `orderedAssetIds[0]` for the composed file and fails the same
 *    way. Neither kind is exempt: core answers an empty variant by recording an
 *    export failure, which a merchant would otherwise meet as a dead 导出
 *    button.
 */
export function workExportability(
  contentPackage: PublicContentPackage
): WorkPackageDetail['exportability'] {
  if (
    contentPackage.rights.state === 'revoked' ||
    contentPackage.status === 'needs_replacement'
  ) {
    return 'blocked';
  }
  const platform = workDeliveryPlatform(contentPackage);
  if (!platform || exportVariantAssetCount(contentPackage, platform) === 0) {
    return 'text_only';
  }
  return contentPackage.status === 'accepted' ||
    contentPackage.status === 'export_failed'
    ? 'ready'
    : 'needs_adoption';
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
    excerpt: '在轻编辑里做的图文内容',
    kind: 'canvas',
    media: [],
    outputShape: 'image',
    revision:
      work.revisions.find((revision) => revision.id === work.currentRevisionId)
        ?.revision ?? null,
    statusLabel: '可继续编辑',
    // Canvas works carry engineering default names ("Blank visual post"); the
    // shared mapper is what turns them into what a merchant should read.
    title: canvasName(work.name),
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
  /** Canonical `creative_workbench`/`canonical_history` Works — 血缘 only. */
  creativeWorks?: readonly WorkLineageSource[];
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
  if (contentPackage) {
    const workId = contentPackage.source.workId;
    return packageDetail(
      contentPackage,
      workId
        ? (input.creativeWorks ?? []).find((work) => work.id === workId)
        : undefined
    );
  }
  if ((input.canvasWorks ?? []).some((work) => work.id === input.id)) {
    return { kind: 'canvas', workId: input.id };
  }
  return { kind: 'missing' };
}

function packageDetail(
  contentPackage: PublicContentPackage,
  work?: WorkLineageSource
): WorkPackageDetail {
  const version = currentVersion(contentPackage);
  const shape = workOutputShape(contentPackage);
  // One derivation, read by both the action row and the 使用导购 line.
  const exportability = workExportability(contentPackage);
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
    evidence: workEvidence(contentPackage, work),
    exportability,
    guidance: workUsageGuidance(contentPackage, shape, exportability),
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

export type WorkTextExport = {
  contentType: 'text/plain;charset=utf-8';
  fileName: string;
  text: string;
};

/**
 * Canonical plain-text export for a words-only ContentPackage.
 *
 * The file is derived only from the revision displayed on the page. It is not
 * a parallel sample artifact and it never falls back to a Composer draft.
 */
export function workTextExport(
  detail: WorkPackageDetail
): WorkTextExport | null {
  if (!detail.confirmedRevision) return null;
  const text = workCopyText(detail);
  if (!text) return null;
  const safeTitle =
    detail.title
      .trim()
      .replace(/[<>:"/\\|?*]/gu, '-')
      .replace(/\.+$/u, '') || '内容';
  return {
    contentType: 'text/plain;charset=utf-8',
    fileName: `${safeTitle}-r${detail.confirmedRevision.revision}.txt`,
    text,
  };
}

function resultCenterHref(
  detail: WorkPackageDetail,
  panel: 'delivery' | 'result'
): string | null {
  if (!detail.workId || !detail.confirmedRevision) return null;
  const search = new URLSearchParams({
    contentId: detail.confirmedRevision.packageId,
    panel,
    versionId: detail.confirmedRevision.versionId,
  });
  return `/dashboard/results/${encodeURIComponent(detail.workId)}?${search}`;
}

/**
 * 协办交接 doorway. ADR-0014 forbids a second submit truth, so handoff stays
 * one flow: the works surface opens the canonical delivery panel already bound
 * to the revision it was showing.
 */
export function workHandoffHref(detail: WorkPackageDetail): string | null {
  return resultCenterHref(detail, 'delivery');
}

/**
 * 采用 doorway, for a 作品 core will not export yet. Adoption is the Result
 * Center's canonical action (the same one the T31 交付卡 opens), so the works
 * surface points at it bound to this revision rather than growing its own.
 */
export function workAdoptHref(detail: WorkPackageDetail): string | null {
  return resultCenterHref(detail, 'result');
}

/**
 * Idempotency key for 导出 — one key per (package, revision, platform), in the
 * namespace Result Center already uses (`export:{id}:{rev}:{platform}`). Same
 * canonical command, same key: exporting the same revision from either surface
 * has to be one operation, not two that each spend a receipt.
 */
export function workExportIdempotencyKey(
  detail: WorkPackageDetail
): string | null {
  if (!detail.confirmedRevision || !detail.platform) return null;
  const { packageId, revision } = detail.confirmedRevision;
  return `export:${packageId}:${revision}:${detail.platform}`;
}

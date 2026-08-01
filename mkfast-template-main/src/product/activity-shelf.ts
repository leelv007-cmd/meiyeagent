/**
 * Activity Shelf projection — xhs-spec §2.4 / D6 / P1-3 (#318).
 *
 * Idle 「接着上次」upgrades from plain links to ≤3 object cards:
 * thumbnail · status · next action. Unfinished first; pure (no React).
 */

import type {
  CreativeAssetProjection,
  CreativeWork,
  CreativeWorkbenchProjection,
} from '@meiye/contracts';

/** P1-3: shelf never becomes a content list. */
export const ACTIVITY_SHELF_MAX_CARDS = 3;

const UNFINISHED_STATUSES: ReadonlySet<CreativeWork['status']> = new Set([
  'draft',
  'running',
]);

/** Failed is terminal for ordering but still unfinished for the merchant. */
const NEEDS_ATTENTION: ReadonlySet<CreativeWork['status']> = new Set([
  'draft',
  'running',
  'failed',
]);

export type ActivityShelfStatusKind =
  | 'draft'
  | 'running'
  | 'completed'
  | 'accepted'
  | 'failed';

export type ActivityShelfThumbKind = 'image' | 'video' | 'text' | 'unknown';

export type ActivityShelfThumb = {
  kind: ActivityShelfThumbKind;
  /** Present only when the workbench projects a reachable media object. */
  src?: string;
};

export type ActivityShelfCard = {
  workId: string;
  /** Merchant intent summary (truncated for the card face). */
  title: string;
  status: ActivityShelfStatusKind;
  /** Merchant-language status line (never internal enums alone). */
  statusLabel: string;
  /** Status-driven next-step label on the action entry. */
  nextActionLabel: string;
  thumb: ActivityShelfThumb;
  unfinished: boolean;
};

const STATUS_LABEL: Record<ActivityShelfStatusKind, string> = {
  draft: '草稿',
  running: '正在生成',
  completed: '已完成',
  accepted: '已采用',
  failed: '未完成',
};

const NEXT_ACTION_LABEL: Record<ActivityShelfStatusKind, string> = {
  draft: '继续编辑',
  running: '查看进度',
  completed: '继续调整',
  accepted: '继续调整',
  failed: '重新处理',
};

export function isUnfinished(work: CreativeWork) {
  return UNFINISHED_STATUSES.has(work.status);
}

/**
 * Unfinished first, then the rest in projection order. Capped so the section
 * stays a nudge rather than becoming the content list it links to.
 */
export function dashboardContinueItems(
  workbench: CreativeWorkbenchProjection | undefined
): CreativeWork[] {
  if (!workbench) return [];
  const unfinished = workbench.works.filter(isUnfinished);
  const rest = workbench.works.filter((work) => !isUnfinished(work));
  return [...unfinished, ...rest].slice(0, ACTIVITY_SHELF_MAX_CARDS);
}

export function activityShelfStatusKind(
  status: CreativeWork['status']
): ActivityShelfStatusKind {
  return status;
}

export function activityShelfStatusLabel(
  status: CreativeWork['status']
): string {
  return STATUS_LABEL[activityShelfStatusKind(status)];
}

export function activityShelfNextActionLabel(
  status: CreativeWork['status']
): string {
  return NEXT_ACTION_LABEL[activityShelfStatusKind(status)];
}

/**
 * Prefer an image asset for the card face; fall back to video, then text icon.
 * Object keys become the same `/api/core/p1/assets?objectKey=` path works use.
 */
export function activityShelfThumb(
  work: CreativeWork,
  assets: readonly CreativeAssetProjection[]
): ActivityShelfThumb {
  const owned = assets.filter((asset) => asset.workId === work.id);
  const image = owned.find(
    (asset) => asset.kind === 'image' && Boolean(asset.objectKey)
  );
  if (image?.objectKey) {
    return {
      kind: 'image',
      src: assetPreviewSrc(image.objectKey),
    };
  }
  const video = owned.find(
    (asset) => asset.kind === 'video' && Boolean(asset.objectKey)
  );
  if (video?.objectKey) {
    return {
      kind: 'video',
      src: assetPreviewSrc(video.objectKey),
    };
  }
  if (work.workingSelectionDraft?.coverAssetId) {
    const cover = assets.find(
      (asset) =>
        asset.id === work.workingSelectionDraft?.coverAssetId &&
        Boolean(asset.objectKey)
    );
    if (cover?.objectKey) {
      return {
        kind: cover.kind === 'video' ? 'video' : 'image',
        src: assetPreviewSrc(cover.objectKey),
      };
    }
  }
  if (owned.some((asset) => asset.kind === 'text')) {
    return { kind: 'text' };
  }
  return { kind: 'unknown' };
}

function assetPreviewSrc(objectKey: string) {
  return `/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`;
}

function truncateTitle(intent: string, limit = 28): string {
  const normalized = intent.replace(/\s+/gu, ' ').trim();
  if (!normalized) return '未命名创作';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}…`;
}

/**
 * Project ≤3 Activity Shelf cards. Unfinished first (same order as continue).
 */
export function projectActivityShelfCards(
  workbench: CreativeWorkbenchProjection | undefined
): ActivityShelfCard[] {
  const works = dashboardContinueItems(workbench);
  const assets = workbench?.assets ?? [];
  return works.map((work) => {
    const status = activityShelfStatusKind(work.status);
    return {
      workId: work.id,
      title: truncateTitle(work.intent),
      status,
      statusLabel: activityShelfStatusLabel(work.status),
      nextActionLabel: activityShelfNextActionLabel(work.status),
      thumb: activityShelfThumb(work, assets),
      unfinished: NEEDS_ATTENTION.has(work.status),
    };
  });
}

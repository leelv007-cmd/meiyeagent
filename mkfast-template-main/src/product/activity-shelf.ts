/**
 * Activity Shelf projection — xhs-spec §2.4 / D6 / P1-3 (#318).
 *
 * Idle 「接着上次」upgrades from plain links to ≤3 object cards:
 * thumbnail · status · next action. Needs-attention first; pure (no React).
 */

import type {
  CreativeAssetProjection,
  CreativeWork,
  CreativeWorkbenchProjection,
} from '@meiye/contracts';

import {
  activity_shelf_action_accepted,
  activity_shelf_action_completed,
  activity_shelf_action_draft,
  activity_shelf_action_failed,
  activity_shelf_action_running,
  activity_shelf_status_accepted,
  activity_shelf_status_completed,
  activity_shelf_status_draft,
  activity_shelf_status_failed,
  activity_shelf_status_running,
} from '@/locale/paraglide/messages';

/** P1-3: shelf never becomes a content list. */
export const ACTIVITY_SHELF_MAX_CARDS = 3;

/** Needs merchant attention: unfinished runs + failed (surface first). */
const NEEDS_ATTENTION: ReadonlySet<CreativeWork['status']> = new Set([
  'draft',
  'running',
  'failed',
]);

/** Legacy unfinished set (draft/running only) — keep for continue-item marker tests. */
const UNFINISHED_LEGACY: ReadonlySet<CreativeWork['status']> = new Set([
  'draft',
  'running',
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
  /** Full merchant intent — used for accessible names (e2e / a11y). */
  intent: string;
  /** Truncated intent for the card face. */
  title: string;
  status: ActivityShelfStatusKind;
  /** Merchant-language status line (never internal enums alone). */
  statusLabel: string;
  /** Status-driven next-step label on the action entry. */
  nextActionLabel: string;
  thumb: ActivityShelfThumb;
  /** draft/running/failed — needs merchant attention. */
  needsAttention: boolean;
  /** draft/running only — legacy continue-item-unfinished marker. */
  unfinished: boolean;
};

export function isUnfinished(work: CreativeWork) {
  return UNFINISHED_LEGACY.has(work.status);
}

export function needsAttention(work: CreativeWork) {
  return NEEDS_ATTENTION.has(work.status);
}

/**
 * Needs-attention first (draft/running/failed), then the rest in projection
 * order. Capped so the section stays a nudge rather than a content list.
 */
export function dashboardContinueItems(
  workbench: CreativeWorkbenchProjection | undefined
): CreativeWork[] {
  if (!workbench) return [];
  const attention = workbench.works.filter(needsAttention);
  const rest = workbench.works.filter((work) => !needsAttention(work));
  return [...attention, ...rest].slice(0, ACTIVITY_SHELF_MAX_CARDS);
}

export function activityShelfStatusKind(
  status: CreativeWork['status']
): ActivityShelfStatusKind {
  return status;
}

export function activityShelfStatusLabel(
  status: CreativeWork['status']
): string {
  switch (activityShelfStatusKind(status)) {
    case 'draft':
      return activity_shelf_status_draft();
    case 'running':
      return activity_shelf_status_running();
    case 'completed':
      return activity_shelf_status_completed();
    case 'accepted':
      return activity_shelf_status_accepted();
    case 'failed':
      return activity_shelf_status_failed();
  }
}

export function activityShelfNextActionLabel(
  status: CreativeWork['status']
): string {
  switch (activityShelfStatusKind(status)) {
    case 'draft':
      return activity_shelf_action_draft();
    case 'running':
      return activity_shelf_action_running();
    case 'completed':
      return activity_shelf_action_completed();
    case 'accepted':
      return activity_shelf_action_accepted();
    case 'failed':
      return activity_shelf_action_failed();
  }
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
 * Project ≤3 Activity Shelf cards. Needs-attention first.
 */
export function projectActivityShelfCards(
  workbench: CreativeWorkbenchProjection | undefined
): ActivityShelfCard[] {
  const works = dashboardContinueItems(workbench);
  const assets = workbench?.assets ?? [];
  return works.map((work) => {
    const status = activityShelfStatusKind(work.status);
    const intent = work.intent.replace(/\s+/gu, ' ').trim() || '未命名创作';
    return {
      workId: work.id,
      intent,
      title: truncateTitle(intent),
      status,
      statusLabel: activityShelfStatusLabel(work.status),
      nextActionLabel: activityShelfNextActionLabel(work.status),
      thumb: activityShelfThumb(work, assets),
      needsAttention: needsAttention(work),
      unfinished: isUnfinished(work),
    };
  });
}

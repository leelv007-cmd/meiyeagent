/**
 * Recent creation projection (D-097 / #94 / B4).
 *
 * Desktop max 6 / mobile max 4.
 * Sort by most recent effective activity.
 * Status-driven single next-action copy — never vague "查看详情".
 */

import {
  RECENT_DESKTOP_LIMIT,
  RECENT_MOBILE_LIMIT,
  type RecentActivitySource,
  type RecentNextActionLabel,
  type RecentProjectionItem,
  type RecentViewport,
  type ResultShellPhase,
  type ResultTarget,
} from '@meiye/contracts';

export { RECENT_DESKTOP_LIMIT, RECENT_MOBILE_LIMIT };

/** Map Result Shell phase → entry next-action label (D-090 / D-097). */
export function nextActionLabelForPhase(
  phase: ResultShellPhase | RecentActivitySource['phase'],
): RecentNextActionLabel {
  switch (phase) {
    case 'running':
      return '查看进度';
    case 'needs_input':
      return '处理当前问题';
    case 'ready':
      return '继续调整';
    case 'failed':
      return '处理当前问题';
    case 'delivered':
      return '查看结果';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/**
 * For ready phase with delivery panel preference, surface 继续交付.
 * Callers may set panel='delivery' on the activity source.
 */
export function nextActionLabelForRecent(
  source: RecentActivitySource,
): RecentNextActionLabel {
  if (source.phase === 'ready' && source.panel === 'delivery') {
    return '继续交付';
  }
  if (source.phase === 'ready' && source.panel === 'result') {
    return '查看结果';
  }
  return nextActionLabelForPhase(source.phase);
}

function targetFrom(source: RecentActivitySource): ResultTarget {
  return {
    workId: source.workId,
    ...(source.contentId ? { contentId: source.contentId } : {}),
    ...(source.versionId ? { versionId: source.versionId } : {}),
    ...(source.panel ? { panel: source.panel } : {}),
    ...(source.focusKey ? { focusKey: source.focusKey } : {}),
  };
}

export function recentLimitForViewport(viewport: RecentViewport): number {
  return viewport === 'desktop' ? RECENT_DESKTOP_LIMIT : RECENT_MOBILE_LIMIT;
}

/**
 * Pure Recent projection: sort by effective activity desc, cap by viewport.
 * Does not invent workIds or fall back to "latest work".
 */
export function projectRecent(
  sources: readonly RecentActivitySource[],
  viewport: RecentViewport,
): RecentProjectionItem[] {
  const limit = recentLimitForViewport(viewport);
  const sorted = [...sources].sort(compareRecentActivity);
  const capped = sorted.slice(0, limit);

  return capped.map((source) => ({
    workId: source.workId,
    workspaceId: source.workspaceId,
    title: source.title,
    medium: source.medium,
    phase: source.phase,
    nextActionLabel: nextActionLabelForRecent(source),
    effectiveActivityAt: source.effectiveActivityAt,
    target: targetFrom(source),
  }));
}

export function compareRecentActivity(
  left: RecentActivitySource,
  right: RecentActivitySource,
): number {
  // Newest effective activity first.
  return (
    right.effectiveActivityAt.localeCompare(left.effectiveActivityAt) ||
    left.workId.localeCompare(right.workId)
  );
}

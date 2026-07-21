/**
 * Four delivery outcome announcements + focus targets (D-086 / #101).
 *
 * Must distinguish: 下载完成 / 分享完成 / 已交接 / 已发布.
 * Never collapse into a vague "完成".
 */

export const DELIVERY_OUTCOMES = [
  'download_done',
  'share_done',
  'handed_over',
  'published',
] as const;

export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/** Exact user-facing phrases — do not share a generic "完成". */
export const DELIVERY_OUTCOME_ANNOUNCEMENT: Record<DeliveryOutcome, string> = {
  download_done: '下载已开始',
  share_done: '已交给系统分享',
  handed_over: '已交接',
  published: '已发布',
};

/** Stable focus / live-region targets for keyboard and screen readers. */
export const DELIVERY_OUTCOME_FOCUS_ID: Record<DeliveryOutcome, string> = {
  download_done: 'delivery-outcome-download',
  share_done: 'delivery-outcome-share',
  handed_over: 'delivery-outcome-handed-over',
  published: 'delivery-outcome-published',
};

export const DELIVERY_OUTCOME_TESTID: Record<DeliveryOutcome, string> = {
  download_done: 'delivery-outcome-download-done',
  share_done: 'delivery-outcome-share-done',
  handed_over: 'delivery-outcome-handed-over',
  published: 'delivery-outcome-published',
};

export type DeliveryOutcomeProjection = {
  outcome: DeliveryOutcome;
  /** Polite live-region announcement. */
  announcement: string;
  /** Element id to move focus to after the action. */
  focusId: string;
  /** data-testid for unit / e2e asserts. */
  testId: string;
  /** aria-live politeness. */
  ariaLive: 'polite';
  /** role for the status node. */
  role: 'status';
  /**
   * Semantic flag: only `published` may claim platform publish success.
   * download/share/handed_over must remain false.
   */
  platformPublished: boolean;
};

/**
 * Project a single outcome for a11y + focus management.
 */
export function projectDeliveryOutcome(
  outcome: DeliveryOutcome
): DeliveryOutcomeProjection {
  return {
    outcome,
    announcement: DELIVERY_OUTCOME_ANNOUNCEMENT[outcome],
    focusId: DELIVERY_OUTCOME_FOCUS_ID[outcome],
    testId: DELIVERY_OUTCOME_TESTID[outcome],
    ariaLive: 'polite',
    role: 'status',
    platformPublished: outcome === 'published',
  };
}

/**
 * All four outcomes with distinct announcements and focus ids.
 * Used by acceptance tests to prove keyboard/screen-reader separation.
 */
export function allDeliveryOutcomeProjections(): DeliveryOutcomeProjection[] {
  return DELIVERY_OUTCOMES.map(projectDeliveryOutcome);
}

/**
 * Assert the four announcements are pairwise distinct (acceptance helper).
 */
export function assertDistinctOutcomeAnnouncements(
  projections: readonly DeliveryOutcomeProjection[] = allDeliveryOutcomeProjections()
): boolean {
  const texts = projections.map((p) => p.announcement);
  const focusIds = projections.map((p) => p.focusId);
  const testIds = projections.map((p) => p.testId);
  return (
    new Set(texts).size === texts.length &&
    new Set(focusIds).size === focusIds.length &&
    new Set(testIds).size === testIds.length
  );
}

/**
 * Map low-level action events onto the four outcome kinds.
 * Share cancel is intentionally absent — no outcome / no delivered mark.
 */
export function outcomeFromDeliveryEvent(
  event:
    | 'download_started'
    | 'shared'
    | 'share_cancelled'
    | 'handed_over'
    | 'published'
): DeliveryOutcome | null {
  switch (event) {
    case 'download_started':
      return 'download_done';
    case 'shared':
      return 'share_done';
    case 'share_cancelled':
      return null;
    case 'handed_over':
      return 'handed_over';
    case 'published':
      return 'published';
  }
}

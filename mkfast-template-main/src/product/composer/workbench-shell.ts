/**
 * P1-01 workbench shell layout contract (#313 / xhs-vertical-integration §2.5 / §8.2).
 *
 * Width contract, dual-column eligibility, and Composer sticky morph are pure
 * layout decisions. Hosts own the DOM; this module owns the numbers and gates.
 *
 * Spec authority: docs/specs/xhs-vertical-integration-spec-2026-08-01.md
 *  - D3: dual column + Composer sticky morph → P1
 *  - D8 / §2.5: conversation 800, media expand 1240
 *  - P1-1 / P1-2 / P1-7 acceptance gates
 */

import type { ComposerSessionPhase } from './composer-session';

/** Pure conversation column (Idle / non-media). */
export const WORKBENCH_CONVERSATION_MAX_WIDTH_PX = 800;

/** Media expand / dual-column outer shell. */
export const WORKBENCH_MEDIA_EXPAND_MAX_WIDTH_PX = 1240;

/**
 * Desktop dual-column (event stream | Inspector) only when the viewport is at
 * least this wide — P1-1.
 */
export const WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX =
  WORKBENCH_MEDIA_EXPAND_MAX_WIDTH_PX;

/**
 * Mobile bottom nav height (mobile-nav.tsx h-[4.25rem]). Sticky Composer and
 * fixed action bars must clear this plus safe-area; product shell already uses
 * 5.25rem (= 4.25 + 1rem breathing) for page padding — sticky Composer matches.
 */
export const WORKBENCH_MOBILE_NAV_HEIGHT = '4.25rem';

/** Clearance used by sticky Composer / fixed bars (nav + margin). */
export const WORKBENCH_MOBILE_NAV_CLEARANCE =
  'calc(5.25rem + env(safe-area-inset-bottom))';

/** Tailwind class contract for sticky Active Composer bottom offset. */
export const WORKBENCH_COMPOSER_STICKY_BOTTOM_CLASS =
  'bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-4';

/**
 * Spacer height above the sticky Composer host so timeline / delivery cards can
 * scroll clear of the stuck scrim. Without this, Active sticky (z-30) covers
 * the last delivery card and intercepts pointer events (CI journey 2026-08-01).
 * Sized for prompt bar + attachment strip + mobile-nav clearance breathing room.
 */
export const WORKBENCH_STICKY_COMPOSER_CLEARANCE_CLASS =
  'h-[calc(16rem+env(safe-area-inset-bottom))] shrink-0 md:h-64';

/**
 * scroll-margin on delivery / timeline blocks so browser scrollIntoView and
 * Playwright leave the target above the sticky Composer overlay.
 */
export const WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS =
  'scroll-mb-[calc(16rem+env(safe-area-inset-bottom))] md:scroll-mb-64';

const DUAL_COLUMN_PHASES: ReadonlySet<ComposerSessionPhase> = new Set([
  'submitting',
  'running',
  'awaiting_answer',
  'delivered',
]);

/**
 * Sticky only while the run is in flight and not waiting on the merchant.
 * `awaiting_answer` is intentionally non-sticky: interrupt options must receive
 * real pointer events instead of sitting below the Composer scrim.
 * `delivered` is intentionally non-sticky: 成品交付卡 must stay fully clickable
 * above the prompt cluster. CI journey @cbcbe4da/d39804f0 showed sticky z-30
 * covering the card even with clearance spacers (host is prompt+attachments tall).
 */
const STICKY_COMPOSER_PHASES: ReadonlySet<ComposerSessionPhase> = new Set([
  'submitting',
  'running',
]);

/**
 * True when Active/Delivered desktop shell may mount event stream | Inspector
 * (react-resizable-panels). Home never does a draggable three-column layout.
 */
export function isWorkbenchDualColumnEligible(
  phase: ComposerSessionPhase,
  viewportWidthPx: number
): boolean {
  return (
    DUAL_COLUMN_PHASES.has(phase) &&
    viewportWidthPx >= WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX
  );
}

/**
 * In-flight morph Composer to sticky bottom — P1-2.
 * Delivered is dual-column but non-sticky so 成品交付卡 stays clickable.
 */
export function isWorkbenchComposerSticky(
  phase: ComposerSessionPhase
): boolean {
  return STICKY_COMPOSER_PHASES.has(phase);
}

export type WorkbenchWidthMode = 'conversation' | 'media';

/**
 * Outer shell max width. Pure conversation stays ~800; media expand / dual
 * column open to ~1240 (P1-7). Replaces the historical max-w-3xl clamp.
 */
export function workbenchShellMaxWidthPx(mode: WorkbenchWidthMode): number {
  return mode === 'media'
    ? WORKBENCH_MEDIA_EXPAND_MAX_WIDTH_PX
    : WORKBENCH_CONVERSATION_MAX_WIDTH_PX;
}

/**
 * Resolve shell width mode.
 *
 * P1-01 product rule: media width (1240) ≡ dual-column shell open. The optional
 * `mediaExpanded` flag is reserved for a later object-workspace expand that is
 * not yet a home signal — callers that only pass `{ dualColumn }` are correct.
 */
export function resolveWorkbenchWidthMode(input: {
  dualColumn: boolean;
  /**
   * Reserved for a future object-workspace media expand that is independent of
   * dual-column. P1-01 home does not pass this; dual-column alone owns 1240.
   */
  mediaExpanded?: boolean;
}): WorkbenchWidthMode {
  if (input.dualColumn || input.mediaExpanded) return 'media';
  return 'conversation';
}

/** Tailwind max-width class for the outer workbench shell. */
export function workbenchShellMaxWidthClass(mode: WorkbenchWidthMode): string {
  return mode === 'media' ? 'max-w-[1240px]' : 'max-w-[800px]';
}

/**
 * Sticky Composer host classes when Active. z-index sits above transcript
 * content but below mobile-nav (z-50) and dialogs. Opaque/blur backdrop so
 * scrolling timeline text does not bleed through the send control (matches
 * Result Center sticky action bar).
 */
export function workbenchComposerStickyHostClass(
  sticky: boolean
): string | undefined {
  if (!sticky) return undefined;
  return [
    'sticky z-30',
    WORKBENCH_COMPOSER_STICKY_BOTTOM_CLASS,
    // Keep the send control clear of the floating mobile nav (P1-2).
    'pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-0',
    // Scrim while stuck — Idle non-sticky path never applies this host class.
    'border-t border-border/60 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80',
    // Horizontal bleed so the scrim covers the shell padding while stuck.
    '-mx-4 px-4 sm:-mx-6 sm:px-6',
  ].join(' ');
}

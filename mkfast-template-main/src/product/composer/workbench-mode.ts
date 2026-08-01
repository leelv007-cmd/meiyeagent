/**
 * P0 workbench mode helpers (#286 / xhs-vertical-integration §2.2 / §8.1).
 *
 * Idle keeps the recommendation shelf and 「继续上次工作」visible.
 * Active (and Delivered) collapses them so the transcript owns vertical space.
 */

import type { ComposerSessionPhase } from './composer-session';

/** Phases where 段① 提议 + 段③ 继续 must not dominate the first screen. */
const SHELF_COLLAPSED_PHASES: ReadonlySet<ComposerSessionPhase> = new Set([
  'submitting',
  'running',
  'awaiting_answer',
  'delivered',
]);

/**
 * True when the Dashboard shelf (today recommendation + continue section)
 * should collapse / hide after the merchant enters an Active (or Delivered) run.
 */
export function isWorkbenchShelfCollapsed(
  phase: ComposerSessionPhase
): boolean {
  return SHELF_COLLAPSED_PHASES.has(phase);
}

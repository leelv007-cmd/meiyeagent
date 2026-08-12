/**
 * 工作台四态 (D-171): Idle / Active / Waiting / Delivered, named once.
 *
 * Until 2026-08-12 the four states were never a type — four modules each
 * re-partitioned the seven-value ComposerSessionPhase into private
 * ReadonlySets (two of them byte-identical), and the desktop right rail
 * invented a third vocabulary that composer-home mapped into inline. Layout,
 * shelf, sticky and inspector modules now ask this module a question instead
 * of restating the partition.
 */

import type { ComposerSessionPhase } from './composer-session';

export type WorkbenchState = 'idle' | 'active' | 'waiting' | 'delivered';

export function workbenchStateOf(phase: ComposerSessionPhase): WorkbenchState {
  switch (phase) {
    case 'awaiting_answer':
      return 'waiting';
    case 'delivered':
      return 'delivered';
    case 'submitting':
    case 'running':
      return 'active';
    default:
      // idle | cancelled | failed — the workbench is back in a startable state.
      return 'idle';
  }
}

/**
 * Active or Waiting: a run is in flight (possibly waiting on the merchant).
 * Shared by the sticky Composer (P1-2) and the collapsed Dashboard shelf
 * (#286 §2.2/§8.1) — previously two identical, independently declared sets.
 */
export function isWorkbenchEngaged(phase: ComposerSessionPhase): boolean {
  const state = workbenchStateOf(phase);
  return state === 'active' || state === 'waiting';
}

/** Any non-Idle state: Active, Waiting or Delivered. */
export function isWorkbenchRunVisible(phase: ComposerSessionPhase): boolean {
  return workbenchStateOf(phase) !== 'idle';
}

/**
 * The right-rail Inspector's three-value view of the four states.
 * Waiting is folded into 'running' here — a status-quo display decision
 * (the rail shows a progress panel with an "等待你的确认" label rather than a
 * distinct Waiting panel). Surfacing Waiting as its own inspector phase is a
 * product decision; this projection is its single home either way.
 */
export function workbenchInspectorPhaseOf(
  phase: ComposerSessionPhase
): 'idle' | 'running' | 'delivered' {
  const state = workbenchStateOf(phase);
  if (state === 'delivered') return 'delivered';
  if (state === 'active' || state === 'waiting') return 'running';
  return 'idle';
}

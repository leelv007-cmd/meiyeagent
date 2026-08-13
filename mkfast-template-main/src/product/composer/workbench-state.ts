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

export type WorkbenchState =
  | 'idle'
  | 'active'
  | 'waiting'
  | 'delivered'
  | 'failed';

export function workbenchStateOf(phase: ComposerSessionPhase): WorkbenchState {
  switch (phase) {
    case 'awaiting_answer':
      return 'waiting';
    case 'delivered':
      return 'delivered';
    case 'failed':
      return 'failed';
    case 'submitting':
    case 'running':
      return 'active';
    default:
      // idle | cancelled — the workbench is back in a startable state.
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
 * The right-rail Inspector's view of the workbench states.
 * Waiting is folded into 'running' here — a status-quo display decision
 * (the rail shows a progress panel with an "等待你的确认" label rather than a
 * distinct Waiting panel). Failed is a named terminal face so a rejected
 * submit cannot stay on 「正在提交」.
 */
export function workbenchInspectorPhaseOf(
  phase: ComposerSessionPhase
): 'idle' | 'running' | 'delivered' | 'failed' {
  const state = workbenchStateOf(phase);
  if (state === 'delivered') return 'delivered';
  if (state === 'failed') return 'failed';
  if (state === 'active' || state === 'waiting') return 'running';
  return 'idle';
}

/**
 * Deterministic recipe-slot refusals are a guidance card, not a retryable
 * run failure. The inspector must not say 「改一改再发就好」.
 */
export function workbenchInspectorPhaseForComposer(
  phase: ComposerSessionPhase,
  sourceSlotGuidance: boolean
): 'idle' | 'running' | 'delivered' | 'failed' {
  if (sourceSlotGuidance) return 'idle';
  return workbenchInspectorPhaseOf(phase);
}

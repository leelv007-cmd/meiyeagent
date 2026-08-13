/**
 * V31-82: semantic stream vs canonical work status.
 *
 * A first-version delivery card can appear while `p1_creative_works` is still
 * running. The inspector must follow the work, not the premature semantic
 * card, and callers record the correction.
 */

import type { ComposerSessionPhase } from './composer-session';
import { workbenchInspectorPhaseOf } from './workbench-state';

export type CanonicalWorkStatus =
  | 'running'
  | 'failed'
  | 'completed'
  | 'cancelled'
  | null;

export type CanonicalCorrection = {
  kind: 'semantic_delivery_without_terminal_work';
};

export function reconcileComposerCanonicalState(input: {
  workStatus: CanonicalWorkStatus;
  semanticDelivered: boolean;
  sessionPhase: ComposerSessionPhase;
}): {
  inspectorPhase: 'idle' | 'running' | 'delivered' | 'failed';
  sessionPhase: ComposerSessionPhase;
  correction: CanonicalCorrection | null;
} {
  if (input.workStatus === 'failed') {
    return {
      inspectorPhase: 'failed',
      sessionPhase: 'failed',
      correction:
        input.semanticDelivered || input.sessionPhase === 'delivered'
          ? { kind: 'semantic_delivery_without_terminal_work' }
          : null,
    };
  }
  if (input.workStatus === 'cancelled') {
    return {
      inspectorPhase: 'idle',
      sessionPhase: 'cancelled',
      correction: null,
    };
  }
  if (input.workStatus === 'completed') {
    return {
      inspectorPhase: 'delivered',
      sessionPhase: 'delivered',
      correction: null,
    };
  }
  if (input.workStatus === 'running' && input.semanticDelivered) {
    return {
      inspectorPhase: 'running',
      sessionPhase:
        input.sessionPhase === 'delivered' ? 'running' : input.sessionPhase,
      correction: { kind: 'semantic_delivery_without_terminal_work' },
    };
  }
  return {
    inspectorPhase: workbenchInspectorPhaseOf(input.sessionPhase),
    sessionPhase: input.sessionPhase,
    correction: null,
  };
}

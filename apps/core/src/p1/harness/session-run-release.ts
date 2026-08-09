/**
 * Session run → HarnessRelease resolution (V31-21 / U10).
 *
 * A run resolves its exact immutable pin and nothing else. There is deliberately
 * no fallback to the current production release: an unknown pin fails closed so
 * a rollback can never silently retarget a run that is already in flight.
 */

import type {
  AgentControlLimits,
  HarnessMiddlewareBinding,
} from '@meiye/contracts';

import { assertIntentRetrievalBindingsPinned } from '../agent-session/intent-retrieval-policies.js';
import { controlLimitsFromArtifact } from '../agent-session/turn-runner.js';
import type { HarnessReleaseService } from './harness-release.js';

export type SessionRunReleaseResolution = {
  controlLimits: AgentControlLimits;
  middlewareBindings: HarnessMiddlewareBinding[];
  releaseId: string;
};

export async function resolveSessionRunRelease(input: {
  service: HarnessReleaseService;
  /** Frozen pin carried by the run; absent means "resolve current rollout". */
  harnessReleaseId?: string | null;
}): Promise<SessionRunReleaseResolution> {
  const resolved = await input.service.resolveForRun(
    input.harnessReleaseId ? { frozenReleaseId: input.harnessReleaseId } : {},
  );
  const base = controlLimitsFromArtifact(resolved.artifact);
  const middlewareBindings = [...(base.middlewareBindings ?? [])];
  // The manifest is the only source of pins. Filling gaps here made an
  // incomplete release indistinguishable from a complete one.
  assertIntentRetrievalBindingsPinned({
    releaseId: resolved.releaseId,
    bindings: middlewareBindings,
  });
  return {
    controlLimits: resolved.controlLimits,
    middlewareBindings,
    releaseId: resolved.releaseId,
  };
}

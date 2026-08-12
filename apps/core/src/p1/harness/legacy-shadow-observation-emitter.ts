/**
 * Legacy-chain shadow observation emitter (V31-13 / P1-G).
 *
 * The shadow program compares what the OLD chain derives from the merchant's
 * CreationExecutionSnapshot against what the NEW chain froze into the
 * ExecutionPlanSnapshot. Those are independent sources, so the comparison is
 * meaningful — but it only happens if the old-chain projection is recorded.
 *
 * The projection is embedded into the context_injection stage trace by the
 * workflow prelude on every run; the reconciliation sampler reads it back from
 * there (legacy-shadow-observation-reader). The frozen legacy runner that once
 * also persisted it directly was retired 2026-08-12 (V31-26b user decision).
 */

import type { HarnessStageExecutionInput } from './workflow-core.js';
import type { ShadowDeterministicFields } from './shadow-reconciliation.js';
import { projectLegacyDeterministicFields } from './shadow-reconciliation.js';

/**
 * Project the old chain's deterministic fields from the creation snapshot.
 * Returns null when the run carries no creation snapshot or no bounds, which is
 * the shape the shadow program cannot compare.
 */
export function projectLegacyShadowObservation(input: {
  request: HarnessStageExecutionInput['request'];
  factRefs: readonly string[];
  context: HarnessStageExecutionInput['prelude']['context'];
}): ShadowDeterministicFields | null {
  const snapshot = input.request.executionSnapshot;
  const bounds =
    input.request.boundedExecution ??
    input.request.executionPlanSnapshot?.boundedExecution;
  if (!snapshot || !bounds) return null;
  return projectLegacyDeterministicFields({
    deliverables: snapshot.deliverables.map((deliverable) => ({
      kind:
        deliverable.kind === 'copy'
          ? 'copy'
          : deliverable.kind === 'image_text_note'
            ? 'note'
            : 'media',
      quantity: deliverable.quantity,
    })),
    factRefs: [...input.factRefs],
    rightsRefs:
      input.context.policyReferences?.rightsRefs?.map(
        (right) => `${right.assetId}:${right.status}`,
      ) ?? [],
    quoteRef: snapshot.quote,
    bounds: {
      maxIterations: bounds.maxIterations,
      maxCostCents: bounds.maxCostCents,
      maxWallClockMs: bounds.maxWallClockMs,
      maxDelegations: bounds.maxDelegations,
    },
  });
}

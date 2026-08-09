/**
 * Legacy-chain shadow observation emitter (V31-13 / P1-G).
 *
 * The shadow program compares what the OLD chain derives from the merchant's
 * CreationExecutionSnapshot against what the NEW chain froze into the
 * ExecutionPlanSnapshot. Those are independent sources, so the comparison is
 * meaningful — but it only happens if the old-chain projection is recorded.
 *
 * It used to be recorded only from inside the frozen legacy runner, which runs
 * only when the `forceLegacyFiveStage` kill switch is on. With the kill switch
 * off — that is, in normal production — nothing was ever sampled, so the
 * reconciliation program could never accumulate observations and never close.
 *
 * The projection therefore lives here and is emitted by both paths from the same
 * inputs. Keeping it out of the frozen module also removes one of the frozen
 * module's live-code dependencies.
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

/**
 * Record the old-chain projection for this run. The port is optional (fixture
 * runs omit it) and the write is idempotent on workflowId at the persistence
 * layer, so calling it once per run on either path is safe.
 */
export async function persistLegacyShadowObservation(input: {
  runtime: HarnessStageExecutionInput['runtime'];
  request: HarnessStageExecutionInput['request'];
  workflowId: string;
  factRefs: readonly string[];
  context: HarnessStageExecutionInput['prelude']['context'];
}): Promise<void> {
  if (!input.runtime.recordLegacyShadowObservation) return;
  const observation = projectLegacyShadowObservation(input);
  if (!observation) return;
  await input.runtime.recordLegacyShadowObservation({
    observation,
    workflowId: input.workflowId,
    workspaceId: input.request.workspaceId,
  });
}

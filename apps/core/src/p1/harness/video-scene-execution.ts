/**
 * V31-36 — video scene-level execution result + partial-settlement basis.
 *
 * Settlement adjudication (aligns 2026-08-09 mid-run instruction billing):
 * - `delivered` → billable
 * - `failed_called_unusable` → billable (upstream already called; no refund)
 * - `failed_not_called` → not billable (eligible for failureRefundsCredits refund)
 *
 * `partialDelivery.deliveredUnits` = billable scene count (not "usable only").
 * Merchant report names every non-delivered scene separately.
 */

/** Fixture intent anchors — deterministic, never probabilistic. */
export const VIDEO_PARTIAL_FAILURE_NOT_CALLED_ANCHOR = '视频部分失败样本';
export const VIDEO_PARTIAL_FAILURE_CALLED_UNUSABLE_ANCHOR =
  '视频镜头已调用不可用样本';

export type VideoSceneExecutionOutcome =
  | 'delivered'
  | 'failed_not_called'
  | 'failed_called_unusable';

export type VideoSceneExecutionResult = {
  /** 0-based, matches artifact sceneIndex. */
  sceneIndex: number;
  outcome: VideoSceneExecutionOutcome;
};

export type VideoPartialFailureFixtureKind =
  | 'not_called'
  | 'called_unusable';

export function videoPartialFailureFixtureKind(
  text: string | undefined | null,
): VideoPartialFailureFixtureKind | null {
  if (!text) return null;
  if (text.includes(VIDEO_PARTIAL_FAILURE_CALLED_UNUSABLE_ANCHOR)) {
    return 'called_unusable';
  }
  if (text.includes(VIDEO_PARTIAL_FAILURE_NOT_CALLED_ANCHOR)) {
    return 'not_called';
  }
  return null;
}

/**
 * Resolve per-scene outcomes for a video selection.
 *
 * Fixture partial failure: when `fixtureKind` is set and sceneCount ≥ 2, the
 * last planned scene fails with that kind and earlier scenes deliver. Scene
 * regeneration scopes results to `targetSceneIndexes` only for billing identity;
 * non-target scenes stay `delivered` so the partial receipt is not rewritten.
 */
export function resolveVideoSceneResults(input: {
  sceneCount: number;
  generationCalled: boolean;
  generationSucceeded: boolean;
  fixtureKind?: VideoPartialFailureFixtureKind | null;
  targetSceneIndexes?: readonly number[];
}): VideoSceneExecutionResult[] {
  const sceneCount = Math.max(0, Math.floor(input.sceneCount));
  if (sceneCount === 0) return [];

  const allIndexes = Array.from({ length: sceneCount }, (_, index) => index);
  const targets = input.targetSceneIndexes?.length
    ? [...new Set(input.targetSceneIndexes)].filter(
        (index) => index >= 0 && index < sceneCount,
      )
    : null;

  if (!input.generationSucceeded) {
    const outcome: VideoSceneExecutionOutcome = input.generationCalled
      ? 'failed_called_unusable'
      : 'failed_not_called';
    return allIndexes.map((sceneIndex) => ({ sceneIndex, outcome }));
  }

  const fixtureKind = input.fixtureKind ?? null;
  if (fixtureKind && sceneCount >= 2) {
    const failIndex =
      targets && targets.length > 0
        ? Math.max(...targets)
        : sceneCount - 1;
    return allIndexes.map((sceneIndex) => {
      if (targets && !targets.includes(sceneIndex)) {
        return { sceneIndex, outcome: 'delivered' as const };
      }
      if (sceneIndex === failIndex) {
        return {
          sceneIndex,
          outcome:
            fixtureKind === 'called_unusable'
              ? ('failed_called_unusable' as const)
              : ('failed_not_called' as const),
        };
      }
      return { sceneIndex, outcome: 'delivered' as const };
    });
  }

  return allIndexes.map((sceneIndex) => ({
    sceneIndex,
    outcome: 'delivered' as const,
  }));
}

/** Units that stay charged (delivered + already-called failures). */
export function videoSceneBillableUnits(
  results: readonly VideoSceneExecutionResult[],
): number {
  return results.filter(
    (result) =>
      result.outcome === 'delivered' ||
      result.outcome === 'failed_called_unusable',
  ).length;
}

/** Usable scenes the merchant can publish. */
export function videoSceneDeliveredUsable(
  results: readonly VideoSceneExecutionResult[],
): number {
  return results.filter((result) => result.outcome === 'delivered').length;
}

/** 0-based indexes of scenes that did not land usable. */
export function videoUnresolvedSceneIndexes(
  results: readonly VideoSceneExecutionResult[],
): number[] {
  return results
    .filter((result) => result.outcome !== 'delivered')
    .map((result) => result.sceneIndex);
}

/** 1-based merchant labels for failed scenes (「第 2 个镜头」). */
export function videoFailedSceneLabels(
  results: readonly VideoSceneExecutionResult[],
): string[] {
  return videoUnresolvedSceneIndexes(results).map(
    (sceneIndex) => String(sceneIndex + 1),
  );
}

/**
 * Effect-key suffix so a single-scene retry does not reuse the full-video
 * selection key (no full double debit via effect replay).
 */
export function sceneRegenerationEffectSuffix(
  targetSceneIndexes: readonly number[] | undefined,
): string {
  if (!targetSceneIndexes?.length) return '';
  const sorted = [...new Set(targetSceneIndexes)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return '';
  return `-scene-retry:${sorted.join(',')}`;
}

import type { CreativeWorkbenchProjection } from '@meiye/contracts';

import {
  projectResultCenterLiveProjection,
  type ResultCenterLiveSelection,
} from '@/product/results/result-live-projection';

export type MobileProgressTarget =
  | { kind: 'loading' }
  | { kind: 'result'; workId: string }
  | { kind: 'task-center' };

const inFlightProgressStates = new Set(['waiting', 'running', 'suspended']);

/**
 * The mobile progress tab consumes the same canonical Result projection as the
 * exact Result route. It deliberately does not merge history, fixtures, or a
 * modality-specific task list into a second truth source.
 */
export function mobileProgressTarget(
  projection: CreativeWorkbenchProjection | undefined
): MobileProgressTarget {
  if (!projection) return { kind: 'loading' };

  const current = projection.works
    .map(
      (work) => projectResultCenterLiveProjection(projection, work.id).selected
    )
    .filter(
      (selection): selection is ResultCenterLiveSelection =>
        selection !== null &&
        inFlightProgressStates.has(selection.progressState)
    )
    .sort((left, right) => {
      const leftUpdatedAt = left.job?.updatedAt ?? left.work.updatedAt;
      const rightUpdatedAt = right.job?.updatedAt ?? right.work.updatedAt;
      return rightUpdatedAt.localeCompare(leftUpdatedAt);
    })[0];

  return current
    ? { kind: 'result', workId: current.work.id }
    : { kind: 'task-center' };
}

/**
 * Make dual-queue unit-boundary hook + future_step_patch runtime apply (V31-16).
 *
 * Hang points:
 * - per-unit completion (note page success) → drain `steer`
 * - all units terminal (last page / workflow terminal success) → drain `follow_up`
 * - next unit generation input → overlay accepted future_step_patch instructions
 *   (V3.1 §5.6 / §23.3: modify not-yet-executed steps; command binds snapshot
 *   hash but does NOT rewrite the frozen ExecutionPlanSnapshot body)
 *
 * Flag off / kill switch on → zero service calls, zero workflow behavior change.
 */

import type {
  MakeSteeringGate,
  MakeUnitCursor,
  SteeringQueueDrainResult,
  SteeringService,
} from '../agent-session/steering-service.js';

export type MakeSteeringBoundaryInput = {
  workspaceId: string;
  taskId: string;
  cursor: MakeUnitCursor;
};

export type FutureStepPatchOverlay = {
  commandId: string;
  instruction: string;
  affectedUnitIds: string[];
};

export type MakeSteeringBoundaryPort = {
  onUnitBoundary(
    input: MakeSteeringBoundaryInput,
  ): Promise<SteeringQueueDrainResult | undefined>;
  /**
   * Accepted future_step_patch overlays for a unit (runtime only).
   * Empty when gate off or no accepted patches for unitId.
   */
  resolveFutureStepPatches(input: {
    workspaceId: string;
    taskId: string;
    unitId: string;
  }): Promise<readonly FutureStepPatchOverlay[]>;
};

/**
 * Production adapter: gate hot-read first; disabled ⇒ no store / service work.
 */
export function createMakeSteeringBoundaryPort(input: {
  service: Pick<SteeringService, 'onUnitBoundary'> &
    Partial<Pick<SteeringService, 'listAcceptedFutureStepPatches'>>;
  resolveGate: () => MakeSteeringGate | Promise<MakeSteeringGate>;
}): MakeSteeringBoundaryPort {
  return {
    async onUnitBoundary(args) {
      const gate = await input.resolveGate();
      if (!gate.enabled) {
        return undefined;
      }
      return input.service.onUnitBoundary(args);
    },
    async resolveFutureStepPatches(args) {
      const gate = await input.resolveGate();
      if (!gate.enabled) {
        return [];
      }
      if (!input.service.listAcceptedFutureStepPatches) {
        return [];
      }
      return input.service.listAcceptedFutureStepPatches(args);
    },
  };
}

/**
 * Apply accepted future_step_patch instructions onto a note page for generation.
 *
 * Pure runtime overlay: returns a new page object. Does not mutate the frozen
 * plan/snapshot source. Unaffected pages must not call this (or pass empty patches).
 *
 * Authority: V3.1 §5.6 `future_step_patch` = 修改尚未执行步骤；§23.3 command binds
 * source snapshot/revision without rewriting Provider-accepted side effects.
 */
export function applyFutureStepPatchesToNotePage<
  TPage extends {
    id: string;
    textBlock: { title: string; body: string; exactText?: readonly string[] };
    imageIntent: { purpose: string };
  },
>(
  page: TPage,
  patches: readonly Pick<FutureStepPatchOverlay, 'instruction'>[],
): TPage {
  if (patches.length === 0) return page;
  const joined = patches
    .map((patch) => patch.instruction.trim())
    .filter((text) => text.length > 0)
    .join('；');
  if (!joined) return page;
  return {
    ...page,
    textBlock: {
      ...page.textBlock,
      body: `${page.textBlock.body}\n\n【中途修正】${joined}`,
    },
    imageIntent: {
      ...page.imageIntent,
      purpose: `${page.imageIntent.purpose}。商家中途修正：${joined}`,
    },
  };
}

/**
 * Track note page unit completion and fire boundary hooks.
 * unitId === pageId (plan page identity is the Make execution unit).
 */
export function createNotePageSteeringBoundaryTracker(input: {
  workspaceId: string;
  taskId: string;
  /** Ordered page/unit ids for the active note plan. */
  unitIds: readonly string[];
  boundary: MakeSteeringBoundaryPort;
}): {
  onPageSuccess: (pageId: string) => Promise<SteeringQueueDrainResult | undefined>;
  onAllTerminal: () => Promise<SteeringQueueDrainResult | undefined>;
  remainingUnitIds: () => string[];
  completedUnitIds: () => string[];
} {
  const remaining = new Set(input.unitIds);
  const completed: string[] = [];

  async function fire(justCompletedUnitId: string | null, allUnitsTerminal: boolean) {
    return input.boundary.onUnitBoundary({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      cursor: {
        justCompletedUnitId,
        remainingUnitIds: [...remaining],
        allUnitsTerminal,
      },
    });
  }

  return {
    async onPageSuccess(pageId: string) {
      if (!remaining.has(pageId) && !completed.includes(pageId)) {
        // Unknown page id — still treat as a unit boundary for steer drain.
        completed.push(pageId);
      } else if (remaining.has(pageId)) {
        remaining.delete(pageId);
        completed.push(pageId);
      }
      return fire(pageId, remaining.size === 0);
    },
    async onAllTerminal() {
      remaining.clear();
      return fire(completed[completed.length - 1] ?? null, true);
    },
    remainingUnitIds: () => [...remaining],
    completedUnitIds: () => [...completed],
  };
}

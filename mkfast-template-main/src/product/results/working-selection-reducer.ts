/**
 * Image working-selection local typed reducer (D-087 / D-095 / WT-D2 / #100).
 *
 * "加入套图 / 移除 / 采用前排序 / 设为本组封面" stay local — no Work, Task,
 * Job, Asset, or ContentPackage revision. Explicit "保存草稿" becomes a Work
 * draft revision command shape (no model, no charge). Same-device auto-restore
 * for 7 days; base revision drift → restore / compare / discard.
 */

import type { ResultRevisionDriftChoice } from '@meiye/contracts';
import { resultRevisionDriftChoices } from '@meiye/contracts';

import { imageRoleFeedback } from './image-role-action-matrix';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const WORKING_SELECTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WORKING_SELECTION_SURFACE_VERSION = 'image-working-selection/v1';

export type WorkingSelectionItem = {
  assetId: string;
  /** When this item entered the selection (ISO). */
  addedAt: string;
};

export type WorkingSelectionState = {
  workId: string;
  /** Canonical base revision the selection was built against. */
  baseRevisionId: string;
  /** Ordered selected asset ids (index 0 = cover/main). */
  orderedAssetIds: string[];
  /** Explicit cover asset id; always equals orderedAssetIds[0] when set. */
  coverAssetId: string | null;
  /** Soft-removed candidates (undo / restore). */
  removedAssetIds: string[];
  /** Source task / job for lineage (informational). */
  sourceTaskId?: string;
  sourceRevisionId?: string;
  /** Focus restore. */
  focusAssetId?: string;
  scrollY?: number;
  /** Last local mutation time (ISO) — used for 7-day expiry. */
  updatedAt: string;
  /** Surface version for isolation. */
  surfaceVersion: string;
};

export function createEmptyWorkingSelection(input: {
  workId: string;
  baseRevisionId: string;
  now: string;
  sourceTaskId?: string;
  sourceRevisionId?: string;
}): WorkingSelectionState {
  return {
    workId: input.workId,
    baseRevisionId: input.baseRevisionId,
    orderedAssetIds: [],
    coverAssetId: null,
    removedAssetIds: [],
    ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
    ...(input.sourceRevisionId
      ? { sourceRevisionId: input.sourceRevisionId }
      : {}),
    updatedAt: input.now,
    surfaceVersion: WORKING_SELECTION_SURFACE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export type WorkingSelectionIntent =
  | { type: 'add'; assetId: string; now: string }
  | { type: 'remove'; assetId: string; now: string }
  | { type: 'restore_removed'; assetId: string; now: string }
  | { type: 'move_up'; assetId: string; now: string }
  | { type: 'move_down'; assetId: string; now: string }
  | { type: 'set_cover'; assetId: string; now: string }
  | { type: 'reorder'; orderedAssetIds: string[]; now: string }
  | { type: 'set_focus'; assetId: string | undefined; now: string }
  | { type: 'set_scroll'; scrollY: number; now: string }
  | { type: 'clear'; now: string }
  | {
      type: 'hydrate';
      snapshot: WorkingSelectionState;
      /** Live canonical revision for drift check. */
      currentRevisionId: string;
      now: string;
    };

export type WorkingSelectionReduceResult = {
  state: WorkingSelectionState;
  /** Polite a11y feedback for the last intent (exact D-087 strings when applicable). */
  feedback: string | null;
  /** Present when hydrate detects base revision drift. */
  drift: WorkingSelectionDrift | null;
};

export type WorkingSelectionDrift = {
  kind: 'revision_drift';
  baseRevisionId: string;
  currentRevisionId: string;
  choices: readonly ResultRevisionDriftChoice[];
};

function withUpdated(
  state: WorkingSelectionState,
  now: string,
  patch: Partial<WorkingSelectionState>
): WorkingSelectionState {
  return { ...state, ...patch, updatedAt: now };
}

function ensureCoverConsistency(
  orderedAssetIds: string[],
  coverAssetId: string | null
): { orderedAssetIds: string[]; coverAssetId: string | null } {
  if (orderedAssetIds.length === 0) {
    return { orderedAssetIds: [], coverAssetId: null };
  }
  if (coverAssetId && orderedAssetIds.includes(coverAssetId)) {
    const rest = orderedAssetIds.filter((id) => id !== coverAssetId);
    return {
      orderedAssetIds: [coverAssetId, ...rest],
      coverAssetId,
    };
  }
  return {
    orderedAssetIds,
    coverAssetId: orderedAssetIds[0] ?? null,
  };
}

/**
 * Pure reducer. Never creates canonical objects or generation charges.
 */
export function reduceWorkingSelection(
  state: WorkingSelectionState,
  intent: WorkingSelectionIntent
): WorkingSelectionReduceResult {
  switch (intent.type) {
    case 'add': {
      if (state.orderedAssetIds.includes(intent.assetId)) {
        const position = state.orderedAssetIds.indexOf(intent.assetId) + 1;
        return {
          state,
          feedback: imageRoleFeedback('add_to_set', { position }),
          drift: null,
        };
      }
      const removed = state.removedAssetIds.filter(
        (id) => id !== intent.assetId
      );
      const ordered = [...state.orderedAssetIds, intent.assetId];
      const next = ensureCoverConsistency(ordered, state.coverAssetId);
      const position = next.orderedAssetIds.indexOf(intent.assetId) + 1;
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: next.orderedAssetIds,
          coverAssetId: next.coverAssetId,
          removedAssetIds: removed,
          focusAssetId: intent.assetId,
        }),
        feedback: imageRoleFeedback('add_to_set', { position }),
        drift: null,
      };
    }
    case 'remove': {
      if (!state.orderedAssetIds.includes(intent.assetId)) {
        return { state, feedback: null, drift: null };
      }
      const ordered = state.orderedAssetIds.filter(
        (id) => id !== intent.assetId
      );
      const removed = state.removedAssetIds.includes(intent.assetId)
        ? state.removedAssetIds
        : [...state.removedAssetIds, intent.assetId];
      const next = ensureCoverConsistency(
        ordered,
        state.coverAssetId === intent.assetId ? null : state.coverAssetId
      );
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: next.orderedAssetIds,
          coverAssetId: next.coverAssetId,
          removedAssetIds: removed,
          focusAssetId:
            state.focusAssetId === intent.assetId
              ? next.orderedAssetIds[0]
              : state.focusAssetId,
        }),
        feedback: `已移除，第 ${state.orderedAssetIds.indexOf(intent.assetId) + 1} 张`,
        drift: null,
      };
    }
    case 'restore_removed': {
      if (!state.removedAssetIds.includes(intent.assetId)) {
        return { state, feedback: null, drift: null };
      }
      if (state.orderedAssetIds.includes(intent.assetId)) {
        return {
          state: withUpdated(state, intent.now, {
            removedAssetIds: state.removedAssetIds.filter(
              (id) => id !== intent.assetId
            ),
          }),
          feedback: null,
          drift: null,
        };
      }
      const ordered = [...state.orderedAssetIds, intent.assetId];
      const next = ensureCoverConsistency(ordered, state.coverAssetId);
      const position = next.orderedAssetIds.indexOf(intent.assetId) + 1;
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: next.orderedAssetIds,
          coverAssetId: next.coverAssetId,
          removedAssetIds: state.removedAssetIds.filter(
            (id) => id !== intent.assetId
          ),
          focusAssetId: intent.assetId,
        }),
        feedback: imageRoleFeedback('add_to_set', { position }),
        drift: null,
      };
    }
    case 'move_up': {
      const index = state.orderedAssetIds.indexOf(intent.assetId);
      if (index <= 0) return { state, feedback: null, drift: null };
      const ordered = [...state.orderedAssetIds];
      const prev = ordered[index - 1]!;
      ordered[index - 1] = intent.assetId;
      ordered[index] = prev;
      const next = ensureCoverConsistency(ordered, state.coverAssetId);
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: next.orderedAssetIds,
          coverAssetId: next.coverAssetId,
          focusAssetId: intent.assetId,
        }),
        feedback: `已前移到第 ${index} 张`,
        drift: null,
      };
    }
    case 'move_down': {
      const index = state.orderedAssetIds.indexOf(intent.assetId);
      if (index < 0 || index >= state.orderedAssetIds.length - 1) {
        return { state, feedback: null, drift: null };
      }
      const ordered = [...state.orderedAssetIds];
      const nextId = ordered[index + 1]!;
      ordered[index + 1] = intent.assetId;
      ordered[index] = nextId;
      const next = ensureCoverConsistency(ordered, state.coverAssetId);
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: next.orderedAssetIds,
          coverAssetId: next.coverAssetId,
          focusAssetId: intent.assetId,
        }),
        feedback: `已后移到第 ${index + 2} 张`,
        drift: null,
      };
    }
    case 'set_cover': {
      if (!state.orderedAssetIds.includes(intent.assetId)) {
        return { state, feedback: null, drift: null };
      }
      const next = ensureCoverConsistency(
        state.orderedAssetIds,
        intent.assetId
      );
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: next.orderedAssetIds,
          coverAssetId: intent.assetId,
          focusAssetId: intent.assetId,
        }),
        feedback: imageRoleFeedback('set_working_cover'),
        drift: null,
      };
    }
    case 'reorder': {
      const unique = [...new Set(intent.orderedAssetIds)].filter((id) =>
        state.orderedAssetIds.includes(id)
      );
      // Preserve any missing selected ids at the end in prior relative order.
      for (const id of state.orderedAssetIds) {
        if (!unique.includes(id)) unique.push(id);
      }
      const next = ensureCoverConsistency(unique, state.coverAssetId);
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: next.orderedAssetIds,
          coverAssetId: next.coverAssetId,
        }),
        feedback: `已调整顺序，共 ${next.orderedAssetIds.length} 张`,
        drift: null,
      };
    }
    case 'set_focus':
      return {
        state: withUpdated(state, intent.now, {
          focusAssetId: intent.assetId,
        }),
        feedback: null,
        drift: null,
      };
    case 'set_scroll':
      return {
        state: withUpdated(state, intent.now, { scrollY: intent.scrollY }),
        feedback: null,
        drift: null,
      };
    case 'clear':
      return {
        state: withUpdated(state, intent.now, {
          orderedAssetIds: [],
          coverAssetId: null,
          removedAssetIds: [],
          focusAssetId: undefined,
        }),
        feedback: null,
        drift: null,
      };
    case 'hydrate': {
      const snapshot = intent.snapshot;
      if (snapshot.workId !== state.workId) {
        return { state, feedback: null, drift: null };
      }
      if (isWorkingSelectionExpired(snapshot, intent.now)) {
        return {
          state: createEmptyWorkingSelection({
            workId: state.workId,
            baseRevisionId: intent.currentRevisionId,
            now: intent.now,
          }),
          feedback: null,
          drift: null,
        };
      }
      if (snapshot.baseRevisionId !== intent.currentRevisionId) {
        return {
          state: snapshot,
          feedback: null,
          drift: {
            kind: 'revision_drift',
            baseRevisionId: snapshot.baseRevisionId,
            currentRevisionId: intent.currentRevisionId,
            choices: resultRevisionDriftChoices,
          },
        };
      }
      return { state: snapshot, feedback: null, drift: null };
    }
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Drift resolution (three-way, same as Result Center uncommitted drafts)
// ---------------------------------------------------------------------------

export type ApplyWorkingSelectionDriftResult =
  | {
      kind: 'restore';
      /** Keep selection bound to original base; user re-applies later. */
      state: WorkingSelectionState;
    }
  | {
      kind: 'compare';
      state: WorkingSelectionState;
      baseRevisionId: string;
      currentRevisionId: string;
    }
  | {
      kind: 'discard';
      state: WorkingSelectionState;
    };

export function applyWorkingSelectionDriftChoice(
  state: WorkingSelectionState,
  drift: WorkingSelectionDrift,
  choice: ResultRevisionDriftChoice,
  now: string
): ApplyWorkingSelectionDriftResult {
  switch (choice) {
    case 'restore':
      // Keep local selection + original base so user can re-apply later.
      return { kind: 'restore', state };
    case 'compare':
      return {
        kind: 'compare',
        state,
        baseRevisionId: drift.baseRevisionId,
        currentRevisionId: drift.currentRevisionId,
      };
    case 'discard':
      return {
        kind: 'discard',
        state: createEmptyWorkingSelection({
          workId: state.workId,
          baseRevisionId: drift.currentRevisionId,
          now,
          sourceTaskId: state.sourceTaskId,
          sourceRevisionId: state.sourceRevisionId,
        }),
      };
    default: {
      const _exhaustive: never = choice;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence (same-device 7-day) + explicit save-draft command shape
// ---------------------------------------------------------------------------

export function isWorkingSelectionExpired(
  state: WorkingSelectionState,
  nowIso: string
): boolean {
  const updated = Date.parse(state.updatedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(updated) || Number.isNaN(now)) return true;
  return now - updated > WORKING_SELECTION_TTL_MS;
}

export function workingSelectionStorageKey(workId: string): string {
  return `result-working-selection::${workId}::${WORKING_SELECTION_SURFACE_VERSION}`;
}

/** Serialize for localStorage / session store. */
export function serializeWorkingSelection(
  state: WorkingSelectionState
): string {
  return JSON.stringify(state);
}

export function parseWorkingSelection(
  raw: string
): WorkingSelectionState | null {
  try {
    const parsed = JSON.parse(raw) as WorkingSelectionState;
    if (
      !parsed ||
      typeof parsed.workId !== 'string' ||
      typeof parsed.baseRevisionId !== 'string' ||
      !Array.isArray(parsed.orderedAssetIds)
    ) {
      return null;
    }
    return {
      ...parsed,
      orderedAssetIds: [...parsed.orderedAssetIds],
      removedAssetIds: Array.isArray(parsed.removedAssetIds)
        ? [...parsed.removedAssetIds]
        : [],
      coverAssetId: parsed.coverAssetId ?? null,
      surfaceVersion:
        parsed.surfaceVersion ?? WORKING_SELECTION_SURFACE_VERSION,
    };
  } catch {
    return null;
  }
}

/**
 * Explicit "保存草稿" → Work draft revision command (no ContentPackage,
 * no model, no charge). Cross-device only after this explicit action.
 */
export type SaveWorkingSelectionDraftCommand = {
  kind: 'save_work_draft_selection';
  workId: string;
  baseRevisionId: string;
  orderedAssetIds: string[];
  coverAssetId: string | null;
  surfaceVersion: string;
  /** Merchant-facing label. */
  label: '保存草稿';
};

export function buildSaveWorkingSelectionDraftCommand(
  state: WorkingSelectionState
): SaveWorkingSelectionDraftCommand {
  return {
    kind: 'save_work_draft_selection',
    workId: state.workId,
    baseRevisionId: state.baseRevisionId,
    orderedAssetIds: [...state.orderedAssetIds],
    coverAssetId: state.coverAssetId,
    surfaceVersion: state.surfaceVersion,
    label: '保存草稿',
  };
}

/**
 * Project ordered slots for the set tray UI / a11y.
 */
export function projectWorkingSelectionSlots(state: WorkingSelectionState): {
  assetId: string;
  order: number;
  isCover: boolean;
  isFocused: boolean;
}[] {
  return state.orderedAssetIds.map((assetId, index) => ({
    assetId,
    order: index + 1,
    isCover: state.coverAssetId === assetId || index === 0,
    isFocused: state.focusAssetId === assetId,
  }));
}

/** Ordered ids ready for whole-set adopt (atomic write input). */
export function workingSelectionAdoptPayload(
  state: WorkingSelectionState
): { assetIds: string[]; coverAssetId: string | null } | null {
  if (state.orderedAssetIds.length === 0) return null;
  return {
    assetIds: [...state.orderedAssetIds],
    coverAssetId: state.coverAssetId ?? state.orderedAssetIds[0] ?? null,
  };
}

/**
 * Result Center return / restore + revision-drift contract (D-089 / #99).
 *
 * Uncommitted edits are isolated by
 * `{ workspaceKind, workId, baseRevisionId, surfaceVersion }`.
 * On revision drift the merchant chooses restore / compare / discard —
 * never silent last-write-wins onto a new revision.
 */

import type {
  ResultPanel,
  ResultReturnRestoreSnapshot,
  ResultRevisionDriftChoice,
  ResultRevisionDriftState,
  ResultUncommittedEditKey,
  ResultWorkspaceKind,
} from '@meiye/contracts';
import { resultRevisionDriftChoices } from '@meiye/contracts';

export type ResultReturnRestoreStore = {
  /** Snapshots keyed by workId (session / history.state projection). */
  byWorkId: Record<string, ResultReturnRestoreSnapshot>;
  /** Local uncommitted drafts keyed by serialized edit key. */
  drafts: Record<string, { text: string; updatedAt: string }>;
};

export function emptyReturnRestoreStore(): ResultReturnRestoreStore {
  return { byWorkId: {}, drafts: {} };
}

/** Stable serialization for the uncommitted edit isolation key. */
export function serializeUncommittedEditKey(
  key: ResultUncommittedEditKey
): string {
  return [
    key.workspaceKind,
    key.workId,
    key.baseRevisionId,
    key.surfaceVersion,
  ].join('::');
}

export function parseUncommittedEditKey(
  value: string
): ResultUncommittedEditKey | null {
  const parts = value.split('::');
  if (parts.length !== 4) return null;
  const [workspaceKind, workId, baseRevisionId, surfaceVersion] = parts;
  if (
    workspaceKind !== 'copy' &&
    workspaceKind !== 'image' &&
    workspaceKind !== 'video'
  ) {
    return null;
  }
  if (!workId || !baseRevisionId || !surfaceVersion) return null;
  return {
    workspaceKind,
    workId,
    baseRevisionId,
    surfaceVersion,
  };
}

export function buildReturnRestoreSnapshot(input: {
  workId: string;
  sourceRoute: string;
  filter?: string;
  scrollY?: number;
  focusKey?: string;
  panel?: ResultPanel;
  selectedObjectId?: string;
  baseRevisionId?: string;
  workspaceKind?: ResultWorkspaceKind;
  surfaceVersion?: string;
  returnToDraftKey?: string;
}): ResultReturnRestoreSnapshot {
  const uncommittedEditKey =
    input.workspaceKind && input.baseRevisionId && input.surfaceVersion
      ? {
          workspaceKind: input.workspaceKind,
          workId: input.workId,
          baseRevisionId: input.baseRevisionId,
          surfaceVersion: input.surfaceVersion,
        }
      : undefined;

  return {
    sourceRoute: input.sourceRoute,
    ...(input.filter !== undefined ? { filter: input.filter } : {}),
    ...(input.scrollY !== undefined ? { scrollY: input.scrollY } : {}),
    ...(input.focusKey !== undefined ? { focusKey: input.focusKey } : {}),
    ...(input.panel !== undefined ? { panel: input.panel } : {}),
    ...(input.selectedObjectId !== undefined
      ? { selectedObjectId: input.selectedObjectId }
      : {}),
    ...(input.baseRevisionId !== undefined
      ? { baseRevisionId: input.baseRevisionId }
      : {}),
    ...(uncommittedEditKey ? { uncommittedEditKey } : {}),
    ...(input.returnToDraftKey !== undefined
      ? { returnToDraftKey: input.returnToDraftKey }
      : {}),
  };
}

export function saveReturnRestoreSnapshot(
  store: ResultReturnRestoreStore,
  workId: string,
  snapshot: ResultReturnRestoreSnapshot
): ResultReturnRestoreStore {
  return {
    ...store,
    byWorkId: {
      ...store.byWorkId,
      [workId]: snapshot,
    },
  };
}

export function loadReturnRestoreSnapshot(
  store: ResultReturnRestoreStore,
  workId: string
): ResultReturnRestoreSnapshot | null {
  return store.byWorkId[workId] ?? null;
}

export function saveUncommittedDraft(
  store: ResultReturnRestoreStore,
  key: ResultUncommittedEditKey,
  text: string,
  updatedAt: string
): ResultReturnRestoreStore {
  const serialized = serializeUncommittedEditKey(key);
  return {
    ...store,
    drafts: {
      ...store.drafts,
      [serialized]: { text, updatedAt },
    },
  };
}

export function loadUncommittedDraft(
  store: ResultReturnRestoreStore,
  key: ResultUncommittedEditKey
): { text: string; updatedAt: string } | null {
  return store.drafts[serializeUncommittedEditKey(key)] ?? null;
}

export function clearUncommittedDraft(
  store: ResultReturnRestoreStore,
  key: ResultUncommittedEditKey
): ResultReturnRestoreStore {
  const serialized = serializeUncommittedEditKey(key);
  if (!(serialized in store.drafts)) return store;
  const { [serialized]: _removed, ...rest } = store.drafts;
  return { ...store, drafts: rest };
}

/**
 * Detect revision drift between the local uncommitted base and the live
 * canonical revision. Returns null when still aligned.
 */
export function detectRevisionDrift(input: {
  uncommittedEditKey: ResultUncommittedEditKey;
  currentRevisionId: string;
}): ResultRevisionDriftState | null {
  if (input.uncommittedEditKey.baseRevisionId === input.currentRevisionId) {
    return null;
  }
  return {
    kind: 'revision_drift',
    baseRevisionId: input.uncommittedEditKey.baseRevisionId,
    currentRevisionId: input.currentRevisionId,
    choices: resultRevisionDriftChoices,
    uncommittedEditKey: input.uncommittedEditKey,
  };
}

export type ApplyDriftResult =
  | {
      kind: 'restored';
      /** Keep draft bound to the original base revision (user re-applies later). */
      store: ResultReturnRestoreStore;
      draft: { text: string; updatedAt: string } | null;
    }
  | {
      kind: 'compare';
      store: ResultReturnRestoreStore;
      baseRevisionId: string;
      currentRevisionId: string;
      draft: { text: string; updatedAt: string } | null;
    }
  | {
      kind: 'discarded';
      store: ResultReturnRestoreStore;
    };

/**
 * Apply one of the three drift choices.
 * - restore: keep local draft; do not auto-apply onto the new revision
 * - compare: surface both revisions + draft for merchant decision
 * - discard: drop the uncommitted draft
 */
export function applyRevisionDriftChoice(
  store: ResultReturnRestoreStore,
  drift: ResultRevisionDriftState,
  choice: ResultRevisionDriftChoice
): ApplyDriftResult {
  const draft = loadUncommittedDraft(store, drift.uncommittedEditKey);

  switch (choice) {
    case 'restore':
      return { kind: 'restored', store, draft };
    case 'compare':
      return {
        kind: 'compare',
        store,
        baseRevisionId: drift.baseRevisionId,
        currentRevisionId: drift.currentRevisionId,
        draft,
      };
    case 'discard': {
      const next = clearUncommittedDraft(store, drift.uncommittedEditKey);
      return { kind: 'discarded', store: next };
    }
    default: {
      const _exhaustive: never = choice;
      return _exhaustive;
    }
  }
}

/**
 * Restore navigation target for browser back from Result Center.
 * Returns the source route + optional draft key — never invents a workId.
 */
export function projectBrowserReturn(input: {
  snapshot: ResultReturnRestoreSnapshot | null;
  fallbackSourceRoute?: string;
}): {
  sourceRoute: string;
  filter?: string;
  scrollY?: number;
  focusKey?: string;
  returnToDraftKey?: string;
} {
  if (input.snapshot) {
    return {
      sourceRoute: input.snapshot.sourceRoute,
      ...(input.snapshot.filter !== undefined
        ? { filter: input.snapshot.filter }
        : {}),
      ...(input.snapshot.scrollY !== undefined
        ? { scrollY: input.snapshot.scrollY }
        : {}),
      ...(input.snapshot.focusKey !== undefined
        ? { focusKey: input.snapshot.focusKey }
        : {}),
      ...(input.snapshot.returnToDraftKey !== undefined
        ? { returnToDraftKey: input.snapshot.returnToDraftKey }
        : {}),
    };
  }
  return {
    sourceRoute: input.fallbackSourceRoute ?? '/dashboard',
  };
}

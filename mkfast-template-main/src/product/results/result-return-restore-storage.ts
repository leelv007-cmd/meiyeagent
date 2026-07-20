/**
 * Seven-day browser persistence for Result Center return/restore state.
 *
 * Storage is scoped to one exact workId. Loading is allowed only after the
 * canonical ResultTarget resolver confirms that same work, so an invalid URL
 * can never restore a different or latest result.
 */

import type {
  ResultRevisionDriftChoice,
  ResultRevisionDriftState,
  ResultTargetResolveOutcome,
  ResultUncommittedEditKey,
} from '@meiye/contracts';

import {
  applyRevisionDriftChoice,
  emptyReturnRestoreStore,
  parseUncommittedEditKey,
  type ApplyDriftResult,
  type ResultReturnRestoreStore,
} from './result-return-restore';

export const RESULT_RETURN_RESTORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESULT_RETURN_RESTORE_STORAGE_VERSION = 'result-return-restore/v1';

type PersistedResultReturnRestore = {
  schema: typeof RESULT_RETURN_RESTORE_STORAGE_VERSION;
  workId: string;
  updatedAt: string;
  store: ResultReturnRestoreStore;
};

export type LoadResultReturnRestoreSessionResult =
  | { kind: 'restored'; store: ResultReturnRestoreStore }
  | {
      kind: 'missing' | 'expired' | 'invalid_data' | 'invalid_target';
      store: ResultReturnRestoreStore;
    };

export function resultReturnRestoreStorageKey(workId: string): string {
  return `result-return-restore::${workId}::${RESULT_RETURN_RESTORE_STORAGE_VERSION}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function keyBelongsToWork(
  serialized: string,
  workId: string
): serialized is string {
  return parseUncommittedEditKey(serialized)?.workId === workId;
}

function validUncommittedKey(
  value: unknown,
  workId: string
): value is ResultUncommittedEditKey {
  if (!isRecord(value)) return false;
  const workspaceKind = value.workspaceKind;
  return (
    (workspaceKind === 'copy' ||
      workspaceKind === 'image' ||
      workspaceKind === 'video') &&
    value.workId === workId &&
    typeof value.baseRevisionId === 'string' &&
    value.baseRevisionId.length > 0 &&
    typeof value.surfaceVersion === 'string' &&
    value.surfaceVersion.length > 0
  );
}

function parseStore(
  value: unknown,
  workId: string
): ResultReturnRestoreStore | null {
  if (
    !isRecord(value) ||
    !isRecord(value.byWorkId) ||
    !isRecord(value.drafts)
  ) {
    return null;
  }

  const snapshotValue = value.byWorkId[workId];
  const byWorkId: ResultReturnRestoreStore['byWorkId'] = {};
  if (snapshotValue !== undefined) {
    if (
      !isRecord(snapshotValue) ||
      typeof snapshotValue.sourceRoute !== 'string' ||
      (snapshotValue.uncommittedEditKey !== undefined &&
        !validUncommittedKey(snapshotValue.uncommittedEditKey, workId))
    ) {
      return null;
    }
    byWorkId[workId] =
      snapshotValue as ResultReturnRestoreStore['byWorkId'][string];
  }

  const drafts: ResultReturnRestoreStore['drafts'] = {};
  for (const [serialized, draftValue] of Object.entries(value.drafts)) {
    if (!keyBelongsToWork(serialized, workId)) return null;
    if (
      !isRecord(draftValue) ||
      typeof draftValue.text !== 'string' ||
      typeof draftValue.updatedAt !== 'string'
    ) {
      return null;
    }
    drafts[serialized] = {
      text: draftValue.text,
      updatedAt: draftValue.updatedAt,
    };
  }

  return { byWorkId, drafts };
}

function scopeStoreToWork(
  store: ResultReturnRestoreStore,
  workId: string
): ResultReturnRestoreStore {
  const snapshot = store.byWorkId[workId];
  return {
    byWorkId: snapshot ? { [workId]: snapshot } : {},
    drafts: Object.fromEntries(
      Object.entries(store.drafts).filter(([serialized]) =>
        keyBelongsToWork(serialized, workId)
      )
    ),
  };
}

export function persistResultReturnRestoreSession(input: {
  storage: Storage;
  workId: string;
  store: ResultReturnRestoreStore;
  nowIso: string;
}): void {
  const envelope: PersistedResultReturnRestore = {
    schema: RESULT_RETURN_RESTORE_STORAGE_VERSION,
    workId: input.workId,
    updatedAt: input.nowIso,
    store: scopeStoreToWork(input.store, input.workId),
  };
  input.storage.setItem(
    resultReturnRestoreStorageKey(input.workId),
    JSON.stringify(envelope)
  );
}

function targetMatches(
  outcome: ResultTargetResolveOutcome,
  workId: string
): boolean {
  return outcome.kind === 'ok' && outcome.target.workId === workId;
}

export function loadResultReturnRestoreSession(input: {
  storage: Storage;
  workId: string;
  resolveOutcome: ResultTargetResolveOutcome;
  nowIso: string;
}): LoadResultReturnRestoreSessionResult {
  const empty = emptyReturnRestoreStore();
  if (!targetMatches(input.resolveOutcome, input.workId)) {
    return { kind: 'invalid_target', store: empty };
  }

  const key = resultReturnRestoreStorageKey(input.workId);
  const raw = input.storage.getItem(key);
  if (raw === null) return { kind: 'missing', store: empty };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    input.storage.removeItem(key);
    return { kind: 'invalid_data', store: empty };
  }
  if (
    !isRecord(value) ||
    value.schema !== RESULT_RETURN_RESTORE_STORAGE_VERSION ||
    value.workId !== input.workId ||
    typeof value.updatedAt !== 'string'
  ) {
    input.storage.removeItem(key);
    return { kind: 'invalid_data', store: empty };
  }

  const updatedMs = Date.parse(value.updatedAt);
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(updatedMs) || !Number.isFinite(nowMs)) {
    input.storage.removeItem(key);
    return { kind: 'invalid_data', store: empty };
  }
  if (nowMs - updatedMs > RESULT_RETURN_RESTORE_TTL_MS) {
    input.storage.removeItem(key);
    return { kind: 'expired', store: empty };
  }

  const store = parseStore(value.store, input.workId);
  if (!store) {
    input.storage.removeItem(key);
    return { kind: 'invalid_data', store: empty };
  }
  return { kind: 'restored', store };
}

/**
 * Apply a merchant drift decision and persist only when it changes storage.
 * Restore/compare keep the original edit timestamp; viewing must not silently
 * extend the seven-day lifetime. Discard persists the removal immediately.
 */
export function applyPersistedResultRevisionDriftChoice(input: {
  storage: Storage;
  workId: string;
  store: ResultReturnRestoreStore;
  drift: ResultRevisionDriftState;
  choice: ResultRevisionDriftChoice;
  nowIso: string;
}): ApplyDriftResult {
  const result = applyRevisionDriftChoice(
    input.store,
    input.drift,
    input.choice
  );
  if (result.kind === 'discarded') {
    persistResultReturnRestoreSession({
      storage: input.storage,
      workId: input.workId,
      store: result.store,
      nowIso: input.nowIso,
    });
  }
  return result;
}

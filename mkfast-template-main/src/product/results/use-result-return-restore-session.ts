import type {
  ResultRevisionDriftChoice,
  ResultTargetResolveOutcome,
} from '@meiye/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyPersistedResultRevisionDriftChoice,
  loadResultReturnRestoreSession,
  persistResultReturnRestoreSession,
  type LoadResultReturnRestoreSessionResult,
} from './result-return-restore-storage';
import {
  detectRevisionDrift,
  emptyReturnRestoreStore,
  loadUncommittedDraft,
  type ApplyDriftResult,
  type ResultReturnRestoreStore,
} from './result-return-restore';

export type UseResultReturnRestoreSessionInput = {
  workId: string;
  resolveOutcome: ResultTargetResolveOutcome;
  currentRevisionId?: string;
  /** Injectable for tests; browser localStorage is used by default. */
  storage?: Storage;
  now?: () => string;
};

function browserStorage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function currentIso(now?: () => string): string {
  return now?.() ?? new Date().toISOString();
}

/**
 * Browser bridge consumed by the Result Center route/page boundary.
 * Hydration is resolver-gated, so invalid targets never see persisted drafts.
 */
export function useResultReturnRestoreSession(
  input: UseResultReturnRestoreSessionInput
) {
  const nowRef = useRef(input.now);
  nowRef.current = input.now;
  const [store, setStore] = useState<ResultReturnRestoreStore>(() =>
    emptyReturnRestoreStore()
  );
  const [loadKind, setLoadKind] =
    useState<LoadResultReturnRestoreSessionResult['kind']>('missing');
  const [lastChoiceResult, setLastChoiceResult] =
    useState<ApplyDriftResult | null>(null);
  const resolvedWorkId =
    input.resolveOutcome.kind === 'ok'
      ? input.resolveOutcome.target.workId
      : input.resolveOutcome.kind;

  useEffect(() => {
    const storage = browserStorage(input.storage);
    if (!storage) {
      setStore(emptyReturnRestoreStore());
      setLoadKind('missing');
      return;
    }
    const loaded = loadResultReturnRestoreSession({
      storage,
      workId: input.workId,
      resolveOutcome: input.resolveOutcome,
      nowIso: currentIso(nowRef.current),
    });
    setStore(loaded.store);
    setLoadKind(loaded.kind);
    setLastChoiceResult(null);
  }, [input.resolveOutcome.kind, input.storage, input.workId, resolvedWorkId]);

  const drift = useMemo(() => {
    const snapshot = store.byWorkId[input.workId];
    if (!snapshot?.uncommittedEditKey || !input.currentRevisionId) return null;
    if (!loadUncommittedDraft(store, snapshot.uncommittedEditKey)) return null;
    return detectRevisionDrift({
      uncommittedEditKey: snapshot.uncommittedEditKey,
      currentRevisionId: input.currentRevisionId,
    });
  }, [input.currentRevisionId, input.workId, store]);

  const persistStore = useCallback(
    (next: ResultReturnRestoreStore) => {
      const storage = browserStorage(input.storage);
      if (storage) {
        persistResultReturnRestoreSession({
          storage,
          workId: input.workId,
          store: next,
          nowIso: currentIso(nowRef.current),
        });
      }
      setStore(next);
      setLoadKind('restored');
    },
    [input.storage, input.workId]
  );

  const applyDriftChoice = useCallback(
    (choice: ResultRevisionDriftChoice): ApplyDriftResult | null => {
      const storage = browserStorage(input.storage);
      if (!storage || !drift) return null;
      const result = applyPersistedResultRevisionDriftChoice({
        storage,
        workId: input.workId,
        store,
        drift,
        choice,
        nowIso: currentIso(nowRef.current),
      });
      setStore(result.store);
      setLastChoiceResult(result);
      return result;
    },
    [drift, input.storage, input.workId, store]
  );

  return {
    applyDriftChoice,
    drift,
    lastChoiceResult,
    loadKind,
    persistStore,
    store,
  };
}

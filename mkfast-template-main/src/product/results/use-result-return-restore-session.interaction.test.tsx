import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ResultTargetResolveOutcome } from '@meiye/contracts';

import { persistResultReturnRestoreSession } from './result-return-restore-storage';
import {
  buildReturnRestoreSnapshot,
  emptyReturnRestoreStore,
  saveReturnRestoreSnapshot,
  saveUncommittedDraft,
} from './result-return-restore';
import { useResultReturnRestoreSession } from './use-result-return-restore-session';

afterEach(cleanup);

const workId = 'work-hook-1';
const outcome: ResultTargetResolveOutcome = {
  kind: 'ok',
  target: { workId },
  mode: 'active',
  workspaceId: 'workspace-1',
};
const now = () => '2026-07-21T00:00:00.000Z';

function seededStorage() {
  const storage = window.localStorage;
  storage.clear();
  const draftKey = {
    workspaceKind: 'copy' as const,
    workId,
    baseRevisionId: 'revision-1',
    surfaceVersion: 'result-copy/v1',
  };
  let store = emptyReturnRestoreStore();
  store = saveReturnRestoreSnapshot(
    store,
    workId,
    buildReturnRestoreSnapshot({
      workId,
      sourceRoute: '/dashboard/content',
      baseRevisionId: draftKey.baseRevisionId,
      workspaceKind: draftKey.workspaceKind,
      surfaceVersion: draftKey.surfaceVersion,
    })
  );
  store = saveUncommittedDraft(
    store,
    draftKey,
    '重载后的手改',
    '2026-07-20T00:00:00.000Z'
  );
  persistResultReturnRestoreSession({
    storage,
    workId,
    store,
    nowIso: '2026-07-20T00:00:00.000Z',
  });
  return storage;
}

describe('useResultReturnRestoreSession', () => {
  it('hydrates after reload, exposes drift, and persists discard', async () => {
    const storage = seededStorage();
    const first = renderHook(() =>
      useResultReturnRestoreSession({
        workId,
        resolveOutcome: outcome,
        currentRevisionId: 'revision-2',
        storage,
        now,
      })
    );

    await waitFor(() => expect(first.result.current.loadKind).toBe('restored'));
    expect(first.result.current.drift?.baseRevisionId).toBe('revision-1');

    act(() => {
      first.result.current.applyDriftChoice('discard');
    });
    expect(first.result.current.drift).toBeNull();
    first.unmount();

    const afterReload = renderHook(() =>
      useResultReturnRestoreSession({
        workId,
        resolveOutcome: outcome,
        currentRevisionId: 'revision-2',
        storage,
        now,
      })
    );
    await waitFor(() =>
      expect(afterReload.result.current.loadKind).toBe('restored')
    );
    expect(afterReload.result.current.store.drafts).toEqual({});
  });

  it('does not hydrate when canonical resolution rejects the target', async () => {
    const storage = seededStorage();
    const invalid: ResultTargetResolveOutcome = {
      kind: 'not_found',
      code: 'NOT_FOUND',
      message: 'missing',
      requested: { workId },
    };
    const result = renderHook(() =>
      useResultReturnRestoreSession({
        workId,
        resolveOutcome: invalid,
        currentRevisionId: 'revision-2',
        storage,
        now,
      })
    );
    await waitFor(() =>
      expect(result.result.current.loadKind).toBe('invalid_target')
    );
    expect(result.result.current.store.drafts).toEqual({});
    expect(result.result.current.drift).toBeNull();
  });
});

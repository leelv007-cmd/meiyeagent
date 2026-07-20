import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ResultTargetResolveOutcome,
  ResultUncommittedEditKey,
} from '@meiye/contracts';

import {
  applyPersistedResultRevisionDriftChoice,
  loadResultReturnRestoreSession,
  persistResultReturnRestoreSession,
  RESULT_RETURN_RESTORE_TTL_MS,
} from './result-return-restore-storage';
import {
  buildReturnRestoreSnapshot,
  detectRevisionDrift,
  emptyReturnRestoreStore,
  loadUncommittedDraft,
  saveReturnRestoreSnapshot,
  saveUncommittedDraft,
} from './result-return-restore';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const WORK_ID = 'work-restore-1';
const SAVED_AT = '2026-07-20T10:00:00.000Z';
const key: ResultUncommittedEditKey = {
  workspaceKind: 'copy',
  workId: WORK_ID,
  baseRevisionId: 'revision-1',
  surfaceVersion: 'result-copy/v1',
};
const validOutcome: ResultTargetResolveOutcome = {
  kind: 'ok',
  target: { workId: WORK_ID },
  mode: 'active',
  workspaceId: 'workspace-1',
};

function populatedStore() {
  let store = emptyReturnRestoreStore();
  store = saveReturnRestoreSnapshot(
    store,
    WORK_ID,
    buildReturnRestoreSnapshot({
      workId: WORK_ID,
      sourceRoute: '/dashboard/content',
      scrollY: 420,
      panel: 'adjust',
      focusKey: 'copy-title',
      returnToDraftKey: 'draft-1',
      baseRevisionId: key.baseRevisionId,
      workspaceKind: key.workspaceKind,
      surfaceVersion: key.surfaceVersion,
    })
  );
  return saveUncommittedDraft(store, key, '未提交手改', SAVED_AT);
}

test('reload restores the exact work snapshot and draft from localStorage', () => {
  const storage = new MemoryStorage();
  persistResultReturnRestoreSession({
    storage,
    workId: WORK_ID,
    store: populatedStore(),
    nowIso: SAVED_AT,
  });

  const reloaded = loadResultReturnRestoreSession({
    storage,
    workId: WORK_ID,
    resolveOutcome: validOutcome,
    nowIso: '2026-07-21T10:00:00.000Z',
  });

  assert.equal(reloaded.kind, 'restored');
  if (reloaded.kind !== 'restored') return;
  assert.equal(reloaded.store.byWorkId[WORK_ID]?.scrollY, 420);
  assert.equal(loadUncommittedDraft(reloaded.store, key)?.text, '未提交手改');
});

test('session is available through day seven and removed immediately after expiry', () => {
  const atBoundary = new MemoryStorage();
  persistResultReturnRestoreSession({
    storage: atBoundary,
    workId: WORK_ID,
    store: populatedStore(),
    nowIso: SAVED_AT,
  });
  const boundary = new Date(
    Date.parse(SAVED_AT) + RESULT_RETURN_RESTORE_TTL_MS
  ).toISOString();
  assert.equal(
    loadResultReturnRestoreSession({
      storage: atBoundary,
      workId: WORK_ID,
      resolveOutcome: validOutcome,
      nowIso: boundary,
    }).kind,
    'restored'
  );

  const expiredStorage = new MemoryStorage();
  persistResultReturnRestoreSession({
    storage: expiredStorage,
    workId: WORK_ID,
    store: populatedStore(),
    nowIso: SAVED_AT,
  });
  const expiredAt = new Date(
    Date.parse(SAVED_AT) + RESULT_RETURN_RESTORE_TTL_MS + 1
  ).toISOString();
  const expired = loadResultReturnRestoreSession({
    storage: expiredStorage,
    workId: WORK_ID,
    resolveOutcome: validOutcome,
    nowIso: expiredAt,
  });
  assert.equal(expired.kind, 'expired');
  assert.equal(expiredStorage.length, 0);
});

test('invalid or mismatched target never restores another work', () => {
  const storage = new MemoryStorage();
  persistResultReturnRestoreSession({
    storage,
    workId: WORK_ID,
    store: populatedStore(),
    nowIso: SAVED_AT,
  });

  const notFound = loadResultReturnRestoreSession({
    storage,
    workId: WORK_ID,
    resolveOutcome: {
      kind: 'not_found',
      code: 'NOT_FOUND',
      message: 'missing',
      requested: { workId: WORK_ID },
    },
    nowIso: SAVED_AT,
  });
  assert.equal(notFound.kind, 'invalid_target');

  const mismatched = loadResultReturnRestoreSession({
    storage,
    workId: WORK_ID,
    resolveOutcome: {
      ...validOutcome,
      target: { workId: 'another-work' },
    },
    nowIso: SAVED_AT,
  });
  assert.equal(mismatched.kind, 'invalid_target');
});

test('revision drift restore, compare, and discard survive reload correctly', () => {
  for (const choice of ['restore', 'compare', 'discard'] as const) {
    const storage = new MemoryStorage();
    const store = populatedStore();
    persistResultReturnRestoreSession({
      storage,
      workId: WORK_ID,
      store,
      nowIso: SAVED_AT,
    });
    const drift = detectRevisionDrift({
      uncommittedEditKey: key,
      currentRevisionId: 'revision-2',
    });
    assert.ok(drift);

    const result = applyPersistedResultRevisionDriftChoice({
      storage,
      workId: WORK_ID,
      store,
      drift: drift!,
      choice,
      nowIso: '2026-07-21T10:00:00.000Z',
    });
    assert.equal(
      result.kind,
      choice === 'restore'
        ? 'restored'
        : choice === 'compare'
          ? 'compare'
          : 'discarded'
    );

    const reloaded = loadResultReturnRestoreSession({
      storage,
      workId: WORK_ID,
      resolveOutcome: validOutcome,
      nowIso: '2026-07-21T10:00:01.000Z',
    });
    assert.equal(reloaded.kind, 'restored');
    if (reloaded.kind !== 'restored') continue;
    assert.equal(
      loadUncommittedDraft(reloaded.store, key)?.text,
      choice === 'discard' ? undefined : '未提交手改'
    );
  }
});

test('malformed persisted data is removed without throwing', () => {
  const storage = new MemoryStorage();
  storage.setItem(
    'result-return-restore::work-restore-1::result-return-restore/v1',
    '{broken'
  );
  const result = loadResultReturnRestoreSession({
    storage,
    workId: WORK_ID,
    resolveOutcome: validOutcome,
    nowIso: SAVED_AT,
  });
  assert.equal(result.kind, 'invalid_data');
  assert.equal(storage.length, 0);
});

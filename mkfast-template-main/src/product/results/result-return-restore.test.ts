/**
 * Return restore / revision drift three-way / invalid error e2e-style pure tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRevisionDriftChoice,
  buildReturnRestoreSnapshot,
  detectRevisionDrift,
  emptyReturnRestoreStore,
  loadReturnRestoreSnapshot,
  loadUncommittedDraft,
  parseUncommittedEditKey,
  projectBrowserReturn,
  saveReturnRestoreSnapshot,
  saveUncommittedDraft,
  serializeUncommittedEditKey,
} from './result-return-restore';
import {
  shellViewFromResolveOutcome,
} from './result-shell-model';
import {
  isResultTargetMissing,
  resolveResultTargetClient,
  type ClientResolverWorkRecord,
} from './result-target-wiring';
import { navigateAfterSubmitSuccess } from './result-center-navigation';

// ---------------------------------------------------------------------------
// Return / restore
// ---------------------------------------------------------------------------

test('return snapshot preserves source route / filter / scroll / focus / panel', () => {
  let store = emptyReturnRestoreStore();
  const snapshot = buildReturnRestoreSnapshot({
    workId: 'work-1',
    sourceRoute: '/dashboard/content',
    filter: 'platform=xiaohongshu',
    scrollY: 420,
    focusKey: 'candidate-primary',
    panel: 'adjust',
    selectedObjectId: 'ver-1',
    baseRevisionId: 'rev-1',
    workspaceKind: 'copy',
    surfaceVersion: 'surface-v1',
    returnToDraftKey: 'draft-abc',
  });

  assert.equal(snapshot.sourceRoute, '/dashboard/content');
  assert.equal(snapshot.filter, 'platform=xiaohongshu');
  assert.equal(snapshot.scrollY, 420);
  assert.equal(snapshot.focusKey, 'candidate-primary');
  assert.equal(snapshot.panel, 'adjust');
  assert.equal(snapshot.selectedObjectId, 'ver-1');
  assert.deepEqual(snapshot.uncommittedEditKey, {
    workspaceKind: 'copy',
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    surfaceVersion: 'surface-v1',
  });

  store = saveReturnRestoreSnapshot(store, 'work-1', snapshot);
  const loaded = loadReturnRestoreSnapshot(store, 'work-1');
  assert.deepEqual(loaded, snapshot);

  const browserReturn = projectBrowserReturn({ snapshot: loaded });
  assert.equal(browserReturn.sourceRoute, '/dashboard/content');
  assert.equal(browserReturn.filter, 'platform=xiaohongshu');
  assert.equal(browserReturn.scrollY, 420);
  assert.equal(browserReturn.returnToDraftKey, 'draft-abc');
});

test('uncommitted edit keys isolate by workspaceKind / workId / revision / surface', () => {
  const keyA = {
    workspaceKind: 'copy' as const,
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    surfaceVersion: 's1',
  };
  const keyB = { ...keyA, baseRevisionId: 'rev-2' };
  assert.notEqual(
    serializeUncommittedEditKey(keyA),
    serializeUncommittedEditKey(keyB),
  );

  let store = emptyReturnRestoreStore();
  store = saveUncommittedDraft(store, keyA, '本地草稿 A', 't1');
  store = saveUncommittedDraft(store, keyB, '本地草稿 B', 't2');

  assert.equal(loadUncommittedDraft(store, keyA)?.text, '本地草稿 A');
  assert.equal(loadUncommittedDraft(store, keyB)?.text, '本地草稿 B');

  const parsed = parseUncommittedEditKey(serializeUncommittedEditKey(keyA));
  assert.deepEqual(parsed, keyA);
});

// ---------------------------------------------------------------------------
// Revision drift three-way
// ---------------------------------------------------------------------------

test('drift three-way: restore / compare / discard', () => {
  const key = {
    workspaceKind: 'image' as const,
    workId: 'work-9',
    baseRevisionId: 'rev-10',
    surfaceVersion: 'img-surface-1',
  };
  let store = emptyReturnRestoreStore();
  store = saveUncommittedDraft(store, key, '未提交套图顺序', 't0');

  const aligned = detectRevisionDrift({
    uncommittedEditKey: key,
    currentRevisionId: 'rev-10',
  });
  assert.equal(aligned, null);

  const drift = detectRevisionDrift({
    uncommittedEditKey: key,
    currentRevisionId: 'rev-11',
  });
  assert.ok(drift);
  assert.equal(drift?.kind, 'revision_drift');
  assert.deepEqual(drift?.choices, ['restore', 'compare', 'discard']);

  const restored = applyRevisionDriftChoice(store, drift!, 'restore');
  assert.equal(restored.kind, 'restored');
  if (restored.kind === 'restored') {
    assert.equal(restored.draft?.text, '未提交套图顺序');
    // Draft still present after restore choice.
    assert.equal(loadUncommittedDraft(restored.store, key)?.text, '未提交套图顺序');
  }

  const compared = applyRevisionDriftChoice(store, drift!, 'compare');
  assert.equal(compared.kind, 'compare');
  if (compared.kind === 'compare') {
    assert.equal(compared.baseRevisionId, 'rev-10');
    assert.equal(compared.currentRevisionId, 'rev-11');
    assert.equal(compared.draft?.text, '未提交套图顺序');
  }

  const discarded = applyRevisionDriftChoice(store, drift!, 'discard');
  assert.equal(discarded.kind, 'discarded');
  if (discarded.kind === 'discarded') {
    assert.equal(loadUncommittedDraft(discarded.store, key), null);
  }
});

// ---------------------------------------------------------------------------
// Invalid workId / contentId → not-found, never latest fallback
// ---------------------------------------------------------------------------

test('invalid workId resolves not_found and shell stays error (no latest)', () => {
  const works: ClientResolverWorkRecord[] = [
    {
      workId: 'work-latest',
      workspaceId: 'ws-1',
      contentIds: ['pkg-latest'],
      versionIdsByContentId: { 'pkg-latest': ['v1'] },
    },
  ];

  const outcome = resolveResultTargetClient({
    request: { workId: 'work-missing', contentId: 'pkg-missing' },
    viewer: { userId: 'u1', workspaceId: 'ws-1' },
    hasMembership: true,
    works,
  });

  assert.equal(outcome.kind, 'not_found');
  assert.equal(isResultTargetMissing(outcome), true);
  if (outcome.kind !== 'not_found') return;
  // Must keep the requested id — never rewrite to work-latest.
  assert.equal(outcome.requested.workId, 'work-missing');
  assert.notEqual(outcome.requested.workId, 'work-latest');

  const view = shellViewFromResolveOutcome(outcome, {
    workspaceKind: 'copy',
  });
  assert.equal(view.kind, 'error');
  if (view.kind !== 'error') return;
  assert.equal(view.code, 'NOT_FOUND');
  assert.equal(view.requested.workId, 'work-missing');
});

test('lineage mismatch is recoverable and does not fall back', () => {
  const works: ClientResolverWorkRecord[] = [
    {
      workId: 'work-a',
      workspaceId: 'ws-1',
      contentIds: ['pkg-a'],
      versionIdsByContentId: { 'pkg-a': ['va'] },
    },
    {
      workId: 'work-b',
      workspaceId: 'ws-1',
      contentIds: ['pkg-b'],
      versionIdsByContentId: { 'pkg-b': ['vb'] },
    },
  ];

  const outcome = resolveResultTargetClient({
    request: {
      workId: 'work-a',
      contentId: 'pkg-b',
    },
    viewer: { userId: 'u1', workspaceId: 'ws-1' },
    hasMembership: true,
    works,
  });

  assert.equal(outcome.kind, 'lineage_mismatch');
  if (outcome.kind !== 'lineage_mismatch') return;
  assert.equal(outcome.recoverable, true);
  assert.equal(outcome.requested.workId, 'work-a');

  const view = shellViewFromResolveOutcome(outcome, {
    workspaceKind: 'copy',
  });
  assert.equal(view.kind, 'error');
  if (view.kind !== 'error') return;
  assert.equal(view.code, 'LINEAGE_MISMATCH');
  assert.equal(view.recoverable, true);
});

// ---------------------------------------------------------------------------
// Submit success → Result Center navigation
// ---------------------------------------------------------------------------

test('submit success navigates to Result Center with typed contract', () => {
  const location = navigateAfterSubmitSuccess({
    workId: 'work-new',
    returnToDraftKey: 'draft-1',
    focusKey: 'run-progress',
    sourceRoute: '/dashboard',
    panel: 'run',
  });

  assert.equal(location.pathname, '/dashboard/results/work-new');
  assert.equal(location.search.panel, 'run');
  assert.equal(location.search.focusKey, 'run-progress');
  assert.equal(location.state?.returnToDraftKey, 'draft-1');
  assert.equal(location.state?.sourceRoute, '/dashboard');
  // Must not use the legacy ?workId= dashboard bridge.
  assert.equal('workId' in location.search, false);
});

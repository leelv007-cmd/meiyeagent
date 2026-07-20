/**
 * Result Center contract freeze tests (WT-D1 / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_ARCHIVE_LABEL,
  resultActionIds,
  resultCenterPath,
  resultCenterSearchParams,
  resultPanels,
  resultRevisionDriftChoices,
  type ResultCenterNavigation,
  type ResultCommandInput,
  type ResultShellModel,
  type ResultTarget,
  type ResultUncommittedEditKey,
} from './result-center.js';

test('ResultCenterNavigation freezes workId + optional return/focus keys', () => {
  const nav: ResultCenterNavigation = {
    workId: 'work-1',
    returnToDraftKey: 'draft-1',
    focusKey: 'primary',
  };
  assert.equal(nav.workId, 'work-1');
  assert.equal(nav.returnToDraftKey, 'draft-1');
  assert.equal(nav.focusKey, 'primary');
});

test('resultCenterPath encodes workId under /dashboard/results', () => {
  assert.equal(resultCenterPath('work/1'), '/dashboard/results/work%2F1');
  assert.equal(resultCenterPath('work-1'), '/dashboard/results/work-1');
});

test('resultCenterSearchParams only emits shareable keys', () => {
  assert.deepEqual(
    resultCenterSearchParams({
      contentId: 'pkg-1',
      versionId: 'ver-1',
      panel: 'delivery',
      focusKey: 'cta',
    }),
    {
      contentId: 'pkg-1',
      versionId: 'ver-1',
      panel: 'delivery',
      focusKey: 'cta',
    },
  );
  assert.deepEqual(resultCenterSearchParams({}), {});
});

test('result panels and action ids are frozen enumerations', () => {
  assert.deepEqual(resultPanels, [
    'result',
    'adjust',
    'delivery',
    'history',
    'run',
  ]);
  assert.ok(resultActionIds.includes('adopt_candidate'));
  assert.ok(resultActionIds.includes('leave_and_continue'));
  assert.deepEqual(resultRevisionDriftChoices, [
    'restore',
    'compare',
    'discard',
  ]);
});

test('ResultShellModel shape is projection-only (compile-time contract)', () => {
  const shell: ResultShellModel = {
    target: { workId: 'work-1' },
    phase: 'ready',
    workspaceKind: 'copy',
    primaryAction: {
      id: 'adopt_candidate',
      role: 'primary',
      label: '采用此版本',
      enabled: true,
    },
    secondaryActions: [],
    overflowActions: [],
    canonicalLinks: [{ kind: 'work', id: 'work-1' }],
    panel: 'result',
  };
  assert.equal(shell.phase, 'ready');
});

test('uncommitted edit key isolates workspaceKind/workId/revision/surface', () => {
  const key: ResultUncommittedEditKey = {
    workspaceKind: 'image',
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    surfaceVersion: 's1',
  };
  assert.equal(key.workspaceKind, 'image');
});

test('ResultCommandInput requires action + target + idempotencyKey', () => {
  const input: ResultCommandInput = {
    action: 'deliver',
    target: { workId: 'work-1' } satisfies ResultTarget,
    expectedRevision: 'rev-1',
    idempotencyKey: 'idem-1',
  };
  assert.equal(input.action, 'deliver');
});

test('legacy archive label stays 历史档案', () => {
  assert.equal(LEGACY_ARCHIVE_LABEL, '历史档案');
});

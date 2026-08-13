/**
 * V31-83: same-tab account switch must not restore the previous merchant
 * conversation, and logout must leave no product sessionStorage keys.
 */
import { afterEach, expect, it } from 'vitest';

import {
  bindComposerTask,
  composerSessionStorageKey,
  createComposerSession,
  openComposerTurn,
  readPersistedComposerSession,
  writePersistedComposerSession,
} from './composer-session';
import {
  clearProductSessionClientState,
  listProductSessionStorageKeys,
} from '../session-client-state';

const NOW = '2026-08-13T08:00:00.000Z';
const ACCOUNT_A_TEXT = 'A账号独有的周末预约文案';

function accountASession() {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-a'), ACCOUNT_A_TEXT),
    {
      taskId: 'task-owned-by-a',
      workId: 'work-owned-by-a',
      packageId: 'package-owned-by-a',
      agentThreadId: 'thread-owned-by-a',
    }
  );
}

afterEach(() => {
  window.sessionStorage.clear();
});

it('A writes a composer session then B reads an empty handle', () => {
  writePersistedComposerSession({
    nowIso: NOW,
    session: accountASession(),
    storage: window.sessionStorage,
    workspaceId: 'workspace-a',
  });
  window.sessionStorage.setItem(
    'composer-session::composer-session/v1',
    JSON.stringify({
      schema: 'composer-session/v1',
      sessionId: 'legacy-a',
      updatedAt: NOW,
      merchantText: ACCOUNT_A_TEXT,
      task: {
        taskId: 'task-owned-by-a',
        workId: 'work-owned-by-a',
        packageId: 'package-owned-by-a',
      },
    })
  );

  const forA = readPersistedComposerSession({
    nowIso: NOW,
    storage: window.sessionStorage,
    workspaceId: 'workspace-a',
  });
  expect(forA.kind).toBe('restored');
  if (forA.kind !== 'restored') return;
  expect(forA.session.task?.taskId).toBe('task-owned-by-a');
  expect(forA.session.turns[0]).toMatchObject({
    kind: 'merchant',
    text: ACCOUNT_A_TEXT,
  });

  const forB = readPersistedComposerSession({
    nowIso: NOW,
    storage: window.sessionStorage,
    workspaceId: 'workspace-b',
  });
  expect(forB.kind).toBe('missing');
  expect(
    window.sessionStorage.getItem(composerSessionStorageKey('workspace-b'))
  ).toBeNull();
});

it('logout sweep leaves no product sessionStorage keys', () => {
  writePersistedComposerSession({
    nowIso: NOW,
    session: accountASession(),
    storage: window.sessionStorage,
    workspaceId: 'workspace-a',
  });
  window.sessionStorage.setItem(
    'meiye.creation-draft-intent.v1',
    ACCOUNT_A_TEXT
  );
  window.sessionStorage.setItem(
    'meiye.pending-creation-action.v1',
    '{"id":"a"}'
  );
  window.sessionStorage.setItem('meiye-correlation-id', 'corr-a');
  window.sessionStorage.setItem(
    'meiye:p1:model-selection:v1:copy.generate',
    '{"mode":"fixed","catalogModelId":"model-a"}'
  );
  window.sessionStorage.setItem('composer.catalog.return:ret-a', '{}');
  window.sessionStorage.setItem(
    'meiye-submission-attempt:v1:scope-a',
    '{"fingerprint":"f","idempotencyKey":"k"}'
  );
  window.sessionStorage.setItem('unrelated-tab-key', 'keep');

  const removed = clearProductSessionClientState(window.sessionStorage);

  expect(removed.length).toBeGreaterThan(0);
  expect(listProductSessionStorageKeys(window.sessionStorage)).toEqual([]);
  expect(window.sessionStorage.getItem('unrelated-tab-key')).toBe('keep');
  expect(
    window.sessionStorage.getItem(composerSessionStorageKey('workspace-a'))
  ).toBeNull();
});

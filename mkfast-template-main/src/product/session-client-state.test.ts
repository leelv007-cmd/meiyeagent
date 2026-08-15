/**
 * V31-83: product sessionStorage whitelist + auth-boundary sweep.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  clearForeignProductSessionClientState,
  clearProductSessionClientState,
  isProductSessionStorageKey,
  listProductSessionStorageKeys,
} from './session-client-state';
import { composerSessionStorageKey } from './composer/composer-session';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

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

function plantProductAndForeignKeys(storage: Storage) {
  storage.setItem('composer-session::composer-session/v1', '{"legacy":true}');
  storage.setItem(
    composerSessionStorageKey('workspace-a'),
    '{"workspaceId":"workspace-a"}'
  );
  storage.setItem(
    composerSessionStorageKey('workspace-b'),
    '{"workspaceId":"workspace-b"}'
  );
  storage.setItem('meiye.creation-draft-intent.v1', "A's draft");
  storage.setItem('meiye.pending-creation-action.v1', '{"id":"a"}');
  storage.setItem('meiye-correlation-id', 'corr-a');
  storage.setItem(
    'meiye:p1:model-selection:v1:copy.generate',
    '{"mode":"fixed","catalogModelId":"model-a"}'
  );
  storage.setItem('composer.catalog.return:ret-a', '{"tab":"templates"}');
  storage.setItem(
    'meiye-submission-attempt:v1:scope-a',
    '{"fingerprint":"f","idempotencyKey":"k"}'
  );
  storage.setItem('unrelated-tab-key', 'keep-me');
}

test('the whitelist names every product sessionStorage write family', () => {
  for (const key of [
    'composer-session::composer-session/v1',
    'composer-session::composer-session/v1::workspace-a',
    'meiye.creation-draft-intent.v1',
    'meiye.pending-creation-action.v1',
    'meiye-correlation-id',
    'meiye:p1:model-selection:v1:copy.generate',
    'composer.catalog.return:ret-a',
    'meiye-submission-attempt:v1:scope-a',
  ]) {
    assert.equal(isProductSessionStorageKey(key), true, key);
  }
  assert.equal(isProductSessionStorageKey('unrelated-tab-key'), false);
  assert.equal(isProductSessionStorageKey('theme'), false);
});

test('logout sweep removes every product key and leaves unrelated tab state', () => {
  const storage = new MemoryStorage();
  plantProductAndForeignKeys(storage);
  storage.setItem('e2e-canonical-handoff-url', 'http://localhost/e2e');

  const removed = clearProductSessionClientState(storage);

  assert.deepEqual(removed.sort(), [
    'composer-session::composer-session/v1',
    'composer-session::composer-session/v1::workspace-a',
    'composer-session::composer-session/v1::workspace-b',
    'composer.catalog.return:ret-a',
    'meiye-correlation-id',
    'meiye-submission-attempt:v1:scope-a',
    'meiye.creation-draft-intent.v1',
    'meiye.pending-creation-action.v1',
    'meiye:p1:model-selection:v1:copy.generate',
  ]);
  assert.equal(storage.getItem('unrelated-tab-key'), 'keep-me');
  assert.equal(
    storage.getItem('e2e-canonical-handoff-url'),
    'http://localhost/e2e'
  );
  assert.deepEqual(listProductSessionStorageKeys(storage), []);
});

test('login defensive sweep drops foreign-owner leftovers and keeps the current workspace handle', () => {
  const storage = new MemoryStorage();
  plantProductAndForeignKeys(storage);

  const removed = clearForeignProductSessionClientState(storage, 'workspace-b');

  assert.ok(removed.includes('composer-session::composer-session/v1'));
  assert.ok(removed.includes(composerSessionStorageKey('workspace-a')));
  assert.ok(removed.includes('meiye.creation-draft-intent.v1'));
  assert.equal(
    storage.getItem(composerSessionStorageKey('workspace-b')),
    '{"workspaceId":"workspace-b"}'
  );
  assert.equal(storage.getItem('unrelated-tab-key'), 'keep-me');
  assert.equal(
    listProductSessionStorageKeys(storage).includes(
      composerSessionStorageKey('workspace-a')
    ),
    false
  );
});

test('auth-boundary helpers are wired into every product sign-out and sign-in success path', () => {
  const files = [
    '../components/shared/user-button.tsx',
    '../components/shared/user-button-mobile.tsx',
    '../components/layout/sidebar-user.tsx',
    '../components/admin/shell/admin-shell-user.tsx',
    '../components/auth/login-form.tsx',
    '../components/auth/social-login-button.tsx',
  ].map((relative) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
  );
  for (const source of files) {
    assert.match(source, /clearProductSessionClientStateOnAuthBoundary/u);
  }
});

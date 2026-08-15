/**
 * V31-83: product sessionStorage inventory and auth-boundary sweep.
 *
 * Write sites (sessionStorage.setItem / getItem in src/):
 * - composer-session::composer-session/v1[::workspaceId]
 * - meiye.creation-draft-intent.v1
 * - meiye.pending-creation-action.v1
 * - meiye-correlation-id
 * - meiye:p1:model-selection:v1:<operation>
 * - composer.catalog.return:<id>
 * - meiye-submission-attempt:v1:<scope>
 *
 * Unrelated tab keys (theme, e2e helpers) stay. Logout clears the whole
 * product family. Login drops foreign-owner leftovers and every unscoped
 * product key.
 */

import { composerSessionStorageKey } from './composer/composer-session';

const PRODUCT_SESSION_STORAGE_EXACT_KEYS = new Set(['meiye-correlation-id']);

const PRODUCT_SESSION_STORAGE_PREFIXES = [
  'composer-session::',
  'meiye.creation-draft-intent.',
  'meiye.pending-creation-action.',
  'meiye:p1:model-selection:',
  'composer.catalog.return:',
  'meiye-submission-attempt:',
] as const;

export function isProductSessionStorageKey(key: string): boolean {
  if (PRODUCT_SESSION_STORAGE_EXACT_KEYS.has(key)) return true;
  return PRODUCT_SESSION_STORAGE_PREFIXES.some((prefix) =>
    key.startsWith(prefix)
  );
}

export function listProductSessionStorageKeys(storage: {
  length: number;
  key(index: number): string | null;
}): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isProductSessionStorageKey(key)) keys.push(key);
  }
  return keys;
}

export function clearProductSessionClientState(storage: {
  length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}): string[] {
  const removed = listProductSessionStorageKeys(storage);
  for (const key of removed) storage.removeItem(key);
  return removed;
}

export function clearForeignProductSessionClientState(
  storage: {
    length: number;
    key(index: number): string | null;
    removeItem(key: string): void;
  },
  workspaceId: string
): string[] {
  const keep = composerSessionStorageKey(workspaceId);
  const removed = listProductSessionStorageKeys(storage).filter(
    (key) => key !== keep
  );
  for (const key of removed) storage.removeItem(key);
  return removed;
}

/** Composer mount defense: drop leftover handles, keep this workspace's. */
export function discardForeignComposerSessionHandles(
  storage: {
    length: number;
    key(index: number): string | null;
    removeItem(key: string): void;
  },
  workspaceId: string
): string[] {
  const keep = composerSessionStorageKey(workspaceId);
  const removed = listProductSessionStorageKeys(storage).filter(
    (key) => key.startsWith('composer-session::') && key !== keep
  );
  for (const key of removed) storage.removeItem(key);
  return removed;
}

export function clearProductSessionClientStateOnAuthBoundary(
  storage: Storage | undefined = typeof window === 'undefined'
    ? undefined
    : window.sessionStorage
): string[] {
  if (!storage) return [];
  return clearProductSessionClientState(storage);
}

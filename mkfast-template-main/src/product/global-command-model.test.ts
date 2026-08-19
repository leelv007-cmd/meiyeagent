import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CreationCatalogEntry } from './creation-catalog-model';
import { BUSINESS_NAVIGATION } from '@/lib/uiux/navigation';
import {
  createPendingCreationAction,
  isGlobalCommandShortcut,
  parsePendingCreationAction,
  projectGlobalNavigation,
  resolveGlobalCommandHref,
} from './global-command-model';

const assetEntry: CreationCatalogEntry = {
  available: true,
  detail: 'image Asset',
  id: 'asset-a',
  kind: 'reference',
  key: 'asset:asset-a',
  label: '主视觉',
  owner: 'user',
  reference: { id: 'asset-a', kind: 'asset' },
  tags: [],
};

describe('global command model', () => {
  it('accepts both Meta+K and Ctrl+K without depending on the focus target', () => {
    assert.equal(
      isGlobalCommandShortcut({
        ctrlKey: false,
        key: 'K',
        metaKey: true,
        repeat: false,
      }),
      true
    );
    assert.equal(
      isGlobalCommandShortcut({
        ctrlKey: true,
        key: 'k',
        metaKey: false,
        repeat: false,
      }),
      true
    );
    assert.equal(
      isGlobalCommandShortcut({
        ctrlKey: true,
        key: 'k',
        metaKey: false,
        repeat: true,
      }),
      false
    );
  });

  it('reuses business navigation and does not produce task/session/job or search/workspace', () => {
    const entries = projectGlobalNavigation();

    assert.deepEqual(
      entries.map((entry) => entry.href),
      [
        '/dashboard',
        '/dashboard/works',
        '/dashboard/assets',
        '/dashboard/store',
        '/dashboard/memory',
      ]
    );
    assert.deepEqual(
      entries.map((entry) => `${entry.kind}:${entry.id}`),
      BUSINESS_NAVIGATION.map((entry) => `page:${entry.id}`)
    );
    assert.ok(entries.every((entry) => entry.actionLabel === '打开'));
    assert.equal(
      entries.some((entry) =>
        /\/dashboard\/(search|workspace|sessions|jobs|tasks)/u.test(entry.href)
      ),
      false
    );
  });

  it('resolves dead object ids as unavailable, not default Composer', () => {
    for (const href of [
      '/dashboard?contentId=legacy-content',
      '/dashboard/content?contentId=legacy-content',
      '/dashboard?handoffId=legacy-handoff',
      '/dashboard/content?handoffId=legacy-handoff',
    ]) {
      const destination = resolveGlobalCommandHref(href);
      assert.equal(destination.consumer, 'historical_unavailable');
      assert.notEqual(destination.consumer, 'composer_home');
      assert.notEqual(destination.href, '/dashboard');
    }
  });

  it('creates a stable one-shot pending action without a Work or Job command', () => {
    const first = createPendingCreationAction(assetEntry);
    const second = createPendingCreationAction(assetEntry);

    assert.deepEqual(first, second);
    assert.equal(first.key, 'asset:asset-a');
    assert.deepEqual(first.reference, { id: 'asset-a', kind: 'asset' });
    assert.equal('command' in first, false);
    assert.deepEqual(parsePendingCreationAction(JSON.stringify(first)), first);
  });

  it('rejects malformed, executable, or retired direct-tool pending payloads', () => {
    assert.equal(parsePendingCreationAction('{broken'), undefined);
    assert.equal(
      parsePendingCreationAction(
        JSON.stringify({
          ...createPendingCreationAction(assetEntry),
          command: { type: 'prepare_creative_job' },
        })
      ),
      undefined
    );
    assert.equal(
      parsePendingCreationAction(
        JSON.stringify({
          detail: 'Generate copy',
          id: 'copy.generate',
          key: 'tool:copy.generate',
          kind: 'tool',
          label: 'Copy generation',
          operation: 'copy.generate',
          version: 1,
        })
      ),
      undefined
    );
  });
});

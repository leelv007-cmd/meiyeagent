import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { P1RequestError } from '@/p1/client';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  assetRegistrationIdempotencyKey,
  classifyAssetRegistrationFailure,
  findWorkspaceAssetByObjectKey,
  presentAssetRegistrationFailure,
  registerWorkspaceAsset,
  workspaceAssetIdForContent,
} = await import('./asset-registration');

const CONTENT_HASH = 'ab'.repeat(32);
const OBJECT_KEY = `workspace-a/assets/user-a/${CONTENT_HASH}.png`;

function addAssetFields(
  overrides: Record<string, unknown> = {}
): Parameters<typeof assetRegistrationIdempotencyKey>[1] {
  return {
    category: 'other',
    consentScope: 'internal_only',
    containsPerson: false,
    containsSensitiveData: false,
    id: 'asset-ignored',
    mediaType: 'image',
    minorStatus: 'none',
    objectKey: OBJECT_KEY,
    rightsOwner: '暮色美甲',
    sourceType: 'real',
    tags: [],
    ...overrides,
  };
}

test('workspace asset id is derived from the content hash, not a random uuid', () => {
  assert.equal(
    workspaceAssetIdForContent(CONTENT_HASH),
    `asset-${CONTENT_HASH.slice(0, 32)}`
  );
});

test('same content and same facts share one idempotency key even when ids differ', async () => {
  const first = await assetRegistrationIdempotencyKey(
    CONTENT_HASH,
    addAssetFields({ id: 'asset-from-library' })
  );
  const second = await assetRegistrationIdempotencyKey(
    CONTENT_HASH,
    addAssetFields({ id: 'asset-from-composer' })
  );
  assert.equal(first, second);
  assert.match(
    first,
    new RegExp(`^asset-register:${CONTENT_HASH}:[a-f0-9]{64}$`)
  );
});

test('changed registration facts mint a different idempotency key', async () => {
  const original = await assetRegistrationIdempotencyKey(
    CONTENT_HASH,
    addAssetFields({ category: 'other' })
  );
  const changed = await assetRegistrationIdempotencyKey(
    CONTENT_HASH,
    addAssetFields({ category: 'customer_case', rightsOwner: '顾客本人' })
  );
  assert.notEqual(original, changed);
});

test('finds the workspace asset that already owns an objectKey', () => {
  const found = findWorkspaceAssetByObjectKey(
    [
      { id: 'asset-other', objectKey: 'workspace-a/assets/user-a/other.png' },
      { id: 'asset-from-library', objectKey: OBJECT_KEY },
    ],
    OBJECT_KEY
  );
  assert.equal(found?.id, 'asset-from-library');
});

test('classifies IDEMPOTENCY_CONFLICT as already registered and not retryable', () => {
  const error = new P1RequestError(
    'conflict',
    'IDEMPOTENCY_CONFLICT',
    undefined,
    409
  );
  assert.equal(classifyAssetRegistrationFailure(error), 'already_registered');
  const presented = presentAssetRegistrationFailure(error, 'composer');
  assert.equal(presented.retryable, false);
  assert.equal(presented.outlet, 'library_picker');
  assert.match(presented.message, /素材库|library/i);
  assert.doesNotMatch(presented.message, /请重试|try again/i);
  const library = presentAssetRegistrationFailure(error, 'library');
  assert.equal(library.outlet, 'asset_detail');
  assert.doesNotMatch(library.message, /请重试|try again/i);
});

test('classifies network and 5xx failures as retryable', () => {
  assert.equal(
    classifyAssetRegistrationFailure(new Error('Failed to fetch')),
    'retryable'
  );
  assert.equal(
    classifyAssetRegistrationFailure(
      new P1RequestError('unavailable', undefined, undefined, 503)
    ),
    'retryable'
  );
});

test('classifies other 4xx failures as not retryable', () => {
  assert.equal(
    classifyAssetRegistrationFailure(
      new P1RequestError('forbidden', 'COMMAND_ACTOR_FORBIDDEN', undefined, 403)
    ),
    'not_retryable'
  );
});

test('registerWorkspaceAsset uses the shared key and the existing objectKey id', async () => {
  const keys: string[] = [];
  const registered = await registerWorkspaceAsset({
    contentHash: CONTENT_HASH,
    execute: async (command, idempotencyKey) => {
      assert.equal(command.type, 'add_asset');
      if (command.type === 'add_asset') {
        assert.equal(command.asset.objectKey, OBJECT_KEY);
        assert.equal(command.asset.category, 'customer_case');
      }
      if (idempotencyKey) keys.push(idempotencyKey);
      return {
        output: {},
        state: {
          assets: [
            {
              id: 'asset-from-library',
              objectKey: OBJECT_KEY,
            },
          ],
        },
      } as never;
    },
    facts: {
      category: 'customer_case',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      mediaType: 'image',
      minorStatus: 'none',
      rightsOwner: '顾客本人',
      sourceType: 'real',
      tags: ['case.png'],
    },
    objectKey: OBJECT_KEY,
    preferredAssetId: 'asset-from-composer',
  });
  assert.equal(registered.assetId, 'asset-from-library');
  assert.equal(keys.length, 1);
  assert.equal(
    keys[0],
    await assetRegistrationIdempotencyKey(
      CONTENT_HASH,
      addAssetFields({
        category: 'customer_case',
        id: 'asset-from-composer',
        rightsOwner: '顾客本人',
        tags: ['case.png'],
      })
    )
  );
});

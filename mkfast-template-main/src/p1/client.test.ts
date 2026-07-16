import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOperationsCommandIntentRegistry,
  P1RequestError,
  p1ErrorCode,
} from './client';

test('keeps a stable P1 error code without exposing the server message', () => {
  const error = new P1RequestError(
    'The P1 command could not be processed.',
    'REFERENCE_ASSET_UNRESOLVED'
  );

  assert.equal(p1ErrorCode(error), 'REFERENCE_ASSET_UNRESOLVED');
  assert.equal(
    p1ErrorCode(new Error('Reference assets need attention')),
    undefined
  );
});

test('retries one export or reuse intent with its original idempotency key', async () => {
  const attempts: Array<{ action: string; idempotencyKey: string }> = [];
  const succeedingActions = new Set<string>();
  let keySequence = 0;
  const registry = createOperationsCommandIntentRegistry(
    () => `intent-${++keySequence}`,
    async (action, _payload, idempotencyKey) => {
      attempts.push({ action, idempotencyKey });
      if (!succeedingActions.has(action)) {
        throw new Error('simulated response loss');
      }
      return { action };
    }
  );

  await assert.rejects(
    registry.execute('export_content_package', {
      packageId: 'package-a',
      platform: 'xiaohongshu',
    }),
    /simulated response loss/
  );
  await assert.rejects(
    registry.execute('reuse_content_package', {
      sourcePackageId: 'package-a',
    }),
    /simulated response loss/
  );

  succeedingActions.add('export_content_package');
  await registry.execute('export_content_package', {
    platform: 'xiaohongshu',
    packageId: 'package-a',
  });
  succeedingActions.add('reuse_content_package');
  await registry.execute('reuse_content_package', {
    sourcePackageId: 'package-a',
  });

  assert.deepEqual(attempts.slice(0, 4), [
    { action: 'export_content_package', idempotencyKey: 'intent-1' },
    { action: 'reuse_content_package', idempotencyKey: 'intent-2' },
    { action: 'export_content_package', idempotencyKey: 'intent-1' },
    { action: 'reuse_content_package', idempotencyKey: 'intent-2' },
  ]);

  await registry.execute('export_content_package', {
    packageId: 'package-a',
    platform: 'xiaohongshu',
  });
  assert.deepEqual(attempts.at(-1), {
    action: 'export_content_package',
    idempotencyKey: 'intent-3',
  });
});

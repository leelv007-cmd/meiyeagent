import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandP1,
  createOperationsCommandIntentRegistry,
  P1_COMMAND_TIMEOUT_CODE,
  P1RequestError,
  p1ErrorCode,
} from './client';

/** A server that accepts the request and then never answers. */
function stubNeverAnsweringFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      signal.addEventListener('abort', () => reject(signal.reason));
    })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

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

test('a command that never answers fails on its own deadline (#240)', async () => {
  const restore = stubNeverAnsweringFetch();
  try {
    const startedAt = Date.now();
    await assert.rejects(
      commandP1(
        'product-billing',
        { action: 'quote', payload: {} },
        'composer-quote:stuck',
        { timeoutMs: 40 }
      ),
      (error: unknown) => {
        assert.equal(error instanceof P1RequestError, true);
        assert.equal(p1ErrorCode(error), P1_COMMAND_TIMEOUT_CODE);
        assert.deepEqual((error as P1RequestError).details, { timeoutMs: 40 });
        return true;
      }
    );
    // The point of the bound: it settles on the deadline, not on the fetch.
    assert.equal(Date.now() - startedAt < 5_000, true);
  } finally {
    restore();
  }
});

test('caller cancellation stays a cancellation, not a command failure', async () => {
  const restore = stubNeverAnsweringFetch();
  const controller = new AbortController();
  try {
    const pending = commandP1(
      'product-billing',
      { action: 'quote', payload: {} },
      'composer-quote:cancelled',
      { signal: controller.signal, timeoutMs: 10_000 }
    );
    controller.abort();
    await assert.rejects(pending, (error: unknown) => {
      // TanStack Query cancels a superseded quote key; that must not surface as
      // a timed-out command the merchant is asked to retry.
      assert.equal(p1ErrorCode(error), undefined);
      assert.equal((error as DOMException).name, 'AbortError');
      return true;
    });
  } finally {
    restore();
  }
});

test('a command without a deadline keeps its unbounded legacy behaviour', async () => {
  const seen: Array<AbortSignal | null | undefined> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    seen.push(init?.signal);
    return Promise.resolve(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
  }) as typeof fetch;
  try {
    assert.deepEqual(
      await commandP1('product-billing', { action: 'quote', payload: {} }),
      { ok: true }
    );
    assert.deepEqual(seen, [undefined]);
  } finally {
    globalThis.fetch = original;
  }
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

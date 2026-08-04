import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedQueryP1,
  commandP1,
  createOperationsCommandIntentRegistry,
  P1_COMMAND_TIMEOUT_CODE,
  P1_QUERY_TIMEOUT_CODE,
  P1RequestError,
  operationsQuery,
  p1ErrorCode,
  queryP1,
  readP1Envelope,
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

/**
 * A server that answers with headers and then stalls its body — the shape a
 * round-trip-only deadline misses. Mirrors real fetch, whose body read rejects
 * with the abort reason once the request signal fires.
 */
function stubHeadersThenStalledBody() {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    const signal = init?.signal;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          if (!signal) return;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    } as unknown as Response);
  }) as typeof fetch;
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

test('a bounded query that never answers fails on its own deadline (#320)', async () => {
  const restore = stubNeverAnsweringFetch();
  try {
    const startedAt = Date.now();
    await assert.rejects(
      boundedQueryP1(
        'sensitive-words',
        { action: 'check_bar', payload: { text: '温和护理' } },
        { timeoutMs: 40 }
      ),
      (error: unknown) => {
        assert.equal(error instanceof P1RequestError, true);
        assert.equal(p1ErrorCode(error), P1_QUERY_TIMEOUT_CODE);
        assert.deepEqual((error as P1RequestError).details, { timeoutMs: 40 });
        return true;
      }
    );
    assert.equal(Date.now() - startedAt < 5_000, true);
  } finally {
    restore();
  }
});

test('a bounded query deadline also covers a stalled response body (#320)', async () => {
  const restore = stubHeadersThenStalledBody();
  try {
    await assert.rejects(
      boundedQueryP1(
        'sensitive-words',
        { action: 'check_bar', payload: { text: '温和护理' } },
        { timeoutMs: 40 }
      ),
      (error: unknown) => {
        assert.equal(p1ErrorCode(error), P1_QUERY_TIMEOUT_CODE);
        assert.deepEqual((error as P1RequestError).details, { timeoutMs: 40 });
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('the deadline covers a stalled body, not just the response headers', async () => {
  // Negative control for the round-trip-only deadline: with the timer cleared
  // when `telemetryFetch` resolves, this call would hang on `response.json()`
  // forever and the Composer would sit in `requesting` with no way out.
  const restore = stubHeadersThenStalledBody();
  try {
    const startedAt = Date.now();
    await assert.rejects(
      commandP1(
        'product-billing',
        { action: 'quote', payload: {} },
        'composer-quote:stalled-body',
        { timeoutMs: 40 }
      ),
      (error: unknown) => {
        assert.equal(p1ErrorCode(error), P1_COMMAND_TIMEOUT_CODE);
        assert.deepEqual((error as P1RequestError).details, { timeoutMs: 40 });
        return true;
      }
    );
    assert.equal(Date.now() - startedAt < 5_000, true);
  } finally {
    restore();
  }
});

test('the deadline never reaches for AbortSignal.any / .timeout', async () => {
  // Merchants open this from in-app WebViews whose engines predate both
  // statics; reaching for them would throw on every command instead of
  // bounding it, which is strictly worse than the hang this ticket removes.
  const restoreFetch = stubNeverAnsweringFetch();
  const staticAny = AbortSignal.any;
  const staticTimeout = AbortSignal.timeout;
  Reflect.deleteProperty(AbortSignal, 'any');
  Reflect.deleteProperty(AbortSignal, 'timeout');
  try {
    assert.equal('any' in AbortSignal, false);
    assert.equal('timeout' in AbortSignal, false);
    await assert.rejects(
      commandP1(
        'product-billing',
        { action: 'quote', payload: {} },
        'composer-quote:old-webview',
        { signal: new AbortController().signal, timeoutMs: 40 }
      ),
      (error: unknown) => {
        assert.equal(p1ErrorCode(error), P1_COMMAND_TIMEOUT_CODE);
        return true;
      }
    );
  } finally {
    Object.defineProperty(AbortSignal, 'any', {
      configurable: true,
      value: staticAny,
      writable: true,
    });
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: staticTimeout,
      writable: true,
    });
    restoreFetch();
  }
});

test('a caller that cancels with its own TimeoutError is not relabelled ours', async () => {
  // Negative control for name-based attribution: a caller watchdog aborting
  // with `DOMException('…','TimeoutError')` is indistinguishable from our
  // deadline by exception name. Ownership has to come from our own timer, or
  // the merchant gets told the server was slow and offered a pointless retry.
  const restore = stubNeverAnsweringFetch();
  const controller = new AbortController();
  try {
    const pending = commandP1(
      'product-billing',
      { action: 'quote', payload: {} },
      'composer-quote:caller-timeout',
      { signal: controller.signal, timeoutMs: 10_000 }
    );
    controller.abort(
      new DOMException('Caller gave up on its own.', 'TimeoutError')
    );
    await assert.rejects(pending, (error: unknown) => {
      assert.notEqual(p1ErrorCode(error), P1_COMMAND_TIMEOUT_CODE);
      assert.equal(p1ErrorCode(error), undefined);
      assert.equal(error instanceof P1RequestError, false);
      assert.equal((error as DOMException).name, 'TimeoutError');
      assert.equal(
        (error as DOMException).message,
        'Caller gave up on its own.'
      );
      return true;
    });
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
      new Response(
        JSON.stringify({
          data: { ok: true },
          meta: { correlationId: 'corr-test' },
        }),
        { status: 200 }
      )
    );
  }) as typeof fetch;
  try {
    assert.deepEqual(
      await commandP1('product-billing', {
        action: 'unregistered',
        payload: {},
      }),
      { ok: true }
    );
    assert.deepEqual(seen, [undefined]);
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects an API success envelope without correlation metadata', async () => {
  await assert.rejects(
    readP1Envelope(Response.json({ data: { ok: true } })),
    (error: unknown) =>
      error instanceof P1RequestError &&
      error.message.includes('Response envelope was invalid')
  );
});

test('validates quote responses against the public billing wire schema', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({
        data: {
          billingMode: 'per_request',
          catalogModelId: 'catalog-model-1',
          formula: { expression: 'per_request * 1.5', unitRate: 1.5 },
          lifecycleStatus: 'quoted',
          quoteId: 'quote-1',
          quotePolicyRevision: 'quote.policy@1',
          revision: 'rev-1',
          routeSnapshotRef: 'server-only-route',
        },
        meta: { correlationId: 'corr-quote' },
      })
    )) as typeof fetch;
  try {
    await assert.rejects(
      commandP1('product-billing', { action: 'quote', payload: {} }),
      (error: unknown) =>
        error instanceof P1RequestError &&
        error.message.includes('Response envelope was invalid')
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('projects validated content package status labels on the Web boundary', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({
        data: [
          {
            compliance: {
              aigcLabelEnabled: false,
              watermarkEnabled: false,
            },
            createdAt: '2026-08-05T00:00:00.000Z',
            exportReceipts: [],
            generated: { assetIds: [], childRuns: [] },
            id: 'package-1',
            kind: 'image_text',
            lineage: {},
            rights: { state: 'authorized' },
            source: { assetIds: [] },
            status: 'review_ready',
            updatedAt: '2026-08-05T00:00:00.000Z',
            variants: [],
            versions: [],
            workspaceId: 'workspace-1',
          },
        ],
        meta: { correlationId: 'corr-packages' },
      })
    )) as typeof fetch;
  try {
    const packages =
      await operationsQuery<
        Array<{ statusGroup: string; statusLabel: string }>
      >('content_packages');
    assert.equal(packages[0]?.statusGroup, 'usable');
    assert.equal(packages[0]?.statusLabel, '可使用');
  } finally {
    globalThis.fetch = original;
  }
});

test('validates credit detail responses against the merchant-safe schema', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({
        data: {
          batches: [],
          billing: {
            creditsThisPeriod: 1_300,
            interval: 'monthly',
            periodEndsAt: '2026-09-01T00:00:00.000Z',
            providerSubscriptionId: 'server-only-subscription',
            tier: 'growth',
          },
          transactions: [],
        },
        meta: { correlationId: 'corr-credit-detail' },
      })
    )) as typeof fetch;
  try {
    await assert.rejects(
      queryP1('entitlements', { action: 'credit_detail', payload: {} }),
      (error: unknown) =>
        error instanceof P1RequestError &&
        error.message.includes('Response envelope was invalid')
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('retries each operations intent with its original idempotency key', async () => {
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
    registry.execute('set_creation_labels', {
      aigcLabelEnabled: true,
      brandWatermarkEnabled: false,
      workId: 'work-a',
    }),
    /simulated response loss/
  );
  await assert.rejects(
    registry.execute('create_work_from_content_package', {
      height: 1350,
      sourcePackageId: 'package-a',
      sourceVersionId: 'version-a',
      width: 1080,
    }),
    /simulated response loss/
  );

  succeedingActions.add('set_creation_labels');
  await registry.execute('set_creation_labels', {
    aigcLabelEnabled: true,
    brandWatermarkEnabled: false,
    workId: 'work-a',
  });
  succeedingActions.add('create_work_from_content_package');
  await registry.execute('create_work_from_content_package', {
    height: 1350,
    sourcePackageId: 'package-a',
    sourceVersionId: 'version-a',
    width: 1080,
  });

  assert.deepEqual(attempts.slice(0, 4), [
    { action: 'set_creation_labels', idempotencyKey: 'intent-1' },
    {
      action: 'create_work_from_content_package',
      idempotencyKey: 'intent-2',
    },
    { action: 'set_creation_labels', idempotencyKey: 'intent-1' },
    {
      action: 'create_work_from_content_package',
      idempotencyKey: 'intent-2',
    },
  ]);

  await registry.execute('set_creation_labels', {
    aigcLabelEnabled: true,
    brandWatermarkEnabled: false,
    workId: 'work-a',
  });
  assert.deepEqual(attempts.at(-1), {
    action: 'set_creation_labels',
    idempotencyKey: 'intent-3',
  });
});

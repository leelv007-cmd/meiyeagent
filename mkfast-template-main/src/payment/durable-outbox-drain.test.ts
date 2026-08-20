import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDrainDurableOutboxOnWebSurface } from './durable-outbox-drain';

test('ordinary Web fetch does not drain durable outbox in production', () => {
  assert.deepEqual(
    shouldDrainDurableOutboxOnWebSurface({
      appEnv: 'production',
      surface: 'fetch',
    }),
    { drain: false, reason: 'ordinary-request-must-not-drain' }
  );
  assert.deepEqual(
    shouldDrainDurableOutboxOnWebSurface({
      surface: 'fetch',
    }),
    { drain: false, reason: 'ordinary-request-must-not-drain' }
  );
});

test('scheduled Web trigger always drains durable outbox', () => {
  assert.deepEqual(
    shouldDrainDurableOutboxOnWebSurface({
      appEnv: 'production',
      surface: 'scheduled',
    }),
    { drain: true, reason: 'web-scheduled-owner' }
  );
});

test('preview/dev fetch drains at most once per throttle window', () => {
  const first = shouldDrainDurableOutboxOnWebSurface({
    appEnv: 'preview',
    lastDrainAtMs: 0,
    minIntervalMs: 30_000,
    nowMs: 50_000,
    surface: 'fetch',
  });
  assert.equal(first.drain, true);

  const throttled = shouldDrainDurableOutboxOnWebSurface({
    appEnv: 'development',
    lastDrainAtMs: 40_000,
    minIntervalMs: 30_000,
    nowMs: 50_000,
    surface: 'fetch',
  });
  assert.deepEqual(throttled, {
    drain: false,
    reason: 'preview-dev-throttled-fallback',
  });

  const due = shouldDrainDurableOutboxOnWebSurface({
    appEnv: 'e2e',
    lastDrainAtMs: 10_000,
    minIntervalMs: 30_000,
    nowMs: 50_000,
    surface: 'fetch',
  });
  assert.equal(due.drain, true);
});

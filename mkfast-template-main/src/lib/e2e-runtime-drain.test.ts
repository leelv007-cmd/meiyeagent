import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForE2ERuntimeDrain } from './e2e-runtime-drain';

test('E2E runtime drain waits for pending generation jobs to reach zero', async () => {
  const counts = [2, 1, 0];
  let waits = 0;
  let currentTime = 0;
  await waitForE2ERuntimeDrain({
    now: () => currentTime,
    pendingCount: async () => counts.shift() ?? 0,
    pollIntervalMs: 10,
    quiescenceMs: 20,
    wait: async (milliseconds) => {
      waits += 1;
      currentTime += milliseconds;
    },
  });
  assert.equal(waits, 4);
});

test('E2E runtime drain resets its quiet window when late work appears', async () => {
  const counts = [0, 1, 0, 0, 0];
  let currentTime = 0;
  await waitForE2ERuntimeDrain({
    now: () => currentTime,
    pendingCount: async () => counts.shift() ?? 0,
    pollIntervalMs: 10,
    quiescenceMs: 20,
    wait: async (milliseconds) => {
      currentTime += milliseconds;
    },
  });
  assert.equal(currentTime, 40);
});

test('E2E runtime drain fails closed at its deadline', async () => {
  let currentTime = 0;
  await assert.rejects(
    waitForE2ERuntimeDrain({
      now: () => currentTime,
      pendingCount: async () => 1,
      pollIntervalMs: 10,
      quiescenceMs: 20,
      timeoutMs: 20,
      wait: async (milliseconds) => {
        currentTime += milliseconds;
      },
    }),
    /Timed out waiting for E2E runtime settlement/u
  );
});

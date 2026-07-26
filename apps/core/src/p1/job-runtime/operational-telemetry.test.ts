import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryOperationalTelemetryStore,
  resolveWorkerId,
  WorkerOperationalTelemetry,
} from './operational-telemetry.js';

test('worker id falls back when optional configuration is blank', () => {
  assert.equal(resolveWorkerId(undefined, 'host:123'), 'host:123');
  assert.equal(resolveWorkerId('', 'host:123'), 'host:123');
  assert.equal(resolveWorkerId('   ', 'host:123'), 'host:123');
  assert.equal(resolveWorkerId(' worker-a ', 'host:123'), 'worker-a');
});

test('worker telemetry records windowed process CPU and live handler concurrency', async () => {
  const store = new MemoryOperationalTelemetryStore();
  let now = new Date('2026-07-11T01:00:00.000Z');
  let monotonicNow = 0;
  let cpuUserMicros = 100;
  let cpuSystemMicros = 50;
  let activeJobs = 0;
  const telemetry = new WorkerOperationalTelemetry(store, {
    activeJobs: () => activeJobs,
    clock: () => new Date(now),
    measureEventLoopLag: async () => 7,
    monotonicNow: () => monotonicNow,
    processResources: () => ({
      cpuSystemMicros,
      cpuUserMicros,
      heapUsedBytes: 2048,
      rssBytes: 4096,
    }),
    workerId: 'worker-memory',
  });
  now = new Date('2026-07-11T01:00:05.000Z');
  monotonicNow = 5_000;
  cpuUserMicros += 150_000;
  cpuSystemMicros += 100_000;
  activeJobs = 3;

  await telemetry.sampleNow();

  assert.deepEqual(await store.latestWorkerSample(), {
    activeJobs: 3,
    cpuUtilizationPercent: 5,
    eventLoopLagMs: 7,
    heapUsedBytes: 2048,
    rssBytes: 4096,
    sampledAt: '2026-07-11T01:00:05.000Z',
    windowStartedAt: '2026-07-11T01:00:00.000Z',
    workerId: 'worker-memory',
  });
});

test('runner aggregation preserves actual outcomes and recovered failures', async () => {
  const store = new MemoryOperationalTelemetryStore();
  await store.recordRunnerEvent({
    durationMs: 20,
    kind: 'model.media-generation',
    occurredAt: '2026-07-11T01:05:00.000Z',
    outcome: 'deferred',
    recovered: false,
    workerId: 'worker-memory',
  });
  await store.recordRunnerEvent({
    durationMs: 30,
    kind: 'model.media-generation',
    occurredAt: '2026-07-11T01:06:00.000Z',
    outcome: 'threw',
    recovered: true,
    workerId: 'worker-memory',
  });

  const aggregate = await store.aggregateRunnerEvents(
    '2026-07-11T01:00:00.000Z',
    '2026-07-11T01:30:00.000Z'
  );

  assert.equal(aggregate.outcomeCounts.deferred, 1);
  assert.equal(aggregate.outcomeCounts.threw, 1);
  assert.equal(aggregate.recoveredFailureCount, 1);
  assert.deepEqual(aggregate.failuresByKind, {
    'model.media-generation': 1,
  });
  assert.equal(aggregate.mediaAverageDurationMs, 25);
});

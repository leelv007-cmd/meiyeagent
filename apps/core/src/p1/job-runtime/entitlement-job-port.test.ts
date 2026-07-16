import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { DurableJobInput, RecurringJobInput } from './job-contracts.js';
import { EntitlementAwareJobPort } from './entitlement-job-port.js';

class RecordedRuntime {
  enqueued?: DurableJobInput;
  transactional?: DurableJobInput;
  recurring?: RecurringJobInput;

  async start() {}

  async enqueue(input: DurableJobInput) {
    this.enqueued = input;
  }

  async enqueueInTransaction(input: DurableJobInput, _client: PoolClient) {
    this.transactional = input;
  }

  async cancel() {}

  async getMetrics() {
    return {
      activeCount: 0,
      attemptCount: 0,
      averageClaimLatencyMs: null,
      capturedAt: '2026-07-11T00:00:00.000Z',
      deadLetterDepth: 0,
      deferredCount: 0,
      failedCount: 0,
      leaseExpiryCount: 0,
      maxClaimLatencyMs: null,
      nextLeaseExpiryAt: null,
      oldestRunnableAgeMs: null,
      queueDepth: 0,
      recoveryCount: 0,
    };
  }

  async scheduleRecurring(input: RecurringJobInput) {
    this.recurring = input;
  }

  async unscheduleRecurring() {}
}

test('entitlement-aware jobs carry queue priority and workspace concurrency into every durable submission', async () => {
  const runtime = new RecordedRuntime();
  const jobs = new EntitlementAwareJobPort(runtime, {
    async resolve(workspaceId) {
      assert.equal(workspaceId, 'workspace-pro');
      return {
        addOns: [],
        allowance: { audio: 0, copy: 300, image: 120, video: 60 },
        autoTopUp: {
          enabled: false,
          monthlyCapMicros: 0,
          spentThisMonthMicros: 0,
        },
        concurrencyLimit: 8,
        queuePriority: 10,
        revision: 'product-entitlement:pro:event-1',
        supportLabel: 'priority',
        tier: 'pro',
      };
    },
  });
  const input = {
    jobId: 'job-1',
    kind: 'product.tracer',
    payload: { source: 'test' },
    workspaceId: 'workspace-pro',
  };

  await jobs.enqueue(input);
  await jobs.enqueueInTransaction(input, {} as PoolClient);
  await jobs.scheduleRecurring({
    cron: '0 9 * * 1',
    kind: 'operations.trigger',
    payload: { triggerKind: 'weekly_summary' },
    scheduleId: 'weekly',
    timezone: 'Asia/Shanghai',
    workspaceId: 'workspace-pro',
  });

  const expected = { queuePriority: 10, workspaceConcurrencyLimit: 8 };
  assert.deepEqual(runtime.enqueued?.scheduling, expected);
  assert.deepEqual(runtime.transactional?.scheduling, expected);
  assert.deepEqual(runtime.recurring?.scheduling, expected);
});

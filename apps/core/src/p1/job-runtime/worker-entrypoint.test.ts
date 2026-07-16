import assert from 'node:assert/strict';
import { it } from 'node:test';
import type {
  DurableJobEnvelope,
  JobRuntimeHandler,
  JobRuntimeHandlerContext,
} from './pg-boss-job-port.js';
import { P1JobWorkerEntrypoint, type JobWorkerRuntime } from './worker-entrypoint.js';

it('starts an independent worker and dispatches durable jobs by product kind', async () => {
  let runtimeHandler: JobRuntimeHandler | undefined;
  let stopped = false;
  const runtime: JobWorkerRuntime = {
    async startWorker(handler) {
      runtimeHandler = handler;
      return {
        workId: 'worker-1',
        stop: async () => {
          stopped = true;
        },
      };
    },
  };
  const worker = new P1JobWorkerEntrypoint(runtime, {
    generate_copy: async (envelope) => ({
      status: 'completed',
      output: { contentId: envelope.payload.contentId },
    }),
  });
  await worker.start();
  const envelope: DurableJobEnvelope = {
    workspaceId: 'ws-1',
    jobId: 'job-1',
    kind: 'generate_copy',
    payload: { contentId: 'content-1' },
    fingerprint: 'fixture',
    enqueuedAt: '2026-07-11T01:00:00.000Z',
  };
  const context: JobRuntimeHandlerContext = {
    transportId: 'transport-1',
    attempt: 1,
    recovered: false,
    claimedAt: '2026-07-11T01:00:01.000Z',
    renewLease: async () => undefined,
  };
  assert.deepEqual(await runtimeHandler!(envelope, context), {
    status: 'completed',
    output: { contentId: 'content-1' },
  });
  await worker.stop();
  assert.equal(stopped, true);
});

it('records real runner outcomes and exposes active handler concurrency', async () => {
  let runtimeHandler: JobRuntimeHandler | undefined;
  let releaseHandler: (() => void) | undefined;
  const released = new Promise<void>((resolve) => {
    releaseHandler = resolve;
  });
  const events: Array<{
    kind: string;
    outcome: string;
    recovered: boolean;
  }> = [];
  let monotonicNow = 10;
  const worker = new P1JobWorkerEntrypoint(
    {
      async startWorker(handler) {
        runtimeHandler = handler;
        return { stop: async () => undefined };
      },
    },
    {
      generate_copy: async () => {
        await released;
        monotonicNow = 25;
        return { status: 'deferred', deferForSeconds: 5 };
      },
    },
    {
      clock: () => new Date('2026-07-11T01:00:00.000Z'),
      monotonicNow: () => monotonicNow,
      runnerEvents: {
        async recordRunnerEvent(event) {
          events.push(event);
        },
      },
      workerId: 'worker-test',
    }
  );
  await worker.start();
  const execution = runtimeHandler!(
    {
      workspaceId: 'ws-1',
      jobId: 'job-observed',
      kind: 'generate_copy',
      payload: {},
      fingerprint: 'fixture',
      enqueuedAt: '2026-07-11T01:00:00.000Z',
    },
    {
      transportId: 'transport-observed',
      attempt: 2,
      recovered: true,
      claimedAt: '2026-07-11T01:00:00.000Z',
      renewLease: async () => undefined,
    }
  );
  assert.equal(worker.activeJobs, 1);
  releaseHandler?.();
  assert.equal((await execution).status, 'deferred');
  assert.equal(worker.activeJobs, 0);
  assert.deepEqual(events, [
    {
      durationMs: 15,
      kind: 'generate_copy',
      occurredAt: '2026-07-11T01:00:00.000Z',
      outcome: 'deferred',
      recovered: true,
      workerId: 'worker-test',
    },
  ]);
});

it('records a recovered handler failure without letting telemetry replace the job error', async () => {
  let runtimeHandler: JobRuntimeHandler | undefined;
  const events: Array<{ outcome: string; recovered: boolean }> = [];
  const worker = new P1JobWorkerEntrypoint(
    {
      async startWorker(handler) {
        runtimeHandler = handler;
        return { stop: async () => undefined };
      },
    },
    {
      generate_copy: async () => {
        throw new Error('provider result is still unknown');
      },
    },
    {
      runnerEvents: {
        async recordRunnerEvent(event) {
          events.push({
            outcome: event.outcome,
            recovered: event.recovered,
          });
          throw new Error('telemetry storage unavailable');
        },
      },
      workerId: 'worker-test',
    }
  );
  await worker.start();

  await assert.rejects(
    runtimeHandler!(
      {
        workspaceId: 'ws-1',
        jobId: 'job-recovered-failure',
        kind: 'generate_copy',
        payload: {},
        fingerprint: 'fixture',
        enqueuedAt: '2026-07-11T01:00:00.000Z',
      },
      {
        transportId: 'transport-recovered-failure',
        attempt: 2,
        recovered: true,
        claimedAt: '2026-07-11T01:00:00.000Z',
        renewLease: async () => undefined,
      }
    ),
    /provider result is still unknown/
  );
  assert.deepEqual(events, [{ outcome: 'threw', recovered: true }]);
  assert.equal(worker.activeJobs, 0);
});

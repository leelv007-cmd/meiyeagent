import { performance } from 'node:perf_hooks';
import type { JobRuntimeHandler } from './pg-boss-job-port.js';
import type { RunnerEvent } from './operational-telemetry.js';

export interface JobWorkerRuntime {
  startWorker(handler: JobRuntimeHandler): Promise<{
    workId?: string;
    stop(): Promise<void>;
  }>;
}

export type ProductJobHandlers = Readonly<Record<string, JobRuntimeHandler>>;

export interface JobWorkerEntrypointOptions {
  workerId?: string;
  runnerEvents?: {
    recordRunnerEvent(event: RunnerEvent): Promise<void>;
  };
  clock?: () => Date;
  monotonicNow?: () => number;
}

/**
 * Process-level entrypoint shared by the pg-boss primary runtime and Graphile
 * control adapter. The composition root supplies product handlers; this module
 * owns only queue lifecycle and kind dispatch.
 */
export class P1JobWorkerEntrypoint {
  private worker?: { workId?: string; stop(): Promise<void> };
  private activeJobCount = 0;
  private readonly clock: () => Date;
  private readonly monotonicNow: () => number;

  constructor(
    private readonly runtime: JobWorkerRuntime,
    private readonly handlers: ProductJobHandlers,
    private readonly options: JobWorkerEntrypointOptions = {}
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  get activeJobs() {
    return this.activeJobCount;
  }

  async start() {
    if (this.worker) return this.worker;
    this.worker = await this.runtime.startWorker(async (envelope, context) => {
      this.activeJobCount += 1;
      const startedAt = this.monotonicNow();
      try {
        const handler = this.handlers[envelope.kind];
        const result = handler
          ? await handler(envelope, context)
          : {
              status: 'dead_letter' as const,
              output: {
                code: 'JOB_HANDLER_NOT_CONFIGURED',
                kind: envelope.kind,
              },
            };
        await this.recordRunnerEvent({
          durationMs: Math.max(0, this.monotonicNow() - startedAt),
          kind: envelope.kind,
          occurredAt: this.clock().toISOString(),
          outcome: result.status,
          recovered: context.recovered,
          workerId: this.options.workerId ?? 'job-worker',
        });
        return result;
      } catch (error) {
        await this.recordRunnerEvent({
          durationMs: Math.max(0, this.monotonicNow() - startedAt),
          kind: envelope.kind,
          occurredAt: this.clock().toISOString(),
          outcome: 'threw',
          recovered: context.recovered,
          workerId: this.options.workerId ?? 'job-worker',
        });
        throw error;
      } finally {
        this.activeJobCount -= 1;
      }
    });
    return this.worker;
  }

  async stop() {
    const worker = this.worker;
    this.worker = undefined;
    await worker?.stop();
  }

  private async recordRunnerEvent(event: RunnerEvent) {
    try {
      await this.options.runnerEvents?.recordRunnerEvent(event);
    } catch {
      // Telemetry must never change the business job outcome.
    }
  }
}

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type {
  DurableJobInput,
  QueueRuntimeMetrics,
  RecurringJobInput,
} from './job-contracts.js';
import type { TracerJobApplicationService } from './tracer-worker.js';
import type { OperationalMetricsPort } from './operational-metrics.js';

export interface JobRuntimeControlPort {
  cancel(workspaceId: string, jobId: string): Promise<void>;
  getMetrics(): Promise<QueueRuntimeMetrics>;
  scheduleRecurring(input: RecurringJobInput): Promise<void>;
  unscheduleRecurring(workspaceId: string, scheduleId: string): Promise<void>;
}

export interface JobRuntimeFoundationModuleOptions {
  adminActorIds?: readonly string[];
  operationalMetrics?: OperationalMetricsPort;
  workerActorIds?: readonly string[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Job runtime payload must be an object.');
  }
  return value as Record<string, unknown>;
}

function string(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

export class JobRuntimeFoundationModule implements P1OperationModule {
  readonly name = 'job-runtime';
  private readonly adminActorIds: Set<string>;
  private readonly operationalMetrics?: OperationalMetricsPort;
  private readonly workerActorIds: Set<string>;

  constructor(
    private readonly tracer: TracerJobApplicationService,
    private readonly runtime: JobRuntimeControlPort,
    options: JobRuntimeFoundationModuleOptions = {}
  ) {
    this.adminActorIds = new Set(options.adminActorIds ?? []);
    this.operationalMetrics = options.operationalMetrics;
    this.workerActorIds = new Set(options.workerActorIds ?? []);
  }

  private requireRuntimeActor(context: P1Context) {
    const allowed =
      (context.actor === 'admin' && this.adminActorIds.has(context.userId)) ||
      (context.actor === 'worker' && this.workerActorIds.has(context.userId));
    if (!allowed) {
      throw new P1DomainError(
        'FORBIDDEN',
        'Job runtime operations require an allowlisted worker or admin actor.'
      );
    }
  }

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    const action = string(args.input, 'action');
    const payload = object(args.input.payload ?? {});
    this.requireRuntimeActor(args.context);
    switch (action) {
      case 'submit':
        return this.tracer.submit({
          jobId: string(payload, 'jobId'),
          kind: string(payload, 'kind'),
          payload: object(payload.payload ?? {}),
          runAt: typeof payload.runAt === 'string' ? payload.runAt : undefined,
          workspaceId: args.context.workspaceId,
        } satisfies DurableJobInput);
      case 'cancel':
        return this.tracer.cancel(
          args.context.workspaceId,
          string(payload, 'jobId')
        );
      case 'schedule_recurring':
        await this.runtime.scheduleRecurring({
          cron: string(payload, 'cron'),
          kind: string(payload, 'kind'),
          payload: object(payload.payload ?? {}),
          scheduleId: string(payload, 'scheduleId'),
          timezone:
            typeof payload.timezone === 'string' ? payload.timezone : undefined,
          workspaceId: args.context.workspaceId,
        });
        return { scheduled: true };
      case 'unschedule_recurring':
        await this.runtime.unscheduleRecurring(
          args.context.workspaceId,
          string(payload, 'scheduleId')
        );
        return { unscheduled: true };
      default:
        throw new Error(`Unknown job runtime command ${action}.`);
    }
  }

  async query(args: { context: P1Context; input: Record<string, unknown> }) {
    const action = string(args.input, 'action');
    const payload = object(args.input.payload ?? {});
    switch (action) {
      case 'job':
        return this.tracer.get(
          args.context.workspaceId,
          string(payload, 'jobId')
        );
      case 'metrics':
        this.requireRuntimeActor(args.context);
        return this.runtime.getMetrics();
      case 'observability':
        this.requireRuntimeActor(args.context);
        if (!this.operationalMetrics) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Operational metrics are not configured.'
          );
        }
        return this.operationalMetrics.collect();
      default:
        throw new Error(`Unknown job runtime query ${action}.`);
    }
  }
}

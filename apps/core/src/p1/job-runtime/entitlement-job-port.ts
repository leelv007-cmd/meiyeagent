import type { PoolClient } from 'pg';
import type { ProductEntitlementPolicyPort } from '../foundation/entitlement-policy.js';
import type {
  DurableJobInput,
  QueueRuntimeMetrics,
  RecurringJobInput,
} from './job-contracts.js';
import type { TransactionalJobPort } from './tracer-worker.js';

export interface EntitlementJobRuntimePort extends TransactionalJobPort {
  getMetrics(): Promise<QueueRuntimeMetrics>;
  scheduleRecurring(input: RecurringJobInput): Promise<void>;
  unscheduleRecurring(workspaceId: string, scheduleId: string): Promise<void>;
}

/**
 * Adds Product entitlement policy to durable jobs before the runtime persists
 * them. Business handlers remain identical across Starter, Growth, and Pro.
 */
export class EntitlementAwareJobPort implements EntitlementJobRuntimePort {
  constructor(
    private readonly runtime: EntitlementJobRuntimePort,
    private readonly policies: ProductEntitlementPolicyPort
  ) {}

  start() {
    return this.runtime.start?.() ?? Promise.resolve();
  }

  async enqueue(input: DurableJobInput) {
    await this.runtime.enqueue(await this.withPolicy(input));
  }

  async enqueueInTransaction(input: DurableJobInput, client: PoolClient) {
    await this.runtime.enqueueInTransaction(await this.withPolicy(input), client);
  }

  cancel(workspaceId: string, jobId: string) {
    return this.runtime.cancel(workspaceId, jobId);
  }

  getMetrics() {
    return this.runtime.getMetrics();
  }

  async scheduleRecurring(input: RecurringJobInput) {
    await this.runtime.scheduleRecurring(await this.withPolicy(input));
  }

  unscheduleRecurring(workspaceId: string, scheduleId: string) {
    return this.runtime.unscheduleRecurring(workspaceId, scheduleId);
  }

  private async withPolicy<T extends DurableJobInput | RecurringJobInput>(
    input: T
  ): Promise<T> {
    const policy = await this.policies.resolve(input.workspaceId);
    return {
      ...input,
      scheduling: {
        queuePriority: policy?.queuePriority ?? 0,
        workspaceConcurrencyLimit: policy?.concurrencyLimit ?? 1,
      },
    } as T;
  }
}

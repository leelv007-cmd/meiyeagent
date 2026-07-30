import type { PoolClient } from 'pg';
import {
  normalizeProductEntitlementPolicy,
  type ProductEntitlementPolicyPort,
} from '../foundation/entitlement-policy.js';
import {
  JobRuntimeError,
  type DurableJobInput,
  type QueueRuntimeMetrics,
  type RecurringJobInput,
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
 * H1: also attaches product-side policy projection (never upstream resources).
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

  async resume(input: DurableJobInput, sequence: number) {
    if (!this.runtime.resume) {
      throw new JobRuntimeError(
        'RUNTIME_NOT_STARTED',
        'The configured job runtime cannot enqueue a failed-job resume.',
      );
    }
    await this.runtime.resume(await this.withPolicy(input), sequence);
  }

  async resumeInTransaction(
    input: DurableJobInput,
    sequence: number,
    client: PoolClient,
  ) {
    if (!this.runtime.resumeInTransaction) {
      throw new JobRuntimeError(
        'RUNTIME_NOT_STARTED',
        'The configured job runtime cannot resume in a caller transaction.',
      );
    }
    await this.runtime.resumeInTransaction(
      await this.withPolicy(input),
      sequence,
      client,
    );
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
    const resolved = await this.policies.resolve(input.workspaceId);
    const policy = resolved
      ? normalizeProductEntitlementPolicy(resolved)
      : null;
    return {
      ...input,
      scheduling: {
        queuePriority: policy?.queuePriority ?? 0,
        workspaceConcurrencyLimit: policy?.concurrencyLimit ?? 1,
        ...(policy
          ? {
              entitlementProjection: {
                revision: policy.revision,
                allowedCatalogModelIds: [...policy.allowedCatalogModelIds],
                allowedQualityTiers: [...policy.allowedQualityTiers],
                availableSupplyPoolIds: [...policy.availableSupplyPoolIds],
                overageMode: policy.overage.mode,
              },
            }
          : {}),
      },
    } as T;
  }
}

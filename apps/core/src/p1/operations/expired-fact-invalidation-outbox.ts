import { randomUUID } from 'node:crypto';

import type { ExpiredFactInvalidator } from './context-invalidation.js';

export interface ExpiredFactInvalidationClaim {
  attemptCount: number;
  claimToken: string;
  currentRevision: number | null;
  expiresAt: string;
  factId: string;
  revision: number;
  workspaceId: string;
}

export interface ExpiredFactInvalidationClaimIdentity {
  claimToken: string;
  factId: string;
  revision: number;
  workspaceId: string;
}

export interface ExpiredFactInvalidationOutboxRepository {
  claimBatch(input: {
    claimToken: string;
    leaseMs: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<ExpiredFactInvalidationClaim[]>;
  markDelivered(
    input: ExpiredFactInvalidationClaimIdentity & { deliveredAt: Date },
  ): Promise<boolean>;
  markFailed(
    input: ExpiredFactInvalidationClaimIdentity & {
      deadLetter: boolean;
      error: string;
      failedAt: Date;
      retryAt: Date;
    },
  ): Promise<boolean>;
  markSuperseded(
    input: ExpiredFactInvalidationClaimIdentity & { supersededAt: Date },
  ): Promise<boolean>;
}

export class ExpiredFactInvalidationWorker {
  private readonly batchSize: number;
  private readonly claimToken: () => string;
  private readonly clock: () => Date;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly maxRetryDelayMs: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly repository: ExpiredFactInvalidationOutboxRepository,
    private readonly invalidator: ExpiredFactInvalidator,
    options: {
      batchSize?: number;
      claimToken?: () => string;
      clock?: () => Date;
      leaseMs?: number;
      maxAttempts?: number;
      maxRetryDelayMs?: number;
      retryDelayMs?: number;
    } = {},
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.claimToken = options.claimToken ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5 * 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
  }

  async runOnce(workerId: string) {
    const claimed = await this.repository.claimBatch({
      claimToken: this.claimToken(),
      leaseMs: this.leaseMs,
      limit: this.batchSize,
      now: this.clock(),
      workerId,
    });
    const result = {
      claimed: claimed.length,
      deadLettered: 0,
      delivered: 0,
      lost: 0,
      retried: 0,
      superseded: 0,
    };

    for (const item of claimed) {
      const identity: ExpiredFactInvalidationClaimIdentity = {
        claimToken: item.claimToken,
        factId: item.factId,
        revision: item.revision,
        workspaceId: item.workspaceId,
      };
      if (item.currentRevision !== item.revision) {
        const settled = await this.repository.markSuperseded({
          ...identity,
          supersededAt: this.clock(),
        });
        settled ? (result.superseded += 1) : (result.lost += 1);
        continue;
      }

      try {
        await this.invalidator.invalidateExpiredFact({
          expiresAt: item.expiresAt,
          factId: item.factId,
          revision: item.revision,
          workspaceId: item.workspaceId,
        });
        const settled = await this.repository.markDelivered({
          ...identity,
          deliveredAt: this.clock(),
        });
        settled ? (result.delivered += 1) : (result.lost += 1);
      } catch (error) {
        const failedAt = this.clock();
        const deadLetter = item.attemptCount >= this.maxAttempts;
        const retryDelay = Math.min(
          this.retryDelayMs * 2 ** Math.max(0, item.attemptCount - 1),
          this.maxRetryDelayMs,
        );
        const settled = await this.repository.markFailed({
          ...identity,
          deadLetter,
          error: error instanceof Error ? error.message : String(error),
          failedAt,
          retryAt: new Date(failedAt.getTime() + retryDelay),
        });
        if (!settled) {
          result.lost += 1;
        } else if (deadLetter) {
          result.deadLettered += 1;
        } else {
          result.retried += 1;
        }
      }
    }

    return result;
  }
}

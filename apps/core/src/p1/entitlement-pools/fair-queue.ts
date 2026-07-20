/**
 * Supply-account fair queue (H2 / D-066 story 28).
 *
 * Product-side per-workspace concurrency + queuePriority already land on
 * PgBoss production assembly — this module only models supply-account-level
 * isolation and fair admission. Does not rebuild product-side gates.
 *
 * Fairness contract: under contention, no single product account monopolizes
 * the shared supply-account slots when peers have waiting work (weighted
 * round-robin by queuePriority, higher priority served first within a turn).
 */

import { P1DomainError } from '../foundation/domain.js';

export type FairQueueEntry = {
  requestId: string;
  productAccountId: string;
  workspaceId: string;
  /** Higher = more preferred (product plan queuePriority projection). */
  queuePriority: number;
  enqueuedAt: string;
};

export type FairQueueDequeueResult =
  | { status: 'empty' }
  | { status: 'dequeued'; entry: FairQueueEntry };

/**
 * In-memory fair queue scoped to one supply account.
 * Weighted round-robin: accounts ordered by max waiting priority, then
 * oldest enqueuedAt; after a dequeue the account rotates to the back of
 * its priority band so peers are not starved.
 */
export class SupplyAccountFairQueue {
  private readonly waiting: FairQueueEntry[] = [];
  private readonly recentServed: string[] = [];
  private readonly maxRecent: number;

  constructor(
    readonly supplyAccountId: string,
    options?: { maxRecentServed?: number }
  ) {
    this.maxRecent = options?.maxRecentServed ?? 64;
  }

  enqueue(input: {
    requestId: string;
    productAccountId: string;
    workspaceId: string;
    queuePriority: number;
    enqueuedAt: string;
  }): FairQueueEntry {
    if (
      !input.requestId.trim() ||
      !input.productAccountId.trim() ||
      !input.workspaceId.trim()
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Fair queue entry requires requestId, productAccountId, and workspaceId.'
      );
    }
    if (
      !Number.isInteger(input.queuePriority) ||
      input.queuePriority < 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'queuePriority must be a non-negative integer.'
      );
    }
    if (this.waiting.some((entry) => entry.requestId === input.requestId)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Fair queue already holds request ${input.requestId}.`
      );
    }
    const entry: FairQueueEntry = {
      requestId: input.requestId,
      productAccountId: input.productAccountId,
      workspaceId: input.workspaceId,
      queuePriority: input.queuePriority,
      enqueuedAt: input.enqueuedAt,
    };
    this.waiting.push(entry);
    return structuredClone(entry);
  }

  size(): number {
    return this.waiting.length;
  }

  listWaiting(): FairQueueEntry[] {
    return this.waiting.map((entry) => structuredClone(entry));
  }

  /**
   * Dequeue next request under fair-share rules:
   * 1. Prefer higher queuePriority.
   * 2. Among equal priority, prefer product accounts not recently served.
   * 3. Tie-break by enqueuedAt ASC (FIFO within account fairness).
   */
  dequeue(): FairQueueDequeueResult {
    if (this.waiting.length === 0) return { status: 'empty' };

    const recentRank = new Map<string, number>();
    this.recentServed.forEach((accountId, index) => {
      // More recent = higher index = less preferred for next turn.
      recentRank.set(accountId, index);
    });

    let bestIndex = 0;
    for (let i = 1; i < this.waiting.length; i += 1) {
      if (
        compareFairQueueOrder(
          this.waiting[i]!,
          this.waiting[bestIndex]!,
          recentRank
        ) < 0
      ) {
        bestIndex = i;
      }
    }

    const [entry] = this.waiting.splice(bestIndex, 1);
    if (!entry) return { status: 'empty' };

    this.recentServed.push(entry.productAccountId);
    if (this.recentServed.length > this.maxRecent) {
      this.recentServed.shift();
    }

    return { status: 'dequeued', entry: structuredClone(entry) };
  }

  /**
   * Contract helper: simulate N dequeues and return product-account service counts.
   * Used by fair-queue contract tests.
   */
  drainServiceCounts(maxDequeues: number): Map<string, number> {
    const counts = new Map<string, number>();
    for (let i = 0; i < maxDequeues; i += 1) {
      const result = this.dequeue();
      if (result.status === 'empty') break;
      counts.set(
        result.entry.productAccountId,
        (counts.get(result.entry.productAccountId) ?? 0) + 1
      );
    }
    return counts;
  }
}

export function compareFairQueueOrder(
  left: FairQueueEntry,
  right: FairQueueEntry,
  recentRank: ReadonlyMap<string, number>
): number {
  if (left.queuePriority !== right.queuePriority) {
    return right.queuePriority - left.queuePriority;
  }
  const leftRecent = recentRank.get(left.productAccountId) ?? -1;
  const rightRecent = recentRank.get(right.productAccountId) ?? -1;
  if (leftRecent !== rightRecent) {
    // Lower recent rank (older / never) wins.
    return leftRecent - rightRecent;
  }
  const byTime = Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt);
  if (byTime !== 0) return byTime;
  return left.requestId.localeCompare(right.requestId);
}

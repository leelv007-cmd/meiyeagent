/**
 * Supply-account fair queue (H2 / D-066 story 28).
 *
 * Product-side per-workspace concurrency + queuePriority already land on
 * PgBoss production assembly — this module only models supply-account-level
 * isolation and fair admission. Does not rebuild product-side gates.
 *
 * Fairness contract: under contention, no single product account monopolizes
 * the shared supply-account slots when peers have waiting work (weighted
 * round-robin by queuePriority without starving a continuously waiting peer).
 */

import { P1DomainError } from '../foundation/domain.js';

/**
 * Max retained service-turn samples per supply account (F-H-05).
 * Fair weights use a sliding window so service_turns / in-memory counts
 * cannot grow without bound.
 */
export const FAIR_QUEUE_SERVICE_TURN_WINDOW = 256;

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
 * Weighted fair queue: an account with priority N receives N + 1 service
 * tickets per round. The candidate with the lowest next normalized service
 * count wins, so higher priorities receive proportionally more turns while a
 * continuously waiting low-priority account still advances.
 *
 * Service counts are a sliding window of at most `maxRecentServed` turns
 * (default {@link FAIR_QUEUE_SERVICE_TURN_WINDOW}) so history cannot grow
 * unbounded (F-H-05).
 */
export class SupplyAccountFairQueue {
  private readonly waiting: FairQueueEntry[] = [];
  private readonly serviceCounts = new Map<string, number>();
  /** Product-account ids of recent dequeues, oldest first. */
  private readonly recentServed: string[] = [];
  readonly maxRecentServed: number;

  constructor(
    readonly supplyAccountId: string,
    options?: { maxRecentServed?: number }
  ) {
    const window = options?.maxRecentServed ?? FAIR_QUEUE_SERVICE_TURN_WINDOW;
    if (!Number.isInteger(window) || window <= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'maxRecentServed must be a positive integer.'
      );
    }
    this.maxRecentServed = window;
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
    if (!Number.isInteger(input.queuePriority) || input.queuePriority < 0) {
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

  /** Current sliding-window service sample size (for tests / diagnostics). */
  recentServiceSampleSize(): number {
    return this.recentServed.length;
  }

  /** Copy of sliding-window service counts (for tests / diagnostics). */
  snapshotServiceCounts(): Map<string, number> {
    return new Map(this.serviceCounts);
  }

  /**
   * Dequeue next request under fair-share rules:
   * 1. Prefer the lowest (serviceCount + 1) / (queuePriority + 1).
   * 2. At an exact ticket boundary, prefer the higher priority.
   * 3. Tie-break by enqueuedAt ASC (FIFO within account fairness).
   */
  dequeue(): FairQueueDequeueResult {
    if (this.waiting.length === 0) return { status: 'empty' };

    let bestIndex = 0;
    for (let i = 1; i < this.waiting.length; i += 1) {
      if (
        compareFairQueueOrder(
          this.waiting[i]!,
          this.waiting[bestIndex]!,
          this.serviceCounts
        ) < 0
      ) {
        bestIndex = i;
      }
    }

    const [entry] = this.waiting.splice(bestIndex, 1);
    if (!entry) return { status: 'empty' };

    this.recordService(entry.productAccountId);

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

  private recordService(productAccountId: string) {
    this.serviceCounts.set(
      productAccountId,
      (this.serviceCounts.get(productAccountId) ?? 0) + 1
    );
    this.recentServed.push(productAccountId);
    while (this.recentServed.length > this.maxRecentServed) {
      const oldest = this.recentServed.shift();
      if (!oldest) break;
      const next = (this.serviceCounts.get(oldest) ?? 1) - 1;
      if (next <= 0) this.serviceCounts.delete(oldest);
      else this.serviceCounts.set(oldest, next);
    }
  }
}

export function compareFairQueueOrder(
  left: FairQueueEntry,
  right: FairQueueEntry,
  serviceCounts: ReadonlyMap<string, number>
): number {
  const leftWeight = left.queuePriority + 1;
  const rightWeight = right.queuePriority + 1;
  const leftNextCount = (serviceCounts.get(left.productAccountId) ?? 0) + 1;
  const rightNextCount = (serviceCounts.get(right.productAccountId) ?? 0) + 1;
  const normalizedComparison =
    leftNextCount * rightWeight - rightNextCount * leftWeight;
  if (normalizedComparison !== 0) return normalizedComparison;
  if (left.queuePriority !== right.queuePriority) {
    return right.queuePriority - left.queuePriority;
  }
  const byTime = Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt);
  if (byTime !== 0) return byTime;
  return left.requestId.localeCompare(right.requestId);
}

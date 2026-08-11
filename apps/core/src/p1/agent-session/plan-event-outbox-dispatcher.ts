/**
 * V31-40: dispatch pending plan semantic outbox rows to the projector.
 *
 * Lifecycle reuses confirmationDispatch pending → dispatched (no second machine).
 * Append commits revision + outbox candidate atomically; this worker closes the
 * crash window between commit and projector I/O.
 *
 * Dual-path with PlanCompiler.emitPlanSemanticEvent:
 * - Fast path may project first (richer readiness/billing payload).
 * - Worker checks getByEventId before projecting so content conflicts are avoided.
 * - Same eventId (planSemanticEventId) makes re-dispatch idempotent.
 */

import type { AgentSemanticEvent } from '@meiye/contracts';

import type { SemanticEventCandidate } from '../agent-semantic-events/semantic-event-store.js';
import {
  buildPlanSemanticEventCandidate,
  planSemanticEventId,
} from './plan-semantic-event.js';
import type { MarketingPlanCompileArtifact } from './plan-store.js';

export type PlanEventOutboxRow = {
  eventId: string;
  planId: string;
  revision: number;
  threadId: string;
  workspaceId: string;
  eventType: string;
  payload: unknown;
};

export type PlanEventOutboxPort = {
  claimPendingPlanEventOutbox(input: {
    limit: number;
  }): Promise<PlanEventOutboxRow[]>;
  markPlanEventOutboxDispatched(eventId: string): Promise<boolean>;
  getRevision(
    planId: string,
    revision: number,
  ): Promise<MarketingPlanCompileArtifact | null>;
};

export type PlanEventOutboxSemanticPorts = {
  project(
    candidate: SemanticEventCandidate,
  ): Promise<{ event: unknown; replayed: boolean }>;
  getByEventId(input: {
    resourceId: string;
    eventId: string;
  }): Promise<AgentSemanticEvent | null>;
};

export type PlanEventOutboxDispatchResult = {
  claimed: number;
  projected: number;
  alreadyProjected: number;
  dispatched: number;
  failed: number;
};

export class PlanEventOutboxDispatcher {
  constructor(
    private readonly outbox: PlanEventOutboxPort,
    private readonly semanticEvents: PlanEventOutboxSemanticPorts,
    private readonly options: { batchSize?: number } = {},
  ) {}

  async runOnce(): Promise<PlanEventOutboxDispatchResult> {
    const limit = this.options.batchSize ?? 20;
    const rows = await this.outbox.claimPendingPlanEventOutbox({ limit });
    const result: PlanEventOutboxDispatchResult = {
      claimed: rows.length,
      projected: 0,
      alreadyProjected: 0,
      dispatched: 0,
      failed: 0,
    };
    for (const row of rows) {
      try {
        const outcome = await this.dispatchOne(row);
        if (outcome === 'projected') result.projected += 1;
        else result.alreadyProjected += 1;
        if (await this.outbox.markPlanEventOutboxDispatched(row.eventId)) {
          result.dispatched += 1;
        }
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  private async dispatchOne(
    row: PlanEventOutboxRow,
  ): Promise<'projected' | 'already_projected'> {
    const resourceId = row.workspaceId.trim() || row.threadId;
    const existing = await this.semanticEvents.getByEventId({
      resourceId,
      eventId: row.eventId,
    });
    if (existing) return 'already_projected';

    const artifact = await this.outbox.getRevision(row.planId, row.revision);
    if (!artifact) {
      throw new Error(
        `Plan event outbox ${row.eventId} has no revision ${row.planId}@${row.revision}.`,
      );
    }
    const expectedId = planSemanticEventId(row.planId, row.revision);
    if (row.eventId !== expectedId) {
      throw new Error(
        `Plan event outbox eventId mismatch: stored ${row.eventId}, expected ${expectedId}.`,
      );
    }
    const candidate = buildPlanSemanticEventCandidate({
      resourceId,
      revision: artifact.revision,
      correlationId: row.threadId,
      occurredAt: artifact.revision.createdAt,
    });
    await this.semanticEvents.project(candidate);
    return 'projected';
  }
}

/** Poll loop mirroring HarnessLangfuseOutboxLoop (pending recovery path). */
export class PlanEventOutboxLoop {
  private interval: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly worker: Pick<PlanEventOutboxDispatcher, 'runOnce'>,
    private readonly options: {
      onError?: (error: unknown) => void;
      pollMs?: number;
    } = {},
  ) {}

  start() {
    if (this.interval) return;
    this.interval = setInterval(
      () => void this.runOnce(),
      this.options.pollMs ?? 1_000,
    );
    this.interval.unref();
    void this.runOnce();
  }

  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  async runOnce() {
    if (this.running) return false;
    this.running = true;
    try {
      await this.worker.runOnce();
      return true;
    } catch (error) {
      this.options.onError?.(error);
      return false;
    } finally {
      this.running = false;
    }
  }
}

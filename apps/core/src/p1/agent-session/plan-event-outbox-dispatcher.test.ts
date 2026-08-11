/**
 * V31-40: plan event outbox dispatcher unit tests (memory fakes).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentSemanticEventProjector,
  MemoryAgentSemanticEventStore,
} from '../agent-semantic-events/index.js';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from './plan-compiler.js';
import {
  PlanEventOutboxDispatcher,
  type PlanEventOutboxPort,
  type PlanEventOutboxRow,
} from './plan-event-outbox-dispatcher.js';
import {
  buildPlanSemanticEventCandidate,
  planSemanticEventId,
} from './plan-semantic-event.js';
import type { MarketingPlanCompileArtifact } from './plan-store.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';

const TS = '2026-08-08T12:00:00.000Z';

class MemoryPlanEventOutbox implements PlanEventOutboxPort {
  readonly pending = new Map<string, PlanEventOutboxRow>();
  readonly dispatched = new Set<string>();
  readonly revisions = new Map<string, MarketingPlanCompileArtifact>();

  seed(row: PlanEventOutboxRow, artifact: MarketingPlanCompileArtifact) {
    this.pending.set(row.eventId, row);
    this.revisions.set(`${row.planId}@${row.revision}`, artifact);
  }

  async claimPendingPlanEventOutbox(input: {
    limit: number;
  }): Promise<PlanEventOutboxRow[]> {
    return [...this.pending.values()]
      .filter((row) => !this.dispatched.has(row.eventId))
      .slice(0, input.limit);
  }

  async markPlanEventOutboxDispatched(eventId: string): Promise<boolean> {
    if (!this.pending.has(eventId) || this.dispatched.has(eventId)) return false;
    this.dispatched.add(eventId);
    return true;
  }

  async getRevision(
    planId: string,
    revision: number,
  ): Promise<MarketingPlanCompileArtifact | null> {
    return this.revisions.get(`${planId}@${revision}`) ?? null;
  }
}

async function compileArtifact(planId: string) {
  const store = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
  });
  return compiler.compile({
    workspaceId: 'ws-outbox',
    threadId: 'thread-outbox',
    planId,
    proposal: {
      goalNarrative: 'outbox 恢复方案',
      recommendedDeliverables: [
        { carrier: 'copy', quantity: 1, purpose: '文案' },
      ],
    },
    intentRevision: 1,
    contextBundleId: 'bundle-outbox',
    contextRevision: '1',
    harnessReleaseId: 'release-outbox',
    now: TS,
  });
}

test('dispatch projects pending outbox once and marks dispatched', async () => {
  const artifact = await compileArtifact('plan-dispatch-1');
  const eventId = planSemanticEventId('plan-dispatch-1', 1);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(
    {
      eventId,
      planId: 'plan-dispatch-1',
      revision: 1,
      threadId: 'thread-outbox',
      workspaceId: 'ws-outbox',
      eventType: 'plan.created',
      payload: {},
    },
    artifact,
  );
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  const dispatcher = new PlanEventOutboxDispatcher(outbox, {
    project: (candidate) => projector.project(candidate),
    getByEventId: (input) => eventStore.getByEventId(input),
  });

  const first = await dispatcher.runOnce();
  assert.equal(first.claimed, 1);
  assert.equal(first.projected, 1);
  assert.equal(first.alreadyProjected, 0);
  assert.equal(first.dispatched, 1);
  assert.equal(first.failed, 0);

  const events = await eventStore.listByThread({
    resourceId: 'ws-outbox',
    threadId: 'thread-outbox',
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventId, eventId);
  assert.equal(events[0]?.eventType, 'plan.created');
  assert.ok(outbox.dispatched.has(eventId));
});

test('dispatch is idempotent: second run is a no-op after mark', async () => {
  const artifact = await compileArtifact('plan-dispatch-idem');
  const eventId = planSemanticEventId('plan-dispatch-idem', 1);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(
    {
      eventId,
      planId: 'plan-dispatch-idem',
      revision: 1,
      threadId: 'thread-outbox',
      workspaceId: 'ws-outbox',
      eventType: 'plan.created',
      payload: {},
    },
    artifact,
  );
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  const dispatcher = new PlanEventOutboxDispatcher(outbox, {
    project: (candidate) => projector.project(candidate),
    getByEventId: (input) => eventStore.getByEventId(input),
  });

  await dispatcher.runOnce();
  const second = await dispatcher.runOnce();
  assert.equal(second.claimed, 0);
  assert.equal(second.projected, 0);
  assert.equal(
    (
      await eventStore.listByThread({
        resourceId: 'ws-outbox',
        threadId: 'thread-outbox',
      })
    ).length,
    1,
  );
});

test('process kill after commit before dispatch: restart projects once', async () => {
  // Simulate: revision+outbox committed, emit never ran (crash window).
  const artifact = await compileArtifact('plan-dispatch-kill');
  const eventId = planSemanticEventId('plan-dispatch-kill', 1);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(
    {
      eventId,
      planId: 'plan-dispatch-kill',
      revision: 1,
      threadId: 'thread-outbox',
      workspaceId: 'ws-outbox',
      eventType: 'plan.created',
      payload: {},
    },
    artifact,
  );
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);

  // "Process 1" dies before project. "Process 2" restarts dispatcher.
  const restarted = new PlanEventOutboxDispatcher(outbox, {
    project: (candidate) => projector.project(candidate),
    getByEventId: (input) => eventStore.getByEventId(input),
  });
  const result = await restarted.runOnce();
  assert.equal(result.projected, 1);
  assert.equal(result.dispatched, 1);

  // Another restart still sees one projection only.
  const again = await restarted.runOnce();
  assert.equal(again.claimed, 0);
  assert.equal(
    (
      await eventStore.listByThread({
        resourceId: 'ws-outbox',
        threadId: 'thread-outbox',
      })
    ).length,
    1,
  );
});

test('already-projected by emit path: dispatcher marks without content conflict', async () => {
  const artifact = await compileArtifact('plan-dispatch-emit');
  const eventId = planSemanticEventId('plan-dispatch-emit', 1);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(
    {
      eventId,
      planId: 'plan-dispatch-emit',
      revision: 1,
      threadId: 'thread-outbox',
      workspaceId: 'ws-outbox',
      eventType: 'plan.created',
      payload: {},
    },
    artifact,
  );
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);

  // Fast path: emit with richer readiness payload (differs from bare rebuild).
  const rich = buildPlanSemanticEventCandidate({
    resourceId: 'ws-outbox',
    revision: artifact.revision,
    readiness: 'ready',
    adjustmentSummary: 'fast-path only',
    correlationId: 'thread-outbox',
    occurredAt: TS,
  });
  await projector.project(rich);

  const dispatcher = new PlanEventOutboxDispatcher(outbox, {
    project: (candidate) => projector.project(candidate),
    getByEventId: (input) => eventStore.getByEventId(input),
  });
  const result = await dispatcher.runOnce();
  assert.equal(result.alreadyProjected, 1);
  assert.equal(result.projected, 0);
  assert.equal(result.dispatched, 1);
  assert.equal(result.failed, 0);

  const events = await eventStore.listByThread({
    resourceId: 'ws-outbox',
    threadId: 'thread-outbox',
  });
  assert.equal(events.length, 1);
  assert.equal(
    (events[0]?.payload as { adjustmentSummary?: string }).adjustmentSummary,
    'fast-path only',
  );
});

test('duplicate concurrent-style re-dispatch stays single event', async () => {
  const artifact = await compileArtifact('plan-dispatch-dup');
  const eventId = planSemanticEventId('plan-dispatch-dup', 1);
  const outbox = new MemoryPlanEventOutbox();
  // Keep pending even after first mark so second dispatcher still "claims".
  const sticky: PlanEventOutboxPort = {
    claimPendingPlanEventOutbox: async () => [
      {
        eventId,
        planId: 'plan-dispatch-dup',
        revision: 1,
        threadId: 'thread-outbox',
        workspaceId: 'ws-outbox',
        eventType: 'plan.created',
        payload: {},
      },
    ],
    markPlanEventOutboxDispatched: async (id) =>
      outbox.markPlanEventOutboxDispatched(id),
    getRevision: async (planId, revision) => {
      outbox.seed(
        {
          eventId,
          planId,
          revision,
          threadId: 'thread-outbox',
          workspaceId: 'ws-outbox',
          eventType: 'plan.created',
          payload: {},
        },
        artifact,
      );
      return outbox.getRevision(planId, revision);
    },
  };
  outbox.seed(
    {
      eventId,
      planId: 'plan-dispatch-dup',
      revision: 1,
      threadId: 'thread-outbox',
      workspaceId: 'ws-outbox',
      eventType: 'plan.created',
      payload: {},
    },
    artifact,
  );

  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  const dispatcher = new PlanEventOutboxDispatcher(sticky, {
    project: (candidate) => projector.project(candidate),
    getByEventId: (input) => eventStore.getByEventId(input),
  });

  await dispatcher.runOnce();
  const second = await dispatcher.runOnce();
  assert.equal(second.alreadyProjected, 1);
  assert.equal(second.projected, 0);
  assert.equal(
    (
      await eventStore.listByThread({
        resourceId: 'ws-outbox',
        threadId: 'thread-outbox',
      })
    ).length,
    1,
  );
});

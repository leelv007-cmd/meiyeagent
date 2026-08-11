/** V31-40 / V31-46 plan-event outbox dispatcher unit tests. */
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
  PLAN_EVENT_OUTBOX_MAX_ATTEMPTS,
  PlanEventOutboxDispatcher,
  type PlanEventOutboxPort,
  type PlanEventOutboxRow,
} from './plan-event-outbox-dispatcher.js';
import { buildPlanSemanticEventCandidate } from './plan-semantic-event.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';

const TS = '2026-08-08T12:00:00.000Z';

type StoredRow = Omit<PlanEventOutboxRow, 'leaseToken'> & {
  state: 'pending' | 'dispatching' | 'dispatched' | 'dead_letter';
  leaseToken: string | null;
  attempts: number;
  eligible: boolean;
  lastError: string | null;
};

class MemoryPlanEventOutbox implements PlanEventOutboxPort {
  readonly rows = new Map<string, StoredRow>();
  private claimNumber = 0;

  seed(row: Omit<PlanEventOutboxRow, 'leaseToken'>) {
    this.rows.set(row.eventId, {
      ...row,
      state: 'pending',
      leaseToken: null,
      attempts: 0,
      eligible: true,
      lastError: null,
    });
  }

  async claimPendingPlanEventOutbox(input: {
    limit: number;
    leaseMs?: number;
  }): Promise<PlanEventOutboxRow[]> {
    const leaseToken = `lease-${++this.claimNumber}`;
    return [...this.rows.values()]
      .filter((row) => row.state === 'pending' && row.eligible)
      .slice(0, input.limit)
      .map((row) => {
        row.state = 'dispatching';
        row.leaseToken = leaseToken;
        return {
          eventId: row.eventId,
          planId: row.planId,
          revision: row.revision,
          threadId: row.threadId,
          workspaceId: row.workspaceId,
          eventType: row.eventType,
          payload: structuredClone(row.payload),
          leaseToken,
        };
      });
  }

  async markPlanEventOutboxDispatched(input: {
    eventId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const row = this.rows.get(input.eventId);
    if (
      !row ||
      row.state !== 'dispatching' ||
      row.leaseToken !== input.leaseToken
    ) {
      return false;
    }
    row.state = 'dispatched';
    row.leaseToken = null;
    return true;
  }

  async recordPlanEventOutboxFailure(input: {
    eventId: string;
    leaseToken: string;
    error: string;
    terminal: boolean;
  }): Promise<'retry_scheduled' | 'dead_lettered' | 'stale'> {
    const row = this.rows.get(input.eventId);
    if (
      !row ||
      row.state !== 'dispatching' ||
      row.leaseToken !== input.leaseToken
    ) {
      return 'stale';
    }
    row.attempts += 1;
    row.lastError = input.error;
    row.leaseToken = null;
    if (input.terminal || row.attempts >= PLAN_EVENT_OUTBOX_MAX_ATTEMPTS) {
      row.state = 'dead_letter';
      return 'dead_lettered';
    }
    row.state = 'pending';
    row.eligible = false;
    return 'retry_scheduled';
  }

  releaseRetry(eventId: string) {
    const row = this.rows.get(eventId);
    if (row?.state === 'pending') row.eligible = true;
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
    resourceId: 'ws-outbox',
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

function rowFor(
  artifact: Awaited<ReturnType<typeof compileArtifact>>,
  overrides: Partial<Omit<PlanEventOutboxRow, 'leaseToken'>> = {},
): Omit<PlanEventOutboxRow, 'leaseToken'> {
  const candidate = buildPlanSemanticEventCandidate({
    resourceId: 'ws-outbox',
    revision: artifact.revision,
    readiness: artifact.readiness,
    correlationId: 'thread-outbox',
    occurredAt: TS,
  });
  return {
    eventId: candidate.eventId,
    planId: artifact.revision.planId,
    revision: artifact.revision.revision,
    threadId: artifact.revision.threadId,
    workspaceId: 'ws-outbox',
    eventType: candidate.eventType,
    payload: candidate,
    ...overrides,
  };
}

function dispatcherFor(
  outbox: PlanEventOutboxPort,
  eventStore = new MemoryAgentSemanticEventStore(),
) {
  const projector = new AgentSemanticEventProjector(eventStore);
  return {
    eventStore,
    dispatcher: new PlanEventOutboxDispatcher(outbox, {
      project: (candidate) => projector.project(candidate),
      getByEventId: (input) => eventStore.getByEventId(input),
    }),
  };
}

test('outbox wins after a post-commit crash and projects the persisted candidate once', async () => {
  const artifact = await compileArtifact('plan-dispatch-kill');
  const row = rowFor(artifact);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(row);
  const { dispatcher, eventStore } = dispatcherFor(outbox);

  const result = await dispatcher.runOnce();
  assert.deepEqual(
    {
      claimed: result.claimed,
      projected: result.projected,
      dispatched: result.dispatched,
      failed: result.failed,
    },
    { claimed: 1, projected: 1, dispatched: 1, failed: 0 },
  );
  const events = await eventStore.listByThread({
    resourceId: 'ws-outbox',
    threadId: 'thread-outbox',
  });
  assert.deepEqual(events[0]?.payload, (row.payload as { payload: unknown }).payload);
  assert.equal(outbox.rows.get(row.eventId)?.state, 'dispatched');
});

test('fast path wins only when it projected the exact canonical candidate', async () => {
  const artifact = await compileArtifact('plan-dispatch-fast');
  const row = rowFor(artifact);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(row);
  const { dispatcher, eventStore } = dispatcherFor(outbox);
  const projector = new AgentSemanticEventProjector(eventStore);
  await projector.project(row.payload as never);

  const result = await dispatcher.runOnce();
  assert.equal(result.alreadyProjected, 1);
  assert.equal(result.dispatched, 1);
  assert.equal(result.deadLettered, 0);
  assert.equal(outbox.rows.get(row.eventId)?.state, 'dispatched');
});

test('concurrent pollers receive one lease and do not double project', async () => {
  const artifact = await compileArtifact('plan-dispatch-concurrent');
  const row = rowFor(artifact);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(row);
  const { dispatcher: first, eventStore } = dispatcherFor(outbox);
  const { dispatcher: second } = dispatcherFor(outbox, eventStore);

  const [left, right] = await Promise.all([first.runOnce(), second.runOnce()]);
  assert.equal(left.claimed + right.claimed, 1);
  const events = await eventStore.listByThread({
    resourceId: 'ws-outbox',
    threadId: 'thread-outbox',
  });
  assert.equal(events.length, 1);
});

test('a constant retryable failure backs off instead of being claimed every poll', async () => {
  const artifact = await compileArtifact('plan-dispatch-retry');
  const row = rowFor(artifact);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(row);
  const dispatcher = new PlanEventOutboxDispatcher(outbox, {
    project: async () => {
      throw new Error('temporary projector outage');
    },
    getByEventId: async () => null,
  });

  const first = await dispatcher.runOnce();
  assert.equal(first.retried, 1);
  assert.equal((await dispatcher.runOnce()).claimed, 0);
  outbox.releaseRetry(row.eventId);
  assert.equal((await dispatcher.runOnce()).retried, 1);
  assert.equal(outbox.rows.get(row.eventId)?.attempts, 2);
});

test('poison candidate and same-boundary mutation dead-letter without a retry loop', async () => {
  const artifact = await compileArtifact('plan-dispatch-poison');
  const poison = rowFor(artifact, { payload: { bad: true } });
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(poison);
  const { dispatcher } = dispatcherFor(outbox);
  const poisoned = await dispatcher.runOnce();
  assert.equal(poisoned.deadLettered, 1);
  assert.equal(outbox.rows.get(poison.eventId)?.attempts, 1);
  assert.equal((await dispatcher.runOnce()).claimed, 0);

  const mutation = rowFor(await compileArtifact('plan-dispatch-mutation'));
  const mutationOutbox = new MemoryPlanEventOutbox();
  mutationOutbox.seed(mutation);
  const { dispatcher: mutatedDispatcher, eventStore } = dispatcherFor(mutationOutbox);
  const projector = new AgentSemanticEventProjector(eventStore);
  const candidate = mutation.payload as {
    payload: Record<string, unknown>;
  };
  await projector.project({
    ...(mutation.payload as object),
    payload: { ...candidate.payload, adjustmentSummary: 'different' },
  } as never);
  const mutated = await mutatedDispatcher.runOnce();
  assert.equal(mutated.deadLettered, 1);
  assert.match(
    mutationOutbox.rows.get(mutation.eventId)?.lastError ?? '',
    /AGENT_SEMANTIC_EVENT_CONFLICT/u,
  );
});

test('an eventId already owned by a foreign workspace is a typed terminal conflict', async () => {
  const artifact = await compileArtifact('plan-dispatch-foreign');
  const row = rowFor(artifact);
  const outbox = new MemoryPlanEventOutbox();
  outbox.seed(row);
  const { dispatcher, eventStore } = dispatcherFor(outbox);
  const projector = new AgentSemanticEventProjector(eventStore);
  await projector.project({
    ...(row.payload as object),
    resourceId: 'ws-foreign',
  } as never);

  const result = await dispatcher.runOnce();
  assert.equal(result.deadLettered, 1);
  assert.match(
    outbox.rows.get(row.eventId)?.lastError ?? '',
    /AGENT_SEMANTIC_EVENT_CONFLICT/u,
  );
});

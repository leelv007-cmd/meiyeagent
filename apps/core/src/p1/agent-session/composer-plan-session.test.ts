import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { AgentSemanticEventProjector } from '../agent-semantic-events/semantic-event-projector.js';
import { MemoryAgentSemanticEventStore } from '../agent-semantic-events/memory-semantic-event-store.js';
import { PostgresAgentSemanticEventStore } from '../agent-semantic-events/postgres-semantic-event-store.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import {
  ComposerPlanSessionCoordinator,
  proposalFromSubmission,
} from './composer-plan-session.js';
import { MemoryAgentSessionStore } from './memory-agent-session-store.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import { PostgresAgentSessionStore } from './postgres-agent-session-store.js';
import { PostgresMarketingPlanStore } from './postgres-plan-store.js';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from './plan-compiler.js';

const TS = '2026-08-09T08:00:00.000Z';
const connectionString = process.env.TEST_DATABASE_URL;

test('Composer submission creates/reuses Thread+Run and appends real plan semantic revisions', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const eventStore = new MemoryAgentSemanticEventStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
    semanticEvents: new AgentSemanticEventProjector(eventStore),
  });
  let tick = 0;
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
    },
    { now: () => new Date(Date.parse(TS) + tick++ * 1_000).toISOString() }
  );

  const first = record('task-1', '先做一组奶油风美甲图文');
  const firstBinding = await coordinator.prepare({ submission: first });
  const replayedBinding = await coordinator.prepare({ submission: first });

  assert.deepEqual(replayedBinding, firstBinding);
  assert.equal(
    (
      await sessions.listRuns({
        resourceId: 'workspace-1',
        threadId: firstBinding.threadId,
      })
    ).length,
    1
  );
  let events = await eventStore.listByThread({
    resourceId: 'workspace-1',
    threadId: firstBinding.threadId,
  });
  assert.deepEqual(
    events.map((event) => event.eventType),
    ['plan.created']
  );

  const adjusted = record('task-2', '只做小红书，减到 4 页');
  const adjustedBinding = await coordinator.prepare({
    continuationThreadId: firstBinding.threadId,
    submission: adjusted,
  });

  assert.equal(adjustedBinding.threadId, firstBinding.threadId);
  assert.notEqual(adjustedBinding.runId, firstBinding.runId);
  events = await eventStore.listByThread({
    resourceId: 'workspace-1',
    threadId: firstBinding.threadId,
  });
  assert.deepEqual(
    events.map((event) => event.eventType),
    ['plan.created', 'plan.revised']
  );
  assert.deepEqual(
    events.map((event) => (event.payload as { revision: number }).revision),
    [1, 2]
  );
  assert.equal(
    proposalFromSubmission(adjusted).recommendedDeliverables[0]?.quantity,
    4
  );
});

test('a continuation Thread is resolved inside the submission workspace', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const first = await coordinator.prepare({
    submission: record('task-a', 'A'),
  });

  await assert.rejects(
    () =>
      coordinator.prepare({
        continuationThreadId: first.threadId,
        submission: record('task-b', 'B', 'workspace-2'),
      }),
    /already exists for another resource/u
  );
});

test(
  'Postgres submission boundary durably reuses Thread+Run and appends plan revisions',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const workspaceId = `workspace-composer-${randomUUID()}`;
    const sessions = new PostgresAgentSessionStore(pool);
    const plans = new PostgresMarketingPlanStore(pool);
    const events = new PostgresAgentSemanticEventStore(pool);
    let threadId: string | undefined;
    try {
      await sessions.migrate();
      await plans.migrate();
      await events.migrate();
      const compiler = new PlanCompiler({
        store: plans,
        ports: createFixturePlanCompilerPorts(),
        semanticEvents: new AgentSemanticEventProjector(events),
      });
      const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
        compilePlan: (input) => compiler.compile(input),
        adjustPlan: (input) => compiler.adjust(input),
      });
      const first = record(
        `task-${randomUUID()}`,
        '先做 6 页小红书图文',
        workspaceId
      );
      const created = await coordinator.prepare({ submission: first });
      threadId = created.threadId;
      const replayed = await coordinator.prepare({
        continuationThreadId: 'ignored-after-binding',
        submission: first,
      });
      const revised = await coordinator.prepare({
        continuationThreadId: created.threadId,
        submission: record(
          `task-${randomUUID()}`,
          '只做小红书，减到 4 页',
          workspaceId
        ),
      });

      assert.deepEqual(replayed, created);
      assert.equal(revised.threadId, created.threadId);
      assert.equal(
        (await sessions.listRuns({ resourceId: workspaceId, threadId })).length,
        2
      );
      const projected = await events.listByThread({
        resourceId: workspaceId,
        threadId,
      });
      assert.deepEqual(
        projected.map(({ eventType }) => eventType),
        ['plan.created', 'plan.revised']
      );
      assert.equal(
        (projected[1]?.payload as { deliverables: Array<{ quantity: number }> })
          .deliverables[0]?.quantity,
        4
      );
    } finally {
      await pool
        .query('DELETE FROM p1_agent_semantic_events WHERE resource_id = $1', [
          workspaceId,
        ])
        .catch(() => undefined);
      if (threadId) {
        await pool
          .query(
            'DELETE FROM p1_marketing_plan_revisions WHERE thread_id = $1',
            [threadId]
          )
          .catch(() => undefined);
      }
      await pool
        .query('DELETE FROM p1_agent_threads WHERE resource_id = $1', [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool.end();
    }
  }
);

function record(
  taskId: string,
  intent: string,
  workspaceId = 'workspace-1'
): CreationSubmissionRecord {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId,
      idempotencyKey: `submission-${taskId}`,
      taskId,
      workId: `work-${taskId}`,
      contentPackageId: `package-${taskId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent,
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'image_text_note',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'manual_copy',
      deliverable: {
        kind: 'image_set',
        quantity: 6,
        aspectRatio: '3:4',
        notePageBound: 6,
      },
      deliverables: [
        {
          id: 'note-main',
          kind: 'image_text_note',
          order: 0,
          quantity: 6,
          aspectRatio: '3:4',
          notePageBound: 6,
        },
      ],
      sources: {
        assets: [{ id: 'asset-case-1', revision: 'asset-r1', role: 'source' }],
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-1',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: `quote-${taskId}`, revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: `context-${taskId}`, revision: 1 },
      contentModules: ['social_cover'],
    },
    TS
  );
  return {
    snapshot,
    task: { id: taskId },
    work: { id: `work-${taskId}` },
    contentPackage: { id: `package-${taskId}`, expectedRevision: 0 },
    usageReservation: { id: `usage-${taskId}`, credits: 8, units: [] },
  };
}

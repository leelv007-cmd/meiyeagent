/**
 * Behavioural conformance suite for AgentSessionStore implementations (V31-02).
 *
 * Every case asserts store-boundary behaviour only, so the in-memory and
 * PostgreSQL implementations cannot drift on the V3.1 §9/§10/§27.6 invariants.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentSessionError, type AgentSessionStore } from './agent-session-store.js';

export type AgentSessionStoreFixture = {
  store: AgentSessionStore;
  resourceId: string;
  dispose: () => Promise<void>;
};

export type AgentSessionStoreConformanceInput = {
  label: string;
  /** Reason string skips the whole suite (environment-gated PostgreSQL runs). */
  skip?: string | false;
  createFixture: (caseName: string) => Promise<AgentSessionStoreFixture>;
};

const RELEASE_ID = 'harness-release-v1';

export function runAgentSessionStoreConformance(
  input: AgentSessionStoreConformanceInput,
): void {
  const skip = input.skip ?? false;

  const conformanceTest = (
    name: string,
    body: (fixture: AgentSessionStoreFixture) => Promise<void>,
  ) => {
    test(`${input.label}: ${name}`, { skip }, async () => {
      const fixture = await input.createFixture(name);
      try {
        await body(fixture);
      } finally {
        await fixture.dispose();
      }
    });
  };

  conformanceTest(
    'recent threads project newest activity first within one resource',
    async ({ store, resourceId }) => {
      await store.createThread({
        resourceId,
        threadId: `${resourceId}-thread-a`,
        title: '8 月新客引流',
        now: '2026-08-08T00:00:00.000Z',
      });
      await store.createThread({
        resourceId,
        threadId: `${resourceId}-thread-b`,
        title: '门店周年活动',
        now: '2026-08-08T00:01:00.000Z',
      });
      await store.startWriteTurn({
        resourceId,
        threadId: `${resourceId}-thread-a`,
        expectedSessionRevision: 0,
        runId: `${resourceId}-run-a1`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T00:02:00.000Z',
      });

      const recent = await store.listRecentThreads({ resourceId });
      assert.deepEqual(
        recent.map((thread) => thread.threadId),
        [`${resourceId}-thread-a`, `${resourceId}-thread-b`],
      );
      assert.equal(recent[0]?.sessionRevision, 1);
      assert.equal(recent[0]?.lastRunAt, '2026-08-08T00:02:00.000Z');
      assert.equal(recent[1]?.lastRunAt, undefined);

      const foreign = await store.listRecentThreads({
        resourceId: `${resourceId}-other`,
      });
      assert.deepEqual(foreign, []);
      assert.equal(
        await store.getThread({
          resourceId: `${resourceId}-other`,
          threadId: `${resourceId}-thread-a`,
        }),
        null,
      );
    },
  );

  conformanceTest(
    'creating the same thread twice replays and a foreign thread id is refused',
    async ({ store, resourceId }) => {
      const create = {
        resourceId,
        threadId: `${resourceId}-thread-replay`,
        title: '重复创建',
        now: '2026-08-08T00:10:00.000Z',
      };
      const first = await store.createThread(create);
      const replay = await store.createThread({
        ...create,
        title: '重复创建（第二次）',
        now: '2026-08-08T00:11:00.000Z',
      });
      assert.deepEqual(replay, first);

      const taken = await rejection(
        store.createThread({ ...create, resourceId: `${resourceId}-other` }),
      );
      assert.ok(taken instanceof AgentSessionError);
      assert.equal(taken.code, 'AGENT_THREAD_ID_TAKEN');
      assert.equal(taken.status, 409);
    },
  );

  conformanceTest(
    'legacy Work lazily opens one thread and reopening returns the same thread',
    async ({ store, resourceId }) => {
      const first = await store.openLegacyWorkThread({
        resourceId,
        legacyWorkId: `${resourceId}-work-legacy`,
        threadId: `${resourceId}-thread-legacy`,
        title: '历史作品',
        now: '2026-08-08T01:00:00.000Z',
      });
      assert.equal(first.created, true);
      assert.equal(first.thread.sessionRevision, 0);

      const reopened = await store.openLegacyWorkThread({
        resourceId,
        legacyWorkId: `${resourceId}-work-legacy`,
        threadId: `${resourceId}-thread-legacy-second-attempt`,
        title: '历史作品（第二次打开）',
        now: '2026-08-08T02:00:00.000Z',
      });
      assert.equal(reopened.created, false);
      assert.equal(reopened.thread.threadId, first.thread.threadId);
      assert.equal(reopened.thread.title, '历史作品');

      const otherWork = await store.openLegacyWorkThread({
        resourceId,
        legacyWorkId: `${resourceId}-work-legacy-2`,
        threadId: `${resourceId}-thread-legacy-2`,
        title: '另一件历史作品',
        now: '2026-08-08T03:00:00.000Z',
      });
      assert.equal(otherWork.created, true);
      assert.equal(
        (await store.listRecentThreads({ resourceId })).length,
        2,
      );
    },
  );

  conformanceTest(
    'one thread carries several Works through sync child runs',
    async ({ store, resourceId }) => {
      const threadId = `${resourceId}-thread-multi`;
      await store.createThread({
        resourceId,
        threadId,
        title: '多个 Work 的会话',
        now: '2026-08-08T04:00:00.000Z',
      });

      for (const index of [1, 2]) {
        await store.startWriteTurn({
          resourceId,
          threadId,
          expectedSessionRevision: index - 1,
          runId: `${resourceId}-turn-${index}`,
          trigger: 'merchant_turn',
          harnessReleaseId: RELEASE_ID,
          now: `2026-08-08T05:0${index}:00.000Z`,
        });
        await store.linkExecutionRun({
          resourceId,
          parentRunId: `${resourceId}-turn-${index}`,
          runId: `${resourceId}-execution-${index}`,
          workflowId: `workflow-${index}`,
          snapshotHash: `snapshot-hash-${index}`,
          now: `2026-08-08T05:0${index}:30.000Z`,
        });
        await store.updateRunStatus({
          resourceId,
          runId: `${resourceId}-execution-${index}`,
          status: 'completed',
          finishedAt: `2026-08-08T05:0${index}:50.000Z`,
        });
        await store.updateRunStatus({
          resourceId,
          runId: `${resourceId}-turn-${index}`,
          status: 'completed',
          finishedAt: `2026-08-08T05:0${index}:55.000Z`,
        });
      }

      const runs = await store.listRuns({ resourceId, threadId });
      const executions = runs
        .filter((run) => run.durability === 'sync')
        .map((run) => run.executionLink?.workflowId);
      assert.deepEqual(executions, ['workflow-1', 'workflow-2']);
      assert.equal(runs.length, 4);
      assert.equal(
        (await store.getThread({ resourceId, threadId }))?.sessionRevision,
        2,
      );
    },
  );

  conformanceTest(
    'a stale second device is refused with the current session revision',
    async ({ store, resourceId }) => {
      const threadId = `${resourceId}-thread-occ`;
      await store.createThread({
        resourceId,
        threadId,
        title: '双端并发',
        now: '2026-08-08T06:00:00.000Z',
      });
      const desktop = await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 0,
        runId: `${resourceId}-run-desktop`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T06:01:00.000Z',
      });
      assert.equal(desktop.thread.sessionRevision, 1);
      assert.equal(desktop.run.durability, 'exit');
      assert.equal(desktop.run.status, 'running');

      const stale = await rejection(
        store.startWriteTurn({
          resourceId,
          threadId,
          expectedSessionRevision: 0,
          runId: `${resourceId}-run-mobile`,
          trigger: 'merchant_turn',
          harnessReleaseId: RELEASE_ID,
          now: '2026-08-08T06:01:30.000Z',
        }),
      );
      assert.ok(stale instanceof AgentSessionError);
      assert.equal(stale.code, 'AGENT_SESSION_REVISION_CONFLICT');
      assert.equal(stale.status, 409);
      assert.equal(stale.details.currentSessionRevision, 1);
      assert.equal(await store.getRun({ resourceId, runId: `${resourceId}-run-mobile` }), null);

      const inFlight = await rejection(
        store.startWriteTurn({
          resourceId,
          threadId,
          expectedSessionRevision: 1,
          runId: `${resourceId}-run-mobile-fresh`,
          trigger: 'merchant_turn',
          harnessReleaseId: RELEASE_ID,
          now: '2026-08-08T06:02:00.000Z',
        }),
      );
      assert.ok(inFlight instanceof AgentSessionError);
      assert.equal(inFlight.code, 'AGENT_ACTIVE_TURN_CONFLICT');
      assert.equal(inFlight.status, 409);
      assert.equal(inFlight.details.currentSessionRevision, 1);
      assert.equal(inFlight.details.activeRunId, `${resourceId}-run-desktop`);

      await store.updateRunStatus({
        resourceId,
        runId: `${resourceId}-run-desktop`,
        status: 'completed',
        finishedAt: '2026-08-08T06:03:00.000Z',
      });
      const next = await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 1,
        runId: `${resourceId}-run-mobile-next`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T06:04:00.000Z',
      });
      assert.equal(next.thread.sessionRevision, 2);
    },
  );

  conformanceTest(
    'a waiting turn still owns the thread until it reaches a terminal state',
    async ({ store, resourceId }) => {
      const threadId = `${resourceId}-thread-waiting`;
      await store.createThread({
        resourceId,
        threadId,
        title: '等待确认',
        now: '2026-08-08T07:00:00.000Z',
      });
      await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 0,
        runId: `${resourceId}-run-waiting`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T07:01:00.000Z',
      });
      const waiting = await store.updateRunStatus({
        resourceId,
        runId: `${resourceId}-run-waiting`,
        status: 'waiting',
      });
      assert.equal(waiting.status, 'waiting');
      assert.equal(waiting.finishedAt, undefined);

      const blocked = await rejection(
        store.startWriteTurn({
          resourceId,
          threadId,
          expectedSessionRevision: 1,
          runId: `${resourceId}-run-second`,
          trigger: 'merchant_turn',
          harnessReleaseId: RELEASE_ID,
          now: '2026-08-08T07:02:00.000Z',
        }),
      );
      assert.ok(blocked instanceof AgentSessionError);
      assert.equal(blocked.code, 'AGENT_ACTIVE_TURN_CONFLICT');

      const cancelled = await store.updateRunStatus({
        resourceId,
        runId: `${resourceId}-run-waiting`,
        status: 'cancelled',
        finishedAt: '2026-08-08T07:03:00.000Z',
      });
      assert.equal(cancelled.status, 'cancelled');
      const replayed = await store.updateRunStatus({
        resourceId,
        runId: `${resourceId}-run-waiting`,
        status: 'cancelled',
        finishedAt: '2026-08-08T07:03:00.000Z',
      });
      assert.equal(replayed.finishedAt, '2026-08-08T07:03:00.000Z');
      const contradiction = await rejection(
        store.updateRunStatus({
          resourceId,
          runId: `${resourceId}-run-waiting`,
          status: 'completed',
          finishedAt: '2026-08-08T07:04:00.000Z',
        }),
      );
      assert.ok(contradiction instanceof AgentSessionError);
      assert.equal(contradiction.code, 'AGENT_RUN_STATE_CONFLICT');
    },
  );

  conformanceTest(
    'a running sync execution does not lock the thread once its turn ended',
    async ({ store, resourceId }) => {
      const threadId = `${resourceId}-thread-background`;
      await store.createThread({
        resourceId,
        threadId,
        title: '后台付费执行',
        now: '2026-08-08T07:30:00.000Z',
      });
      await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 0,
        runId: `${resourceId}-turn-background`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T07:31:00.000Z',
      });
      await store.linkExecutionRun({
        resourceId,
        parentRunId: `${resourceId}-turn-background`,
        runId: `${resourceId}-execution-background`,
        workflowId: 'workflow-background',
        snapshotHash: 'snapshot-hash-background',
        now: '2026-08-08T07:32:00.000Z',
      });
      await store.updateRunStatus({
        resourceId,
        runId: `${resourceId}-turn-background`,
        status: 'completed',
        finishedAt: '2026-08-08T07:33:00.000Z',
      });

      const next = await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 1,
        runId: `${resourceId}-turn-next`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T07:34:00.000Z',
      });
      assert.equal(next.thread.sessionRevision, 2);
      assert.equal(
        (
          await store.getRun({
            resourceId,
            runId: `${resourceId}-execution-background`,
          })
        )?.status,
        'running',
      );
    },
  );

  conformanceTest(
    'summary compaction never arbitrates concurrency',
    async ({ store, resourceId }) => {
      const threadId = `${resourceId}-thread-summary`;
      await store.createThread({
        resourceId,
        threadId,
        title: '摘要与并发分离',
        now: '2026-08-08T08:00:00.000Z',
      });
      const summarized = await store.recordThreadSummary({
        resourceId,
        threadId,
        summary: '最近在做新客引流',
        now: '2026-08-08T08:01:00.000Z',
      });
      assert.equal(summarized.summaryRevision, 1);
      assert.equal(summarized.sessionRevision, 0);
      assert.equal(summarized.summary, '最近在做新客引流');

      const turn = await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 0,
        runId: `${resourceId}-run-after-summary`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T08:02:00.000Z',
      });
      assert.equal(turn.thread.sessionRevision, 1);
      assert.equal(turn.thread.summaryRevision, 1);

      const resummarized = await store.recordThreadSummary({
        resourceId,
        threadId,
        summary: '新客引流 + 周年活动',
        now: '2026-08-08T08:03:00.000Z',
      });
      assert.equal(resummarized.summaryRevision, 2);
      assert.equal(resummarized.sessionRevision, 1);
    },
  );

  conformanceTest(
    'a sync child run freezes workflowId and snapshotHash and replays once',
    async ({ store, resourceId }) => {
      const threadId = `${resourceId}-thread-handoff`;
      await store.createThread({
        resourceId,
        threadId,
        title: '付费执行交接',
        now: '2026-08-08T09:00:00.000Z',
      });
      await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 0,
        runId: `${resourceId}-turn`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T09:01:00.000Z',
      });

      const link = {
        resourceId,
        parentRunId: `${resourceId}-turn`,
        runId: `${resourceId}-child`,
        workflowId: 'workflow-paid-1',
        snapshotHash: 'snapshot-hash-1',
        now: '2026-08-08T09:02:00.000Z',
      };
      const created = await store.linkExecutionRun(link);
      assert.equal(created.replayed, false);
      assert.equal(created.run.durability, 'sync');
      assert.equal(created.run.parentRunId, `${resourceId}-turn`);
      assert.equal(created.run.harnessReleaseId, RELEASE_ID);
      assert.deepEqual(created.run.executionLink, {
        workflowId: 'workflow-paid-1',
        snapshotHash: 'snapshot-hash-1',
      });

      // Crash window: the handoff is retried with a freshly minted run id.
      const replay = await store.linkExecutionRun({
        ...link,
        runId: `${resourceId}-child-retry`,
        now: '2026-08-08T09:03:00.000Z',
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.run.runId, `${resourceId}-child`);
      assert.equal(replay.run.startedAt, '2026-08-08T09:02:00.000Z');
      assert.equal(
        (await store.listRuns({ resourceId, threadId })).filter(
          (run) => run.durability === 'sync',
        ).length,
        1,
      );

      const divergent = await rejection(
        store.linkExecutionRun({
          ...link,
          runId: `${resourceId}-child-other`,
          workflowId: 'workflow-paid-2',
          now: '2026-08-08T09:04:00.000Z',
        }),
      );
      assert.ok(divergent instanceof AgentSessionError);
      assert.equal(divergent.code, 'AGENT_RUN_LINK_CONFLICT');
      assert.equal(divergent.status, 409);
      assert.equal(divergent.details.currentWorkflowId, 'workflow-paid-1');

      const finished = await store.updateRunStatus({
        resourceId,
        runId: `${resourceId}-child`,
        status: 'completed',
        finishedAt: '2026-08-08T09:05:00.000Z',
      });
      assert.equal(finished.durability, 'sync');
      assert.deepEqual(finished.executionLink, {
        workflowId: 'workflow-paid-1',
        snapshotHash: 'snapshot-hash-1',
      });
    },
  );

  conformanceTest(
    'writes to a missing or foreign thread are refused',
    async ({ store, resourceId }) => {
      const threadId = `${resourceId}-thread-scope`;
      await store.createThread({
        resourceId,
        threadId,
        title: '租户隔离',
        now: '2026-08-08T10:00:00.000Z',
      });
      const turn = await store.startWriteTurn({
        resourceId,
        threadId,
        expectedSessionRevision: 0,
        runId: `${resourceId}-run-scope`,
        trigger: 'merchant_turn',
        harnessReleaseId: RELEASE_ID,
        now: '2026-08-08T10:01:00.000Z',
      });
      assert.ok(turn.run);

      const missing = await rejection(
        store.startWriteTurn({
          resourceId,
          threadId: `${resourceId}-thread-absent`,
          expectedSessionRevision: 0,
          runId: `${resourceId}-run-absent`,
          trigger: 'merchant_turn',
          harnessReleaseId: RELEASE_ID,
          now: '2026-08-08T10:02:00.000Z',
        }),
      );
      assert.ok(missing instanceof AgentSessionError);
      assert.equal(missing.code, 'AGENT_THREAD_NOT_FOUND');
      assert.equal(missing.status, 404);

      const foreign = await rejection(
        store.startWriteTurn({
          resourceId: `${resourceId}-other`,
          threadId,
          expectedSessionRevision: 0,
          runId: `${resourceId}-run-foreign`,
          trigger: 'merchant_turn',
          harnessReleaseId: RELEASE_ID,
          now: '2026-08-08T10:03:00.000Z',
        }),
      );
      assert.ok(foreign instanceof AgentSessionError);
      assert.equal(foreign.code, 'AGENT_THREAD_NOT_FOUND');

      assert.equal(
        await store.getRun({
          resourceId: `${resourceId}-other`,
          runId: `${resourceId}-run-scope`,
        }),
        null,
      );
      assert.deepEqual(
        await store.listRuns({
          resourceId: `${resourceId}-other`,
          threadId,
        }),
        [],
      );
      const foreignLink = await rejection(
        store.linkExecutionRun({
          resourceId: `${resourceId}-other`,
          parentRunId: `${resourceId}-run-scope`,
          runId: `${resourceId}-child-foreign`,
          workflowId: 'workflow-foreign',
          snapshotHash: 'snapshot-hash-foreign',
          now: '2026-08-08T10:04:00.000Z',
        }),
      );
      assert.ok(foreignLink instanceof AgentSessionError);
      assert.equal(foreignLink.code, 'AGENT_RUN_NOT_FOUND');
    },
  );
}

async function rejection(promise: Promise<unknown>): Promise<AgentSessionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AgentSessionError) return error;
    throw error;
  }
  throw new assert.AssertionError({
    message: 'Expected the store call to reject with an AgentSessionError.',
  });
}

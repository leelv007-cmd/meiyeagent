/**
 * ARCH-07A: ComposerHome mounts three host controllers. Behavior of the public
 * seams (thread accept/interrupt, workbench SSE, ResultAction delivery) plus a
 * deletion gate so inlining a wrapper cannot shove the same writes back.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import { subscribeAgentSemanticEvents } from '@/product/agent-workbench/agent-event-transport';
import { createAgentEventStore } from '@/product/agent-workbench/agent-event-store';
import type { WorkbenchSessionProjection } from '@/product/agent-workbench/agent-event-reducer';
import {
  executeResultActionWrite,
  resultActionForRevision,
} from '@/product/results/result-action';

import {
  hasCall,
  hasValueImport,
  identifiers,
  jsxOf,
  parseProductionSource,
  propertyValues,
} from '../../test-support/ast-boundary';
import {
  bindComposerTask,
  createComposerSession,
  openComposerTurn,
} from './composer-session';
import { submitComposerSubmission } from './composer-submission-client';
import { planComposerDeliveryOpen } from './use-composer-delivery-controller';
import { readComposerThreadSession } from './use-composer-thread-controller';
import {
  composerWorkbenchHostBindings,
  type ComposerWorkbenchPublishHandoff,
} from './use-composer-workbench-controller';

const TS = '2026-08-20T08:00:00.000Z';
const THREAD = 'thread-arch07a';
const TASK = {
  taskId: 'task-07a',
  workId: 'work-07a',
  packageId: 'package-07a',
  agentThreadId: THREAD,
  agentRunId: 'run-07a',
};

const HOME = new URL('./composer-home.tsx', import.meta.url);
const THREAD_CONTROLLER = new URL(
  './use-composer-thread-controller.ts',
  import.meta.url
);
const WORKBENCH_CONTROLLER = new URL(
  './use-composer-workbench-controller.tsx',
  import.meta.url
);
const DELIVERY_CONTROLLER = new URL(
  './use-composer-delivery-controller.ts',
  import.meta.url
);
const ADAPTER = new URL('./composer-thread-adapter.ts', import.meta.url);
const WORKS_DETAIL = new URL('../works/works-detail-page.tsx', import.meta.url);

function session(
  overrides: Partial<WorkbenchSessionProjection> = {}
): WorkbenchSessionProjection {
  return {
    resourceId: 'workspace-07a',
    threadId: THREAD,
    sessionRevision: 1,
    activeRunId: TASK.agentRunId,
    current: { taskId: TASK.taskId, workId: TASK.workId },
    ...overrides,
  };
}

function wire(input: {
  eventId: string;
  eventType: string;
  payload?: unknown;
  streamOffset: string;
}): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    threadId: THREAD,
    contextRole: 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: TASK.agentRunId,
    sourceRevision: '1',
    correlationId: 'corr-07a',
    payload: input.payload ?? {
      taskId: TASK.taskId,
      runId: TASK.agentRunId,
      workId: TASK.workId,
    },
    occurredAt: TS,
    eventId: input.eventId,
    streamOffset: input.streamOffset,
    eventType: input.eventType,
  });
}

function localComposer() {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-07a'), '写一条周末预约'),
    TASK
  );
}

function hydrateThread() {
  const store = createAgentEventStore();
  store.dispatch({
    type: 'hydrate_replay',
    session: session({
      current: undefined,
      recent: { taskId: TASK.taskId, workId: TASK.workId },
    }),
    snapshot: {
      revision: '0',
      lastEventId: null,
      lastStreamOffset: null,
    },
    events: [],
    recentTaskId: TASK.taskId,
  });
  return store;
}

function emptyHandoff(): ComposerWorkbenchPublishHandoff {
  return {
    onPublishHandoffCopy: () => false,
    onPublishHandoffDownloadZip: async () => undefined,
    onPublishHandoffRecordPublished: async () => undefined,
    onSelfReportChip: async () => undefined,
    onSelfReportIgnore: async () => undefined,
    publishHandoffError: null,
    publishHandoffView: null,
    selfReportChips: undefined,
    selfReportPrompt: null,
  };
}

const acceptedEnvelope = {
  data: {
    contentPackage: { expectedRevision: 0, id: 'package-202' },
    replayed: false,
    makeReady: true,
    runId: 'run-202',
    snapshot: {
      id: 'snapshot-task-202',
      identity: { id: 'identity-brand', revision: '2' },
      schemaVersion: 'creation-execution-snapshot/v1',
    },
    task: { id: 'task-202' },
    threadId: 'thread-202',
    usageReservation: { id: 'usage-task-202' },
    work: { id: 'work-202' },
  },
  meta: { correlationId: 'corr-202' },
};

function submissionBody() {
  return {
    briefConfirmation: { id: 'brief-confirm-1', revision: 'draft-r3' },
    briefContext: { id: 'brief-context-1', revision: 3 },
    catalogModel: { id: 'catalog-copy-1', revision: 'catalog-r4' },
    contentPackagePlatform: 'douyin' as const,
    distributionTarget: 'export' as const,
    deliverable: { kind: 'copy_document' as const, quantity: 1 },
    creationMode: 'customized' as const,
    identity: { id: 'identity-brand', revision: '2' },
    idempotencyKey: 'composer-submit-202',
    intent: '写一条夏日护理预约文案',
    quote: { id: 'quote-1', revision: 'quote-r2' },
    recipe: { id: 'recipe-summer', revision: 'recipe-summer@2' },
    sources: {
      assets: [
        {
          id: 'asset-store-1',
          revision: 'sha256-r1',
          role: 'reference' as const,
        },
      ],
    },
    surface: {
      id: 'surface.home.launch',
      revision: 'surface.home.launch@3',
    },
  };
}

test('thread controller: one interrupt overlays awaiting_answer without writing local', () => {
  const store = hydrateThread();
  const local = localComposer();
  const frozen = structuredClone(local);
  store.dispatch({
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-interrupt',
      streamOffset: '1',
      eventType: 'interrupt.requested',
      payload: {
        interruptId: 'composer-question:1',
        interruptType: 'answer_question',
        description: '请补充',
        revision: 1,
      },
    }),
  });
  const view = readComposerThreadSession(local, store.getState());
  assert.deepEqual(local, frozen);
  assert.equal(view.session.phase, 'awaiting_answer');
  assert.equal(view.pendingClarification?.interruptId, 'composer-question:1');
  assert.equal(view.pendingInterruptGate.blocked, false);
  assert.equal(view.thread.taskId, TASK.taskId);
});

test('thread controller: one accepted event is one running overlay', () => {
  const store = hydrateThread();
  const local = localComposer();
  const frozen = structuredClone(local);
  store.dispatch({
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-accepted',
      streamOffset: '1',
      eventType: 'accepted',
    }),
  });
  const view = readComposerThreadSession(local, store.getState());
  assert.deepEqual(local, frozen);
  assert.equal(view.thread.turnPhase, 'accepted');
  assert.equal(view.session.phase, 'running');
});

test('thread submit treats HTTP 202 as the accepted binding', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(acceptedEnvelope, { status: 202 });
  try {
    const result = await submitComposerSubmission(submissionBody());
    assert.equal(result.threadId, 'thread-202');
    assert.equal(result.runId, 'run-202');
    assert.equal(result.task.id, 'task-202');
    assert.equal(result.work.id, 'work-202');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('workbench controller always injects live SSE subscribe', () => {
  const host = composerWorkbenchHostBindings({
    accountId: 'acct-1',
    explicitThreadId: THREAD,
    explicitTaskId: TASK.taskId,
    publishHandoff: emptyHandoff(),
    workspaceId: 'workspace-07a',
  });
  assert.equal(host.subscribeLive, subscribeAgentSemanticEvents);
  assert.equal(host.enableIdleGoalProactive, false);
  assert.equal(host.explicitThreadId, THREAD);
  assert.equal(host.accountId, 'acct-1');
  assert.equal(host.sessionDelivered, false);
});

test('workbench controller forwards composer session delivery to the host', () => {
  const host = composerWorkbenchHostBindings({
    accountId: 'acct-1',
    explicitThreadId: THREAD,
    publishHandoff: emptyHandoff(),
    sessionDelivered: true,
    workspaceId: 'workspace-07a',
  });
  assert.equal(host.sessionDelivered, true);
});

test('deleting the workbench wrapper does not let the host invent SSE', () => {
  const passThrough = (props: Record<string, unknown>) => props;
  assert.equal(
    passThrough({ accountId: 'acct-1', workspaceId: 'ws-1' }).subscribeLive,
    undefined
  );
  const production = composerWorkbenchHostBindings({
    accountId: 'acct-1',
    publishHandoff: emptyHandoff(),
    workspaceId: 'ws-1',
  });
  assert.equal(production.subscribeLive, subscribeAgentSemanticEvents);
});

test('delivery controller mints ResultAction and does not execute the write', async () => {
  const planned = planComposerDeliveryOpen({
    action: 'export',
    revision: {
      packageId: 'package-note',
      revision: 3,
      versionId: 'version-1',
    },
    taskId: 'task-note',
    workId: 'work-note',
  });
  assert.equal(planned.kind, 'result_action');
  if (planned.kind !== 'result_action') return;
  assert.equal(planned.plan.writer, 'result');
  assert.equal(planned.to, '/dashboard/results/$workId');
  assert.equal(planned.params.workId, 'work-note');
  assert.deepEqual(
    planned.plan,
    resultActionForRevision(
      {
        contentId: 'package-note',
        revision: 3,
        versionId: 'version-1',
        workId: 'work-note',
      },
      'export'
    )
  );
  assert.equal(planned.plan.write, null);
  await assert.rejects(
    () =>
      executeResultActionWrite(planned.plan, async () => {
        throw new Error('Composer delivery must not write result_export');
      }),
    /no Result write/
  );
});

test('delivery open (no revision) is a Result Center navigation, writer result', () => {
  const planned = planComposerDeliveryOpen({
    action: 'open',
    revision: null,
    taskId: 'task-note',
    workId: 'work-note',
  });
  assert.equal(planned.kind, 'result_center');
  if (planned.kind !== 'result_center') return;
  assert.equal(planned.writer, 'result');
  assert.equal(planned.search.panel, 'run');
});

test('ARCH-07A deletion: ComposerHome mounts controllers and does not own the seams', () => {
  const home = parseProductionSource(HOME);
  const thread = parseProductionSource(THREAD_CONTROLLER);
  const workbench = parseProductionSource(WORKBENCH_CONTROLLER);
  const delivery = parseProductionSource(DELIVERY_CONTROLLER);
  const adapter = parseProductionSource(ADAPTER);
  const works = parseProductionSource(WORKS_DETAIL);

  assert.equal(hasCall(home, 'readComposerThreadSession'), true);
  assert.equal(hasCall(home, 'useComposerThreadController'), true);
  assert.equal(jsxOf(home, 'ComposerWorkbenchHost').length, 1);
  assert.equal(hasCall(home, 'useComposerDeliveryController'), true);

  assert.equal(hasCall(home, 'useComposerRun'), false);
  assert.equal(hasCall(home, 'projectComposerSessionFromThread'), false);
  assert.equal(hasCall(home, 'usePublishHandoff'), false);
  assert.equal(hasCall(home, 'resultActionForRevision'), false);
  assert.equal(hasValueImport(home, 'subscribeAgentSemanticEvents'), false);
  assert.equal(jsxOf(home, 'AgentWorkbenchHost').length, 0);

  assert.equal(hasCall(thread, 'useComposerRun'), true);
  assert.equal(hasCall(thread, 'projectComposerSessionFromThread'), true);
  assert.ok(
    propertyValues(workbench, 'subscribeLive').includes(
      'subscribeAgentSemanticEvents'
    )
  );
  assert.equal(hasCall(delivery, 'usePublishHandoff'), true);
  assert.equal(hasCall(delivery, 'resultActionForRevision'), true);
  assert.equal(hasCall(delivery, 'executeResultActionWrite'), false);

  assert.equal(identifiers(adapter).has('setSession'), false);
  assert.equal(hasValueImport(works, 'useComposerDeliveryController'), false);
  assert.equal(hasCall(works, 'executeResultActionWrite'), false);
  assert.equal(identifiers(works).has('result_export'), false);
});

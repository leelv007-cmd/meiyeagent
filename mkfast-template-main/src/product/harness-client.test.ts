import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readHarnessDecisionSnapshot,
  readHarnessSubmitResult,
  readTodayRecommendation,
  submitHarnessTask,
} from '@/product/harness-client';

test('treats an unknown task as absent without inventing a local question', async () => {
  const snapshot = await readHarnessDecisionSnapshot(
    new Response(
      JSON.stringify({ error: { code: 'HARNESS_TASK_NOT_FOUND' } }),
      {
        status: 404,
      }
    )
  );

  assert.deepEqual(snapshot, { exists: false, question: null });
});

test('submits one validated harness task to the collection boundary', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return Response.json({
      data: { workflowId: 'work-1', replayed: false },
    });
  };
  try {
    assert.deepEqual(
      await submitHarnessTask({
        taskId: 'work-1',
        packageId: 'package-1',
        expectedRevision: 0,
        workflowRevision: 1,
        creationMode: 'customized',
        rawInput: '把新团购做一套能发的',
        intent: {
          assetReferences: ['asset-1'],
          context: {
            workId: 'work-1',
            intent: '把新团购做一套能发的',
            sourceSummaries: [],
          },
        },
      }),
      { workflowId: 'work-1', replayed: false }
    );
    assert.equal(request?.url, 'http://localhost/api/core/p1/harness/tasks');
    assert.equal(request?.method, 'POST');
    assert.equal(request?.headers.get('idempotency-key'), 'work-1');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('reads a persisted current recommendation without accepting a stale revision', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: {
        workspaceId: 'workspace-1',
        currentFactsRevision: 2,
        recommendation: null,
        stale: true,
      },
    });
  try {
    assert.deepEqual(await readTodayRecommendation(), {
      workspaceId: 'workspace-1',
      currentFactsRevision: 2,
      recommendation: null,
      stale: true,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('parses the server-owned question target and persisted submit receipt', async () => {
  const question = {
    questionId: 'question-1',
    workflowId: 'task-1',
    workflowRevision: 3,
    question: '这次团购价按哪个金额写？',
    options: [{ id: 'price-398', label: '¥398' }],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
    },
    scope: 'current_task',
  };
  const snapshot = await readHarnessDecisionSnapshot(
    Response.json({ data: { question } })
  );
  assert.deepEqual(snapshot, { exists: true, question });

  assert.deepEqual(
    await readHarnessSubmitResult(
      Response.json({ data: { eventId: 'event-1', replayed: false } })
    ),
    { eventId: 'event-1', replayed: false }
  );
});

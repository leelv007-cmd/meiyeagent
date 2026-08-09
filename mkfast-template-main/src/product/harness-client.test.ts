import assert from 'node:assert/strict';
import test from 'node:test';

import { P1RequestError } from '@/p1/client';
import {
  acknowledgeHarnessInteractionRenderer,
  decideExecutionConfirmation,
  readPendingHarnessInteractionMessage,
  readHarnessDecisionSnapshot,
  readHarnessSubmitResult,
  readTodayRecommendation,
  setHarnessInteractionEditing,
  submitHarnessInteractionMerchantMessage,
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

  assert.deepEqual(snapshot, {
    exists: false,
    question: null,
    reservationReleased: false,
    resolutionSource: null,
    status: 'absent',
    timeoutSeconds: null,
  });
});

test('submits one validated harness task to the collection boundary', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return Response.json({
      data: { workflowId: 'work-1', replayed: false },
      meta: { correlationId: 'corr-test' },
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
      meta: { correlationId: 'corr-test' },
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

test('reads and consumes the durable merchant-message interaction boundary', async () => {
  const previousFetch = globalThis.fetch;
  const requests: Request[] = [];
  const waiting = {
    requestId: 'execution-request-1',
    runId: 'task-1',
    step: 'execution_selection',
    revision: 2,
    kind: 'execution_confirmation',
    frozen: {
      executionSnapshotRef: { id: 'snapshot-1', revision: 1 },
      quoteRevision: 'quote-1',
      params: [],
      debitPreview: [],
      condition: {
        kind: 'existing_gate',
        required: true,
        serverEvaluated: true,
      },
      timeoutPolicy: {
        kind: 'hold',
        reason: 'unknown',
        serverEvaluated: true,
      },
    },
    presentation: {
      carriers: ['conversation'],
      notification: 'none',
      renderer: 'execution_confirmation',
    },
  };
  globalThis.fetch = async (input, init) => {
    const request = new Request(
      new URL(String(input), 'http://localhost'),
      init
    );
    requests.push(request);
    return request.method === 'GET'
      ? Response.json({
          data: waiting,
          meta: { correlationId: 'corr-test' },
        })
      : Response.json({
          data: { kind: 'resumed', replayed: false },
          meta: { correlationId: 'corr-test' },
        });
  };
  try {
    assert.deepEqual(
      await readPendingHarnessInteractionMessage('task-1'),
      waiting
    );
    const merchantMessage = {
      requestId: waiting.requestId,
      revision: waiting.revision,
      step: 'execution_selection',
      carrier: 'conversation',
      idempotencyKey: 'merchant-message-1',
      message: '请换成更稳妥的模型',
    } as const;
    assert.deepEqual(
      await submitHarnessInteractionMerchantMessage('task-1', merchantMessage),
      { kind: 'resumed', replayed: false }
    );
    assert.deepEqual(
      requests.map((request) => [request.method, request.url]),
      [
        [
          'GET',
          'http://localhost/api/core/p1/harness/tasks/task-1/interaction/message',
        ],
        [
          'POST',
          'http://localhost/api/core/p1/harness/tasks/task-1/interaction/message',
        ],
      ]
    );
    assert.equal(
      requests[1]?.headers.get('idempotency-key'),
      'merchant-message-1'
    );
    assert.deepEqual(await requests[1]?.json(), merchantMessage);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('acknowledges the exact durable renderer request identity', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return new Response(null, { status: 204 });
  };
  try {
    await acknowledgeHarnessInteractionRenderer('task-1', {
      requestId: 'request-1',
      revision: 2,
      step: 'context_injection',
      carrier: 'conversation',
    });
    assert.equal(
      request?.url,
      'http://localhost/api/core/p1/harness/tasks/task-1/interaction/v2/renderer'
    );
    assert.deepEqual(await request?.json(), {
      requestId: 'request-1',
      revision: 2,
      step: 'context_injection',
      carrier: 'conversation',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('exact interaction mutations never fall back to identityless legacy writes', async () => {
  const previousFetch = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(
      new URL(String(input), 'http://localhost'),
      init
    );
    requests.push(request);
    return Response.json(
      {
        error: {
          code: 'HARNESS_INTERACTION_VERSION_REQUIRED',
          message: 'Exact interaction identity is required.',
        },
        meta: { correlationId: 'corr-test' },
      },
      { status: 426 }
    );
  };
  const acknowledgement = {
    requestId: 'request-legacy-rollout',
    revision: 1,
    step: 'context_injection',
    carrier: 'conversation',
  } as const;
  try {
    await assert.rejects(
      acknowledgeHarnessInteractionRenderer(
        'task-legacy-rollout',
        acknowledgement
      ),
      (error: unknown) =>
        error instanceof P1RequestError && error.status === 426
    );
    await assert.rejects(
      setHarnessInteractionEditing('task-legacy-rollout', {
        ...acknowledgement,
        editing: true,
        editingSessionId: 'editing-session-rollout',
      })
    );

    assert.deepEqual(
      requests.map((request) => request.url),
      [
        'http://localhost/api/core/p1/harness/tasks/task-legacy-rollout/interaction/v2/renderer',
        'http://localhost/api/core/p1/harness/tasks/task-legacy-rollout/interaction/v2/editing',
      ]
    );
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
    unattended: 'continue',
    scope: 'current_task',
  };
  const snapshot = await readHarnessDecisionSnapshot(
    Response.json({
      data: {
        question,
        resolutionSource: null,
        status: 'pending',
        timeoutSeconds: 19,
      },
      meta: { correlationId: 'corr-test' },
    })
  );
  assert.deepEqual(snapshot, {
    exists: true,
    question,
    reservationReleased: false,
    resolutionSource: null,
    status: 'pending',
    timeoutSeconds: 19,
  });

  assert.deepEqual(
    await readHarnessSubmitResult(
      Response.json({
        data: { eventId: 'event-1', replayed: false },
        meta: { correlationId: 'corr-test' },
      })
    ),
    { eventId: 'event-1', replayed: false }
  );

  assert.deepEqual(
    await readHarnessSubmitResult(
      Response.json({
        data: { consumedByOther: true, eventId: null },
        meta: { correlationId: 'corr-test' },
      })
    ),
    { consumedByOther: true, eventId: null }
  );
  assert.deepEqual(
    await readHarnessSubmitResult(
      Response.json({
        data: {
          eventId: 'event-late',
          replayed: false,
          successor: {
            snapshotId: 'snapshot-late',
            workflowId: 'workflow-late',
          },
        },
        meta: { correlationId: 'corr-test' },
      })
    ),
    {
      eventId: 'event-late',
      replayed: false,
      successor: {
        snapshotId: 'snapshot-late',
        workflowId: 'workflow-late',
      },
    }
  );
});

test('decides an execution confirmation through the domain decide boundary', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return Response.json({
      data: {
        decision: {
          schemaVersion: 'plan-confirmation-decision/v1',
          decisionId: 'dec-1',
          requestId: 'req-1',
          actorId: 'user-1',
          decision: 'rejected',
          decidedAt: '2026-08-08T12:00:00.000Z',
        },
        request: {
          schemaVersion: 'agent-execution-confirmation-request/v1',
          requestId: 'req-1',
          workspaceId: 'ws-1',
          planId: 'plan-1',
          planRevision: 1,
          snapshotHash: 'snap-hash-1',
          quoteRef: { id: 'quote-1', revision: 'r1' },
          reservationIdempotencyKey: 'reserve-1',
          createdAt: '2026-08-08T11:00:00.000Z',
          holdExpiresAt: '2026-08-09T11:00:00.000Z',
          status: 'decided',
        },
        merchantMessage: '已暂不执行，积分已退回',
        refundedCredits: 5,
      },
      meta: { correlationId: 'corr-test' },
    });
  };
  try {
    const result = await decideExecutionConfirmation('req-1', {
      decisionId: 'dec-1',
      decision: 'rejected',
      decidedAt: '2026-08-08T12:00:00.000Z',
    });
    assert.equal(result.decision.decision, 'rejected');
    assert.equal(result.request.status, 'decided');
    assert.equal(result.merchantMessage, '已暂不执行，积分已退回');
    assert.equal(result.refundedCredits, 5);
    assert.equal(
      request?.url,
      'http://localhost/api/core/p1/confirmation-requests/req-1/decide'
    );
    assert.equal(request?.method, 'POST');
    assert.equal(request?.headers.get('idempotency-key'), 'dec-1');
    assert.deepEqual(await request?.json(), {
      decisionId: 'dec-1',
      decision: 'rejected',
      decidedAt: '2026-08-08T12:00:00.000Z',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

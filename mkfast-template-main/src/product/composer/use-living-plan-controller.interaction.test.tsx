import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  __resetAgentWorkbenchHostStoreForTests,
  createAgentEventStore,
  getAgentWorkbenchHostStore,
} from '@/product/agent-workbench/agent-event-store';
import { createEmptyAgentWorkbenchState } from '@/product/agent-workbench/agent-event-reducer';
import type { LivingPlanRevisionFacts } from '@/product/agent-workbench/plan/living-plan-model';
import type { ConfirmationDecideInput } from '@/product/harness-client';
import { useLivingPlanController } from './use-living-plan-controller';

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { error: toastError },
}));

beforeEach(() => {
  toastError.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetAgentWorkbenchHostStoreForTests();
});

/** The revision the commit strip renders: priced, rights-cleared, ready. */
function pricedPlanFacts(): LivingPlanRevisionFacts {
  return {
    planId: 'plan-paid',
    revision: 2,
    goal: { summary: '端午套餐上新' },
    deliverables: [{ kind: 'note', platform: 'xiaohongshu', quantity: 3 }],
    expression: {},
    factsAssets: { factsSummary: '事实可用', rightsLabel: '素材授权通过' },
    costDuration: {
      creditCost: 38,
      balanceCredits: 126,
      failureRefundsCredits: true,
    },
    readiness: 'ready',
  };
}

function storeWithPricedPlan() {
  const facts = pricedPlanFacts();
  __resetAgentWorkbenchHostStoreForTests(
    createAgentEventStore({
      ...createEmptyAgentWorkbenchState(),
      activePlanId: facts.planId,
      plans: {
        [facts.planId]: {
          planId: facts.planId,
          revisions: [facts],
          latestRevision: facts.revision,
        },
      },
    })
  );
}

test('pending answer_question submits the merchant text to the independent answer command', async () => {
  __resetAgentWorkbenchHostStoreForTests(
    createAgentEventStore({
      ...createEmptyAgentWorkbenchState(),
      pendingInterrupts: [
        {
          interruptId: 'composer-question:interrupt-clarify',
          interruptType: 'answer_question',
          description: '主要面向哪类客人？',
          revision: 1,
          streamOffset: '1-0',
        },
      ],
    })
  );
  const fetchSpy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{}', { status: 200 })
  );
  vi.stubGlobal('fetch', fetchSpy);
  const view = renderHook(() =>
    useLivingPlanController({ taskId: 'task-clarify', focusIntent: vi.fn() })
  );

  let consumed = false;
  act(() => {
    consumed = view.result.current.submitPlanCommand('第一次到店的新客');
  });

  expect(consumed).toBe(true);
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(
    '/api/core/p1/composer/tasks/task-clarify/answer'
  );
  expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
    merchantAnswer: '第一次到店的新客',
  });
});

test('开始制作 records the merchant confirmation decision before Core is asked to make', async () => {
  storeWithPricedPlan();
  const calls: string[] = [];
  const fetchSpy = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      calls.push(`fetch:${String(input)}`);
      return new Response('{}', { status: 200 });
    }
  );
  vi.stubGlobal('fetch', fetchSpy);
  const decideConfirmation = vi.fn(
    async (_requestId: string, _input: ConfirmationDecideInput) => {
      calls.push('decide');
      return {
        decision: null,
        merchantMessage: null,
        refundedCredits: 0,
        request: null,
      } as never;
    }
  );
  const view = renderHook(() =>
    useLivingPlanController({
      taskId: 'task-paid',
      executionConfirmationRequestId: 'confirmation:authority:task-paid',
      focusIntent: vi.fn(),
      decideConfirmation,
    })
  );

  act(() => {
    view.result.current.onCommitAction('start');
  });

  await waitFor(() => expect(calls.length).toBe(2));
  expect(calls).toEqual([
    'decide',
    'fetch:/api/core/p1/composer/tasks/task-paid/start',
  ]);
  expect(decideConfirmation.mock.calls[0]?.[0]).toBe(
    'confirmation:authority:task-paid'
  );
  expect(decideConfirmation.mock.calls[0]?.[1]).toMatchObject({
    decision: 'confirmed',
  });
  expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
    planRevision: 2,
  });
});

test('开始制作 drains the accepted Core response through EOF', async () => {
  storeWithPricedPlan();
  const accepted = JSON.stringify({
    data: {
      contentPackage: { expectedRevision: 0, id: 'package-1' },
      makeReady: true,
      replayed: false,
      runId: 'run-1',
      snapshot: {
        id: 'snapshot-task-1',
        identity: { id: 'identity-brand', revision: '2' },
        schemaVersion: 'creation-execution-snapshot/v1',
      },
      task: { id: 'task-paid' },
      threadId: 'thread-1',
      usageReservation: { id: 'usage-task-1' },
      work: { id: 'work-1' },
    },
    meta: { correlationId: 'corr-test' },
  });
  const chunks = [
    accepted.slice(0, Math.floor(accepted.length / 2)),
    accepted.slice(Math.floor(accepted.length / 2)),
  ];
  let chunksRead = 0;
  const fetchSpy = vi.fn(async () => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[chunksRead];
          if (chunk === undefined) return;
          controller.enqueue(encoder.encode(chunk));
          chunksRead += 1;
          if (chunksRead === chunks.length) controller.close();
        },
      }),
      { headers: { 'content-type': 'application/json' }, status: 202 }
    );
  });
  vi.stubGlobal('fetch', fetchSpy);
  const view = renderHook(() =>
    useLivingPlanController({ taskId: 'task-paid', focusIntent: vi.fn() })
  );

  act(() => {
    view.result.current.onCommitAction('start');
  });

  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(chunksRead).toBe(2));
});

test('a confirmation decision that fails never asks Core to make', async () => {
  storeWithPricedPlan();
  const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  const decideConfirmation = vi.fn(async () => {
    throw new Error('confirmation authority unavailable');
  });
  const view = renderHook(() =>
    useLivingPlanController({
      taskId: 'task-paid',
      executionConfirmationRequestId: 'confirmation:authority:task-paid',
      focusIntent: vi.fn(),
      decideConfirmation: decideConfirmation as never,
    })
  );

  act(() => {
    view.result.current.onCommitAction('start');
  });

  await waitFor(() => expect(decideConfirmation).toHaveBeenCalledTimes(1));
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('开始制作 surfaces a failure envelope once and does not re-issue start', async () => {
  storeWithPricedPlan();
  const failureEnvelope = {
    error: {
      code: 'COMPOSER_START_FAILED',
      message: 'plan revision is stale',
    },
    meta: { correlationId: 'corr-start-fail' },
  };
  const fetchSpy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(failureEnvelope), {
        headers: { 'content-type': 'application/json' },
        status: 409,
      })
  );
  vi.stubGlobal('fetch', fetchSpy);
  const view = renderHook(() =>
    useLivingPlanController({ taskId: 'task-paid', focusIntent: vi.fn() })
  );

  act(() => {
    view.result.current.onCommitAction('start');
  });

  await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  expect(toastError).toHaveBeenCalledWith('开始制作失败，请重试');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(
    '/api/core/p1/composer/tasks/task-paid/start'
  );

  // Drain settles on the thrown envelope; no automatic retry is scheduled.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(toastError).toHaveBeenCalledTimes(1);
});

test('方案调整 drains the accepted Core response through EOF', async () => {
  storeWithPricedPlan();
  const accepted = JSON.stringify({
    data: {
      makeReady: true,
      runId: 'run-revise-1',
      threadId: 'thread-revise-1',
    },
    meta: { correlationId: 'corr-revise' },
  });
  const chunks = [
    accepted.slice(0, Math.floor(accepted.length / 2)),
    accepted.slice(Math.floor(accepted.length / 2)),
  ];
  let chunksRead = 0;
  const fetchSpy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            const chunk = chunks[chunksRead];
            if (chunk === undefined) return;
            controller.enqueue(encoder.encode(chunk));
            chunksRead += 1;
            if (chunksRead === chunks.length) controller.close();
          },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      );
    }
  );
  vi.stubGlobal('fetch', fetchSpy);
  const view = renderHook(() =>
    useLivingPlanController({ taskId: 'task-paid', focusIntent: vi.fn() })
  );

  act(() => {
    view.result.current.onCommitAction('revise');
  });
  let consumed = false;
  act(() => {
    consumed = view.result.current.submitPlanCommand('减到 2 条笔记');
  });

  expect(consumed).toBe(true);
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(
    '/api/core/p1/composer/tasks/task-paid/revise'
  );
  await waitFor(() => expect(chunksRead).toBe(2));
  await waitFor(() => expect(view.result.current.revising).toBe(false));
});

test('方案调整 replays the Thread so Living Plan can show the new revision', async () => {
  const facts = pricedPlanFacts();
  __resetAgentWorkbenchHostStoreForTests(
    createAgentEventStore({
      ...createEmptyAgentWorkbenchState(),
      session: {
        resourceId: 'workspace-1',
        threadId: 'thread-revise-1',
        sessionRevision: 1,
      },
      lastEventId: 'plan:plan-paid:r2',
      lastStreamOffset: '2',
      activePlanId: facts.planId,
      plans: {
        [facts.planId]: {
          planId: facts.planId,
          revisions: [facts],
          latestRevision: facts.revision,
        },
      },
    })
  );
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/revise')) {
      return new Response(
        JSON.stringify({
          data: {
            makeReady: false,
            runId: 'run-1',
            threadId: 'thread-revise-1',
          },
          meta: { correlationId: 'corr-revise' },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          session: {
            resourceId: 'workspace-1',
            threadId: 'thread-revise-1',
            sessionRevision: 2,
          },
          snapshot: {
            revision: '3',
            lastEventId: 'plan:plan-paid:r3',
            lastStreamOffset: '3',
          },
          events: [
            {
              schemaVersion: 'agent-semantic-event/v1',
              threadId: 'thread-revise-1',
              contextRole: 'included',
              sourceDomain: 'marketing_plan_revision',
              sourceEntityId: 'plan-paid',
              sourceRevision: '3',
              correlationId: 'thread-revise-1',
              payload: {
                planId: 'plan-paid',
                revision: 3,
                goal: { summary: '端午套餐上新 · 调整：减到 4 页' },
                deliverables: [
                  { kind: 'note', platform: 'xiaohongshu', quantity: 4 },
                ],
                adjustmentSummary: '减到 4 页',
              },
              occurredAt: '2026-08-14T00:00:00.000Z',
              eventId: 'plan:plan-paid:r3',
              streamOffset: '3',
              eventType: 'plan.revised',
            },
          ],
        },
        meta: { correlationId: 'corr-replay' },
      }),
      { headers: { 'content-type': 'application/json' }, status: 200 }
    );
  });
  vi.stubGlobal('fetch', fetchSpy);
  const view = renderHook(() =>
    useLivingPlanController({ taskId: 'task-paid', focusIntent: vi.fn() })
  );

  act(() => {
    view.result.current.onCommitAction('revise');
  });
  act(() => {
    view.result.current.submitPlanCommand('减到 4 页');
  });

  await waitFor(() =>
    expect(
      getAgentWorkbenchHostStore().getState().plans['plan-paid']?.latestRevision
    ).toBe(3)
  );
  expect(String(fetchSpy.mock.calls[1]?.[0])).toContain(
    '/api/core/p1/agent-threads/thread-revise-1/replay'
  );
});

test('开始制作 retries Thread replay until the next Living Plan revision lands', async () => {
  const facts = pricedPlanFacts();
  __resetAgentWorkbenchHostStoreForTests(
    createAgentEventStore({
      ...createEmptyAgentWorkbenchState(),
      session: {
        resourceId: 'workspace-1',
        threadId: 'thread-start-1',
        sessionRevision: 1,
      },
      lastEventId: 'plan:plan-paid:r2',
      lastStreamOffset: '2',
      activePlanId: facts.planId,
      plans: {
        [facts.planId]: {
          planId: facts.planId,
          revisions: [facts],
          latestRevision: facts.revision,
        },
      },
    })
  );
  let replayCalls = 0;
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/start')) {
      return new Response(
        JSON.stringify({
          data: {
            contentPackage: { expectedRevision: 0, id: 'package-1' },
            makeReady: true,
            replayed: false,
            runId: 'run-1',
            snapshot: {
              id: 'snapshot-task-1',
              identity: { id: 'identity-brand', revision: '2' },
              schemaVersion: 'creation-execution-snapshot/v1',
            },
            task: { id: 'task-paid' },
            threadId: 'thread-start-1',
            usageReservation: { id: 'usage-task-1' },
            work: { id: 'work-1' },
          },
          meta: { correlationId: 'corr-start' },
        }),
        { headers: { 'content-type': 'application/json' }, status: 202 }
      );
    }
    replayCalls += 1;
    return new Response(
      JSON.stringify({
        data: {
          session: {
            resourceId: 'workspace-1',
            threadId: 'thread-start-1',
            sessionRevision: 2,
          },
          snapshot: {
            revision: replayCalls === 1 ? '2' : '3',
            lastEventId:
              replayCalls === 1 ? 'plan:plan-paid:r2' : 'plan:plan-paid:r3',
            lastStreamOffset: replayCalls === 1 ? '2' : '3',
          },
          events:
            replayCalls === 1
              ? []
              : [
                  {
                    schemaVersion: 'agent-semantic-event/v1',
                    threadId: 'thread-start-1',
                    contextRole: 'included',
                    sourceDomain: 'marketing_plan_revision',
                    sourceEntityId: 'plan-paid',
                    sourceRevision: '3',
                    correlationId: 'thread-start-1',
                    payload: {
                      planId: 'plan-paid',
                      revision: 3,
                      goal: { summary: '端午套餐上新 · 价格已更新' },
                      deliverables: [
                        { kind: 'note', platform: 'xiaohongshu', quantity: 3 },
                      ],
                      adjustmentSummary: '报价已更新',
                    },
                    occurredAt: '2026-08-14T00:00:00.000Z',
                    eventId: 'plan:plan-paid:r3',
                    streamOffset: '3',
                    eventType: 'plan.revised',
                  },
                ],
        },
        meta: { correlationId: 'corr-replay' },
      }),
      { headers: { 'content-type': 'application/json' }, status: 200 }
    );
  });
  vi.stubGlobal('fetch', fetchSpy);
  const view = renderHook(() =>
    useLivingPlanController({ taskId: 'task-paid', focusIntent: vi.fn() })
  );

  act(() => {
    view.result.current.onCommitAction('start');
  });

  await waitFor(
    () =>
      expect(
        getAgentWorkbenchHostStore().getState().plans['plan-paid']
          ?.latestRevision
      ).toBe(3),
    { timeout: 3_000 }
  );
  expect(replayCalls).toBeGreaterThan(1);
});

test('方案调整 surfaces a failure envelope once and does not re-issue revise', async () => {
  storeWithPricedPlan();
  const failureEnvelope = {
    error: {
      code: 'COMPOSER_PLAN_REVISE_FAILED',
      message: 'plan revision is stale',
    },
    meta: { correlationId: 'corr-revise-fail' },
  };
  const fetchSpy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(failureEnvelope), {
        headers: { 'content-type': 'application/json' },
        status: 409,
      })
  );
  vi.stubGlobal('fetch', fetchSpy);
  const view = renderHook(() =>
    useLivingPlanController({ taskId: 'task-paid', focusIntent: vi.fn() })
  );

  act(() => {
    view.result.current.onCommitAction('revise');
  });
  act(() => {
    view.result.current.submitPlanCommand('改成两条');
  });

  await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  expect(toastError).toHaveBeenCalledWith('方案调整失败，请重试');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(
    '/api/core/p1/composer/tasks/task-paid/revise'
  );

  // Drain settles on the thrown envelope; no automatic retry is scheduled.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(toastError).toHaveBeenCalledTimes(1);
  // Failure keeps revise mode so the merchant can edit and retry once.
  expect(view.result.current.revising).toBe(true);
});

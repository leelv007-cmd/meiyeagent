import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  __resetAgentWorkbenchHostStoreForTests,
  createAgentEventStore,
  createEmptyAgentWorkbenchState,
  type LivingPlanRevisionFacts,
} from '@/product/agent-workbench';
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
          interruptId: 'interrupt-clarify',
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

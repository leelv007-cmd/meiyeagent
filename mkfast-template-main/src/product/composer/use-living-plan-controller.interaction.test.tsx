import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  __resetAgentWorkbenchHostStoreForTests,
  createAgentEventStore,
  createEmptyAgentWorkbenchState,
  type LivingPlanRevisionFacts,
} from '@/product/agent-workbench';
import type { ConfirmationDecideInput } from '@/product/harness-client';
import { useLivingPlanController } from './use-living-plan-controller';

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

test('a confirmation decision that fails never asks Core to make', async () => {
  storeWithPricedPlan();
  const fetchSpy = vi.fn(
    async () => new Response('{}', { status: 200 })
  );
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

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  __resetAgentWorkbenchHostStoreForTests,
  createAgentEventStore,
  createEmptyAgentWorkbenchState,
} from '@/product/agent-workbench';
import { useLivingPlanController } from './use-living-plan-controller';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetAgentWorkbenchHostStoreForTests();
});

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

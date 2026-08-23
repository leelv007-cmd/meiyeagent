/**
 * V31-105 §3 — the 中途指令 entry may only exist on a thread that can steer.
 *
 * The binding statement Core runs (`STEERING_AUTHORITY_BINDING_SQL`, see
 * `apps/core/src/assembly/core-assembly.ts`) requires the requesting thread to
 * be the submission's own `agentBinding.threadId`. A Workbench thread and a
 * `legacy-work:<id>` thread are neither, so a steer sent on one is a guaranteed
 * 409 — the merchant typed a sentence and got 「这次调整没法这样改」 back for a
 * reason that had nothing to do with her sentence.
 *
 * The entry therefore behaves the way it already does for a run with no task:
 * it is not there. Nothing is offered that cannot land.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { __resetAgentWorkbenchHostStoreForTests } from '@/product/agent-workbench/agent-event-store';

import { SteeringComposerHost } from './steering-composer-panel';

const commandP1 = vi.fn();
const queryP1 = vi.fn();

vi.mock('@/p1/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/p1/client')>();
  return {
    ...actual,
    commandP1: (...args: unknown[]) => commandP1(...args),
    queryP1: (...args: unknown[]) => queryP1(...args),
  };
});

beforeEach(() => {
  commandP1.mockReset();
  queryP1.mockReset();
  __resetAgentWorkbenchHostStoreForTests();
  // Gate open, no durable history: the only reason the entry could hide is the
  // one under test.
  queryP1.mockImplementation((_module: string, request: { action: string }) => {
    if (request.action === 'steering_gate') {
      return Promise.resolve({ enabled: true, reason: 'enabled' });
    }
    if (request.action === 'list_steering_commands') {
      return Promise.resolve({ commands: [] });
    }
    throw new Error(`unexpected query ${request.action}`);
  });
});

function wrap(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

test('an unbound run offers no 中途指令 entry and sends no steering command', async () => {
  render(
    wrap(
      <SteeringComposerHost
        phase="running"
        taskId="task-1"
        threadId={null}
        workId="work-1"
      />
    )
  );

  // `list_steering_commands` only runs once `steering_gate` came back enabled,
  // so seeing it is the readiness signal that the entry has had its chance to
  // render — asserting absence before the gate resolves would pass on nothing.
  await waitFor(() => {
    expect(
      queryP1.mock.calls.some(
        ([, request]) =>
          (request as { action: string }).action === 'list_steering_commands'
      )
    ).toBe(true);
  });
  expect(screen.queryByTestId('steering-composer')).toBeNull();
  // No thread was opened on the merchant's behalf, so no 409 can reach her.
  expect(commandP1).not.toHaveBeenCalled();
});

test('a bound run steers on the submission thread, never on a substitute', async () => {
  commandP1.mockResolvedValue({
    command: { commandId: 'steer-1' },
    classification: { kind: 'future_step_patch' },
    queueMode: 'steer',
    applicationStatus: 'accepted',
    impactSummary: '会改封面',
    preservedUnitIds: [],
    affectedUnitIds: ['page-1'],
    impact: {
      affectedLabels: ['封面'],
      preservedLabels: [],
      rebilled: false,
      alreadyInvokedUnitIds: [],
      requiresRequote: false,
      requiresCorrection: false,
      feeNote: '不额外扣积分',
      settledNote: null,
      queueNote: null,
    },
    nextAction: 'apply_patch',
    replayed: false,
  });

  render(
    wrap(
      <SteeringComposerHost
        phase="running"
        taskId="task-1"
        threadId="thread-bound"
        workId="work-1"
      />
    )
  );

  const box = await screen.findByTestId('steering-composer-input');
  await userEvent.type(box, '封面别写名额');
  await userEvent.click(screen.getByTestId('steering-submit'));

  await waitFor(() => {
    expect(commandP1).toHaveBeenCalledTimes(1);
  });
  const [module, request] = commandP1.mock.calls[0] as [
    string,
    { action: string; payload: { threadId: string } },
  ];
  expect(module).toBe('agent-session');
  expect(request.action).toBe('steering_submit');
  expect(request.payload.threadId).toBe('thread-bound');
});

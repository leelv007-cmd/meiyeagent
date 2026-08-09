/**
 * V31-18 — injection receipt visibility on the task-detail surface.
 *
 * The panel is the merchant-facing proof of §12.7 / §37.4-B2: what memories
 * were injected into a task stays visible, and revoke excludes the memory from
 * future injection while the historical trace remains.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const p1 = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => ({
  commandP1: p1.commandP1,
  queryP1: p1.queryP1,
}));

const { MemoryInjectionReceiptPanel } = await import(
  './memory-injection-receipt'
);

function renderPanel(taskId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryInjectionReceiptPanel taskId={taskId} />
      </QueryClientProvider>
    ),
  };
}

const receipt = {
  schemaVersion: 'memory-injection-receipt/v1',
  taskId: 'task-gen-1',
  runId: 'run-1',
  harnessReleaseId: 'release-1',
  entries: [
    {
      memoryId: 'pref-inject',
      statement: '文案要克制',
      revision: 1,
    },
  ],
  injectedAt: '2026-08-08T10:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('memory injection receipt panel', () => {
  it('shows injected memories with content, source and time', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string; payload: { taskId?: string } }) =>
        module === 'memory' &&
        input.action === 'injection_receipt' &&
        input.payload.taskId === 'task-gen-1'
          ? Promise.resolve({ receipt })
          : Promise.reject(new Error('unexpected query')),
    );
    renderPanel('task-gen-1');

    await waitFor(() => {
      expect(
        screen.getByTestId('memory-injection-receipt-panel')
      ).toHaveAttribute('data-task-id', 'task-gen-1');
    });
    expect(
      screen.getByTestId('memory-injection-receipt-statement')
    ).toHaveTextContent('文案要克制');
    expect(
      screen.getByTestId('memory-injection-receipt-source')
    ).toHaveTextContent('pref-inject');
  });

  it('renders nothing when the task has no injection receipt', async () => {
    p1.queryP1.mockResolvedValue({ receipt: null });
    renderPanel('task-no-receipt');
    await waitFor(() => {
      expect(p1.queryP1).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId('memory-injection-receipt-panel')
    ).toBeNull();
  });

  it('revokes a memory via the memory module command and marks it revoked', async () => {
    p1.queryP1.mockResolvedValue({ receipt });
    p1.commandP1.mockResolvedValue({ recordState: 'revoked' });
    renderPanel('task-gen-1');

    const revokeButton = await screen.findByTestId(
      'memory-injection-receipt-revoke-pref-inject'
    );
    revokeButton.click();
    await waitFor(() => {
      expect(p1.commandP1).toHaveBeenCalledWith(
        'memory',
        {
          action: 'revoke_memory',
          payload: { memoryId: 'pref-inject', expectedRevision: 1 },
        },
        'memory:revoke:pref-inject'
      );
      expect(revokeButton).toBeDisabled();
    });
    expect(revokeButton).toHaveTextContent('已撤销');
  });
});

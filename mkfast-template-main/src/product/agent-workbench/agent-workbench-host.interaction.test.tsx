/**
 * V31-05 Thread-root host: explicit threadId restore vs Idle projection.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetAgentWorkbenchHostStoreForTests } from './agent-event-store';
import { AgentWorkbenchHost } from './agent-workbench';
import type { WorkbenchSessionResolveResponse } from './thread-session';

afterEach(() => {
  cleanup();
  __resetAgentWorkbenchHostStoreForTests();
});

describe('AgentWorkbenchHost Thread-root restore', () => {
  it('restores explicit threadId into host session projection', async () => {
    const loadSession = vi.fn(
      async (): Promise<WorkbenchSessionResolveResponse> => ({
        resolveSource: 'explicit_thread',
        session: {
          resourceId: 'ws-1',
          threadId: 'thread-explicit',
          sessionRevision: 3,
          title: '显式会话',
          activeRunId: 'run-1',
        },
      })
    );

    render(
      <AgentWorkbenchHost
        enableSessionRestore
        explicitThreadId="thread-explicit"
        loadSession={loadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
        'data-workbench-root',
        'thread'
      );
    });
    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      'thread-explicit'
    );
    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-resolve-source',
      'explicit_thread'
    );
    expect(loadSession).toHaveBeenCalledWith({
      explicitThreadId: 'thread-explicit',
    });
  });

  it('enters Idle when projection returns null session', async () => {
    const loadSession = vi.fn(
      async (): Promise<WorkbenchSessionResolveResponse> => ({
        resolveSource: 'idle',
        session: null,
      })
    );

    render(
      <AgentWorkbenchHost enableSessionRestore loadSession={loadSession} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
        'data-workbench-root',
        'idle'
      );
    });
    expect(screen.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      ''
    );
    expect(loadSession).toHaveBeenCalledWith({ explicitThreadId: null });
  });

  it('keeps processSlot as Work inline projection under Thread-root', async () => {
    render(
      <AgentWorkbenchHost
        enableSessionRestore={false}
        processSlot={<div data-testid="work-inline-projection">work stream</div>}
      />
    );

    expect(screen.getByTestId('work-inline-projection')).toBeInTheDocument();
    expect(screen.getByTestId('agent-workstream-process')).toBeInTheDocument();
  });
});

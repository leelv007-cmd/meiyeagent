import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';

import {
  type ResultCommandTransport,
  useResultCommands,
} from './use-result-commands';

function renderCommands(transport: ResultCommandTransport) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return renderHook(() => useResultCommands(transport), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

test('adopt and export flows use the canonical result transport', async () => {
  const transport = vi.fn<ResultCommandTransport>(async (_module, call) => ({
    action: call.action,
  }));
  const view = renderCommands(transport);

  await act(async () => {
    await view.result.current.adopt('adopt:work-1:2', {
      expectedRevision: 2,
      selection: { kind: 'copy' },
      workId: 'work-1',
    });
    await view.result.current.exportResult('export:package-1:2:xiaohongshu', {
      expectedRevision: 2,
      packageId: 'package-1',
      platform: 'xiaohongshu',
    });
  });

  expect(transport).toHaveBeenNthCalledWith(
    1,
    'result-delivery',
    expect.objectContaining({ action: 'result_adopt' }),
    expect.any(String)
  );
  expect(transport).toHaveBeenNthCalledWith(
    2,
    'result-delivery',
    expect.objectContaining({ action: 'result_export' }),
    expect.any(String)
  );
});

test('adjust prepare and confirm share the injected mutation transport', async () => {
  const transport = vi.fn<ResultCommandTransport>(async (_module, call) => ({
    action: call.action,
  }));
  const view = renderCommands(transport);

  await act(async () => {
    await view.result.current.runAdjust(async () => {
      await view.result.current.prepareAdjust('adjust:prepare', {
        instruction: '更温和',
        workId: 'work-1',
      });
      await view.result.current.confirmAdjust('adjust:confirm', {
        billingQuoteId: 'quote-1',
        derivedWorkId: 'work-2',
      });
    });
  });

  expect(transport.mock.calls.map(([, call]) => call.action)).toEqual([
    'result_adjust_prepare',
    'result_adjust',
  ]);
  expect(view.result.current.adjustBusy).toBe(false);
});

test('busy flags come from their mutation lifecycle', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const view = renderCommands(
    vi.fn<ResultCommandTransport>(async () => undefined)
  );

  act(() => {
    void view.result.current.runShellAction(() => pending);
  });
  await waitFor(() => expect(view.result.current.shellActionBusy).toBe(true));
  await act(async () => release?.());
  await waitFor(() => expect(view.result.current.shellActionBusy).toBe(false));
});

test('video edit and recovery commands retain their public P1 actions', async () => {
  const transport = vi.fn<ResultCommandTransport>(async () => undefined);
  const view = renderCommands(transport);

  await act(async () => {
    await view.result.current.execute(
      'model-supply',
      {
        action: 'video_workflow_edit',
        payload: {
          edit: { kind: 'select_candidate' },
          expectedRevision: 2,
          workflowId: 'workflow-1',
        },
      },
      'video-edit-1'
    );
    await view.result.current.execute(
      'operations',
      {
        action: 'resume_creative_job',
        payload: { jobId: 'job-1' },
      },
      'resume-1'
    );
  });

  expect(transport).toHaveBeenNthCalledWith(
    1,
    'model-supply',
    expect.objectContaining({ action: 'video_workflow_edit' }),
    'video-edit-1'
  );
  expect(transport).toHaveBeenNthCalledWith(
    2,
    'operations',
    expect.objectContaining({ action: 'resume_creative_job' }),
    'resume-1'
  );
});

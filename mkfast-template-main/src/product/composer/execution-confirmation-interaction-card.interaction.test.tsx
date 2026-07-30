import type { ExecutionConfirmationRequest } from '@meiye/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { P1RequestError } from '@/p1/client';
import { ExecutionConfirmationInteractionCard } from './execution-confirmation-interaction-card';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const REQUEST: ExecutionConfirmationRequest = {
  requestId: 'execution-request-1',
  runId: 'run-1',
  step: 'execution_selection',
  revision: 1,
  kind: 'execution_confirmation',
  frozen: {
    executionSnapshotRef: { id: 'snapshot-1', revision: 1 },
    quoteRevision: 'quote-r1',
    params: [{ key: 'model', label: '模型', value: 'model-1@r1', hint: null }],
    debitPreview: [],
    condition: {
      kind: 'external_action',
      required: true,
      serverEvaluated: true,
    },
    timeoutPolicy: {
      kind: 'hold',
      reason: 'external_action',
      serverEvaluated: true,
    },
  },
  presentation: {
    carriers: ['conversation'],
    notification: 'none',
    renderer: 'execution_confirmation',
  },
};

it('acks the mounted read-only card and submits approval', async () => {
  const user = userEvent.setup();
  const onRendererReady = vi.fn(async () => undefined);
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ExecutionConfirmationInteractionCard
      onRendererReady={onRendererReady}
      onSubmit={onSubmit}
      request={REQUEST}
    />
  );

  expect(onRendererReady).toHaveBeenCalledOnce();
  expect(screen.getByText('model-1@r1')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '确认执行' }));
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'approved' });
});

it('rejects without inventing feedback inside the frozen card', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ExecutionConfirmationInteractionCard
      onRendererReady={async () => undefined}
      onSubmit={onSubmit}
      request={REQUEST}
    />
  );

  await user.click(screen.getByRole('button', { name: '暂不执行' }));
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'rejected' });
});

it('retries the exact renderer acknowledgement after a transient failure', async () => {
  vi.useFakeTimers();
  const onRendererReady = vi
    .fn<(request: ExecutionConfirmationRequest) => Promise<void>>()
    .mockRejectedValueOnce(new Error('temporary network failure'))
    .mockResolvedValue(undefined);
  render(
    <ExecutionConfirmationInteractionCard
      onRendererReady={onRendererReady}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );

  expect(onRendererReady).toHaveBeenCalledWith(REQUEST);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(onRendererReady).toHaveBeenCalledTimes(2);
  expect(onRendererReady).toHaveBeenLastCalledWith(REQUEST);
});

it('does not retry a failed acknowledgement after the card unmounts', async () => {
  vi.useFakeTimers();
  const onRendererReady = vi
    .fn<(request: ExecutionConfirmationRequest) => Promise<void>>()
    .mockRejectedValue(new Error('renderer unavailable'));
  const view = render(
    <ExecutionConfirmationInteractionCard
      onRendererReady={onRendererReady}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );
  await vi.advanceTimersByTimeAsync(0);
  view.unmount();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(onRendererReady).toHaveBeenCalledOnce();
});

it('stops retrying a version rejection and refreshes the interaction', async () => {
  vi.useFakeTimers();
  const onRendererReady = vi.fn(async () => {
    throw new P1RequestError(
      'version required',
      'HARNESS_INTERACTION_VERSION_REQUIRED',
      undefined,
      426
    );
  });
  const onRendererRejected = vi.fn(async () => undefined);
  render(
    <ExecutionConfirmationInteractionCard
      onRendererReady={onRendererReady}
      onRendererRejected={onRendererRejected}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );

  await vi.advanceTimersByTimeAsync(60_000);
  expect(onRendererReady).toHaveBeenCalledOnce();
  expect(onRendererRejected).toHaveBeenCalledWith(REQUEST);
});

import type { ExecutionConfirmationRequest } from '@meiye/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { ExecutionConfirmationWaitingMessageCard } from '@/product/composer/execution-confirmation-waiting-message-card';

afterEach(cleanup);

const REQUEST: ExecutionConfirmationRequest = {
  requestId: 'execution-request-waiting',
  runId: 'run-waiting',
  step: 'execution_selection',
  revision: 2,
  kind: 'execution_confirmation',
  frozen: {
    executionSnapshotRef: { id: 'snapshot-waiting', revision: 2 },
    quoteRevision: 'quote-r2',
    params: [],
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

it('submits the dedicated continuation message against the rendered identity', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ExecutionConfirmationWaitingMessageCard
      onSubmit={onSubmit}
      request={REQUEST}
    />
  );

  expect(screen.getByText('这次任务已暂停')).toBeInTheDocument();
  await user.type(
    screen.getByRole('textbox', { name: '补充你的调整说明' }),
    '换成更稳妥的方案'
  );
  await user.click(screen.getByRole('button', { name: '继续调整' }));

  expect(onSubmit).toHaveBeenCalledWith(REQUEST, '换成更稳妥的方案');
});

it('clears text when the waiting identity advances', async () => {
  const user = userEvent.setup();
  const view = render(
    <ExecutionConfirmationWaitingMessageCard
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );
  const input = screen.getByRole('textbox', { name: '补充你的调整说明' });
  await user.type(input, '旧请求的说明');

  view.rerender(
    <ExecutionConfirmationWaitingMessageCard
      onSubmit={async () => undefined}
      request={{ ...REQUEST, requestId: 'execution-request-next', revision: 3 }}
    />
  );

  expect(input).toHaveValue('');
});

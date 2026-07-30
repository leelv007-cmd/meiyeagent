import type { AskMerchantQuestionRequest } from '@meiye/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { AskMerchantGroupCard } from './ask-merchant-group-card';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const REQUEST: AskMerchantQuestionRequest = {
  requestId: 'request-1',
  runId: 'run-1',
  step: 'intent_naming',
  revision: 1,
  kind: 'ask_merchant',
  questions: [
    {
      itemId: 'service',
      question: '这次主推哪个项目？',
      options: [
        {
          label: '头皮护理',
          description: '说明只给商家看',
        },
      ],
      freeText: {
        enabled: true,
        placeholder: '也可以直接告诉我',
      },
      fallback: { kind: 'deferred' },
    },
    {
      itemId: 'window',
      question: '活动到哪天结束？',
      fallback: { kind: 'deferred' },
    },
  ],
  groupSkip: true,
  timeoutPolicy: {
    kind: 'hold',
    reason: 'unknown',
    serverEvaluated: true,
  },
  presentation: {
    carriers: ['conversation'],
    blocking: 'none',
    notification: 'none',
    renderer: 'ask_merchant_group',
  },
};

it('renders every item but submits labels without descriptions', async () => {
  const user = userEvent.setup();
  const onEditingChange = vi.fn(async () => undefined);
  const onRendererReady = vi.fn(async () => undefined);
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={onEditingChange}
      onRendererReady={onRendererReady}
      onSubmit={onSubmit}
      request={REQUEST}
    />
  );

  expect(onRendererReady).toHaveBeenCalledOnce();
  expect(screen.getByText('说明只给商家看')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /头皮护理/u }));
  const freeText = screen.getByRole('textbox', {
    name: '活动到哪天结束？',
  });
  await user.click(freeText);
  await user.type(freeText, '2026-08-31');
  await user.tab();
  await user.click(screen.getByRole('button', { name: '提交回答' }));

  expect(onEditingChange).toHaveBeenNthCalledWith(1, REQUEST, true);
  expect(onEditingChange).toHaveBeenLastCalledWith(REQUEST, false);
  expect(onSubmit).toHaveBeenCalledWith({
    kind: 'answer',
    items: [
      {
        itemId: 'service',
        result: { kind: 'answer', value: '头皮护理' },
      },
      {
        itemId: 'window',
        result: { kind: 'answer', value: '2026-08-31' },
      },
    ],
  });
  expect(JSON.stringify(onSubmit.mock.calls)).not.toContain('说明只给商家看');
});

it('accepts custom text beside offered labels', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={onSubmit}
      request={{ ...REQUEST, questions: [REQUEST.questions[0]!] }}
    />
  );

  const freeText = screen.getByRole('textbox', {
    name: '这次主推哪个项目？',
  });
  await user.type(freeText, '直播预告');
  await user.click(screen.getByRole('button', { name: '提交回答' }));

  expect(onSubmit).toHaveBeenCalledWith({
    kind: 'answer',
    items: [
      {
        itemId: 'service',
        result: { kind: 'answer', value: '直播预告' },
      },
    ],
  });
});

it('submits one explicit group skip', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={onSubmit}
      request={REQUEST}
    />
  );

  await user.click(screen.getByRole('button', { name: '整组暂不确定' }));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'skipped' });
});

it('retries the exact renderer acknowledgement after a transient failure', async () => {
  vi.useFakeTimers();
  const onRendererReady = vi
    .fn<(request: AskMerchantQuestionRequest) => Promise<void>>()
    .mockRejectedValueOnce(new Error('temporary network failure'))
    .mockResolvedValue(undefined);

  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
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

it('renews the editing lease while parent polling keeps rerendering', async () => {
  vi.useFakeTimers();
  const editingCalls: Array<[AskMerchantQuestionRequest, boolean]> = [];
  const view = render(
    <AskMerchantGroupCard
      onEditingChange={async (request, editing) => {
        editingCalls.push([request, editing]);
      }}
      onRendererReady={async () => undefined}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );

  fireEvent.focus(
    screen.getByRole('textbox', { name: '活动到哪天结束？' })
  );
  expect(editingCalls).toEqual([[REQUEST, true]]);

  for (let elapsed = 0; elapsed < 32_000; elapsed += 2_000) {
    await vi.advanceTimersByTimeAsync(2_000);
    view.rerender(
      <AskMerchantGroupCard
        onEditingChange={async (request, editing) => {
          editingCalls.push([request, editing]);
        }}
        onRendererReady={async () => undefined}
        onSubmit={async () => undefined}
        request={{ ...REQUEST }}
      />
    );
  }

  expect(editingCalls).toHaveLength(3);
  expect(editingCalls.at(-1)).toEqual([REQUEST, true]);
});

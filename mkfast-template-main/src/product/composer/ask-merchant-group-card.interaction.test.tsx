import type { AskMerchantQuestionRequest } from '@meiye/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { AskMerchantGroupCard } from './ask-merchant-group-card';

afterEach(cleanup);

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
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={onEditingChange}
      onSubmit={onSubmit}
      request={REQUEST}
    />
  );

  expect(screen.getByText('说明只给商家看')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /头皮护理/u }));
  const freeText = screen.getByRole('textbox', {
    name: '活动到哪天结束？',
  });
  await user.click(freeText);
  await user.type(freeText, '2026-08-31');
  await user.tab();
  await user.click(screen.getByRole('button', { name: '提交回答' }));

  expect(onEditingChange).toHaveBeenNthCalledWith(1, true);
  expect(onEditingChange).toHaveBeenLastCalledWith(false);
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

it('submits one explicit group skip', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onSubmit={onSubmit}
      request={REQUEST}
    />
  );

  await user.click(screen.getByRole('button', { name: '整组暂不确定' }));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'skipped' });
});

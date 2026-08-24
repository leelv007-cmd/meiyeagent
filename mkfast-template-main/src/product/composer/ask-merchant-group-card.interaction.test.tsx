import type { AskMerchantQuestionRequest } from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { P1RequestError } from '@/p1/client';
import {
  AskMerchantGroupCard,
  AskMerchantResolutionNotice,
} from '@/product/composer/ask-merchant-group-card';
import { AskMerchantInteractionSlot } from '@/product/composer/ask-merchant-interaction-slot';

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

const SEMANTIC_DEFAULT_REQUEST: AskMerchantQuestionRequest = {
  ...REQUEST,
  timeoutPolicy: {
    kind: 'semantic_default',
    timeoutSeconds: 30,
    eligibility: {
      kind: 'safe',
      serverEvaluated: true,
      effect: 'none',
      quota: 'not_applicable',
      defaultResponse: {
        kind: 'answer',
        items: REQUEST.questions.map((question) => ({
          itemId: question.itemId,
          result: { kind: 'deferred' as const },
        })),
      },
      defaultResponseFingerprint: '0'.repeat(64),
      policyRevision: 'ask-semantic-default/v1',
      conditionRevision: 'request-1:r1',
    },
  },
};

it('states the safe semantic default and Core-owned countdown', () => {
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={async () => undefined}
      request={SEMANTIC_DEFAULT_REQUEST}
    />
  );

  expect(screen.getByTestId('ask-merchant-group-card')).toHaveAttribute(
    'data-auto-continue',
    'true'
  );
  expect(screen.getByTestId('ask-merchant-default')).toHaveTextContent(
    '默认：暂未确定'
  );
  expect(screen.getByTestId('ask-merchant-countdown')).toHaveTextContent(
    '30 秒后按默认继续'
  );
});

it('projects the durable system default in merchant language', () => {
  render(<AskMerchantResolutionNotice />);

  expect(screen.getByTestId('composer-question-settled')).toHaveTextContent(
    '系统已按通用模式继续，你仍可回答并生成精修版本。'
  );
});

it('switches a delivered group question to its durable settled projection', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const snapshots = [
    {
      request: SEMANTIC_DEFAULT_REQUEST,
      resolutionSource: null,
      status: 'pending' as const,
    },
    {
      request: SEMANTIC_DEFAULT_REQUEST,
      resolutionSource: null,
      status: 'pending' as const,
    },
    {
      request: SEMANTIC_DEFAULT_REQUEST,
      resolutionSource: 'system_default' as const,
      status: 'resolved' as const,
    },
  ];
  const readSnapshot = vi.fn(async () => snapshots.shift() ?? snapshots[0]);
  const props = {
    onEditingChange: async () => undefined,
    onRendererReady: async () => undefined,
    onSubmit: async () => undefined,
    pending: false,
    pendingRequest: SEMANTIC_DEFAULT_REQUEST,
    readSnapshot,
    taskId: 'run-1',
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot delivered={false} {...props} />
    </QueryClientProvider>
  );

  expect(screen.getByTestId('ask-merchant-group-card')).toBeInTheDocument();
  await waitFor(() => expect(readSnapshot).toHaveBeenCalledTimes(1));
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot delivered {...props} />
    </QueryClientProvider>
  );

  await waitFor(
    () => {
      expect(readSnapshot).toHaveBeenCalledTimes(3);
      expect(
        screen.getByTestId('composer-question-settled')
      ).toBeInTheDocument();
    },
    { timeout: 5_000 }
  );
  expect(screen.queryByTestId('ask-merchant-group-card')).toBeNull();
}, 6_000);

it('renders every item but submits labels without descriptions', async () => {
  const user = userEvent.setup();
  const onEditingChange = vi.fn(
    async (
      _request: AskMerchantQuestionRequest,
      _editing: boolean,
      _editingSessionId: string
    ) => undefined
  );
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

  const editingSessionId = onEditingChange.mock.calls[0]?.[2];
  expect(editingSessionId).toEqual(expect.any(String));
  expect(onEditingChange).toHaveBeenNthCalledWith(
    1,
    REQUEST,
    true,
    editingSessionId
  );
  expect(onEditingChange).toHaveBeenLastCalledWith(
    REQUEST,
    false,
    editingSessionId
  );
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

it('submits the image-text direction in the option click', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={onSubmit}
      request={{
        ...REQUEST,
        step: 'brief_compilation',
        questions: [
          {
            itemId: 'note_style',
            question: '两种图文方向都已准备好，这次想用哪一种？',
            options: [{ label: '干货科普版' }, { label: '故事氛围版' }],
            freeText: { enabled: false },
            fallback: { kind: 'deferred' },
          },
        ],
      }}
    />
  );

  await user.click(screen.getByRole('button', { name: '干货科普版' }));

  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit).toHaveBeenCalledWith({
    kind: 'answer',
    items: [
      {
        itemId: 'note_style',
        result: { kind: 'answer', value: '干货科普版' },
      },
    ],
  });
  expect(
    screen.queryByRole('button', { name: '提交回答' })
  ).not.toBeInTheDocument();
});

const PRACTICAL_GUIDE_POSITIONING =
  '用清楚、可信、便于收藏的方式解释项目与选择依据。';
const STORY_RECOMMENDATION_POSITIONING =
  '从顾客场景切入，以真实体验路径承接预约行动。';

const NOTE_STYLE_REQUEST: AskMerchantQuestionRequest = {
  ...REQUEST,
  step: 'brief_compilation',
  questions: [
    {
      itemId: 'note_style',
      question: '两种图文方向都已准备好，这次想用哪一种？',
      options: [
        {
          label: '干货科普版',
          description: PRACTICAL_GUIDE_POSITIONING,
        },
        {
          label: '种草叙事版',
          description: STORY_RECOMMENDATION_POSITIONING,
        },
      ],
      freeText: { enabled: false },
      fallback: { kind: 'deferred' },
    },
  ],
};

it('renders full note_style positioning side-by-side for comparison', () => {
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={async () => undefined}
      request={NOTE_STYLE_REQUEST}
    />
  );

  const comparison = screen.getByTestId('ask-merchant-option-comparison');
  expect(comparison).toHaveAttribute('data-option-count', '2');

  const cards = screen.getAllByTestId('ask-merchant-option-card');
  expect(cards).toHaveLength(2);

  const positionings = screen.getAllByTestId('ask-merchant-option-positioning');
  expect(positionings).toHaveLength(2);
  expect(positionings[0]).toHaveTextContent(PRACTICAL_GUIDE_POSITIONING);
  expect(positionings[1]).toHaveTextContent(STORY_RECOMMENDATION_POSITIONING);
  expect(positionings[0]?.textContent).toBe(PRACTICAL_GUIDE_POSITIONING);
  expect(positionings[1]?.textContent).toBe(STORY_RECOMMENDATION_POSITIONING);
  expect(positionings[0]?.textContent).not.toBe(positionings[1]?.textContent);
});

it('submits the note_style label immediately when a comparison card is clicked', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={onSubmit}
      request={NOTE_STYLE_REQUEST}
    />
  );

  await user.click(screen.getAllByTestId('ask-merchant-option-card')[0]!);

  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit).toHaveBeenCalledWith({
    kind: 'answer',
    items: [
      {
        itemId: 'note_style',
        result: { kind: 'answer', value: '干货科普版' },
      },
    ],
  });
  expect(
    screen.queryByRole('button', { name: '提交回答' })
  ).not.toBeInTheDocument();
});

it('keeps non-note_style options on the button row without comparison layout', () => {
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );

  expect(
    screen.queryByTestId('ask-merchant-option-comparison')
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /头皮护理/u })).toBeInTheDocument();
  expect(screen.getByText('说明只给商家看')).toBeInTheDocument();
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

it('requires an explicit resource action without deferred or group-skip controls', () => {
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={async () => undefined}
      onSubmit={async () => undefined}
      request={{
        ...REQUEST,
        step: 'execution_selection',
        questions: [
          {
            itemId: 'bounded_execution_continuation',
            question: '已保留当前最好结果，是否提高上限后继续？',
            options: [{ label: '提高上限后继续' }],
            freeText: { enabled: false },
            fallback: { kind: 'deferred' },
          },
        ],
      }}
    />
  );

  expect(
    screen.getByRole('button', { name: '提高上限后继续' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '暂未确定' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '整组暂不确定' })
  ).not.toBeInTheDocument();
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

it('stops retrying a stale renderer and requests the current interaction', async () => {
  vi.useFakeTimers();
  const onRendererReady = vi.fn(async () => {
    throw new P1RequestError(
      'stale',
      'STALE_INTERACTION_REQUEST',
      undefined,
      409
    );
  });
  const onRendererRejected = vi.fn(async () => undefined);
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
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

it('bounds renderer retries while Core remains unavailable', async () => {
  vi.useFakeTimers();
  const onRendererReady = vi.fn(async () => {
    throw new TypeError('network unavailable');
  });
  render(
    <AskMerchantGroupCard
      onEditingChange={async () => undefined}
      onRendererReady={onRendererReady}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );

  await vi.advanceTimersByTimeAsync(60_000);
  expect(onRendererReady).toHaveBeenCalledTimes(5);
});

it('renews the editing lease while parent polling keeps rerendering', async () => {
  vi.useFakeTimers();
  const editingCalls: Array<[AskMerchantQuestionRequest, boolean, string]> = [];
  const view = render(
    <AskMerchantGroupCard
      onEditingChange={async (request, editing, editingSessionId) => {
        editingCalls.push([request, editing, editingSessionId]);
      }}
      onRendererReady={async () => undefined}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );

  fireEvent.focus(screen.getByRole('textbox', { name: '活动到哪天结束？' }));
  expect(editingCalls).toHaveLength(1);
  const editingSessionId = editingCalls[0]?.[2];
  expect(editingSessionId).toEqual(expect.any(String));
  expect(editingCalls[0]).toEqual([REQUEST, true, editingSessionId]);

  for (let elapsed = 0; elapsed < 32_000; elapsed += 2_000) {
    await vi.advanceTimersByTimeAsync(2_000);
    view.rerender(
      <AskMerchantGroupCard
        onEditingChange={async (request, editing, nextEditingSessionId) => {
          editingCalls.push([request, editing, nextEditingSessionId]);
        }}
        onRendererReady={async () => undefined}
        onSubmit={async () => undefined}
        request={{ ...REQUEST }}
      />
    );
  }

  expect(editingCalls).toHaveLength(3);
  expect(editingCalls.at(-1)).toEqual([REQUEST, true, editingSessionId]);
});

it('uses a new editing owner after blur so a stale release cannot end it', () => {
  const editingCalls: Array<[boolean, string]> = [];
  render(
    <AskMerchantGroupCard
      onEditingChange={async (_request, editing, editingSessionId) => {
        editingCalls.push([editing, editingSessionId]);
      }}
      onRendererReady={async () => undefined}
      onSubmit={async () => undefined}
      request={REQUEST}
    />
  );
  const input = screen.getByRole('textbox', {
    name: '活动到哪天结束？',
  });

  fireEvent.focus(input);
  fireEvent.blur(input);
  fireEvent.focus(input);

  expect(editingCalls).toHaveLength(3);
  const firstSessionId = editingCalls[0]?.[1];
  const secondSessionId = editingCalls[2]?.[1];
  expect(editingCalls[1]).toEqual([false, firstSessionId]);
  expect(editingCalls[2]).toEqual([true, secondSessionId]);
  expect(secondSessionId).not.toBe(firstSessionId);
});

it('keeps an answered question closed, and only that one', async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Both reads keep reporting the question after the workflow consumed the
  // answer; re-rendering off them asked the merchant again with nothing chosen.
  const readSnapshot = vi.fn(async () => ({
    request: REQUEST,
    resolutionSource: null,
    status: 'pending' as const,
  }));
  const onSubmit = vi.fn(async () => undefined);
  const props = {
    delivered: false,
    onEditingChange: async () => undefined,
    onRendererReady: async () => undefined,
    onSubmit,
    pending: false,
    readSnapshot,
    taskId: 'run-1',
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot {...props} pendingRequest={REQUEST} />
    </QueryClientProvider>
  );
  await user.click(screen.getByRole('button', { name: '整组暂不确定' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  // The stale reads are still pending, and the card must stay gone anyway.
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot {...props} pendingRequest={REQUEST} />
    </QueryClientProvider>
  );
  await waitFor(() =>
    expect(screen.queryByTestId('ask-merchant-group-card')).toBeNull()
  );

  // Memory of an answer belongs to that request only: the next question — a new
  // revision, or another run entirely — is still the merchant's to answer.
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot
        {...props}
        pendingRequest={{ ...REQUEST, revision: 2 }}
      />
    </QueryClientProvider>
  );
  expect(screen.getByTestId('ask-merchant-group-card')).toBeInTheDocument();
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot
        {...props}
        pendingRequest={{ ...REQUEST, requestId: 'request-2' }}
      />
    </QueryClientProvider>
  );
  expect(screen.getByTestId('ask-merchant-group-card')).toBeInTheDocument();
});

it('gives the question back when the answer never reached Core', async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const readSnapshot = vi.fn(async () => ({
    request: REQUEST,
    resolutionSource: null,
    status: 'pending' as const,
  }));
  const onSubmit = vi.fn(async () => {
    throw new Error('the merchant interaction could not be submitted');
  });
  const props = {
    delivered: false,
    onEditingChange: async () => undefined,
    onRendererReady: async () => undefined,
    onSubmit,
    pending: false,
    pendingRequest: REQUEST,
    readSnapshot,
    taskId: 'run-1',
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot {...props} />
    </QueryClientProvider>
  );
  await user.click(screen.getByRole('button', { name: '整组暂不确定' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <AskMerchantInteractionSlot {...props} />
    </QueryClientProvider>
  );
  expect(screen.getByTestId('ask-merchant-group-card')).toBeInTheDocument();
});

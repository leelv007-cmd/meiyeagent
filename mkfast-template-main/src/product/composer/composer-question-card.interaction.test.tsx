/**
 * RTL: 意图确认卡 — 默认值 · 手动继续 · 超时放行 (D-116, T31 / #225).
 *
 * The countdown is driven by fake timers so the contract is tested rather than
 * waited out; the real 30s baseline is exercised end-to-end in the journey spec.
 */
import type { QuestionCard } from '@meiye/contracts';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cardLanguageIssues } from './card-language';
import {
  ComposerQuestionCard,
  composerQuestionDecision,
} from './composer-question-card';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const QUESTION: QuestionCard = {
  questionId: 'task-1:s1:industry_category',
  workflowId: 'task-1',
  workflowRevision: 2,
  question: '这次内容主要属于哪一类美业服务？',
  options: [
    { id: 'option-1', label: '美发' },
    { id: 'option-2', label: '美甲' },
  ],
  freeText: { enabled: true, placeholder: '也可以直接告诉我' },
  response: {
    field: 'industry_category',
    reason: '让这次内容更贴合你的实际情况',
  },
  scope: 'current_task',
};

/** Advance the countdown by `seconds`, one 1s timer per tick. */
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
  }
}

describe('the card states its default and releases itself', () => {
  it('shows the default value 「继续」 and a timeout will both apply', () => {
    render(<ComposerQuestionCard onDecide={() => {}} question={QUESTION} />);
    expect(screen.getByTestId('composer-question-default')).toHaveTextContent(
      '按通用模式生成'
    );
    expect(screen.getByTestId('composer-question-countdown')).toHaveTextContent(
      '秒后按默认继续'
    );
  });

  it('「继续」 applies the default immediately, as an ignored decision', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<ComposerQuestionCard onDecide={onDecide} question={QUESTION} />);

    await user.click(screen.getByTestId('composer-question-continue'));
    expect(onDecide).toHaveBeenCalledWith({ skipped: true, value: '' });
    // 「不补充也继续」 is the harness's own ignored route, not a new state.
    expect(
      composerQuestionDecision({
        question: QUESTION,
        idempotencyKey: 'k',
        skipped: true,
        value: '',
      }).decision.state
    ).toBe('ignored');
  });

  it('releases itself when the countdown runs out — 引导不变成阻断', async () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={QUESTION}
        timeoutSeconds={3}
      />
    );

    await tick(2);
    expect(onDecide).not.toHaveBeenCalled();

    await tick(1);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({ skipped: true, value: '' });
    expect(screen.getByTestId('composer-question-settled')).toHaveTextContent(
      '按通用模式继续'
    );
  });
});

describe('D-116 safety edges', () => {
  it('① editing pauses the countdown instead of continuing past the merchant', async () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={QUESTION}
        timeoutSeconds={3}
      />
    );

    // fireEvent, not userEvent: userEvent's own async scheduling deadlocks
    // against fake timers, and what is under test is the pause, not typing.
    await act(async () => {
      fireEvent.change(screen.getByTestId('composer-question-answer'), {
        target: { value: '皮肤' },
      });
    });
    await tick(10);

    // 防「调整未完成被自动继续」: nothing is posted while they are still typing.
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-question-card')).toHaveAttribute(
      'data-auto-continue',
      'false'
    );
    expect(screen.queryByTestId('composer-question-countdown')).toBeNull();
  });

  it('② quota falls back to an explicit confirmation, never an auto-release', async () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <ComposerQuestionCard
        hold="quota"
        onDecide={onDecide}
        question={QUESTION}
        timeoutSeconds={2}
      />
    );

    await tick(10);
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-question-hold')).toHaveTextContent(
      '额度'
    );
    // The card still moves forward on purpose — it is a fallback, not a wall.
    expect(screen.getByTestId('composer-question-continue')).toBeEnabled();
  });
});

describe('the answer wins the race with the countdown', () => {
  it('an answer at the last second settles the card; the timeout is a no-op', async () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={QUESTION}
        timeoutSeconds={30}
      />
    );

    // t=29: the merchant taps an option one second before the release.
    await tick(29);
    expect(onDecide).not.toHaveBeenCalled();
    await act(async () => {
      screen.getByTestId('composer-question-option-option-1').click();
    });

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({ skipped: false, value: '美发' });

    // t=30 and well past: the countdown must not post the competing 跳过.
    await tick(10);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('composer-question-card')).toHaveAttribute(
      'data-settlement',
      'answered'
    );
    expect(screen.getByTestId('composer-question-settled')).toHaveTextContent(
      '已按你的回答继续'
    );
  });

  it('a second click cannot post a second decision either', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<ComposerQuestionCard onDecide={onDecide} question={QUESTION} />);

    await user.click(screen.getByTestId('composer-question-skip'));
    await user.click(screen.getByTestId('composer-question-continue'));
    expect(onDecide).toHaveBeenCalledTimes(1);
  });
});

describe('the card speaks merchant language', () => {
  it('every visible sentence passes the D-116 gate', () => {
    render(<ComposerQuestionCard onDecide={() => {}} question={QUESTION} />);
    const card = screen.getByTestId('composer-question-card');
    expect(
      // The question text is core's; the ids are the run's own.
      cardLanguageIssues(card.textContent ?? '', [
        QUESTION.questionId,
        QUESTION.workflowId,
      ])
    ).toEqual([]);
  });
});

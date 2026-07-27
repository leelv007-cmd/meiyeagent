/**
 * RTL: 意图确认卡 — 默认值 · 手动继续 · 超时放行 (D-116, T31 / #225).
 *
 * The countdown is driven by fake timers so the contract is tested rather than
 * waited out; the real 30s baseline is exercised end-to-end in the journey spec.
 */
import type { QuestionCard } from '@meiye/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
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
  unattended: 'continue',
  scope: 'current_task',
};
const NORMAL_RECEIPT = {
  eventId: 'event-1',
  replayed: false,
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
    render(
      <ComposerQuestionCard
        onDecide={() => NORMAL_RECEIPT}
        question={QUESTION}
        timeoutSeconds={30}
      />
    );
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
    expect(onDecide).toHaveBeenCalledWith({ settlement: 'skipped', value: '' });
    // 「不补充也继续」 is the harness's own ignored route, not a new state.
    expect(
      composerQuestionDecision({
        question: QUESTION,
        idempotencyKey: 'k',
        settlement: 'skipped',
        value: '',
      }).decision.state
    ).toBe('ignored');
  });

  it('is one control, not two synonyms for the same decision', () => {
    render(
      <ComposerQuestionCard
        onDecide={() => NORMAL_RECEIPT}
        question={QUESTION}
      />
    );
    // 「继续」 and 「这次先跳过」 posted the identical ignored decision under
    // different words — a choice the merchant did not actually have.
    expect(
      screen.getByTestId('composer-question-continue')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('composer-question-skip')).toBeNull();
  });

  it('refuses to invent a browser timeout decision', () => {
    expect(() =>
      composerQuestionDecision({
        question: QUESTION,
        idempotencyKey: 'k',
        settlement: 'continued_elsewhere',
        value: '',
      })
    ).toThrow(/merchant act/u);
  });

  it('shows Core time reaching zero without posting a second timeout truth', async () => {
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
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-question-countdown')).toHaveTextContent(
      '0 秒'
    );
  });
});

describe('D-116 safety edges', () => {
  it('hold never starts a local countdown or auto-submits', async () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={{ ...QUESTION, unattended: 'hold' }}
        timeoutSeconds={null}
      />
    );
    await tick(10);
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
  /** A submit that never settles — the card stays mid-flight for the test. */
  const inFlight = () => vi.fn(() => new Promise<undefined>(() => {}));

  it('an answer at the last second settles the card; the timeout is a no-op', async () => {
    vi.useFakeTimers();
    const onDecide = inFlight();
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={QUESTION}
        timeoutSeconds={30}
      />
    );

    // t=29: the merchant taps an option one second before the release, and the
    // POST is still in flight when the countdown would have fired.
    await tick(29);
    expect(onDecide).not.toHaveBeenCalled();
    await act(async () => {
      screen.getByTestId('composer-question-option-option-1').click();
    });

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({
      settlement: 'answered',
      value: '美发',
    });

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

  it('an answer remains available after the displayed Core deadline', async () => {
    vi.useFakeTimers();
    const onDecide = inFlight();
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={QUESTION}
        timeoutSeconds={1}
      />
    );

    await tick(1);
    expect(onDecide).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByTestId('composer-question-option-option-1').click();
    });
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({
      settlement: 'answered',
      value: '美发',
    });
  });

  it('two decisions inside one tick post exactly once', async () => {
    // No render happens between these two handlers, so `settlement` state is
    // still null for both — the ref is the only thing that can stop the second.
    const onDecide = vi.fn(() => new Promise<undefined>(() => {}));
    render(<ComposerQuestionCard onDecide={onDecide} question={QUESTION} />);

    await act(async () => {
      screen.getByTestId('composer-question-option-option-1').click();
      screen.getByTestId('composer-question-continue').click();
    });
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({
      settlement: 'answered',
      value: '美发',
    });
  });
});

describe('a decision that never reached the ledger rolls back', () => {
  it('the answer path: the card does not claim a run that did not continue', async () => {
    const onDecide = vi.fn(() => Promise.reject(new Error('network down')));
    render(<ComposerQuestionCard onDecide={onDecide} question={QUESTION} />);

    await act(async () => {
      screen.getByTestId('composer-question-option-option-1').click();
    });

    expect(onDecide).toHaveBeenCalledTimes(1);
    // Nothing landed, so nothing may claim it did.
    expect(screen.queryByTestId('composer-question-settled')).toBeNull();
    expect(screen.getByTestId('composer-question-card')).toHaveAttribute(
      'data-settlement',
      ''
    );
    expect(screen.getByTestId('composer-question-failed')).toHaveTextContent(
      '没提交成功'
    );
    // And the card is interactive again — a retry must be possible.
    expect(screen.getByTestId('composer-question-continue')).toBeEnabled();
    await act(async () => {
      screen.getByTestId('composer-question-option-option-2').click();
    });
    expect(onDecide).toHaveBeenCalledTimes(2);
  });

  it('shows Core timeout and hold-expiry outcomes without hiding late answer', () => {
    render(
      <ComposerQuestionCard
        onDecide={() => NORMAL_RECEIPT}
        question={QUESTION}
        resolutionSource="core_timeout"
        timeoutSeconds={30}
      />
    );
    expect(screen.getByTestId('composer-question-settled')).toHaveTextContent(
      '仍可回答'
    );
    cleanup();
    render(
      <ComposerQuestionCard
        onDecide={() => NORMAL_RECEIPT}
        question={{ ...QUESTION, unattended: 'hold' }}
        resolutionSource="core_hold_expired"
        timeoutSeconds={null}
      />
    );
    expect(screen.getByTestId('composer-question-settled')).toHaveTextContent(
      '已取消，额度已退回'
    );
    expect(screen.getByTestId('composer-question-submit')).toBeDisabled();
    expect(screen.getByTestId('composer-question-answer')).toBeEnabled();
  });
});

describe('Core decision receipts stay visible', () => {
  it('shows the successor created by a late answer', async () => {
    const onDecide = vi.fn(async () => ({
      eventId: 'event-late',
      replayed: false,
      successor: {
        snapshotId: 'snapshot-late',
        workflowId: 'workflow-late',
      },
    }));
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={QUESTION}
        resolutionSource="core_timeout"
        timeoutSeconds={30}
      />
    );
    await act(async () => {
      screen.getByTestId('composer-question-option-option-1').click();
    });
    expect(screen.getByTestId('composer-question-settled')).toHaveTextContent(
      '精修版本'
    );
  });

  it('does not silently claim a browser timeout that lost the Core race', async () => {
    const onDecide = vi.fn(async () => ({
      consumedByOther: true as const,
      eventId: null,
    }));
    render(
      <ComposerQuestionCard
        onDecide={onDecide}
        question={QUESTION}
        timeoutSeconds={30}
      />
    );
    await act(async () => {
      screen.getByTestId('composer-question-continue').click();
    });
    expect(screen.getByTestId('composer-question-settled')).toHaveTextContent(
      '同步最新状态'
    );
  });
});

describe('the card speaks merchant language', () => {
  it('every visible sentence passes the D-116 gate', () => {
    render(
      <ComposerQuestionCard
        onDecide={() => NORMAL_RECEIPT}
        question={QUESTION}
      />
    );
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

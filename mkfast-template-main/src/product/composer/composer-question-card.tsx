/**
 * 生成式 UI 问题卡 / 意图确认卡 (D-111 引导 · D-116 确认卡, T30 #224 / T31 #225).
 *
 * T11 owns the routing and the wording; this container owns the presentation.
 * The card is never a wall (ADR-0018 三问纪律): it states the default it will
 * apply, offers 「继续」 to apply it now, and releases itself when the countdown
 * runs out — 引导永不变成新阻断.
 *
 * Every release path posts a real structured decision through the same seam the
 * merchant's own answer uses, so the ledger and DBOS move for real; nothing
 * here pretends the run continued. D-116's two safety edges are honoured: the
 * countdown pauses as soon as the merchant starts editing, and it never fires
 * when quota or an external effect means D-112 wants an explicit confirmation.
 *
 * The card renders inline in the flow — not a modal, not a slot form (D-031).
 */

import type { QuestionCard, StructuredDecisionInput } from '@meiye/contracts';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
  COMPOSER_QUESTION_TIMEOUT_SECONDS,
  projectComposerQuestionCard,
  type ComposerQuestionHold,
  type ComposerQuestionSettlement,
} from './composer-question-timeout';

export const COMPOSER_QUESTION_SKIP_VALUE = '这次先跳过';

export function composerQuestionDecision(input: {
  question: QuestionCard;
  value: string;
  skipped: boolean;
  idempotencyKey: string;
}): StructuredDecisionInput {
  const value = input.skipped
    ? COMPOSER_QUESTION_SKIP_VALUE
    : input.value.trim();
  if (!value) throw new Error('An answered question requires a value.');
  return {
    idempotencyKey: input.idempotencyKey,
    questionId: input.question.questionId,
    workflowRevision: input.question.workflowRevision,
    patch: {
      field: input.question.response.field,
      value,
      reason: input.question.response.reason,
    },
    decision: {
      state: input.skipped ? 'ignored' : 'accepted',
      value,
    },
  };
}

export function ComposerQuestionCard({
  disabled = false,
  hold = null,
  onDecide,
  pending = false,
  question,
  timeoutSeconds = COMPOSER_QUESTION_TIMEOUT_SECONDS,
}: {
  disabled?: boolean;
  /** Withholds auto-release per D-116 safety edge ② — host-computed. */
  hold?: ComposerQuestionHold | null;
  onDecide: (input: { skipped: boolean; value: string }) => void;
  pending?: boolean;
  question: QuestionCard;
  /** Overridable so a test does not have to wait out the real countdown. */
  timeoutSeconds?: number;
}) {
  const [answer, setAnswer] = useState('');
  const [editing, setEditing] = useState(false);
  const [remaining, setRemaining] = useState(timeoutSeconds);
  const [settlement, setSettlement] =
    useState<ComposerQuestionSettlement | null>(null);
  /**
   * Race guard. The merchant answering at t=29 and the countdown reaching zero
   * at t=30 are a real race, and the answer must win. Settlement is recorded
   * synchronously on the click — before any await — so the timer sees it and
   * never posts the competing 「跳过」 at all. (Core would refuse the second
   * decision anyway: consumption is CAS exactly-once. This keeps the card's own
   * terminal state truthful about which decision actually landed.)
   */
  const settledRef = useRef(false);
  const busy = pending || disabled;

  const decide = (
    input: { skipped: boolean; value: string },
    as: ComposerQuestionSettlement
  ) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setSettlement(as);
    onDecide(input);
  };
  /** Keeps the timeout effect off `decide` in its dependency list. */
  const decideRef = useRef(decide);
  decideRef.current = decide;

  const view = projectComposerQuestionCard({
    editing,
    hold,
    remainingSeconds: remaining,
    settlement,
  });

  // A different question is a different countdown.
  useEffect(() => {
    settledRef.current = false;
    setAnswer('');
    setEditing(false);
    setRemaining(timeoutSeconds);
    setSettlement(null);
  }, [question.questionId, timeoutSeconds]);

  // Tick, then fire on the next pass. Releasing from inside the state updater
  // would post a decision during render; releasing from the timeout callback
  // would read a stale `settledRef` capture — this way the guard is re-read
  // after every tick, which is what makes the t=29 answer win the race.
  useEffect(() => {
    if (!view.autoContinueEnabled || disabled) return;
    if (remaining <= 0) {
      decideRef.current({ skipped: true, value: '' }, 'timed_out');
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [view.autoContinueEnabled, disabled, remaining]);

  const startEditing = () => {
    // D-116 safety edge ①: 用户开始编辑卡片即暂停倒计时.
    if (!editing) setEditing(true);
  };

  return (
    <section
      className="meiye-porcelain rounded-2xl p-4"
      data-auto-continue={view.autoContinueEnabled ? 'true' : 'false'}
      data-question-id={question.questionId}
      data-settlement={settlement ?? ''}
      data-testid="composer-question-card"
    >
      <p className="text-foreground text-sm">{question.question}</p>
      <p className="text-muted mt-1 text-xs">{question.response.reason}</p>

      {/* 默认值：what 「继续」 and a timeout both apply, stated up front. */}
      <p
        className="text-muted mt-2 text-xs"
        data-testid="composer-question-default"
      >
        默认：{view.defaultLabel}
      </p>

      {question.options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {question.options.map((option) => (
            <Button
              data-testid={`composer-question-option-${option.id}`}
              disabled={busy}
              key={option.id}
              onClick={() =>
                decide({ skipped: false, value: option.label }, 'answered')
              }
              size="sm"
              type="button"
              variant="secondary"
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}

      {question.freeText.enabled ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            aria-label={question.question}
            className="h-9 max-w-xs"
            data-testid="composer-question-answer"
            disabled={busy}
            onChange={(event) => {
              startEditing();
              setAnswer(event.target.value);
            }}
            onFocus={startEditing}
            placeholder={question.freeText.placeholder ?? '也可以直接告诉我'}
            value={answer}
          />
          <Button
            data-testid="composer-question-submit"
            disabled={busy || !answer.trim()}
            onClick={() =>
              decide({ skipped: false, value: answer }, 'answered')
            }
            size="sm"
            type="button"
          >
            就这样
          </Button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* 手动「继续」键 — applies the default now instead of waiting it out. */}
        <Button
          data-testid="composer-question-continue"
          disabled={busy || settlement !== null}
          onClick={() => decide({ skipped: true, value: '' }, 'skipped')}
          size="sm"
          type="button"
          variant="secondary"
        >
          继续
        </Button>
        <Button
          data-testid="composer-question-skip"
          disabled={busy || settlement !== null}
          onClick={() => decide({ skipped: true, value: '' }, 'skipped')}
          size="sm"
          type="button"
          variant="ghost"
        >
          这次先跳过
        </Button>
      </div>

      {view.settledNotice ? (
        <p
          className="text-muted mt-2 text-xs"
          data-testid="composer-question-settled"
        >
          {view.settledNotice}
        </p>
      ) : view.holdNotice ? (
        <p
          className="text-muted mt-2 text-xs"
          data-testid="composer-question-hold"
        >
          {view.holdNotice}
        </p>
      ) : view.countdownNotice ? (
        <p
          aria-live="polite"
          className="text-muted mt-2 text-xs"
          data-testid="composer-question-countdown"
        >
          {view.countdownNotice}
        </p>
      ) : null}
    </section>
  );
}

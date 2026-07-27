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

import {
  questionCardUnattended,
  type HarnessDecisionSubmitResult,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
  projectComposerQuestionCard,
  type ComposerQuestionHold,
  type ComposerQuestionResolutionSource,
  type ComposerQuestionSettlement,
} from './composer-question-timeout';

type ComposerQuestionDecisionResult = undefined | HarnessDecisionSubmitResult;

/** The merchant tapped 「继续」 — they really performed that act. */
export const COMPOSER_QUESTION_SKIP_VALUE = '这次先跳过';

/**
 * Nobody answered. The value core records lands in the ledger *and* in the
 * workflow's own intent context (`Merchant decision (<field>): <value>`), so
 * recording 「这次先跳过」 for a countdown would put a sentence in the
 * merchant's mouth that they never said. This states the absence instead.
 *
 * It is not the empty string only because the seam forbids one:
 * `assistantPatchDecisionSchema.value` is `min(1)` (packages/contracts).
 */
/**
 * The browser only submits merchant acts. Core records unattended timeout
 * decisions itself, so this builder cannot create a browser timeout sentinel.
 */
export function composerQuestionDecision(input: {
  question: QuestionCard;
  value: string;
  settlement: ComposerQuestionSettlement;
  idempotencyKey: string;
}): StructuredDecisionInput {
  if (input.settlement !== 'answered' && input.settlement !== 'skipped') {
    throw new Error('Only a merchant act can create a browser decision.');
  }
  const value =
    input.settlement === 'skipped'
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
      state: input.settlement === 'answered' ? 'accepted' : 'ignored',
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
  resolutionSource = null,
  timeoutSeconds = null,
}: {
  disabled?: boolean;
  /** Withholds auto-release per D-116 safety edge ② — host-computed. */
  hold?: ComposerQuestionHold | null;
  /**
   * Posts the decision. Rejecting means nothing reached the ledger, and the
   * card rolls its settlement back rather than keep claiming the run moved on.
   */
  onDecide: (input: {
    settlement: ComposerQuestionSettlement;
    value: string;
  }) =>
    | ComposerQuestionDecisionResult
    | Promise<ComposerQuestionDecisionResult>;
  pending?: boolean;
  question: QuestionCard;
  resolutionSource?: ComposerQuestionResolutionSource;
  /** Core projection of the durable admin-config value. */
  timeoutSeconds?: number | null;
}) {
  const [answer, setAnswer] = useState('');
  const [remaining, setRemaining] = useState(timeoutSeconds ?? 0);
  const [settlement, setSettlement] =
    useState<ComposerQuestionSettlement | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Race guard. The merchant answering at t=29 and the countdown reaching zero
   * at t=30 are a real race, and the answer must win. Settlement is claimed
   * synchronously — before any await — so the timer sees it and never posts the
   * competing default at all. (Core would refuse the second decision anyway:
   * consumption is CAS exactly-once. This keeps the card's own terminal state
   * truthful about which decision actually landed.)
   *
   * Claimed, not committed: if the post fails the claim is released, because a
   * decision that never reached the ledger must not keep the card settled.
   */
  const settledRef = useRef(false);
  const busy = pending || disabled;

  const decide = async (value: string, as: ComposerQuestionSettlement) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setSettlement(as);
    setFailed(false);
    try {
      const result = await onDecide({ settlement: as, value });
      if (result && 'consumedByOther' in result) {
        setSettlement('continued_elsewhere');
      } else if (result?.successor) {
        setSettlement('late_answered');
      }
    } catch {
      // Nothing landed. Release the claim, drop the settled notice, say so —
      // and re-arm the countdown so a failed auto-release still ends up
      // continuing rather than turning the guidance into the block D-116
      // forbids.
      settledRef.current = false;
      setSettlement(null);
      setFailed(true);
      setRemaining(timeoutSeconds ?? 0);
    }
  };
  const view = projectComposerQuestionCard({
    failed,
    hold,
    remainingSeconds: remaining,
    resolutionSource,
    settlement,
    timeoutSeconds,
    unattended: questionCardUnattended(question),
  });

  // A different question is a different countdown.
  useEffect(() => {
    settledRef.current = false;
    setAnswer('');
    setRemaining(timeoutSeconds ?? 0);
    setSettlement(null);
    setFailed(false);
  }, [question.questionId, timeoutSeconds]);

  // The timer is display-only. Core's durable recv owns the terminal
  // transition and persists the timeout decision exactly once.
  useEffect(() => {
    if (!view.autoContinueEnabled || disabled) return;
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [view.autoContinueEnabled, disabled, remaining]);

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
              onClick={() => void decide(option.label, 'answered')}
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
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={question.freeText.placeholder ?? '也可以直接告诉我'}
            value={answer}
          />
          <Button
            data-testid="composer-question-submit"
            disabled={busy || !answer.trim()}
            onClick={() => void decide(answer, 'answered')}
            size="sm"
            type="button"
          >
            就这样
          </Button>
        </div>
      ) : null}

      {/*
        One control, not two. 「继续」 and 「这次先跳过」 posted the identical
        ignored decision under different words, which reads as a choice the
        merchant does not actually have. The default line directly above states
        what this applies, so 「继续」 alone is unambiguous (D-116 手动「继续」键).
      */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          data-testid="composer-question-continue"
          disabled={busy || settlement !== null}
          onClick={() => void decide('', 'skipped')}
          size="sm"
          type="button"
          variant="secondary"
        >
          继续
        </Button>
      </div>

      {view.failureNotice ? (
        <p
          className="text-destructive mt-2 text-xs"
          data-testid="composer-question-failed"
          role="alert"
        >
          {view.failureNotice}
        </p>
      ) : null}

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

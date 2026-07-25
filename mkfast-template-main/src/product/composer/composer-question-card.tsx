/**
 * 引导补问卡 in the conversation (D-111 引导 / D-116 确认卡, T30 / #224).
 *
 * T11 owns the routing and the wording; it handed the skip presentation to this
 * container. The card is never a wall: every question offers 「这次先跳过」,
 * which posts an `ignored` decision, and the workflow routes to 自由创作 and
 * says so out loud rather than downgrading silently.
 *
 * The card renders inline in the flow — not a modal, not a slot form (D-031).
 */

import type { QuestionCard, StructuredDecisionInput } from '@meiye/contracts';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  onDecide,
  pending = false,
  question,
}: {
  disabled?: boolean;
  onDecide: (input: { skipped: boolean; value: string }) => void;
  pending?: boolean;
  question: QuestionCard;
}) {
  const [answer, setAnswer] = useState('');
  const busy = pending || disabled;

  return (
    <section
      className="meiye-porcelain rounded-2xl p-4"
      data-question-id={question.questionId}
      data-testid="composer-question-card"
    >
      <p className="text-foreground text-sm">{question.question}</p>
      <p className="text-muted mt-1 text-xs">{question.response.reason}</p>

      {question.options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {question.options.map((option) => (
            <Button
              data-testid={`composer-question-option-${option.id}`}
              disabled={busy}
              key={option.id}
              onClick={() => onDecide({ skipped: false, value: option.label })}
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
            onClick={() => onDecide({ skipped: false, value: answer })}
            size="sm"
            type="button"
          >
            就这样
          </Button>
        </div>
      ) : null}

      <Button
        className="mt-3"
        data-testid="composer-question-skip"
        disabled={busy}
        onClick={() => onDecide({ skipped: true, value: '' })}
        size="sm"
        type="button"
        variant="ghost"
      >
        这次先跳过
      </Button>
    </section>
  );
}

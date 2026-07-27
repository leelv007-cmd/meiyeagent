import type { QuestionCard, StructuredDecisionInput } from '@meiye/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  harness_question_answer_placeholder,
  harness_question_error,
  harness_question_scope_current_series,
  harness_question_scope_current_task,
  harness_question_scope_workspace,
  harness_question_submit,
  harness_question_submitting,
  harness_question_title,
} from '@/locale/paraglide/messages';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  readPendingHarnessDecision,
  submitHarnessDecision,
} from '@/product/harness-client';
import { useWorkflowEventStream } from '@/product/use-workflow-event-stream';

const SCOPE_LABELS: Record<QuestionCard['scope'], () => string> = {
  current_series: harness_question_scope_current_series,
  current_task: harness_question_scope_current_task,
  workspace: harness_question_scope_workspace,
};

export function harnessDecisionInput(
  question: QuestionCard,
  rawAnswer: string,
  idempotencyKey: string
): StructuredDecisionInput {
  const value = rawAnswer.trim();
  if (!value) throw new Error('A blocking question requires an answer.');
  return {
    idempotencyKey,
    questionId: question.questionId,
    workflowRevision: question.workflowRevision,
    patch: {
      field: question.response.field,
      value,
      reason: question.response.reason,
    },
    decision: { state: 'accepted', value },
  };
}

export function missingHarnessDecisionNotificationTask(
  exists: boolean | undefined,
  taskId: string,
  notifiedTaskId: string | undefined
) {
  return exists === false && notifiedTaskId !== taskId ? taskId : undefined;
}

export function HarnessQuestionCard({
  onMissing,
  onResolved,
  taskId,
}: {
  onMissing?: () => void;
  onResolved?: () => void;
  taskId: string;
}) {
  const queryClient = useQueryClient();
  const onMissingRef = useRef(onMissing);
  const missingNotificationTaskRef = useRef<string | undefined>(undefined);
  const queryKey = useMemo(
    () => ['harness', 'decision', taskId] as const,
    [taskId]
  );
  const decision = useQuery({
    queryKey,
    queryFn: ({ signal }) => readPendingHarnessDecision(taskId, signal),
    retry: false,
  });
  const stream = useWorkflowEventStream({
    enabled: decision.data?.exists === true,
    workflowId: taskId,
    workflowQueryKey: ['harness', 'workflow', taskId],
  });
  const question = decision.data?.question;
  const [answer, setAnswer] = useState('');
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    onMissingRef.current = onMissing;
  }, [onMissing]);

  useEffect(() => {
    setAnswer('');
    setSubmissionKey(crypto.randomUUID());
  }, [question?.questionId]);

  useEffect(() => {
    if (stream.latestProgress?.state === 'suspended') {
      void decision.refetch();
    }
  }, [decision.refetch, stream.latestProgress?.eventId]);

  useEffect(() => {
    if (decision.data?.exists === true) {
      missingNotificationTaskRef.current = undefined;
      return;
    }
    const missingTaskId = missingHarnessDecisionNotificationTask(
      decision.data?.exists,
      taskId,
      missingNotificationTaskRef.current
    );
    if (!missingTaskId) return;
    missingNotificationTaskRef.current = missingTaskId;
    onMissingRef.current?.();
  }, [decision.data?.exists, taskId]);

  useEffect(() => {
    if (stream.transportStatus !== 'closed') return;
    void queryClient.invalidateQueries({
      queryKey: ['harness', 'today-recommendation'],
    });
    void queryClient.invalidateQueries({ queryKey: p1QueryKeys.all });
  }, [queryClient, stream.transportStatus]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!question) throw new Error('No authoritative question is pending.');
      return submitHarnessDecision(
        taskId,
        harnessDecisionInput(question, answer, submissionKey)
      );
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKey, { exists: true, question: null });
      onResolved?.();
    },
    onError: () => void decision.refetch(),
  });

  if (!decision.data?.exists) return null;

  return (
    <div className="space-y-3" data-testid="harness-decision-stream">
      {stream.latestProgress?.message ? (
        <p
          aria-live="polite"
          className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground"
        >
          {stream.latestProgress.message}
        </p>
      ) : null}

      {question ? (
        <section
          aria-labelledby={`question-${question.questionId}`}
          className="meiye-porcelain meiye-porcelain-edge-accent space-y-4 rounded-2xl border border-primary/15 p-5"
          data-question-id={question.questionId}
        >
          <div>
            <p className="text-xs font-medium text-primary">
              {harness_question_title()}
            </p>
            <h3
              className="mt-2 text-base font-semibold"
              id={`question-${question.questionId}`}
            >
              {question.question}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {SCOPE_LABELS[question.scope]()}
            </p>
          </div>

          {question.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <Button
                  aria-pressed={answer === option.label}
                  key={option.id}
                  onClick={() => setAnswer(option.label)}
                  type="button"
                  variant={answer === option.label ? 'secondary' : 'outline'}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}

          {question.freeText.enabled ? (
            <Input
              aria-label={question.question}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={
                question.freeText.placeholder ??
                harness_question_answer_placeholder()
              }
              value={answer}
            />
          ) : null}

          {submit.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {harness_question_error()}
            </p>
          ) : null}

          <Button
            disabled={!answer.trim() || submit.isPending}
            onClick={() => submit.mutate()}
            type="button"
          >
            {submit.isPending
              ? harness_question_submitting()
              : harness_question_submit()}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

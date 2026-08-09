/**
 * Idle first-screen: primary MarketingGoal + proactive suggestions (V31-24).
 *
 * Mounted only when WorkbenchSessionProjection is Idle. No Goal management page.
 * Every suggestion must show「为什么现在」evidence; accept never auto-charges.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { commandP1, queryP1 } from '@/p1/client';

export type IdlePrimaryGoal = {
  goalId: string;
  statement: string;
  objective: string;
  priority: string;
  status: string;
};

export type IdleGoalProgress = {
  goalId: string;
  deliveredWorkCount: number;
  evidenceCount: number;
  statement: string;
};

export type IdleProactiveSuggestion = {
  candidateId: string;
  reason: string;
  evidenceRefs: Array<{ kind: string; ref: string }>;
  goalId?: string;
  status: string;
};

export type IdleGoalProactiveProjection = {
  primaryGoal: IdlePrimaryGoal | null;
  progress: IdleGoalProgress | null;
  gate: {
    open: boolean;
    reason: string;
  };
  suggestions: IdleProactiveSuggestion[];
};

export type IdleGoalProactiveLoader =
  () => Promise<IdleGoalProactiveProjection>;

const defaultLoadIdleProjection: IdleGoalProactiveLoader = () =>
  queryP1<IdleGoalProactiveProjection>('goal-proactive', {
    action: 'get_idle_projection',
    payload: {},
  });

export type IdleGoalProactivePanelProps = {
  loadProjection?: IdleGoalProactiveLoader;
  onAccept?: (input: {
    candidateId: string;
    threadId: string;
    runId: string;
  }) => void;
  onDismiss?: (candidateId: string) => void;
  className?: string;
};

export function IdleGoalProactivePanel({
  loadProjection = defaultLoadIdleProjection,
  onAccept,
  onDismiss,
  className,
}: IdleGoalProactivePanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['goal-proactive', 'idle-projection'],
    queryFn: () => loadProjection(),
  });

  const acceptMutation = useMutation({
    mutationFn: async (suggestion: IdleProactiveSuggestion) => {
      const result = await commandP1<{
        threadId: string;
        runId: string;
        paidSideEffect: false;
        replayed: boolean;
      }>(
        'goal-proactive',
        {
          action: 'accept_opportunity',
          payload: {
            candidateId: suggestion.candidateId,
            reason: suggestion.reason,
            evidenceRefs: suggestion.evidenceRefs,
            ...(suggestion.goalId ? { goalId: suggestion.goalId } : {}),
          },
        },
        `accept-opportunity:${suggestion.candidateId}`
      );
      return result;
    },
    onSuccess: (result, suggestion) => {
      void queryClient.invalidateQueries({
        queryKey: ['goal-proactive', 'idle-projection'],
      });
      onAccept?.({
        candidateId: suggestion.candidateId,
        threadId: result.threadId,
        runId: result.runId,
      });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      await commandP1(
        'goal-proactive',
        {
          action: 'dismiss_opportunity',
          payload: { candidateId },
        },
        `dismiss-opportunity:${candidateId}`
      );
      return candidateId;
    },
    onSuccess: (candidateId) => {
      void queryClient.invalidateQueries({
        queryKey: ['goal-proactive', 'idle-projection'],
      });
      onDismiss?.(candidateId);
    },
  });

  const handleAccept = useCallback(
    (suggestion: IdleProactiveSuggestion) => {
      acceptMutation.mutate(suggestion);
    },
    [acceptMutation]
  );

  const handleDismiss = useCallback(
    (candidateId: string) => {
      dismissMutation.mutate(candidateId);
    },
    [dismissMutation]
  );

  if (query.isLoading) {
    return (
      <section
        className={className}
        data-testid="idle-goal-proactive"
        data-state="loading"
      />
    );
  }

  if (query.isError || !query.data) {
    return (
      <section
        className={className}
        data-testid="idle-goal-proactive"
        data-state="error"
      />
    );
  }

  const { primaryGoal, progress, suggestions, gate } = query.data;
  const hasGoal = Boolean(primaryGoal);
  const hasSuggestions = suggestions.length > 0;

  if (!hasGoal && !hasSuggestions) {
    return (
      <section
        className={className}
        data-gate-open={gate.open ? 'true' : 'false'}
        data-gate-reason={gate.reason}
        data-testid="idle-goal-proactive"
        data-state="empty"
      />
    );
  }

  return (
    <section
      className={className}
      data-gate-open={gate.open ? 'true' : 'false'}
      data-gate-reason={gate.reason}
      data-testid="idle-goal-proactive"
      data-state="ready"
    >
      {primaryGoal ? (
        <div data-testid="idle-primary-goal">
          <p className="text-sm font-medium text-foreground">当前目标</p>
          <p
            className="mt-1 text-base text-foreground"
            data-testid="idle-primary-goal-statement"
          >
            {primaryGoal.statement}
          </p>
          {progress ? (
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="idle-primary-goal-progress"
            >
              已交付 {progress.deliveredWorkCount} · 经营信号{' '}
              {progress.evidenceCount}
            </p>
          ) : null}
        </div>
      ) : null}

      {hasSuggestions ? (
        <ul className="mt-3 space-y-2" data-testid="idle-proactive-suggestions">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.candidateId}
              className="rounded-lg border border-border/60 bg-background/80 p-3"
              data-candidate-id={suggestion.candidateId}
              data-testid="idle-proactive-suggestion"
            >
              <p
                className="text-sm text-foreground"
                data-testid="idle-suggestion-reason"
              >
                {suggestion.reason}
              </p>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-testid="idle-suggestion-why-now"
              >
                为什么现在：
                {suggestion.evidenceRefs
                  .map((ref) => `${ref.kind}:${ref.ref}`)
                  .join(' · ')}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                  data-testid="idle-suggestion-accept"
                  disabled={acceptMutation.isPending}
                  onClick={() => handleAccept(suggestion)}
                  type="button"
                >
                  接受建议
                </button>
                <button
                  className="rounded-md border border-border px-2.5 py-1 text-xs"
                  data-testid="idle-suggestion-dismiss"
                  disabled={dismissMutation.isPending}
                  onClick={() => handleDismiss(suggestion.candidateId)}
                  type="button"
                >
                  忽略
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

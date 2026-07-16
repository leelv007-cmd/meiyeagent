import {
  IconAlertCircle,
  IconArrowRight,
  IconBulb,
  IconCheck,
  IconHelpCircle,
  IconSparkles,
} from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { m } from '@/locale/paraglide/messages';

import type {
  NextWeekCandidateView,
  WeeklyBatchAction,
  WeeklyBatchItemView,
  WeeklyReviewFactView,
} from './types';

const BATCH_ACTION_LABEL: Record<WeeklyBatchAction, () => string> = {
  apply_template: m.p1_week_batch_action_apply_template,
  create: m.p1_week_batch_action_create,
  prepare_draft: m.p1_week_batch_action_prepare_draft,
  revise: m.p1_week_batch_action_revise,
};

export interface WeeklyBatchProps {
  label: string;
  items: WeeklyBatchItemView[];
  availableActions: WeeklyBatchAction[];
  pending?: boolean;
  onSelectionChange: (taskId: string, selected: boolean) => void;
  onBulkAction: (action: WeeklyBatchAction, taskIds: string[]) => void;
  onOpenTask: (taskId: string) => void;
}

export function WeeklyBatch({
  label,
  items,
  availableActions,
  pending = false,
  onSelectionChange,
  onBulkAction,
  onOpenTask,
}: WeeklyBatchProps) {
  const selectedExecutableIds = items
    .filter((item) => item.selected && item.executable)
    .map((item) => item.task.id);

  return (
    <section aria-labelledby="p1-weekly-batch-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            {m.p1_week_batch_eyebrow()}
          </p>
          <h2 id="p1-weekly-batch-title" className="text-lg font-semibold">
            {label}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {availableActions.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={action === 'create' ? 'default' : 'outline'}
              disabled={pending || selectedExecutableIds.length === 0}
              onClick={() => onBulkAction(action, selectedExecutableIds)}
            >
              {action === 'create' && <IconSparkles aria-hidden="true" />}
              {BATCH_ACTION_LABEL[action]()}
              {selectedExecutableIds.length > 0 && (
                <span className="tabular-nums">
                  {selectedExecutableIds.length}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      <div className="divide-y overflow-hidden rounded-xl border">
        {items.map((item) => (
          <div
            key={item.task.id}
            className="flex items-start gap-3 bg-background p-3"
          >
            <Checkbox
              checked={item.selected}
              disabled={!item.executable || pending}
              onCheckedChange={(checked) =>
                onSelectionChange(item.task.id, checked === true)
              }
              aria-label={m.p1_week_batch_select_aria({
                title: item.task.title,
              })}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{item.task.title}</p>
                <Badge variant="outline">{item.task.sourceLabel}</Badge>
                {item.publishConfirmationRequired && (
                  <Badge
                    variant="outline"
                    className="border-amber-300 text-amber-700 dark:text-amber-300"
                  >
                    {m.p1_week_batch_publish_confirmation()}
                  </Badge>
                )}
              </div>
              {item.task.dueLabel && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.task.dueLabel}
                </p>
              )}
              {!item.executable && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
                  <IconAlertCircle className="size-4" aria-hidden="true" />
                  {item.exclusionReason ?? m.p1_task_blocked_fallback()}
                </p>
              )}
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => onOpenTask(item.task.id)}
              aria-label={m.p1_week_batch_open_aria({ title: item.task.title })}
            >
              <IconArrowRight aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {m.p1_week_batch_footnote()}
      </p>
    </section>
  );
}

export interface ThinWeeklyReviewProps {
  label: string;
  facts: WeeklyReviewFactView[];
  candidates: NextWeekCandidateView[];
  pendingCandidateIds?: string[];
  onConfirmCandidate: (candidateId: string) => void;
  onDismissCandidate: (candidateId: string) => void;
}

export function ThinWeeklyReview({
  label,
  facts,
  candidates,
  pendingCandidateIds = [],
  onConfirmCandidate,
  onDismissCandidate,
}: ThinWeeklyReviewProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <IconBulb className="size-5 text-primary" aria-hidden="true" />
          <CardTitle>{label}</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          {m.p1_week_review_description()}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {facts.map((fact) => {
            const unknown = fact.value === null;
            return (
              <div
                key={fact.id}
                className="overflow-hidden rounded-lg bg-card px-4 py-5 shadow-sm ring-1 ring-foreground/10 sm:p-6"
              >
                <dt className="truncate text-sm font-medium text-muted-foreground">
                  {fact.label}
                </dt>
                <dd className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight tabular-nums">
                  {unknown ? (
                    <>
                      <IconHelpCircle
                        className="size-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-muted-foreground">
                        unknown
                      </span>
                    </>
                  ) : (
                    fact.value
                  )}
                </dd>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {unknown ? fact.unknownReason : fact.evidenceLabel}
                </p>
              </div>
            );
          })}
        </dl>

        <div className="space-y-2">
          <div>
            <h3 className="font-medium">{m.p1_week_candidates_title()}</h3>
            <p className="text-xs text-muted-foreground">
              {m.p1_week_candidates_description()}
            </p>
          </div>
          {candidates.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {m.p1_week_candidates_empty()}
            </p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((candidate) => {
                const pending = pendingCandidateIds.includes(candidate.id);
                return (
                  <li
                    key={candidate.id}
                    className="rounded-lg border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{candidate.title}</p>
                          {candidate.status !== 'pending' && (
                            <Badge variant="outline">
                              {candidate.status === 'confirmed'
                                ? m.p1_week_candidate_confirmed()
                                : m.p1_week_candidate_dismissed()}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {candidate.rationale}
                        </p>
                      </div>
                      {candidate.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => onDismissCandidate(candidate.id)}
                          >
                            {m.p1_week_candidate_dismiss()}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending}
                            onClick={() => onConfirmCandidate(candidate.id)}
                          >
                            <IconCheck aria-hidden="true" />
                            {m.p1_week_candidate_confirm()}
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

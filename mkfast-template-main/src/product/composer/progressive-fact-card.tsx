/**
 * Inline Day-0 progressive store fact card (#148 / W01).
 * One question at a time; one confirmation emits one finalize intake batch.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  account_usage_retry,
  progressive_fact_address_label,
  progressive_fact_booking_label,
  progressive_fact_brand_voice_label,
  progressive_fact_city_label,
  progressive_fact_confirm,
  progressive_fact_continue,
  progressive_fact_district_label,
  progressive_fact_fallback_label,
  progressive_fact_impact_label,
  progressive_fact_name_label,
  progressive_fact_project_name_label,
  progressive_fact_project_price_label,
  progressive_fact_skip,
  progressive_fact_title,
  progressive_fact_why_label,
  workbench_operation_failed,
} from '@/locale/paraglide/messages';
import type { StoreFact, StoreProfile } from '@meiye/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  answerProgressiveFact,
  buildFinalizeStoreIntakeCommand,
  createProgressiveFactDraft,
  progressiveFactRevisionMap,
  projectProgressiveFactView,
  skipProgressiveFact,
  type FinalizeStoreIntakeRequest,
  type ProgressiveFactDraft,
  type ProgressiveFactId,
} from './progressive-fact';

const LABELS: Record<ProgressiveFactId, () => string> = {
  name: progressive_fact_name_label,
  city: progressive_fact_city_label,
  projectName: progressive_fact_project_name_label,
  projectPrice: progressive_fact_project_price_label,
  district: progressive_fact_district_label,
  address: progressive_fact_address_label,
  booking: progressive_fact_booking_label,
  brandVoice: progressive_fact_brand_voice_label,
};

export type ProgressiveFactCardProps = {
  activeFacts: Array<Pick<StoreFact, 'factId' | 'revision'>>;
  createConfirmationId?: () => string;
  factHeads: Array<Pick<StoreFact, 'factId' | 'revision'>>;
  now?: () => string;
  onConfirm: (
    request: FinalizeStoreIntakeRequest,
    idempotencyKey: string
  ) => Promise<void> | void;
  pending?: boolean;
  store?: StoreProfile;
  workspaceId: string;
};

export function ProgressiveFactCard({
  activeFacts,
  createConfirmationId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `progressive-${Date.now()}`,
  factHeads,
  now = () => new Date().toISOString(),
  onConfirm,
  pending = false,
  store,
  workspaceId,
}: ProgressiveFactCardProps) {
  const [draft, setDraft] = useState<ProgressiveFactDraft>(() =>
    createProgressiveFactDraft(store, activeFacts)
  );
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(false);
  const requestRef = useRef<{
    idempotencyKey: string;
    request: FinalizeStoreIntakeRequest;
  } | null>(null);
  const view = useMemo(() => projectProgressiveFactView(draft), [draft]);
  const current = view.current;

  useEffect(() => {
    setValue(current ? draft[current.id] : '');
  }, [current?.id, draft]);

  const applyAnswer = (nextDraft: ProgressiveFactDraft) => {
    setDraft(nextDraft);
    setValue('');
  };

  const handleContinue = () => {
    if (!current) return;
    const next = answerProgressiveFact(draft, current.id, value);
    applyAnswer(next);
  };

  const handleSkip = () => {
    if (!current || current.criticality !== 'skippable') return;
    const next = skipProgressiveFact(draft, current.id);
    if (!next) return;
    applyAnswer(next);
  };

  const handleConfirm = async () => {
    let submission = requestRef.current;
    if (!submission) {
      const id = createConfirmationId();
      const request = buildFinalizeStoreIntakeCommand(draft, {
        batchId: `progressive-batch:${id}`,
        capturedAt: now(),
        expectedRevision: store?.revision ?? 0,
        factRevisions: progressiveFactRevisionMap(factHeads),
        referenceId: `progressive-card:${id}`,
        taskId: `progressive-task:${id}`,
        workspaceId,
      });
      if (!request) return;
      submission = {
        idempotencyKey: `progressive-finalize:${id}`,
        request,
      };
      requestRef.current = submission;
    }
    setSubmissionError(false);
    setSubmitting(true);
    try {
      await onConfirm(submission.request, submission.idempotencyKey);
    } catch {
      setSubmissionError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="progressive-fact-title"
      className="rounded-2xl border border-border bg-muted/30 p-4"
      data-testid="progressive-fact-card"
    >
      <h2 className="text-base font-medium" id="progressive-fact-title">
        {progressive_fact_title()}
      </h2>

      {current ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-medium">{LABELS[current.id]()}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">
              {progressive_fact_why_label()}：
            </span>
            {current.why}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">
              {progressive_fact_impact_label()}：
            </span>
            {current.impact}
          </p>
          {current.safeFallback ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">
                {progressive_fact_fallback_label()}：
              </span>
              {current.safeFallback}
            </p>
          ) : null}
          <Input
            aria-label={LABELS[current.id]()}
            data-testid="progressive-fact-input"
            disabled={pending || submitting}
            inputMode={current.inputKind === 'number' ? 'decimal' : 'text'}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleContinue();
              }
            }}
            type={current.inputKind === 'number' ? 'number' : 'text'}
            value={value}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="progressive-fact-continue"
              disabled={pending || submitting || value.trim().length === 0}
              onClick={handleContinue}
              size="sm"
              type="button"
            >
              {progressive_fact_continue()}
            </Button>
            {current.criticality === 'skippable' ? (
              <Button
                data-testid="progressive-fact-skip"
                disabled={pending || submitting}
                onClick={handleSkip}
                size="sm"
                type="button"
                variant="outline"
              >
                {progressive_fact_skip()}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {view.readyToConfirm && draft.answered.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          {view.skipImpacts.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {view.skipImpacts.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {submissionError ? (
            <div
              className="space-y-2"
              data-testid="progressive-fact-submit-error"
              role="alert"
            >
              <p className="text-sm text-destructive">
                {workbench_operation_failed()}
              </p>
              <Button
                data-testid="progressive-fact-retry"
                disabled={pending || submitting}
                onClick={() => void handleConfirm()}
                type="button"
                variant="outline"
              >
                {account_usage_retry()}
              </Button>
            </div>
          ) : (
            <Button
              data-testid="progressive-fact-confirm"
              disabled={pending || submitting}
              onClick={() => void handleConfirm()}
              type="button"
            >
              {progressive_fact_confirm()}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

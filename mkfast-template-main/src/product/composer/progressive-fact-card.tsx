/**
 * Inline Day-0 progressive store fact card (#148).
 * One question at a time; skippable facts explain safe fallback + impact.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
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
} from '@/locale/paraglide/messages';
import type { ProductCommand } from '@meiye/contracts';
import { useMemo, useState } from 'react';

import {
  answerProgressiveFact,
  buildConfirmStoreCommand,
  createProgressiveFactDraft,
  projectProgressiveFactView,
  skipProgressiveFact,
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
  onConfirm: (command: ProductCommand) => Promise<void> | void;
  pending?: boolean;
};

export function ProgressiveFactCard({
  onConfirm,
  pending = false,
}: ProgressiveFactCardProps) {
  const [draft, setDraft] = useState<ProgressiveFactDraft>(() =>
    createProgressiveFactDraft()
  );
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const view = useMemo(() => projectProgressiveFactView(draft), [draft]);
  const current = view.current;

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
    const command = buildConfirmStoreCommand(draft);
    if (!command) return;
    setSubmitting(true);
    try {
      await onConfirm(command);
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

      {view.readyToConfirm ? (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          {view.skipImpacts.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {view.skipImpacts.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <Button
            data-testid="progressive-fact-confirm"
            disabled={pending || submitting}
            onClick={() => void handleConfirm()}
            type="button"
          >
            {progressive_fact_confirm()}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * "这个价格用到什么时候？" — the one control that asks it (#244).
 *
 * Shared by the inline Day-0 card and the five-step wizard on purpose: the rule
 * that matters here is that leaving it alone is *not* an answer, and a rule
 * written twice is a rule that will eventually be written differently. Nothing
 * is preselected, and the date lane cannot reach into the past, so the merchant
 * either says "it stands" or says which day it runs out — the product never
 * decides for them.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  progressive_fact_price_validity_date_label,
  progressive_fact_price_validity_long_term,
  progressive_fact_price_validity_until,
} from '@/locale/paraglide/messages';

import { PRICE_VALIDITY_LONG_TERM } from './progressive-fact';

/** Local calendar day, the unit the merchant actually thinks in. */
function localDay(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The earliest day a merchant can pick. Today already counts: a price good
 * "through today" is a real thing to say, and the answer expires at the end of
 * the chosen day rather than the start of it.
 */
export function earliestPriceValidityDay(now: Date) {
  return localDay(now);
}

export function PriceValidityAnswer({
  disabled = false,
  now = () => new Date(),
  onChange,
  testId,
  value,
}: {
  disabled?: boolean;
  now?: () => Date;
  onChange: (value: string) => void;
  /** Prefix for the control's test ids; the two mount points differ only here. */
  testId: string;
  value: string;
}) {
  const standing = value === PRICE_VALIDITY_LONG_TERM;
  const dated = value !== '' && !standing;
  const minimum = earliestPriceValidityDay(now());

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap gap-2">
        <Button
          aria-pressed={standing}
          data-testid={`${testId}-long-term`}
          disabled={disabled}
          onClick={() => onChange(PRICE_VALIDITY_LONG_TERM)}
          size="sm"
          type="button"
          variant={standing ? 'default' : 'outline'}
        >
          {progressive_fact_price_validity_long_term()}
        </Button>
        <Button
          aria-pressed={dated}
          data-testid={`${testId}-until`}
          disabled={disabled}
          // Switching lanes clears the answer instead of guessing a date, so a
          // half-made choice stays visibly unfinished.
          onClick={() => onChange(dated ? value : '')}
          size="sm"
          type="button"
          variant={dated ? 'default' : 'outline'}
        >
          {progressive_fact_price_validity_until()}
        </Button>
      </div>
      {standing ? null : (
        <div>
          <Label className="text-xs" htmlFor={`${testId}-date`}>
            {progressive_fact_price_validity_date_label()}
          </Label>
          <Input
            className="mt-1"
            data-testid={`${testId}-date`}
            disabled={disabled}
            id={`${testId}-date`}
            min={minimum}
            onChange={(event) => onChange(event.target.value)}
            type="date"
            value={dated ? value : ''}
          />
        </div>
      )}
    </div>
  );
}

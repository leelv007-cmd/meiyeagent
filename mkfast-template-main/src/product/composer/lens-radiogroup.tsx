/**
 * Composer lens radiogroup (D-081).
 *
 * - Visible group label + required semantics
 * - Cold: no selected value
 * - No inferred-lens live announcements while typing
 * - Keyboard / focus friendly
 */

import type { CreationLensId } from '@meiye/contracts';
import { cn } from '@/lib/utils';

import {
  COMPOSER_LENS_OPTIONS,
  LENS_GROUP_LABEL,
  LENS_REQUIRED_SUBMIT_HINT,
} from './lens-labels';

export type LensRadiogroupProps = {
  /** null = cold unselected (no default). */
  value: CreationLensId | null;
  onChange: (lensId: CreationLensId) => void;
  disabled?: boolean;
  /** When true, surface the required submit hint and mark group invalid. */
  showRequiredHint?: boolean;
  id?: string;
  className?: string;
};

const GROUP_ID = 'composer-lens-radiogroup';
const LABEL_ID = 'composer-lens-radiogroup-label';
const HINT_ID = 'composer-lens-radiogroup-hint';

export function LensRadiogroup({
  value,
  onChange,
  disabled = false,
  showRequiredHint = false,
  id = GROUP_ID,
  className,
}: LensRadiogroupProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div id={LABEL_ID} className="text-sm font-medium text-foreground">
        {LENS_GROUP_LABEL}
        <span className="text-destructive" aria-hidden="true">
          {' '}
          *
        </span>
      </div>

      <div
        id={id}
        role="radiogroup"
        aria-labelledby={LABEL_ID}
        aria-required="true"
        aria-invalid={showRequiredHint || undefined}
        aria-describedby={showRequiredHint ? HINT_ID : undefined}
        data-testid="composer-lens-radiogroup"
        className="flex flex-wrap gap-2"
      >
        {COMPOSER_LENS_OPTIONS.map((option) => {
          const selected = value === option.id;
          return (
            <label
              key={option.id}
              className={cn(
                'relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:bg-accent',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              <input
                type="radio"
                name={id}
                value={option.id}
                checked={selected}
                tabIndex={selected || value === null ? 0 : -1}
                disabled={disabled}
                data-testid={`composer-lens-option-${option.id}`}
                data-state={selected ? 'checked' : 'unchecked'}
                className="absolute inset-0 appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={() => onChange(option.id)}
                onKeyDown={(event) => {
                  if (disabled) return;
                  const currentIndex = COMPOSER_LENS_OPTIONS.findIndex(
                    (item) => item.id === (value ?? option.id)
                  );
                  let nextIndex = -1;
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    nextIndex =
                      (Math.max(currentIndex, 0) + 1) %
                      COMPOSER_LENS_OPTIONS.length;
                  } else if (
                    event.key === 'ArrowLeft' ||
                    event.key === 'ArrowUp'
                  ) {
                    event.preventDefault();
                    nextIndex =
                      (Math.max(currentIndex, 0) -
                        1 +
                        COMPOSER_LENS_OPTIONS.length) %
                      COMPOSER_LENS_OPTIONS.length;
                  } else if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    onChange(option.id);
                    return;
                  }
                  if (nextIndex >= 0) {
                    const next = COMPOSER_LENS_OPTIONS[nextIndex];
                    if (next) {
                      onChange(next.id);
                      queueMicrotask(() => {
                        document
                          .querySelector<HTMLElement>(
                            `[data-testid="composer-lens-option-${next.id}"]`
                          )
                          ?.focus();
                      });
                    }
                  }
                }}
              />
              <span className="relative pointer-events-none">
                {option.label}
              </span>
            </label>
          );
        })}
      </div>

      {showRequiredHint ? (
        <p
          id={HINT_ID}
          role="alert"
          data-testid="composer-lens-required-hint"
          className="text-sm text-destructive"
        >
          {LENS_REQUIRED_SUBMIT_HINT}
        </p>
      ) : null}

      {/*
        Intentionally NO aria-live region that would announce inferred lens
        while the user types. Selection changes are user-explicit only.
      */}
    </div>
  );
}

import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';

import { cn } from '@/lib/utils';
import { m } from '@/locale/paraglide/messages';

import type { WeekPointStatus, WeekPointView } from './types';

const STATUS_DOT_CLASS: Record<WeekPointStatus, string> = {
  planned: 'bg-sky-500',
  draft: 'bg-violet-500',
  review: 'bg-amber-500',
  ready: 'bg-emerald-500',
  published: 'bg-primary',
  gap: 'bg-destructive',
  unknown: 'bg-muted-foreground',
};

export interface CompactWeekStripProps {
  label: string;
  points: WeekPointView[];
  className?: string;
}

export function hasWeekData(points: WeekPointView[]) {
  return points.some(
    (point) =>
      point.status !== 'unknown' ||
      (point.contentCount ?? 0) > 0 ||
      Boolean(point.gapLabel)
  );
}

export function CompactWeekStrip({
  label,
  points,
  className,
}: CompactWeekStripProps) {
  const hasData = hasWeekData(points);

  return (
    <section
      aria-label={m.p1_week_strip_aria({ label })}
      className={cn('space-y-2', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="meiye-type-body font-medium">{label}</p>
        <p className="meiye-type-aux">{m.p1_week_strip_readonly()}</p>
      </div>
      {hasData ? (
        <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-divider sm:grid-cols-5">
          {points.map((point) => (
            <li key={point.id} className="min-w-0 bg-surface-1 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="meiye-type-aux">{point.weekday}</p>
                  <p className="font-medium tabular-nums">{point.dateLabel}</p>
                </div>
                <span
                  className={cn(
                    'mt-1 size-2 shrink-0 rounded-full',
                    STATUS_DOT_CLASS[point.status]
                  )}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                {point.status === 'gap' ? (
                  <IconAlertCircle
                    className="size-3.5 text-destructive"
                    aria-hidden="true"
                  />
                ) : point.status === 'published' ? (
                  <IconCircleCheck
                    className="size-3.5 text-primary"
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{point.statusLabel}</span>
                {typeof point.contentCount === 'number' && (
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {m.p1_week_content_count({ count: point.contentCount })}
                  </span>
                )}
              </div>
              {point.gapLabel && (
                <p className="mt-1 line-clamp-1 text-xs text-destructive">
                  {point.gapLabel}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-xl bg-surface-1 px-4 py-3 text-sm text-muted-foreground">
          {m.p1_week_strip_empty()}
        </p>
      )}
    </section>
  );
}

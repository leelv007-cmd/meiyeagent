/**
 * One Living Plan document section (V31-10 / V3.1 §5.3 / §28.4).
 */

import { cn } from '@/lib/utils';

import type {
  LivingPlanSectionKey,
  LivingPlanSectionRow,
} from './living-plan-model';

export type PlanSectionProps = {
  sectionKey: LivingPlanSectionKey;
  title: string;
  body: string;
  rows?: readonly LivingPlanSectionRow[];
  className?: string;
};

export function PlanSection({
  sectionKey,
  title,
  body,
  rows,
  className,
}: PlanSectionProps) {
  return (
    <section
      className={cn(
        'meiye-living-plan-section border-border/50 flex flex-col gap-1.5 border-b py-3 last:border-b-0',
        className
      )}
      data-section-key={sectionKey}
      data-surface="plan_section"
      data-testid={`agent-plan-section-${sectionKey}`}
    >
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      {rows && rows.length > 0 ? (
        <dl className="grid gap-1.5 sm:grid-cols-2">
          {rows.map((row) => (
            <div
              className="bg-background/50 rounded-lg border border-border/40 px-2.5 py-1.5"
              key={`${sectionKey}-${row.label}`}
            >
              <dt className="text-muted text-xs">{row.label}</dt>
              <dd className="text-foreground text-sm leading-snug">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted text-sm leading-relaxed whitespace-pre-wrap">
          {body}
        </p>
      )}
    </section>
  );
}

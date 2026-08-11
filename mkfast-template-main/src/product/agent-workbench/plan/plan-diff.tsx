/**
 * Readable plan revision diff (V31-10).
 */

import { cn } from '@/lib/utils';

import type { PlanDiffView } from './plan-diff-model';

export type PlanDiffProps = {
  diff: PlanDiffView;
  className?: string;
};

export function PlanDiff({ diff, className }: PlanDiffProps) {
  if (!diff.hasChanges) return null;

  return (
    <aside
      className={cn(
        'border-primary/20 bg-primary/5 flex flex-col gap-2 rounded-xl border px-3 py-2.5',
        className
      )}
      data-from-revision={diff.fromRevision}
      data-surface="plan_diff"
      data-testid="agent-plan-diff"
      data-to-revision={diff.toRevision}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">方案调整</h3>
        <p className="text-muted text-xs">
          r{diff.fromRevision} → r{diff.toRevision}
        </p>
      </header>
      {diff.adjustmentSummary ? (
        <p
          className="text-foreground text-sm"
          data-testid="agent-plan-diff-adjustment"
        >
          {diff.adjustmentSummary}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5" data-testid="agent-plan-diff-list">
        {diff.changedEntries.map((entry) => (
          <li
            className="text-muted text-xs leading-relaxed"
            data-diff-kind={entry.kind}
            data-section-key={entry.sectionKey}
            data-testid="agent-plan-diff-entry"
            key={entry.sectionKey}
          >
            <span className="text-foreground font-medium">
              {entry.sectionTitle}
            </span>
            ：{entry.summary.replace(`${entry.sectionTitle}：`, '')}
          </li>
        ))}
      </ul>
    </aside>
  );
}

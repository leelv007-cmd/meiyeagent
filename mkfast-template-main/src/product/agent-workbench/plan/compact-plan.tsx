/**
 * Compact Plan surface (V31-10).
 *
 * Unifies existing Brief summary + quote status + confirm presentation into
 * one Workstream-native compact document + commit strip — not a second parallel
 * card family.
 */

import { cn } from '@/lib/utils';

import { resolveControlledSurface } from '../controlled-surface-registry';
import { CommitStrip } from './commit-strip';
import type { CommitStripAction, CommitStripView } from './commit-strip-model';
import type { LivingPlanView } from './living-plan-model';

export type CompactPlanProps = {
  view: LivingPlanView;
  commitStrip: CommitStripView;
  onCommitAction?: (action: CommitStripAction) => void;
  onExpand?: () => void;
  busy?: boolean;
  className?: string;
};

export function CompactPlan({
  view,
  commitStrip,
  onCommitAction,
  onExpand,
  busy = false,
  className,
}: CompactPlanProps) {
  const statusLine = commitStrip.statusLine;
  const gate = resolveControlledSurface({
    surface: 'compact_plan',
    props: {
      planId: view.planId,
      revision: view.revision,
      compactSummary: view.compactSummary,
      statusLine,
    },
  });
  if (!gate.ok) return null;

  // Prefer goal + deliverables + cost rows (Brief-equivalent summary).
  const briefRows = view.sections
    .filter((section) =>
      ['goal', 'deliverables', 'facts_assets', 'cost_duration'].includes(
        section.key
      )
    )
    .flatMap((section) =>
      section.rows
        .slice(0, section.key === 'deliverables' ? 3 : 2)
        .map((row) => ({
          key: `${section.key}-${row.label}`,
          label: row.label,
          value: row.value,
        }))
    );

  return (
    <section
      className={cn(
        'meiye-compact-plan border-border flex flex-col gap-3 rounded-2xl border p-3',
        className
      )}
      data-plan-id={view.planId}
      data-revision={view.revision}
      data-surface="compact_plan"
      data-testid="agent-compact-plan"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-sm font-semibold">方案摘要</h2>
          <p
            className="text-muted mt-0.5 text-xs leading-relaxed"
            data-testid="agent-compact-plan-summary"
          >
            {view.compactSummary}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-muted text-xs"
            data-testid="agent-compact-plan-revision"
          >
            r{view.revision}
          </span>
          {onExpand ? (
            <button
              className="text-primary text-xs font-medium underline-offset-2 hover:underline"
              data-testid="agent-compact-plan-expand"
              onClick={onExpand}
              type="button"
            >
              查看完整方案
            </button>
          ) : null}
        </div>
      </header>

      {briefRows.length > 0 ? (
        <dl
          className="grid gap-1.5 sm:grid-cols-2"
          data-testid="agent-compact-plan-rows"
        >
          {briefRows.map((row) => (
            <div className="bg-muted/30 rounded-lg px-2.5 py-1.5" key={row.key}>
              <dt className="text-muted text-xs">{row.label}</dt>
              <dd className="text-foreground text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <CommitStrip busy={busy} onAction={onCommitAction} view={commitStrip} />
    </section>
  );
}

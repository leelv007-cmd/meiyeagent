/**
 * Living Plan live document in Workstream (V31-10 / V3.1 §5.3).
 *
 * Desktop: inline document sections + optional compact mode + commit strip.
 * Mobile: Bottom Sheet (Drawer) for full plan; compact stays in stream.
 */

import { useMemo, useState } from 'react';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

import { CommitStrip } from './commit-strip';
import {
  commitStripInputFromPlanFacts,
  projectCommitStrip,
  type CommitStripAction,
  type CommitStripView,
} from './commit-strip-model';
import { CompactPlan } from './compact-plan';
import {
  projectLivingPlanView,
  type LivingPlanRevisionFacts,
  type LivingPlanView,
} from './living-plan-model';
import { PlanDiff } from './plan-diff';
import { diffLivingPlanFacts, type PlanDiffView } from './plan-diff-model';
import { PlanSection } from './plan-section';

export type LivingPlanProps = {
  /** Append-only revision history (latest last). */
  revisions: readonly LivingPlanRevisionFacts[];
  /** When true, render Compact Plan (Brief/quote/confirm unified). */
  compact?: boolean;
  viewport?: 'mobile' | 'desktop';
  /** Override commit strip projection (e.g. live balance). */
  commitStrip?: CommitStripView;
  onCommitAction?: (action: CommitStripAction) => void;
  busy?: boolean;
  className?: string;
};

export function LivingPlan({
  revisions,
  compact = false,
  viewport = 'desktop',
  commitStrip: commitStripOverride,
  onCommitAction,
  busy = false,
  className,
}: LivingPlanProps) {
  const history = revisions.filter(Boolean);
  const latest = history[history.length - 1];
  const [viewedRevision, setViewedRevision] = useState<number | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const activeRevisionNumber = viewedRevision ?? latest?.revision ?? null;
  const activeFacts =
    history.find((item) => item.revision === activeRevisionNumber) ?? latest;

  const view: LivingPlanView | null = useMemo(
    () => (activeFacts ? projectLivingPlanView(activeFacts) : null),
    [activeFacts]
  );

  const previousFacts = useMemo(() => {
    if (!activeFacts) return null;
    const index = history.findIndex(
      (item) => item.revision === activeFacts.revision
    );
    if (index <= 0) return null;
    return history[index - 1] ?? null;
  }, [activeFacts, history]);

  const diff: PlanDiffView | null = useMemo(() => {
    if (!previousFacts || !activeFacts) return null;
    return diffLivingPlanFacts(previousFacts, activeFacts);
  }, [previousFacts, activeFacts]);

  const commitStrip =
    commitStripOverride ??
    (activeFacts
      ? projectCommitStrip(commitStripInputFromPlanFacts(activeFacts))
      : projectCommitStrip({ hasPlan: false }));

  if (!view || !activeFacts) return null;

  const isMobile = viewport === 'mobile';
  const showInlineFull = !compact && !isMobile;
  const showCompact = compact || isMobile;

  const revisionSwitcher =
    history.length > 1 ? (
      <div
        className="flex flex-wrap items-center gap-1.5"
        data-testid="agent-living-plan-revisions"
      >
        <span className="text-muted text-xs">版本</span>
        {history.map((item) => {
          const selected = item.revision === view.revision;
          return (
            <button
              aria-pressed={selected}
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                selected
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
              data-revision={item.revision}
              data-testid={`agent-living-plan-revision-${item.revision}`}
              key={item.revision}
              onClick={() => setViewedRevision(item.revision)}
              type="button"
            >
              r{item.revision}
            </button>
          );
        })}
      </div>
    ) : (
      <span
        className="text-muted text-xs"
        data-testid="agent-living-plan-revision-single"
      >
        r{view.revision}
      </span>
    );

  const fullDocument = (
    <div
      className="flex flex-col gap-1"
      data-testid="agent-living-plan-document"
    >
      {diff ? <PlanDiff diff={diff} /> : null}
      {view.sections.map((section) => (
        <PlanSection
          body={section.body}
          key={section.key}
          rows={section.rows}
          sectionKey={section.key}
          title={section.title}
        />
      ))}
      <CommitStrip busy={busy} onAction={onCommitAction} view={commitStrip} />
    </div>
  );

  return (
    <article
      className={cn(
        'meiye-living-plan border-border/70 bg-background flex flex-col gap-3 rounded-2xl border p-3 sm:p-4',
        className
      )}
      data-plan-id={view.planId}
      data-revision={view.revision}
      data-surface="living_plan"
      data-testid="agent-living-plan"
      data-viewport={viewport}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-semibold">方案</h2>
          <p className="text-muted mt-0.5 text-xs leading-relaxed">
            同一条过程里逐步成形 · 调整会产生新版本
          </p>
        </div>
        {revisionSwitcher}
      </header>

      {showCompact ? (
        <CompactPlan
          busy={busy}
          commitStrip={commitStrip}
          onCommitAction={onCommitAction}
          onExpand={
            isMobile
              ? () => setMobileSheetOpen(true)
              : compact
                ? () => {
                    /* host can flip compact via remount; keep expand local for sheet */
                    setMobileSheetOpen(true);
                  }
                : undefined
          }
          view={view}
        />
      ) : null}

      {showInlineFull ? fullDocument : null}

      {isMobile || compact ? (
        <Drawer onOpenChange={setMobileSheetOpen} open={mobileSheetOpen}>
          <DrawerContent
            className="max-h-[90vh]"
            data-testid="agent-living-plan-bottom-sheet"
          >
            <DrawerHeader className="text-left">
              <DrawerTitle>完整方案 · r{view.revision}</DrawerTitle>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-6">{fullDocument}</div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </article>
  );
}

/**
 * Result Center version timeline panel surface (P1-B1 / #150).
 *
 * Renders ContentPackage revision timeline with derived-from, operator,
 * and restore actions. Projection-driven only.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { RevisionTimelinePanelView } from './result-revision-timeline-model';

export type RevisionTimelinePanelProps = {
  view: RevisionTimelinePanelView;
  onRestoreVersion?: (versionId: string) => void | Promise<void>;
  restoreBusy?: boolean;
};

export function RevisionTimelinePanel(props: RevisionTimelinePanelProps) {
  const { view } = props;

  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      data-testid="result-revision-timeline-panel"
      aria-label={view.heading}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{view.heading}</h2>
        <p className="text-xs text-muted-foreground">{view.summary}</p>
      </div>

      {view.empty ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="result-revision-timeline-empty"
        >
          {view.emptyMessage}
        </p>
      ) : (
        <ol className="space-y-3" data-testid="result-revision-timeline-list">
          {view.entries.map((entry) => (
            <li
              key={entry.versionId}
              className="space-y-2 rounded-md border bg-card p-3"
              data-testid="result-revision-timeline-entry"
              data-current={entry.isCurrent ? 'true' : 'false'}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{entry.title}</span>
                {entry.isCurrent ? (
                  <Badge variant="default">当前版本</Badge>
                ) : null}
                <Badge variant="outline">{entry.sourceLabel}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span data-testid="result-revision-timeline-time">
                  {entry.createdAtLabel}
                </span>
                <span data-testid="result-revision-timeline-operator">
                  操作者：{entry.operatorLabel}
                </span>
                {entry.derivedFromLabel ? (
                  <span data-testid="result-revision-timeline-derived-from">
                    {entry.derivedFromLabel}
                  </span>
                ) : null}
              </div>
              {entry.recoverAction ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="result-revision-timeline-restore"
                  disabled={
                    !entry.recoverAction.enabled || Boolean(props.restoreBusy)
                  }
                  onClick={() =>
                    props.onRestoreVersion?.(
                      entry.recoverAction!.targetVersionId
                    )
                  }
                >
                  {entry.recoverAction.label}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

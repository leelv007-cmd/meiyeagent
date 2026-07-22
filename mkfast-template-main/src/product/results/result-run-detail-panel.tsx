/**
 * Result Center Run Detail panel surface (P1-B1 / #150).
 *
 * Default-collapsed safe diagnostics: stage, fee, failure, recovery.
 * Never renders provider secrets, model slugs, or raw UUIDs.
 */

import { Badge } from '@/components/ui/badge';
import type { ResultRunDetailPanelView } from './result-run-detail-model';

export type ResultRunDetailPanelProps = {
  view: ResultRunDetailPanelView;
  /** Force open for tests or deep-link focus; default follows collapsedByDefault. */
  defaultOpen?: boolean;
};

function stageBadgeVariant(
  state: ResultRunDetailPanelView['stages'][number]['state']
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (state) {
    case 'done':
      return 'default';
    case 'current':
      return 'secondary';
    case 'failed':
      return 'destructive';
    case 'pending':
      return 'outline';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function stageStateLabel(
  state: ResultRunDetailPanelView['stages'][number]['state']
): string {
  switch (state) {
    case 'done':
      return '已完成';
    case 'current':
      return '进行中';
    case 'failed':
      return '失败';
    case 'pending':
      return '未开始';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function ResultRunDetailPanel(props: ResultRunDetailPanelProps) {
  const { view } = props;
  const open = props.defaultOpen ?? !view.collapsedByDefault;

  return (
    <section
      className="rounded-lg border p-4"
      data-testid="result-run-detail-panel"
      aria-label={view.heading}
    >
      <details className="group" open={open} data-testid="result-run-detail">
        <summary className="cursor-pointer list-none text-sm font-medium">
          <span className="inline-flex flex-wrap items-center gap-2">
            {view.heading}
            <Badge variant="outline">{view.stageSummary}</Badge>
          </span>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            默认折叠 · 查看阶段、费用与恢复说明
          </span>
        </summary>

        <div className="mt-4 space-y-4" data-testid="result-run-detail-body">
          <ol className="space-y-2" data-testid="result-run-detail-stages">
            {view.stages.map((stage) => (
              <li
                key={stage.id}
                className="flex flex-wrap items-center gap-2 text-sm"
                data-testid="result-run-detail-stage"
                data-stage={stage.id}
                data-state={stage.state}
                aria-current={stage.state === 'current' ? 'step' : undefined}
              >
                <span>{stage.label}</span>
                <Badge variant={stageBadgeVariant(stage.state)}>
                  {stageStateLabel(stage.state)}
                </Badge>
              </li>
            ))}
          </ol>

          <div className="space-y-1 text-sm">
            <p data-testid="result-run-detail-cost">{view.costSummary}</p>
            {view.modelSummary ? (
              <p
                className="text-muted-foreground"
                data-testid="result-run-detail-model"
              >
                {view.modelSummary}
              </p>
            ) : null}
            {view.failureSummary ? (
              <p
                className="text-destructive"
                data-testid="result-run-detail-failure"
              >
                {view.failureSummary}
              </p>
            ) : null}
            {view.recoveryHint ? (
              <p
                className="text-muted-foreground"
                data-testid="result-run-detail-recovery"
              >
                {view.recoveryHint}
              </p>
            ) : null}
            <p
              className="text-xs text-muted-foreground"
              data-testid="result-run-detail-support"
            >
              {view.supportHint}
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

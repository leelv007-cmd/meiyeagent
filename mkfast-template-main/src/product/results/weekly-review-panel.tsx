/**
 * Weekly review + next-round recommendation panel (P1-E2 / #159).
 *
 * Confirm yields snapshot intent via callback — never creates tasks or charges.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import {
  WEEKLY_NEXT_ACTION_LABEL,
  type WeeklyNextAction,
  type WeeklyReviewPanelView,
} from './weekly-review-model';

export type WeeklyReviewPanelProps = {
  view: WeeklyReviewPanelView;
  pending?: boolean;
  onConfirmRecommendation?: (input: {
    packageId: string;
    action: WeeklyNextAction;
  }) => void | Promise<void>;
};

export function WeeklyReviewPanel(props: WeeklyReviewPanelProps) {
  const { view } = props;

  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      data-testid="weekly-review-panel"
      data-panel-kind={view.kind}
      aria-label={view.heading}
    >
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{view.heading}</h3>
        {view.kind === 'ready' ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="weekly-review-week-label"
          >
            {view.weekLabel}
          </p>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="weekly-review-fail-closed"
            data-reason={view.reason}
          >
            {view.message}
          </p>
        )}
        <p
          className="sr-only"
          data-testid="weekly-review-no-roi"
          data-has-auto-roi={view.hasAutoRoi ? 'true' : 'false'}
          data-has-causal={view.hasCausalLanguage ? 'true' : 'false'}
        >
          周复盘不生成自动 ROI，不使用因果措辞
        </p>
      </header>

      {view.kind === 'ready' ? (
        <>
          <div className="space-y-2" data-testid="weekly-review-published">
            <p className="text-sm font-medium">本周发了什么</p>
            {view.published.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-1">
                {view.published.map((item) => (
                  <li
                    key={`${item.packageId}-${item.publishedAtLabel}`}
                    className="text-sm"
                  >
                    {item.packageTitle} · {item.platform} ·{' '}
                    {item.publishedAtLabel} · {item.sourceTierLabel} ·{' '}
                    {item.revisionLabel} · CTA {item.ctaLabel}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2" data-testid="weekly-review-observed">
            <p className="text-sm font-medium">观察到什么</p>
            {view.observed.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-1">
                {view.observed.map((item) => (
                  <li
                    key={`${item.packageId}-${item.kindLabel}-${item.occurredAtLabel}`}
                    className="text-sm"
                  >
                    {item.packageTitle} · {item.kindLabel} ·{' '}
                    {item.sourceTierLabel} · {item.occurredAtLabel}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      {view.unknowns.length > 0 ? (
        <div className="space-y-1" data-testid="weekly-review-unknowns">
          <p className="text-sm font-medium">未知项</p>
          <ul className="space-y-1">
            {view.unknowns.map((item) => (
              <li key={item} className="text-xs text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.recommendations.length > 0 ? (
        <div className="space-y-3" data-testid="weekly-review-recommendations">
          <p className="text-sm font-medium">下一轮验证什么</p>
          {view.recommendations.map((rec) => (
            <div
              key={rec.packageId}
              className="space-y-2 rounded-md border p-3"
              data-testid="weekly-review-recommendation"
              data-mode={rec.mode}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{rec.packageTitle}</span>
                <Badge variant="outline">
                  {rec.mode === 'exploratory' ? '探索性建议' : '有证据建议'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{rec.rationale}</p>
              <p className="text-xs text-muted-foreground">{rec.uncertainty}</p>
              <ul className="space-y-1">
                {rec.evidenceRefs.map((ref) => (
                  <li
                    key={ref.id}
                    className="text-xs text-muted-foreground"
                    data-testid="weekly-review-evidence"
                    data-evidence-kind={ref.kind}
                  >
                    {ref.label}
                    {ref.sourceTierLabel ? ` · ${ref.sourceTierLabel}` : null}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {rec.actions.map((action) => (
                  <Button
                    key={action}
                    type="button"
                    size="sm"
                    variant={
                      action === 'stop_series'
                        ? 'ghost'
                        : action === 'continue_series'
                          ? 'default'
                          : 'outline'
                    }
                    disabled={props.pending}
                    data-testid={`weekly-review-action-${action}`}
                    onClick={() => {
                      void props.onConfirmRecommendation?.({
                        packageId: rec.packageId,
                        action,
                      });
                    }}
                  >
                    {WEEKLY_NEXT_ACTION_LABEL[action]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                确认后才会进入新的创作草稿；建议本身不创建任务、不扣费。
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

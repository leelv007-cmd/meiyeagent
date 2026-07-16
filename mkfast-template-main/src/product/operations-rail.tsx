import { ProductStatus } from '@/components/uiux/product-status';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getPathWithLocale } from '@/lib/urls';
import {
  operations_rail_anomaly_summary,
  operations_rail_aria,
  operations_rail_empty,
  operations_rail_next_action,
  operations_rail_next_eyebrow,
  operations_rail_no_anomalies,
  operations_rail_open_context,
  operations_rail_open_inbox,
  operations_rail_open_task,
  operations_rail_single_item,
  operations_rail_week_label,
  p1_week_strip_empty,
} from '@/locale/paraglide/messages';
import { CompactWeekStrip, hasWeekData } from '@/p1/compact-week-strip';
import { nextActionTask } from '@/p1/operations-route-model';
import {
  taskView,
  weekPointView,
  type RawInbox,
} from '@/p1/operations-view-model';
import { IconArrowRight, IconAlertTriangle } from '@tabler/icons-react';

export function OperationsRail({ inbox }: { inbox: RawInbox }) {
  const next = nextActionTask(inbox.tasks);
  const anomalies = inbox.tasks.filter(
    (task) =>
      task.risk !== 'normal' ||
      task.status === 'blocked' ||
      task.status === 'needs_asset'
  );
  const nextView = next ? taskView(next) : undefined;
  const weekPoints = inbox.weekStrip.map(weekPointView);

  if (!nextView && anomalies.length === 0 && !hasWeekData(weekPoints)) {
    return (
      <aside
        aria-label={operations_rail_aria()}
        className="xl:sticky xl:top-4 xl:self-start"
      >
        <p className="rounded-xl bg-surface-1 px-4 py-3 text-sm text-muted-foreground">
          {p1_week_strip_empty()}
        </p>
      </aside>
    );
  }

  return (
    <aside
      aria-label={operations_rail_aria()}
      className="space-y-4 xl:sticky xl:top-4 xl:self-start"
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p
                aria-hidden="true"
                className="text-[10px] font-semibold tracking-[0.18em] text-[var(--product-guide)]"
                data-testid="next-action-guide"
              >
                {operations_rail_next_eyebrow()}
              </p>
              <h2 className="meiye-type-body font-semibold">
                {operations_rail_next_action()}
              </h2>
            </div>
            <Badge variant="outline">{operations_rail_single_item()}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {nextView ? (
            <>
              <ProductStatus status={nextView.status} />
              <p className="meiye-type-body font-medium">{nextView.title}</p>
              <p className="meiye-type-aux">
                {nextView.nextStep ??
                  nextView.summary ??
                  operations_rail_open_context()}
              </p>
              <a
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
                href={getPathWithLocale(`/dashboard/tasks/${nextView.id}`)}
              >
                {operations_rail_open_task()}
                <IconArrowRight aria-hidden="true" />
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {operations_rail_empty()}
            </p>
          )}
        </CardContent>
      </Card>

      <CompactWeekStrip
        className="rounded-xl bg-surface-1 p-4"
        label={operations_rail_week_label()}
        points={weekPoints}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="meiye-type-body flex items-center gap-2 font-semibold">
              <IconAlertTriangle className="size-4" aria-hidden="true" />
              {operations_rail_anomaly_summary()}
            </h2>
            <Badge variant={anomalies.length > 0 ? 'destructive' : 'outline'}>
              {anomalies.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {anomalies.length > 0 ? (
            <ul className="space-y-2">
              {anomalies.slice(0, 3).map((task) => {
                const view = taskView(task);
                return (
                  <li
                    key={task.id}
                    className="border-l-2 border-destructive pl-3"
                  >
                    <p className="line-clamp-2 font-medium">{view.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {view.blockedReason ?? view.nextStep ?? view.status}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              {operations_rail_no_anomalies()}
            </p>
          )}
          <a
            className={buttonVariants({ size: 'sm', variant: 'link' })}
            href={getPathWithLocale('/dashboard/tasks')}
          >
            {operations_rail_open_inbox()}
          </a>
        </CardContent>
      </Card>
    </aside>
  );
}

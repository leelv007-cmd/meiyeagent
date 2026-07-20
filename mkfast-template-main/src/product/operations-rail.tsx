import { ProductStatus } from '@/components/uiux/product-status';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { getPathWithLocale } from '@/lib/urls';
import {
  operations_rail_anomaly_summary,
  operations_rail_aria,
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
  const weekHasData = hasWeekData(weekPoints);

  if (!nextView && anomalies.length === 0 && !weekHasData) {
    return (
      <aside
        aria-label={operations_rail_aria()}
        className="xl:sticky xl:top-4 xl:self-start"
      >
        <p className="rounded-2xl bg-surface-1 px-4 py-3 text-sm text-muted-foreground">
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
      {nextView ? (
        <section className="space-y-3 rounded-2xl bg-surface-1 p-4">
          <p
            className="text-sm text-muted-foreground"
            data-testid="next-action-guide"
          >
            {operations_rail_single_item()}
          </p>
          <div className="space-y-2">
            <ProductStatus status={nextView.status} />
            <p className="meiye-type-body font-medium">{nextView.title}</p>
            <p className="meiye-type-aux">
              {nextView.nextStep ??
                nextView.summary ??
                operations_rail_open_context()}
            </p>
          </div>
          <a
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
            href={getPathWithLocale(`/dashboard/tasks/${nextView.id}`)}
          >
            {operations_rail_open_task()}
            <IconArrowRight aria-hidden="true" />
          </a>
        </section>
      ) : null}

      <CompactWeekStrip
        className="rounded-2xl bg-surface-1 p-4"
        label={operations_rail_week_label()}
        points={weekPoints}
      />

      {anomalies.length > 0 ? (
        <section className="space-y-3 rounded-2xl bg-surface-1 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="meiye-type-body flex items-center gap-2 font-medium">
              <IconAlertTriangle className="size-4" aria-hidden="true" />
              {operations_rail_anomaly_summary()}
            </h2>
            <Badge variant="destructive">{anomalies.length}</Badge>
          </div>
          <ul className="space-y-2 text-sm">
            {anomalies.slice(0, 3).map((task) => {
              const view = taskView(task);
              return (
                <li key={task.id} className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="line-clamp-2 font-medium">{view.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {view.blockedReason ?? view.nextStep ?? view.status}
                  </p>
                </li>
              );
            })}
          </ul>
          <a
            className={buttonVariants({ size: 'sm', variant: 'link' })}
            href={getPathWithLocale('/dashboard/tasks')}
          >
            {operations_rail_open_inbox()}
          </a>
        </section>
      ) : null}
    </aside>
  );
}

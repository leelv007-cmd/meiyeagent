/**
 * Task drilldown detail (J4 / D-070).
 * Summary cards · latency segments · durable timeline · foldable error · artifact.
 */
import {
  admin_supply_task_timeline_ended,
  admin_supply_task_timeline_running,
} from '@/locale/paraglide/messages';
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@/components/reui/timeline';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type {
  TaskDrilldownView,
  TimelineEventView,
} from '@/p1/admin-supply-task-drilldown-model';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';

const RUN_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  succeeded: 'success-light',
  accepted: 'success-light',
  failed: 'destructive-light',
  rejected_before_accept: 'destructive-light',
  running: 'info-light',
  queued: 'info-light',
  draining: 'warning-light',
  acceptance_unknown: 'warning-light',
};

function runStatusVariant(status: string): BadgeProps['variant'] {
  return RUN_STATUS_VARIANT[status] ?? 'outline';
}

/**
 * The execution timeline is a projection of durable timestamps, so "where the
 * run got to" is read off the events themselves rather than tracked: every
 * event but the last describes something that already finished, and the last
 * one is still in flight exactly when the run has no terminal timestamp. That
 * is what decides Spinner vs Check — an unfinished run must not show a row of
 * ticks, which would read as "all done".
 */
type TimelineStepStatus = 'completed' | 'active' | 'failed';

function stepStatus(
  event: TimelineEventView,
  index: number,
  events: readonly TimelineEventView[],
  runEnded: boolean
): TimelineStepStatus {
  if (event.phase === 'error') return 'failed';
  const isLast = index === events.length - 1;
  if (isLast && !runEnded) return 'active';
  return 'completed';
}

function StepIcon({ status }: { status: TimelineStepStatus }) {
  if (status === 'failed') return <IconAlertTriangle className="size-3" />;
  if (status === 'active') return <Spinner className="size-3" />;
  return <IconCheck className="size-3" />;
}

function SummaryCard({
  children,
  label,
  ...props
}: React.ComponentProps<'div'> & { label: string }) {
  return (
    <Frame dense className="h-full min-w-0" {...props}>
      <FrameHeader>
        <FrameTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </FrameTitle>
      </FrameHeader>
      <FramePanel className="flex flex-1 flex-col gap-2 text-xs">
        {children}
      </FramePanel>
    </Frame>
  );
}

export function SupplyTaskDrilldown({ view }: { view: TaskDrilldownView }) {
  // Terminal is what the projection itself recorded, not what the status word
  // suggests: `acceptance_unknown` has no end timestamp and must stay in flight.
  const runEnded = Boolean(view.run.endedAt);
  const events = view.timeline;
  const completedSteps = runEnded ? events.length : events.length - 1;

  return (
    <section
      data-testid="supply-task-drilldown"
      data-task-id={view.taskId}
      className="space-y-4"
    >
      <div
        data-testid="supply-task-summary-cards"
        className="grid auto-rows-fr items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <SummaryCard label="状态">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              data-testid="supply-task-status"
              variant={runStatusVariant(view.summary.status)}
            >
              {view.summary.status}
            </Badge>
          </div>
          <Separator />
          <div className="text-muted-foreground">{view.summary.lifecycle}</div>
        </SummaryCard>
        <SummaryCard label="操作 / 模型">
          <div className="text-base font-medium tracking-tight text-foreground">
            {view.summary.operation}
          </div>
          <Separator />
          <div className="space-y-0.5">
            <div className="font-mono">{view.summary.catalogModelId}</div>
            <div className="text-muted-foreground">
              {view.summary.channelKind} · attempt {view.summary.attemptCount}
            </div>
          </div>
        </SummaryCard>
        <SummaryCard label="部署 / 数据等级">
          <div className="font-mono text-sm text-foreground">
            {view.summary.deploymentId}
          </div>
          <Separator />
          <div className="font-mono text-muted-foreground">
            {view.summary.dataClass}
          </div>
        </SummaryCard>
        <SummaryCard label="成本">
          <div
            className="text-base font-medium tracking-tight text-foreground tabular-nums"
            data-testid="supply-task-cost"
          >
            {view.summary.costLabel}
          </div>
        </SummaryCard>
      </div>

      <section data-testid="supply-task-latency" className="space-y-2">
        <h3 className="text-sm font-semibold">延迟分段</h3>
        <Frame dense className="grid grid-cols-2 gap-px sm:grid-cols-4">
          {view.latencySegments.map((seg) => (
            <FramePanel
              key={seg.key}
              data-testid="supply-latency-segment"
              data-segment={seg.key}
              className="text-center text-xs"
            >
              <div className="text-muted-foreground">{seg.label}</div>
              <div className="text-base font-semibold tabular-nums">
                {seg.ms != null ? `${seg.ms}ms` : '—'}
              </div>
            </FramePanel>
          ))}
        </Frame>
      </section>

      <Frame dense data-testid="supply-task-timeline">
        <FrameHeader>
          <FrameTitle>持久化时间戳时间线</FrameTitle>
          <FrameDescription className="text-xs">
            {runEnded
              ? admin_supply_task_timeline_ended({ count: events.length })
              : admin_supply_task_timeline_running({ count: events.length })}
          </FrameDescription>
        </FrameHeader>
        <FramePanel>
          <Timeline defaultValue={completedSteps}>
            {events.map((event, index) => {
              const status = stepStatus(event, index, events, runEnded);
              return (
                <TimelineItem
                  key={event.id}
                  step={index + 1}
                  data-testid="supply-timeline-event"
                  data-phase={event.phase}
                  data-durable="true"
                  className="ms-8 pb-6"
                >
                  <TimelineHeader className="items-center">
                    <TimelineSeparator className="bg-border group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.25rem-0.5rem)] group-data-[orientation=vertical]/timeline:translate-y-6" />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <TimelineTitle className="text-sm leading-5 font-semibold">
                        {event.phase}
                      </TimelineTitle>
                      <time className="font-mono text-xs text-muted-foreground">
                        {event.at}
                      </time>
                    </div>
                    <TimelineIndicator
                      className={cn(
                        'flex size-5 items-center justify-center border-none bg-muted text-muted-foreground group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground group-data-[orientation=vertical]/timeline:-left-6',
                        status === 'active' && 'ring-2 ring-primary/20',
                        status === 'failed' &&
                          'bg-destructive text-white group-data-completed/timeline-item:bg-destructive group-data-completed/timeline-item:text-white'
                      )}
                    >
                      <StepIcon status={status} />
                    </TimelineIndicator>
                  </TimelineHeader>
                  <TimelineContent className="mt-1 text-xs">
                    {event.summary}
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </Timeline>
        </FramePanel>
      </Frame>

      {view.error ? (
        <Frame dense>
          <FramePanel className="p-0!">
            <details
              data-testid="supply-task-error"
              data-error-code={view.error.code}
              data-folded-default="true"
              className="px-(--frame-panel-px) py-(--frame-panel-py) text-xs"
            >
              <summary className="flex cursor-pointer items-center gap-2 font-medium">
                <Badge variant="destructive-light">错误徽章</Badge>
                <span className="font-mono">{view.error.code}</span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">
                {view.error.message}
              </pre>
            </details>
          </FramePanel>
        </Frame>
      ) : null}

      {view.artifact ? (
        <Frame dense data-testid="supply-task-artifact">
          <FrameHeader>
            <FrameTitle>产物预览</FrameTitle>
          </FrameHeader>
          <FramePanel
            data-artifact-kind={view.artifact.kind}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <span className="font-mono">{view.artifact.url}</span>
            <Badge variant="outline">{view.artifact.kind}</Badge>
          </FramePanel>
          <FrameFooter className="text-xs text-muted-foreground">
            RoutePolicy {view.routePolicyRevisionId ?? '—'} · Pool{' '}
            {view.poolId ?? '—'}
          </FrameFooter>
        </Frame>
      ) : (
        <footer className="text-xs text-muted-foreground">
          RoutePolicy {view.routePolicyRevisionId ?? '—'} · Pool{' '}
          {view.poolId ?? '—'}
        </footer>
      )}
    </section>
  );
}

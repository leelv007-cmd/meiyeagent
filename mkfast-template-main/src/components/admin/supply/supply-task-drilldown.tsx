/**
 * Task drilldown detail (J4 / D-070).
 * Summary cards · latency segments · durable timeline · foldable error · artifact.
 */
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { TaskDrilldownView } from '@/p1/admin-supply-task-drilldown-model';

export function SupplyTaskDrilldown({ view }: { view: TaskDrilldownView }) {
  return (
    <section
      data-testid="supply-task-drilldown"
      data-task-id={view.taskId}
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">任务下钻 · {view.taskId}</h2>
        <p className="text-xs text-muted-foreground">
          摘要卡 / 延迟分段 / 持久化时间戳时间线 / 错误徽章折叠 / 产物预览
        </p>
      </header>

      <div
        data-testid="supply-task-summary-cards"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">状态</CardTitle>
            <CardDescription>{view.summary.lifecycle}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge data-testid="supply-task-status">
              {view.summary.status}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">操作 / 模型</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <div>{view.summary.operation}</div>
            <div className="font-mono">{view.summary.catalogModelId}</div>
            <div className="text-muted-foreground">
              {view.summary.channelKind} · attempt {view.summary.attemptCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">部署 / 数据等级</CardTitle>
          </CardHeader>
          <CardContent className="text-xs font-mono">
            <div>{view.summary.deploymentId}</div>
            <div>{view.summary.dataClass}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">成本</CardTitle>
          </CardHeader>
          <CardContent className="text-xs" data-testid="supply-task-cost">
            {view.summary.costLabel}
          </CardContent>
        </Card>
      </div>

      <section data-testid="supply-task-latency" className="space-y-2">
        <h3 className="text-sm font-semibold">延迟分段</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {view.latencySegments.map((seg) => (
            <div
              key={seg.key}
              data-testid="supply-latency-segment"
              data-segment={seg.key}
              className="rounded-md border p-2 text-center text-xs"
            >
              <div className="text-muted-foreground">{seg.label}</div>
              <div className="text-base font-semibold">
                {seg.ms != null ? `${seg.ms}ms` : '—'}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="supply-task-timeline" className="space-y-2">
        <h3 className="text-sm font-semibold">持久化时间戳时间线</h3>
        <ol className="space-y-2 border-l pl-4">
          {view.timeline.map((event) => (
            <li
              key={event.id}
              data-testid="supply-timeline-event"
              data-phase={event.phase}
              data-durable="true"
              className="text-xs"
            >
              <span className="font-mono text-muted-foreground">
                {event.at}
              </span>
              <br />
              <span className="font-medium">{event.phase}</span> ·{' '}
              {event.summary}
            </li>
          ))}
        </ol>
      </section>

      {view.error ? (
        <details
          data-testid="supply-task-error"
          data-error-code={view.error.code}
          data-folded-default="true"
          className="rounded-md border p-3 text-xs"
        >
          <summary className="cursor-pointer font-medium">
            错误徽章 · {view.error.code}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">
            {view.error.message}
          </pre>
        </details>
      ) : null}

      {view.artifact ? (
        <section data-testid="supply-task-artifact" className="space-y-2">
          <h3 className="text-sm font-semibold">产物预览</h3>
          <div
            data-artifact-kind={view.artifact.kind}
            className="rounded-md border p-3 text-xs"
          >
            <span className="font-mono">{view.artifact.url}</span>
            <span className="ml-2 text-muted-foreground">
              ({view.artifact.kind})
            </span>
          </div>
        </section>
      ) : null}

      <footer className="text-xs text-muted-foreground">
        RoutePolicy {view.routePolicyRevisionId ?? '—'} · Pool{' '}
        {view.poolId ?? '—'}
      </footer>
    </section>
  );
}

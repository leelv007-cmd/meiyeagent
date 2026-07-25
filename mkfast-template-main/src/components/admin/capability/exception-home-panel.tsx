import { AvailabilityStatusBadge } from '@/components/admin/capability/capability-status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import type { CapabilityAvailabilityStatus } from '@meiye/contracts';
import {
  exceptionFreshnessLabel,
  exceptionSeverityLabel,
  type ExceptionHomeRow,
  type ExceptionHomeView,
  type ExceptionSeverity,
} from '@/p1/admin-exception-home-model';

function severityAsAvailability(
  severity: ExceptionSeverity
): CapabilityAvailabilityStatus {
  return severity;
}

function ExceptionRowCard({ row }: { row: ExceptionHomeRow }) {
  return (
    <li
      className="rounded-lg border p-4"
      data-testid="exception-row"
      data-root-cause-key={row.rootCauseKey}
      data-severity={row.severity}
      data-freshness={row.freshness}
      data-origin={row.origin}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{row.title}</h3>
            <AvailabilityStatusBadge
              status={severityAsAvailability(row.severity)}
            />
            <AdminStatusChip
              variant="outline"
              data-testid="exception-severity-label"
              data-severity={row.severity}
            >
              {exceptionSeverityLabel(row.severity)}
            </AdminStatusChip>
            <AdminStatusChip
              variant="outline"
              data-testid="exception-freshness"
              data-freshness={row.freshness}
            >
              新鲜度 · {exceptionFreshnessLabel(row.freshness)}
            </AdminStatusChip>
          </div>
          <p className="text-xs text-muted-foreground">
            根因键{' '}
            <span className="font-mono" data-testid="exception-root-cause-key">
              {row.rootCauseKey}
            </span>
          </p>
        </div>
        {row.nextActionLabel ? (
          <AdminStatusChip
            variant="secondary"
            data-testid="exception-next-action"
          >
            下一步 · {row.nextActionLabel}
          </AdminStatusChip>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">证据来源</dt>
          <dd className="font-mono" data-testid="exception-evidence-source">
            {row.evidenceSource}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">证据捕获</dt>
          <dd data-testid="exception-evidence-captured-at">
            {row.evidenceCapturedAt}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">开始 / 最近变化</dt>
          <dd data-testid="exception-timeline">
            {row.startedAt} → {row.lastChangedAt}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">最近相关变更</dt>
          <dd data-testid="exception-recent-change">
            {row.recentChangeSummary}
          </dd>
        </div>
      </dl>

      {row.affectedCapabilityIds.length > 0 ? (
        <div className="mt-3" data-testid="exception-affected-capabilities">
          <p className="text-xs text-muted-foreground">受影响能力</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {row.affectedCapabilityIds.map((id) => (
              <li key={id}>
                <AdminStatusChip
                  variant="outline"
                  className="font-mono text-[10px]"
                  data-testid="exception-affected-capability"
                  data-capability-id={id}
                >
                  {id}
                </AdminStatusChip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.affectedScope.length > 0 ? (
        <div className="mt-2" data-testid="exception-affected-scope">
          <p className="text-xs text-muted-foreground">影响范围</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {row.affectedScope.join(' · ')}
          </p>
        </div>
      ) : null}

      <div
        className="mt-4 rounded-md border border-dashed bg-muted/30 p-3"
        data-testid="exception-technical-handoff"
        data-one-click-repair="false"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">{row.technicalHandoff.label}</p>
          <a
            href={row.technicalHandoff.href}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            data-testid="exception-handoff-link"
            data-handoff-href={row.technicalHandoff.href}
          >
            打开下钻 / 移交上下文
          </a>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          复杂修复需技术台接手；不在运营界面伪装一键修复。
        </p>
        <ul
          className="mt-2 space-y-0.5 font-mono text-[10px] text-muted-foreground"
          data-testid="exception-handoff-redacted-context"
        >
          {Object.entries(row.technicalHandoff.redactedContext).map(
            ([key, value]) => (
              <li key={key} data-handoff-key={key}>
                {key}={value}
              </li>
            )
          )}
        </ul>
      </div>
    </li>
  );
}

function EmptyExceptionState({ view }: { view: ExceptionHomeView }) {
  return (
    <div
      className="space-y-6"
      data-testid="exception-empty-state"
      data-empty="true"
    >
      <Alert data-testid="exception-empty-banner">
        <AlertTitle data-testid="exception-empty-title">
          当前无待处理异常
        </AlertTitle>
        <AlertDescription>
          系统未投影出 blocked / degraded / attention / not_verified / 长时间
          stale 事件。下方为能力全景摘要与目录入口（非装饰性红绿大屏）。
        </AlertDescription>
      </Alert>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="exception-panorama-stats"
      >
        {view.panoramaStats.map((stat) => (
          <AdminPanel
            key={stat.id}
            data-testid="exception-stat-card"
            data-stat-id={stat.id}
          >
            <AdminPanelHeader className="pb-2">
              <AdminPanelDescription>{stat.label}</AdminPanelDescription>
              <AdminPanelTitle
                className="text-2xl tabular-nums"
                data-testid="exception-stat-value"
              >
                {stat.value}
              </AdminPanelTitle>
            </AdminPanelHeader>
            <AdminPanelContent>
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </AdminPanelContent>
          </AdminPanel>
        ))}
      </section>

      <AdminPanel data-testid="exception-catalog-entry">
        <AdminPanelHeader>
          <AdminPanelTitle className="text-base">
            {view.catalogEntry.label}
          </AdminPanelTitle>
          <AdminPanelDescription>
            {view.catalogEntry.description}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent>
          <a
            href={view.catalogEntry.path}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            data-testid="exception-catalog-link"
          >
            前往能力目录
          </a>
        </AdminPanelContent>
      </AdminPanel>
    </div>
  );
}

/**
 * Read-only exception-first home panel (J2 / D-055).
 * No ack / assign / owner workflow controls (D-080 C1).
 */
export function ExceptionHomePanel({ view }: { view: ExceptionHomeView }) {
  return (
    <div
      className="space-y-6"
      data-testid="exception-home-panel"
      data-read-only="true"
      data-supports-ack="false"
      data-supports-assign="false"
      data-supports-owner-workflow="false"
      data-empty={view.empty ? 'true' : 'false'}
      data-exception-count={view.exceptions.length}
    >
      <Alert>
        <AlertTitle>异常优先首页（只读）</AlertTitle>
        <AlertDescription>
          聚合 blocked / degraded / attention / not_verified / 长时间
          stale；按严重度 × 范围 × 持续时间 × 最近变化排序；同源根因去重为主事件
          + 受影响能力。无确认 / 指派 / 负责人工作流；复杂修复走脱敏技术移交。
        </AlertDescription>
      </Alert>

      <p
        className="text-sm text-muted-foreground"
        data-testid="exception-projected-at"
      >
        投影于 {view.projectedAt} ·{' '}
        {view.empty ? '无待处理异常' : `${view.exceptions.length} 条主事件`}
      </p>

      {view.empty ? (
        <EmptyExceptionState view={view} />
      ) : (
        <div className="space-y-4">
          <ul className="space-y-3" data-testid="exception-list">
            {view.exceptions.map((row) => (
              <ExceptionRowCard key={row.rootCauseKey} row={row} />
            ))}
          </ul>

          <AdminPanel data-testid="exception-catalog-entry">
            <AdminPanelHeader>
              <AdminPanelTitle className="text-base">
                {view.catalogEntry.label}
              </AdminPanelTitle>
              <AdminPanelDescription>
                {view.catalogEntry.description}
              </AdminPanelDescription>
            </AdminPanelHeader>
            <AdminPanelContent>
              <a
                href={view.catalogEntry.path}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                data-testid="exception-catalog-link"
              >
                前往能力目录
              </a>
            </AdminPanelContent>
          </AdminPanel>
        </div>
      )}
    </div>
  );
}

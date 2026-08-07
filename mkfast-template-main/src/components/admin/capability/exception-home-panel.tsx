import {
  admin_capability_affected_capabilities_a8f39e94,
  admin_capability_aggregates_blocked_degraded_attention_no_513b7d7c,
  admin_capability_complex_fixes_need_the_technical_desk_do_1bb076df,
  admin_capability_evidence_captured_75d90d23,
  admin_capability_evidence_source_a70e1029,
  admin_capability_exception_first_home_read_only_01d1fd0a,
  admin_capability_freshness_8c142505,
  admin_capability_go_to_capability_catalog_eb042018,
  admin_capability_impact_scope_aaabff1b,
  admin_capability_next_step_d51b4bdc,
  admin_capability_no_blocked_degraded_attention_not_verifi_4e95aa66,
  admin_capability_no_pending_exceptions_65eecc3c,
  admin_capability_no_pending_exceptions_75462798,
  admin_capability_open_drill_down_handoff_context_e9afa198,
  admin_capability_primary_events_6e0b2ae8,
  admin_capability_projected_at_2cf51c9c,
  admin_capability_recent_related_changes_01451876,
  admin_capability_root_cause_key_3422616b,
  admin_capability_started_last_changed_76a00a58,
  admin_exception_filter_empty,
  admin_exception_list_title,
  admin_exception_only_blocking,
} from '@/locale/paraglide/messages';
import { AvailabilityStatusBadge } from '@/components/admin/capability/capability-status-badge';
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { CapabilityAvailabilityStatus } from '@meiye/contracts';
import {
  BLOCKING_EXCEPTION_SEVERITIES,
  exceptionFreshnessLabel,
  exceptionSeverityLabel,
  filterExceptionRowsBySeverity,
  isBlockingOnlyExceptionFilter,
  type ExceptionHomeRow,
  type ExceptionHomeView,
  type ExceptionSeverity,
} from '@/p1/admin-exception-home-model';
import { IconFilter } from '@tabler/icons-react';
import { useState } from 'react';

function severityAsAvailability(
  severity: ExceptionSeverity
): CapabilityAvailabilityStatus {
  return severity;
}

/** 严重度的语义色：越靠前越挡路，`stale` 只是旧了，不是坏了。 */
const SEVERITY_VARIANT: Record<ExceptionSeverity, BadgeProps['variant']> = {
  attention: 'warning-outline',
  blocked: 'destructive-light',
  degraded: 'warning-light',
  not_verified: 'outline',
  stale: 'secondary',
};

function ExceptionRowCard({ row }: { row: ExceptionHomeRow }) {
  return (
    <li
      data-testid="exception-row"
      data-root-cause-key={row.rootCauseKey}
      data-severity={row.severity}
      data-freshness={row.freshness}
      data-origin={row.origin}
    >
      {/* 行标题在页面上是三级：Frame 的标题层级跟着降一级，读屏的目录才对。 */}
      <Frame dense spacing="sm" headingLevel={3} className="min-w-0">
        <FrameHeader className="gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <FrameTitle>{row.title}</FrameTitle>
              <AvailabilityStatusBadge
                status={severityAsAvailability(row.severity)}
              />
              <Badge
                variant={SEVERITY_VARIANT[row.severity]}
                data-testid="exception-severity-label"
                data-severity={row.severity}
              >
                {exceptionSeverityLabel(row.severity)}
              </Badge>
              <Badge
                variant="outline"
                data-testid="exception-freshness"
                data-freshness={row.freshness}
              >
                {admin_capability_freshness_8c142505()}{' '}
                {exceptionFreshnessLabel(row.freshness)}
              </Badge>
            </div>
            {row.nextActionLabel ? (
              <Badge variant="secondary" data-testid="exception-next-action">
                {admin_capability_next_step_d51b4bdc()} {row.nextActionLabel}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {admin_capability_root_cause_key_3422616b()}{' '}
            <span className="font-mono" data-testid="exception-root-cause-key">
              {row.rootCauseKey}
            </span>
          </p>
        </FrameHeader>

        <FramePanel>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">
                {admin_capability_evidence_source_a70e1029()}
              </dt>
              <dd className="font-mono" data-testid="exception-evidence-source">
                {row.evidenceSource}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {admin_capability_evidence_captured_75d90d23()}
              </dt>
              <dd data-testid="exception-evidence-captured-at">
                {row.evidenceCapturedAt}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {admin_capability_started_last_changed_76a00a58()}
              </dt>
              <dd data-testid="exception-timeline">
                {row.startedAt} → {row.lastChangedAt}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {admin_capability_recent_related_changes_01451876()}
              </dt>
              <dd data-testid="exception-recent-change">
                {row.recentChangeSummary}
              </dd>
            </div>
          </dl>

          {row.affectedCapabilityIds.length > 0 ? (
            <div className="mt-3" data-testid="exception-affected-capabilities">
              <p className="text-xs text-muted-foreground">
                {admin_capability_affected_capabilities_a8f39e94()}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {row.affectedCapabilityIds.map((id) => (
                  <li key={id}>
                    <Badge
                      variant="outline"
                      size="sm"
                      className="font-mono"
                      data-testid="exception-affected-capability"
                      data-capability-id={id}
                    >
                      {id}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {row.affectedScope.length > 0 ? (
            <div className="mt-2" data-testid="exception-affected-scope">
              <p className="text-xs text-muted-foreground">
                {admin_capability_impact_scope_aaabff1b()}
              </p>
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
              <p className="text-xs font-medium">
                {row.technicalHandoff.label}
              </p>
              <a
                href={row.technicalHandoff.href}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                data-testid="exception-handoff-link"
                data-handoff-href={row.technicalHandoff.href}
              >
                {admin_capability_open_drill_down_handoff_context_e9afa198()}
              </a>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {admin_capability_complex_fixes_need_the_technical_desk_do_1bb076df()}
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
        </FramePanel>
      </Frame>
    </li>
  );
}

/** 目录入口在空态与清单态各出现一次，形态完全一样。 */
function CatalogEntryFrame({ view }: { view: ExceptionHomeView }) {
  return (
    <Frame dense className="min-w-0" data-testid="exception-catalog-entry">
      <FrameHeader>
        <FrameTitle className="text-base">{view.catalogEntry.label}</FrameTitle>
        <FrameDescription>{view.catalogEntry.description}</FrameDescription>
      </FrameHeader>
      <FramePanel>
        <a
          href={view.catalogEntry.path}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          data-testid="exception-catalog-link"
        >
          {admin_capability_go_to_capability_catalog_eb042018()}
        </a>
      </FramePanel>
    </Frame>
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
          {admin_capability_no_pending_exceptions_75462798()}
        </AlertTitle>
        <AlertDescription>
          {admin_capability_no_blocked_degraded_attention_not_verifi_4e95aa66()}
        </AlertDescription>
      </Alert>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="exception-panorama-stats"
      >
        {view.panoramaStats.map((stat) => (
          <Frame
            key={stat.id}
            dense
            className="h-full min-w-0"
            data-testid="exception-stat-card"
            data-stat-id={stat.id}
          >
            <FrameHeader>
              <FrameTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </FrameTitle>
            </FrameHeader>
            <FramePanel className="flex flex-1 flex-col gap-2.5">
              <span
                className="text-2xl font-medium tracking-tight tabular-nums"
                data-testid="exception-stat-value"
              >
                {stat.value}
              </span>
              <Separator />
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </FramePanel>
          </Frame>
        ))}
      </section>

      <CatalogEntryFrame view={view} />
    </div>
  );
}

/**
 * Read-only exception-first home panel (J2 / D-055).
 * No ack / assign / owner workflow controls (D-080 C1).
 *
 * Severity filter is client-side projection only (#385). When
 * `onSeverityFilterChange` is provided the parent owns URL sync (replace
 * navigation); otherwise the toolbar falls back to local state for SSR tests.
 */
export function ExceptionHomePanel({
  view,
  severityFilter,
  onSeverityFilterChange,
}: {
  view: ExceptionHomeView;
  /** Active severity tokens; empty / omitted = show all. */
  severityFilter?: readonly ExceptionSeverity[];
  /** Parent wires replace navigation for shareable ?exceptions=. */
  onSeverityFilterChange?: (next: readonly ExceptionSeverity[]) => void;
}) {
  const [localBlocking, setLocalBlocking] = useState(false);
  const controlled = onSeverityFilterChange != null || severityFilter != null;
  const activeSeverities: readonly ExceptionSeverity[] = controlled
    ? (severityFilter ?? [])
    : localBlocking
      ? BLOCKING_EXCEPTION_SEVERITIES
      : [];
  const onlyBlocking = isBlockingOnlyExceptionFilter(activeSeverities);
  const blockingCount = view.exceptions.filter((row) =>
    (BLOCKING_EXCEPTION_SEVERITIES as readonly ExceptionSeverity[]).includes(
      row.severity
    )
  ).length;
  const visibleExceptions = filterExceptionRowsBySeverity(
    view.exceptions,
    activeSeverities
  );
  const filterToken =
    activeSeverities.length === 0 ? 'all' : activeSeverities.join(',');

  function toggleBlockingFilter() {
    if (controlled) {
      onSeverityFilterChange?.(
        onlyBlocking ? [] : [...BLOCKING_EXCEPTION_SEVERITIES]
      );
      return;
    }
    setLocalBlocking((current) => !current);
  }

  return (
    <div
      className="space-y-6"
      data-testid="exception-home-panel"
      data-read-only="true"
      data-supports-ack="false"
      data-supports-assign="false"
      data-supports-owner-workflow="false"
      data-empty={view.empty ? 'true' : 'false'}
      // Full projected count (not the filtered visible subset).
      data-exception-count={view.exceptions.length}
      data-visible-exception-count={visibleExceptions.length}
      data-severity-filter={filterToken}
    >
      <Alert>
        <AlertTitle>
          {admin_capability_exception_first_home_read_only_01d1fd0a()}
        </AlertTitle>
        <AlertDescription>
          {admin_capability_aggregates_blocked_degraded_attention_no_513b7d7c()}
        </AlertDescription>
      </Alert>

      {view.empty ? (
        <>
          <p
            className="text-sm text-muted-foreground"
            data-testid="exception-projected-at"
          >
            {admin_capability_projected_at_2cf51c9c()} {view.projectedAt}{' '}
            {admin_capability_no_pending_exceptions_65eecc3c()}
          </p>
          <EmptyExceptionState view={view} />
        </>
      ) : (
        <div className="space-y-4">
          <Frame dense className="min-w-0">
            <FrameHeader className="flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-px">
                <FrameTitle>{admin_exception_list_title()}</FrameTitle>
                <FrameDescription
                  className="text-xs"
                  data-testid="exception-projected-at"
                >
                  {admin_capability_projected_at_2cf51c9c()} {view.projectedAt}{' '}
                  · {view.exceptions.length}{' '}
                  {admin_capability_primary_events_6e0b2ae8()}
                </FrameDescription>
              </div>
              <Button
                type="button"
                variant={onlyBlocking ? 'secondary' : 'outline'}
                aria-pressed={onlyBlocking}
                data-testid="exception-filter-blocking"
                onClick={toggleBlockingFilter}
              >
                <IconFilter aria-hidden="true" />
                {admin_exception_only_blocking()}
                <Badge variant="info-outline">{blockingCount}</Badge>
              </Button>
            </FrameHeader>
            <FramePanel>
              {visibleExceptions.length === 0 ? (
                // True empty is exception-empty-state; this is filter miss only.
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="exception-filter-empty"
                >
                  {admin_exception_filter_empty()}
                </p>
              ) : (
                <ul className="space-y-3" data-testid="exception-list">
                  {visibleExceptions.map((row) => (
                    <ExceptionRowCard key={row.rootCauseKey} row={row} />
                  ))}
                </ul>
              )}
            </FramePanel>
          </Frame>

          <CatalogEntryFrame view={view} />
        </div>
      )}
    </div>
  );
}

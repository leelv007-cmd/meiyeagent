import {
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
  exceptionFreshnessLabel,
  exceptionSeverityLabel,
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

/** 工具行只筛「真挡路的两档」，其余仍留在清单里。 */
function isBlockingSeverity(severity: ExceptionSeverity): boolean {
  return severity === 'blocked' || severity === 'degraded';
}

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
                新鲜度 · {exceptionFreshnessLabel(row.freshness)}
              </Badge>
            </div>
            {row.nextActionLabel ? (
              <Badge variant="secondary" data-testid="exception-next-action">
                下一步 · {row.nextActionLabel}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            根因键{' '}
            <span className="font-mono" data-testid="exception-root-cause-key">
              {row.rootCauseKey}
            </span>
          </p>
        </FrameHeader>

        <FramePanel>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
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
              <p className="text-xs font-medium">
                {row.technicalHandoff.label}
              </p>
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
          前往能力目录
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
 */
export function ExceptionHomePanel({ view }: { view: ExceptionHomeView }) {
  // 纯前台视图筛选：不进 URL、不发查询，因此也不改任何对外契约。
  const [onlyBlocking, setOnlyBlocking] = useState(false);
  const blockingCount = view.exceptions.filter((row) =>
    isBlockingSeverity(row.severity)
  ).length;
  const visibleExceptions = onlyBlocking
    ? view.exceptions.filter((row) => isBlockingSeverity(row.severity))
    : view.exceptions;

  return (
    <div
      className="space-y-6"
      data-testid="exception-home-panel"
      data-read-only="true"
      data-supports-ack="false"
      data-supports-assign="false"
      data-supports-owner-workflow="false"
      data-empty={view.empty ? 'true' : 'false'}
      // 计数是这一面共有多少条主事件，与工具行筛掉了几条无关。
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

      {view.empty ? (
        <>
          <p
            className="text-sm text-muted-foreground"
            data-testid="exception-projected-at"
          >
            投影于 {view.projectedAt} · 无待处理异常
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
                  投影于 {view.projectedAt} · {view.exceptions.length} 条主事件
                </FrameDescription>
              </div>
              <Button
                type="button"
                variant={onlyBlocking ? 'secondary' : 'outline'}
                aria-pressed={onlyBlocking}
                onClick={() => setOnlyBlocking((current) => !current)}
              >
                <IconFilter aria-hidden="true" />
                {admin_exception_only_blocking()}
                <Badge variant="info-outline">{blockingCount}</Badge>
              </Button>
            </FrameHeader>
            <FramePanel>
              {visibleExceptions.length === 0 ? (
                // 真·无异常是另一种状态（exception-empty-state），这里只是筛没了。
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

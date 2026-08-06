/**
 * Route simulator explanation panel (J5 / G5 / D-065 ④).
 * Renders the shared projection: hard filter / sort / live exclude / max cost /
 * acceptance branch / not-selected reasons / evidence freshness / cost source.
 *
 * Live path (F-J-02) always mounts with idle / error / ready honest states;
 * fixture path supplies a ready demo view.
 */
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  LiveRouteSimulatorState,
  RouteSimulatorPanelView,
} from '@/p1/admin-supply-route-simulator-model';

/**
 * Evidence freshness words come from the projection, so the mapping is on the
 * word rather than on a colour picked at the call site. Deployment bands are
 * not health words — they stay neutral, and anything unmapped (`missing`,
 * `below_sample`, ranking layer ids, `unknown`) falls through to `outline`
 * rather than borrowing a colour it has not earned.
 */
const ROUTE_VARIANT: Record<string, BadgeProps['variant']> = {
  fresh: 'success-light',
  stale: 'warning-light',
  production: 'secondary',
  canary: 'secondary',
  unknown: 'outline',
};

function routeVariant(word: string): BadgeProps['variant'] {
  return ROUTE_VARIANT[word] ?? 'outline';
}

function ReadyRouteSimulatorBody({ view }: { view: RouteSimulatorPanelView }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Frame dense data-testid="supply-route-hard-filter">
          <FramePanel>
            <p className="text-xs text-muted-foreground">硬过滤通过</p>
            <p className="mt-1 font-medium">
              {view.hardFilterPassed.length} 个 Deployment
            </p>
            <p className="text-xs text-muted-foreground">
              排除 {view.hardFilterExcluded.length}
            </p>
          </FramePanel>
        </Frame>
        <Frame dense data-testid="supply-route-max-cost">
          <FramePanel>
            <p className="text-xs text-muted-foreground">最大成本</p>
            <p className="mt-1 font-medium">
              {view.maxCost
                ? `${(view.maxCost.amountMicros / 1_000_000).toFixed(4)} ${view.maxCost.currency}`
                : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              证据来源 {view.maxCost?.evidenceSource ?? '无候选'}
            </p>
          </FramePanel>
        </Frame>
        <Frame dense data-testid="supply-route-acceptance">
          <FramePanel>
            <p className="text-xs text-muted-foreground">接受态分支</p>
            <p className="mt-1 font-medium">{view.acceptanceBranch.decision}</p>
            <p className="text-xs text-muted-foreground">
              {view.acceptanceBranch.acceptance} ·{' '}
              {view.acceptanceBranch.reason}
            </p>
          </FramePanel>
        </Frame>
        <Frame dense data-testid="supply-route-data-level">
          <FramePanel>
            <p className="text-xs text-muted-foreground">数据处理等级</p>
            <p className="mt-1 font-medium">{view.dataProcessingLevel.level}</p>
            <p className="text-xs text-muted-foreground">
              {view.dataProcessingLevel.copy}
            </p>
          </FramePanel>
        </Frame>
      </div>

      {view.failClosed ? (
        <Frame dense data-testid="supply-route-fail-closed">
          <FramePanel className="border-destructive/40 text-sm text-destructive">
            失败关闭：无合规候选（{view.failClosedReason}）
          </FramePanel>
        </Frame>
      ) : null}

      <Frame dense headingLevel={3} data-testid="supply-route-sort">
        <FrameHeader>
          <FrameTitle>三层排序</FrameTitle>
          <FrameDescription className="text-xs">
            {view.layerOrder.join(' → ')}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="p-0!">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Deployment</TableHead>
                <TableHead>Band</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.sortRanked.map((row) => (
                <TableRow key={row.deploymentId}>
                  <TableCell>#{row.rank}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.deploymentId}
                  </TableCell>
                  <TableCell>
                    <Badge variant={routeVariant(row.band)}>{row.band}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {view.sortRanked.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              无排序候选
            </p>
          ) : null}
        </FramePanel>
      </Frame>

      <Frame dense headingLevel={3} data-testid="supply-route-live-exclusions">
        <FrameHeader>
          <FrameTitle>实时排除</FrameTitle>
        </FrameHeader>
        <FramePanel>
          {view.liveExclusions.length === 0 ? (
            <p className="text-xs text-muted-foreground">无实时排除</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {view.liveExclusions.map((row) => (
                <li key={`live-${row.deploymentId}`}>
                  <span className="font-mono text-xs">{row.deploymentId}</span>:{' '}
                  {row.reasons.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </FramePanel>
      </Frame>

      <Frame dense headingLevel={3} data-testid="supply-route-not-selected">
        <FrameHeader>
          <FrameTitle>未选原因</FrameTitle>
        </FrameHeader>
        <FramePanel>
          {view.notSelectedReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground">全部通过</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {view.notSelectedReasons.map((row) => (
                <li
                  key={`ns-${row.layer}-${row.deploymentId}-${row.reasons.join()}`}
                >
                  <Badge
                    variant={routeVariant(row.layer ?? 'unknown')}
                    className="mr-1"
                  >
                    {row.layer ?? 'unknown'}
                  </Badge>
                  <span className="font-mono text-xs">{row.deploymentId}</span>:{' '}
                  {row.reasons.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </FramePanel>
      </Frame>

      <Frame
        dense
        headingLevel={3}
        data-testid="supply-route-evidence-freshness"
      >
        <FrameHeader>
          <FrameTitle>证据新鲜度</FrameTitle>
        </FrameHeader>
        <FramePanel className="p-0!">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deployment</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.evidenceFreshness.flatMap((row) =>
                row.criticalEvidence.length === 0
                  ? [
                      <TableRow key={`${row.deploymentId}-empty`}>
                        <TableCell className="font-mono text-xs">
                          {row.deploymentId}
                        </TableCell>
                        <TableCell
                          colSpan={2}
                          className="text-muted-foreground"
                        >
                          —
                        </TableCell>
                      </TableRow>,
                    ]
                  : row.criticalEvidence.map((fact) => (
                      <TableRow key={`${row.deploymentId}-${fact.kind}`}>
                        <TableCell className="font-mono text-xs">
                          {row.deploymentId}
                        </TableCell>
                        <TableCell>{fact.kind}</TableCell>
                        <TableCell>
                          <Badge variant={routeVariant(fact.status)}>
                            {fact.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
              )}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>

      <Frame dense headingLevel={3} data-testid="supply-route-cost-evidence">
        <FrameHeader>
          <FrameTitle>成本证据来源</FrameTitle>
        </FrameHeader>
        <FramePanel>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {view.costEvidenceSource.map((row) => (
              <li key={`cost-${row.deploymentId}`}>
                <span className="font-mono text-xs">{row.deploymentId}</span>:{' '}
                {row.source ?? 'unknown'}
                {row.amountMicros != null
                  ? ` · ${row.amountMicros} micros`
                  : ''}
                {row.riskDiscountApplied ? ' · 风险折扣' : ''}
              </li>
            ))}
          </ul>
        </FramePanel>
      </Frame>
    </>
  );
}

export function SupplyRouteSimulatorPanel({
  state,
  view,
}: {
  /** Live path: idle / error / ready. Prefer this over bare `view`. */
  state?: LiveRouteSimulatorState;
  /** Fixture / ready-only convenience: treated as `{ status: 'ready', view }`. */
  view?: RouteSimulatorPanelView | null;
}) {
  const resolved: LiveRouteSimulatorState =
    state ?? (view ? { status: 'ready', view } : { status: 'idle' });

  return (
    <section
      data-testid="supply-route-simulator-panel"
      data-status={resolved.status}
      data-surface={
        resolved.status === 'ready' ? resolved.view.surface : 'simulator'
      }
      data-fail-closed={
        resolved.status === 'ready' ? String(resolved.view.failClosed) : 'false'
      }
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">路由模拟器</h2>
        <p className="text-xs text-muted-foreground">
          与任务审计共用同一解释投影（G5）：硬过滤 / 排序 / 实时排除 / 最大成本
          / 接受态 / 未选原因 / 证据新鲜度 / 成本证据来源。经
          admin_supply_action_preview / admin_supply_action（route_simulate）由
          Core 生成，禁止演示数据回退。
        </p>
      </header>

      {resolved.status === 'idle' ? (
        <Frame dense data-testid="supply-route-simulator-idle">
          <FramePanel className="border-dashed text-sm text-muted-foreground">
            尚未运行路由模拟。使用下方「路由模拟」受治理动作，经 Core
            预览并执行后，此处展示解释投影。当前为空闲态，不是无候选。
          </FramePanel>
        </Frame>
      ) : null}

      {resolved.status === 'error' ? (
        <Frame dense data-testid="supply-route-simulator-error" role="alert">
          <FramePanel className="border-destructive/40 text-sm text-destructive">
            路由模拟失败：{resolved.message}。当前状态未知，未使用演示数据回退。
          </FramePanel>
        </Frame>
      ) : null}

      {resolved.status === 'ready' ? (
        <ReadyRouteSimulatorBody view={resolved.view} />
      ) : null}
    </section>
  );
}

/**
 * Route simulator explanation panel (J5 / G5 / D-065 ④).
 * Renders the shared projection: hard filter / sort / live exclude / max cost /
 * acceptance branch / not-selected reasons / evidence freshness / cost source.
 */
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RouteSimulatorPanelView } from '@/p1/admin-supply-route-simulator-model';

export function SupplyRouteSimulatorPanel({
  view,
}: {
  view: RouteSimulatorPanelView;
}) {
  return (
    <section
      data-testid="supply-route-simulator-panel"
      data-surface={view.surface}
      data-fail-closed={String(view.failClosed)}
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">路由模拟器</h2>
        <p className="text-xs text-muted-foreground">
          与任务审计共用同一解释投影（G5）：硬过滤 / 排序 / 实时排除 / 最大成本 /
          接受态 / 未选原因 / 证据新鲜度 / 成本证据来源。
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          data-testid="supply-route-hard-filter"
          className="rounded-lg border p-3"
        >
          <p className="text-xs text-muted-foreground">硬过滤通过</p>
          <p className="mt-1 font-medium">
            {view.hardFilterPassed.length} 个 Deployment
          </p>
          <p className="text-xs text-muted-foreground">
            排除 {view.hardFilterExcluded.length}
          </p>
        </div>
        <div
          data-testid="supply-route-max-cost"
          className="rounded-lg border p-3"
        >
          <p className="text-xs text-muted-foreground">最大成本</p>
          <p className="mt-1 font-medium">
            {view.maxCost
              ? `${(view.maxCost.amountMicros / 1_000_000).toFixed(4)} ${view.maxCost.currency}`
              : '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            证据来源 {view.maxCost?.evidenceSource ?? '无候选'}
          </p>
        </div>
        <div
          data-testid="supply-route-acceptance"
          className="rounded-lg border p-3"
        >
          <p className="text-xs text-muted-foreground">接受态分支</p>
          <p className="mt-1 font-medium">{view.acceptanceBranch.decision}</p>
          <p className="text-xs text-muted-foreground">
            {view.acceptanceBranch.acceptance} · {view.acceptanceBranch.reason}
          </p>
        </div>
        <div
          data-testid="supply-route-data-level"
          className="rounded-lg border p-3"
        >
          <p className="text-xs text-muted-foreground">数据处理等级</p>
          <p className="mt-1 font-medium">{view.dataProcessingLevel.level}</p>
          <p className="text-xs text-muted-foreground">
            {view.dataProcessingLevel.copy}
          </p>
        </div>
      </div>

      {view.failClosed ? (
        <div
          data-testid="supply-route-fail-closed"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          失败关闭：无合规候选（{view.failClosedReason}）
        </div>
      ) : null}

      <div data-testid="supply-route-sort" className="space-y-2">
        <h3 className="text-sm font-semibold">三层排序</h3>
        <p className="text-xs text-muted-foreground">
          {view.layerOrder.join(' → ')}
        </p>
        <div className="overflow-hidden rounded-lg border">
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
                    <Badge variant="secondary">{row.band}</Badge>
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
        </div>
      </div>

      <div
        data-testid="supply-route-live-exclusions"
        className="space-y-2"
      >
        <h3 className="text-sm font-semibold">实时排除</h3>
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
      </div>

      <div
        data-testid="supply-route-not-selected"
        className="space-y-2"
      >
        <h3 className="text-sm font-semibold">未选原因</h3>
        {view.notSelectedReasons.length === 0 ? (
          <p className="text-xs text-muted-foreground">全部通过</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {view.notSelectedReasons.map((row) => (
              <li key={`ns-${row.layer}-${row.deploymentId}-${row.reasons.join()}`}>
                <Badge variant="outline" className="mr-1">
                  {row.layer ?? 'unknown'}
                </Badge>
                <span className="font-mono text-xs">{row.deploymentId}</span>:{' '}
                {row.reasons.join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        data-testid="supply-route-evidence-freshness"
        className="space-y-2"
      >
        <h3 className="text-sm font-semibold">证据新鲜度</h3>
        <div className="overflow-hidden rounded-lg border">
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
                        <TableCell colSpan={2} className="text-muted-foreground">
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
                          <Badge
                            variant={
                              fact.status === 'fresh' ? 'secondary' : 'outline'
                            }
                          >
                            {fact.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )),
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div
        data-testid="supply-route-cost-evidence"
        className="space-y-2"
      >
        <h3 className="text-sm font-semibold">成本证据来源</h3>
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
      </div>
    </section>
  );
}

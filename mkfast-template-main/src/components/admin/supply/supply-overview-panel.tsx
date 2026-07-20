/**
 * Supply control center overview panel (J4 / D-070).
 */
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { SupplyOverviewView } from '@/p1/admin-supply-overview-model';

function StatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <Badge
      variant="outline"
      data-testid="supply-readiness-badge"
      data-status={status}
    >
      {label}
    </Badge>
  );
}

export function SupplyOverviewPanel({ view }: { view: SupplyOverviewView }) {
  return (
    <section
      data-testid="supply-overview-panel"
      data-external-gateway-deeplink-only={String(
        view.externalGatewayIsDeepLinkOnly,
      )}
      className="space-y-6"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">供应总览</h2>
        <p className="text-xs text-muted-foreground">
          Catalog {view.catalogRevisionId} · r{view.catalogRevisionNumber} ·
          捕获 {view.capturedAt}
        </p>
      </header>

      <section data-testid="supply-operation-readiness" className="space-y-2">
        <h3 className="text-sm font-semibold">三模态 operation readiness</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {view.operationReadiness.map((row) => (
            <Card
              key={row.operation}
              data-testid="supply-readiness-card"
              data-operation={row.operation}
              data-status={row.status}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {row.modalityLabel} · {row.operation}
                </CardTitle>
                <CardDescription>
                  候选 {row.candidateCount} · 健康阻断{' '}
                  {row.healthBlockingCount}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <StatusBadge status={row.status} label={row.label} />
                <p data-testid="supply-dual-channel-note">
                  {row.dualChannel.label}：{row.dualChannel.note}
                </p>
                <p className="font-mono text-muted-foreground">
                  RoutePolicy {row.publishedRoutePolicyRevisionId ?? '—'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section data-testid="supply-dual-channel-coverage" className="space-y-2">
        <h3 className="text-sm font-semibold">核心模型双渠道覆盖</h3>
        <ul className="space-y-2">
          {view.dualChannelCoverage.map((row) => (
            <li
              key={row.operation}
              data-testid="supply-dual-channel-row"
              data-operation={row.operation}
              data-status={row.status}
              data-multi-channel-ready={String(row.multiChannelReady)}
              className="rounded-md border p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {row.catalogModelDisplayName ?? '未配置'} (
                  {row.catalogModelId ?? '—'})
                </span>
                <Badge variant="secondary">{row.label}</Badge>
                <span className="text-muted-foreground">
                  故障域 {row.independentFaultDomainCount} ·{' '}
                  {row.faultDomainKind}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{row.note}</p>
              <p className="mt-1 font-mono">
                deployments:{' '}
                {row.qualifiedDeployments.map((d) => d.deploymentId).join(', ') ||
                  '—'}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="supply-six-entity" className="space-y-2">
        <h3 className="text-sm font-semibold">六实体关系</h3>
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          {(
            [
              ['CatalogModel', view.sixEntityRelations.catalogModels],
              ['ProviderProfile', view.sixEntityRelations.providerProfiles],
              ['SupplyContract', view.sixEntityRelations.supplyContracts],
              [
                'CredentialAccount',
                view.sixEntityRelations.credentialAccounts,
              ],
              [
                'ExecutionChannel',
                view.sixEntityRelations.executionChannels,
              ],
              ['Deployment', view.sixEntityRelations.deployments],
            ] as const
          ).map(([label, count]) => (
            <div
              key={label}
              data-testid="supply-entity-count"
              data-entity={label}
              className="rounded-md border p-2"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-base font-semibold">{count}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section data-testid="supply-effective-revisions" className="space-y-2">
        <h3 className="text-sm font-semibold">
          Pool / RoutePolicy 生效 revision
        </h3>
        <ul className="space-y-1 text-xs">
          {view.effectiveRevisions.map((rev) => (
            <li
              key={`${rev.kind}-${rev.id}`}
              data-testid="supply-effective-revision"
              data-kind={rev.kind}
              className="font-mono"
            >
              [{rev.kind}] {rev.displayName} → {rev.revisionId}
              {rev.publishedAt ? ` @ ${rev.publishedAt}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section data-testid="supply-health-capacity" className="space-y-2">
          <h3 className="text-sm font-semibold">
            健康 / 容量 / 余额 / 限额 / 成本
          </h3>
          <p className="text-xs text-muted-foreground">
            健康阻断 {view.health.blockingCount} · 已知运行成本{' '}
            {view.cost.knownRunCostMicros} µ · 未知成本任务{' '}
            {view.cost.unknownCostRunCount}
          </p>
          <ul className="space-y-1 text-xs">
            {view.health.overlays.map((h) => (
              <li
                key={h.targetId}
                data-testid="supply-health-overlay"
                data-state={h.state}
              >
                {h.targetId}: {h.state} ({h.reason})
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-xs">
            {view.capacity.map((c) => (
              <li
                key={c.poolId}
                data-testid="supply-capacity-row"
                className="rounded border p-2"
              >
                <span className="font-medium">{c.displayName}</span> ·{' '}
                {c.kind} · rev {c.revisionId}
                <br />
                rpm {c.rpm ?? '—'} / tpm {c.tpm ?? '—'} / 并发 s
                {c.supplyConcurrency ?? '—'} p{c.productConcurrency ?? '—'} sys
                {c.systemConcurrency ?? '—'}
                <br />
                余额 headroom {String(c.balanceHeadroom)} · 配额 {c.quotaHint}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            价格证据源: {view.cost.priceEvidenceSources.join(', ') || '—'}
          </p>
        </section>

        <section data-testid="supply-lifecycle-affected" className="space-y-2">
          <h3 className="text-sm font-semibold">
            同步 attempt / 异步媒体生命周期 · 受影响面
          </h3>
          <dl className="grid grid-cols-2 gap-1 text-xs">
            <div>sync {view.lifecycle.syncAttempts}</div>
            <div>async_submit {view.lifecycle.asyncSubmit}</div>
            <div>async_poll {view.lifecycle.asyncPoll}</div>
            <div>async_recover {view.lifecycle.asyncRecover}</div>
            <div>terminal {view.lifecycle.terminal}</div>
          </dl>
          <p className="text-xs" data-testid="supply-affected-accounts">
            账号 {view.affected.accountIds.join(', ') || '—'}
          </p>
          <p className="text-xs" data-testid="supply-affected-tasks">
            任务 {view.affected.taskIds.join(', ') || '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            开放失败/未知{' '}
            {view.affected.openFailureTaskIds.join(', ') || '无'}
          </p>
        </section>
      </div>

      <section data-testid="supply-data-class" className="space-y-2">
        <h3 className="text-sm font-semibold">数据等级覆盖</h3>
        <ul className="flex flex-wrap gap-2 text-xs">
          {view.dataClassCoverage.map((row) => (
            <li
              key={row.dataClass}
              data-testid="supply-data-class-row"
              data-class={row.dataClass}
              className="rounded border px-2 py-1"
            >
              {row.dataClass} · dep {row.deploymentCount}
              {row.singleChannelOnly ? ' · single-channel' : ''}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="supply-recent-audit" className="space-y-2">
        <h3 className="text-sm font-semibold">最近变更 · 统一审计</h3>
        <ul className="space-y-1 text-xs">
          {view.recentChanges.map((change) => (
            <li
              key={change.id}
              data-testid="supply-audit-row"
              className="rounded border p-2"
            >
              <span className="font-mono">{change.at}</span> · {change.action} ·{' '}
              {change.summary}
              <br />
              <span className="text-muted-foreground">
                {change.targetType}/{change.targetId} · corr{' '}
                {change.correlationId}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="supply-gateway-deeplinks" className="space-y-2">
        <h3 className="text-sm font-semibold">
          外部网关 Console（仅技术证据深链）
        </h3>
        <ul className="space-y-1 text-xs">
          {view.gatewayDeepLinks.map((link) => (
            <li key={link.id}>
              <a
                href={link.href}
                data-testid="supply-gateway-deeplink"
                data-evidence-only="true"
                data-gateway-fingerprint={link.gatewayFingerprint}
                className="text-primary underline-offset-2 hover:underline"
                rel="noreferrer"
                target="_blank"
              >
                {link.label}
              </a>
              <span className="ml-2 text-muted-foreground">
                非日常管理主入口 · 非第二业务真相
              </span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

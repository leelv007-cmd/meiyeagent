/**
 * Cloudflare read-only admin panel (J6 / D-052 / D-053).
 *
 * Three truth layers, self probes, config risks, inventory projection,
 * and deep-link handoff CTAs. No write controls. No CF Queue card.
 *
 * 换壳只动外框：分区走 Frame，状态字改语义 Badge。`data-write-actions-allowed`
 * 一类只读断言点原样保留 —— 它们是这个面「不许写」的证据，不是样式。
 */

import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Separator } from '@/components/ui/separator';
import {
  adminCfProbeStatusLabel,
  type AdminCfProbeView,
} from '@/p1/admin-cloudflare-probe';
import {
  formatAdminCfField,
  type AdminCfPresentationView,
} from '@/p1/admin-cloudflare-presentation';

type StatusVariant = NonNullable<BadgeProps['variant']>;

function freshnessVariant(freshness: string): StatusVariant {
  if (freshness === 'fresh') return 'success-outline';
  if (freshness === 'stale') return 'warning-outline';
  if (freshness === 'unavailable') return 'destructive-outline';
  return 'secondary';
}

function probeVariant(status: AdminCfProbeView['status']): StatusVariant {
  if (status === 'ok') return 'success-outline';
  if (status === 'degraded' || status === 'not_ready') return 'warning-outline';
  if (status === 'failed') return 'destructive-outline';
  return 'secondary';
}

function FreshnessBadge({
  freshness,
  label,
}: {
  freshness: string;
  label: string;
}) {
  return (
    <Badge
      variant={freshnessVariant(freshness)}
      data-testid="cf-freshness"
      data-freshness={freshness}
    >
      {label}
    </Badge>
  );
}

function ProbeRow({ probe }: { probe: AdminCfProbeView }) {
  return (
    <li
      data-testid="cf-probe-row"
      data-probe-kind={probe.kind}
      data-probe-status={probe.status}
      data-mutates-cloudflare="false"
      className="rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{probe.title}</span>
        <Badge
          variant={probeVariant(probe.status)}
          data-testid="cf-probe-status-label"
        >
          {adminCfProbeStatusLabel(probe.status)}
        </Badge>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        {probe.businessImpact}
      </p>
      {probe.detail ? (
        <p
          className="text-muted-foreground mt-1 text-xs"
          data-testid="cf-probe-detail"
        >
          {probe.detail}
        </p>
      ) : null}
    </li>
  );
}

export function CloudflareReadonlyPanel({
  view,
}: {
  view: AdminCfPresentationView;
}) {
  return (
    <div
      data-testid="cloudflare-readonly-panel"
      data-write-actions-allowed="false"
      data-show-queue-card="false"
      data-graphql-deferred="true"
      className="space-y-4"
    >
      <Frame>
        {/* 标题不再重复一遍页面 h1（AdminRoutePage 已经报过「Cloudflare 只读运行投影」），
            这一条只带新鲜度与覆盖范围。 */}
        <FrameHeader className="gap-2">
          <FreshnessBadge
            freshness={view.freshness}
            label={view.freshnessLabel}
          />
          <FrameDescription data-testid="cf-coverage-note">
            {view.coverageNote}
          </FrameDescription>
        </FrameHeader>
        <FramePanel
          className="grid gap-2 text-sm"
          data-testid="cf-truth-layers"
        >
          <p data-testid="cf-truth-native">
            {view.truthLayers.nativeDiagnostics}
          </p>
          <p data-testid="cf-truth-projection">
            {view.truthLayers.productProjection}
          </p>
          <p data-testid="cf-truth-actions">
            {view.truthLayers.productSideActions}
          </p>
        </FramePanel>
      </Frame>

      <Frame data-testid="cf-config-risks">
        <FrameHeader>
          <FrameTitle>配置风险 / 未就绪</FrameTitle>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-0 p-0!">
          {view.configRisks.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              暂无登记的配置风险
            </p>
          ) : (
            view.configRisks.map((risk) => (
              <div
                key={risk.id}
                data-testid="cf-config-risk"
                data-risk-id={risk.id}
                data-severity={risk.severity}
                className="border-b px-4 py-3 last:border-b-0"
              >
                <div className="font-medium">{risk.title}</div>
                <p className="text-muted-foreground text-sm">
                  {risk.businessImpact}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {risk.evidence}
                </p>
              </div>
            ))
          )}
        </FramePanel>
      </Frame>

      <Frame data-testid="cf-self-probes">
        <FrameHeader className="gap-1">
          <FrameTitle>自有健康探针</FrameTitle>
          <FrameDescription className="text-xs">
            总体：{adminCfProbeStatusLabel(view.probeSummary.overall)} · 正常{' '}
            {view.probeSummary.okCount} · 需关注{' '}
            {view.probeSummary.attentionCount}
          </FrameDescription>
        </FrameHeader>
        <FramePanel>
          <ul className="grid gap-2 sm:grid-cols-2">
            {view.probes.map((probe) => (
              <ProbeRow key={probe.kind} probe={probe} />
            ))}
          </ul>
        </FramePanel>
      </Frame>

      <Frame data-testid="cf-inventory">
        <FrameHeader>
          <FrameTitle>只读 REST 盘点</FrameTitle>
        </FrameHeader>
        <FramePanel
          className="text-sm"
          data-testid="cf-deployments"
          data-field-status={view.deployments.status}
        >
          <div className="font-medium">部署</div>
          <p className="text-muted-foreground">
            {view.deployments.businessImpact}
          </p>
          <p data-testid="cf-deployments-value" className="mt-1 text-xs">
            {formatAdminCfField(view.deployments, (rows) =>
              rows.map((r) => r.deploymentId).join(', ')
            )}
          </p>
        </FramePanel>
        <FramePanel
          className="text-sm"
          data-testid="cf-versions"
          data-field-status={view.versions.status}
        >
          <div className="font-medium">版本</div>
          <p className="text-muted-foreground">
            {view.versions.businessImpact}
          </p>
          <p data-testid="cf-versions-value" className="mt-1 text-xs">
            {formatAdminCfField(view.versions, (rows) =>
              rows.map((r) => r.versionId).join(', ')
            )}
          </p>
        </FramePanel>
        <FramePanel className="flex flex-col gap-0 p-0!">
          <div className="text-muted-foreground px-4 py-2 text-sm font-medium">
            资源
          </div>
          <Separator />
          <ul data-testid="cf-resources">
            {view.resources.map((resource) => (
              <li
                key={`${resource.kind}:${resource.name}`}
                data-testid="cf-resource-row"
                data-resource-kind={resource.kind}
                data-readiness={resource.readiness}
                className="border-b px-4 py-3 text-sm last:border-b-0"
              >
                <div className="font-medium">
                  {resource.kind} · {resource.name}
                </div>
                <p className="text-muted-foreground">
                  {resource.businessImpact}
                </p>
              </li>
            ))}
          </ul>
        </FramePanel>
      </Frame>

      {view.deepLinks.length > 0 ? (
        <Frame data-testid="cf-deep-links">
          <FrameHeader>
            <FrameTitle>技术台 deep-link（脱敏上下文）</FrameTitle>
          </FrameHeader>
          <FramePanel>
            <ul className="flex flex-wrap gap-2">
              {view.deepLinks.map((link) => (
                <li key={link.kind}>
                  <a
                    href={link.dashboardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="cf-deep-link"
                    data-resource-kind={link.kind}
                    data-mutates-cloudflare="false"
                    className="border-border bg-background hover:bg-muted inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </FramePanel>
          <FramePanel
            className="border-dashed shadow-none"
            data-testid="cf-write-denials"
          >
            <p className="text-muted-foreground text-xs">
              写权限零持有：{view.deniedWriteActions.join(', ')}
            </p>
          </FramePanel>
        </Frame>
      ) : (
        <Frame data-testid="cf-write-denials-only">
          <FramePanel
            className="border-dashed shadow-none"
            data-testid="cf-write-denials"
          >
            <p className="text-muted-foreground text-xs">
              写权限零持有：{view.deniedWriteActions.join(', ')}
            </p>
          </FramePanel>
        </Frame>
      )}
    </div>
  );
}

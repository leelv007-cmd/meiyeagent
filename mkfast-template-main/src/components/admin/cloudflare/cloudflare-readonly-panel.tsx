/**
 * Cloudflare read-only admin panel (J6 / D-052 / D-053).
 *
 * Three truth layers, self probes, config risks, inventory projection,
 * and deep-link handoff CTAs. No write controls. No CF Queue card.
 */

import {
  adminCfProbeStatusLabel,
  type AdminCfProbeView,
} from '@/p1/admin-cloudflare-probe';
import {
  formatAdminCfField,
  type AdminCfPresentationView,
} from '@/p1/admin-cloudflare-presentation';

function FreshnessBadge({
  freshness,
  label,
}: {
  freshness: string;
  label: string;
}) {
  return (
    <span
      data-testid="cf-freshness"
      data-freshness={freshness}
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs"
    >
      {label}
    </span>
  );
}

function ProbeRow({ probe }: { probe: AdminCfProbeView }) {
  return (
    <li
      data-testid="cf-probe-row"
      data-probe-kind={probe.kind}
      data-probe-status={probe.status}
      data-mutates-cloudflare="false"
      className="rounded-md border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{probe.title}</span>
        <span data-testid="cf-probe-status-label" className="text-xs">
          {adminCfProbeStatusLabel(probe.status)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {probe.businessImpact}
      </p>
      {probe.detail ? (
        <p
          className="mt-1 text-xs text-muted-foreground"
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
    <section
      data-testid="cloudflare-readonly-panel"
      data-write-actions-allowed="false"
      data-show-queue-card="false"
      data-graphql-deferred="true"
      className="space-y-6"
    >
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Cloudflare 只读运行投影</h2>
          <FreshnessBadge
            freshness={view.freshness}
            label={view.freshnessLabel}
          />
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="cf-coverage-note"
        >
          {view.coverageNote}
        </p>
      </header>

      <div
        data-testid="cf-truth-layers"
        className="grid gap-2 rounded-md border p-3 text-sm"
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
      </div>

      <section data-testid="cf-config-risks" className="space-y-2">
        <h3 className="text-sm font-semibold">配置风险 / 未就绪</h3>
        <ul className="space-y-2">
          {view.configRisks.map((risk) => (
            <li
              key={risk.id}
              data-testid="cf-config-risk"
              data-risk-id={risk.id}
              data-severity={risk.severity}
              className="rounded-md border p-3"
            >
              <div className="font-medium">{risk.title}</div>
              <p className="text-sm text-muted-foreground">
                {risk.businessImpact}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {risk.evidence}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="cf-self-probes" className="space-y-2">
        <h3 className="text-sm font-semibold">自有健康探针</h3>
        <p className="text-xs text-muted-foreground">
          总体：{adminCfProbeStatusLabel(view.probeSummary.overall)} · 正常{' '}
          {view.probeSummary.okCount} · 需关注{' '}
          {view.probeSummary.attentionCount}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {view.probes.map((probe) => (
            <ProbeRow key={probe.kind} probe={probe} />
          ))}
        </ul>
      </section>

      <section data-testid="cf-inventory" className="space-y-3">
        <h3 className="text-sm font-semibold">只读 REST 盘点</h3>
        <div
          data-testid="cf-deployments"
          data-field-status={view.deployments.status}
          className="rounded-md border p-3 text-sm"
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
        </div>
        <div
          data-testid="cf-versions"
          data-field-status={view.versions.status}
          className="rounded-md border p-3 text-sm"
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
        </div>
        <ul data-testid="cf-resources" className="space-y-2">
          {view.resources.map((resource) => (
            <li
              key={`${resource.kind}:${resource.name}`}
              data-testid="cf-resource-row"
              data-resource-kind={resource.kind}
              data-readiness={resource.readiness}
              className="rounded-md border p-3 text-sm"
            >
              <div className="font-medium">
                {resource.kind} · {resource.name}
              </div>
              <p className="text-muted-foreground">{resource.businessImpact}</p>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="cf-deep-links" className="space-y-2">
        <h3 className="text-sm font-semibold">
          技术台 deep-link（脱敏上下文）
        </h3>
        <ul className="flex flex-wrap gap-2">
          {view.deepLinks.map((link) => (
            <li key={link.kind}>
              <span
                data-testid="cf-deep-link"
                data-resource-kind={link.kind}
                data-mutates-cloudflare="false"
                className="inline-flex rounded-md border px-3 py-1.5 text-sm"
              >
                {link.label}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer
        data-testid="cf-write-denials"
        className="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
      >
        写权限零持有：{view.deniedWriteActions.join(', ')}
      </footer>
    </section>
  );
}

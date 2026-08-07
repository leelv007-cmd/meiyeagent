/**
 * Supply control center overview panel (J4 / D-070).
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
import type { SupplyOverviewView } from '@/p1/admin-supply-overview-model';
import {
  admin_capability_captured_d98892e9,
  admin_supply_accounts_90138491,
  admin_supply_balance_headroom_787465d2,
  admin_supply_candidates_0461e4db,
  admin_supply_concurrency_s_8945074e,
  admin_supply_core_model_dual_channel_coverage_77073887,
  admin_supply_data_class_coverage_8db6f81b,
  admin_supply_external_gateway_console_tech_evidence_d_4f2760b7,
  admin_supply_failure_domains_f5a95a7a,
  admin_supply_health_blockers_ca106b1d,
  admin_supply_health_blockers_db4fc647,
  admin_supply_health_capacity_balance_limits_cost_c7760272,
  admin_supply_known_run_cost_d89ebb60,
  admin_supply_none_72077749,
  admin_supply_not_a_day_to_day_admin_primary_entry_not_214642bd,
  admin_supply_not_configured_63595e95,
  admin_supply_open_failed_unknown_d644eb45,
  admin_supply_pool_routepolicy_effective_revision_cb2b0746,
  admin_supply_price_evidence_source_003259c9,
  admin_supply_quota_7d350d87,
  admin_supply_recent_changes_unified_audit_1e7662a8,
  admin_supply_six_entity_relationships_89cbbc93,
  admin_supply_supply_overview_30000464,
  admin_supply_sync_attempt_async_media_lifecycle_impac_caeea7a6,
  admin_supply_tasks_3172b317,
  admin_supply_three_modality_operation_readiness_301e2fe1,
  admin_supply_unknown_cost_tasks_9dcc94e2,
} from '@/locale/paraglide/messages';

/**
 * Readiness words come from the projection, so the mapping is on the word, not
 * on a colour picked at the call site — an unmapped status stays neutral rather
 * than borrowing a green it has not earned.
 */
const READINESS_VARIANT: Record<string, BadgeProps['variant']> = {
  ready: 'success-light',
  degraded: 'warning-light',
  blocked: 'destructive-light',
  not_verified: 'outline',
  unknown: 'outline',
};

function readinessVariant(status: string): BadgeProps['variant'] {
  return READINESS_VARIANT[status] ?? 'outline';
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <Badge
      variant={readinessVariant(status)}
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
        view.externalGatewayIsDeepLinkOnly
      )}
      className="space-y-6"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">
          {admin_supply_supply_overview_30000464()}
        </h2>
        <p className="text-xs text-muted-foreground">
          Catalog {view.catalogRevisionId} · r{view.catalogRevisionNumber}{' '}
          {admin_capability_captured_d98892e9()} {view.capturedAt}
        </p>
      </header>

      <section data-testid="supply-operation-readiness" className="space-y-2">
        <h3 className="text-sm font-semibold">
          {admin_supply_three_modality_operation_readiness_301e2fe1()}
        </h3>
        <div className="grid auto-rows-fr items-stretch gap-3 sm:grid-cols-3">
          {view.operationReadiness.map((row) => (
            <Frame
              dense
              key={row.operation}
              className="h-full min-w-0"
              data-testid="supply-readiness-card"
              data-operation={row.operation}
              data-status={row.status}
            >
              <FrameHeader>
                <FrameTitle className="text-sm font-medium text-muted-foreground">
                  {row.modalityLabel} · {row.operation}
                </FrameTitle>
                <FrameDescription className="text-xs">
                  {admin_supply_candidates_0461e4db()} {row.candidateCount}{' '}
                  {admin_supply_health_blockers_ca106b1d()}{' '}
                  {row.healthBlockingCount}
                </FrameDescription>
              </FrameHeader>
              <FramePanel className="flex flex-1 flex-col gap-2 text-xs">
                <StatusBadge status={row.status} label={row.label} />
                <Separator />
                <p data-testid="supply-dual-channel-note">
                  {row.dualChannel.label}：{row.dualChannel.note}
                </p>
                <p className="font-mono text-muted-foreground">
                  RoutePolicy {row.publishedRoutePolicyRevisionId ?? '—'}
                </p>
              </FramePanel>
            </Frame>
          ))}
        </div>
      </section>

      <section data-testid="supply-dual-channel-coverage" className="space-y-2">
        <h3 className="text-sm font-semibold">
          {admin_supply_core_model_dual_channel_coverage_77073887()}
        </h3>
        <Frame stacked dense spacing="sm">
          {view.dualChannelCoverage.map((row) => (
            <FramePanel
              key={row.operation}
              data-testid="supply-dual-channel-row"
              data-operation={row.operation}
              data-status={row.status}
              data-multi-channel-ready={String(row.multiChannelReady)}
              className="text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {row.catalogModelDisplayName ??
                    admin_supply_not_configured_63595e95()}{' '}
                  ({row.catalogModelId ?? '—'})
                </span>
                <Badge
                  variant={row.multiChannelReady ? 'success-light' : 'outline'}
                >
                  {row.label}
                </Badge>
                <span className="text-muted-foreground">
                  {admin_supply_failure_domains_f5a95a7a()}{' '}
                  {row.independentFaultDomainCount} · {row.faultDomainKind}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{row.note}</p>
              <p className="mt-1 font-mono">
                deployments:{' '}
                {row.qualifiedDeployments
                  .map((d) => d.deploymentId)
                  .join(', ') || '—'}
              </p>
            </FramePanel>
          ))}
        </Frame>
      </section>

      <section data-testid="supply-six-entity" className="space-y-2">
        <h3 className="text-sm font-semibold">
          {admin_supply_six_entity_relationships_89cbbc93()}
        </h3>
        <Frame dense className="grid grid-cols-2 gap-px sm:grid-cols-3">
          {(
            [
              ['CatalogModel', view.sixEntityRelations.catalogModels],
              ['ProviderProfile', view.sixEntityRelations.providerProfiles],
              ['SupplyContract', view.sixEntityRelations.supplyContracts],
              ['CredentialAccount', view.sixEntityRelations.credentialAccounts],
              ['ExecutionChannel', view.sixEntityRelations.executionChannels],
              ['Deployment', view.sixEntityRelations.deployments],
            ] as const
          ).map(([label, count]) => (
            <FramePanel
              key={label}
              data-testid="supply-entity-count"
              data-entity={label}
              className="text-xs"
            >
              <div className="text-muted-foreground">{label}</div>
              <div className="text-base font-semibold tabular-nums">
                {count}
              </div>
            </FramePanel>
          ))}
        </Frame>
      </section>

      <Frame dense data-testid="supply-effective-revisions">
        <FrameHeader>
          <FrameTitle className="text-sm">
            {admin_supply_pool_routepolicy_effective_revision_cb2b0746()}
          </FrameTitle>
        </FrameHeader>
        <FramePanel>
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
        </FramePanel>
      </Frame>

      <div className="grid gap-4 lg:grid-cols-2">
        <Frame dense data-testid="supply-health-capacity">
          <FrameHeader>
            <FrameTitle className="text-sm">
              {admin_supply_health_capacity_balance_limits_cost_c7760272()}
            </FrameTitle>
            <FrameDescription className="text-xs">
              {admin_supply_health_blockers_db4fc647()}{' '}
              {view.health.blockingCount}{' '}
              {admin_supply_known_run_cost_d89ebb60()}{' '}
              {view.cost.knownRunCostMicros}{' '}
              {admin_supply_unknown_cost_tasks_9dcc94e2()}{' '}
              {view.cost.unknownCostRunCount}
            </FrameDescription>
          </FrameHeader>
          <FramePanel className="space-y-2 text-xs">
            <ul className="space-y-1">
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
            <ul className="space-y-1">
              {view.capacity.map((c) => (
                <li
                  key={c.poolId}
                  data-testid="supply-capacity-row"
                  className="rounded-md border p-2"
                >
                  <span className="font-medium">{c.displayName}</span> ·{' '}
                  {c.kind} · rev {c.revisionId}
                  <br />
                  rpm {c.rpm ?? '—'} / tpm {c.tpm ?? '—'}{' '}
                  {admin_supply_concurrency_s_8945074e()}
                  {c.supplyConcurrency ?? '—'} p{c.productConcurrency ?? '—'}{' '}
                  sys
                  {c.systemConcurrency ?? '—'}
                  <br />
                  {admin_supply_balance_headroom_787465d2()}{' '}
                  {String(c.balanceHeadroom)} {admin_supply_quota_7d350d87()}{' '}
                  {c.quotaHint}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              {admin_supply_price_evidence_source_003259c9()}{' '}
              {view.cost.priceEvidenceSources.join(', ') || '—'}
            </p>
          </FramePanel>
        </Frame>

        <Frame dense data-testid="supply-lifecycle-affected">
          <FrameHeader>
            <FrameTitle className="text-sm">
              {admin_supply_sync_attempt_async_media_lifecycle_impac_caeea7a6()}
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="space-y-2 text-xs">
            <dl className="grid grid-cols-2 gap-1">
              <div>sync {view.lifecycle.syncAttempts}</div>
              <div>async_submit {view.lifecycle.asyncSubmit}</div>
              <div>async_poll {view.lifecycle.asyncPoll}</div>
              <div>async_recover {view.lifecycle.asyncRecover}</div>
              <div>terminal {view.lifecycle.terminal}</div>
            </dl>
            <Separator />
            <p data-testid="supply-affected-accounts">
              {admin_supply_accounts_90138491()}{' '}
              {view.affected.accountIds.join(', ') || '—'}
            </p>
            <p data-testid="supply-affected-tasks">
              {admin_supply_tasks_3172b317()}{' '}
              {view.affected.taskIds.join(', ') || '—'}
            </p>
            <p className="text-muted-foreground">
              {admin_supply_open_failed_unknown_d644eb45()}{' '}
              {view.affected.openFailureTaskIds.join(', ') ||
                admin_supply_none_72077749()}
            </p>
          </FramePanel>
        </Frame>
      </div>

      <section data-testid="supply-data-class" className="space-y-2">
        <h3 className="text-sm font-semibold">
          {admin_supply_data_class_coverage_8db6f81b()}
        </h3>
        <ul className="flex flex-wrap gap-2 text-xs">
          {view.dataClassCoverage.map((row) => (
            <li
              key={row.dataClass}
              data-testid="supply-data-class-row"
              data-class={row.dataClass}
            >
              <Badge
                variant={row.singleChannelOnly ? 'warning-light' : 'outline'}
              >
                {row.dataClass} · dep {row.deploymentCount}
                {row.singleChannelOnly ? ' · single-channel' : ''}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <Frame dense data-testid="supply-recent-audit">
        <FrameHeader>
          <FrameTitle className="text-sm">
            {admin_supply_recent_changes_unified_audit_1e7662a8()}
          </FrameTitle>
        </FrameHeader>
        <FramePanel>
          <ul className="space-y-1 text-xs">
            {view.recentChanges.map((change) => (
              <li
                key={change.id}
                data-testid="supply-audit-row"
                className="rounded-md border p-2"
              >
                <span className="font-mono">{change.at}</span> · {change.action}{' '}
                · {change.summary}
                <br />
                <span className="text-muted-foreground">
                  {change.targetType}/{change.targetId} · corr{' '}
                  {change.correlationId}
                </span>
              </li>
            ))}
          </ul>
        </FramePanel>
      </Frame>

      <Frame dense data-testid="supply-gateway-deeplinks">
        <FrameHeader>
          <FrameTitle className="text-sm">
            {admin_supply_external_gateway_console_tech_evidence_d_4f2760b7()}
          </FrameTitle>
          <FrameDescription className="text-xs">
            {admin_supply_not_a_day_to_day_admin_primary_entry_not_214642bd()}
          </FrameDescription>
        </FrameHeader>
        <FramePanel>
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
                  {admin_supply_not_a_day_to_day_admin_primary_entry_not_214642bd()}
                </span>
              </li>
            ))}
          </ul>
        </FramePanel>
      </Frame>
    </section>
  );
}

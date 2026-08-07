/**
 * CredentialAccount management panel (J5 / D-060).
 * Metadata / binding / version / 3-state + tested gate + draining /
 * probe results / rotate-drain notes. Secrets never rendered.
 */
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import type { CredentialUiPanelView } from '@/p1/admin-supply-credential-model';
import {
  admin_cloudflare_deployments_3220a19f,
  admin_supply_activatable_92146623,
  admin_supply_activation_gate_dcec3252,
  admin_supply_bindings_6aed7c48,
  admin_supply_channel_1ef74839,
  admin_supply_credential_accounts_b7349a07,
  admin_supply_drainable_5931e598,
  admin_supply_env_fallback_risk_count,
  admin_supply_env_var_fallback_vault_not_owning_stays_66cff880,
  admin_supply_error_code_e08c1d4f,
  admin_supply_met_3a31adc3,
  admin_supply_no_env_fallback_risk_accounts_risk_and_m_63c575dd,
  admin_supply_not_met_de49b7e4,
  admin_supply_pool_be081010,
  admin_supply_probe_accee960,
  admin_supply_provider_74dd99b7,
  admin_supply_revocable_997c6dc7,
  admin_supply_rotatable_38b89f85,
  admin_supply_rotate_drain_flow_7c63537b,
  admin_supply_three_state_spine_pending_active_retired_b81d9edd,
  admin_supply_version_history_mask_only_79b3db4a,
} from '@/locale/paraglide/messages';

/**
 * Lifecycle / drain / source words come from the projection, so the mapping is
 * on the word rather than on a colour picked at the call site — an unmapped
 * word stays neutral instead of borrowing a green it has not earned.
 */
const CREDENTIAL_VARIANT: Record<string, BadgeProps['variant']> = {
  active: 'success-light',
  pending: 'warning-light',
  retired: 'outline',
  draining: 'warning-light',
  none: 'outline',
  registry: 'secondary',
  migration: 'secondary',
  env_fallback: 'destructive-light',
};

function credentialVariant(word: string): BadgeProps['variant'] {
  return CREDENTIAL_VARIANT[word] ?? 'outline';
}

export function SupplyCredentialPanel({
  view,
}: {
  view: CredentialUiPanelView;
}) {
  return (
    <section
      data-testid="supply-credential-panel"
      data-secret-never-echoed={String(view.secretNeverEchoed)}
      data-env-fallback-risk-always-visible={String(
        view.envFallbackRiskAlwaysVisible
      )}
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">
          {admin_supply_credential_accounts_b7349a07()}
        </h2>
        <p className="text-xs text-muted-foreground">
          {admin_supply_three_state_spine_pending_active_retired_b81d9edd()}
          {view.envFallbackCount > 0
            ? admin_supply_env_fallback_risk_count({
                count: view.envFallbackCount,
              })
            : ''}
        </p>
      </header>

      {view.envFallbackCount > 0 ? (
        <Frame dense data-testid="supply-credential-env-fallback-banner">
          <FramePanel className="border-destructive/40 bg-destructive/5 text-sm">
            {admin_supply_env_var_fallback_vault_not_owning_stays_66cff880()}
          </FramePanel>
        </Frame>
      ) : (
        <Frame
          dense
          data-testid="supply-credential-env-fallback-banner"
          data-empty="true"
        >
          <FramePanel className="border-dashed text-xs text-muted-foreground">
            {admin_supply_no_env_fallback_risk_accounts_risk_and_m_63c575dd()}
          </FramePanel>
        </Frame>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {view.accounts.map((account) => (
          <Frame
            dense
            key={account.id}
            className="h-full min-w-0"
            data-testid="supply-credential-card"
            data-credential-id={account.id}
            data-status={account.status}
            data-drain={account.drainSubstate}
            data-source={account.source}
            data-env-fallback-risk={String(account.envFallbackRisk)}
          >
            <FrameHeader className="gap-2">
              <div className="flex items-start justify-between gap-2">
                <FrameTitle className="text-sm">{account.label}</FrameTitle>
                <Badge variant={credentialVariant(account.status)}>
                  {account.statusLabel}
                </Badge>
              </div>
              <FrameDescription className="font-mono text-xs">
                {account.id} · v{account.version}
              </FrameDescription>
            </FrameHeader>
            <FramePanel className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-1">
                <Badge variant={credentialVariant(account.source)}>
                  {account.sourceLabel}
                </Badge>
                <Badge variant={credentialVariant(account.drainSubstate)}>
                  {account.drainLabel}
                </Badge>
                <Badge
                  variant={
                    account.activationGate.satisfied
                      ? 'success-light'
                      : 'outline'
                  }
                  data-testid="supply-credential-activation-gate"
                  data-satisfied={String(account.activationGate.satisfied)}
                >
                  {admin_supply_activation_gate_dcec3252()}
                  {account.activationGate.satisfied
                    ? admin_supply_met_3a31adc3()
                    : admin_supply_not_met_de49b7e4()}
                </Badge>
              </div>

              <p>
                {admin_supply_provider_74dd99b7()}
                {account.providerDisplayName ?? account.providerProfileId}
              </p>
              <p>
                {admin_supply_probe_accee960()}
                {account.activationGate.probe.label}
                {account.activationGate.probe.testedAt
                  ? ` · ${account.activationGate.probe.testedAt}`
                  : ''}
              </p>
              {account.activationGate.probe.errorCode ? (
                <p className="text-destructive">
                  {admin_supply_error_code_e08c1d4f()}{' '}
                  {account.activationGate.probe.errorCode}
                </p>
              ) : null}

              <div data-testid="supply-credential-binding">
                <p className="font-medium">
                  {admin_supply_bindings_6aed7c48()}
                </p>
                <p>
                  {admin_cloudflare_deployments_3220a19f()}{' '}
                  {account.binding.deploymentIds.length}{' '}
                  {admin_supply_pool_be081010()}{' '}
                  {account.binding.poolIds.length}{' '}
                  {admin_supply_channel_1ef74839()}{' '}
                  {account.binding.executionChannelIds.length}
                </p>
              </div>

              <div data-testid="supply-credential-versions">
                <p className="font-medium">
                  {admin_supply_version_history_mask_only_79b3db4a()}
                </p>
                <ul className="list-disc pl-4">
                  {account.versionHistory.map((row) => (
                    <li key={`${account.id}-${row.version}`}>
                      {row.mask} · {row.version} · {row.source}
                    </li>
                  ))}
                </ul>
              </div>

              {account.migrationEntryVisible ? (
                <p
                  data-testid="supply-credential-migration-entry"
                  className="rounded border border-destructive/30 p-2 text-destructive"
                >
                  {account.migrationEntryLabel}
                </p>
              ) : null}

              <div data-testid="supply-credential-rotate-drain">
                <p className="font-medium">
                  {admin_supply_rotate_drain_flow_7c63537b()}
                </p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {account.rotateDrainFlow.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">
                  {admin_supply_rotatable_38b89f85()}{' '}
                  {String(account.rotateDrainFlow.canRotate)}{' '}
                  {admin_supply_activatable_92146623()}{' '}
                  {String(account.rotateDrainFlow.canActivate)}{' '}
                  {admin_supply_drainable_5931e598()}{' '}
                  {String(account.rotateDrainFlow.canStartDrain)}{' '}
                  {admin_supply_revocable_997c6dc7()}{' '}
                  {String(account.rotateDrainFlow.canRevoke)}
                </p>
              </div>
            </FramePanel>
          </Frame>
        ))}
      </div>
    </section>
  );
}

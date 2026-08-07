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
import {
  admin_capability_evidence_source_a70e1029,
  admin_supply_acceptance_branch_eaaad5e9,
  admin_supply_all_passed_3b6e5a12,
  admin_supply_cost_evidence_source_3c7deb8c,
  admin_supply_current_state_is_unknown_demo_data_fallb_9f5116b5,
  admin_supply_data_processing_level_6bb64a54,
  admin_supply_deployments_6d3c4846,
  admin_supply_evidence_freshness_bfc825d0,
  admin_supply_excluded_7b37cc8d,
  admin_supply_fail_closed_no_compliant_candidates_e9ae46a2,
  admin_supply_hard_filter_passed_75c41314,
  admin_supply_live_exclusion_6818702d,
  admin_supply_max_cost_3c9b4905,
  admin_supply_no_candidates_74869b6e,
  admin_supply_no_live_exclusions_7247dbac,
  admin_supply_no_sort_candidates_34c753a2,
  admin_supply_not_selected_reason_16e93687,
  admin_supply_risk_discount_723bd73d,
  admin_supply_route_simulation_failed_cae5523c,
  admin_supply_route_simulation_has_not_run_yet_use_the_d3367525,
  admin_supply_route_simulator_7fcad30f,
  admin_supply_shares_the_same_explanation_projection_w_cb259181,
  admin_supply_three_layer_sort_0bd6ffd5,
} from '@/locale/paraglide/messages';

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
            <p className="text-xs text-muted-foreground">
              {admin_supply_hard_filter_passed_75c41314()}
            </p>
            <p className="mt-1 font-medium">
              {view.hardFilterPassed.length}{' '}
              {admin_supply_deployments_6d3c4846()}
            </p>
            <p className="text-xs text-muted-foreground">
              {admin_supply_excluded_7b37cc8d()}{' '}
              {view.hardFilterExcluded.length}
            </p>
          </FramePanel>
        </Frame>
        <Frame dense data-testid="supply-route-max-cost">
          <FramePanel>
            <p className="text-xs text-muted-foreground">
              {admin_supply_max_cost_3c9b4905()}
            </p>
            <p className="mt-1 font-medium">
              {view.maxCost
                ? `${(view.maxCost.amountMicros / 1_000_000).toFixed(4)} ${view.maxCost.currency}`
                : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {admin_capability_evidence_source_a70e1029()}{' '}
              {view.maxCost?.evidenceSource ??
                admin_supply_no_candidates_74869b6e()}
            </p>
          </FramePanel>
        </Frame>
        <Frame dense data-testid="supply-route-acceptance">
          <FramePanel>
            <p className="text-xs text-muted-foreground">
              {admin_supply_acceptance_branch_eaaad5e9()}
            </p>
            <p className="mt-1 font-medium">{view.acceptanceBranch.decision}</p>
            <p className="text-xs text-muted-foreground">
              {view.acceptanceBranch.acceptance} ·{' '}
              {view.acceptanceBranch.reason}
            </p>
          </FramePanel>
        </Frame>
        <Frame dense data-testid="supply-route-data-level">
          <FramePanel>
            <p className="text-xs text-muted-foreground">
              {admin_supply_data_processing_level_6bb64a54()}
            </p>
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
            {admin_supply_fail_closed_no_compliant_candidates_e9ae46a2()}
            {view.failClosedReason}）
          </FramePanel>
        </Frame>
      ) : null}

      <Frame dense headingLevel={3} data-testid="supply-route-sort">
        <FrameHeader>
          <FrameTitle>{admin_supply_three_layer_sort_0bd6ffd5()}</FrameTitle>
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
              {admin_supply_no_sort_candidates_34c753a2()}
            </p>
          ) : null}
        </FramePanel>
      </Frame>

      <Frame dense headingLevel={3} data-testid="supply-route-live-exclusions">
        <FrameHeader>
          <FrameTitle>{admin_supply_live_exclusion_6818702d()}</FrameTitle>
        </FrameHeader>
        <FramePanel>
          {view.liveExclusions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {admin_supply_no_live_exclusions_7247dbac()}
            </p>
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
          <FrameTitle>{admin_supply_not_selected_reason_16e93687()}</FrameTitle>
        </FrameHeader>
        <FramePanel>
          {view.notSelectedReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {admin_supply_all_passed_3b6e5a12()}
            </p>
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
          <FrameTitle>{admin_supply_evidence_freshness_bfc825d0()}</FrameTitle>
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
          <FrameTitle>
            {admin_supply_cost_evidence_source_3c7deb8c()}
          </FrameTitle>
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
                {row.riskDiscountApplied
                  ? admin_supply_risk_discount_723bd73d()
                  : ''}
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
        <h2 className="text-base font-semibold">
          {admin_supply_route_simulator_7fcad30f()}
        </h2>
        <p className="text-xs text-muted-foreground">
          {admin_supply_shares_the_same_explanation_projection_w_cb259181()}
        </p>
      </header>

      {resolved.status === 'idle' ? (
        <Frame dense data-testid="supply-route-simulator-idle">
          <FramePanel className="border-dashed text-sm text-muted-foreground">
            {admin_supply_route_simulation_has_not_run_yet_use_the_d3367525()}
          </FramePanel>
        </Frame>
      ) : null}

      {resolved.status === 'error' ? (
        <Frame dense data-testid="supply-route-simulator-error" role="alert">
          <FramePanel className="border-destructive/40 text-sm text-destructive">
            {admin_supply_route_simulation_failed_cae5523c()}
            {resolved.message}
            {admin_supply_current_state_is_unknown_demo_data_fallb_9f5116b5()}
          </FramePanel>
        </Frame>
      ) : null}

      {resolved.status === 'ready' ? (
        <ReadyRouteSimulatorBody view={resolved.view} />
      ) : null}
    </section>
  );
}

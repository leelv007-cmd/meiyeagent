/**
 * Model supply & gateway control center shell (J4 / J5 / D-070).
 */
import { EntitlementStatusPanel } from '@/components/admin/entitlements/entitlement-status-panel';
import { SupplyAssociationViewsIndex } from '@/components/admin/supply/supply-association-views-panel';
import { SupplyCredentialPanel } from '@/components/admin/supply/supply-credential-panel';
import { SupplyGovernedActionsPanel } from '@/components/admin/supply/supply-governed-actions-panel';
import { SupplyOverviewPanel } from '@/components/admin/supply/supply-overview-panel';
import { SupplyRouteSimulatorPanel } from '@/components/admin/supply/supply-route-simulator-panel';
import { SupplyRunTable } from '@/components/admin/supply/supply-run-table';
import { SupplyTaskDrilldown } from '@/components/admin/supply/supply-task-drilldown';
import type { EntitlementStatusView } from '@/p1/admin-entitlement-status-model';
import type { CredentialUiPanelView } from '@/p1/admin-supply-credential-model';
import type { GovernedActionsPanelView } from '@/p1/admin-supply-quick-actions-model';
import type { SupplyOverviewView } from '@/p1/admin-supply-overview-model';
import type { RouteSimulatorPanelView } from '@/p1/admin-supply-route-simulator-model';
import type { SupplyRunTablePage } from '@/p1/admin-supply-run-table-model';
import type { TaskDrilldownView } from '@/p1/admin-supply-task-drilldown-model';

export function SupplyControlCenterPanel({
  overview,
  runTable,
  entitlement,
  drilldown,
  credentials,
  routeSimulator,
  governedActions,
}: {
  overview: SupplyOverviewView;
  runTable: SupplyRunTablePage;
  entitlement: EntitlementStatusView;
  /** Optional embedded drilldown when taskId is selected. */
  drilldown?: TaskDrilldownView | null;
  /** J5 CredentialAccount panel. */
  credentials?: CredentialUiPanelView | null;
  /** J5 route simulator shared explanation projection. */
  routeSimulator?: RouteSimulatorPanelView | null;
  /** J5 governed quick actions catalog. */
  governedActions?: GovernedActionsPanelView | null;
}) {
  return (
    <div
      data-testid="supply-control-center-panel"
      className="space-y-10"
    >
      <SupplyOverviewPanel view={overview} />
      <SupplyRunTable page={runTable} />
      {drilldown ? <SupplyTaskDrilldown view={drilldown} /> : null}
      {credentials ? <SupplyCredentialPanel view={credentials} /> : null}
      {routeSimulator ? (
        <SupplyRouteSimulatorPanel view={routeSimulator} />
      ) : null}
      {governedActions ? (
        <SupplyGovernedActionsPanel view={governedActions} />
      ) : null}
      <SupplyAssociationViewsIndex />
      <EntitlementStatusPanel view={entitlement} />
    </div>
  );
}

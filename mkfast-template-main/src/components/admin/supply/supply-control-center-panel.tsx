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
import type {
  GovernedActionsPanelView,
  GovernedQuickActionId,
} from '@/p1/admin-supply-quick-actions-model';
import type {
  GovernedActionDraft,
  GovernedActionExecution,
  GovernedActionReview,
  GovernedExecutionTarget,
} from '@/p1/use-admin-supply-control';
import type { SupplyOverviewView } from '@/p1/admin-supply-overview-model';
import type { LiveRouteSimulatorState } from '@/p1/admin-supply-route-simulator-model';
import type { SupplyRunTablePage } from '@/p1/admin-supply-run-table-model';
import type { SupplyRunTableUrlState } from '@/p1/admin-supply-run-table-model';
import type { TaskDrilldownView } from '@/p1/admin-supply-task-drilldown-model';

export function SupplyControlCenterPanel({
  overview,
  runTable,
  entitlement,
  drilldown,
  credentials,
  routeSimulator,
  governedActions,
  governedActionTargets,
  onPreviewGovernedAction,
  onExecuteGovernedAction,
  onRouteSimulatorUpdate,
  catalogRevisionId,
  onRunTableStateChange,
}: {
  overview: SupplyOverviewView;
  runTable: SupplyRunTablePage;
  entitlement: EntitlementStatusView;
  /** Optional embedded drilldown when taskId is selected. */
  drilldown?: TaskDrilldownView | null;
  /** J5 CredentialAccount panel. */
  credentials?: CredentialUiPanelView | null;
  /**
   * Route simulator state. Live path always passes idle/error/ready;
   * fixture path passes ready demo. Panel is always mounted when provided.
   */
  routeSimulator?: LiveRouteSimulatorState | null;
  /** J5 governed quick actions catalog. */
  governedActions?: GovernedActionsPanelView | null;
  governedActionTargets?: Partial<
    Record<GovernedQuickActionId, GovernedExecutionTarget[]>
  >;
  onPreviewGovernedAction?: (
    input: GovernedActionDraft
  ) => Promise<GovernedActionReview>;
  onExecuteGovernedAction?: (
    input: GovernedActionExecution
  ) => Promise<unknown>;
  /** Lift route_simulate Core projections into the simulator panel (F-J-02). */
  onRouteSimulatorUpdate?: (state: LiveRouteSimulatorState) => void;
  catalogRevisionId: string;
  onRunTableStateChange?: (state: SupplyRunTableUrlState) => void;
}) {
  return (
    <div
      data-testid="supply-control-center-panel"
      data-catalog-revision-id={catalogRevisionId}
      className="space-y-8"
    >
      <SupplyOverviewPanel view={overview} />
      <SupplyRunTable page={runTable} onStateChange={onRunTableStateChange} />
      {drilldown ? <SupplyTaskDrilldown view={drilldown} /> : null}
      {credentials ? <SupplyCredentialPanel view={credentials} /> : null}
      {routeSimulator ? (
        <SupplyRouteSimulatorPanel state={routeSimulator} />
      ) : null}
      {governedActions ? (
        <SupplyGovernedActionsPanel
          view={governedActions}
          targets={governedActionTargets ?? {}}
          onPreview={onPreviewGovernedAction}
          onExecute={onExecuteGovernedAction}
          onRouteSimulatorUpdate={onRouteSimulatorUpdate}
        />
      ) : null}
      <SupplyAssociationViewsIndex />
      <EntitlementStatusPanel view={entitlement} />
    </div>
  );
}

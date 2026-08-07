/**
 * Admin supply control center (J4 + J5).
 * Loads the admin supply snapshot from Core. A snapshot prop is test-only.
 */
import { useMemo, useState } from 'react';

import { SupplyAssociationViewsPanel } from '@/components/admin/supply/supply-association-views-panel';
import { SupplyControlCenterPanel } from '@/components/admin/supply/supply-control-center-panel';
import { SupplyTaskDrilldown } from '@/components/admin/supply/supply-task-drilldown';
import { buildEntitlementStatusView } from '@/p1/admin-entitlement-status-model';
import {
  buildAssociationViewPanel,
  isAssociationViewId,
  type AssociationViewId,
} from '@/p1/admin-supply-association-views-model';
import { buildCredentialUiPanel } from '@/p1/admin-supply-credential-model';
import { buildGovernedActionsPanelView } from '@/p1/admin-supply-quick-actions-model';
import {
  GOVERNED_QUICK_ACTION_IDS,
  type GovernedQuickActionId,
} from '@/p1/admin-supply-quick-actions-model';
import { buildSupplyOverviewView } from '@/p1/admin-supply-overview-model';
import {
  buildDemoRouteSimulatorPanel,
  type LiveRouteSimulatorState,
} from '@/p1/admin-supply-route-simulator-model';
import {
  DEFAULT_RUN_TABLE_URL_STATE,
  buildSupplyRunTablePage,
  parseRunTableUrlState,
  type SupplyRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';
import { buildTaskDrilldownView } from '@/p1/admin-supply-task-drilldown-model';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';
import {
  executeGovernedSupplyAction,
  previewGovernedSupplyAction,
  type GovernedActionDraft,
  type GovernedActionExecution,
  type GovernedActionReview,
  type GovernedExecutionTarget,
  useAdminSupplyControlSnapshot,
  useGovernedSupplyAction,
  useGovernedSupplyActionPreview,
} from '@/p1/use-admin-supply-control';
import {
  admin_supply_current_state_is_unknown_demo_data_fallb_9f5116b5,
  admin_supply_loading_supply_control_data_9d0fa3bd,
  admin_supply_supply_control_data_failed_to_load_c39543bf,
  admin_supply_supply_control_data_failed_to_load_ee44251e,
  admin_supply_task_not_found_4459e7ac,
} from '@/locale/paraglide/messages';

type RunTableSearchInput =
  | string
  | URLSearchParams
  | Record<string, string | null | undefined>;

export function AdminSupplyControl({
  snapshot: snapshotProp,
  runTableState,
  runTableSearch,
  onRunTableStateChange,
  taskId,
}: {
  snapshot?: SupplyControlSnapshot;
  runTableState?: SupplyRunTableUrlState;
  /** Raw search string or URLSearchParams for URL-state sync demos. */
  runTableSearch?: RunTableSearchInput;
  onRunTableStateChange?: (state: SupplyRunTableUrlState) => void;
  taskId?: string;
} = {}) {
  const resolvedRunState = useMemo(() => {
    if (runTableState) return runTableState;
    if (runTableSearch != null) {
      if (typeof runTableSearch === 'string') {
        const q = runTableSearch.startsWith('?')
          ? runTableSearch.slice(1)
          : runTableSearch;
        return parseRunTableUrlState(new URLSearchParams(q));
      }
      return parseRunTableUrlState(runTableSearch);
    }
    return taskId
      ? { ...DEFAULT_RUN_TABLE_URL_STATE, pageSize: 1, taskId }
      : DEFAULT_RUN_TABLE_URL_STATE;
  }, [runTableState, runTableSearch, taskId]);
  if (snapshotProp) {
    return (
      <AdminSupplyControlSnapshotView
        snapshot={snapshotProp}
        taskId={taskId}
        onRunTableStateChange={onRunTableStateChange}
        fixtureOnlyPanels
        onPreviewGovernedAction={previewGovernedSupplyAction}
        onExecuteGovernedAction={executeGovernedSupplyAction}
      />
    );
  }

  return (
    <LiveAdminSupplyControl
      runTableState={resolvedRunState}
      taskId={taskId}
      onRunTableStateChange={onRunTableStateChange}
    />
  );
}

function LiveAdminSupplyControl({
  runTableState,
  taskId,
  onRunTableStateChange,
}: {
  runTableState: SupplyRunTableUrlState;
  taskId?: string;
  onRunTableStateChange?: (state: SupplyRunTableUrlState) => void;
}) {
  const snapshotQuery = useAdminSupplyControlSnapshot(runTableState);
  const previewMutation = useGovernedSupplyActionPreview();
  const actionMutation = useGovernedSupplyAction();
  const snapshot = snapshotQuery.data;

  if (!snapshot) {
    if (snapshotQuery.error) {
      const message =
        snapshotQuery.error instanceof Error
          ? snapshotQuery.error.message
          : admin_supply_supply_control_data_failed_to_load_c39543bf();
      return (
        <section
          data-testid="supply-control-error"
          role="alert"
          className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
        >
          {admin_supply_supply_control_data_failed_to_load_ee44251e()}
          {message}
          {admin_supply_current_state_is_unknown_demo_data_fallb_9f5116b5()}
        </section>
      );
    }
    return (
      <output
        data-testid="supply-control-loading"
        className="text-sm text-muted-foreground"
      >
        {admin_supply_loading_supply_control_data_9d0fa3bd()}
      </output>
    );
  }

  return (
    <AdminSupplyControlSnapshotView
      snapshot={snapshot}
      taskId={taskId}
      onRunTableStateChange={onRunTableStateChange}
      onPreviewGovernedAction={(input) => previewMutation.mutateAsync(input)}
      onExecuteGovernedAction={(input) => actionMutation.mutateAsync(input)}
    />
  );
}

function AdminSupplyControlSnapshotView({
  snapshot,
  taskId,
  onRunTableStateChange,
  fixtureOnlyPanels = false,
  onPreviewGovernedAction,
  onExecuteGovernedAction,
}: {
  snapshot: SupplyControlSnapshot;
  taskId?: string;
  onRunTableStateChange?: (state: SupplyRunTableUrlState) => void;
  fixtureOnlyPanels?: boolean;
  onPreviewGovernedAction: (
    input: GovernedActionDraft
  ) => Promise<GovernedActionReview>;
  onExecuteGovernedAction: (input: GovernedActionExecution) => Promise<unknown>;
}) {
  const overview = useMemo(() => buildSupplyOverviewView(snapshot), [snapshot]);
  const runTable = useMemo(() => buildSupplyRunTablePage(snapshot), [snapshot]);
  const entitlement = useMemo(
    () => buildEntitlementStatusView({ snapshot }),
    [snapshot]
  );
  const drilldown = useMemo(
    () => (taskId ? buildTaskDrilldownView(taskId, snapshot) : null),
    [taskId, snapshot]
  );
  const credentials = useMemo(
    () =>
      buildCredentialUiPanel(snapshot, {
        now: snapshot.capturedAt,
      }),
    [snapshot]
  );
  // F-J-02: fixture keeps demo ready panel; live always shows idle/error/ready.
  const [liveRouteSimulator, setLiveRouteSimulator] =
    useState<LiveRouteSimulatorState>({ status: 'idle' });
  const routeSimulator = useMemo<LiveRouteSimulatorState>(
    () =>
      fixtureOnlyPanels
        ? { status: 'ready', view: buildDemoRouteSimulatorPanel() }
        : liveRouteSimulator,
    [fixtureOnlyPanels, liveRouteSimulator]
  );
  const governedActions = useMemo(() => buildGovernedActionsPanelView(), []);
  const governedActionTargets = useMemo(
    () => buildGovernedActionTargets(snapshot),
    [snapshot]
  );

  return (
    <SupplyControlCenterPanel
      overview={overview}
      runTable={runTable}
      entitlement={entitlement}
      drilldown={drilldown}
      credentials={credentials}
      routeSimulator={routeSimulator}
      governedActions={governedActions}
      governedActionTargets={governedActionTargets}
      onPreviewGovernedAction={onPreviewGovernedAction}
      onExecuteGovernedAction={onExecuteGovernedAction}
      onRouteSimulatorUpdate={
        fixtureOnlyPanels ? undefined : setLiveRouteSimulator
      }
      catalogRevisionId={snapshot.catalogRevisionId}
      onRunTableStateChange={onRunTableStateChange}
    />
  );
}

function buildGovernedActionTargets(
  snapshot: SupplyControlSnapshot
): Partial<Record<GovernedQuickActionId, GovernedExecutionTarget[]>> {
  const deployments = snapshot.deployments.flatMap((deployment) => {
    const operations = snapshot.models.find(
      (model) => model.id === deployment.catalogModelId
    )?.operations;
    if (!operations) return [];
    return operations.map((operation) => ({
      resourceType: 'deployment' as const,
      resourceId: deployment.id,
      label: `${deployment.id} · ${operation}`,
      expectedRevisionId: deployment.revisionId,
      operation,
      selectionId: `${deployment.id}::${operation}`,
    }));
  });
  const channels = snapshot.executionChannels.flatMap((channel) =>
    channel.lifecycleRevision
      ? [
          {
            resourceType: 'channel' as const,
            resourceId: channel.id,
            label: `${channel.id} · ${channel.kind}`,
            expectedRevisionId: channel.lifecycleRevision,
          },
        ]
      : []
  );
  const credentials = snapshot.credentials.map((credential) => ({
    resourceType: 'credential_account' as const,
    resourceId: credential.id,
    label: `${credential.label} · ${credential.status}`,
    expectedRevisionId: credential.version,
  }));
  const operations = Array.from(
    new Set(snapshot.models.flatMap((model) => model.operations))
  ).map((operation) => ({
    resourceType: 'operation' as const,
    resourceId: operation,
    label: operation,
    expectedRevisionId:
      snapshot.routePolicies.find((policy) => policy.operation === operation)
        ?.revisionId ?? snapshot.catalogRevisionId,
  }));
  const currentRoutePolicy = (
    policy: (typeof snapshot.routePolicies)[number]
  ) =>
    snapshot.routePolicies.find(
      (head) =>
        head.operation === policy.operation &&
        (head.qualityTier ?? 'quality') === (policy.qualityTier ?? 'quality')
    );
  const routePolicyTarget = (
    policy: (typeof snapshot.routePolicies)[number]
  ) => ({
    resourceType: 'route_policy' as const,
    resourceId: policy.revisionId,
    label: `${policy.operation} · ${policy.revisionId}`,
    expectedRevisionId: currentRoutePolicy(policy)?.revisionId,
    operation: policy.operation,
    qualityTier: policy.qualityTier ?? 'quality',
    routePolicy: policy,
  });
  const routePolicyRevisions = (
    snapshot.routePolicyRevisions ?? snapshot.routePolicies
  ).map(routePolicyTarget);
  const rollbackRoutePolicies = (
    snapshot.routePolicyPublicationHistory ?? snapshot.routePolicies
  )
    .filter(
      (policy) =>
        !snapshot.routePolicyPublicationHistory ||
        currentRoutePolicy(policy)?.revisionId !== policy.revisionId
    )
    .map(routePolicyTarget);
  const pools = snapshot.pools.map((pool) => ({
    resourceType: 'pool' as const,
    resourceId: pool.id,
    label: `${pool.displayName} · ${pool.kind}`,
    expectedRevisionId: pool.revisionId,
  }));

  return Object.fromEntries(
    GOVERNED_QUICK_ACTION_IDS.map((actionId) => {
      switch (actionId) {
        case 'connectivity_probe':
        case 'conformance_probe':
          return [actionId, deployments];
        case 'candidate_config_validate':
          return [actionId, routePolicyRevisions];
        case 'candidate_config_save':
          return [actionId, snapshot.routePolicies.map(routePolicyTarget)];
        case 'route_simulate':
          return [actionId, operations];
        case 'publish':
          return [actionId, routePolicyRevisions];
        case 'rollback':
          return [actionId, rollbackRoutePolicies];
        case 'credential_rotate':
        case 'pre_revoke_impact_check':
          return [actionId, credentials];
        case 'health_balance_refresh':
          return [actionId, pools];
        default:
          return [actionId, channels];
      }
    })
  );
}

export function AdminSupplyAssociationView({
  viewId,
  snapshot: snapshotProp,
}: {
  viewId: AssociationViewId | string;
  snapshot?: SupplyControlSnapshot;
}) {
  if (!snapshotProp) {
    return <LiveAdminSupplyAssociationView viewId={viewId} />;
  }
  return (
    <AdminSupplyAssociationSnapshotView
      snapshot={snapshotProp}
      viewId={viewId}
    />
  );
}

function LiveAdminSupplyAssociationView({
  viewId,
}: {
  viewId: AssociationViewId | string;
}) {
  const snapshotQuery = useAdminSupplyControlSnapshot();
  if (!snapshotQuery.data) {
    return snapshotQuery.error ? (
      <SupplyControlError error={snapshotQuery.error} />
    ) : (
      <SupplyControlLoading />
    );
  }
  return (
    <AdminSupplyAssociationSnapshotView
      snapshot={snapshotQuery.data}
      viewId={viewId}
    />
  );
}

function AdminSupplyAssociationSnapshotView({
  viewId,
  snapshot,
}: {
  viewId: AssociationViewId | string;
  snapshot: SupplyControlSnapshot;
}) {
  const resolvedId: AssociationViewId = isAssociationViewId(viewId)
    ? viewId
    : 'model';
  const panel = useMemo(
    () => buildAssociationViewPanel(resolvedId, snapshot),
    [resolvedId, snapshot]
  );
  return <SupplyAssociationViewsPanel panel={panel} />;
}

export function AdminSupplyTaskDrilldown({
  taskId,
  snapshot: snapshotProp,
}: {
  taskId: string;
  snapshot?: SupplyControlSnapshot;
}) {
  if (!snapshotProp) {
    return <LiveAdminSupplyTaskDrilldown taskId={taskId} />;
  }
  return (
    <AdminSupplyTaskSnapshotView snapshot={snapshotProp} taskId={taskId} />
  );
}

function LiveAdminSupplyTaskDrilldown({ taskId }: { taskId: string }) {
  const snapshotQuery = useAdminSupplyControlSnapshot({
    ...DEFAULT_RUN_TABLE_URL_STATE,
    pageSize: 1,
    taskId,
  });
  if (!snapshotQuery.data) {
    return snapshotQuery.error ? (
      <SupplyControlError error={snapshotQuery.error} />
    ) : (
      <SupplyControlLoading />
    );
  }
  return (
    <AdminSupplyTaskSnapshotView
      snapshot={snapshotQuery.data}
      taskId={taskId}
    />
  );
}

function AdminSupplyTaskSnapshotView({
  taskId,
  snapshot,
}: {
  taskId: string;
  snapshot: SupplyControlSnapshot;
}) {
  const view = useMemo(
    () => buildTaskDrilldownView(taskId, snapshot),
    [taskId, snapshot]
  );
  if (!view) {
    return (
      <p data-testid="supply-task-not-found" className="text-sm">
        {admin_supply_task_not_found_4459e7ac()} {taskId}
      </p>
    );
  }
  return <SupplyTaskDrilldown view={view} />;
}

function SupplyControlLoading() {
  return (
    <output
      data-testid="supply-control-loading"
      className="text-sm text-muted-foreground"
    >
      {admin_supply_loading_supply_control_data_9d0fa3bd()}
    </output>
  );
}

function SupplyControlError({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : admin_supply_supply_control_data_failed_to_load_c39543bf();
  return (
    <section
      data-testid="supply-control-error"
      role="alert"
      className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
    >
      {admin_supply_supply_control_data_failed_to_load_ee44251e()}
      {message}
      {admin_supply_current_state_is_unknown_demo_data_fallb_9f5116b5()}
    </section>
  );
}

/**
 * Admin supply control center (J4 + J5).
 * Pure presentation from fixtures until Z2 wires live Core endpoints.
 */
import { useMemo } from 'react';

import { SupplyAssociationViewsPanel } from '@/components/admin/supply/supply-association-views-panel';
import { SupplyControlCenterPanel } from '@/components/admin/supply/supply-control-center-panel';
import { SupplyTaskDrilldown } from '@/components/admin/supply/supply-task-drilldown';
import { buildEntitlementStatusView } from '@/p1/admin-entitlement-status-model';
import {
  buildAssociationViewPanel,
  isAssociationViewId,
  type AssociationViewId,
} from '@/p1/admin-supply-association-views-model';
import {
  buildCredentialUiPanel,
  type CredentialAccountUiEnrichment,
} from '@/p1/admin-supply-credential-model';
import { buildDefaultSupplyControlSnapshot } from '@/p1/admin-supply-fixture';
import { buildGovernedActionsPanelView } from '@/p1/admin-supply-quick-actions-model';
import { buildSupplyOverviewView } from '@/p1/admin-supply-overview-model';
import { buildDemoRouteSimulatorPanel } from '@/p1/admin-supply-route-simulator-model';
import {
  DEFAULT_RUN_TABLE_URL_STATE,
  buildSupplyRunTablePage,
  parseRunTableUrlState,
  type SupplyRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';
import { buildTaskDrilldownView } from '@/p1/admin-supply-task-drilldown-model';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';

const DEFAULT_CREDENTIAL_ENRICHMENTS = new Map<
  string,
  CredentialAccountUiEnrichment
>([
  [
    'cred-provider-ark',
    {
      testStatus: 'passed',
      testedAt: '2026-07-20T08:00:00.000Z',
      evidenceRef: 'test://ark/v3/2026-07-20',
      mask: '••••••••',
      versionHistory: [
        {
          version: 'v2',
          mask: '••••••••',
          createdAt: '2026-06-01T00:00:00.000Z',
          source: 'registry',
        },
        {
          version: 'v3',
          mask: '••••••••',
          createdAt: '2026-07-18T00:00:00.000Z',
          source: 'registry',
        },
      ],
    },
  ],
  [
    'cred-provider-tuzi',
    {
      testStatus: 'passed',
      testedAt: '2026-07-20T08:00:00.000Z',
      evidenceRef: 'test://tuzi/v2/2026-07-20',
      mask: '••••••••',
    },
  ],
  [
    'cred-provider-openai',
    {
      testStatus: 'pending',
      mask: '••••••••',
    },
  ],
]);

export function AdminSupplyControl({
  snapshot: snapshotProp,
  runTableState,
  runTableSearch,
  taskId,
}: {
  snapshot?: SupplyControlSnapshot;
  runTableState?: SupplyRunTableUrlState;
  /** Raw search string or URLSearchParams for URL-state sync demos. */
  runTableSearch?: string | URLSearchParams | Record<string, string | null | undefined>;
  taskId?: string;
} = {}) {
  const snapshot = useMemo(
    () => snapshotProp ?? buildDefaultSupplyControlSnapshot(),
    [snapshotProp],
  );

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
    return DEFAULT_RUN_TABLE_URL_STATE;
  }, [runTableState, runTableSearch]);

  const overview = useMemo(
    () => buildSupplyOverviewView(snapshot),
    [snapshot],
  );
  const runTable = useMemo(
    () => buildSupplyRunTablePage(snapshot, resolvedRunState),
    [snapshot, resolvedRunState],
  );
  const entitlement = useMemo(
    () => buildEntitlementStatusView({ snapshot }),
    [snapshot],
  );
  const drilldown = useMemo(
    () => (taskId ? buildTaskDrilldownView(taskId, snapshot) : null),
    [taskId, snapshot],
  );
  const credentials = useMemo(
    () =>
      buildCredentialUiPanel(snapshot, {
        enrichments: DEFAULT_CREDENTIAL_ENRICHMENTS,
        now: '2026-07-20T12:00:00.000Z',
      }),
    [snapshot],
  );
  const routeSimulator = useMemo(() => buildDemoRouteSimulatorPanel(), []);
  const governedActions = useMemo(() => buildGovernedActionsPanelView(), []);

  return (
    <SupplyControlCenterPanel
      overview={overview}
      runTable={runTable}
      entitlement={entitlement}
      drilldown={drilldown}
      credentials={credentials}
      routeSimulator={routeSimulator}
      governedActions={governedActions}
    />
  );
}

export function AdminSupplyAssociationView({
  viewId,
  snapshot: snapshotProp,
}: {
  viewId: AssociationViewId | string;
  snapshot?: SupplyControlSnapshot;
}) {
  const snapshot = useMemo(
    () => snapshotProp ?? buildDefaultSupplyControlSnapshot(),
    [snapshotProp],
  );
  const resolvedId: AssociationViewId = isAssociationViewId(viewId)
    ? viewId
    : 'model';
  const panel = useMemo(
    () => buildAssociationViewPanel(resolvedId, snapshot),
    [resolvedId, snapshot],
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
  const snapshot = useMemo(
    () => snapshotProp ?? buildDefaultSupplyControlSnapshot(),
    [snapshotProp],
  );
  const view = useMemo(
    () => buildTaskDrilldownView(taskId, snapshot),
    [taskId, snapshot],
  );
  if (!view) {
    return (
      <p data-testid="supply-task-not-found" className="text-sm">
        未找到任务 {taskId}
      </p>
    );
  }
  return <SupplyTaskDrilldown view={view} />;
}

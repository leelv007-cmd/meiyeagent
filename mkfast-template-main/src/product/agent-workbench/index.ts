/**
 * Agent Workbench foundation (V31-04/05): event reducer, Workstream,
 * Controlled Surface Registry, Thread-root host. Layout: V3.1 §28.3.
 */

export {
  applyLiveSemanticEvent,
  reconnectAgentWorkbench,
  type AgentReplayLoader,
  type AgentReplayPackage,
  type LiveApplyResult,
} from './agent-event-client';

export {
  createEmptyAgentWorkbenchState,
  isActivityVisible,
  projectVisibleActivities,
  projectVisibleNarratives,
  reduceAgentWorkbench,
  type AgentActivity,
  type AgentActivityStatus,
  type AgentConnectionState,
  type AgentWorkbenchAction,
  type AgentWorkbenchClientState,
  type ArtifactProjection,
  type ClientSnapshotCursor,
  type InterruptProjection,
  type NarrativeMessage,
  type ReduceResult,
  type WorkbenchSessionProjection,
} from './agent-event-reducer';

export {
  __resetAgentWorkbenchHostStoreForTests,
  createAgentEventStore,
  getAgentWorkbenchHostStore,
  useAgentWorkbenchDispatch,
  useAgentWorkbenchState,
  type AgentEventStore,
} from './agent-event-store';

export {
  AgentWorkbenchHost,
  type AgentWorkbenchHostProps,
  type AgentWorkbenchSessionLoader,
} from './agent-workbench';

export {
  resolveDashboardThreadTarget,
  threadDashboardHref,
  workbenchRootMode,
  type ThreadListItem,
  type ThreadListResponse,
  type WorkbenchResolveSource,
  type WorkbenchSessionResolveResponse,
} from './thread-session';

export {
  AgentWorkstream,
  MobileProcessWorksSwitch,
  type AgentWorkstreamProps,
  type MobileProcessWorksSwitchProps,
} from './agent-workstream';

export {
  __resetControlledSurfaceRegistryForTests,
  AGENT_FOUNDATION_SURFACE_KEYS,
  isSurfaceRequestRejected,
  listRegisteredSurfaces,
  registerAgentSurface,
  resolveControlledSurface,
  type AgentFoundationSurfaceKey,
  type AgentSurfaceKey,
  type ControlledSurfaceReject,
  type ControlledSurfaceRequest,
  type ControlledSurfaceResult,
  type SurfaceRegistration,
  type SurfaceRejectReason,
} from './controlled-surface-registry';

export {
  resolveMobileWorkstreamLayout,
  toggleMobileWorkstreamPane,
  WORKSTREAM_MOBILE_PANE_LABELS,
  type MobileWorkstreamLayout,
  type WorkstreamMobilePane,
} from './mobile-workstream-switch';

export { ActivityLine, type ActivityLineProps } from './stream/activity-line';
export { NarrativeLine, type NarrativeLineProps } from './stream/narrative-line';

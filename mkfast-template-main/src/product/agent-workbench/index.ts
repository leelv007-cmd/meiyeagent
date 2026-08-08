/**
 * Agent Workbench foundation (V31-04 + V31-10 Living Plan): event reducer,
 * Workstream, Controlled Surface Registry, plan surfaces. Layout: V3.1 §28.3.
 */

import { registerPlanSurfaces } from './plan/register-plan-surfaces';

// Side-effect import: production consumers of the barrel get plan surfaces.
registerPlanSurfaces();

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
  projectActivePlanRevisions,
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
  type PlanProjectionState,
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
} from './agent-workbench';

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
export {
  NarrativeLine,
  type NarrativeLineProps,
} from './stream/narrative-line';

export {
  AGENT_PLAN_SURFACE_KEYS,
  CommitStrip,
  CompactPlan,
  LivingPlan,
  PlanDiff,
  PlanSection,
  __resetPlanSurfaceRegistrationForTests,
  commitStripInputFromPlanFacts,
  diffLivingPlanFacts,
  diffLivingPlanViews,
  livingPlanFactsFromRevision,
  parseLivingPlanEventPayload,
  projectCommitStrip,
  projectLivingPlanView,
  registerPlanSurfaces,
  type AgentPlanSurfaceKey,
  type CommitStripAction,
  type CommitStripView,
  type LivingPlanRevisionFacts,
  type LivingPlanView,
  type PlanDiffView,
} from './plan';

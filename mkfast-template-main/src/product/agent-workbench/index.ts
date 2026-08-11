/**
 * Agent Workbench foundation (V31-04/05) + Artifact protocol (V31-15)
 * + Living Plan (V31-10): event reducer, Workstream, Controlled Surface
 * Registry, Thread-root host, Artifact canvas, plan surfaces. Layout: V3.1 §28.3.
 */

export {
  applyLiveSemanticEvent,
  reconnectAgentWorkbench,
  type AgentReplayLoader,
  type AgentReplayPackage,
  type LiveApplyResult,
} from './agent-event-client';

export {
  loadAgentWorkbenchReplay,
  subscribeAgentSemanticEvents,
  type AgentLiveSubscriber,
} from './agent-event-transport';

export {
  createEmptyAgentWorkbenchState,
  isActivityVisible,
  measureArtifactDuplicateObjectRate,
  projectActivePlanRevisions,
  projectVisibleActivities,
  projectVisibleArtifacts,
  projectVisibleNarratives,
  reduceAgentWorkbench,
  resolveArtifactViewBody,
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
  type AgentWorkbenchSessionLoader,
} from './agent-workbench';

export {
  IdleGoalProactivePanel,
  type IdleGoalProactiveLoader,
  type IdleGoalProactivePanelProps,
  type IdleGoalProactiveProjection,
  type IdlePrimaryGoal,
  type IdleProactiveSuggestion,
} from './idle-goal-proactive';

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
export {
  NarrativeLine,
  type NarrativeLineProps,
} from './stream/narrative-line';

export {
  ArtifactCanvas,
  ArtifactMobileSheet,
  CopyArtifact,
  NoteArtifact,
  PublishArtifact,
  VideoArtifact,
  type ArtifactCanvasProps,
  type ArtifactMobileSheetProps,
  type CopyArtifactProps,
  type NoteArtifactProps,
  type PublishArtifactProps,
  type VideoArtifactProps,
} from './artifact';
export {
  CommitStrip,
  CompactPlan,
  LivingPlan,
  PlanDiff,
  PlanSection,
  commitStripInputFromPlanFacts,
  diffLivingPlanFacts,
  diffLivingPlanViews,
  livingPlanFactsFromRevision,
  parseLivingPlanEventPayload,
  projectCommitStrip,
  projectLivingPlanView,
  type CommitStripAction,
  type CommitStripView,
  type LivingPlanRevisionFacts,
  type LivingPlanView,
  type PlanDiffView,
} from './plan';

export {
  PublishHandoffPanel,
  evaluateDrivenPublishFromQr,
  panelViewFromPublishHandoff,
  projectPublishHandoffPanel,
  SELF_REPORT_CHIP_LABEL,
  usePublishHandoff,
  type PublishHandoffPanelFacts,
  type PublishHandoffPanelProps,
  type PublishHandoffPanelView,
  type UsePublishHandoffInput,
  type UsePublishHandoffResult,
} from './publish-handoff';

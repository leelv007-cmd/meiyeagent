/**
 * Living Plan UI barrel (V31-10).
 */

export {
  CommitStrip,
  type CommitStripProps,
} from './commit-strip';
export {
  commitStripInputFromPlanFacts,
  projectCommitStrip,
  type CommitStripAction,
  type CommitStripInput,
  type CommitStripView,
} from './commit-strip-model';
export {
  CompactPlan,
  type CompactPlanProps,
} from './compact-plan';
export {
  LivingPlan,
  type LivingPlanProps,
} from './living-plan';
export {
  LIVING_PLAN_SECTION_KEYS,
  LIVING_PLAN_SECTION_TITLES,
  deliverableKindLabel,
  formatDeliverableLine,
  livingPlanFactsFromRevision,
  parseLivingPlanEventPayload,
  projectLivingPlanView,
  type LivingPlanBillingFacts,
  type LivingPlanRevisionFacts,
  type LivingPlanSectionKey,
  type LivingPlanSectionRow,
  type LivingPlanSectionView,
  type LivingPlanView,
} from './living-plan-model';
export { PlanDiff, type PlanDiffProps } from './plan-diff';
export {
  diffLivingPlanFacts,
  diffLivingPlanViews,
  type PlanDiffChangeKind,
  type PlanDiffEntry,
  type PlanDiffView,
} from './plan-diff-model';
export { PlanSection, type PlanSectionProps } from './plan-section';
export {
  AGENT_PLAN_SURFACE_KEYS,
  __resetPlanSurfaceRegistrationForTests,
  registerPlanSurfaces,
  type AgentPlanSurfaceKey,
} from './register-plan-surfaces';

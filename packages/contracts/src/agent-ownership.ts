/**
 * Canonical ownership matrix for Agent + platform semantic facts (V3.1 §7.1).
 *
 * Rule: one writer per semantic fact. Multiple domain truths may coexist;
 * dual writers for the same semantic are forbidden.
 *
 * This module is documentation-as-code for V31-01. Runtime enforcement lands
 * with domain services; constructive tests here reject double-writer matrices.
 */

export const AGENT_SEMANTIC_FACTS = [
  'business_fact',
  'asset_rights',
  'agent_thread',
  'marketing_goal',
  'agent_memory',
  'work_task',
  'dbos_workflow_state',
  'marketing_plan_revision',
  'content_package',
  'provider_route_cost',
  'usage_ledger',
  'delivery_receipt',
  'outcome_evidence',
  'harness_release',
  'ui_controlled_surface',
  'agent_run',
  'agent_semantic_event_stream_offset',
  'execution_plan_snapshot',
  'plan_confirmation_decision',
  'steering_command',
  'harness_release_lifecycle',
  'harness_release_rollout',
] as const;

export type AgentSemanticFact = (typeof AGENT_SEMANTIC_FACTS)[number];

/**
 * Canonical writer modules / domains. Names are stable contract vocabulary,
 * not TypeScript class paths.
 */
export const AGENT_CANONICAL_WRITERS = [
  'BusinessFactDomain',
  'AssetRightsDomain',
  'AgentThreadStore',
  'MarketingGoalStore',
  'AgentMemoryPlatform',
  'WorkTaskDomain',
  'DbosWorkflowRuntime',
  'PlanCompiler',
  'ContentPackageDomain',
  'RouteProviderCostLedger',
  'UsageLedger',
  'DeliveryReceiptDomain',
  'OutcomeEvidenceManualContract',
  'HarnessReleasePublish',
  'ControlledSurfaceRegistry',
  'AgentRunStore',
  'AgentSemanticEventProjector',
  'ExecutionPlanSnapshotAdmission',
  'PlanConfirmationDecisionStore',
  'SteeringCommandStore',
  'HarnessReleaseLifecycleStore',
  'HarnessReleaseRolloutStore',
] as const;

export type AgentCanonicalWriter = (typeof AGENT_CANONICAL_WRITERS)[number];

export type CanonicalOwnershipEntry = {
  readonly semanticFact: AgentSemanticFact;
  readonly writer: AgentCanonicalWriter;
  /** Short product/domain note; not a second writer. */
  readonly note: string;
};

/**
 * Documented one-writer map (V3.1 §7.1 + V3.1 agent-domain extensions).
 * Order is stable for constructive uniqueness tests.
 */
export const AGENT_CANONICAL_OWNERSHIP_MATRIX = Object.freeze([
  {
    semanticFact: 'business_fact',
    writer: 'BusinessFactDomain',
    note: 'Store facts, prices, campaigns — never Memory or Agent.',
  },
  {
    semanticFact: 'asset_rights',
    writer: 'AssetRightsDomain',
    note: 'Asset + rights grant/revocation authority.',
  },
  {
    semanticFact: 'agent_thread',
    writer: 'AgentThreadStore',
    note: 'Long-lived session container; sessionRevision OCC writer.',
  },
  {
    semanticFact: 'marketing_goal',
    writer: 'MarketingGoalStore',
    note: 'Long-horizon marketing goals; agent may only propose.',
  },
  {
    semanticFact: 'agent_memory',
    writer: 'AgentMemoryPlatform',
    note: 'Preference/correction ledger + working via thread checkpoint.',
  },
  {
    semanticFact: 'work_task',
    writer: 'WorkTaskDomain',
    note: 'One execution work/task aggregate.',
  },
  {
    semanticFact: 'dbos_workflow_state',
    writer: 'DbosWorkflowRuntime',
    note: 'Durable side-effect state; sole durable runtime.',
  },
  {
    semanticFact: 'marketing_plan_revision',
    writer: 'PlanCompiler',
    note: 'Append-only plan revisions; readiness is projection only.',
  },
  {
    semanticFact: 'content_package',
    writer: 'ContentPackageDomain',
    note: 'Finished deliverable aggregate.',
  },
  {
    semanticFact: 'provider_route_cost',
    writer: 'RouteProviderCostLedger',
    note: 'Provider attempt + upstream cost; dual-truth vs merchant credits.',
  },
  {
    semanticFact: 'usage_ledger',
    writer: 'UsageLedger',
    note: 'Merchant credit ledger (P1 GrantLot FEFO).',
  },
  {
    semanticFact: 'delivery_receipt',
    writer: 'DeliveryReceiptDomain',
    note: 'External delivery outcomes.',
  },
  {
    semanticFact: 'outcome_evidence',
    writer: 'OutcomeEvidenceManualContract',
    note: 'Canonical write = manual outcome contract extension (MAJOR-13).',
  },
  {
    semanticFact: 'harness_release',
    writer: 'HarnessReleasePublish',
    note: 'Immutable HarnessReleaseArtifact + manifestHash.',
  },
  {
    semanticFact: 'ui_controlled_surface',
    writer: 'ControlledSurfaceRegistry',
    note: 'Registered UI surfaces only; reject arbitrary components.',
  },
  {
    semanticFact: 'agent_run',
    writer: 'AgentRunStore',
    note: 'Operational run record; durability immutable after create.',
  },
  {
    semanticFact: 'agent_semantic_event_stream_offset',
    writer: 'AgentSemanticEventProjector',
    note: 'Per-thread monotonic streamOffset assignment.',
  },
  {
    semanticFact: 'execution_plan_snapshot',
    writer: 'ExecutionPlanSnapshotAdmission',
    note: 'Frozen Session→Make handoff; one-shot task-admission write.',
  },
  {
    semanticFact: 'plan_confirmation_decision',
    writer: 'PlanConfirmationDecisionStore',
    note: 'Immutable merchant confirm/reject decision.',
  },
  {
    semanticFact: 'steering_command',
    writer: 'SteeringCommandStore',
    note: 'Append-only mid-run steering commands.',
  },
  {
    semanticFact: 'harness_release_lifecycle',
    writer: 'HarnessReleaseLifecycleStore',
    note: 'draft/evaluating/canary/production/retired transitions only.',
  },
  {
    semanticFact: 'harness_release_rollout',
    writer: 'HarnessReleaseRolloutStore',
    note: 'Workspace allowlist / canary axes; separate from artifact.',
  },
] as const satisfies readonly CanonicalOwnershipEntry[]);

export type AgentCanonicalOwnershipMatrix =
  typeof AGENT_CANONICAL_OWNERSHIP_MATRIX;

/**
 * Returns semantic facts that appear more than once (dual-writer smell).
 * Empty array means the matrix is constructively single-writer.
 */
export function findDuplicateSemanticFactWriters(
  matrix: readonly CanonicalOwnershipEntry[] = AGENT_CANONICAL_OWNERSHIP_MATRIX,
): AgentSemanticFact[] {
  const counts = new Map<AgentSemanticFact, number>();
  for (const entry of matrix) {
    counts.set(entry.semanticFact, (counts.get(entry.semanticFact) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([fact]) => fact);
}

/**
 * Returns writers claimed by more than one semantic fact.
 * Not always illegal (one store may own related facts), but flagged for review.
 * For V31-01 we require one entry per semantic fact only.
 */
export function listOwnershipWriters(
  matrix: readonly CanonicalOwnershipEntry[] = AGENT_CANONICAL_OWNERSHIP_MATRIX,
): AgentCanonicalWriter[] {
  return matrix.map((entry) => entry.writer);
}

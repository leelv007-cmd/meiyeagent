import type { HarnessStage } from '@meiye/contracts';

import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';
import type { SkillFrontmatter } from './skill-format.js';

export const SKILL_BINDING_MODES = [
  'required',
  'user_selected',
  'disabled',
] as const;

export type SkillBindingMode = (typeof SKILL_BINDING_MODES)[number];
export type SkillExecutionMode =
  | 'provider_native'
  | 'harness_native'
  | 'prompt_materialized';

export interface SkillTriggerCondition {
  harnessStage: HarnessStage;
  industryCategory?: string | null;
  tenantId?: string | null;
}

/**
 * Where a Skill came from. The operator catalog surfaces this as a column, and
 * the "share of industry-tier entries with a second corroborating source"
 * metric is computed from it — the number only exists if the field is stored,
 * so this is a governance field rather than display metadata.
 */
export const SKILL_SOURCE_KINDS = [
  'harvested',
  'authored',
  'induced',
] as const;

export type SkillSourceKind = (typeof SKILL_SOURCE_KINDS)[number];

/** Which layer a Skill belongs to. Lower tiers override higher ones. */
export const SKILL_TIERS = ['platform', 'industry', 'store'] as const;

export type SkillTier = (typeof SKILL_TIERS)[number];

/** Provenance for a harvested Skill, so a translation stays auditable. */
export interface SkillSourceRef {
  externalUrl?: string;
  harvestedAt?: string;
}

export interface SkillCatalog {
  skillId: string;
  name: string;
  /**
   * Operator-facing one-liner, required on the catalog page: it is how an
   * operator recognises what a Skill does. Authoring lives in the standard
   * frontmatter; this is the catalog projection of it.
   */
  description: string;
  sourceKind: SkillSourceKind;
  tier: SkillTier;
  sourceRef?: SkillSourceRef;
  presentationPolicy: 'backend_only' | 'explainable' | 'user_selectable';
  activeRevisionRef: string | null;
  publicationGeneration: number;
  createdAt: string;
  updatedAt: string;
  actorId: string;
}

export const SKILL_GOVERNANCE_PATCH_FIELDS = [
  'acceptedAt',
  'acceptedBy',
  'activeRevisionRef',
  'contentHash',
  'createdAt',
  'createdBy',
  'evalRunId',
  'governance.budget.maxChildEffects',
  'governance.budget.maxCostCents',
  'governance.budget.timeoutMs',
  'governance.contextScopes',
  'governance.executionMode',
  'governance.fallback',
  'governance.inputSchemaRef',
  'governance.outputSchemaRef',
  'governance.requiredModelCapabilities',
  'governance.sideEffectClass',
  'governance.workflowRevisionRefs',
  'instruction',
  'manifest.allowed-tools',
  'manifest.compatibility',
  'manifest.description',
  'manifest.license',
  'manifest.metadata',
  'manifest.name',
  'packagePaths',
  'prompt.content',
  'prompt.contentHash',
  'prompt.fallbackReason',
  'prompt.isFallback',
  'prompt.label',
  'prompt.name',
  'prompt.source',
  'prompt.version',
  'revision',
  'skillId',
  'skillRevisionRef',
  'sourceKind',
  'status',
  'tier',
] as const;

export type SkillGovernancePatchField =
  (typeof SKILL_GOVERNANCE_PATCH_FIELDS)[number];

export const SKILL_OPERATOR_EDITABLE_FIELDS = [
  'instruction',
  'manifest.description',
] as const satisfies readonly SkillGovernancePatchField[];

export type SkillOperatorEditableField =
  (typeof SKILL_OPERATOR_EDITABLE_FIELDS)[number];

export type SkillGovernanceValidationResult = {
  fieldPath: string;
  status: 'applied' | 'stripped' | 'not_applied';
  reasonCode:
    | 'field_applied'
    | 'field_not_editable'
    | 'invalid_value'
    | 'unchanged'
    | 'cas_conflict'
    | 'dependency_blocked'
    | 'governance_cancelled';
};

export type SkillGovernanceResult = {
  runId: string;
  success: true;
  applied: boolean;
  validationResults: SkillGovernanceValidationResult[];
};

export type SkillGovernanceAuditEntry = {
  runId: string;
  skillId: string;
  targetSkillRevisionRef: string;
  workspaceId: string;
  actorId: string;
  fieldPath: string;
  status: SkillGovernanceValidationResult['status'];
  reasonCode: SkillGovernanceValidationResult['reasonCode'];
  createdAt: string;
};

export type SkillGovernanceRun = {
  runId: string;
  inputFingerprint: string;
  skillId: string;
  baseSkillRevisionRef: string;
  draftSkillRevisionRef: string | null;
  workspaceId: string;
  actorId: string;
  status: 'completed';
  result: SkillGovernanceResult;
  auditEntries: SkillGovernanceAuditEntry[];
  createdAt: string;
  completedAt: string;
};

export type SkillGovernanceReservation = {
  runId: string;
  inputFingerprint: string;
  skillId: string;
  baseSkillRevisionRef: string;
  workspaceId: string;
  actorId: string;
  createdAt: string;
};

export type SkillRevisionManifest = SkillFrontmatter;

export interface LegacySkillGovernanceSidecar
  extends SkillGovernanceSidecar {
  allowedTools: string[];
}

export interface LegacySkillRevisionManifest
  extends Omit<LegacySkillGovernanceSidecar, 'workflowRevisionRefs'> {
  evalSuiteRef: string;
  compatibility: {
    workflowRevisionRefs: string[];
  };
}

export interface SkillGovernanceSidecar {
  inputSchemaRef: string;
  outputSchemaRef: string;
  contextScopes: string[];
  sideEffectClass: 'none' | 'read' | 'bounded_write';
  requiredModelCapabilities: string[];
  executionMode: SkillExecutionMode;
  budget: {
    maxChildEffects: number;
    maxCostCents: number;
    timeoutMs: number;
  };
  workflowRevisionRefs: string[];
  fallback: 'skip' | 'fail_closed';
}

export interface SkillPromptReference {
  name: string;
  version: string;
  contentHash: string;
}

export interface SkillPromptSnapshot extends SkillPromptReference {
  readonly content: string;
  label: string;
  source: 'langfuse' | 'builtin';
  isFallback: boolean;
  fallbackReason?: string;
}

export interface SkillPromptSnapshotPort {
  capture(reference: SkillPromptReference): Promise<HarnessFrozenPrompt>;
  reference?(slot: 'intentNaming'): Promise<HarnessFrozenPrompt>;
}

export class SkillPromptAuthorityUnavailableError extends Error {
  constructor(message = 'Skill prompt authority is unavailable.') {
    super(message);
    this.name = 'SkillPromptAuthorityUnavailableError';
  }
}

interface SkillRevisionBase<
  Governance extends SkillGovernanceSidecar,
> {
  skillId: string;
  revision: number;
  skillRevisionRef: string;
  contentHash: string;
  instruction: string;
  governance: Governance;
  prompt: SkillPromptSnapshot;
  status: 'draft' | 'accepted_frozen' | 'retired';
  createdAt: string;
  createdBy: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  evalRunId: string | null;
}

export type SkillRevision =
  | (SkillRevisionBase<SkillGovernanceSidecar> & {
      formatVersion: 2;
      manifest: SkillRevisionManifest;
      packagePaths: string[];
    })
  | (SkillRevisionBase<LegacySkillGovernanceSidecar> & {
      formatVersion: 1;
      manifest: SkillRevisionManifest | LegacySkillRevisionManifest;
      packagePaths?: string[];
    });

export interface SkillBinding {
  bindingId: string;
  workflowRevisionRef: string;
  triggerCondition: SkillTriggerCondition;
  /** Trusted consumer owner. Missing legacy values fail closed as unknown. */
  ownerWorkspaceId?: string | null;
  skillId: string;
  skillRevisionRef: string;
  mode: SkillBindingMode;
  status: 'active' | 'superseded';
  supersededAt: string | null;
  supersededByBindingId: string | null;
  createdAt: string;
}

export type AuditedSkillBinding = Omit<SkillBinding, 'mode'> & {
  mode: SkillBindingMode | 'planner_selected';
};

export interface SkillDeployment {
  deploymentId: string;
  skillRevisionRef: string;
  provider: string;
  channel: string;
  nativeSkillId: string;
  nativeVersion: string;
  executionMode: SkillExecutionMode;
  packagePaths: string[];
  rolloutEvidenceRef: string | null;
  createdAt: string;
}

export const SKILL_REFERENCE_CONSUMER_KINDS = [
  'published_lifecycle',
  'workflow_binding',
  'recipe_revision',
  'deployment',
  'eval_run',
  'governance_run',
  'invocation_receipt',
  'traffic_target',
] as const;

export type SkillReferenceConsumerKind =
  (typeof SKILL_REFERENCE_CONSUMER_KINDS)[number];

export type SkillReferenceScope =
  | { kind: 'workspace'; workspaceId: string }
  | {
      kind: 'global';
      proof:
        | 'platform_catalog'
        | 'industry_catalog'
        | 'system_binding'
        | 'deployment'
        | 'evaluation'
        | 'recipe_catalog';
    }
  | { kind: 'unknown' };

export interface SkillReferenceEdge {
  edgeId: string;
  targetSkillRevisionRef: string;
  consumerKind: SkillReferenceConsumerKind;
  consumerId: string;
  consumerLabel: string;
  scope: SkillReferenceScope;
  createdAt: string;
}

export interface SkillReverseDependencyDetail {
  consumerKind: SkillReferenceConsumerKind;
  consumerId: string;
  consumerLabel: string;
  scopeKind: 'workspace' | 'global';
}

export interface SkillReverseDependencyView {
  targetSkillRevisionRef: string;
  visibleDependencies: SkillReverseDependencyDetail[];
  hiddenCount: number;
  blocked: boolean;
}

export interface ResolvedSkillInstruction {
  skillRevisionRef: string;
  instruction: string;
  contentHash: string;
  /** Frozen declarative requirements from the accepted Skill governance sidecar. */
  requiredModelCapabilities: string[];
  executionMode: SkillExecutionMode;
  prompt?: SkillPromptReference & {
    isFallback: boolean;
    fallbackReason?: string;
  };
  /** Internal execution material; never expose through admin or audit responses. */
  promptContent?: string;
}

export interface SkillInvocationReceipt {
  invocationId: string;
  workspaceId: string;
  taskId: string;
  productUsageTaskId: string;
  skillRevisionRef: string;
  childEffectIds: string[];
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  status: 'settled';
  createdAt: string;
  inputFingerprint: string;
  prompt?: SkillPromptReference & {
    isFallback: boolean;
    fallbackReason?: string;
  };
  output?: SkillInvocationResult;
}

export interface SkillInvocationOutputDescriptor {
  target: 'workflow_artifact' | 'content_package';
  schemaRevision: string;
}

export interface SkillInvocationRequest {
  invocationId: string;
  workspaceId: string;
  taskId: string;
  productUsageTaskId: string;
  skillRevisionRef: string;
  input: unknown;
  calls: Array<{
    callId: string;
    toolId: string;
    contextRefs: string[];
    declaredBudgetCapCents: number;
    payload: unknown;
  }>;
  output: SkillInvocationOutputDescriptor;
}

export interface SkillInvocationResult {
  invocationId: string;
  target: 'workflow_artifact';
  schemaRevision: string;
  value: unknown;
  createdAt: string;
}

export interface SkillInvocationExecution extends SkillInvocationReceipt {
  selected: ResolvedSkillInstruction[];
  output: SkillInvocationResult;
}

export interface SkillChildEffect {
  effectId: string;
  invocationId: string;
  idempotencyKey: string;
  fingerprint: string;
  toolId: string;
  contextRefs: string[];
  /**
   * Validation ceiling declared by the caller. This is not a billing
   * reservation; a real reservation awaits the first billed production caller.
   */
  declaredBudgetCapCents: number;
  providerReceipt: {
    providerTaskRef: string;
    accepted: boolean;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  costCents: number;
  settlementStatus: 'settled' | 'over_budget';
  retryStatus: 'first_attempt' | 'replayed';
  acceptanceStatus: 'accepted' | 'rejected_before_accept' | 'rejected';
  createdAt: string;
}

export interface SkillChildEffectExecutorInput {
  callId: string;
  idempotencyKey: string;
  toolId: string;
  contextRefs: string[];
  payload: unknown;
}

export interface SkillChildEffectExecutor {
  execute(input: SkillChildEffectExecutorInput): Promise<{
    providerReceipt: {
      providerTaskRef: string;
      accepted: boolean;
    };
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
    costCents: number;
    acceptanceStatus: 'accepted' | 'rejected_before_accept';
  }>;
}

export interface SkillInvocationExecutor extends SkillChildEffectExecutor {
  generate(input: {
    invocationId: string;
    skillRevisionRef: string;
    input: unknown;
    childEffects: readonly SkillChildEffect[];
    output: SkillInvocationOutputDescriptor;
  }): Promise<{ value: unknown }>;
}

export interface SkillInvocationResultPublisher {
  /**
   * Must deduplicate by `idempotencyKey`. Publication happens before the
   * invocation receipt is settled, so a retry may submit the same result.
   */
  publishOnce(input: {
    idempotencyKey: string;
    result: SkillInvocationResult;
  }): Promise<SkillInvocationResult>;
}

export interface SkillOutputValidator {
  validate(input: {
    schemaRevision: string;
    value: unknown;
  }): {
    schemaValid: boolean;
    qualityPassed: boolean;
  };
}

export function skillRevisionRef(skillId: string, revision: number) {
  return `${skillId}@${revision}`;
}

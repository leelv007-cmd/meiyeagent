import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';

export const SKILL_BINDING_MODES = [
  'required',
  'user_selected',
  'disabled',
] as const;

export const SKILL_STAGES = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
] as const;

export type SkillBindingMode = (typeof SKILL_BINDING_MODES)[number];
export type SkillStage = (typeof SKILL_STAGES)[number];
export type SkillExecutionMode =
  | 'provider_native'
  | 'harness_native'
  | 'prompt_materialized';
export type SkillDeploymentArtifactType =
  | 'instruction'
  | 'reference'
  | 'scripts'
  | 'sandbox';

export interface SkillCatalog {
  skillId: string;
  name: string;
  presentationPolicy: 'backend_only' | 'explainable' | 'user_selectable';
  activeRevisionRef: string | null;
  createdAt: string;
  updatedAt: string;
  actorId: string;
}

export interface SkillRevisionManifest {
  inputSchemaRef: string;
  outputSchemaRef: string;
  contextScopes: string[];
  allowedTools: string[];
  sideEffectClass: 'none' | 'read' | 'bounded_write';
  requiredModelCapabilities: string[];
  executionMode: SkillExecutionMode;
  budget: {
    maxChildEffects: number;
    maxCostCents: number;
    timeoutMs: number;
  };
  evalSuiteRef: string;
  compatibility: {
    workflowRevisionRefs: string[];
  };
  fallback: 'skip' | 'fail_closed';
}

export interface SkillRevision {
  skillId: string;
  revision: number;
  skillRevisionRef: string;
  contentHash: string;
  instruction: string;
  manifest: SkillRevisionManifest;
  prompt: HarnessFrozenPrompt;
  status: 'draft' | 'accepted_frozen';
  createdAt: string;
  createdBy: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  evalRunId: string | null;
}

export interface SkillBinding {
  bindingId: string;
  workflowRevisionRef: string;
  stage: SkillStage;
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
  artifactType: SkillDeploymentArtifactType;
  rolloutEvidenceRef: string | null;
  createdAt: string;
}

export interface ResolvedSkillInstruction {
  skillRevisionRef: string;
  instruction: string;
  contentHash: string;
  executionMode: SkillExecutionMode;
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

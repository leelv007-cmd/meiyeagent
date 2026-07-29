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

export interface SkillCatalog {
  skillId: string;
  name: string;
  presentationPolicy: 'backend_only' | 'explainable' | 'user_selectable';
  activeRevisionRef: string | null;
  createdAt: string;
  updatedAt: string;
  actorId: string;
}

export type SkillRevisionManifest = SkillFrontmatter;

export interface LegacySkillRevisionManifest
  extends Omit<SkillGovernanceSidecar, 'workflowRevisionRefs'> {
  evalSuiteRef: string;
  compatibility: {
    workflowRevisionRefs: string[];
  };
}

export interface SkillGovernanceSidecar {
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
}

export class SkillPromptAuthorityUnavailableError extends Error {
  constructor(message = 'Skill prompt authority is unavailable.') {
    super(message);
    this.name = 'SkillPromptAuthorityUnavailableError';
  }
}

interface SkillRevisionBase {
  skillId: string;
  revision: number;
  skillRevisionRef: string;
  contentHash: string;
  instruction: string;
  governance: SkillGovernanceSidecar;
  prompt: SkillPromptSnapshot;
  status: 'draft' | 'accepted_frozen';
  createdAt: string;
  createdBy: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  evalRunId: string | null;
}

export type SkillRevision = SkillRevisionBase &
  (
    | {
        formatVersion: 2;
        manifest: SkillRevisionManifest;
        packagePaths: string[];
      }
    | {
        formatVersion: 1;
        manifest: SkillRevisionManifest | LegacySkillRevisionManifest;
        packagePaths?: string[];
      }
  );

export interface SkillBinding {
  bindingId: string;
  workflowRevisionRef: string;
  triggerCondition: SkillTriggerCondition;
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

export interface ResolvedSkillInstruction {
  skillRevisionRef: string;
  instruction: string;
  contentHash: string;
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

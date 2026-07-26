import { createHash } from 'node:crypto';

import { evalRunSchema, type EvalRun } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type { SkillRepository } from './repository.js';
import {
  skillRevisionRef,
  type ResolvedSkillInstruction,
  type SkillBinding,
  type SkillBindingMode,
  type SkillCatalog,
  type SkillChildEffect,
  type SkillChildEffectExecutor,
  type SkillDeployment,
  type SkillDeploymentArtifactType,
  type SkillExecutionMode,
  type SkillInvocationReceipt,
  type SkillOutputValidator,
  type SkillRevision,
  type SkillRevisionManifest,
  type SkillStage,
} from './types.js';
import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';

function fail(message: string): never {
  throw new P1DomainError('INVALID_STATE', message);
}

function required(value: string, label: string) {
  const normalized = value?.trim();
  if (!normalized) fail(`${label} is required.`);
  return normalized;
}

export class SkillService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async defineCatalogEntry(input: {
    skillId: string;
    name: string;
    presentationPolicy: SkillCatalog['presentationPolicy'];
    actorId: string;
  }) {
    const skillId = required(input.skillId, 'Skill ID');
    const existing = await this.repository.getCatalog(skillId);
    if (existing) return existing;
    const at = this.now();
    return this.repository.putCatalog({
      skillId,
      name: required(input.name, 'Skill name'),
      presentationPolicy: input.presentationPolicy,
      activeRevisionRef: null,
      createdAt: at,
      updatedAt: at,
      actorId: required(input.actorId, 'Actor ID'),
    });
  }

  async draftRevision(input: {
    skillId: string;
    expectedRevision: number | null;
    actorId: string;
    instruction: string;
    manifest: SkillRevisionManifest;
    prompt: HarnessFrozenPrompt;
  }) {
    const catalog = await this.repository.getCatalog(input.skillId);
    if (!catalog) {
      throw new P1DomainError('NOT_FOUND', 'Skill 目录项不存在。');
    }
    validateManifest(input.manifest);
    validatePrompt(input.prompt, input.instruction);
    const revision = (input.expectedRevision ?? 0) + 1;
    const record: SkillRevision = {
      skillId: catalog.skillId,
      revision,
      skillRevisionRef: skillRevisionRef(catalog.skillId, revision),
      contentHash: sha256(
        canonicalJson({
          instruction: input.instruction,
          manifest: input.manifest,
          prompt: input.prompt,
        }),
      ),
      instruction: required(input.instruction, 'Skill instruction'),
      manifest: structuredClone(input.manifest),
      prompt: structuredClone(input.prompt),
      status: 'draft',
      createdAt: this.now(),
      createdBy: required(input.actorId, 'Actor ID'),
      acceptedAt: null,
      acceptedBy: null,
      evalRunId: null,
    };
    return this.repository.putRevision(record, input.expectedRevision);
  }

  async acceptAndFreezeRevision(input: {
    skillRevisionRef: string;
    actorId: string;
    evalRun: EvalRun;
  }) {
    const revision = await this.requireRevision(input.skillRevisionRef);
    if (revision.status === 'accepted_frozen') return revision;
    const run = evalRunSchema.parse(input.evalRun);
    const gateFailure = skillAcceptanceGateFailure(revision, run);
    if (gateFailure) fail(gateFailure);
    const next: SkillRevision = {
      ...revision,
      status: 'accepted_frozen',
      acceptedAt: this.now(),
      acceptedBy: required(input.actorId, 'Actor ID'),
      evalRunId: run.runId,
    };
    await this.repository.acceptRevision(next);
    const catalog = await this.repository.getCatalog(revision.skillId);
    if (!catalog) throw new P1DomainError('NOT_FOUND', 'Skill 目录不存在。');
    await this.repository.putCatalog({
      ...catalog,
      activeRevisionRef: next.skillRevisionRef,
      updatedAt: this.now(),
      actorId: input.actorId,
    });
    return next;
  }

  async bindRevision(input: {
    bindingId: string;
    workflowRevisionRef: string;
    stage: SkillStage;
    skillRevisionRef: string;
    mode: SkillBindingMode;
  }) {
    const revision = await this.requireRevision(input.skillRevisionRef);
    const catalog = await this.repository.getCatalog(revision.skillId);
    if (!catalog) {
      throw new P1DomainError('NOT_FOUND', 'Skill 目录项不存在。');
    }
    if (
      input.mode === 'user_selected' &&
      catalog.presentationPolicy !== 'user_selectable'
    ) {
      fail('后台专用 Skill 不能由用户选择；只有用户可选 Skill 支持该模式。');
    }
    const binding: SkillBinding = {
      bindingId: required(input.bindingId, 'Binding ID'),
      workflowRevisionRef: required(
        input.workflowRevisionRef,
        'Workflow revision',
      ),
      stage: input.stage,
      skillId: revision.skillId,
      skillRevisionRef: input.skillRevisionRef,
      mode: input.mode,
      status: 'active',
      supersededAt: null,
      supersededByBindingId: null,
      createdAt: this.now(),
    };
    await this.assertBindingSlotAvailable(binding);
    return this.repository.putBinding(binding);
  }

  async rollbackBinding(input: {
    bindingId: string;
    sourceBindingId: string;
    targetSkillRevisionRef: string;
    workflowRevisionRef: string;
  }) {
    const source = await this.repository.getBinding(input.sourceBindingId);
    if (!source) {
      throw new P1DomainError('NOT_FOUND', '源 Skill 绑定不存在。');
    }
    if (source.status !== 'active') {
      fail('只能回滚当前仍生效的 Skill 绑定。');
    }
    const sourceRevision = await this.requireRevision(source.skillRevisionRef);
    const targetRevision = await this.requireRevision(
      input.targetSkillRevisionRef,
    );
    if (
      targetRevision.status !== 'accepted_frozen' ||
      targetRevision.skillId !== sourceRevision.skillId
    ) {
      fail('Skill 回滚必须选择同一 Skill 的已冻结版本。');
    }
    if (targetRevision.skillRevisionRef === sourceRevision.skillRevisionRef) {
      fail('回滚目标版本必须不同于当前版本。');
    }
    const replacement: SkillBinding = {
      bindingId: required(input.bindingId, 'Binding ID'),
      workflowRevisionRef: required(
        input.workflowRevisionRef,
        'Workflow revision',
      ),
      stage: source.stage,
      skillId: sourceRevision.skillId,
      skillRevisionRef: targetRevision.skillRevisionRef,
      mode: source.mode,
      status: 'active',
      supersededAt: null,
      supersededByBindingId: null,
      createdAt: this.now(),
    };
    if (replacement.workflowRevisionRef === source.workflowRevisionRef) {
      return this.repository.supersedeBinding(
        source.bindingId,
        replacement,
      );
    }
    await this.assertBindingSlotAvailable(replacement);
    return this.repository.putBinding(replacement);
  }

  async registerDeployment(input: {
    deploymentId: string;
    skillRevisionRef: string;
    provider: string;
    channel: string;
    nativeSkillId: string;
    nativeVersion: string;
    executionMode: SkillExecutionMode;
    artifactType: SkillDeploymentArtifactType;
    experimentalGate?: {
      enabled: boolean;
      evidenceRef: string;
    };
  }) {
    const revision = await this.requireRevision(input.skillRevisionRef);
    if (revision.status !== 'accepted_frozen') {
      fail('只能部署已受理冻结的 Skill 版本。');
    }
    const firstReleaseArtifact =
      input.artifactType === 'instruction' ||
      input.artifactType === 'reference';
    const firstReleaseMode = input.executionMode === 'prompt_materialized';
    if (!firstReleaseArtifact || !firstReleaseMode) {
      if (
        !input.experimentalGate?.enabled ||
        !input.experimentalGate.evidenceRef.trim()
      ) {
        if (
          input.executionMode === 'provider_native' ||
          input.artifactType === 'scripts' ||
          input.artifactType === 'sandbox'
        ) {
          fail('Provider 原生、脚本或沙箱部署必须提供显式开关和证据引用。');
        }
        fail('首发部署只开放 prompt_materialized 的 instruction/reference Skill。');
      }
    }
    if (input.executionMode !== revision.manifest.executionMode) {
      fail('Skill 部署执行模式必须与权威版本一致。');
    }
    const deployment: SkillDeployment = {
      deploymentId: required(input.deploymentId, 'Deployment ID'),
      skillRevisionRef: revision.skillRevisionRef,
      provider: required(input.provider, 'Provider'),
      channel: required(input.channel, 'Channel'),
      nativeSkillId: required(input.nativeSkillId, 'Native Skill ID'),
      nativeVersion: required(input.nativeVersion, 'Native Skill version'),
      executionMode: input.executionMode,
      artifactType: input.artifactType,
      rolloutEvidenceRef: input.experimentalGate?.evidenceRef.trim() || null,
      createdAt: this.now(),
    };
    return this.repository.putDeployment(deployment);
  }

  async resolveStage(input: {
    workflowRevisionRef: string;
    stage: SkillStage;
    plannerSelectedSkillRefs: string[];
    userSelectedSkillRefs: string[];
  }): Promise<{
    allowlist: ResolvedSkillInstruction[];
    selected: ResolvedSkillInstruction[];
  }> {
    const bindings = await this.repository.listBindings(
      input.workflowRevisionRef,
      input.stage,
    );
    const planner = new Set(input.plannerSelectedSkillRefs);
    const user = new Set(input.userSelectedSkillRefs);
    const allowlist: ResolvedSkillInstruction[] = [];
    const selected: ResolvedSkillInstruction[] = [];
    const allowedPlannerRefs = new Set<string>();
    for (const binding of bindings) {
      if (binding.mode === 'disabled') continue;
      const revision = await this.repository.getRevision(
        binding.skillRevisionRef,
      );
      if (!revision || revision.status !== 'accepted_frozen') continue;
      if (
        !revision.manifest.compatibility.workflowRevisionRefs.includes(
          input.workflowRevisionRef,
        )
      ) {
        continue;
      }
      if (binding.mode === 'planner_selected') {
        allowedPlannerRefs.add(binding.skillRevisionRef);
      }
      if (binding.mode === 'user_selected' && !user.has(binding.skillRevisionRef)) {
        continue;
      }
      const resolved = toResolved(revision);
      allowlist.push(resolved);
      if (
        binding.mode === 'required' ||
        (binding.mode === 'planner_selected' &&
          planner.has(binding.skillRevisionRef)) ||
        (binding.mode === 'user_selected' && user.has(binding.skillRevisionRef))
      ) {
        selected.push(resolved);
      }
    }
    if ([...planner].some((ref) => !allowedPlannerRefs.has(ref))) {
      fail('规划器选择了当前阶段允许列表之外的 Skill。');
    }
    return { allowlist, selected };
  }

  async resolveFrozenRevisions(
    skillRevisionRefs: readonly string[],
  ): Promise<ResolvedSkillInstruction[]> {
    const resolved: ResolvedSkillInstruction[] = [];
    for (const reference of skillRevisionRefs) {
      const revision = await this.requireRevision(reference);
      if (revision.status !== 'accepted_frozen') {
        fail('只能恢复已受理冻结的 Skill 版本。');
      }
      resolved.push(toResolved(revision));
    }
    return resolved;
  }

  async recordPromptMaterializationReceipts(input: {
    workspaceId: string;
    taskId: string;
    workflowRevisionRef: string;
    stage: SkillStage;
    instructions: readonly ResolvedSkillInstruction[];
  }) {
    const receipts: SkillInvocationReceipt[] = [];
    for (const instruction of input.instructions) {
      const revision = await this.requireRevision(
        instruction.skillRevisionRef,
      );
      if (
        revision.status !== 'accepted_frozen' ||
        revision.manifest.executionMode !== 'prompt_materialized'
      ) {
        fail('生产判断位只能物化已受理冻结的 prompt_materialized Skill。');
      }
      const invocationId = [
        'skill-materialized',
        input.taskId,
        input.stage,
        encodeURIComponent(revision.skillRevisionRef),
      ].join(':');
      const facts = {
        stage: input.stage,
        workflowRevisionRef: input.workflowRevisionRef,
        skillRevisionRef: revision.skillRevisionRef,
        contentHash: revision.contentHash,
      };
      const inputFingerprint = sha256(canonicalJson(facts));
      const existing = await this.repository.getInvocationReceipt(
        invocationId,
      );
      if (existing) {
        if (existing.inputFingerprint !== inputFingerprint) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Skill 物化回执已绑定到不同事实。',
          );
        }
        receipts.push(existing);
        continue;
      }
      receipts.push(
        await this.repository.putInvocationReceipt({
          invocationId,
          workspaceId: required(input.workspaceId, 'Workspace ID'),
          taskId: required(input.taskId, 'Task ID'),
          productUsageTaskId: input.taskId,
          skillRevisionRef: revision.skillRevisionRef,
          childEffectIds: [],
          totalCostCents: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          status: 'settled',
          createdAt: this.now(),
          inputFingerprint,
        }),
      );
    }
    return receipts;
  }

  async invoke(
    input: {
      invocationId: string;
      workspaceId: string;
      taskId: string;
      productUsageTaskId: string;
      skillRevisionRef: string;
      calls: Array<{
        callId: string;
        toolId: string;
        contextRefs: string[];
        declaredBudgetCapCents: number;
        payload: unknown;
      }>;
      output: {
        target: 'workflow_artifact' | 'content_package';
        schemaRevision: string;
        value: unknown;
      };
    },
    executor: SkillChildEffectExecutor,
    outputValidator: SkillOutputValidator,
  ): Promise<SkillInvocationReceipt> {
    const invocationId = required(input.invocationId, 'Invocation ID');
    const fingerprint = sha256(canonicalJson(input));
    const existingReceipt =
      await this.repository.getInvocationReceipt(invocationId);
    if (existingReceipt) {
      if (existingReceipt.inputFingerprint !== fingerprint) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill invocation ID is already bound to different facts.',
        );
      }
      for (const effectId of existingReceipt.childEffectIds) {
        const effect = await this.repository.getChildEffect(effectId);
        if (effect && effect.retryStatus !== 'replayed') {
          await this.repository.updateChildEffect({
            ...effect,
            retryStatus: 'replayed',
          });
        }
      }
      return existingReceipt;
    }
    const revision = await this.requireRevision(input.skillRevisionRef);
    if (revision.status !== 'accepted_frozen') {
      fail('只能调用已受理冻结的 Skill 版本。');
    }
    if (input.output.target === 'content_package') {
      fail('Skill 输出不能写入 ContentPackage。');
    }
    if (input.output.schemaRevision !== revision.manifest.outputSchemaRef) {
      fail('Skill 输出未使用已冻结的输出 Schema 版本。');
    }
    const validation = outputValidator.validate({
      schemaRevision: input.output.schemaRevision,
      value: input.output.value,
    });
    if (!validation.schemaValid || !validation.qualityPassed) {
      fail('Skill 输出未通过 Schema 或质量门。');
    }
    const callIds = input.calls.map((call) => required(call.callId, 'Call ID'));
    if (
      new Set(callIds).size !== callIds.length ||
      input.calls.length > revision.manifest.budget.maxChildEffects
    ) {
      fail('Skill 子调用超过已冻结的调用预算。');
    }
    const declaredCostCap = input.calls.reduce(
      (total, call) => total + call.declaredBudgetCapCents,
      0,
    );
    if (
      input.calls.some(
        (call) =>
          !Number.isFinite(call.declaredBudgetCapCents) ||
          call.declaredBudgetCapCents < 0,
      ) ||
      declaredCostCap > revision.manifest.budget.maxCostCents
    ) {
      fail('Skill 子调用超过已冻结的成本预算。');
    }

    const effects: SkillChildEffect[] = [];
    for (const call of input.calls) {
      validateChildEffect(revision, call);
      const effectId = `${invocationId}:${call.callId}`;
      const idempotencyKey = `skill:${invocationId}:${call.callId}`;
      const effectFingerprint = sha256(
        canonicalJson({
          invocationId,
          skillRevisionRef: revision.skillRevisionRef,
          call,
        }),
      );
      const existing = await this.repository.getChildEffect(effectId);
      if (existing) {
        if (existing.fingerprint !== effectFingerprint) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Skill child effect ID is already bound to different facts.',
          );
        }
        const replayed =
          existing.retryStatus === 'replayed'
            ? existing
            : await this.repository.updateChildEffect({
                ...existing,
                retryStatus: 'replayed',
              });
        if (replayed.settlementStatus === 'over_budget') {
          fail('Skill 子调用实际成本超过声明的预算上限。');
        }
        effects.push(replayed);
        continue;
      }
      const result = await executor.execute({
        callId: call.callId,
        idempotencyKey,
        toolId: call.toolId,
        contextRefs: structuredClone(call.contextRefs),
        payload: structuredClone(call.payload),
      });
      const overBudget =
        !Number.isFinite(result.costCents) ||
        result.costCents < 0 ||
        result.costCents > call.declaredBudgetCapCents;
      const effect: SkillChildEffect = {
        effectId,
        invocationId,
        idempotencyKey,
        fingerprint: effectFingerprint,
        toolId: call.toolId,
        contextRefs: structuredClone(call.contextRefs),
        declaredBudgetCapCents: call.declaredBudgetCapCents,
        providerReceipt: structuredClone(result.providerReceipt),
        usage: structuredClone(result.usage),
        costCents: result.costCents,
        settlementStatus: overBudget ? 'over_budget' : 'settled',
        retryStatus: 'first_attempt',
        acceptanceStatus: overBudget ? 'rejected' : result.acceptanceStatus,
        createdAt: this.now(),
      };
      const persisted = await this.repository.putChildEffect(effect);
      if (overBudget) {
        fail('Skill 子调用实际成本超过声明的预算上限。');
      }
      effects.push(persisted);
    }

    return this.repository.putInvocationReceipt({
      invocationId,
      workspaceId: required(input.workspaceId, 'Workspace ID'),
      taskId: required(input.taskId, 'Task ID'),
      productUsageTaskId: required(
        input.productUsageTaskId,
        'ProductUsage task ID',
      ),
      skillRevisionRef: revision.skillRevisionRef,
      childEffectIds: effects.map((effect) => effect.effectId),
      totalCostCents: effects.reduce(
        (total, effect) => total + effect.costCents,
        0,
      ),
      totalInputTokens: effects.reduce(
        (total, effect) => total + effect.usage.inputTokens,
        0,
      ),
      totalOutputTokens: effects.reduce(
        (total, effect) => total + effect.usage.outputTokens,
        0,
      ),
      status: 'settled',
      createdAt: this.now(),
      inputFingerprint: fingerprint,
    });
  }

  private async requireRevision(skillRevisionRef: string) {
    const revision = await this.repository.getRevision(skillRevisionRef);
    if (!revision) {
      throw new P1DomainError('NOT_FOUND', 'Skill 版本不存在。');
    }
    return revision;
  }

  private async assertBindingSlotAvailable(binding: SkillBinding) {
    const bindings = await this.repository.listBindings(
      binding.workflowRevisionRef,
      binding.stage,
    );
    if (
      bindings.some(
        (candidate) =>
          candidate.skillId === binding.skillId &&
          candidate.bindingId !== binding.bindingId,
      )
    ) {
      fail('该 Workflow 阶段已经绑定了这个 Skill；请先回滚或取代现有绑定。');
    }
  }
}

function toResolved(revision: SkillRevision): ResolvedSkillInstruction {
  return {
    skillRevisionRef: revision.skillRevisionRef,
    instruction: revision.instruction,
    contentHash: revision.contentHash,
    executionMode: revision.manifest.executionMode,
  };
}

function validatePrompt(prompt: HarnessFrozenPrompt, instruction: string) {
  if (
    prompt.content !== instruction ||
    prompt.contentHash !== sha256(prompt.content) ||
    !prompt.name.trim() ||
    !prompt.version.trim()
  ) {
    fail('Prompt Skill 必须绑定精确的提示词版本与内容哈希。');
  }
}

export function skillAcceptanceGateFailure(
  revision: SkillRevision,
  run: EvalRun,
) {
  if (
    !run.passed ||
    run.results.some(
      (result) =>
        result.skillRevisionRef !== revision.skillRevisionRef ||
        result.promptRevision !==
          `${revision.prompt.name}@${revision.prompt.version}`,
    )
  ) {
    return 'Skill revision must pass its exact prompt and Skill eval gate.';
  }
  if (
    revision.prompt.source !== 'langfuse' ||
    revision.prompt.isFallback ||
    revision.prompt.label !== 'production'
  ) {
    return 'Prompt Skill acceptance requires a frozen Langfuse production revision.';
  }
  return null;
}

function validateManifest(manifest: SkillRevisionManifest) {
  for (const [label, value] of [
    ['input schema', manifest.inputSchemaRef],
    ['output schema', manifest.outputSchemaRef],
    ['eval suite', manifest.evalSuiteRef],
  ] as const) {
    required(value, label);
  }
  if (
    !Number.isInteger(manifest.budget.maxChildEffects) ||
    manifest.budget.maxChildEffects < 0 ||
    !Number.isFinite(manifest.budget.maxCostCents) ||
    manifest.budget.maxCostCents < 0 ||
    !Number.isInteger(manifest.budget.timeoutMs) ||
    manifest.budget.timeoutMs <= 0
  ) {
    fail('Skill 预算必须为有限的非负数。');
  }
}

function validateChildEffect(
  revision: SkillRevision,
  call: {
    toolId: string;
    contextRefs: string[];
  },
) {
  if (!revision.manifest.allowedTools.includes(call.toolId)) {
    fail(`Tool "${call.toolId}" is outside the Skill allowlist.`);
  }
  const allowedScopes = new Set(revision.manifest.contextScopes);
  if (
    call.contextRefs.some(
      (reference) => !allowedScopes.has(reference.split(':', 1)[0] ?? ''),
    )
  ) {
    fail('Skill 子调用读取了声明范围之外的 Context。');
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

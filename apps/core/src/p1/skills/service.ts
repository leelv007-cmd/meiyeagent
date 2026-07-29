import { createHash } from 'node:crypto';

import {
  evalRunSchema,
  parseSkillSchema,
  type EvalRun,
  type HarnessStage,
} from '@meiye/contracts';

import {
  P1DomainError,
  PrewriteDeterministicRejectionError,
} from '../foundation/domain.js';
import type { SkillRepository } from './repository.js';
import {
  validateSkillPermissionAuthority,
  validateSkillFrontmatter,
  validateSkillPackagePaths,
} from './skill-format.js';
import { parseSkillGovernance } from './skill-governance.js';
import {
  SkillPromptAuthorityUnavailableError,
  skillRevisionRef,
  type ResolvedSkillInstruction,
  type SkillBinding,
  type SkillBindingMode,
  type SkillCatalog,
  type SkillChildEffect,
  type SkillDeployment,
  type SkillExecutionMode,
  type SkillGovernanceSidecar,
  type SkillInvocationExecution,
  type SkillInvocationExecutor,
  type SkillInvocationReceipt,
  type SkillInvocationRequest,
  type SkillInvocationResultPublisher,
  type SkillOutputValidator,
  type SkillPromptReference,
  type SkillPromptSnapshot,
  type SkillPromptSnapshotPort,
  type SkillRevision,
  type SkillRevisionManifest,
  type SkillSourceKind,
  type SkillSourceRef,
  type SkillTier,
  type SkillTriggerCondition,
  SKILL_SOURCE_KINDS,
  SKILL_TIERS,
} from './types.js';
import { RegistrySkillOutputValidator } from './schema-validator.js';
import {
  denyAllSkillToolExecution,
  type SkillToolExecutionAuthorizer,
} from './tool-authorization.js';

const registrySkillOutputValidator = new RegistrySkillOutputValidator();

function fail(message: string): never {
  throw new P1DomainError('INVALID_STATE', message);
}

function failPrewrite(message: string): never {
  throw new PrewriteDeterministicRejectionError(message);
}

function validatePrewrite<T>(validation: () => T): T {
  try {
    return validation();
  } catch (error) {
    if (error instanceof Error) {
      failPrewrite(error.message);
    }
    throw error;
  }
}

export class SkillInvocationValidationError extends P1DomainError {
  constructor(
    readonly phase: 'input' | 'output',
    message: string,
  ) {
    super('INVALID_STATE', message);
  }
}

function failValidation(
  phase: SkillInvocationValidationError['phase'],
  message: string,
): never {
  throw new SkillInvocationValidationError(phase, message);
}

function required(value: string, label: string) {
  const normalized = value?.trim();
  if (!normalized) fail(`${label} is required.`);
  return normalized;
}

// The catalog metric is a ratio over these enums, so an unrecognised value
// would make it silently uncomputable rather than loudly wrong.
function assertSkillSourceKind(value: SkillSourceKind): SkillSourceKind {
  if (!(SKILL_SOURCE_KINDS as readonly string[]).includes(value)) {
    fail(`Skill source must be one of ${SKILL_SOURCE_KINDS.join(', ')}.`);
  }
  return value;
}

function assertSkillTier(value: SkillTier): SkillTier {
  if (!(SKILL_TIERS as readonly string[]).includes(value)) {
    fail(`Skill tier must be one of ${SKILL_TIERS.join(', ')}.`);
  }
  return value;
}

function normalizeTriggerCondition(
  condition: SkillTriggerCondition,
): SkillTriggerCondition {
  return {
    harnessStage: condition.harnessStage,
    industryCategory: condition.industryCategory?.trim() || null,
    tenantId: condition.tenantId?.trim() || null,
  };
}

type SkillDraftRevisionInput = {
  skillId: string;
  expectedRevision: number | null;
  actorId: string;
  instruction: string;
  manifest: SkillRevisionManifest;
  governance: SkillGovernanceSidecar;
  promptReference: SkillPromptReference;
  packagePaths?: string[];
};

type PreparedSkillDraft = {
  actorId: string;
  governance: SkillGovernanceSidecar;
  instruction: string;
  manifest: SkillRevisionManifest;
  packagePaths: string[];
  prompt: SkillPromptSnapshot;
};

export class SkillService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly promptSnapshots?: SkillPromptSnapshotPort,
    private readonly toolExecutionAuthorizer: SkillToolExecutionAuthorizer =
      denyAllSkillToolExecution,
  ) {}

  async defineCatalogEntry(input: {
    skillId: string;
    name: string;
    description: string;
    sourceKind: SkillSourceKind;
    tier: SkillTier;
    sourceRef?: SkillSourceRef;
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
      description: required(input.description, 'Skill description'),
      sourceKind: assertSkillSourceKind(input.sourceKind),
      tier: assertSkillTier(input.tier),
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      presentationPolicy: input.presentationPolicy,
      activeRevisionRef: null,
      createdAt: at,
      updatedAt: at,
      actorId: required(input.actorId, 'Actor ID'),
    });
  }

  async defineCatalogAndDraftRevision(
    input: SkillDraftRevisionInput & {
      name: string;
      description: string;
      sourceKind: SkillSourceKind;
      tier: SkillTier;
      sourceRef?: SkillSourceRef;
      presentationPolicy: SkillCatalog['presentationPolicy'];
    },
  ) {
    const prepared = await this.prepareSkillDraft(input);
    const catalog = await this.defineCatalogEntry({
      actorId: input.actorId,
      name: input.name,
      description: input.description,
      sourceKind: input.sourceKind,
      tier: input.tier,
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      presentationPolicy: input.presentationPolicy,
      skillId: input.skillId,
    });
    return {
      catalog,
      revision: await this.persistSkillDraft(input, catalog, prepared),
    };
  }

  /**
   * Operator catalog projection. Carries the description and source that the
   * catalog page shows, and nothing that would let a caller pull instructions
   * out in bulk.
   */
  async listCatalog(filter?: {
    tier?: SkillTier;
    sourceKind?: SkillSourceKind;
    limit?: number;
  }) {
    const catalogs = await this.repository.listCatalogs(filter);
    return catalogs.map((catalog) => ({
      skillId: catalog.skillId,
      name: catalog.name,
      description: catalog.description,
      sourceKind: catalog.sourceKind,
      tier: catalog.tier,
      sourceRef: catalog.sourceRef ?? null,
      presentationPolicy: catalog.presentationPolicy,
      activeRevisionRef: catalog.activeRevisionRef,
      updatedAt: catalog.updatedAt,
    }));
  }

  /**
   * Revision history for one Skill. Instructions and prompt content stay out
   * — the catalog page shows lineage, not payloads.
   */
  async listRevisionHistory(skillId: string) {
    const head = await this.repository.getRevisionHead(
      required(skillId, 'Skill ID'),
    );
    if (!head) return [];
    const history = [];
    for (let revision = head.revision; revision >= 1; revision -= 1) {
      const record = await this.repository.getRevision(
        skillRevisionRef(head.skillId, revision),
      );
      if (!record) continue;
      history.push({
        skillRevisionRef: record.skillRevisionRef,
        revision: record.revision,
        status: record.status,
        contentHash: record.contentHash,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
        acceptedAt: record.acceptedAt,
        acceptedBy: record.acceptedBy,
        evalRunId: record.evalRunId,
      });
    }
    return history;
  }

  async draftRevision(input: SkillDraftRevisionInput) {
    const prepared = await this.prepareSkillDraft(input);
    const catalog = await this.repository.getCatalog(input.skillId);
    if (!catalog) {
      throw new P1DomainError('NOT_FOUND', 'Skill 目录项不存在。');
    }
    return this.persistSkillDraft(input, catalog, prepared);
  }

  private async prepareSkillDraft(
    input: SkillDraftRevisionInput,
  ): Promise<PreparedSkillDraft> {
    const manifest = validatePrewrite(() =>
      validateSkillFrontmatter(input.manifest),
    );
    let governance: SkillGovernanceSidecar;
    try {
      governance = parseSkillGovernance(input.governance);
    } catch (error) {
      failPrewrite(
        `Skill governance sidecar is invalid: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    const packagePaths = validatePrewrite(() =>
      validateSkillPackagePaths(input.packagePaths ?? ['SKILL.md']),
    );
    const instruction = required(input.instruction, 'Skill instruction');
    const prompt = await this.capturePromptSnapshot(input.promptReference);
    return {
      actorId: required(input.actorId, 'Actor ID'),
      governance,
      instruction,
      manifest,
      packagePaths,
      prompt,
    };
  }

  private persistSkillDraft(
    input: SkillDraftRevisionInput,
    catalog: SkillCatalog,
    prepared: PreparedSkillDraft,
  ) {
    const {
      actorId,
      governance,
      instruction,
      manifest,
      packagePaths,
      prompt,
    } = prepared;
    const revision = (input.expectedRevision ?? 0) + 1;
    const record: SkillRevision = {
      formatVersion: 2,
      skillId: catalog.skillId,
      revision,
      skillRevisionRef: skillRevisionRef(catalog.skillId, revision),
      contentHash: sha256(
        canonicalJson({
          instruction,
          manifest,
          governance,
          packagePaths,
          prompt,
        }),
      ),
      instruction,
      manifest: structuredClone(manifest),
      governance: structuredClone(governance),
      packagePaths,
      prompt,
      status: 'draft',
      createdAt: this.now(),
      createdBy: actorId,
      acceptedAt: null,
      acceptedBy: null,
      evalRunId: null,
    };
    return this.repository.putRevision(record, input.expectedRevision);
  }

  private async capturePromptSnapshot(
    reference: SkillPromptReference,
  ): Promise<SkillPromptSnapshot> {
    const keys = Object.keys(reference);
    if (
      keys.some(
        (key) => !['name', 'version', 'contentHash'].includes(key),
      )
    ) {
      failPrewrite(
        'Skill prompt reference must not include content or fallback fields.',
      );
    }
    const normalized = {
      name: reference.name?.trim(),
      version: reference.version?.trim(),
      contentHash: reference.contentHash?.trim(),
    };
    if (!normalized.name) {
      failPrewrite('Skill prompt name is required.');
    }
    if (!normalized.version) {
      failPrewrite('Skill prompt version is required.');
    }
    if (!normalized.contentHash) {
      failPrewrite('Skill prompt content hash is required.');
    }
    const promptSnapshots = this.promptSnapshots;
    if (!promptSnapshots) {
      failPrewrite('Skill prompt snapshot resolver is not configured.');
    }
    const captured = await promptSnapshots.capture(normalized);
    if (
      captured.name !== normalized.name ||
      captured.version !== normalized.version ||
      captured.contentHash !== normalized.contentHash ||
      sha256(captured.content) !== normalized.contentHash
    ) {
      fail(
        'Skill prompt snapshot does not match its pinned reference.',
      );
    }
    if (
      captured.isFallback &&
      !captured.fallbackReason?.trim()
    ) {
      fail('Skill prompt fallback requires a reason.');
    }
    return {
      ...normalized,
      content: captured.content,
      label: captured.label,
      source: captured.source,
      isFallback: captured.isFallback,
      ...(captured.fallbackReason
        ? { fallbackReason: captured.fallbackReason }
        : {}),
    };
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
    triggerCondition: SkillTriggerCondition;
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
      triggerCondition: normalizeTriggerCondition(input.triggerCondition),
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
    if (source.mode === 'planner_selected') {
      fail('已退役的规划器 Skill 绑定不能回滚。');
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
      triggerCondition: structuredClone(source.triggerCondition),
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
    packagePaths: string[];
    experimentalGate?: {
      enabled: boolean;
      evidenceRef: string;
    };
  }) {
    const revision = await this.requireRevision(input.skillRevisionRef);
    if (revision.status !== 'accepted_frozen') {
      fail('只能部署已受理冻结的 Skill 版本。');
    }
    const packagePaths = validateSkillPackagePaths(input.packagePaths);
    const frozenPackagePaths = validateSkillPackagePaths(
      revision.packagePaths ?? ['SKILL.md'],
    );
    if (
      canonicalJson(packagePaths) !== canonicalJson(frozenPackagePaths)
    ) {
      fail('Skill deployment package paths must match the frozen revision.');
    }
    const containsScripts = packagePaths.some((path) =>
      path.startsWith('scripts/'),
    );
    const firstReleaseMode = input.executionMode === 'prompt_materialized';
    if (containsScripts || !firstReleaseMode) {
      if (
        !input.experimentalGate?.enabled ||
        !input.experimentalGate.evidenceRef.trim()
      ) {
        if (
          input.executionMode === 'provider_native' ||
          containsScripts
        ) {
          fail('Provider 原生、脚本或沙箱部署必须提供显式开关和证据引用。');
        }
        fail('首发部署只开放不含 scripts/ 的 prompt_materialized Skill package。');
      }
    }
    if (input.executionMode !== revision.governance.executionMode) {
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
      packagePaths,
      rolloutEvidenceRef: input.experimentalGate?.evidenceRef.trim() || null,
      createdAt: this.now(),
    };
    return this.repository.putDeployment(deployment);
  }

  async resolveStage(input: {
    workflowRevisionRef: string;
    stage: HarnessStage;
    industryCategory?: string;
    tenantId?: string;
    userSelectedSkillRefs: string[];
  }): Promise<{
    allowlist: ResolvedSkillInstruction[];
  }> {
    const bindings = await this.repository.listBindings(
      input.workflowRevisionRef,
      {
        harnessStage: input.stage,
        industryCategory: input.industryCategory?.trim() || null,
        tenantId: input.tenantId?.trim() || null,
      },
    );
    const selectedBindings = new Map<string, SkillBinding>();
    for (const binding of bindings) {
      const selected = selectedBindings.get(binding.skillId);
      if (
        !selected ||
        triggerSpecificity(binding.triggerCondition) >
          triggerSpecificity(selected.triggerCondition)
      ) {
        selectedBindings.set(binding.skillId, binding);
      }
    }
    const user = new Set(input.userSelectedSkillRefs);
    const allowlist: ResolvedSkillInstruction[] = [];
    for (const binding of selectedBindings.values()) {
      if (binding.mode === 'disabled') continue;
      const revision = await this.repository.getRevision(
        binding.skillRevisionRef,
      );
      if (!revision || revision.status !== 'accepted_frozen') continue;
      if (
        !revision.governance.workflowRevisionRefs.includes(
          input.workflowRevisionRef,
        )
      ) {
        continue;
      }
      if (binding.mode === 'user_selected' && !user.has(binding.skillRevisionRef)) {
        continue;
      }
      const resolved = await this.resolveInstruction(revision);
      allowlist.push(resolved);
    }
    return { allowlist };
  }

  retireLegacyPlannerSelectedBindings() {
    return this.repository.retireLegacyPlannerSelectedBindings(this.now());
  }

  async resolveExecutedSelection(
    invocationId: string,
  ): Promise<ResolvedSkillInstruction[]> {
    const receipt = await this.repository.getInvocationReceipt(
      required(invocationId, 'Invocation ID'),
    );
    if (!receipt || receipt.childEffectIds.length === 0) return [];
    const effects = await Promise.all(
      receipt.childEffectIds.map((effectId) =>
        this.repository.getChildEffect(effectId),
      ),
    );
    if (
      effects.some(
        (effect) => !effect || effect.invocationId !== receipt.invocationId,
      )
    ) {
      fail('Skill 调用回执引用的工具调用记录不完整。');
    }
    const revision = await this.requireRevision(receipt.skillRevisionRef);
    return [await this.resolveInstruction(revision)];
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
      resolved.push(await this.resolveInstruction(revision));
    }
    return resolved;
  }

  async recordPromptMaterializationReceipts(input: {
    workspaceId: string;
    taskId: string;
    workflowRevisionRef: string;
    stage: HarnessStage;
    instructions: readonly ResolvedSkillInstruction[];
  }) {
    const receipts: SkillInvocationReceipt[] = [];
    for (const instruction of input.instructions) {
      const revision = await this.requireRevision(
        instruction.skillRevisionRef,
      );
      if (
        revision.status !== 'accepted_frozen' ||
        revision.governance.executionMode !== 'prompt_materialized'
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
        prompt: instruction.prompt
          ? {
              contentHash: instruction.prompt.contentHash,
              name: instruction.prompt.name,
              version: instruction.prompt.version,
            }
          : undefined,
      };
      const inputFingerprint = sha256(canonicalJson(facts));
      const legacyInputFingerprint = sha256(
        canonicalJson({
          stage: input.stage,
          workflowRevisionRef: input.workflowRevisionRef,
          skillRevisionRef: revision.skillRevisionRef,
          contentHash: revision.contentHash,
        }),
      );
      const existing = await this.repository.getInvocationReceipt(
        invocationId,
      );
      if (existing) {
        if (
          existing.inputFingerprint !== inputFingerprint &&
          existing.inputFingerprint !== legacyInputFingerprint
        ) {
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
          ...(instruction.prompt
            ? { prompt: structuredClone(instruction.prompt) }
            : {}),
        }),
      );
    }
    return receipts;
  }

  async invoke(
    input: SkillInvocationRequest,
    executor: SkillInvocationExecutor,
    resultPublisher: SkillInvocationResultPublisher,
    outputValidator: SkillOutputValidator = registrySkillOutputValidator,
  ): Promise<SkillInvocationExecution> {
    const invocationId = required(input.invocationId, 'Invocation ID');
    const revision = await this.requireRevision(input.skillRevisionRef);
    if (revision.status !== 'accepted_frozen') {
      fail('只能调用已受理冻结的 Skill 版本。');
    }
    try {
      parseSkillSchema(revision.governance.inputSchemaRef, input.input);
    } catch {
      failValidation(
        'input',
        'Skill input does not match its frozen input schema.',
      );
    }
    if (input.output.target === 'content_package') {
      failValidation('output', 'Skill 输出不能写入 ContentPackage。');
    }
    if (input.output.schemaRevision !== revision.governance.outputSchemaRef) {
      failValidation(
        'output',
        'Skill 输出未使用已冻结的输出 Schema 版本。',
      );
    }
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
      const recordedEffects: SkillChildEffect[] = [];
      for (const effectId of existingReceipt.childEffectIds) {
        const effect = await this.repository.getChildEffect(effectId);
        if (!effect || effect.invocationId !== invocationId) {
          fail('Skill 调用回执引用的工具调用记录不完整。');
        }
        recordedEffects.push(effect);
      }
      if (!existingReceipt.output) {
        fail('Skill 调用回执缺少已校验的输出结果。');
      }
      for (const effect of recordedEffects) {
        if (effect.retryStatus === 'replayed') continue;
        await this.repository.updateChildEffect({
          ...effect,
          retryStatus: 'replayed',
        });
      }
      return this.withExecutedSelection(existingReceipt);
    }
    const callIds = input.calls.map((call) => required(call.callId, 'Call ID'));
    if (
      new Set(callIds).size !== callIds.length ||
      input.calls.length > revision.governance.budget.maxChildEffects
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
      declaredCostCap > revision.governance.budget.maxCostCents
    ) {
      fail('Skill 子调用超过已冻结的成本预算。');
    }

    const effects: SkillChildEffect[] = [];
    for (const call of input.calls) {
      validateChildEffect(revision, call);
      this.toolExecutionAuthorizer.authorize({
        caller: revision.skillRevisionRef,
        toolId: call.toolId,
      });
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

    const generated = await executor.generate({
      invocationId,
      skillRevisionRef: revision.skillRevisionRef,
      input: structuredClone(input.input),
      childEffects: effects.map((effect) => structuredClone(effect)),
      output: structuredClone(input.output),
    });
    let validation: ReturnType<SkillOutputValidator['validate']>;
    try {
      validation = outputValidator.validate({
        schemaRevision: input.output.schemaRevision,
        value: generated.value,
      });
    } catch {
      failValidation('output', 'Skill 输出未通过 Schema 或质量门。');
    }
    if (!validation.schemaValid || !validation.qualityPassed) {
      failValidation('output', 'Skill 输出未通过 Schema 或质量门。');
    }
    const output = {
      invocationId,
      target: input.output.target,
      schemaRevision: input.output.schemaRevision,
      value: structuredClone(generated.value),
      createdAt: this.now(),
    };
    const canonicalOutput = await resultPublisher.publishOnce({
      idempotencyKey: invocationId,
      result: structuredClone(output),
    });
    if (
      canonicalOutput.invocationId !== invocationId ||
      canonicalOutput.target !== output.target ||
      canonicalOutput.schemaRevision !== output.schemaRevision
    ) {
      fail('Skill 业务结果发布器返回了不匹配的幂等事实。');
    }
    let canonicalValidation: ReturnType<SkillOutputValidator['validate']>;
    try {
      canonicalValidation = outputValidator.validate({
        schemaRevision: canonicalOutput.schemaRevision,
        value: canonicalOutput.value,
      });
    } catch {
      fail('Skill 业务结果发布器返回了无效的已发布结果。');
    }
    if (
      !canonicalValidation.schemaValid ||
      !canonicalValidation.qualityPassed
    ) {
      fail('Skill 业务结果发布器返回了无效的已发布结果。');
    }
    const receipt = await this.repository.putInvocationReceipt({
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
      output: structuredClone(canonicalOutput),
    });
    return this.withExecutedSelection(receipt);
  }

  private async requireRevision(skillRevisionRef: string) {
    const revision = await this.repository.getRevision(skillRevisionRef);
    if (!revision) {
      throw new P1DomainError('NOT_FOUND', 'Skill 版本不存在。');
    }
    return revision;
  }

  private async withExecutedSelection(
    receipt: SkillInvocationReceipt,
  ): Promise<SkillInvocationExecution> {
    if (!receipt.output) {
      fail('Skill 调用回执缺少已校验的输出结果。');
    }
    return {
      ...receipt,
      output: receipt.output,
      selected: await this.resolveExecutedSelection(receipt.invocationId),
    };
  }

  private async assertBindingSlotAvailable(binding: SkillBinding) {
    const bindings = await this.repository.listBindings(
      binding.workflowRevisionRef,
      binding.triggerCondition,
    );
    if (
      bindings.some(
        (candidate) =>
          candidate.skillId === binding.skillId &&
          isSameTriggerCondition(
            candidate.triggerCondition,
            binding.triggerCondition,
          ) &&
          candidate.bindingId !== binding.bindingId,
      )
    ) {
      fail('该 Workflow 阶段已经绑定了这个 Skill；请先回滚或取代现有绑定。');
    }
  }

  private async resolveInstruction(
    revision: SkillRevision,
  ): Promise<ResolvedSkillInstruction> {
    const prompt = await this.resolveRevisionPrompt(revision);
    return resolvedInstruction(
      revision,
      revision.instruction,
      prompt.isFallback,
      prompt.fallbackReason,
      prompt.content,
    );
  }

  async resolvePromptSnapshot(
    skillRevisionRef: string,
  ) {
    return this.resolveRevisionPrompt(
      await this.requireRevision(skillRevisionRef),
    );
  }

  private async resolveRevisionPrompt(
    revision: SkillRevision,
  ) {
    let fallbackReason = 'Skill prompt resolver is not configured.';
    if (this.promptSnapshots) {
      let captured:
        | Awaited<ReturnType<SkillPromptSnapshotPort['capture']>>
        | undefined;
      try {
        captured = await this.promptSnapshots.capture({
          contentHash: revision.prompt.contentHash,
          name: revision.prompt.name,
          version: revision.prompt.version,
        });
      } catch (error) {
        if (!(error instanceof SkillPromptAuthorityUnavailableError)) {
          throw error;
        }
        fallbackReason =
          'Skill prompt authority is unavailable; using the frozen fallback.';
      }
      if (captured) {
        if (
          captured.name !== revision.prompt.name ||
          captured.version !== revision.prompt.version ||
          captured.contentHash !== revision.prompt.contentHash ||
          sha256(captured.content) !== revision.prompt.contentHash
        ) {
          fail('Skill prompt authority returned a mismatched pinned prompt.');
        }
        if (
          captured.isFallback &&
          !captured.fallbackReason?.trim()
        ) {
          fail('Skill prompt authority returned fallback content without a reason.');
        }
        return captured;
      }
    }
    if (sha256(revision.prompt.content) !== revision.prompt.contentHash) {
      fail('Frozen Skill prompt fallback does not match its pinned hash.');
    }
    return {
      content: revision.prompt.content,
      contentHash: revision.prompt.contentHash,
      fallbackReason,
      isFallback: true as const,
      label: revision.prompt.label,
      name: revision.prompt.name,
      source: revision.prompt.source,
      version: revision.prompt.version,
    };
  }
}

function isSameTriggerCondition(
  left: SkillTriggerCondition,
  right: SkillTriggerCondition,
) {
  return (
    left.harnessStage === right.harnessStage &&
    (left.industryCategory ?? null) ===
      (right.industryCategory ?? null) &&
    (left.tenantId ?? null) === (right.tenantId ?? null)
  );
}

function triggerSpecificity(condition: SkillTriggerCondition) {
  return (
    (condition.industryCategory ? 1 : 0) +
    (condition.tenantId ? 2 : 0)
  );
}

function resolvedInstruction(
  revision: SkillRevision,
  instruction: string,
  isFallback: boolean,
  fallbackReason?: string,
  promptContent?: string,
): ResolvedSkillInstruction {
  return {
    skillRevisionRef: revision.skillRevisionRef,
    instruction,
    contentHash: revision.contentHash,
    executionMode: revision.governance.executionMode,
    prompt: {
      contentHash: revision.prompt.contentHash,
      isFallback,
      name: revision.prompt.name,
      version: revision.prompt.version,
      ...(fallbackReason ? { fallbackReason } : {}),
    },
    ...(promptContent ? { promptContent } : {}),
  };
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

function validateChildEffect(
  revision: SkillRevision,
  call: {
    toolId: string;
    contextRefs: string[];
  },
) {
  const allowedTools =
    revision.formatVersion === 1
      ? revision.governance.allowedTools
      : validateSkillPermissionAuthority(revision.manifest);
  if (!allowedTools.includes(call.toolId)) {
    fail(`Tool "${call.toolId}" is outside the Skill allowlist.`);
  }
  const allowedScopes = new Set(revision.governance.contextScopes);
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

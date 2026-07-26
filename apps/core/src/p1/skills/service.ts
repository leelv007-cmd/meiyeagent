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
      throw new P1DomainError('NOT_FOUND', 'Skill catalog entry was not found.');
    }
    validateManifest(input.manifest);
    validatePrompt(input.prompt, input.instruction);
    const revision = (input.expectedRevision ?? 0) + 1;
    const record: SkillRevision = {
      skillId: catalog.skillId,
      revision,
      skillRevisionRef: skillRevisionRef(catalog.skillId, revision),
      contentHash: sha256(
        JSON.stringify({
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
    if (
      !run.passed ||
      run.results.some(
        (result) =>
          result.skillRevisionRef !== revision.skillRevisionRef ||
          result.promptRevision !==
            `${revision.prompt.name}@${revision.prompt.version}`,
      )
    ) {
      fail('Skill revision must pass its exact prompt and Skill eval gate.');
    }
    if (
      revision.prompt.source !== 'langfuse' ||
      revision.prompt.isFallback ||
      revision.prompt.label !== 'production'
    ) {
      fail('Prompt Skill acceptance requires a frozen Langfuse production revision.');
    }
    const next: SkillRevision = {
      ...revision,
      status: 'accepted_frozen',
      acceptedAt: this.now(),
      acceptedBy: required(input.actorId, 'Actor ID'),
      evalRunId: run.runId,
    };
    await this.repository.acceptRevision(next);
    const catalog = await this.repository.getCatalog(revision.skillId);
    if (!catalog) throw new P1DomainError('NOT_FOUND', 'Skill catalog not found.');
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
    await this.requireRevision(input.skillRevisionRef);
    const binding: SkillBinding = {
      bindingId: required(input.bindingId, 'Binding ID'),
      workflowRevisionRef: required(
        input.workflowRevisionRef,
        'Workflow revision',
      ),
      stage: input.stage,
      skillRevisionRef: input.skillRevisionRef,
      mode: input.mode,
      createdAt: this.now(),
    };
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
      throw new P1DomainError('NOT_FOUND', 'Source Skill binding was not found.');
    }
    const sourceRevision = await this.requireRevision(source.skillRevisionRef);
    const targetRevision = await this.requireRevision(
      input.targetSkillRevisionRef,
    );
    if (
      targetRevision.status !== 'accepted_frozen' ||
      targetRevision.skillId !== sourceRevision.skillId
    ) {
      fail('Skill rollback requires a frozen revision of the same Skill.');
    }
    return this.repository.putBinding({
      bindingId: required(input.bindingId, 'Binding ID'),
      workflowRevisionRef: required(
        input.workflowRevisionRef,
        'Workflow revision',
      ),
      stage: source.stage,
      skillRevisionRef: targetRevision.skillRevisionRef,
      mode: source.mode,
      createdAt: this.now(),
    });
  }

  async registerDeployment(input: {
    deploymentId: string;
    skillRevisionRef: string;
    provider: string;
    channel: string;
    nativeSkillId: string;
    nativeVersion: string;
    executionMode: SkillExecutionMode;
  }) {
    const revision = await this.requireRevision(input.skillRevisionRef);
    if (revision.status !== 'accepted_frozen') {
      fail('Only an accepted and frozen Skill revision can be deployed.');
    }
    if (input.executionMode !== revision.manifest.executionMode) {
      fail('Skill deployment execution mode must match the canonical revision.');
    }
    const deployment: SkillDeployment = {
      deploymentId: required(input.deploymentId, 'Deployment ID'),
      skillRevisionRef: revision.skillRevisionRef,
      provider: required(input.provider, 'Provider'),
      channel: required(input.channel, 'Channel'),
      nativeSkillId: required(input.nativeSkillId, 'Native Skill ID'),
      nativeVersion: required(input.nativeVersion, 'Native Skill version'),
      executionMode: input.executionMode,
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
      fail('Planner selected a Skill outside the current stage allowlist.');
    }
    return { allowlist, selected };
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
        budgetReservationCents: number;
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
    const fingerprint = sha256(JSON.stringify(input));
    const existingReceipt =
      await this.repository.getInvocationReceipt(invocationId);
    if (existingReceipt) {
      if (existingReceipt.inputFingerprint !== fingerprint) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill invocation ID is already bound to different facts.',
        );
      }
      return existingReceipt;
    }
    const revision = await this.requireRevision(input.skillRevisionRef);
    if (revision.status !== 'accepted_frozen') {
      fail('Only an accepted and frozen Skill revision can be invoked.');
    }
    if (input.output.target === 'content_package') {
      fail('Skill output cannot write ContentPackage.');
    }
    if (input.output.schemaRevision !== revision.manifest.outputSchemaRef) {
      fail('Skill output does not use the frozen output Schema revision.');
    }
    const validation = outputValidator.validate({
      schemaRevision: input.output.schemaRevision,
      value: input.output.value,
    });
    if (!validation.schemaValid || !validation.qualityPassed) {
      fail('Skill output failed its Schema or quality gate.');
    }
    const callIds = input.calls.map((call) => required(call.callId, 'Call ID'));
    if (
      new Set(callIds).size !== callIds.length ||
      input.calls.length > revision.manifest.budget.maxChildEffects
    ) {
      fail('Skill child effects exceed the frozen call budget.');
    }
    const reservedCost = input.calls.reduce(
      (total, call) => total + call.budgetReservationCents,
      0,
    );
    if (
      input.calls.some(
        (call) =>
          !Number.isFinite(call.budgetReservationCents) ||
          call.budgetReservationCents < 0,
      ) ||
      reservedCost > revision.manifest.budget.maxCostCents
    ) {
      fail('Skill child effects exceed the frozen cost budget.');
    }

    const effects: SkillChildEffect[] = [];
    for (const call of input.calls) {
      validateChildEffect(revision, call);
      const effectId = `${invocationId}:${call.callId}`;
      const idempotencyKey = `skill:${invocationId}:${call.callId}`;
      const effectFingerprint = sha256(
        JSON.stringify({
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
        effects.push(existing);
        continue;
      }
      const result = await executor.execute({
        callId: call.callId,
        idempotencyKey,
        toolId: call.toolId,
        contextRefs: structuredClone(call.contextRefs),
        payload: structuredClone(call.payload),
      });
      if (
        !Number.isFinite(result.costCents) ||
        result.costCents < 0 ||
        result.costCents > call.budgetReservationCents
      ) {
        fail('Skill child effect cost exceeds its own budget reservation.');
      }
      const effect: SkillChildEffect = {
        effectId,
        invocationId,
        idempotencyKey,
        fingerprint: effectFingerprint,
        toolId: call.toolId,
        contextRefs: structuredClone(call.contextRefs),
        budgetReservationCents: call.budgetReservationCents,
        providerReceipt: structuredClone(result.providerReceipt),
        usage: structuredClone(result.usage),
        costCents: result.costCents,
        settlementStatus: 'settled',
        retryStatus: 'first_attempt',
        acceptanceStatus: result.acceptanceStatus,
        createdAt: this.now(),
      };
      effects.push(await this.repository.putChildEffect(effect));
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
      throw new P1DomainError('NOT_FOUND', 'Skill revision was not found.');
    }
    return revision;
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
    fail('Prompt Skill must bind one exact prompt version and content hash.');
  }
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
    fail('Skill budget must be finite and non-negative.');
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
    fail('Skill child effect reads Context outside its declared scope.');
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { SkillFoundationModule } from './foundation-module.js';
import { MemorySkillRepository } from './repository.js';
import { SkillService } from './service.js';
import type { SkillReferenceEdge } from './types.js';

const NOW = '2026-07-30T10:00:00.000Z';
const TARGET = 'skill.reverse-dependency@3';

function edge(
  input: Pick<
    SkillReferenceEdge,
    'consumerId' | 'consumerKind' | 'scope'
  >,
): SkillReferenceEdge {
  return {
    edgeId: `${input.consumerKind}:${input.consumerId}:${TARGET}`,
    targetSkillRevisionRef: TARGET,
    consumerId: input.consumerId,
    consumerKind: input.consumerKind,
    consumerLabel: `label-${input.consumerId}`,
    scope: input.scope,
    createdAt: NOW,
  };
}

test('reverse dependencies reveal only same-workspace and proven-global details', async () => {
  const repository = new MemorySkillRepository();
  for (const reference of [
    edge({
      consumerId: 'binding-owned-by-viewer',
      consumerKind: 'workflow_binding',
      scope: { kind: 'workspace', workspaceId: 'workspace-viewer' },
    }),
    edge({
      consumerId: 'deployment-global',
      consumerKind: 'deployment',
      scope: { kind: 'global', proof: 'deployment' },
    }),
    edge({
      consumerId: 'binding-foreign-secret',
      consumerKind: 'workflow_binding',
      scope: { kind: 'workspace', workspaceId: 'workspace-foreign-secret' },
    }),
    edge({
      consumerId: 'legacy-unknown-secret',
      consumerKind: 'invocation_receipt',
      scope: { kind: 'unknown' },
    }),
  ]) {
    await repository.putReferenceEdge(reference);
  }

  const result = await new SkillService(repository, () => NOW)
    .inspectReverseDependencies({
      targetSkillRevisionRef: TARGET,
      viewerWorkspaceId: 'workspace-viewer',
    });

  assert.deepEqual(result, {
    targetSkillRevisionRef: TARGET,
    visibleDependencies: [
      {
        consumerId: 'deployment-global',
        consumerKind: 'deployment',
        consumerLabel: 'label-deployment-global',
        scopeKind: 'global',
      },
      {
        consumerId: 'binding-owned-by-viewer',
        consumerKind: 'workflow_binding',
        consumerLabel: 'label-binding-owned-by-viewer',
        scopeKind: 'workspace',
      },
    ],
    hiddenCount: 2,
    blocked: true,
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /foreign-secret|unknown-secret/u);
  assert.doesNotMatch(serialized, /workspace-foreign/u);
});

test('reference edge writes are idempotent and reject changed facts', async () => {
  const repository = new MemorySkillRepository();
  const reference = edge({
    consumerId: 'receipt-stable',
    consumerKind: 'invocation_receipt',
    scope: { kind: 'workspace', workspaceId: 'workspace-a' },
  });

  assert.deepEqual(
    await repository.putReferenceEdge(reference),
    await repository.putReferenceEdge(reference),
  );
  await assert.rejects(
    repository.putReferenceEdge({
      ...reference,
      scope: { kind: 'workspace', workspaceId: 'workspace-b' },
    }),
    /already bound to different facts/u,
  );
});

test('Foundation reverse dependency query derives the viewer from trusted context', async () => {
  const repository = new MemorySkillRepository();
  await repository.putReferenceEdge(
    edge({
      consumerId: 'binding-context-owned',
      consumerKind: 'workflow_binding',
      scope: { kind: 'workspace', workspaceId: 'workspace-context' },
    }),
  );
  await repository.putReferenceEdge(
    edge({
      consumerId: 'binding-payload-foreign',
      consumerKind: 'workflow_binding',
      scope: { kind: 'workspace', workspaceId: 'workspace-payload' },
    }),
  );
  const module = new SkillFoundationModule(
    new SkillService(repository, () => NOW),
  );
  const context = {
    actor: 'admin' as const,
    correlationId: 'corr-reverse-dependencies',
    userId: 'operator-reverse-dependencies',
    workspaceId: 'workspace-context',
  };

  const result = await module.query({
    context,
    input: {
      action: 'skill_reverse_dependencies',
      payload: { skillRevisionRef: TARGET },
    },
  });
  assert.deepEqual(result, {
    targetSkillRevisionRef: TARGET,
    visibleDependencies: [
      {
        consumerId: 'binding-context-owned',
        consumerKind: 'workflow_binding',
        consumerLabel: 'label-binding-context-owned',
        scopeKind: 'workspace',
      },
    ],
    hiddenCount: 1,
    blocked: true,
  });

  for (const injected of [
    { viewerWorkspaceId: 'workspace-payload' },
    { workspaceId: 'workspace-payload' },
    { consumerKind: 'workflow_binding' },
  ]) {
    await assert.rejects(
      module.query({
        context,
        input: {
          action: 'skill_reverse_dependencies',
          payload: { skillRevisionRef: TARGET, ...injected },
        },
      }),
      /不支持字段/u,
    );
  }
});

test('Foundation bind records context workspace ownership instead of trigger tenant', async () => {
  const repository = new MemorySkillRepository();
  await repository.putCatalog({
    skillId: 'skill.reverse-dependency',
    name: 'Reverse dependency fixture',
    description: 'Foundation ownership fixture.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'backend_only',
    activeRevisionRef: TARGET,
    publicationGeneration: 0,
    createdAt: NOW,
    updatedAt: NOW,
    actorId: 'operator-owner',
  });
  await repository.putRevision(
    {
      formatVersion: 2,
      skillId: 'skill.reverse-dependency',
      revision: 3,
      skillRevisionRef: TARGET,
      contentHash: 'hash-reverse-dependency',
      instruction: 'Use the reverse dependency fixture.',
      manifest: {
        name: 'reverse-dependency-fixture',
        description: 'Foundation ownership fixture.',
      },
      governance: {
        inputSchemaRef: 'skill-input.daily-industry@1',
        outputSchemaRef: 'skill-output.intent-decision@1',
        contextScopes: [],
        sideEffectClass: 'none',
        requiredModelCapabilities: [],
        executionMode: 'prompt_materialized',
        budget: {
          maxChildEffects: 0,
          maxCostCents: 0,
          timeoutMs: 1_000,
        },
        workflowRevisionRefs: ['workflow.copy@4'],
        fallback: 'skip',
      },
      packagePaths: ['SKILL.md'],
      prompt: {
        name: 'harness/intent-naming',
        version: 'fixture',
        contentHash: 'prompt-hash',
        content: 'Fixture prompt.',
        label: 'production',
        source: 'langfuse',
        isFallback: false,
      },
      status: 'accepted_frozen',
      createdAt: NOW,
      createdBy: 'operator-owner',
      acceptedAt: NOW,
      acceptedBy: 'operator-owner',
      evalRunId: 'eval-reverse-dependency',
    },
    null,
  );
  const module = new SkillFoundationModule(
    new SkillService(repository, () => NOW),
  );
  const ownerContext = {
    actor: 'admin' as const,
    correlationId: 'corr-bind-owner',
    userId: 'operator-owner',
    workspaceId: 'workspace-owner',
  };
  await module.execute({
    context: ownerContext,
    idempotencyKey: 'bind-owner',
    input: {
      action: 'skill_bind',
      payload: {
        bindingId: 'binding-context-owner',
        workflowRevisionRef: 'workflow.copy@4',
        triggerCondition: {
          harnessStage: 'intent_naming',
          industryCategory: null,
          tenantId: 'workspace-trigger-is-not-owner',
        },
        skillRevisionRef: TARGET,
        mode: 'required',
      },
    },
  });

  const ownerView = await module.query({
    context: ownerContext,
    input: {
      action: 'skill_reverse_dependencies',
      payload: { skillRevisionRef: TARGET },
    },
  });
  assert.deepEqual(ownerView, {
    targetSkillRevisionRef: TARGET,
    visibleDependencies: [
      {
        consumerId: 'binding-context-owner',
        consumerKind: 'workflow_binding',
        consumerLabel: 'workflow.copy@4',
        scopeKind: 'workspace',
      },
    ],
    hiddenCount: 0,
    blocked: true,
  });

  const triggerWorkspaceView = await module.query({
    context: {
      ...ownerContext,
      workspaceId: 'workspace-trigger-is-not-owner',
    },
    input: {
      action: 'skill_reverse_dependencies',
      payload: { skillRevisionRef: TARGET },
    },
  });
  assert.deepEqual(triggerWorkspaceView, {
    targetSkillRevisionRef: TARGET,
    visibleDependencies: [],
    hiddenCount: 1,
    blocked: true,
  });
});

test('binding, deployment, and invocation writes atomically index their references', async () => {
  const repository = new MemorySkillRepository();
  const binding = {
    bindingId: 'binding-indexed',
    workflowRevisionRef: 'workflow.copy@4',
    triggerCondition: {
      harnessStage: 'intent_naming' as const,
      industryCategory: null,
      tenantId: 'workspace-a',
    },
    ownerWorkspaceId: 'workspace-a',
    skillId: 'skill.reverse-dependency',
    skillRevisionRef: TARGET,
    mode: 'required' as const,
    status: 'active' as const,
    supersededAt: null,
    supersededByBindingId: null,
    createdAt: NOW,
  };
  const legacyUnscopedBinding = {
    ...binding,
    bindingId: 'binding-indexed-global',
    triggerCondition: {
      ...binding.triggerCondition,
      tenantId: null,
    },
    ownerWorkspaceId: undefined,
  };
  const deployment = {
    deploymentId: 'deployment-indexed',
    skillRevisionRef: TARGET,
    provider: 'internal',
    channel: 'prompt',
    nativeSkillId: 'skill-reverse-dependency',
    nativeVersion: '3',
    executionMode: 'prompt_materialized' as const,
    packagePaths: ['SKILL.md'],
    rolloutEvidenceRef: null,
    createdAt: NOW,
  };
  const receipt = {
    invocationId: 'invocation-indexed',
    workspaceId: 'workspace-b',
    taskId: 'task-indexed',
    productUsageTaskId: 'usage-task-indexed',
    skillRevisionRef: TARGET,
    childEffectIds: [],
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    status: 'settled' as const,
    createdAt: NOW,
    inputFingerprint: 'fingerprint-indexed',
  };

  await repository.putBinding(binding);
  await repository.putBinding(legacyUnscopedBinding);
  await repository.putDeployment(deployment, {
    kind: 'global',
    proof: 'deployment',
  });
  await repository.putInvocationReceipt(receipt);
  await repository.putBinding(binding);
  await repository.putDeployment(deployment, {
    kind: 'global',
    proof: 'deployment',
  });
  await repository.putInvocationReceipt(receipt);

  assert.deepEqual(
    await new SkillService(repository, () => NOW).inspectReverseDependencies({
      targetSkillRevisionRef: TARGET,
      viewerWorkspaceId: 'workspace-a',
    }),
    {
      targetSkillRevisionRef: TARGET,
      visibleDependencies: [
        {
          consumerId: 'deployment-indexed',
          consumerKind: 'deployment',
          consumerLabel: 'internal/prompt',
          scopeKind: 'global',
        },
        {
          consumerId: 'binding-indexed',
          consumerKind: 'workflow_binding',
          consumerLabel: 'workflow.copy@4',
          scopeKind: 'workspace',
        },
      ],
      hiddenCount: 2,
      blocked: true,
    },
  );
});

test('retirement is blocked atomically by dependencies and succeeds only when clear', async () => {
  const repository = new MemorySkillRepository();
  const blockedRef = await seedRetirementTarget(
    repository,
    'skill.retirement-blocked',
  );
  const clearRef = await seedRetirementTarget(
    repository,
    'skill.retirement-clear',
  );
  await repository.putReferenceEdge({
    edgeId: `skill-reference:workflow_binding:binding-retirement:${blockedRef}`,
    targetSkillRevisionRef: blockedRef,
    consumerKind: 'workflow_binding',
    consumerId: 'binding-retirement',
    consumerLabel: 'workflow.copy@retirement',
    scope: { kind: 'workspace', workspaceId: 'workspace-retirement' },
    createdAt: NOW,
  });
  const service = new SkillService(repository, () => NOW);
  const module = new SkillFoundationModule(service);
  const context = {
    actor: 'admin' as const,
    correlationId: 'corr-retirement',
    userId: 'operator-retirement',
    workspaceId: 'workspace-retirement',
  };

  const blocked = await module.execute({
    context,
    idempotencyKey: 'retire-blocked',
    input: {
      action: 'skill_retire',
      payload: {
        runId: 'retire-blocked',
        skillRevisionRef: blockedRef,
      },
    },
  });
  assert.deepEqual(blocked, {
    applied: false,
    runId: 'retire-blocked',
    success: true,
    validationResults: [
      {
        fieldPath: 'lifecycle.status',
        reasonCode: 'dependency_blocked',
        status: 'not_applied',
      },
    ],
  });
  assert.equal(
    (await repository.getRevision(blockedRef))?.status,
    'accepted_frozen',
  );

  const retired = await module.execute({
    context,
    idempotencyKey: 'retire-clear',
    input: {
      action: 'skill_retire',
      payload: {
        runId: 'retire-clear',
        skillRevisionRef: clearRef,
      },
    },
  });
  assert.deepEqual(retired, {
    applied: true,
    runId: 'retire-clear',
    success: true,
    validationResults: [
      {
        fieldPath: 'lifecycle.status',
        reasonCode: 'field_applied',
        status: 'applied',
      },
    ],
  });
  assert.equal((await repository.getRevision(clearRef))?.status, 'retired');
  assert.deepEqual(
    await service.retireRevision({
      actorId: context.userId,
      runId: 'retire-clear',
      skillRevisionRef: clearRef,
      workspaceId: context.workspaceId,
    }),
    retired,
  );
  await assert.rejects(
    service.retireRevision({
      actorId: 'operator-other',
      runId: 'retire-clear',
      skillRevisionRef: clearRef,
      workspaceId: context.workspaceId,
    }),
    /different facts/u,
  );
});

async function seedRetirementTarget(
  repository: MemorySkillRepository,
  skillId: string,
) {
  const skillRevisionRef = `${skillId}@1`;
  await repository.putCatalog({
    activeRevisionRef: null,
    actorId: 'operator-seed',
    createdAt: NOW,
    description: 'Retirement behavior fixture.',
    name: skillId,
    presentationPolicy: 'backend_only',
    publicationGeneration: 0,
    skillId,
    sourceKind: 'authored',
    tier: 'platform',
    updatedAt: NOW,
  });
  await repository.putRevision(
    {
      acceptedAt: NOW,
      acceptedBy: 'operator-seed',
      contentHash: `content-${skillId}`,
      createdAt: NOW,
      createdBy: 'operator-seed',
      evalRunId: `eval-${skillId}`,
      formatVersion: 2,
      governance: {
        budget: {
          maxChildEffects: 0,
          maxCostCents: 0,
          timeoutMs: 1_000,
        },
        contextScopes: [],
        executionMode: 'prompt_materialized',
        fallback: 'skip',
        inputSchemaRef: 'skill-input.daily-industry@1',
        outputSchemaRef: 'skill-output.intent-decision@1',
        requiredModelCapabilities: [],
        sideEffectClass: 'none',
        workflowRevisionRefs: ['workflow.copy@1'],
      },
      instruction: 'Retirement fixture instruction.',
      manifest: {
        description: 'Retirement behavior fixture.',
        name: skillId,
      },
      packagePaths: ['SKILL.md'],
      prompt: {
        content: 'Retirement prompt.',
        contentHash: 'retirement-prompt-hash',
        isFallback: false,
        label: 'production',
        name: 'harness/intent-naming',
        source: 'langfuse',
        version: '1',
      },
      revision: 1,
      skillId,
      skillRevisionRef,
      status: 'accepted_frozen',
    },
    null,
  );
  return skillRevisionRef;
}

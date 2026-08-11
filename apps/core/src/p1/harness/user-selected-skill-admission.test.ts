/**
 * Spec E / #379 — production admission injects merchant skill selection and
 * freezes it into the assembly snapshot.
 *
 * Red seam: prove the production select port must forward
 * `userSelectedSkillRefs` (omission leaves user_selected empty). Stage resolver
 * unit coverage in skill-service.test.ts remains baseline and is not re-tested
 * here.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { EvalRun } from '../../contracts/index.js';
import type { RouteSnapshot } from '../model-supply/index.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  createCreationExecutionSnapshot,
} from '../execution-spine/creation-execution-snapshot.js';
import {
  MemorySkillRepository,
  SkillService,
  UserSelectedSkillIneligibleError,
  type SkillBinding,
  type SkillCatalog,
  type SkillGovernanceSidecar,
  type SkillRevision,
} from '../skills/index.js';
import { DurableSkillInstructionResolver } from '../skills/runtime.js';
import type { HarnessFrozenPrompt } from './langfuse-prompts.js';
import {
  HARNESS_LANGFUSE_PROMPT_NAMES,
  type HarnessFrozenPrompts,
  type HarnessPromptResolver,
} from './langfuse-prompts.js';
import { createProductionSkillManifestResolver } from './production-skill-manifest-resolver.js';
import {
  COPY_TASK_PROMPT_PACK_IDS,
  promptKeysForPacks,
} from './prompt-packs.js';
import {
  HarnessAdmissionError,
  HarnessTaskAdmissionService,
  type HarnessExecutionBoundsResolver,
  type HarnessFrozenRouteSnapshotResolver,
  type HarnessSkillManifestResolver,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowStarter,
} from './task-admission.js';

const NOW = '2026-08-07T12:00:00.000Z';
const WORKSPACE = 'workspace-admission-379';
const COPY_WORKFLOW = 'workflow.copy@1';
const WORKFLOW_REVISION = 1;

const promptSnapshotsByReference = new Map<string, HarnessFrozenPrompt>();
const promptSnapshots = {
  async capture(reference: {
    contentHash: string;
    name: string;
    version: string;
  }) {
    const snapshot = promptSnapshotsByReference.get(promptKey(reference));
    assert.ok(snapshot, 'Test prompt snapshot must be registered.');
    return snapshot;
  },
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function promptKey(reference: {
  contentHash: string;
  name: string;
  version: string;
}) {
  return `${reference.name}\u0000${reference.version}\u0000${reference.contentHash}`;
}

function registerPrompt(
  content: string,
  name: string,
  version = '1',
): { contentHash: string; name: string; version: string } {
  const prompt: HarnessFrozenPrompt = {
    content,
    contentHash: sha256(content),
    isFallback: false,
    label: 'production',
    name,
    source: 'langfuse',
    version,
  };
  promptSnapshotsByReference.set(promptKey(prompt), prompt);
  return {
    contentHash: prompt.contentHash,
    name: prompt.name,
    version: prompt.version,
  };
}

function governance(
  workflowRevisionRefs: readonly string[] = [COPY_WORKFLOW],
): SkillGovernanceSidecar {
  return {
    budget: {
      maxChildEffects: 1,
      maxCostCents: 1,
      timeoutMs: 5_000,
    },
    contextScopes: ['facts'],
    executionMode: 'prompt_materialized',
    fallback: 'skip',
    inputSchemaRef: 'skill-input.daily-industry@1',
    outputSchemaRef: 'skill-output.intent-decision@1',
    requiredModelCapabilities: ['structured_output'],
    sideEffectClass: 'none',
    workflowRevisionRefs: [...workflowRevisionRefs],
  };
}

function skillEvalRun(
  skillRevisionRef: string,
  skillId: string,
  prompt: { name: string; version: string },
): EvalRun {
  return {
    createdAt: NOW,
    mode: 'recorded_fixture',
    passed: true,
    results: [
      {
        caseId: `case-${skillId}`,
        gateId: 'skill_revision_acceptance',
        memoryDiff: null,
        passed: true,
        promptRevision: `${prompt.name}@${prompt.version}`,
        reason: 'fixture pass',
        scorerRevision: 'skill-routing-scorer@1',
        skillRevisionRef,
      },
    ],
    runId: `eval-${skillId}`,
    schemaVersion: 'eval-run/v1',
    suiteId: `suite-${skillId}`,
    suiteRevision: `suite-${skillId}@1`,
  };
}

async function publishSkill(input: {
  service: SkillService;
  skillId: string;
  name: string;
  description: string;
  presentationPolicy: SkillCatalog['presentationPolicy'];
  instruction?: string;
}): Promise<SkillRevision> {
  await input.service.defineCatalogEntry({
    actorId: 'operator-1',
    description: input.description,
    name: input.name,
    presentationPolicy: input.presentationPolicy,
    skillId: input.skillId,
    sourceKind: 'authored',
    tier: 'platform',
  });
  const instruction =
    input.instruction ?? `Admission fixture instruction for ${input.skillId}.`;
  const prompt = registerPrompt(instruction, `skills/${input.skillId}`);
  const draft = await input.service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: null,
    governance: governance(),
    instruction,
    manifest: {
      description: input.description,
      name: input.skillId.replaceAll('.', '-'),
    },
    promptReference: prompt,
    skillId: input.skillId,
  });
  const run = skillEvalRun(draft.skillRevisionRef, input.skillId, prompt);
  const repository = Reflect.get(
    input.service,
    'repository',
  ) as MemorySkillRepository;
  await repository.putImmutable(run.runId, run);
  const frozen = await input.service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
  await input.service.publishAcceptedRevision({
    actorId: 'operator-2',
    expectedPublicationGeneration: 0,
    expectedPublishedRevisionRef: null,
    runId: `publish-${input.skillId}-${frozen.skillRevisionRef}`,
    skillId: input.skillId,
    targetSkillRevisionRef: frozen.skillRevisionRef,
    workspaceId: WORKSPACE,
  });
  return frozen;
}

async function bindSkill(input: {
  service: SkillService;
  bindingId: string;
  skillRevisionRef: string;
  mode: SkillBinding['mode'];
  stage?: SkillBinding['triggerCondition']['harnessStage'];
}) {
  return input.service.bindRevision({
    bindingId: input.bindingId,
    mode: input.mode,
    skillRevisionRef: input.skillRevisionRef,
    workflowRevisionRef: COPY_WORKFLOW,
    triggerCondition: {
      harnessStage: input.stage ?? 'intent_naming',
    },
  });
}

function createSkillStack() {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, promptSnapshots);
  const recipes = {
    async getRecipeByRevisionId(revisionId: string) {
      if (
        revisionId === 'recipe-r1' ||
        revisionId === 'recipe-1@recipe-r1' ||
        revisionId === 'recipe-1'
      ) {
        return { workflowRevisionRef: COPY_WORKFLOW };
      }
      return null;
    },
  };
  const instructionResolver = new DurableSkillInstructionResolver(
    service,
    recipes as never,
  );
  return { repository, service, instructionResolver };
}

function composerSnapshot(input?: {
  taskId?: string;
  userSelectedSkillRefs?: string[];
  idempotencyKey?: string;
}) {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: WORKSPACE,
      idempotencyKey: input?.idempotencyKey ?? 'composer-key-379',
      taskId: input?.taskId ?? 'task-379',
      workId: 'work-379',
      contentPackageId: 'package-379',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '为夏日护理项目写一条预约文案',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy' as const,
      platform: { id: 'douyin' as const },
      deliverables: [
        { id: 'copy-primary', kind: 'copy' as const, quantity: 1, order: 1 },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-1',
        revision: 'policy-r1',
        mode: 'fixed' as const,
      },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      contentModules: ['social_cover' as const],
      ...(input?.userSelectedSkillRefs
        ? { userSelectedSkillRefs: input.userSelectedSkillRefs }
        : {}),
    },
    NOW,
  );
}

function snapshotTaskRequest(
  snapshot: ReturnType<typeof composerSnapshot>,
) {
  return {
    taskId: snapshot.task.id,
    actorId: snapshot.actorId,
    workspaceId: snapshot.workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: WORKFLOW_REVISION,
    creationMode: snapshot.creationMode,
    rawInput: snapshot.intent.text,
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    userSelectedSkillRefs: snapshot.userSelectedSkillRefs,
    executionSnapshot: snapshot,
    usageReservation: {
      id: `usage-reservation-${snapshot.task.id}`,
      units: [],
    },
  };
}

function copyRoute(snapshot: ReturnType<typeof composerSnapshot>): RouteSnapshot {
  return {
    id: snapshot.route.id,
    catalogRevisionId: snapshot.route.revision,
    capabilityRevisionId: 'capability-copy-r1',
    requestedSelection: {
      mode: 'fixed',
      catalogModelId: snapshot.catalogModel.id,
    },
    candidateCatalogModelIds: [snapshot.catalogModel.id],
    actualCatalogModelId: snapshot.catalogModel.id,
    deploymentId: 'deployment-copy-1',
    policyRevision: snapshot.modelPolicy.revision,
    priceRevision: 'price-r1',
    credentialMode: 'platform',
    credentialVersion: 'credential-r1',
    fallbackConsent: false,
    reason: 'fixed_selection',
    dataClass: [],
    createdAt: NOW,
  };
}

class MemoryRequestRegistry implements HarnessTaskRequestRegistry {
  readonly claims: Array<{ taskId: string; fingerprint: string }> = [];
  readonly lookups: Array<{ taskId: string; fingerprint: string }> = [];
  private readonly fingerprints = new Map<string, string>();
  private readonly requests = new Map<
    string,
    Parameters<HarnessTaskRequestRegistry['claim']>[0]['request']
  >();

  async lookup(
    input: Parameters<NonNullable<HarnessTaskRequestRegistry['lookup']>>[0],
  ) {
    this.lookups.push(input);
    const existing = this.fingerprints.get(input.taskId);
    if (existing === undefined) return null;
    if (existing !== input.fingerprint) return { kind: 'conflict' as const };
    return {
      kind: 'existing' as const,
      workflowId: input.taskId,
      runtimeId: `legacy-${input.taskId}`,
      request: structuredClone(this.requests.get(input.taskId)!),
    };
  }

  async claim(input: Parameters<HarnessTaskRequestRegistry['claim']>[0]) {
    this.claims.push(input);
    const existing = this.fingerprints.get(input.taskId);
    if (existing === undefined) {
      this.fingerprints.set(input.taskId, input.fingerprint);
      this.requests.set(input.taskId, structuredClone(input.request));
      return { kind: 'created' as const };
    }
    if (existing === input.fingerprint) {
      return {
        kind: 'existing' as const,
        workflowId: input.taskId,
        runtimeId: `legacy-${input.taskId}`,
        request: structuredClone(this.requests.get(input.taskId)!),
      };
    }
    return { kind: 'conflict' as const };
  }

  frozenRequest(taskId: string) {
    return this.requests.get(taskId);
  }
}

class RecordingStarter implements HarnessWorkflowStarter {
  starts = 0;
  readonly requests: Array<
    Parameters<HarnessWorkflowStarter['start']>[0]['request']
  > = [];

  async start(input: Parameters<HarnessWorkflowStarter['start']>[0]) {
    this.starts += 1;
    this.requests.push(structuredClone(input.request));
    return { workflowId: input.workflowId };
  }
}

class FixedPromptResolver implements HarnessPromptResolver {
  async resolve(): Promise<HarnessFrozenPrompts> {
    return Object.fromEntries(
      Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => [
        key,
        {
          name,
          version: '7',
          content: `${key}-v7`,
          contentHash: sha256(`${key}-v7`),
          label: 'production',
          source: 'langfuse' as const,
          isFallback: false,
        },
      ]),
    ) as HarnessFrozenPrompts;
  }
}

function routeResolver(
  snapshot: ReturnType<typeof composerSnapshot>,
): HarnessFrozenRouteSnapshotResolver {
  const route = copyRoute(snapshot);
  return {
    async resolve(_input, assembly) {
      return {
        ...structuredClone(route),
        capabilityRequirements: structuredClone(assembly?.requirements ?? []),
        capabilityMatches: (assembly?.requirements ?? []).map((requirement) => ({
          axisId: requirement.axisId,
          deploymentId: route.deploymentId,
          outcome: 'eligible' as const,
          reasons: [],
          evidenceRefs: [`catalog://${requirement.axisId}`],
        })),
      };
    },
  };
}

const defaultBounds: HarnessExecutionBoundsResolver = {
  async resolve() {
    return {
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: [],
    };
  },
};

/**
 * Historical production select that omitted userSelectedSkillRefs — the red
 * seam #379 must close. Kept only as a negative control in this test file.
 */
function legacyProductionSelectWithoutSelection(
  instructionResolver: DurableSkillInstructionResolver,
): HarnessSkillManifestResolver {
  return {
    async select({ request, stage }) {
      const recipe = request.executionSnapshot?.recipe;
      return instructionResolver.selectManifests({
        workspaceId: request.workspaceId,
        workflowId: request.executionSnapshot?.task.id ?? request.packageId,
        workflowRevision: request.workflowRevision,
        ...(recipe
          ? {
              recipeId: recipe.id,
              recipeRevisionId: recipe.revision,
            }
          : {}),
        stage,
        // Intentionally omit userSelectedSkillRefs (pre-#379 bug).
      });
    },
    async materialize({ manifests }) {
      return instructionResolver.materializeManifests(manifests);
    },
  };
}

// ---------------------------------------------------------------------------
// Red seam at production admission select
// ---------------------------------------------------------------------------

test('production admission seam: missing userSelectedSkillRefs keeps user_selected out of manifest', async () => {
  const { service, instructionResolver } = createSkillStack();
  const selected = await publishSkill({
    service,
    skillId: 'skill.user-selectable-seam',
    name: 'Story structure',
    description: '创作增强：结构化故事线。',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.user-selectable-seam',
    skillRevisionRef: selected.skillRevisionRef,
    mode: 'user_selected',
  });

  const snapshot = composerSnapshot({
    taskId: 'task-seam-red',
    userSelectedSkillRefs: [selected.skillRevisionRef],
  });
  const request = snapshotTaskRequest(snapshot);

  // Negative control: pre-#379 production select drops the merchant selection.
  const legacy = legacyProductionSelectWithoutSelection(instructionResolver);
  const legacyManifests = await legacy.select({
    request,
    stage: 'intent_naming',
  });
  assert.equal(
    legacyManifests.some(
      (manifest) => manifest.skillRevisionRef === selected.skillRevisionRef,
    ),
    false,
    'legacy production select must leave user_selected empty when refs are not forwarded',
  );

  // Production port (the real seam) must inject the selection.
  const production = createProductionSkillManifestResolver(instructionResolver);
  const productionManifests = await production.select({
    request,
    stage: 'intent_naming',
  });
  assert.equal(
    productionManifests.some(
      (manifest) => manifest.skillRevisionRef === selected.skillRevisionRef,
    ),
    true,
    'production select must inject merchant-selected user_selected skills',
  );
  assert.equal(
    productionManifests.find(
      (manifest) => manifest.skillRevisionRef === selected.skillRevisionRef,
    )?.contentHash,
    selected.contentHash,
  );
});

test('production select with empty selection excludes user_selected (negative unselected)', async () => {
  const { service, instructionResolver } = createSkillStack();
  const selected = await publishSkill({
    service,
    skillId: 'skill.user-selectable-empty',
    name: 'Tone pack',
    description: '语气增强。',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.user-selectable-empty',
    skillRevisionRef: selected.skillRevisionRef,
    mode: 'user_selected',
  });

  const snapshot = composerSnapshot({
    taskId: 'task-seam-empty',
    // default [] — merchant did not confirm the pill
  });
  const production = createProductionSkillManifestResolver(instructionResolver);
  const manifests = await production.select({
    request: snapshotTaskRequest(snapshot),
    stage: 'intent_naming',
  });
  assert.equal(
    manifests.some(
      (manifest) => manifest.skillRevisionRef === selected.skillRevisionRef,
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Admission freeze: selection, stages, route digest, prompts, axes, audit
// ---------------------------------------------------------------------------

test('admission freezes selection, skill stages, route digest, prompts, catalog revision and root axes', async () => {
  const { service, instructionResolver } = createSkillStack();
  const required = await publishSkill({
    service,
    skillId: 'skill.required-freeze',
    name: 'Required base',
    description: 'Platform required skill.',
    presentationPolicy: 'backend_only',
  });
  await bindSkill({
    service,
    bindingId: 'binding.required-freeze',
    skillRevisionRef: required.skillRevisionRef,
    mode: 'required',
  });
  const selectable = await publishSkill({
    service,
    skillId: 'skill.selectable-freeze',
    name: 'Selectable pack',
    description: 'Merchant optional pack.',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.selectable-freeze',
    skillRevisionRef: selectable.skillRevisionRef,
    mode: 'user_selected',
  });

  const snapshot = composerSnapshot({
    taskId: 'task-freeze-379',
    userSelectedSkillRefs: [selectable.skillRevisionRef],
  });
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const assemblyAudits: unknown[] = [];
  const serviceAdmission = new HarnessTaskAdmissionService(
    registry,
    starter,
    new FixedPromptResolver(),
    undefined,
    defaultBounds,
    routeResolver(snapshot),
    createProductionSkillManifestResolver(instructionResolver),
    {
      async appendAuditIdempotently(event) {
        assemblyAudits.push(structuredClone(event));
      },
    },
  );

  await serviceAdmission.submit(snapshotTaskRequest(snapshot));

  const frozen = starter.requests[0]!;
  assert.deepEqual(frozen.userSelectedSkillRefs, [selectable.skillRevisionRef]);
  assert.deepEqual(frozen.executionSnapshot?.userSelectedSkillRefs, [
    selectable.skillRevisionRef,
  ]);

  const intentStage = frozen.executionAssembly!.skillStages.intent_naming;
  const intentRefs = intentStage.map((entry) => entry.skillRevisionRef).sort();
  assert.deepEqual(intentRefs, [
    required.skillRevisionRef,
    selectable.skillRevisionRef,
  ].sort());
  assert.equal(
    intentStage.find(
      (entry) => entry.skillRevisionRef === selectable.skillRevisionRef,
    )?.contentHash,
    selectable.contentHash,
  );
  assert.ok(
    intentStage.every((entry) => entry.resolvedInstruction),
    'each stage manifest freezes resolved instruction material',
  );

  // Other stages stay empty for this binding matrix.
  for (const stage of [
    'context_injection',
    'brief_compilation',
    'execution_selection',
    'assembly_delivery',
  ] as const) {
    assert.deepEqual(frozen.executionAssembly!.skillStages[stage], []);
  }

  assert.equal(
    frozen.executionAssembly!.frozenRouteSnapshotDigest,
    fingerprintValue(frozen.frozenRouteSnapshot),
  );
  assert.ok(frozen.promptRevisionRefs);
  // V31-20 selective freeze: a pure-copy task pins its declared packs and
  // nothing else, so the assertion is the pack set — not the whole registry.
  const copyPromptKeys = promptKeysForPacks(COPY_TASK_PROMPT_PACK_IDS);
  assert.deepEqual(
    Object.keys(frozen.promptRevisionRefs!).sort(),
    [...copyPromptKeys].sort(),
  );
  for (const key of copyPromptKeys) {
    assert.ok(
      frozen.promptRevisionRefs![key],
      `declared pack prompt ${key} must be frozen on the request`,
    );
  }
  assert.deepEqual(frozen.executionAssembly!.rootAxes.catalogRevision, {
    kind: 'bound',
    value: snapshot.catalogModel.revision,
  });
  assert.equal(frozen.executionAssembly!.rootAxes.scene.kind, 'bound');
  // Root skill axis binds only a single revision ref; multi-skill sets are
  // frozen on skillStages with content hashes (D-165 single-value axis).
  assert.equal(frozen.executionAssembly!.rootAxes.skillRevision.kind, 'absent');
  // Prompt axis is multi-key at admission → absent on root; refs are frozen.
  assert.equal(frozen.executionAssembly!.rootAxes.promptVersion.kind, 'absent');
  assert.deepEqual(
    frozen.executionAssembly!.promptRevisionRefs,
    frozen.promptRevisionRefs,
  );

  const taskPin = assemblyAudits.at(-1) as {
    payload: {
      skillRevision: string | null;
      promptVersion: string | null;
      catalogRevision: string | null;
      scene: string | null;
      axisScope: string;
      payload: { primitiveId: string };
    };
  };
  assert.equal(taskPin.payload.axisScope, 'task_root');
  assert.equal(
    taskPin.payload.catalogRevision,
    snapshot.catalogModel.revision,
  );
  assert.ok(taskPin.payload.scene);
  assert.equal(taskPin.payload.skillRevision, null);
  assert.equal(taskPin.payload.promptVersion, null);
  assert.equal(
    taskPin.payload.payload.primitiveId,
    'harness-assembly:task_pin',
  );
  // Audit carries axes + scene at pin time — no export-time backfill.
  assert.equal(assemblyAudits.length, 4);
});

// ---------------------------------------------------------------------------
// Resume reuses frozen content hash after new Skill publish
// ---------------------------------------------------------------------------

test('resume reuses frozen skill content hash after a newer Skill is published', async () => {
  const { service, instructionResolver, repository } = createSkillStack();
  const first = await publishSkill({
    service,
    skillId: 'skill.selectable-resume',
    name: 'Resume pack',
    description: 'v1 pack',
    presentationPolicy: 'user_selectable',
    instruction: 'Resume pack instruction v1.',
  });
  await bindSkill({
    service,
    bindingId: 'binding.selectable-resume',
    skillRevisionRef: first.skillRevisionRef,
    mode: 'user_selected',
  });

  const snapshot = composerSnapshot({
    taskId: 'task-resume-379',
    userSelectedSkillRefs: [first.skillRevisionRef],
  });
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const admission = new HarnessTaskAdmissionService(
    registry,
    starter,
    new FixedPromptResolver(),
    undefined,
    defaultBounds,
    routeResolver(snapshot),
    createProductionSkillManifestResolver(instructionResolver),
  );

  await admission.submit(snapshotTaskRequest(snapshot));
  const firstAssembly = starter.requests[0]!.executionAssembly!;
  const frozenHash = firstAssembly.skillStages.intent_naming.find(
    (entry) => entry.skillRevisionRef === first.skillRevisionRef,
  )?.contentHash;
  assert.equal(frozenHash, first.contentHash);

  // Publish a newer revision of the same skill and rebind.
  const v2Instruction = 'Resume pack instruction v2 — must not affect in-flight.';
  const prompt = registerPrompt(
    v2Instruction,
    `skills/skill.selectable-resume`,
    '2',
  );
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: 1,
    governance: governance(),
    instruction: v2Instruction,
    manifest: {
      description: 'v2 pack',
      name: 'skill-selectable-resume',
    },
    promptReference: prompt,
    skillId: 'skill.selectable-resume',
  });
  const run = skillEvalRun(draft.skillRevisionRef, 'skill.selectable-resume-v2', prompt);
  await repository.putImmutable(run.runId, run);
  const second = await service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
  await service.publishAcceptedRevision({
    actorId: 'operator-2',
    expectedPublicationGeneration: 1,
    expectedPublishedRevisionRef: first.skillRevisionRef,
    runId: 'publish-skill.selectable-resume-v2',
    skillId: 'skill.selectable-resume',
    targetSkillRevisionRef: second.skillRevisionRef,
    workspaceId: WORKSPACE,
  });
  // Supersede the binding to the new head (new tasks will select v2).
  await service.rollbackBinding({
    bindingId: 'binding.selectable-resume-v2',
    sourceBindingId: 'binding.selectable-resume',
    targetSkillRevisionRef: second.skillRevisionRef,
    workflowRevisionRef: COPY_WORKFLOW,
  });
  assert.notEqual(second.contentHash, first.contentHash);

  // Replay original task — still frozen on v1.
  const replay = await admission.submit(snapshotTaskRequest(snapshot));
  assert.equal(replay.replayed, true);
  const replayed = starter.requests[1]!.executionAssembly!;
  assert.equal(
    replayed.skillStages.intent_naming.find(
      (entry) => entry.skillRevisionRef === first.skillRevisionRef,
    )?.contentHash,
    first.contentHash,
  );

  // New task reads the new published head when selected.
  const newSnapshot = composerSnapshot({
    taskId: 'task-resume-379-new',
    userSelectedSkillRefs: [second.skillRevisionRef],
    idempotencyKey: 'composer-key-379-new',
  });
  await admission.submit(snapshotTaskRequest(newSnapshot));
  const newAssembly = starter.requests[2]!.executionAssembly!;
  assert.equal(
    newAssembly.skillStages.intent_naming.find(
      (entry) => entry.skillRevisionRef === second.skillRevisionRef,
    )?.contentHash,
    second.contentHash,
  );
});

// ---------------------------------------------------------------------------
// Idempotency: same selection replays; different selection conflicts
// ---------------------------------------------------------------------------

test('same task and same selection replays; different selection is fingerprint conflict', async () => {
  const { service, instructionResolver } = createSkillStack();
  const a = await publishSkill({
    service,
    skillId: 'skill.selectable-a',
    name: 'Pack A',
    description: 'A',
    presentationPolicy: 'user_selectable',
  });
  const b = await publishSkill({
    service,
    skillId: 'skill.selectable-b',
    name: 'Pack B',
    description: 'B',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.selectable-a',
    skillRevisionRef: a.skillRevisionRef,
    mode: 'user_selected',
  });
  await bindSkill({
    service,
    bindingId: 'binding.selectable-b',
    skillRevisionRef: b.skillRevisionRef,
    mode: 'user_selected',
  });

  const snapshotA = composerSnapshot({
    taskId: 'task-idem-379',
    userSelectedSkillRefs: [a.skillRevisionRef],
  });
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const admission = new HarnessTaskAdmissionService(
    registry,
    starter,
    new FixedPromptResolver(),
    undefined,
    defaultBounds,
    routeResolver(snapshotA),
    createProductionSkillManifestResolver(instructionResolver),
  );

  const first = await admission.submit(snapshotTaskRequest(snapshotA));
  const replay = await admission.submit(snapshotTaskRequest(snapshotA));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(starter.starts, 2);
  // Frozen selection is not overwritten on replay.
  assert.deepEqual(starter.requests[1]!.userSelectedSkillRefs, [
    a.skillRevisionRef,
  ]);

  const snapshotB = composerSnapshot({
    taskId: 'task-idem-379',
    userSelectedSkillRefs: [b.skillRevisionRef],
    idempotencyKey: 'composer-key-379-b',
  });
  await assert.rejects(
    admission.submit(snapshotTaskRequest(snapshotB)),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'REQUEST_FINGERPRINT_CONFLICT' &&
      error.status === 409,
  );
  // Original frozen selection remains.
  assert.deepEqual(
    registry.frozenRequest('task-idem-379')?.userSelectedSkillRefs,
    [a.skillRevisionRef],
  );
});

// ---------------------------------------------------------------------------
// Ineligible refs → diagnostic 4xx (no silent empty)
// ---------------------------------------------------------------------------

test('out-of-catalog, backend_only, explainable and disabled refs fail with 4xx', async () => {
  const { service, instructionResolver } = createSkillStack();
  const selectable = await publishSkill({
    service,
    skillId: 'skill.selectable-valid',
    name: 'Valid',
    description: 'Valid pack',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.selectable-valid',
    skillRevisionRef: selectable.skillRevisionRef,
    mode: 'user_selected',
  });

  const backend = await publishSkill({
    service,
    skillId: 'skill.backend-only-reject',
    name: 'Backend',
    description: 'Backend only',
    presentationPolicy: 'backend_only',
  });
  await bindSkill({
    service,
    bindingId: 'binding.backend-only-reject',
    skillRevisionRef: backend.skillRevisionRef,
    mode: 'required',
  });

  const explainable = await publishSkill({
    service,
    skillId: 'skill.explainable-reject',
    name: 'Explainable',
    description: 'Explainable only',
    presentationPolicy: 'explainable',
  });
  // explainable cannot bind as user_selected; bind as required for presence.
  await bindSkill({
    service,
    bindingId: 'binding.explainable-reject',
    skillRevisionRef: explainable.skillRevisionRef,
    mode: 'required',
  });

  const disabled = await publishSkill({
    service,
    skillId: 'skill.disabled-reject',
    name: 'Disabled',
    description: 'Disabled pack',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.disabled-reject',
    skillRevisionRef: disabled.skillRevisionRef,
    mode: 'disabled',
  });

  const production = createProductionSkillManifestResolver(instructionResolver);

  const cases: Array<{ label: string; refs: string[] }> = [
    { label: 'out-of-catalog', refs: ['skill.never-existed@9'] },
    { label: 'backend_only', refs: [backend.skillRevisionRef] },
    { label: 'explainable', refs: [explainable.skillRevisionRef] },
    { label: 'disabled', refs: [disabled.skillRevisionRef] },
  ];

  for (const testCase of cases) {
    const snapshot = composerSnapshot({
      taskId: `task-reject-${testCase.label}`,
      userSelectedSkillRefs: testCase.refs,
      idempotencyKey: `key-reject-${testCase.label}`,
    });
    await assert.rejects(
      production.select({
        request: snapshotTaskRequest(snapshot),
        stage: 'intent_naming',
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof UserSelectedSkillIneligibleError,
          `${testCase.label} must raise UserSelectedSkillIneligibleError`,
        );
        assert.equal(error.status, 400);
        assert.equal(error.code, 'USER_SELECTED_SKILL_INELIGIBLE');
        assert.match(error.message, /选用的技能不可用/u);
        return true;
      },
    );
  }

  // Valid selection still succeeds (positive control).
  const okSnapshot = composerSnapshot({
    taskId: 'task-reject-ok',
    userSelectedSkillRefs: [selectable.skillRevisionRef],
    idempotencyKey: 'key-reject-ok',
  });
  const ok = await production.select({
    request: snapshotTaskRequest(okSnapshot),
    stage: 'intent_naming',
  });
  assert.equal(
    ok.some((manifest) => manifest.skillRevisionRef === selectable.skillRevisionRef),
    true,
  );
});

test('stale revision (not published head) fails with 4xx', async () => {
  const { service, instructionResolver, repository } = createSkillStack();
  const first = await publishSkill({
    service,
    skillId: 'skill.stale-head',
    name: 'Stale',
    description: 'v1',
    presentationPolicy: 'user_selectable',
  });

  const v2Instruction = 'Stale head v2 instruction.';
  const prompt = registerPrompt(v2Instruction, 'skills/skill.stale-head', '2');
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: 1,
    governance: governance(),
    instruction: v2Instruction,
    manifest: { description: 'v2', name: 'skill-stale-head' },
    promptReference: prompt,
    skillId: 'skill.stale-head',
  });
  const run = skillEvalRun(draft.skillRevisionRef, 'skill.stale-head-v2', prompt);
  await repository.putImmutable(run.runId, run);
  const second = await service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
  await service.publishAcceptedRevision({
    actorId: 'operator-2',
    expectedPublicationGeneration: 1,
    expectedPublishedRevisionRef: first.skillRevisionRef,
    runId: 'publish-skill.stale-head-v2',
    skillId: 'skill.stale-head',
    targetSkillRevisionRef: second.skillRevisionRef,
    workspaceId: WORKSPACE,
  });
  // Binding still points at v1 while catalog head is v2 — out of merchant catalog.
  await bindSkill({
    service,
    bindingId: 'binding.stale-head-v1',
    skillRevisionRef: first.skillRevisionRef,
    mode: 'user_selected',
  });

  // Selecting the retired head must fail — cannot silent-drop.
  const snapshot = composerSnapshot({
    taskId: 'task-stale-379',
    userSelectedSkillRefs: [first.skillRevisionRef],
  });
  const production = createProductionSkillManifestResolver(instructionResolver);
  await assert.rejects(
    production.select({
      request: snapshotTaskRequest(snapshot),
      stage: 'intent_naming',
    }),
    (error: unknown) =>
      error instanceof UserSelectedSkillIneligibleError && error.status === 400,
  );
});

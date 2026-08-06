/**
 * Merchant skill projection contract tests (Spec E / #378).
 *
 * presentationPolicy semantics, workspace/tier/lens filters, serialization
 * allowlist, and authenticated workspace boundary. Pure-node only.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { MerchantSkillProjection } from '@meiye/contracts';
import {
  merchantSkillCapabilityItemSchema,
  merchantSkillProjectionSchema,
} from '@meiye/contracts';

import type { EvalRun } from '../../contracts/index.js';
import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';import {
  findForbiddenMerchantSkillKey,
  FORBIDDEN_MERCHANT_SKILL_KEYS,
  isMerchantSkillVisibleToWorkspace,
  projectMerchantSkillCapabilityItem,
  serializeMerchantSkillProjection,
  sortMerchantSkillCapabilityItems,
} from './merchant-skill-projection.js';
import {
  MemorySkillRepository,
  SkillFoundationModule,
  SkillService,
  type SkillBinding,
  type SkillCatalog,
  type SkillGovernanceSidecar,
  type SkillRevision,
} from './index.js';

const NOW = '2026-08-07T04:00:00.000Z';
const WORKSPACE_A = 'workspace-merchant-a';
const WORKSPACE_B = 'workspace-merchant-b';
const COPY_WORKFLOW = 'workflow.copy@1';
const IMAGE_WORKFLOW = 'workflow.image_text@1';

const testPromptSnapshotsByReference = new Map<string, HarnessFrozenPrompt>();
const testPromptSnapshots = {
  async capture(reference: {
    contentHash: string;
    name: string;
    version: string;
  }) {
    const snapshot = testPromptSnapshotsByReference.get(promptKey(reference));
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

/** Register full prompt material and return a content-free reference. */
function registerPrompt(
  content: string,
  name: string,
): { contentHash: string; name: string; version: string } {
  const prompt: HarnessFrozenPrompt = {
    content,
    contentHash: sha256(content),
    isFallback: false,
    label: 'production',
    name,
    source: 'langfuse',
    version: '1',
  };
  testPromptSnapshotsByReference.set(promptKey(prompt), prompt);
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

function createService(repository = new MemorySkillRepository()) {
  return {
    repository,
    service: new SkillService(repository, () => NOW, testPromptSnapshots),
  };
}

async function publishSkill(input: {
  service: SkillService;
  skillId: string;
  name: string;
  description: string;
  presentationPolicy: SkillCatalog['presentationPolicy'];
  tier?: SkillCatalog['tier'];
  workflowRevisionRefs?: readonly string[];
  ownerWorkspaceId?: string;
}): Promise<SkillRevision> {
  const workflowRevisionRefs = input.workflowRevisionRefs ?? [COPY_WORKFLOW];
  await input.service.defineCatalogEntry({
    actorId: 'operator-1',
    description: input.description,
    name: input.name,
    presentationPolicy: input.presentationPolicy,
    skillId: input.skillId,
    sourceKind: 'authored',
    tier: input.tier ?? 'platform',
  });
  const instruction = `Merchant projection fixture for ${input.skillId}.`;
  const prompt = registerPrompt(instruction, `skills/${input.skillId}`);
  const draft = await input.service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: null,
    governance: governance(workflowRevisionRefs),
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
    runId: `publish-${input.skillId}`,
    skillId: input.skillId,
    targetSkillRevisionRef: frozen.skillRevisionRef,
    workspaceId: input.ownerWorkspaceId ?? WORKSPACE_A,
  });
  return frozen;
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
        caseId: 'merchant-projection-gate',
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

async function bindSkill(input: {
  service: SkillService;
  bindingId: string;
  skillRevisionRef: string;
  mode: SkillBinding['mode'];
  workflowRevisionRef?: string;
  ownerWorkspaceId?: string;
  industryCategory?: string | null;
  tenantId?: string | null;
}) {
  return input.service.bindRevision({
    bindingId: input.bindingId,
    mode: input.mode,
    skillRevisionRef: input.skillRevisionRef,
    workflowRevisionRef: input.workflowRevisionRef ?? COPY_WORKFLOW,
    triggerCondition: {
      harnessStage: 'intent_naming',
      ...(input.industryCategory === undefined
        ? {}
        : { industryCategory: input.industryCategory }),
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    },
    ...(input.ownerWorkspaceId
      ? { ownerWorkspaceId: input.ownerWorkspaceId }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// presentationPolicy: positive + negative for each of the three policies
// ---------------------------------------------------------------------------

test('backend_only is excluded from merchant projection (positive exclusion + negative presence)', async () => {
  const { service } = createService();
  const backend = await publishSkill({
    service,
    skillId: 'skill.backend-only',
    name: 'Backend only',
    description: 'Must never render on merchant surface.',
    presentationPolicy: 'backend_only',
  });
  await bindSkill({
    service,
    bindingId: 'binding.backend-only',
    skillRevisionRef: backend.skillRevisionRef,
    mode: 'required',
  });

  const projection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });

  assert.equal(
    projection.items.some((item) => item.skillId === 'skill.backend-only'),
    false,
  );
  assert.equal(
    projection.items.some(
      (item) => item.skillRevisionRef === backend.skillRevisionRef,
    ),
    false,
  );
  // Negative: runtime can still resolve required backend_only (not part of merchant DTO).
  const stage = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: COPY_WORKFLOW,
  });
  assert.equal(
    stage.allowlist.some(
      (entry) => entry.skillRevisionRef === backend.skillRevisionRef,
    ),
    true,
  );
});

test('explainable returns readonly summary and never selectionEligible (pos + neg)', async () => {
  const { service } = createService();
  const explainable = await publishSkill({
    service,
    skillId: 'skill.explainable',
    name: 'Tone polish',
    description: '本次优化：语气更贴近门店日常。',
    presentationPolicy: 'explainable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.explainable',
    skillRevisionRef: explainable.skillRevisionRef,
    mode: 'required',
  });

  const projection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });

  const item = projection.items.find(
    (entry) => entry.skillId === 'skill.explainable',
  );
  assert.ok(item, 'explainable skill must appear');
  assert.equal(item.presentationPolicy, 'explainable');
  assert.equal(item.selectionEligible, false);
  assert.equal(item.title, 'Tone polish');
  assert.equal(item.summary, '本次优化：语气更贴近门店日常。');
  assert.equal(item.skillRevisionRef, explainable.skillRevisionRef);

  // Negative: must not be treated as a selectable ref producer.
  const selectableRefs = projection.items
    .filter((entry) => entry.selectionEligible)
    .map((entry) => entry.skillRevisionRef);
  assert.equal(selectableRefs.includes(explainable.skillRevisionRef), false);
});

test('user_selectable returns selectable capability pack (pos + neg unselected)', async () => {
  const { service } = createService();
  const selectable = await publishSkill({
    service,
    skillId: 'skill.user-selectable',
    name: 'Story structure',
    description: '创作增强：结构化故事线。',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.user-selectable',
    skillRevisionRef: selectable.skillRevisionRef,
    mode: 'user_selected',
  });

  const projection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });

  const item = projection.items.find(
    (entry) => entry.skillId === 'skill.user-selectable',
  );
  assert.ok(item, 'user_selectable skill must appear');
  assert.equal(item.presentationPolicy, 'user_selectable');
  assert.equal(item.selectionEligible, true);
  assert.equal(item.skillRevisionRef, selectable.skillRevisionRef);

  // Negative unselected: without userSelectedSkillRefs the stage allowlist excludes it.
  const unselected = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: COPY_WORKFLOW,
  });
  assert.equal(
    unselected.allowlist.some(
      (entry) => entry.skillRevisionRef === selectable.skillRevisionRef,
    ),
    false,
  );
  // Positive selected: choosing the projected ref injects it.
  const selected = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [item.skillRevisionRef],
    workflowRevisionRef: COPY_WORKFLOW,
  });
  assert.equal(
    selected.allowlist.some(
      (entry) => entry.skillRevisionRef === selectable.skillRevisionRef,
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// Filters: workspace / tier / lens / unpublished / retired / disabled / stale
// ---------------------------------------------------------------------------

test('lens filter only surfaces skills bound under published workflows for that lens', async () => {
  const { service } = createService();
  const copySkill = await publishSkill({
    service,
    skillId: 'skill.copy-lens',
    name: 'Copy pack',
    description: 'Copy lens only.',
    presentationPolicy: 'user_selectable',
    workflowRevisionRefs: [COPY_WORKFLOW],
  });
  await bindSkill({
    service,
    bindingId: 'binding.copy-lens',
    skillRevisionRef: copySkill.skillRevisionRef,
    mode: 'user_selected',
    workflowRevisionRef: COPY_WORKFLOW,
  });
  const imageSkill = await publishSkill({
    service,
    skillId: 'skill.image-lens',
    name: 'Image pack',
    description: 'Image lens only.',
    presentationPolicy: 'user_selectable',
    workflowRevisionRefs: [IMAGE_WORKFLOW],
  });
  await bindSkill({
    service,
    bindingId: 'binding.image-lens',
    skillRevisionRef: imageSkill.skillRevisionRef,
    mode: 'user_selected',
    workflowRevisionRef: IMAGE_WORKFLOW,
  });

  const copyProjection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  assert.deepEqual(
    copyProjection.items.map((item) => item.skillId),
    ['skill.copy-lens'],
  );

  const imageProjection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'image_text',
  });
  assert.deepEqual(
    imageProjection.items.map((item) => item.skillId),
    ['skill.image-lens'],
  );
});

test('store-tier skills are visible only to the owning workspace', async () => {
  const { service } = createService();
  const storeSkill = await publishSkill({
    service,
    skillId: 'skill.store-owned',
    name: 'Store pack',
    description: 'Workspace-private capability.',
    presentationPolicy: 'user_selectable',
    tier: 'store',
    ownerWorkspaceId: WORKSPACE_A,
  });
  await bindSkill({
    service,
    bindingId: 'binding.store-owned',
    skillRevisionRef: storeSkill.skillRevisionRef,
    mode: 'user_selected',
    ownerWorkspaceId: WORKSPACE_A,
  });

  const ownerView = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  assert.equal(
    ownerView.items.some((item) => item.skillId === 'skill.store-owned'),
    true,
  );

  const otherView = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_B,
    lensId: 'copy',
  });
  assert.equal(
    otherView.items.some((item) => item.skillId === 'skill.store-owned'),
    false,
  );
});

test('platform and industry tiers are visible on the published catalog path', async () => {
  const { service } = createService();
  const platform = await publishSkill({
    service,
    skillId: 'skill.platform-visible',
    name: 'Platform pack',
    description: 'Platform-wide.',
    presentationPolicy: 'explainable',
    tier: 'platform',
  });
  await bindSkill({
    service,
    bindingId: 'binding.platform-visible',
    skillRevisionRef: platform.skillRevisionRef,
    mode: 'required',
  });
  const industry = await publishSkill({
    service,
    skillId: 'skill.industry-visible',
    name: 'Industry pack',
    description: 'Industry-wide.',
    presentationPolicy: 'user_selectable',
    tier: 'industry',
  });
  await bindSkill({
    service,
    bindingId: 'binding.industry-visible',
    skillRevisionRef: industry.skillRevisionRef,
    mode: 'user_selected',
  });

  const projection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_B,
    lensId: 'copy',
  });
  assert.deepEqual(
    projection.items.map((item) => item.skillId).sort(),
    ['skill.industry-visible', 'skill.platform-visible'],
  );
});

test('industry-specific bindings filter by industryCategory', async () => {
  const { service } = createService();
  const hairOnly = await publishSkill({
    service,
    skillId: 'skill.hair-only',
    name: 'Hair pack',
    description: 'Hair industry only.',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.hair-only',
    skillRevisionRef: hairOnly.skillRevisionRef,
    mode: 'user_selected',
    industryCategory: 'hair',
  });

  const hairView = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
    industryCategory: 'hair',
  });
  assert.equal(
    hairView.items.some((item) => item.skillId === 'skill.hair-only'),
    true,
  );

  const nailsView = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
    industryCategory: 'nails',
  });
  assert.equal(
    nailsView.items.some((item) => item.skillId === 'skill.hair-only'),
    false,
  );
});

test('unpublished (no activeRevisionRef) skills never enter merchant projection', async () => {
  const { service } = createService();
  await service.defineCatalogEntry({
    actorId: 'operator-1',
    description: 'Never published.',
    name: 'Draft only',
    presentationPolicy: 'user_selectable',
    skillId: 'skill.unpublished',
    sourceKind: 'authored',
    tier: 'platform',
  });
  const instruction = 'Unpublished fixture.';
  const prompt = registerPrompt(instruction, 'skills/skill.unpublished');
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: null,
    governance: governance(),
    instruction,
    manifest: {
      description: 'Never published.',
      name: 'unpublished',
    },
    promptReference: prompt,
    skillId: 'skill.unpublished',
  });
  // Accept but do not publish — no activeRevisionRef.
  const repository = Reflect.get(service, 'repository') as MemorySkillRepository;
  const run = skillEvalRun(
    draft.skillRevisionRef,
    'skill.unpublished',
    prompt,
  );
  await repository.putImmutable(run.runId, run);
  const frozen = await service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
  await bindSkill({
    service,
    bindingId: 'binding.unpublished',
    skillRevisionRef: frozen.skillRevisionRef,
    mode: 'user_selected',
  });

  const projection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  assert.equal(
    projection.items.some((item) => item.skillId === 'skill.unpublished'),
    false,
  );
});

class ForceRetireRepository extends MemorySkillRepository {
  forceRetire(skillRevisionRef: string) {
    const current = (this as unknown as { revisions: Map<string, SkillRevision> })
      .revisions.get(skillRevisionRef);
    assert.ok(current, 'revision must exist to force-retire');
    (this as unknown as { revisions: Map<string, SkillRevision> }).revisions.set(
      skillRevisionRef,
      { ...current, status: 'retired' },
    );
  }
}

test('retired revisions and disabled bindings are excluded', async () => {
  const repository = new ForceRetireRepository();
  const service = new SkillService(repository, () => NOW, testPromptSnapshots);
  const retiredSkill = await publishSkill({
    service,
    skillId: 'skill.will-retire',
    name: 'Retiring pack',
    description: 'Will be retired.',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.will-retire',
    skillRevisionRef: retiredSkill.skillRevisionRef,
    mode: 'user_selected',
  });
  // Force-retire after binding: reverse-deps would block formal retire while
  // binding/publish edges exist; merchant filter still keys on revision status.
  repository.forceRetire(retiredSkill.skillRevisionRef);

  const disabledSkill = await publishSkill({
    service,
    skillId: 'skill.disabled-bind',
    name: 'Disabled pack',
    description: 'Disabled binding.',
    presentationPolicy: 'user_selectable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.disabled',
    skillRevisionRef: disabledSkill.skillRevisionRef,
    mode: 'disabled',
  });

  const projection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  assert.equal(
    projection.items.some((item) => item.skillId === 'skill.will-retire'),
    false,
  );
  assert.equal(
    projection.items.some((item) => item.skillId === 'skill.disabled-bind'),
    false,
  );
});

test('out-of-catalog binding revision (not activeRevisionRef) is excluded', async () => {
  const { service, repository } = createService();
  const skillId = 'skill.stale-binding';
  const v1 = await publishSkill({
    service,
    skillId,
    name: 'Stale binding',
    description: 'v1 published then superseded.',
    presentationPolicy: 'user_selectable',
  });
  // Author and publish v2 as the new catalog head.
  const instruction = 'Merchant projection fixture v2.';
  const prompt = registerPrompt(instruction, `skills/${skillId}-v2`);
  const draft = await service.draftRevision({
    actorId: 'operator-1',
    expectedRevision: 1,
    governance: governance(),
    instruction,
    manifest: {
      description: 'v2',
      name: 'stale-binding-v2',
    },
    promptReference: prompt,
    skillId,
  });
  const run = skillEvalRun(draft.skillRevisionRef, 'skill.stale-binding-v2', prompt);
  await repository.putImmutable(run.runId, run);
  const v2 = await service.acceptAndFreezeRevision({
    actorId: 'operator-2',
    evalRunId: run.runId,
    skillRevisionRef: draft.skillRevisionRef,
  });
  await service.publishAcceptedRevision({
    actorId: 'operator-2',
    expectedPublicationGeneration: 1,
    expectedPublishedRevisionRef: v1.skillRevisionRef,
    runId: 'publish-stale-v2',
    skillId,
    targetSkillRevisionRef: v2.skillRevisionRef,
    workspaceId: WORKSPACE_A,
  });
  // Binding still points at v1 — out of published catalog head.
  await bindSkill({
    service,
    bindingId: 'binding.stale-v1',
    skillRevisionRef: v1.skillRevisionRef,
    mode: 'user_selected',
  });

  const projection = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  assert.equal(
    projection.items.some((item) => item.skillId === skillId),
    false,
  );
});

// ---------------------------------------------------------------------------
// Serialization allowlist — no SKILL.md / scripts / provider / governance leak
// ---------------------------------------------------------------------------

test('serialization layer strips forbidden skill fields (allowlist only)', () => {
  const catalog: SkillCatalog = {
    skillId: 'skill.leak-check',
    name: 'Leak check',
    description: 'Must strip internals.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'user_selectable',
    activeRevisionRef: 'skill.leak-check@1',
    publicationGeneration: 1,
    createdAt: NOW,
    updatedAt: NOW,
    actorId: 'operator-1',
    sourceRef: { externalUrl: 'https://example.invalid', harvestedAt: NOW },
  };

  const item = projectMerchantSkillCapabilityItem({
    catalog,
    skillRevisionRef: 'skill.leak-check@1',
  });
  const projection: MerchantSkillProjection = {
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
    items: [item],
  };

  // Inject a malicious extra blob and ensure allowlist serialization is clean
  // when projecting through the pure helper (service always uses the helper).
  const poisoned = {
    ...projection,
    items: [
      {
        ...item,
        instruction: 'SECRET_INSTRUCTION',
        governance: { workflowRevisionRefs: ['x'] },
        packagePaths: ['SKILL.md', 'scripts/run.sh'],
        nativeSkillId: 'provider-native-id',
        provider: 'openai',
        prompt: { content: 'hidden' },
        tools: ['read_context'],
        'allowed-tools': 'read_context',
      },
    ],
  };

  // Pure project path never carries those keys.
  assert.equal(findForbiddenMerchantSkillKey(item), null);
  assert.equal(findForbiddenMerchantSkillKey(projection), null);
  assert.ok(findForbiddenMerchantSkillKey(poisoned));

  // Re-project through allowlist helper recovers a clean item.
  const cleaned = projectMerchantSkillCapabilityItem({
    catalog,
    skillRevisionRef: 'skill.leak-check@1',
  });
  assert.equal(findForbiddenMerchantSkillKey(cleaned), null);
  assert.deepEqual(Object.keys(cleaned).sort(), [
    'presentationPolicy',
    'selectionEligible',
    'skillId',
    'skillRevisionRef',
    'summary',
    'tier',
    'title',
  ]);
  assert.equal(merchantSkillCapabilityItemSchema.safeParse(cleaned).success, true);
  assert.equal(
    merchantSkillProjectionSchema.safeParse(projection).success,
    true,
  );

  const json = serializeMerchantSkillProjection(projection);
  for (const key of [
    'SKILL.md',
    'scripts',
    'nativeSkillId',
    'instruction',
    'governance',
    'prompt',
    'allowed-tools',
    'tools',
  ]) {
    assert.equal(json.includes(key), false, `leaked ${key}`);
  }
  assert.ok(FORBIDDEN_MERCHANT_SKILL_KEYS.includes('instruction'));
  assert.ok(FORBIDDEN_MERCHANT_SKILL_KEYS.includes('scripts'));
  assert.ok(FORBIDDEN_MERCHANT_SKILL_KEYS.includes('nativeSkillId'));
});

test('service projection never reuses admin listCatalog shape', async () => {
  const { service } = createService();
  const skill = await publishSkill({
    service,
    skillId: 'skill.not-admin-shape',
    name: 'Not admin',
    description: 'Merchant DTO only.',
    presentationPolicy: 'explainable',
  });
  await bindSkill({
    service,
    bindingId: 'binding.not-admin-shape',
    skillRevisionRef: skill.skillRevisionRef,
    mode: 'required',
  });

  const merchant = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  const admin = await service.listCatalog();

  assert.equal('items' in merchant && 'lensId' in merchant, true);
  assert.equal('stats' in merchant, false);
  assert.equal('stats' in admin, true);
  assert.equal(
    merchant.items[0] && 'sourceKind' in merchant.items[0],
    false,
  );
  assert.equal(admin.items[0] && 'sourceKind' in admin.items[0], true);
  assert.equal(findForbiddenMerchantSkillKey(merchant), null);
});

// ---------------------------------------------------------------------------
// Authenticated workspace boundary + deterministic curated order
// ---------------------------------------------------------------------------

test('foundation query uses authenticated workspaceId and rejects cross-workspace input keys', async () => {
  const { service } = createService();
  const skill = await publishSkill({
    service,
    skillId: 'skill.workspace-boundary',
    name: 'Boundary pack',
    description: 'Bound to workspace A context.',
    presentationPolicy: 'user_selectable',
    tier: 'store',
    ownerWorkspaceId: WORKSPACE_A,
  });
  await bindSkill({
    service,
    bindingId: 'binding.workspace-boundary',
    skillRevisionRef: skill.skillRevisionRef,
    mode: 'user_selected',
    ownerWorkspaceId: WORKSPACE_A,
  });

  const module = new SkillFoundationModule(service);
  const asA = (await module.query({
    context: {
      actor: 'owner',
      correlationId: 'corr-a',
      userId: 'merchant-a',
      workspaceId: WORKSPACE_A,
    },
    input: {
      action: 'merchant_skill_projection',
      payload: { lensId: 'copy' },
    },
  })) as MerchantSkillProjection;

  assert.equal(asA.workspaceId, WORKSPACE_A);
  assert.equal(
    asA.items.some((item) => item.skillId === 'skill.workspace-boundary'),
    true,
  );

  const asB = (await module.query({
    context: {
      actor: 'owner',
      correlationId: 'corr-b',
      userId: 'merchant-b',
      workspaceId: WORKSPACE_B,
    },
    input: {
      action: 'merchant_skill_projection',
      payload: { lensId: 'copy' },
    },
  })) as MerchantSkillProjection;

  assert.equal(asB.workspaceId, WORKSPACE_B);
  assert.equal(
    asB.items.some((item) => item.skillId === 'skill.workspace-boundary'),
    false,
  );

  // Payload must not accept a caller-supplied workspaceId override key.
  await assert.rejects(
    module.query({
      context: {
        actor: 'owner',
        correlationId: 'corr-override',
        userId: 'merchant-b',
        workspaceId: WORKSPACE_B,
      },
      input: {
        action: 'merchant_skill_projection',
        payload: {
          lensId: 'copy',
          workspaceId: WORKSPACE_A,
        },
      },
    }),
    /不支持的字段|unsupported|workspaceId/iu,
  );
});

test('ordering is deterministic curated catalog order (skillId), not personalized', async () => {
  const { service } = createService();
  for (const skillId of [
    'skill.zeta-pack',
    'skill.alpha-pack',
    'skill.mu-pack',
  ]) {
    const revision = await publishSkill({
      service,
      skillId,
      name: skillId,
      description: `Pack ${skillId}`,
      presentationPolicy: 'user_selectable',
    });
    await bindSkill({
      service,
      bindingId: `binding.${skillId}`,
      skillRevisionRef: revision.skillRevisionRef,
      mode: 'user_selected',
    });
  }

  const first = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  const second = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });

  assert.deepEqual(
    first.items.map((item) => item.skillId),
    ['skill.alpha-pack', 'skill.mu-pack', 'skill.zeta-pack'],
  );
  assert.deepEqual(
    second.items.map((item) => item.skillId),
    first.items.map((item) => item.skillId),
  );
  assert.deepEqual(
    sortMerchantSkillCapabilityItems([...first.items].reverse()).map(
      (item) => item.skillId,
    ),
    first.items.map((item) => item.skillId),
  );
});

test('visibility helper: store requires owner workspace; platform/industry open', () => {
  const catalogPlatform: SkillCatalog = {
    skillId: 's',
    name: 'n',
    description: 'd',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'explainable',
    activeRevisionRef: 's@1',
    publicationGeneration: 1,
    createdAt: NOW,
    updatedAt: NOW,
    actorId: 'a',
  };
  const binding: SkillBinding = {
    bindingId: 'b',
    workflowRevisionRef: COPY_WORKFLOW,
    triggerCondition: { harnessStage: 'intent_naming' },
    skillId: 's',
    skillRevisionRef: 's@1',
    mode: 'required',
    status: 'active',
    supersededAt: null,
    supersededByBindingId: null,
    createdAt: NOW,
    ownerWorkspaceId: WORKSPACE_A,
  };
  assert.equal(
    isMerchantSkillVisibleToWorkspace({
      catalog: catalogPlatform,
      binding,
      workspaceId: WORKSPACE_B,
    }),
    true,
  );
  assert.equal(
    isMerchantSkillVisibleToWorkspace({
      catalog: { ...catalogPlatform, tier: 'store' },
      binding,
      workspaceId: WORKSPACE_A,
    }),
    true,
  );
  assert.equal(
    isMerchantSkillVisibleToWorkspace({
      catalog: { ...catalogPlatform, tier: 'store' },
      binding,
      workspaceId: WORKSPACE_B,
    }),
    false,
  );
});

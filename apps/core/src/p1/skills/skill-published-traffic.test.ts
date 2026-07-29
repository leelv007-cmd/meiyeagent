import assert from 'node:assert/strict';
import test from 'node:test';

import { MemorySkillRepository } from './repository.js';
import { SkillService } from './service.js';
import type { SkillRevision } from './types.js';

const NOW = '2026-07-30T12:00:00.000Z';
const SKILL_ID = 'skill.published-traffic';

test('Published CAS keeps one canonical pointer and rejects an ABA-stale generation', async () => {
  const { repository, service, revisions } = await seedAcceptedRevisions();

  const competing = await Promise.all([
    service.publishAcceptedRevision({
      actorId: 'operator-a',
      expectedPublicationGeneration: 0,
      expectedPublishedRevisionRef: null,
      runId: 'publish-competing-v1',
      skillId: SKILL_ID,
      targetSkillRevisionRef: revisions[0].skillRevisionRef,
      workspaceId: 'workspace-ops',
    }),
    service.publishAcceptedRevision({
      actorId: 'operator-b',
      expectedPublicationGeneration: 0,
      expectedPublishedRevisionRef: null,
      runId: 'publish-competing-v2',
      skillId: SKILL_ID,
      targetSkillRevisionRef: revisions[1].skillRevisionRef,
      workspaceId: 'workspace-ops',
    }),
  ]);
  assert.equal(competing.filter((result) => result.applied).length, 1);
  assert.equal(
    competing.filter(
      (result) =>
        !result.applied &&
        result.validationResults[0]?.reasonCode === 'cas_conflict',
    ).length,
    1,
  );

  const first = (await repository.getCatalog(SKILL_ID))!;
  assert.equal(first.publicationGeneration, 1);
  const other = revisions.find(
    (revision) => revision.skillRevisionRef !== first.activeRevisionRef,
  )!;
  const firstRevisionRef = first.activeRevisionRef!;

  const second = await service.publishAcceptedRevision({
    actorId: 'operator-c',
    expectedPublicationGeneration: 1,
    expectedPublishedRevisionRef: firstRevisionRef,
    runId: 'publish-second',
    skillId: SKILL_ID,
    targetSkillRevisionRef: other.skillRevisionRef,
    workspaceId: 'workspace-ops',
  });
  assert.equal(second.applied, true);
  const third = await service.publishAcceptedRevision({
    actorId: 'operator-d',
    expectedPublicationGeneration: 2,
    expectedPublishedRevisionRef: other.skillRevisionRef,
    runId: 'publish-third',
    skillId: SKILL_ID,
    targetSkillRevisionRef: firstRevisionRef,
    workspaceId: 'workspace-ops',
  });
  assert.equal(third.applied, true);

  const stale = await service.publishAcceptedRevision({
    actorId: 'operator-stale',
    expectedPublicationGeneration: 1,
    expectedPublishedRevisionRef: firstRevisionRef,
    runId: 'publish-stale-aba',
    skillId: SKILL_ID,
    targetSkillRevisionRef: other.skillRevisionRef,
    workspaceId: 'workspace-ops',
  });
  assert.deepEqual(stale, {
    applied: false,
    runId: 'publish-stale-aba',
    success: true,
    validationResults: [
      {
        fieldPath: 'activeRevisionRef',
        reasonCode: 'cas_conflict',
        status: 'not_applied',
      },
    ],
  });
  assert.deepEqual(
    await repository.getCatalog(SKILL_ID),
    {
      ...first,
      activeRevisionRef: firstRevisionRef,
      actorId: 'operator-d',
      publicationGeneration: 3,
      updatedAt: NOW,
    },
  );
  const lifecycleEdges = (
    await repository.listReferenceEdges(firstRevisionRef)
  ).filter((edge) => edge.consumerKind === 'published_lifecycle');
  assert.equal(lifecycleEdges.length, 1);
  assert.equal(
    (
      await repository.listReferenceEdges(other.skillRevisionRef)
    ).filter((edge) => edge.consumerKind === 'published_lifecycle').length,
    0,
  );
});

test('traffic binding is independent, accepts historical frozen revisions, and rejects drafts', async () => {
  const { repository, service, revisions } = await seedAcceptedRevisions();
  await service.publishAcceptedRevision({
    actorId: 'operator-publisher',
    expectedPublicationGeneration: 0,
    expectedPublishedRevisionRef: null,
    runId: 'publish-for-traffic-separation',
    skillId: SKILL_ID,
    targetSkillRevisionRef: revisions[1].skillRevisionRef,
    workspaceId: 'workspace-ops',
  });
  const publishedBeforeBinding = await repository.getCatalog(SKILL_ID);

  const binding = await service.bindRevision({
    bindingId: 'binding-historical-v1',
    mode: 'required',
    ownerWorkspaceId: 'workspace-traffic',
    skillRevisionRef: revisions[0].skillRevisionRef,
    triggerCondition: { harnessStage: 'intent_naming' },
    workflowRevisionRef: 'workflow.copy@1',
  });
  assert.equal(binding.skillRevisionRef, revisions[0].skillRevisionRef);
  assert.deepEqual(
    await repository.getCatalog(SKILL_ID),
    publishedBeforeBinding,
  );

  const draft = {
    ...acceptedRevision(3),
    acceptedAt: null,
    acceptedBy: null,
    evalRunId: null,
    status: 'draft' as const,
  };
  await repository.putRevision(draft, 2);
  await assert.rejects(
    service.bindRevision({
      bindingId: 'binding-draft-v3',
      mode: 'required',
      ownerWorkspaceId: 'workspace-traffic',
      skillRevisionRef: draft.skillRevisionRef,
      triggerCondition: { harnessStage: 'intent_naming' },
      workflowRevisionRef: 'workflow.copy-draft@1',
    }),
    /只能绑定已受理冻结的 Skill 版本/u,
  );
});

test('traffic switch changes new selections while an accepted run keeps its exact snapshot', async () => {
  const { service, revisions } = await seedAcceptedRevisions();
  await service.bindRevision({
    bindingId: 'binding-old-target',
    mode: 'required',
    ownerWorkspaceId: 'workspace-traffic',
    skillRevisionRef: revisions[0].skillRevisionRef,
    triggerCondition: { harnessStage: 'intent_naming' },
    workflowRevisionRef: 'workflow.copy@1',
  });
  const acceptedRunSnapshot = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.copy@1',
  });
  assert.deepEqual(
    acceptedRunSnapshot.allowlist.map((item) => item.skillRevisionRef),
    [revisions[0].skillRevisionRef],
  );

  await service.rollbackBinding({
    bindingId: 'binding-new-target',
    sourceBindingId: 'binding-old-target',
    targetSkillRevisionRef: revisions[1].skillRevisionRef,
    workflowRevisionRef: 'workflow.copy@1',
  });
  const newRequestSelection = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: 'workflow.copy@1',
  });
  assert.deepEqual(
    newRequestSelection.allowlist.map((item) => item.skillRevisionRef),
    [revisions[1].skillRevisionRef],
  );
  assert.deepEqual(
    (
      await service.resolveFrozenRevisions(
        acceptedRunSnapshot.allowlist.map((item) => item.skillRevisionRef),
      )
    ).map((item) => item.skillRevisionRef),
    [revisions[0].skillRevisionRef],
  );
});

async function seedAcceptedRevisions() {
  const repository = new MemorySkillRepository();
  await repository.putCatalog({
    activeRevisionRef: null,
    actorId: 'operator-seed',
    createdAt: NOW,
    description: 'Published traffic fixture.',
    name: 'Published traffic fixture',
    presentationPolicy: 'backend_only',
    publicationGeneration: 0,
    skillId: SKILL_ID,
    sourceKind: 'authored',
    tier: 'platform',
    updatedAt: NOW,
  });
  const revisions = [
    acceptedRevision(1),
    acceptedRevision(2),
  ] as const;
  await repository.putRevision(revisions[0], null);
  await repository.putRevision(revisions[1], 1);
  return {
    repository,
    revisions,
    service: new SkillService(repository, () => NOW),
  };
}

function acceptedRevision(revision: number): SkillRevision {
  return {
    acceptedAt: NOW,
    acceptedBy: 'operator-seed',
    contentHash: `content-hash-${revision}`,
    createdAt: NOW,
    createdBy: 'operator-seed',
    evalRunId: `eval-run-${revision}`,
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
    instruction: `Instruction ${revision}`,
    manifest: {
      description: `Published traffic fixture ${revision}.`,
      name: 'published-traffic',
    },
    packagePaths: ['SKILL.md'],
    prompt: {
      content: 'Fixture prompt.',
      contentHash:
        'da88a91987dabf3903abd99ab91bfce4e21945e732d4d86fbb71871b4c28f356',
      isFallback: false,
      label: 'production',
      name: 'harness/intent-naming',
      source: 'langfuse',
      version: String(revision),
    },
    revision,
    skillId: SKILL_ID,
    skillRevisionRef: `${SKILL_ID}@${revision}`,
    status: 'accepted_frozen',
  };
}

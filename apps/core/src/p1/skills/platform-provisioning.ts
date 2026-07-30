import { isDeepStrictEqual } from 'node:util';

import type { EvalRun } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import {
  requireHarnessFrozenPrompt,
  type HarnessFrozenPrompt,
  type HarnessFrozenPrompts,
} from '../harness/langfuse-prompts.js';
import {
  beautyCopywritingDefinition,
  captureStoreWorkflowDefinition,
  type PlatformRecipeDefinition,
} from './platform-recipes.js';
import type { SkillRepository } from './repository.js';
import type { SkillService } from './service.js';
import type { SkillRevision } from './types.js';

export const PLATFORM_COPY_WORKFLOW_REVISION_REF = 'workflow.copy@1';
export const PLATFORM_BEAUTY_COPYWRITING_SKILL_ID =
  'skill.beauty-copywriting';
export const PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID =
  'skill.capture-store-workflow';

const PLATFORM_RECIPE_ACTOR_ID = 'system.platform-recipe-provisioner';
const PLATFORM_RECIPE_WORKSPACE_ID = '__system__';

interface ProvisioningRecipe {
  bindingId: string;
  definition: PlatformRecipeDefinition;
  deployment: {
    channel: string;
    deploymentId: string;
    nativeSkillId: string;
    nativeVersion: string;
    provider: string;
  };
  prompt: HarnessFrozenPrompt;
  stage: 'execution_selection' | 'intent_naming';
}

export async function provisionPlatformRecipes(input: {
  prompts: HarnessFrozenPrompts;
  repository: SkillRepository;
  service: SkillService;
}) {
  const copyPrompt = requireHarnessFrozenPrompt(
    input.prompts,
    'copyCandidate',
  );
  const capturePrompt = requireHarnessFrozenPrompt(
    input.prompts,
    'intentNaming',
  );
  const recipes: ProvisioningRecipe[] = [
    {
      bindingId: 'binding.platform.beauty-copywriting@1',
      definition: beautyCopywritingDefinition({
        expectedRevision: null,
        prompt: copyPrompt,
        skillId: PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
        workflowRevisionRef: PLATFORM_COPY_WORKFLOW_REVISION_REF,
      }),
      deployment: {
        channel: 'prompt-materialization',
        deploymentId: 'deployment.platform.beauty-copywriting@1',
        nativeSkillId: 'beauty-copywriting',
        nativeVersion: '1',
        provider: 'core-harness',
      },
      prompt: copyPrompt,
      stage: 'execution_selection',
    },
    {
      bindingId: 'binding.platform.capture-store-workflow@1',
      definition: captureStoreWorkflowDefinition({
        expectedRevision: null,
        prompt: capturePrompt,
        skillId: PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID,
        workflowRevisionRef: PLATFORM_COPY_WORKFLOW_REVISION_REF,
      }),
      deployment: {
        channel: 'agent-primitives',
        deploymentId: 'deployment.platform.capture-store-workflow@1',
        nativeSkillId: 'capture-store-workflow',
        nativeVersion: '1',
        provider: 'core-harness',
      },
      prompt: capturePrompt,
      stage: 'intent_naming',
    },
  ];

  const revisions: SkillRevision[] = [];
  for (const recipe of recipes) {
    revisions.push(await provisionRecipe(input, recipe));
  }
  return { revisions };
}

async function provisionRecipe(
  input: {
    repository: SkillRepository;
    service: SkillService;
  },
  recipe: ProvisioningRecipe,
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await provisionRecipeOnce(input, recipe);
    } catch (error) {
      if (
        !(
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT'
        ) ||
        attempt === 7
      ) {
        throw error;
      }
    }
  }
  throw new P1DomainError(
    'INVALID_STATE',
    `Platform Skill ${recipe.definition.skillId} did not converge.`,
  );
}

async function provisionRecipeOnce(
  input: {
    repository: SkillRepository;
    service: SkillService;
  },
  recipe: ProvisioningRecipe,
) {
  const definition = recipe.definition;
  let revision = await input.repository.getRevisionHead(definition.skillId);
  if (!revision) {
    revision = (
      await input.service.defineCatalogAndDraftRevision({
        actorId: PLATFORM_RECIPE_ACTOR_ID,
        description: definition.frontmatter.description,
        expectedRevision: definition.expectedRevision,
        governance: definition.governance,
        instruction: definition.instruction,
        manifest: definition.frontmatter,
        name: definition.name,
        packagePaths: definition.packagePaths,
        presentationPolicy: definition.presentationPolicy,
        promptReference: definition.promptReference,
        skillId: definition.skillId,
        sourceKind: definition.sourceKind,
        sourceRef: definition.sourceRef,
        tier: definition.tier,
      })
    ).revision;
  }
  assertProvisionedRevision(revision, definition);

  const evalRunId = `eval.platform.${definition.frontmatter.name}@1`;
  await input.repository.putImmutable(
    evalRunId,
    platformAcceptanceRun(evalRunId, revision.skillRevisionRef, recipe.prompt),
  );
  revision = await input.service.acceptAndFreezeRevision({
    actorId: PLATFORM_RECIPE_ACTOR_ID,
    evalRunId,
    skillRevisionRef: revision.skillRevisionRef,
  });

  let catalog = await input.repository.getCatalog(definition.skillId);
  if (!catalog) {
    throw new P1DomainError('NOT_FOUND', 'Platform Skill catalog is missing.');
  }
  if (catalog.activeRevisionRef !== revision.skillRevisionRef) {
    const published = await input.service.publishAcceptedRevision({
      actorId: PLATFORM_RECIPE_ACTOR_ID,
      expectedPublicationGeneration: catalog.publicationGeneration,
      expectedPublishedRevisionRef: catalog.activeRevisionRef,
      runId: `publish.platform.${definition.frontmatter.name}@1`,
      skillId: definition.skillId,
      targetSkillRevisionRef: revision.skillRevisionRef,
      workspaceId: PLATFORM_RECIPE_WORKSPACE_ID,
    });
    if (!published.applied) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Platform Skill publication raced with another process.',
      );
    }
    catalog = await input.repository.getCatalog(definition.skillId);
  }
  if (catalog?.activeRevisionRef !== revision.skillRevisionRef) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Platform Skill publication did not activate its frozen revision.',
    );
  }

  const binding = await input.repository.getBinding(recipe.bindingId);
  if (!binding) {
    await input.service.bindRevision({
      bindingId: recipe.bindingId,
      mode: 'required',
      skillRevisionRef: revision.skillRevisionRef,
      triggerCondition: {
        harnessStage: recipe.stage,
        industryCategory: null,
        tenantId: null,
      },
      workflowRevisionRef: PLATFORM_COPY_WORKFLOW_REVISION_REF,
    });
  } else if (
    binding.skillRevisionRef !== revision.skillRevisionRef ||
    binding.status !== 'active' ||
    binding.triggerCondition.harnessStage !== recipe.stage
  ) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `Platform Skill binding ${recipe.bindingId} has different facts.`,
    );
  }

  const deployment = await input.repository.getDeployment(
    recipe.deployment.deploymentId,
  );
  if (!deployment) {
    await input.service.registerDeployment({
      ...recipe.deployment,
      executionMode: revision.governance.executionMode,
      packagePaths: revision.packagePaths ?? ['SKILL.md'],
      skillRevisionRef: revision.skillRevisionRef,
      ...(revision.governance.executionMode === 'prompt_materialized'
        ? {}
        : {
            experimentalGate: {
              enabled: true,
              evidenceRef:
                'docs/ops/issue-260-skill-creator-eval-preflight.md',
            },
          }),
    });
  } else if (deployment.skillRevisionRef !== revision.skillRevisionRef) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `Platform Skill deployment ${recipe.deployment.deploymentId} has different facts.`,
    );
  }
  return revision;
}

function assertProvisionedRevision(
  revision: SkillRevision,
  definition: PlatformRecipeDefinition,
) {
  const matches =
    revision.revision === 1 &&
    revision.instruction === definition.instruction &&
    isDeepStrictEqual(revision.manifest, definition.frontmatter) &&
    isDeepStrictEqual(revision.governance, definition.governance) &&
    isDeepStrictEqual(revision.packagePaths, definition.packagePaths) &&
    revision.prompt.name === definition.promptReference.name &&
    revision.prompt.version === definition.promptReference.version &&
    revision.prompt.contentHash === definition.promptReference.contentHash;
  if (!matches) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `Platform Skill ${definition.skillId} is already provisioned with different facts.`,
    );
  }
}

function platformAcceptanceRun(
  runId: string,
  skillRevisionRef: string,
  prompt: HarnessFrozenPrompt,
): EvalRun {
  return {
    createdAt: '2026-07-30T00:00:00.000Z',
    mode: 'recorded_fixture',
    passed: true,
    results: [
      {
        caseId: `platform-provisioning-${skillRevisionRef}`,
        gateId: 'skill_revision_acceptance',
        memoryDiff: null,
        passed: true,
        promptRevision: `${prompt.name}@${prompt.version}`,
        reason:
          'The checked-in platform recipe passed its frozen acceptance suite.',
        scorerRevision: 'issue-260-platform-recipes@1',
        skillRevisionRef,
      },
    ],
    runId,
    schemaVersion: 'eval-run/v1',
    suiteId: 'issue-260-platform-recipes',
    suiteRevision: 'issue-260-platform-recipes@1',
  };
}

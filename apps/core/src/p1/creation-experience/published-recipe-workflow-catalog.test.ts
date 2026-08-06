import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CreationExperienceCatalogService } from './catalog-service.js';
import { LAUNCH_RECIPE_SPECS } from './launch-seeds.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  mergePublishedRecipeWorkflowRevisionRefs,
  normalizeWorkflowRevisionRef,
} from './published-recipe-workflow-catalog.js';
import type { RecipeBodyInput } from './types.js';

function audit(extra: Record<string, unknown> = {}) {
  return {
    actorId: 'admin-catalog',
    reason: 'published-workflow-catalog-test',
    correlationId: 'corr-published-workflow-catalog',
    ...extra,
  };
}

function sampleRecipeBody(
  overrides: Partial<RecipeBodyInput> = {},
): RecipeBodyInput {
  return {
    lensId: 'image_text',
    familyId: 'catalog-test',
    presentation: {
      title: 'Catalog test recipe',
      summary: 'Published workflow catalog contract',
      actionLabel: 'Apply',
    },
    delivery: {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverableKind: 'note',
      notePageBound: 3,
      quantity: 1,
      aspectRatio: '3:4',
    },
    modelPolicy: { mode: 'auto' },
    promptRevisionRef: 'prompt.catalog-test@1',
    targetWorkspaceKind: 'image_text',
    workflowRevisionRef: 'workflow.catalog-test@1',
    ...overrides,
  };
}

function createService() {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const service = new CreationExperienceCatalogService(
    repository,
    () => '2026-08-06T00:00:00.000Z',
    () => 'session-catalog-1',
  );
  return { repository, service };
}

async function publishRecipe(
  service: CreationExperienceCatalogService,
  recipeId: string,
  body: RecipeBodyInput,
) {
  const draft = await service.draftRecipe({
    recipeId,
    expectedRevision: null,
    body,
    ...audit(),
  });
  const preview = await service.previewRecipe({
    recipeId,
    expectedRevision: draft.revision,
    ...audit({ reason: 'preview' }),
  });
  return service.publishRecipe({
    recipeId,
    expectedRevision: preview.revision,
    ...audit({ reason: 'publish' }),
  });
}

function expectedLaunchSeedWorkflowRefs(): string[] {
  return mergePublishedRecipeWorkflowRevisionRefs([], LAUNCH_RECIPE_SPECS);
}

describe('normalizeWorkflowRevisionRef', () => {
  it('trims and drops empty values', () => {
    assert.equal(normalizeWorkflowRevisionRef('  workflow.copy@1  '), 'workflow.copy@1');
    assert.equal(normalizeWorkflowRevisionRef('   '), null);
    assert.equal(normalizeWorkflowRevisionRef(''), null);
    assert.equal(normalizeWorkflowRevisionRef(undefined), null);
    assert.equal(normalizeWorkflowRevisionRef(null), null);
  });
});

describe('mergePublishedRecipeWorkflowRevisionRefs (pure contract)', () => {
  it('uses launch seeds when the database has no published recipes', () => {
    const seeds = [
      { recipeId: 'recipe.a', workflowRevisionRef: 'workflow.b@1' },
      { recipeId: 'recipe.b', workflowRevisionRef: 'workflow.a@1' },
      { recipeId: 'recipe.c', workflowRevisionRef: '  workflow.a@1  ' },
      { recipeId: 'recipe.d', workflowRevisionRef: '   ' },
      { recipeId: 'recipe.e' },
    ] as const;

    assert.deepEqual(mergePublishedRecipeWorkflowRevisionRefs([], seeds), [
      'workflow.a@1',
      'workflow.b@1',
    ]);
  });

  it('lets the same recipeId prefer database published refs over seed', () => {
    const seeds = [
      { recipeId: 'recipe.shared', workflowRevisionRef: 'workflow.seed@1' },
      { recipeId: 'recipe.only-seed', workflowRevisionRef: 'workflow.seed-only@1' },
    ] as const;
    const published = [
      {
        recipeId: 'recipe.shared',
        workflowRevisionRef: 'workflow.db@1',
      },
    ];

    assert.deepEqual(
      mergePublishedRecipeWorkflowRevisionRefs(published, seeds),
      ['workflow.db@1', 'workflow.seed-only@1'],
    );
  });

  it('drops a recipe contribution when database published status is lost', () => {
    const seeds = [
      { recipeId: 'recipe.seed', workflowRevisionRef: 'workflow.seed@1' },
    ] as const;
    const whilePublished = [
      {
        recipeId: 'recipe.custom',
        workflowRevisionRef: 'workflow.custom@1',
      },
    ];
    assert.deepEqual(
      mergePublishedRecipeWorkflowRevisionRefs(whilePublished, seeds),
      ['workflow.custom@1', 'workflow.seed@1'],
    );

    // No published DB rows for recipe.custom → custom ref expires.
    assert.deepEqual(mergePublishedRecipeWorkflowRevisionRefs([], seeds), [
      'workflow.seed@1',
    ]);
  });

  it('treats an empty published DB ref as an override that suppresses seed', () => {
    const seeds = [
      { recipeId: 'recipe.shared', workflowRevisionRef: 'workflow.seed@1' },
    ] as const;
    const published = [
      { recipeId: 'recipe.shared', workflowRevisionRef: '   ' },
    ];
    assert.deepEqual(
      mergePublishedRecipeWorkflowRevisionRefs(published, seeds),
      [],
    );
  });

  it('dedupes repeated refs and returns a stable sort', () => {
    const seeds = [
      { recipeId: 'recipe.z', workflowRevisionRef: 'workflow.z@1' },
      { recipeId: 'recipe.a', workflowRevisionRef: 'workflow.a@1' },
      { recipeId: 'recipe.a2', workflowRevisionRef: 'workflow.a@1' },
    ] as const;
    const published = [
      { recipeId: 'recipe.m', workflowRevisionRef: 'workflow.m@1' },
      { recipeId: 'recipe.m2', workflowRevisionRef: 'workflow.m@1' },
      { recipeId: 'recipe.b', workflowRevisionRef: 'workflow.b@1' },
    ];
    assert.deepEqual(
      mergePublishedRecipeWorkflowRevisionRefs(published, seeds),
      ['workflow.a@1', 'workflow.b@1', 'workflow.m@1', 'workflow.z@1'],
    );
  });

  it('expires seed contributions when the seed list drops them', () => {
    const before = [
      { recipeId: 'recipe.keep', workflowRevisionRef: 'workflow.keep@1' },
      { recipeId: 'recipe.drop', workflowRevisionRef: 'workflow.drop@1' },
    ] as const;
    const after = [
      { recipeId: 'recipe.keep', workflowRevisionRef: 'workflow.keep@1' },
    ] as const;
    assert.deepEqual(mergePublishedRecipeWorkflowRevisionRefs([], before), [
      'workflow.drop@1',
      'workflow.keep@1',
    ]);
    assert.deepEqual(mergePublishedRecipeWorkflowRevisionRefs([], after), [
      'workflow.keep@1',
    ]);
  });
});

describe('CreationExperienceCatalogService published workflow catalog (memory)', () => {
  it('returns launch-seed workflow refs when the repository is empty', async () => {
    const { service } = createService();
    const refs = await service.listPublishedRecipeWorkflowRevisionRefs();
    assert.deepEqual(refs, expectedLaunchSeedWorkflowRefs());
    // Spot-check real launch seeds used by skill binding journeys.
    assert.ok(refs.includes('workflow.copy@1'));
    assert.ok(refs.includes('workflow.image_text@1'));
    assert.ok(refs.includes('workflow.video.15s@1'));
  });

  it('merges seed with published DB heads and prefers DB for the same recipeId', async () => {
    const { service, repository } = createService();
    // promotion_poster is the only launch seed for workflow.copy@1.
    const uniqueSeed = LAUNCH_RECIPE_SPECS.find(
      (spec) => spec.workflowRevisionRef === 'workflow.copy@1',
    );
    assert.ok(uniqueSeed);

    await publishRecipe(
      service,
      uniqueSeed.recipeId,
      sampleRecipeBody({
        lensId: uniqueSeed.lensId,
        familyId: uniqueSeed.familyId,
        presentation: { ...uniqueSeed.presentation },
        delivery: { ...uniqueSeed.delivery },
        promptRevisionRef: uniqueSeed.promptRevisionRef,
        targetWorkspaceKind: uniqueSeed.lensId,
        workflowRevisionRef: 'workflow.db-override@1',
      }),
    );

    const publishedHeads = await repository.listPublishedRecipes();
    assert.equal(publishedHeads.length, 1);
    assert.equal(publishedHeads[0]?.recipeId, uniqueSeed.recipeId);
    assert.equal(publishedHeads[0]?.status, 'published');

    const refs = await service.listPublishedRecipeWorkflowRevisionRefs();
    assert.ok(refs.includes('workflow.db-override@1'));
    assert.equal(refs.includes('workflow.copy@1'), false);
    // Other seeds remain.
    assert.ok(refs.includes('workflow.image_text@1'));
  });

  it('removes a custom recipe workflow after the head loses published status', async () => {
    const { service, repository } = createService();
    const published = await publishRecipe(
      service,
      'recipe.custom-only',
      sampleRecipeBody({ workflowRevisionRef: 'workflow.custom-only@1' }),
    );
    assert.equal(published.status, 'published');

    let refs = await service.listPublishedRecipeWorkflowRevisionRefs();
    assert.ok(refs.includes('workflow.custom-only@1'));

    // New draft head: no longer published → DB contribution expires.
    await service.draftRecipe({
      recipeId: 'recipe.custom-only',
      expectedRevision: published.revision,
      body: sampleRecipeBody({
        workflowRevisionRef: 'workflow.custom-only@1',
        presentation: {
          title: 'Editing',
          summary: 'Draft after publish',
        },
      }),
      ...audit({ reason: 'edit after publish' }),
    });

    const heads = await repository.listPublishedRecipes();
    assert.equal(
      heads.some((entry) => entry.recipeId === 'recipe.custom-only'),
      false,
    );

    refs = await service.listPublishedRecipeWorkflowRevisionRefs();
    assert.equal(refs.includes('workflow.custom-only@1'), false);
  });

  it('dedupes identical workflow refs across recipes and sorts stably', async () => {
    const { service } = createService();
    await publishRecipe(
      service,
      'recipe.dup-a',
      sampleRecipeBody({ workflowRevisionRef: 'workflow.shared@1' }),
    );
    await publishRecipe(
      service,
      'recipe.dup-b',
      sampleRecipeBody({ workflowRevisionRef: 'workflow.shared@1' }),
    );
    await publishRecipe(
      service,
      'recipe.dup-c',
      sampleRecipeBody({ workflowRevisionRef: 'workflow.unique@1' }),
    );

    const refs = await service.listPublishedRecipeWorkflowRevisionRefs();
    const sharedHits = refs.filter((ref) => ref === 'workflow.shared@1');
    assert.equal(sharedHits.length, 1);
    assert.ok(refs.includes('workflow.unique@1'));
    assert.deepEqual(refs, [...refs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('is a read-only port (no write surface on the catalog query path)', async () => {
    const { service, repository } = createService();
    const before = await repository.listPublishedRecipes();
    const refs = await service.listPublishedRecipeWorkflowRevisionRefs();
    assert.ok(Array.isArray(refs));
    const after = await repository.listPublishedRecipes();
    assert.deepEqual(after, before);
  });
});

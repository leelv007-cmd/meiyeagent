import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { CreationExperienceCatalogService } from './catalog-service.js';
import { LAUNCH_RECIPE_SPECS } from './launch-seeds.js';
import {
  mergePublishedRecipeWorkflowRevisionRefs,
} from './published-recipe-workflow-catalog.js';
import { PostgresCreationExperienceCatalogRepository } from './postgres-repository.js';
import type { RecipeBodyInput } from './types.js';

const connectionString = process.env.TEST_DATABASE_URL;

function audit(extra: Record<string, unknown> = {}) {
  return {
    actorId: 'admin-catalog-pg',
    reason: 'published-workflow-catalog-postgres',
    correlationId: `corr-pg-${randomUUID()}`,
    ...extra,
  };
}

function sampleRecipeBody(
  overrides: Partial<RecipeBodyInput> = {},
): RecipeBodyInput {
  return {
    lensId: 'image_text',
    familyId: 'catalog-pg-test',
    presentation: {
      title: 'Postgres catalog recipe',
      summary: 'Published workflow catalog postgres contract',
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
    promptRevisionRef: 'prompt.catalog-pg@1',
    targetWorkspaceKind: 'image_text',
    workflowRevisionRef: 'workflow.catalog-pg@1',
    ...overrides,
  };
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

test(
  'published Recipe workflow catalog Postgres port matches memory merge contract',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const customRecipeId = `recipe.pg-custom.${suffix}`;
    const overrideSeed = LAUNCH_RECIPE_SPECS.find(
      (spec) => spec.workflowRevisionRef === 'workflow.copy@1',
    );
    assert.ok(overrideSeed);
    // Use a unique recipeId so this suite does not collide with durable launch seeds.
    const overrideRecipeId = `${overrideSeed.recipeId}.pg.${suffix}`;

    const catalog = new PostgresCreationExperienceCatalogRepository(pool);
    await catalog.migrate();

    try {
      const service = new CreationExperienceCatalogService(
        catalog,
        () => '2026-08-06T12:00:00.000Z',
      );

      // 1) Empty contribution from this suite's recipes: seed baseline still present.
      const baseline = await service.listPublishedRecipeWorkflowRevisionRefs();
      assert.ok(baseline.includes('workflow.copy@1'));
      assert.deepEqual(
        baseline,
        [...baseline].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );

      // 2) Custom published recipe contributes its workflow ref.
      const publishedCustom = await publishRecipe(
        service,
        customRecipeId,
        sampleRecipeBody({
          workflowRevisionRef: `workflow.custom.${suffix}@1`,
        }),
      );
      assert.equal(publishedCustom.status, 'published');

      let refs = await service.listPublishedRecipeWorkflowRevisionRefs();
      assert.ok(refs.includes(`workflow.custom.${suffix}@1`));

      const publishedHeads = await catalog.listPublishedRecipes();
      assert.ok(
        publishedHeads.some(
          (entry) =>
            entry.recipeId === customRecipeId && entry.status === 'published',
        ),
      );

      // 3) Same-recipe DB override: publish a recipeId that is not a launch seed id,
      //    then prove merge prefers DB over a synthetic seed list (pure helper parity).
      await publishRecipe(
        service,
        overrideRecipeId,
        sampleRecipeBody({
          workflowRevisionRef: `workflow.db-override.${suffix}@1`,
        }),
      );
      const publishedForMerge = (await catalog.listPublishedRecipes()).filter(
        (entry) =>
          entry.recipeId === customRecipeId ||
          entry.recipeId === overrideRecipeId,
      );
      const merged = mergePublishedRecipeWorkflowRevisionRefs(
        publishedForMerge,
        [
          {
            recipeId: overrideRecipeId,
            workflowRevisionRef: 'workflow.seed-should-lose@1',
          },
          {
            recipeId: `recipe.seed-only.${suffix}`,
            workflowRevisionRef: `workflow.seed-only.${suffix}@1`,
          },
        ],
      );
      assert.ok(merged.includes(`workflow.db-override.${suffix}@1`));
      assert.ok(merged.includes(`workflow.custom.${suffix}@1`));
      assert.ok(merged.includes(`workflow.seed-only.${suffix}@1`));
      assert.equal(merged.includes('workflow.seed-should-lose@1'), false);

      // 4) Cancel publish (draft after published head) drops custom contribution.
      await service.draftRecipe({
        recipeId: customRecipeId,
        expectedRevision: publishedCustom.revision,
        body: sampleRecipeBody({
          workflowRevisionRef: `workflow.custom.${suffix}@1`,
          presentation: {
            title: 'Draft after publish',
            summary: 'Unpublish head for catalog contract',
          },
        }),
        ...audit({ reason: 'unpublish-via-draft' }),
      });

      const headsAfterDraft = await catalog.listPublishedRecipes();
      assert.equal(
        headsAfterDraft.some((entry) => entry.recipeId === customRecipeId),
        false,
      );

      refs = await service.listPublishedRecipeWorkflowRevisionRefs();
      assert.equal(refs.includes(`workflow.custom.${suffix}@1`), false);
      assert.ok(refs.includes(`workflow.db-override.${suffix}@1`));

      // 5) Dedupe across two published heads with the same workflow ref.
      const sharedRef = `workflow.shared.${suffix}@1`;
      await publishRecipe(
        service,
        `recipe.pg-dup-a.${suffix}`,
        sampleRecipeBody({ workflowRevisionRef: sharedRef }),
      );
      await publishRecipe(
        service,
        `recipe.pg-dup-b.${suffix}`,
        sampleRecipeBody({ workflowRevisionRef: sharedRef }),
      );
      refs = await service.listPublishedRecipeWorkflowRevisionRefs();
      assert.equal(refs.filter((ref) => ref === sharedRef).length, 1);
      assert.deepEqual(
        refs,
        [...refs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    } finally {
      // Best-effort cleanup of this suite's recipe rows (heads + revisions).
      await pool.query(
        `DELETE FROM p1_creation_recipe_revisions
          WHERE recipe_id LIKE $1`,
        [`%.${suffix}`],
      );
      await pool.query(
        `DELETE FROM p1_creation_recipe_heads
          WHERE recipe_id LIKE $1`,
        [`%.${suffix}`],
      );
      await pool.query(
        `DELETE FROM p1_creation_recipe_revisions
          WHERE recipe_id = $1 OR recipe_id = $2`,
        [customRecipeId, overrideRecipeId],
      );
      await pool.query(
        `DELETE FROM p1_creation_recipe_heads
          WHERE recipe_id = $1 OR recipe_id = $2`,
        [customRecipeId, overrideRecipeId],
      );
      await pool.end();
    }
  },
);

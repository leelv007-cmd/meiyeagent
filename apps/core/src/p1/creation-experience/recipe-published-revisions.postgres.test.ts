/**
 * recipe_published_revisions Postgres parity (#373).
 * Driver executes with TEST_DATABASE_URL; skipped without it.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { CreationExperienceCatalogService } from './catalog-service.js';
import { PostgresCreationExperienceCatalogRepository } from './postgres-repository.js';
import type {
  RecipeBodyInput,
  RecipePublishedRevisionsResult,
  ServerRecipeRecord,
} from './types.js';
import { recipeRevisionId } from './types.js';

const connectionString = process.env.TEST_DATABASE_URL;

function audit(extra: Record<string, unknown> = {}) {
  return {
    actorId: 'admin-pg',
    reason: 'postgres test',
    correlationId: 'corr-pg-published-revisions',
    ...extra,
  };
}

function sampleRecipeBody(
  overrides: Partial<RecipeBodyInput> = {},
): RecipeBodyInput {
  return {
    lensId: 'image_text',
    presentation: {
      title: 'Postgres recipe',
      summary: 'summary',
    },
    modelPolicy: { mode: 'auto' },
    promptRevisionRef: 'prompt.pg@1',
    targetWorkspaceKind: 'image_text',
    delivery: {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverableKind: 'note',
      notePageBound: 3,
      quantity: 1,
      aspectRatio: '3:4',
    },
    ...overrides,
  };
}

async function publishRecipe(
  catalog: CreationExperienceCatalogService,
  recipeId: string,
  body: RecipeBodyInput = sampleRecipeBody(),
) {
  const draft = await catalog.draftRecipe({
    recipeId,
    expectedRevision: null,
    body,
    ...audit(),
  });
  const preview = await catalog.previewRecipe({
    recipeId,
    expectedRevision: draft.revision,
    ...audit({ reason: 'preview' }),
  });
  return catalog.publishRecipe({
    recipeId,
    expectedRevision: preview.revision,
    ...audit({ reason: 'publish' }),
  });
}

test(
  'recipe_published_revisions Postgres matches memory acceptance (filter/sort/empty groups)',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const surfaceId = `surface.pg-published.${suffix}`;
    const alphaId = `recipe.pg-alpha.${suffix}`;
    const zetaId = `recipe.pg-zeta.${suffix}`;
    const draftOnlyId = `recipe.pg-draft.${suffix}`;
    const ghostId = `recipe.pg-ghost.${suffix}`;
    const repository = new PostgresCreationExperienceCatalogRepository(pool);
    await repository.migrate();
    const catalog = new CreationExperienceCatalogService(
      repository,
      () => '2026-08-06T14:00:00.000Z',
    );

    try {
      const alpha = await publishRecipe(
        catalog,
        alphaId,
        sampleRecipeBody({
          presentation: { title: 'Alpha live', summary: 'a' },
        }),
      );
      const zetaV1 = await publishRecipe(
        catalog,
        zetaId,
        sampleRecipeBody({
          presentation: { title: 'Zeta v1', summary: 'z1' },
          promptRevisionRef: 'prompt.zeta@1',
        }),
      );
      const zetaDraft = await catalog.draftRecipe({
        recipeId: zetaId,
        expectedRevision: zetaV1.revision,
        body: sampleRecipeBody({
          presentation: { title: 'Zeta v2', summary: 'z2' },
          promptRevisionRef: 'prompt.zeta@2',
        }),
        ...audit({ reason: 'zeta v2 draft' }),
      });
      const zetaPreview = await catalog.previewRecipe({
        recipeId: zetaId,
        expectedRevision: zetaDraft.revision,
        ...audit({ reason: 'zeta v2 preview' }),
      });
      const zetaV2 = await catalog.publishRecipe({
        recipeId: zetaId,
        expectedRevision: zetaPreview.revision,
        ...audit({ reason: 'zeta v2 publish' }),
      });

      // Append draft / preview / retired after latest publish — must not appear.
      const postDraft = await catalog.draftRecipe({
        recipeId: zetaId,
        expectedRevision: zetaV2.revision,
        body: sampleRecipeBody({
          presentation: { title: 'Zeta draft head', summary: 'd' },
          promptRevisionRef: 'prompt.zeta@3',
        }),
        ...audit({ reason: 'head draft' }),
      });
      const postPreview = await catalog.previewRecipe({
        recipeId: zetaId,
        expectedRevision: postDraft.revision,
        ...audit({ reason: 'head preview' }),
      });
      const retired: ServerRecipeRecord = {
        ...zetaV2,
        revision: postPreview.revision + 1,
        revisionId: recipeRevisionId(zetaId, postPreview.revision + 1),
        status: 'retired',
        presentation: { title: 'Zeta retired', summary: 'r' },
        createdAt: '2026-08-06T15:00:00.000Z',
        publishedAt: undefined,
        rolledBackToRevision: null,
        actorId: 'admin-pg',
        reason: 'retire',
        correlationId: 'corr-pg-retire',
      };
      await repository.appendRecipe(retired, postPreview.revision);

      await catalog.draftRecipe({
        recipeId: draftOnlyId,
        expectedRevision: null,
        body: sampleRecipeBody({
          presentation: { title: 'Draft only', summary: 'd' },
        }),
        ...audit(),
      });

      await catalog.draftSurface({
        surfaceId,
        expectedRevision: null,
        body: {
          recipeRefs: [
            {
              recipeRevisionId: zetaV2.revisionId,
              lensId: 'image_text',
              order: 0,
              featured: true,
              visible: true,
            },
            {
              recipeRevisionId: alpha.revisionId,
              lensId: 'image_text',
              order: 1,
              featured: false,
              visible: true,
            },
          ],
        },
        ...audit({ reason: 'surface' }),
      });

      const result: RecipePublishedRevisionsResult =
        await catalog.listRecipePublishedRevisions({
          surfaceId,
          recipeIds: [draftOnlyId, ghostId, alphaId],
        });

      assert.deepEqual(
        result.groups.map((g) => g.recipeId),
        [alphaId, draftOnlyId, ghostId, zetaId].sort(),
      );

      const zetaGroup = result.groups.find((g) => g.recipeId === zetaId);
      assert.ok(zetaGroup);
      assert.deepEqual(
        zetaGroup.candidates.map((c) => ({
          revision: c.revision,
          title: c.title,
        })),
        [
          { revision: zetaV2.revision, title: 'Zeta v2' },
          { revision: zetaV1.revision, title: 'Zeta v1' },
        ],
      );
      assert.ok(!zetaGroup.candidates.some((c) => c.title.includes('draft')));
      assert.ok(!zetaGroup.candidates.some((c) => c.title.includes('retired')));
      assert.ok(!zetaGroup.candidates.some((c) => c.title.includes('preview')));

      const draftGroup = result.groups.find((g) => g.recipeId === draftOnlyId);
      const ghostGroup = result.groups.find((g) => g.recipeId === ghostId);
      assert.deepEqual(draftGroup?.candidates, []);
      assert.deepEqual(ghostGroup?.candidates, []);

      // Shared Postgres databases carry seeded recipes; scope to this run.
      const scopedHeads = result.availableRecipeHeads.filter((h) =>
        h.recipeId.endsWith(suffix),
      );
      assert.deepEqual(
        scopedHeads.map((h) => h.recipeId),
        [alphaId, zetaId].sort(),
      );
      assert.equal(
        result.availableRecipeHeads.find((h) => h.recipeId === zetaId)
          ?.revision,
        zetaV2.revision,
      );
    } finally {
      await pool.end();
    }
  },
);

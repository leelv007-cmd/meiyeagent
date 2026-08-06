/**
 * recipe_published_revisions typed query (#373 / Spec D D5 seam).
 * Memory implementation; independent of admin UI consumers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { P1DomainError } from '../foundation/domain.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import type {
  RecipeBodyInput,
  RecipePublishedRevisionsResult,
  ServerRecipeRecord,
} from './types.js';
import { recipeRevisionId } from './types.js';

const context = {
  workspaceId: 'workspace-a',
  userId: 'platform-admin',
  correlationId: 'recipe-published-revisions-1',
  actor: 'admin' as const,
};

function audit(extra: Record<string, unknown> = {}) {
  return {
    actorId: 'admin-1',
    reason: 'test',
    correlationId: 'corr-published-revisions',
    ...extra,
  };
}

function sampleRecipeBody(
  overrides: Partial<RecipeBodyInput> = {},
): RecipeBodyInput {
  return {
    lensId: 'image_text',
    familyId: 'xhs-case-note',
    presentation: {
      title: 'Case note',
      summary: 'summary',
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
    contextPatches: {},
    sourceRequirements: [],
    modelPolicy: { mode: 'auto' },
    settingsPatches: {},
    outputContractRef: 'output.note.v1',
    quotePolicyRevisionRef: 'quote.policy@1',
    workflowRevisionRef: 'workflow.image_text@1',
    promptRevisionRef: 'prompt.xhs-case@1',
    targetWorkspaceKind: 'image_text',
    ...overrides,
  };
}

function createHarness() {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const catalog = new CreationExperienceCatalogService(
    repository,
    () => '2026-08-06T12:00:00.000Z',
  );
  const foundation = new MemoryFoundationRepository();
  const service = new P1ApplicationService(foundation, {
    operations: [new CreationExperienceFoundationModule(repository, catalog)],
  });
  return { repository, catalog, service };
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

async function publishSecondVersion(
  catalog: CreationExperienceCatalogService,
  recipeId: string,
  headRevision: number,
  body: RecipeBodyInput,
) {
  const draft = await catalog.draftRecipe({
    recipeId,
    expectedRevision: headRevision,
    body,
    ...audit({ reason: 'edit v2' }),
  });
  const preview = await catalog.previewRecipe({
    recipeId,
    expectedRevision: draft.revision,
    ...audit({ reason: 'preview v2' }),
  });
  return catalog.publishRecipe({
    recipeId,
    expectedRevision: preview.revision,
    ...audit({ reason: 'publish v2' }),
  });
}

async function draftSurfaceWithRefs(
  catalog: CreationExperienceCatalogService,
  surfaceId: string,
  refs: Array<{ recipeRevisionId: string; lensId?: 'image_text' | 'copy' | 'video' }>,
) {
  return catalog.draftSurface({
    surfaceId,
    expectedRevision: null,
    body: {
      recipeRefs: refs.map((ref, order) => ({
        recipeRevisionId: ref.recipeRevisionId,
        lensId: ref.lensId ?? 'image_text',
        order,
        featured: order === 0,
        visible: true,
      })),
    },
    ...audit({ reason: 'surface draft' }),
  });
}

async function queryPublishedRevisions(
  service: P1ApplicationService,
  surfaceId: string,
  recipeIds: string[],
): Promise<RecipePublishedRevisionsResult> {
  return (await service.queryModule(context, 'creation-experience', {
    action: 'recipe_published_revisions',
    payload: { surfaceId, recipeIds },
  })) as RecipePublishedRevisionsResult;
}

describe('recipe_published_revisions typed query (memory)', () => {
  it('excludes draft / preview / retired revisions from candidates', async () => {
    const { repository, catalog, service } = createHarness();

    const published = await publishRecipe(
      catalog,
      'recipe.mixed',
      sampleRecipeBody({
        presentation: { title: 'Live', summary: 'live', actionLabel: 'Go' },
      }),
    );

    const draft2 = await catalog.draftRecipe({
      recipeId: 'recipe.mixed',
      expectedRevision: published.revision,
      body: sampleRecipeBody({
        presentation: { title: 'Draft only', summary: 'd', actionLabel: 'Go' },
        promptRevisionRef: 'prompt.draft@2',
      }),
      ...audit({ reason: 'new draft' }),
    });
    assert.equal(draft2.status, 'draft');

    const preview2 = await catalog.previewRecipe({
      recipeId: 'recipe.mixed',
      expectedRevision: draft2.revision,
      ...audit({ reason: 'preview only' }),
    });
    assert.equal(preview2.status, 'preview');

    // Retired is append-only and not exposed by transition APIs; seed directly.
    const retired: ServerRecipeRecord = {
      ...published,
      revision: preview2.revision + 1,
      revisionId: recipeRevisionId('recipe.mixed', preview2.revision + 1),
      status: 'retired',
      presentation: {
        title: 'Retired',
        summary: 'retired',
        actionLabel: 'Go',
      },
      contentHash: published.contentHash,
      createdAt: '2026-08-06T13:00:00.000Z',
      publishedAt: undefined,
      rolledBackToRevision: null,
      actorId: 'admin-1',
      reason: 'retire',
      correlationId: 'corr-retire',
    };
    await repository.appendRecipe(retired, preview2.revision);

    await draftSurfaceWithRefs(catalog, 'surface.mixed', [
      { recipeRevisionId: published.revisionId },
    ]);

    const result = await queryPublishedRevisions(service, 'surface.mixed', []);
    assert.equal(result.groups.length, 1);
    assert.deepEqual(
      result.groups[0]?.candidates.map((c) => ({
        revision: c.revision,
        title: c.title,
        status: undefined,
      })),
      [{ revision: published.revision, title: 'Live', status: undefined }],
    );
    assert.equal(result.groups[0]?.candidates.length, 1);
    assert.equal(result.groups[0]?.candidates[0]?.revisionId, published.revisionId);
    assert.ok(
      !result.groups[0]?.candidates.some((c) => c.title === 'Draft only'),
    );
    assert.ok(!result.groups[0]?.candidates.some((c) => c.title === 'Retired'));
  });

  it('sorts groups by recipeId ascending and revisions descending', async () => {
    const { catalog, service } = createHarness();

    const zetaV1 = await publishRecipe(
      catalog,
      'recipe.zeta',
      sampleRecipeBody({
        presentation: { title: 'Zeta v1', summary: 'z1', actionLabel: 'Go' },
      }),
    );
    const zetaV2 = await publishSecondVersion(
      catalog,
      'recipe.zeta',
      zetaV1.revision,
      sampleRecipeBody({
        presentation: { title: 'Zeta v2', summary: 'z2', actionLabel: 'Go' },
        promptRevisionRef: 'prompt.zeta@2',
      }),
    );
    const alpha = await publishRecipe(
      catalog,
      'recipe.alpha',
      sampleRecipeBody({
        presentation: { title: 'Alpha', summary: 'a', actionLabel: 'Go' },
      }),
    );

    await draftSurfaceWithRefs(catalog, 'surface.sort', [
      { recipeRevisionId: zetaV2.revisionId },
      { recipeRevisionId: alpha.revisionId },
    ]);

    const result = await queryPublishedRevisions(service, 'surface.sort', []);
    assert.deepEqual(
      result.groups.map((g) => g.recipeId),
      ['recipe.alpha', 'recipe.zeta'],
    );
    assert.deepEqual(
      result.groups.find((g) => g.recipeId === 'recipe.zeta')?.candidates.map(
        (c) => c.revision,
      ),
      [zetaV2.revision, zetaV1.revision],
    );
    assert.deepEqual(
      result.availableRecipeHeads.map((h) => h.recipeId),
      ['recipe.alpha', 'recipe.zeta'],
    );
    assert.equal(
      result.availableRecipeHeads.find((h) => h.recipeId === 'recipe.zeta')
        ?.revision,
      zetaV2.revision,
    );
  });

  it('keeps empty groups for missing or unpublished recipe ids', async () => {
    const { catalog, service } = createHarness();

    await catalog.draftRecipe({
      recipeId: 'recipe.draft-only',
      expectedRevision: null,
      body: sampleRecipeBody({
        presentation: {
          title: 'Never published',
          summary: 'd',
          actionLabel: 'Go',
        },
      }),
      ...audit(),
    });
    const live = await publishRecipe(
      catalog,
      'recipe.live',
      sampleRecipeBody({
        presentation: { title: 'Live', summary: 'l', actionLabel: 'Go' },
      }),
    );

    await draftSurfaceWithRefs(catalog, 'surface.empty', [
      { recipeRevisionId: live.revisionId },
    ]);

    const result = await queryPublishedRevisions(service, 'surface.empty', [
      'recipe.draft-only',
      'recipe.ghost',
      'recipe.live',
    ]);

    assert.deepEqual(
      result.groups.map((g) => ({
        recipeId: g.recipeId,
        count: g.candidates.length,
      })),
      [
        { recipeId: 'recipe.draft-only', count: 0 },
        { recipeId: 'recipe.ghost', count: 0 },
        { recipeId: 'recipe.live', count: 1 },
      ],
    );
    assert.deepEqual(
      result.availableRecipeHeads.map((h) => h.recipeId),
      ['recipe.live'],
    );
  });

  it('merges surface recipeRefs with caller recipeIds and dedupes', async () => {
    const { catalog, service } = createHarness();
    const onSurface = await publishRecipe(
      catalog,
      'recipe.on-surface',
      sampleRecipeBody({
        presentation: { title: 'On surface', summary: 's', actionLabel: 'Go' },
      }),
    );
    const extra = await publishRecipe(
      catalog,
      'recipe.extra',
      sampleRecipeBody({
        presentation: { title: 'Extra', summary: 'e', actionLabel: 'Go' },
      }),
    );

    await draftSurfaceWithRefs(catalog, 'surface.merge', [
      { recipeRevisionId: onSurface.revisionId },
    ]);

    const result = await queryPublishedRevisions(service, 'surface.merge', [
      'recipe.extra',
      'recipe.on-surface',
      'recipe.extra',
    ]);

    assert.deepEqual(
      result.groups.map((g) => g.recipeId),
      ['recipe.extra', 'recipe.on-surface'],
    );
    assert.equal(
      result.groups.find((g) => g.recipeId === 'recipe.extra')?.candidates[0]
        ?.revisionId,
      extra.revisionId,
    );
  });

  it('is available on the creation-experience query seam and rejects bad input', async () => {
    const { catalog, service } = createHarness();
    const published = await publishRecipe(catalog, 'recipe.seam');
    await draftSurfaceWithRefs(catalog, 'surface.seam', [
      { recipeRevisionId: published.revisionId },
    ]);

    const ok = await queryPublishedRevisions(service, 'surface.seam', []);
    assert.equal(ok.groups[0]?.candidates[0]?.title, 'Case note');
    assert.equal(ok.groups[0]?.candidates[0]?.lensId, 'image_text');
    assert.equal(
      ok.groups[0]?.candidates[0]?.publishedAt,
      '2026-08-06T12:00:00.000Z',
    );

    await assert.rejects(
      () =>
        service.queryModule(context, 'creation-experience', {
          action: 'recipe_published_revisions',
          payload: { surfaceId: 'surface.missing', recipeIds: [] },
        }),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.equal(error.code, 'NOT_FOUND');
        return true;
      },
    );

    await assert.rejects(
      () =>
        service.queryModule(context, 'creation-experience', {
          action: 'recipe_published_revisions',
          payload: { surfaceId: 'surface.seam', recipeIds: 'not-array' },
        }),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.match(error.message, /recipeIds must be an array/);
        return true;
      },
    );
  });
});

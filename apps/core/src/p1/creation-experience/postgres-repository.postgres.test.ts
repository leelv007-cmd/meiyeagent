import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { confirmBrief, projectBriefTrigger } from './brief-trigger-projection.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import { LAUNCH_RECIPE_SPECS } from './launch-seeds.js';
import { MemoryObservabilityEventAudit } from './observability-events.js';
import { PostgresCreationExperienceAuditRepository } from './postgres-audit-repository.js';
import {
  CompositeBriefRevisionResolver,
  PostgresBriefRevisionContextRepository,
} from './postgres-brief-revision-context.js';
import { PostgresCreationExperienceCatalogRepository } from './postgres-repository.js';
import { createDurableCreationExperienceRuntime } from './runtime.js';

const connectionString = process.env.TEST_DATABASE_URL;
const unusedRevisionSources = {
  modelCatalog: {
    async getCurrentPublishedCatalogRevision() {
      return null;
    },
  },
  productQuotes: {
    async getQuote() {
      return null;
    },
  },
};

test(
  'creation-experience Postgres repositories survive restart and isolate audit/confirmation state by workspace',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const recipeId = `recipe.postgres.${suffix}`;
    const surfaceId = `surface.postgres.${suffix}`;
    const sessionId = `session-postgres-${suffix}`;
    const confirmationId = `confirmation-postgres-${suffix}`;
    const briefContextId = `brief-context-postgres-${suffix}`;
    const workspaceA = `workspace-postgres-a-${suffix}`;
    const workspaceB = `workspace-postgres-b-${suffix}`;

    const catalog = new PostgresCreationExperienceCatalogRepository(pool);
    const audit = new PostgresCreationExperienceAuditRepository(pool);
    const revisionContexts = new PostgresBriefRevisionContextRepository(pool);
    await catalog.migrate();
    await audit.migrate();
    await revisionContexts.migrate();

    try {
      const service = new CreationExperienceCatalogService(
        catalog,
        () => '2026-07-20T10:00:00.000Z',
      );
      const draft = await service.draftRecipe({
        actorId: 'admin-a',
        body: {
          lensId: 'video',
          modelPolicy: { mode: 'auto' },
          presentation: { summary: 'restart-safe', title: 'Postgres recipe' },
          promptRevisionRef: 'prompt.postgres@1',
          targetWorkspaceKind: 'video',
          delivery: {
            aspectRatio: '9:16',
            contentPackagePlatform: 'douyin',
            deliverableKind: 'video_package',
            distributionTarget: 'export',
            durationSeconds: 30,
            quantity: 1,
          },
        },
        correlationId: 'corr-postgres',
        expectedRevision: null,
        reason: 'postgres test',
        recipeId,
      });
      const recipePreview = await service.previewRecipe({
        actorId: 'admin-a',
        correlationId: 'corr-postgres',
        expectedRevision: draft.revision,
        reason: 'preview recipe',
        recipeId,
      });
      const publishedRecipe = await service.publishRecipe({
        actorId: 'admin-a',
        correlationId: 'corr-postgres',
        expectedRevision: recipePreview.revision,
        reason: 'publish recipe',
        recipeId,
      });
      const surfaceDraft = await service.draftSurface({
        actorId: 'admin-a',
        body: {
          recipeRefs: [
            {
              featured: true,
              lensId: 'video',
              order: 0,
              recipeRevisionId: publishedRecipe.revisionId,
              visible: true,
            },
          ],
        },
        correlationId: 'corr-postgres',
        expectedRevision: null,
        reason: 'postgres test',
        surfaceId,
      });
      const surfacePreview = await service.previewSurface({
        actorId: 'admin-a',
        correlationId: 'corr-postgres',
        expectedRevision: surfaceDraft.revision,
        reason: 'preview surface',
        surfaceId,
      });
      const publishedSurface = await service.publishSurface({
        actorId: 'admin-a',
        correlationId: 'corr-postgres',
        expectedRevision: surfacePreview.revision,
        reason: 'publish surface',
        surfaceId,
      });
      const frozen = await service.freezeSession({
        workspaceId: workspaceA,
        sessionId,
        surfaceRevisionId: publishedSurface.revisionId,
      });
      const workspaceBFrozen = await service.freezeSession({
        workspaceId: workspaceB,
        sessionId,
        surfaceRevisionId: publishedSurface.revisionId,
      });
      assert.equal(frozen.workspaceId, workspaceA);
      assert.equal(workspaceBFrozen.workspaceId, workspaceB);

      await audit.append(workspaceA, {
        actorId: `ref:${'a'.repeat(64)}`,
        kind: 'start',
        meta: { cardIndex: 1, userText: 'must-not-persist' },
        recipeRevisionId: publishedRecipe.revisionId,
        surfaceRevisionId: publishedSurface.revisionId,
      });
      await revisionContexts.syncBriefRevisionContext(
        workspaceA,
        {
          briefContextId,
          draftRevisionId: `draft-${suffix}@1`,
          lensId: 'video',
          quoteId: `quote-${suffix}`,
          recipeRevisionId: publishedRecipe.revisionId,
          sourceRevisionId: `sources-${suffix}@1`,
          surfaceRevisionId: publishedSurface.revisionId,
        },
        null,
      );
      let quoteRevision = `quote-${suffix}@1`;
      const revisionResolver = new CompositeBriefRevisionResolver(
        revisionContexts,
        catalog,
        {
          async getCurrentPublishedCatalogRevision() {
            return { id: `model-${suffix}@1` };
          },
        },
        {
          async getQuote() {
            return {
              catalogModelId: `model-${suffix}`,
              catalogModelRevision: `model-${suffix}@selected`,
              revision: quoteRevision,
            };
          },
        },
      );
      const boundRevisions = await revisionResolver.resolveCurrentRevisions(
        workspaceA,
        { briefContextId },
      );
      const projection = projectBriefTrigger({
        currentRevisions: boundRevisions,
        deliverableKind: 'video_package',
        lensId: 'video',
      });
      await audit.putBriefConfirmation(
        workspaceA,
        confirmationId,
        confirmBrief({
          confirmedAt: '2026-07-20T10:01:00.000Z',
          projection,
        }),
      );

      const restartedCatalog = new PostgresCreationExperienceCatalogRepository(
        pool,
      );
      const restartedAudit = new PostgresCreationExperienceAuditRepository(pool);
      const restartedService = new CreationExperienceCatalogService(
        restartedCatalog,
      );

      assert.equal(
        (await restartedService.getRecipeByRevisionId(
          publishedRecipe.revisionId,
        ))?.presentation.title,
        'Postgres recipe',
      );
      assert.equal(
        (await restartedService.getSurfaceByRevisionId(
          publishedSurface.revisionId,
        ))?.recipeRefs[0]?.recipeRevisionId,
        publishedRecipe.revisionId,
      );
      assert.deepEqual(
        await restartedService.getSessionFreeze(workspaceA, sessionId),
        frozen,
      );
      assert.deepEqual(
        await restartedService.getSessionFreeze(workspaceB, sessionId),
        workspaceBFrozen,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count
               FROM p1_creation_session_freezes
              WHERE session_id = $1`,
            [sessionId],
          )
        ).rows[0]?.count,
        2,
      );

      const eventsA = await restartedAudit.list(workspaceA);
      assert.equal(eventsA.length, 1);
      assert.deepEqual(eventsA[0]?.meta, { cardIndex: 1 });
      assert.doesNotMatch(JSON.stringify(eventsA[0]), /must-not-persist/);
      assert.deepEqual(await restartedAudit.list(workspaceB), []);
      assert.equal(
        (
          await restartedAudit.getBriefConfirmation(
            workspaceA,
            confirmationId,
          )
        )?.boundRevisions.quoteRevisionId,
        `quote-${suffix}@1`,
      );
      assert.equal(
        await restartedAudit.getBriefConfirmation(workspaceB, confirmationId),
        null,
      );
      const restartedModule = new CreationExperienceFoundationModule(
        restartedCatalog,
        restartedService,
        {
          briefConfirmations: restartedAudit,
          briefRevisionContexts: revisionContexts,
          briefRevisionResolver: revisionResolver,
          eventAudit: restartedAudit,
        },
      );
      quoteRevision = `quote-${suffix}@2`;
      const invalidated = (await restartedModule.query({
        context: {
          actor: 'owner',
          correlationId: 'corr-restart',
          userId: 'owner-a',
          workspaceId: workspaceA,
        },
        input: {
          action: 'brief_project',
          payload: {
            confirmationId,
            briefContextId,
            currentRevisions: projection.bindRevisions,
            deliverableKind: 'video_package',
            lensId: 'video',
          },
        },
      })) as { confirmationInvalid: boolean; requiresBrief: boolean };
      assert.equal(invalidated.confirmationInvalid, true);
      assert.equal(invalidated.requiresBrief, true);

      await assert.rejects(
        () =>
          restartedCatalog.appendRecipe(
            { ...publishedRecipe, revision: publishedRecipe.revision + 1 },
            draft.revision,
          ),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
    } finally {
      await pool.query(
        `DELETE FROM p1_creation_experience_events
          WHERE workspace_id IN ($1, $2)`,
        [workspaceA, workspaceB],
      );
      await pool.query(
        `DELETE FROM p1_creation_brief_confirmations
          WHERE workspace_id IN ($1, $2)`,
        [workspaceA, workspaceB],
      );
      await pool.query(
        `DELETE FROM p1_creation_brief_revision_contexts
          WHERE workspace_id IN ($1, $2)`,
        [workspaceA, workspaceB],
      );
      await pool.query(
        `DELETE FROM p1_creation_session_freezes
          WHERE workspace_id IN ($1, $2) AND session_id = $3`,
        [workspaceA, workspaceB, sessionId],
      );
      await pool.query(
        'DELETE FROM p1_creation_surface_heads WHERE surface_id = $1',
        [surfaceId],
      );
      await pool.query(
        'DELETE FROM p1_creation_surface_revisions WHERE surface_id = $1',
        [surfaceId],
      );
      await pool.query(
        'DELETE FROM p1_creation_recipe_heads WHERE recipe_id = $1',
        [recipeId],
      );
      await pool.query(
        'DELETE FROM p1_creation_recipe_revisions WHERE recipe_id = $1',
        [recipeId],
      );
      await pool.end();
    }
  },
);

test(
  'durable creation-experience runtime publishes launch catalog once across process restart',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const adminPool = new Pool({ connectionString });
    const schema = `creation_runtime_${randomUUID().replaceAll('-', '')}`;
    assert.match(schema, /^[a-z0-9_]+$/);
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const runtimePool = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
    });
    try {
      const first = await createDurableCreationExperienceRuntime({
        observabilityEvents: new MemoryObservabilityEventAudit(),
        pool: runtimePool,
        ...unusedRevisionSources,
      });
      const launchRecipeCount = LAUNCH_RECIPE_SPECS.length;
      assert.equal(first.launch?.recipes.length, launchRecipeCount);
      assert.equal(first.launch?.surface.status, 'published');
      assert.equal(first.launch?.surface.revision, launchRecipeCount * 3);

      const studioDraft = await first.catalog.draftRecipe({
        actorId: 'ops-recipe-studio',
        body: {
          lensId: 'copy',
          modelPolicy: { mode: 'auto' },
          presentation: {
            summary: 'Recipe Studio restart preservation',
            title: 'Recipe Studio extra card',
          },
          promptRevisionRef: 'prompt.recipe-studio-extra@1',
          skillRevisionRefs: ['skill.recipe-studio-extra@1'],
          targetWorkspaceKind: 'copy',
          delivery: {
            contentPackagePlatform: 'xiaohongshu',
            deliverableKind: 'copy_document',
            distributionTarget: 'export',
            quantity: 1,
          },
        },
        correlationId: 'corr-recipe-studio-extra',
        expectedRevision: null,
        reason: 'publish an operator-authored card',
        recipeId: 'recipe.recipe-studio-extra',
      });
      const studioPreview = await first.catalog.previewRecipe({
        actorId: 'ops-recipe-studio',
        correlationId: 'corr-recipe-studio-extra',
        expectedRevision: studioDraft.revision,
        reason: 'preview an operator-authored card',
        recipeId: studioDraft.recipeId,
      });
      const studioRecipe = await first.catalog.publishRecipe({
        actorId: 'ops-recipe-studio',
        correlationId: 'corr-recipe-studio-extra',
        expectedRevision: studioPreview.revision,
        reason: 'publish an operator-authored card',
        recipeId: studioDraft.recipeId,
      });
      const expandedDraft = await first.catalog.draftSurface({
        actorId: 'ops-recipe-studio',
        body: {
          recipeRefs: [
            ...first.launch!.surface.recipeRefs,
            {
              featured: false,
              lensId: studioRecipe.lensId,
              order: 6,
              recipeRevisionId: studioRecipe.revisionId,
              visible: true,
            },
          ],
          toolEntryRefs: first.launch!.surface.toolEntryRefs,
        },
        correlationId: 'corr-recipe-studio-extra',
        expectedRevision: first.launch!.surface.revision,
        reason: 'switch production label',
        surfaceId: first.launch!.surface.surfaceId,
      });
      const expandedPreview = await first.catalog.previewSurface({
        actorId: 'ops-recipe-studio',
        correlationId: 'corr-recipe-studio-extra',
        expectedRevision: expandedDraft.revision,
        reason: 'preview production label',
        surfaceId: expandedDraft.surfaceId,
      });
      const expandedSurface = await first.catalog.publishSurface({
        actorId: 'ops-recipe-studio',
        correlationId: 'corr-recipe-studio-extra',
        expectedRevision: expandedPreview.revision,
        reason: 'publish production label',
        surfaceId: expandedDraft.surfaceId,
      });

      const restarted = await createDurableCreationExperienceRuntime({
        observabilityEvents: new MemoryObservabilityEventAudit(),
        pool: runtimePool,
        ...unusedRevisionSources,
      });
      assert.equal(
        restarted.launch?.surface.revisionId,
        expandedSurface.revisionId,
      );
      assert.equal(
        restarted.launch?.surface.recipeRefs.length,
        launchRecipeCount + 1,
      );
      assert.equal(
        (
          await restarted.catalog.listSurfaceHistory(
            first.launch!.surface.surfaceId,
          )
        ).length,
        expandedSurface.revision,
      );
      for (const recipe of first.launch!.recipes) {
        assert.equal(
          (await restarted.catalog.listRecipeHistory(recipe.recipeId)).length,
          6,
        );
      }
    } finally {
      await runtimePool.end();
      await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminPool.end();
    }
  },
);

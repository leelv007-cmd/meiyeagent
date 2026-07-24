import { isDeepStrictEqual } from 'node:util';
import type { Pool } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import { CreationExperienceBriefSubmissionGate } from './brief-submission-gate.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import {
  LAUNCH_ACTOR,
  LAUNCH_RECIPE_SPECS,
  LAUNCH_SURFACE_ID,
  LAUNCH_TOOL_ENTRY_REFS,
  recipeBodyFromSpec,
  type PublishLaunchCatalogResult,
} from './launch-seeds.js';
import { PostgresCreationExperienceAuditRepository } from './postgres-audit-repository.js';
import {
  CompositeBriefRevisionResolver,
  PostgresBriefRevisionContextRepository,
  type CurrentModelCatalogSource,
  type CurrentProductQuoteSource,
} from './postgres-brief-revision-context.js';
import { PostgresCreationExperienceCatalogRepository } from './postgres-repository.js';
import type { ServerRecipeRecord, ServerSurfaceRecord } from './types.js';

async function ensureLaunchCatalogOnce(
  service: CreationExperienceCatalogService,
): Promise<PublishLaunchCatalogResult> {
  const existingSurface = await service.getSurfaceHead(LAUNCH_SURFACE_ID);
  if (existingSurface?.status === 'published') {
    const recipes = await Promise.all(
      existingSurface.recipeRefs.map(async (ref) => {
        const recipe = await service.getRecipeByRevisionId(ref.recipeRevisionId);
        if (!recipe) {
          throw new P1DomainError(
            'INVALID_STATE',
            `Published launch Surface references missing Recipe ${ref.recipeRevisionId}.`,
          );
        }
        return recipe;
      }),
    );
    if (
      recipes.length === LAUNCH_RECIPE_SPECS.length &&
      recipes.every((recipe, index) =>
        matchesLaunchRecipe(recipe, LAUNCH_RECIPE_SPECS[index]!)
      )
    ) {
      return { recipes, surface: existingSurface };
    }
  }

  const recipes: ServerRecipeRecord[] = [];
  for (const spec of LAUNCH_RECIPE_SPECS) {
    let head = await service.getRecipeHead(spec.recipeId);
    if (!head) {
      head = await service.draftRecipe({
        ...LAUNCH_ACTOR,
        body: recipeBodyFromSpec(spec),
        expectedRevision: null,
        recipeId: spec.recipeId,
      });
    } else if (
      head.status === 'published' &&
      !matchesLaunchRecipe(head, spec)
    ) {
      head = await service.draftRecipe({
        ...LAUNCH_ACTOR,
        body: recipeBodyFromSpec(spec),
        expectedRevision: head.revision,
        recipeId: spec.recipeId,
      });
    }
    if (head.status === 'draft') {
      head = await service.previewRecipe({
        ...LAUNCH_ACTOR,
        expectedRevision: head.revision,
        recipeId: spec.recipeId,
      });
    }
    if (head.status === 'preview') {
      head = await service.publishRecipe({
        ...LAUNCH_ACTOR,
        expectedRevision: head.revision,
        recipeId: spec.recipeId,
      });
    }
    if (head.status !== 'published') {
      throw new P1DomainError(
        'INVALID_STATE',
        `Launch Recipe ${spec.recipeId} cannot recover from status ${head.status}.`,
      );
    }
    recipes.push(head);
  }

  let surface: ServerSurfaceRecord | null = existingSurface;
  const recipeRefs = LAUNCH_RECIPE_SPECS.map((spec, index) => ({
    featured: spec.featured,
    lensId: spec.lensId,
    order: spec.cardOrder,
    recipeRevisionId: recipes[index]!.revisionId,
    visible: true,
  }));
  const toolEntryRefs = LAUNCH_TOOL_ENTRY_REFS.map((entry) => ({ ...entry }));
  if (!surface) {
    surface = await service.draftSurface({
      ...LAUNCH_ACTOR,
      body: {
        recipeRefs,
        toolEntryRefs,
      },
      expectedRevision: null,
      surfaceId: LAUNCH_SURFACE_ID,
    });
  } else if (
    surface.status === 'published' &&
    (!isDeepStrictEqual(surface.recipeRefs, recipeRefs) ||
      !isDeepStrictEqual(surface.toolEntryRefs, toolEntryRefs))
  ) {
    surface = await service.draftSurface({
      ...LAUNCH_ACTOR,
      body: { recipeRefs, toolEntryRefs },
      expectedRevision: surface.revision,
      surfaceId: LAUNCH_SURFACE_ID,
    });
  }
  if (surface.status === 'draft') {
    surface = await service.previewSurface({
      ...LAUNCH_ACTOR,
      expectedRevision: surface.revision,
      surfaceId: LAUNCH_SURFACE_ID,
    });
  }
  if (surface.status === 'preview') {
    surface = await service.publishSurface({
      ...LAUNCH_ACTOR,
      expectedRevision: surface.revision,
      surfaceId: LAUNCH_SURFACE_ID,
    });
  }
  if (surface.status !== 'published') {
    throw new P1DomainError(
      'INVALID_STATE',
      `Launch Surface cannot recover from status ${surface.status}.`,
    );
  }
  return { recipes, surface };
}

function matchesLaunchRecipe(
  recipe: ServerRecipeRecord,
  spec: (typeof LAUNCH_RECIPE_SPECS)[number]
) {
  const body = recipeBodyFromSpec(spec);
  return isDeepStrictEqual(
    {
      lensId: recipe.lensId,
      ...(recipe.familyId ? { familyId: recipe.familyId } : {}),
      presentation: recipe.presentation,
      delivery: recipe.delivery,
      contextPatches: recipe.contextPatches,
      sourceRequirements: recipe.sourceRequirements,
      modelPolicy: recipe.modelPolicy,
      settingsPatches: recipe.settingsPatches,
      ...(recipe.outputContractRef
        ? { outputContractRef: recipe.outputContractRef }
        : {}),
      ...(recipe.quotePolicyRevisionRef
        ? { quotePolicyRevisionRef: recipe.quotePolicyRevisionRef }
        : {}),
      ...(recipe.workflowRevisionRef
        ? { workflowRevisionRef: recipe.workflowRevisionRef }
        : {}),
      promptRevisionRef: recipe.promptRevisionRef,
      targetWorkspaceKind: recipe.targetWorkspaceKind,
    },
    body
  );
}

async function ensureLaunchCatalog(
  service: CreationExperienceCatalogService,
): Promise<PublishLaunchCatalogResult> {
  // Independently booting processes may race on an append. CAS is the source of
  // truth; retry from durable heads instead of holding a pool connection lock.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await ensureLaunchCatalogOnce(service);
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
    'Launch Catalog could not converge after concurrent publication.',
  );
}

/**
 * Production assembly for A1/A3.
 *
 * - Catalog/Surface/session state is durable in Postgres.
 * - Brief confirmations and privacy-filtered events are workspace-scoped.
 * - First-ship seed publication is restart-safe and serialized across processes.
 */
export async function createDurableCreationExperienceRuntime(input: {
  modelCatalog: CurrentModelCatalogSource;
  pool: Pool;
  productQuotes: CurrentProductQuoteSource;
  seedLaunchCatalog?: boolean;
}) {
  const repository = new PostgresCreationExperienceCatalogRepository(input.pool);
  const audit = new PostgresCreationExperienceAuditRepository(input.pool);
  const briefRevisionContexts = new PostgresBriefRevisionContextRepository(
    input.pool,
  );
  await repository.migrate();
  await audit.migrate();
  await briefRevisionContexts.migrate();
  const catalog = new CreationExperienceCatalogService(repository);
  const launch =
    input.seedLaunchCatalog === false
      ? null
      : await ensureLaunchCatalog(catalog);
  const briefRevisionResolver = new CompositeBriefRevisionResolver(
    briefRevisionContexts,
    repository,
    input.modelCatalog,
    input.productQuotes,
  );
  const foundationModule = new CreationExperienceFoundationModule(
    repository,
    catalog,
    {
      briefConfirmations: audit,
      briefRevisionContexts,
      briefRevisionResolver,
      eventAudit: audit,
    },
  );
  const briefSubmissionGate = new CreationExperienceBriefSubmissionGate(
    briefRevisionContexts,
    audit,
    briefRevisionResolver,
  );
  return {
    audit,
    briefRevisionContexts,
    briefSubmissionGate,
    catalog,
    foundationModule,
    launch,
    repository,
  };
}

export type DurableCreationExperienceRuntime = Awaited<
  ReturnType<typeof createDurableCreationExperienceRuntime>
>;

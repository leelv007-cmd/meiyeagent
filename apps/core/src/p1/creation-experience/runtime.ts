import type { Pool } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import type { EvalRunRegistryPort } from '../harness/eval-run-registry.js';
import { PostgresEvalRunRegistry } from '../harness/postgres-eval-run-registry.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import { CreationExperienceBriefSubmissionGate } from './brief-submission-gate.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import {
  LAUNCH_RECIPE_SPECS,
  LAUNCH_SURFACE_ID,
  matchesLaunchRecipeSpec,
  publishLaunchCatalog,
  type PublishLaunchCatalogResult,
} from './launch-seeds.js';
import { PostgresCreationExperienceAuditRepository } from './postgres-audit-repository.js';
import type { ObservabilityEventAuditPort } from './observability-events.js';
import type { TaskObservabilityContextPort } from './observability-events.js';
import {
  CompositeBriefRevisionResolver,
  PostgresBriefRevisionContextRepository,
  type CurrentModelCatalogSource,
  type CurrentProductQuoteSource,
} from './postgres-brief-revision-context.js';
import { PostgresCreationExperienceCatalogRepository } from './postgres-repository.js';
import { PostgresRecipeEvidenceReceiptRegistry } from './postgres-recipe-evidence-receipt-registry.js';
import type { RecipeEvidenceReceiptRegistryPort } from './recipe-evidence-receipt-registry.js';
import type { RecipeSkillRevisionValidationPort } from './recipe-studio.js';
import type { ServerRecipeRecord } from './types.js';

async function ensureLaunchCatalogOnce(
  service: CreationExperienceCatalogService,
  skillRevisionValidation?: RecipeSkillRevisionValidationPort,
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
    const launchRecipes = LAUNCH_RECIPE_SPECS.map((spec) =>
      recipes.find(
        (recipe) =>
          recipe.recipeId === spec.recipeId &&
          recipe.studioRelease?.phase === 'internal_tested' &&
          matchesLaunchRecipeSpec(recipe, spec)
      )
    );
    if (launchRecipes.every((recipe) => recipe !== undefined)) {
      return {
        recipes: launchRecipes as ServerRecipeRecord[],
        surface: existingSurface,
      };
    }
  }
  return publishLaunchCatalog(service, { skillRevisionValidation });
}

async function ensureLaunchCatalog(
  service: CreationExperienceCatalogService,
  skillRevisionValidation?: RecipeSkillRevisionValidationPort,
): Promise<PublishLaunchCatalogResult> {
  // Independently booting processes may race on an append. CAS is the source of
  // truth; retry from durable heads instead of holding a pool connection lock.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await ensureLaunchCatalogOnce(
        service,
        skillRevisionValidation,
      );
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
 * - Spec I shared services: EvalRun registry (read) + recipe evidence receipts.
 */
export async function createDurableCreationExperienceRuntime(input: {
  modelCatalog: CurrentModelCatalogSource;
  observabilityEvents: ObservabilityEventAuditPort;
  taskObservability?: TaskObservabilityContextPort;
  pool: Pool;
  productQuotes: CurrentProductQuoteSource;
  seedLaunchCatalog?: boolean;
  skillRevisionValidation?: RecipeSkillRevisionValidationPort;
  /** Optional inject for tests; production uses harness PostgresEvalRunRegistry. */
  evalRunRegistry?: EvalRunRegistryPort;
  /** Optional inject for tests; production uses Postgres receipt registry. */
  evidenceReceiptRegistry?: RecipeEvidenceReceiptRegistryPort;
}) {
  const repository = new PostgresCreationExperienceCatalogRepository(input.pool);
  const audit = new PostgresCreationExperienceAuditRepository(input.pool);
  const briefRevisionContexts = new PostgresBriefRevisionContextRepository(
    input.pool,
  );
  const evalRunRegistry =
    input.evalRunRegistry ?? new PostgresEvalRunRegistry(input.pool);
  const evidenceReceiptRegistry =
    input.evidenceReceiptRegistry ??
    new PostgresRecipeEvidenceReceiptRegistry(input.pool);
  await repository.migrate();
  await audit.migrate();
  await briefRevisionContexts.migrate();
  if (evalRunRegistry instanceof PostgresEvalRunRegistry) {
    await evalRunRegistry.migrate();
  }
  if (evidenceReceiptRegistry instanceof PostgresRecipeEvidenceReceiptRegistry) {
    await evidenceReceiptRegistry.migrate();
  }
  const catalog = new CreationExperienceCatalogService(repository);
  const launch =
    input.seedLaunchCatalog === false
      ? null
      : await ensureLaunchCatalog(catalog, input.skillRevisionValidation);
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
      observabilityEvents: input.observabilityEvents,
      ...(input.taskObservability
        ? { taskObservability: input.taskObservability }
        : {}),
      skillRevisionValidation: input.skillRevisionValidation,
      // Spec I #396: production redeem is registry-backed (not default-deny).
      evalRunRegistry,
      evidenceReceiptRegistry,
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
    /** Shared EvalRun fact store (harness-owned; Skill write path unchanged). */
    evalRunRegistry,
    /** Immutable recipe evaluation / internal-test evidence receipts. */
    evidenceReceiptRegistry,
    foundationModule,
    launch,
    repository,
  };
}

export type DurableCreationExperienceRuntime = Awaited<
  ReturnType<typeof createDurableCreationExperienceRuntime>
>;

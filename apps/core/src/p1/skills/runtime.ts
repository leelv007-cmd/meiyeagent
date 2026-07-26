import type { Pool } from 'pg';

import { PostgresCreationExperienceCatalogRepository } from '../creation-experience/postgres-repository.js';
import type { HarnessSkillInstructionResolverPort } from '../harness/production-stage-ports.js';
import { SkillFoundationModule } from './foundation-module.js';
import { PostgresSkillRepository } from './postgres-repository.js';
import { SkillService } from './service.js';

class DurableSkillInstructionResolver
  implements HarnessSkillInstructionResolverPort
{
  constructor(
    private readonly service: SkillService,
    private readonly recipes: PostgresCreationExperienceCatalogRepository,
  ) {}

  async resolve(input: Parameters<HarnessSkillInstructionResolverPort['resolve']>[0]) {
    let workflowRevisionRef = `workflow.copy@${input.workflowRevision}`;
    if (input.recipeRevisionId) {
      let recipe = await this.recipes.getRecipeByRevisionId(
        input.recipeRevisionId,
      );
      if (!recipe && input.recipeId) {
        recipe = await this.recipes.getRecipeByRevisionId(
          `${input.recipeId}@${input.recipeRevisionId}`,
        );
      }
      if (recipe?.workflowRevisionRef) {
        workflowRevisionRef = recipe.workflowRevisionRef;
      }
    }
    const resolved = await this.service.resolveStage({
      workflowRevisionRef,
      stage: input.stage,
      plannerSelectedSkillRefs: [],
      userSelectedSkillRefs: [],
    });
    const receipts = await this.service.recordPromptMaterializationReceipts({
      workspaceId: input.workspaceId,
      taskId: input.workflowId,
      workflowRevisionRef,
      stage: input.stage,
      instructions: resolved.selected,
    });
    return { instructions: resolved.selected, receipts };
  }
}

export async function createDurableSkillRuntime(input: {
  pool: Pool;
  repository?: PostgresSkillRepository;
}) {
  const repository =
    input.repository ?? new PostgresSkillRepository(input.pool);
  await repository.migrate();
  const service = new SkillService(repository);
  const recipes = new PostgresCreationExperienceCatalogRepository(input.pool);
  const instructionResolver = new DurableSkillInstructionResolver(
    service,
    recipes,
  );
  const revisionValidation = {
    async listUnavailableFrozenRevisionRefs(
      skillRevisionRefs: readonly string[],
    ) {
      const unavailable: string[] = [];
      for (const reference of skillRevisionRefs) {
        const revision = await repository.getRevision(reference);
        if (!revision || revision.status !== 'accepted_frozen') {
          unavailable.push(reference);
        }
      }
      return unavailable;
    },
  };
  return {
    foundationModule: new SkillFoundationModule(service),
    instructionResolver,
    repository,
    revisionValidation,
    service,
  };
}

export type DurableSkillRuntime = Awaited<
  ReturnType<typeof createDurableSkillRuntime>
>;

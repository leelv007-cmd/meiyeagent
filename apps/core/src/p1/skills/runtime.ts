import type { Pool } from 'pg';

import { PostgresCreationExperienceCatalogRepository } from '../creation-experience/postgres-repository.js';
import {
  HarnessPromptAuthorityUnavailableError,
  promptTraceReference,
  requireHarnessFrozenPrompt,
  type HarnessPromptResolver,
} from '../harness/langfuse-prompts.js';
import type { HarnessSkillManifestSelection } from '../harness/task-admission.js';
import type { HarnessSkillInstructionResolverPort } from '../harness/production-stage-ports.js';
import { SkillFoundationModule } from './foundation-module.js';
import { PostgresSkillRepository } from './postgres-repository.js';
import { SkillService } from './service.js';
import { SkillInvocationToolAdapter } from './tool-adapter.js';
import { StaticSkillToolExecutionAuthorizer } from './tool-authorization.js';
import { SkillPromptAuthorityUnavailableError } from './types.js';
import { provisionPlatformRecipes } from './platform-provisioning.js';
import type {
  SkillInvocationExecutor,
  SkillInvocationResultPublisher,
  SkillOutputValidator,
  SkillPromptSnapshotPort,
} from './types.js';
import {
  createSkillGovernanceDbosRuntime,
  type SkillGovernanceDbosAdapter,
} from './dbos-governance-workflow.js';

export type DurableSkillInstructionResolutionInput = Parameters<
  HarnessSkillInstructionResolverPort['resolve']
>[0] & {
  userSelectedSkillRefs?: readonly string[];
};

export class DurableSkillInstructionResolver
  implements HarnessSkillInstructionResolverPort
{
  constructor(
    private readonly service: SkillService,
    private readonly recipes: PostgresCreationExperienceCatalogRepository,
  ) {}

  async selectManifests(input: DurableSkillInstructionResolutionInput) {
    const workflowRevisionRef =
      await this.workflowRevisionRef(input);
    return this.service.selectStageManifests({
      workflowRevisionRef,
      stage: input.stage,
      ...(input.industryCategory
        ? { industryCategory: input.industryCategory }
        : {}),
      tenantId: input.workspaceId,
      userSelectedSkillRefs: [...(input.userSelectedSkillRefs ?? [])],
    });
  }

  async materializeManifests(
    manifests: readonly HarnessSkillManifestSelection[],
  ) {
    const instructions = await this.service.resolveFrozenRevisions(
      manifests.map((manifest) => manifest.skillRevisionRef),
    );
    return manifests.map((manifest, index) => ({
      ...structuredClone(manifest),
      resolvedInstruction: structuredClone(instructions[index]!),
    }));
  }

  async resolve(input: DurableSkillInstructionResolutionInput) {
    const workflowRevisionRef =
      await this.workflowRevisionRef(input);
    const instructions = input.skillManifestSnapshots
      ? input.skillManifestSnapshots.map((snapshot) => {
          if (!snapshot.resolvedInstruction) {
            throw new Error(
              'Accepted Skill manifest is missing its frozen execution material.',
            );
          }
          return structuredClone(snapshot.resolvedInstruction);
        })
      : input.skillRevisionRefs
      ? await this.service.resolveFrozenRevisions(input.skillRevisionRefs)
      : (
          await this.service.resolveStage({
            workflowRevisionRef,
            stage: input.stage,
            ...(input.industryCategory
              ? { industryCategory: input.industryCategory }
              : {}),
            tenantId: input.workspaceId,
            userSelectedSkillRefs: [...(input.userSelectedSkillRefs ?? [])],
          })
        ).allowlist;
    const receipts = await this.service.recordPromptMaterializationReceipts({
      workspaceId: input.workspaceId,
      taskId: input.workflowId,
      workflowRevisionRef,
      stage: input.stage,
      instructions,
    });
    return { instructions, receipts };
  }

  private async workflowRevisionRef(
    input: DurableSkillInstructionResolutionInput,
  ) {
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
    return workflowRevisionRef;
  }
}

export async function createDurableSkillRuntime(input: {
  pool: Pool;
  promptResolver?: HarnessPromptResolver;
  repository?: PostgresSkillRepository;
  governanceDbos?: SkillGovernanceDbosAdapter;
  toolExecutionAllowlist?: readonly {
    caller: string;
    toolId: string;
  }[];
  provisionPlatformRecipes?: boolean;
}) {
  const repository =
    input.repository ?? new PostgresSkillRepository(input.pool);
  await repository.migrate();
  const service = new SkillService(
    repository,
    undefined,
    input.promptResolver
      ? skillPromptSnapshotPortFromHarness(input.promptResolver)
      : undefined,
    new StaticSkillToolExecutionAuthorizer(
      input.toolExecutionAllowlist ?? [],
    ),
  );
  if (input.provisionPlatformRecipes) {
    if (!input.promptResolver) {
      throw new Error(
        'Platform Skill provisioning requires the Harness prompt resolver.',
      );
    }
    await provisionPlatformRecipes({
      prompts: await input.promptResolver.resolve(),
      repository,
      service,
    });
  }
  const recipes = new PostgresCreationExperienceCatalogRepository(input.pool);
  const instructionResolver = new DurableSkillInstructionResolver(
    service,
    recipes,
  );
  const governanceRuntime = createSkillGovernanceDbosRuntime({
    service,
    ...(input.governanceDbos ? { dbos: input.governanceDbos } : {}),
  });
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
    createInvocationTool(input: {
      executor: SkillInvocationExecutor;
      resultPublisher: SkillInvocationResultPublisher;
      outputValidator?: SkillOutputValidator;
    }) {
      return new SkillInvocationToolAdapter(
        service,
        input.executor,
        input.resultPublisher,
        input.outputValidator,
      );
    },
    foundationModule: new SkillFoundationModule(service, governanceRuntime),
    governanceRuntime,
    instructionResolver,
    repository,
    revisionValidation,
    service,
  };
}

export function skillPromptSnapshotPortFromHarness(
  resolver: HarnessPromptResolver,
): SkillPromptSnapshotPort {
  const resolvePrompts = async () => {
    try {
      return await resolver.resolve();
    } catch (error) {
      if (error instanceof HarnessPromptAuthorityUnavailableError) {
        throw new SkillPromptAuthorityUnavailableError(error.message);
      }
      throw error;
    }
  };
  return {
    async capture(reference) {
      const prompts = await resolvePrompts();
      const prompt = Object.values(prompts).find(
        (candidate) =>
          candidate.name === reference.name &&
          candidate.version === reference.version &&
          candidate.contentHash === reference.contentHash,
      );
      if (!prompt) {
        const fallback = Object.values(prompts).find(
          (candidate) =>
            candidate.name === reference.name &&
            candidate.isFallback &&
            isPromptAuthorityUnavailableReason(candidate.fallbackReason),
        );
        if (fallback) {
          throw new SkillPromptAuthorityUnavailableError(
            `Harness prompt authority is unavailable (${fallback.fallbackReason}).`,
          );
        }
        throw new Error(
          'Harness prompt resolver did not return the pinned Skill prompt.',
        );
      }
      return structuredClone(prompt);
    },
    async reference(slot) {
      const prompts = await resolvePrompts();
      const prompt = requireHarnessFrozenPrompt(prompts, slot);
      const reference = promptTraceReference(prompt);
      if (!reference) {
        throw new SkillPromptAuthorityUnavailableError(
          'Harness prompt resolver did not return the requested prompt.',
        );
      }
      return {
        ...structuredClone(prompt),
        ...reference,
      };
    },
  };
}

function isPromptAuthorityUnavailableReason(reason: string | undefined) {
  if (reason === 'request_failed') return true;
  const status = /^http_(\d{3})$/u.exec(reason ?? '')?.[1];
  if (!status) return false;
  const code = Number(status);
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

export type DurableSkillRuntime = Awaited<
  ReturnType<typeof createDurableSkillRuntime>
>;

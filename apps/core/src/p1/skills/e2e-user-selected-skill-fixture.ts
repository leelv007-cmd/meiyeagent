/**
 * E2E-only published fixture for Spec E / #382 merchant user_selected journey.
 *
 * Seeds a platform user_selectable Skill bound as user_selected on the copy
 * workflow (intent_naming), plus an optional tenant-scoped Skill that only one
 * workspace can see — so Playwright can prove isolation without admin route-mocks.
 *
 * Idempotent: re-seeding the same stable ids is a no-op when heads match.
 */

import type { EvalRun } from '../../contracts/index.js';
import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';
import type { SkillRepository } from './repository.js';
import type { SkillService } from './service.js';
import type { SkillGovernanceSidecar, SkillRevision } from './types.js';

export const E2E_USER_SELECTED_SKILL_ID = 'skill.e2e-user-selected';
export const E2E_USER_SELECTED_BINDING_ID = 'binding.e2e.user-selected@1';
export const E2E_TENANT_ISOLATED_SKILL_ID = 'skill.e2e-tenant-isolated';
export const E2E_TENANT_ISOLATED_BINDING_ID = 'binding.e2e.tenant-isolated@1';
export const E2E_USER_SELECTED_WORKFLOW_REF = 'workflow.copy@1';
export const E2E_USER_SELECTED_STAGE = 'intent_naming' as const;

const FIXTURE_ACTOR = 'system.e2e-user-selected-skill-fixture';
const FIXTURE_WORKSPACE = '__e2e_user_selected_skill__';

const PUBLIC_INSTRUCTION =
  'E2E user_selected fixture: when the merchant opts in, prefer one short story beat and one concrete next step from confirmed store facts only.';

const TENANT_INSTRUCTION =
  'E2E tenant-isolated user_selected fixture: only the owning workspace may opt into this enhancement.';

export type E2EUserSelectedSkillSeedResult = {
  ready: true;
  publicSkill: {
    skillId: string;
    skillRevisionRef: string;
    title: string;
    promptName: string;
    promptVersion: string;
    promptNameAtVersion: string;
  };
  tenantIsolatedSkill: {
    skillId: string;
    skillRevisionRef: string;
    title: string;
    tenantWorkspaceId: string;
  } | null;
};

export class E2EUserSelectedSkillFixture {
  constructor(
    private readonly options: {
      service: SkillService;
      repository: Pick<
        SkillRepository,
        | 'putImmutable'
        | 'getCatalog'
        | 'getBinding'
        | 'getRevision'
        | 'getRevisionHead'
      >;
      /**
       * Frozen prompt pin — must be the intent_naming stage prompt so this
       * Skill shares the frozen snapshot with the platform capture-store
       * recipe injected at the same stage (stage-injection invariant).
       */
      prompt: HarnessFrozenPrompt;
      clock?: () => string;
    },
  ) {}

  async seed(input: {
    /** Authenticated merchant workspace (seed actor boundary). */
    workspaceId: string;
    /**
     * When set, also publish a second user_selectable Skill bound only to this
     * tenantId so other workspaces cannot see or select it.
     */
    foreignWorkspaceId?: string;
  }): Promise<E2EUserSelectedSkillSeedResult> {
    void input.workspaceId;
    const publicRevision = await this.publishSkill({
      skillId: E2E_USER_SELECTED_SKILL_ID,
      name: 'E2E story beat',
      description: 'E2E capability pack: one story beat and one next step.',
      instruction: PUBLIC_INSTRUCTION,
      bindingId: E2E_USER_SELECTED_BINDING_ID,
      tenantId: null,
    });

    let tenantIsolatedSkill: E2EUserSelectedSkillSeedResult['tenantIsolatedSkill'] =
      null;
    const foreign = input.foreignWorkspaceId?.trim();
    if (foreign) {
      const isolated = await this.publishSkill({
        skillId: E2E_TENANT_ISOLATED_SKILL_ID,
        name: 'E2E private pack',
        description: 'E2E tenant-scoped pack; other workspaces must not see it.',
        instruction: TENANT_INSTRUCTION,
        bindingId: E2E_TENANT_ISOLATED_BINDING_ID,
        tenantId: foreign,
      });
      tenantIsolatedSkill = {
        skillId: E2E_TENANT_ISOLATED_SKILL_ID,
        skillRevisionRef: isolated.skillRevisionRef,
        title: 'E2E private pack',
        tenantWorkspaceId: foreign,
      };
    }

    const prompt = this.options.prompt;
    return {
      ready: true,
      publicSkill: {
        skillId: E2E_USER_SELECTED_SKILL_ID,
        skillRevisionRef: publicRevision.skillRevisionRef,
        title: 'E2E story beat',
        promptName: prompt.name,
        promptVersion: prompt.version,
        promptNameAtVersion: `${prompt.name}@${prompt.version}`,
      },
      tenantIsolatedSkill,
    };
  }

  private async publishSkill(input: {
    skillId: string;
    name: string;
    description: string;
    instruction: string;
    bindingId: string;
    tenantId: string | null;
  }): Promise<SkillRevision> {
    const prompt = this.options.prompt;
    const promptReference = {
      contentHash: prompt.contentHash,
      name: prompt.name,
      version: prompt.version,
    };
    const governance = fixtureGovernance();

    let revision = await this.options.repository.getRevisionHead(input.skillId);
    if (!revision) {
      revision = (
        await this.options.service.defineCatalogAndDraftRevision({
          actorId: FIXTURE_ACTOR,
          description: input.description,
          expectedRevision: null,
          governance,
          instruction: input.instruction,
          manifest: {
            description: input.description,
            license: 'MIT',
            name: input.skillId.replaceAll('.', '-'),
          },
          name: input.name,
          packagePaths: ['SKILL.md'],
          presentationPolicy: 'user_selectable',
          promptReference,
          skillId: input.skillId,
          sourceKind: 'authored',
          tier: 'platform',
        })
      ).revision;
    }

    if (revision.status !== 'accepted_frozen') {
      const evalRunId = `eval.e2e.${input.skillId}@${revision.revision}`;
      await this.options.repository.putImmutable(
        evalRunId,
        acceptanceRun({
          createdAt: this.now(),
          evalRunId,
          prompt,
          skillRevisionRef: revision.skillRevisionRef,
        }),
      );
      revision = await this.options.service.acceptAndFreezeRevision({
        actorId: FIXTURE_ACTOR,
        evalRunId,
        skillRevisionRef: revision.skillRevisionRef,
      });
    }

    let catalog = await this.options.repository.getCatalog(input.skillId);
    if (!catalog) {
      throw new Error(`E2E Skill catalog missing for ${input.skillId}`);
    }
    if (catalog.activeRevisionRef !== revision.skillRevisionRef) {
      await this.options.service.publishAcceptedRevision({
        actorId: FIXTURE_ACTOR,
        expectedPublicationGeneration: catalog.publicationGeneration,
        expectedPublishedRevisionRef: catalog.activeRevisionRef,
        runId: `publish.e2e.${input.skillId}@${revision.revision}`,
        skillId: input.skillId,
        targetSkillRevisionRef: revision.skillRevisionRef,
        workspaceId: FIXTURE_WORKSPACE,
      });
      catalog = await this.options.repository.getCatalog(input.skillId);
    }
    if (catalog?.activeRevisionRef !== revision.skillRevisionRef) {
      throw new Error(
        `E2E Skill publication did not activate ${revision.skillRevisionRef}.`,
      );
    }

    const binding = await this.options.repository.getBinding(input.bindingId);
    if (!binding) {
      await this.options.service.bindRevision({
        bindingId: input.bindingId,
        mode: 'user_selected',
        skillRevisionRef: revision.skillRevisionRef,
        triggerCondition: {
          harnessStage: E2E_USER_SELECTED_STAGE,
          industryCategory: null,
          tenantId: input.tenantId,
        },
        workflowRevisionRef: E2E_USER_SELECTED_WORKFLOW_REF,
      });
    } else if (
      binding.skillRevisionRef !== revision.skillRevisionRef ||
      binding.status !== 'active' ||
      binding.mode !== 'user_selected' ||
      (binding.triggerCondition.tenantId ?? null) !== input.tenantId
    ) {
      throw new Error(
        `E2E Skill binding ${input.bindingId} has conflicting facts.`,
      );
    }

    return revision;
  }

  private now() {
    return (this.options.clock ?? (() => new Date().toISOString()))();
  }
}

function fixtureGovernance(): SkillGovernanceSidecar {
  return {
    budget: {
      maxChildEffects: 0,
      maxCostCents: 0,
      timeoutMs: 10_000,
    },
    contextScopes: [],
    executionMode: 'prompt_materialized',
    fallback: 'fail_closed',
    inputSchemaRef: 'skill-input.daily-industry@1',
    outputSchemaRef: 'skill-output.intent-decision@1',
    requiredModelCapabilities: ['structured_output'],
    sideEffectClass: 'none',
    workflowRevisionRefs: [E2E_USER_SELECTED_WORKFLOW_REF],
  };
}

function acceptanceRun(input: {
  createdAt: string;
  evalRunId: string;
  prompt: HarnessFrozenPrompt;
  skillRevisionRef: string;
}): EvalRun {
  return {
    createdAt: input.createdAt,
    mode: 'recorded_fixture',
    passed: true,
    results: [
      {
        caseId: `e2e-user-selected-${input.skillRevisionRef}`,
        gateId: 'skill_revision_acceptance',
        memoryDiff: null,
        passed: true,
        promptRevision: `${input.prompt.name}@${input.prompt.version}`,
        reason: 'E2E user_selected fixture acceptance gate.',
        scorerRevision: 'e2e-user-selected-skill@1',
        skillRevisionRef: input.skillRevisionRef,
      },
    ],
    runId: input.evalRunId,
    schemaVersion: 'eval-run/v1',
    suiteId: 'e2e-user-selected-skill',
    suiteRevision: 'e2e-user-selected-skill@1',
  };
}

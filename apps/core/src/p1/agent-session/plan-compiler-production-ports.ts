/**
 * Production PlanCompiler ports (V31-09).
 *
 * Deterministic authorities only — quote / rights / model availability never
 * come from the model proposal. Full product quote reserve remains on the
 * confirm/admission path (V31-11/12); compile binds a plan-scoped quote ref.
 */

import { asRightsPlatform, type PlanDeliverable } from '@meiye/contracts';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { PLATFORM_BEAUTY_COPYWRITING_SKILL_ID } from '../skills/platform-provisioning.js';
import type {
  PlanCompilerModelPort,
  PlanCompilerPorts,
  PlanCompilerQuotePort,
  PlanCompilerRecipeSkillPort,
  PlanCompilerRightsPort,
} from './plan-compiler.js';

export type ProductionPlanRightsResolver = {
  resolve(input: {
    workspaceId: string;
    assetIds: string[];
    platform?: string;
  }): Promise<{
    knownAssetIds?: string[];
    unauthorizedAssetIds: string[];
  }>;
  resolveWithRevision?(input: {
    workspaceId: string;
    assetIds: string[];
    platform?: string;
  }): Promise<{
    knownAssetIds?: string[];
    rightsRevision: string;
    unauthorizedAssetIds: string[];
  }>;
};

export function planCompilerRightsRevisionId(input: {
  workspaceId: string;
  knownAssetIds: readonly string[];
  unauthorizedAssetIds: readonly string[];
}) {
  const rightsFingerprint = fingerprintValue({
    workspaceId: input.workspaceId,
    known: input.knownAssetIds,
    unauthorized: input.unauthorizedAssetIds,
  }).slice(0, 16);
  return `rights:${input.workspaceId}:${rightsFingerprint}`;
}

export type ProductionPlanModelCatalog = {
  getCatalog(
    workspaceId: string,
    operation: 'copy.generate' | 'image.generate' | 'video.generate',
  ): Promise<{
    revisionId: string;
    models: ReadonlyArray<{ id: string }>;
  }>;
};

const CARRIER_OPERATION: Record<
  PlanDeliverable['kind'],
  'copy.generate' | 'image.generate' | 'video.generate'
> = {
  copy: 'copy.generate',
  note: 'image.generate',
  media: 'video.generate',
};

export function createProductionPlanCompilerPorts(deps: {
  rights: ProductionPlanRightsResolver;
  models: ProductionPlanModelCatalog;
  /** Optional recipe/catalog pin from creation-experience / skill registry. */
  catalogRevisionId?: string;
  clock?: () => Date;
}): PlanCompilerPorts {
  const quote: PlanCompilerQuotePort = {
    async resolveQuote(input) {
      if (!input.quoteResolutionHint) {
        throw new Error('Plan compile requires a ProductQuote authority snapshot.');
      }
      return input.quoteResolutionHint;
    },
  };

  const rights: PlanCompilerRightsPort = {
    async resolveRights(input) {
      // Intentions that look like asset ids are rights-checked; free text stays usage notes.
      const assetIds = input.assetIntentions.filter((value) =>
        /^[A-Za-z0-9_.:-]{3,}$/u.test(value),
      );
      // V31-55: must match execution-plan-live-facts.ts's verify-time
      // narrowing exactly, or a deliverable targeting a platform outside the
      // rights domain's two-value allowlist (e.g. wechat_moments) fingerprints
      // differently at compile time vs. verify time for reasons unrelated to
      // any real rights change, and falsely trips SNAPSHOT_STALE on admission.
      const platform = asRightsPlatform(
        input.deliverables.find((item) => item.platform)?.platform,
      );
      const rightsInput = {
        workspaceId: input.workspaceId,
        assetIds,
        ...(platform ? { platform } : {}),
      };
      let authoritativeRevision: string | undefined;
      let resolved: {
        knownAssetIds?: string[];
        unauthorizedAssetIds: string[];
      };
      if (deps.rights.resolveWithRevision) {
        const decision = await deps.rights.resolveWithRevision(rightsInput);
        authoritativeRevision = decision.rightsRevision;
        resolved = decision;
      } else {
        resolved =
          assetIds.length > 0
            ? await deps.rights.resolve(rightsInput)
            : { knownAssetIds: [], unauthorizedAssetIds: [] };
      }
      const knownAssetIds = resolved.knownAssetIds ?? [];
      const unauthorizedAssetIds = resolved.unauthorizedAssetIds;


      return {
        rightsSummary: {
          source: 'content_package_rights',
          knownAssetIds,
          unauthorizedAssetIds,
          status: unauthorizedAssetIds.length > 0 ? 'partial' : 'resolved',
        },
        rightsRevisionIds: [
          authoritativeRevision ??
            planCompilerRightsRevisionId({
              workspaceId: input.workspaceId,
              knownAssetIds,
              unauthorizedAssetIds,
            }),
        ],
        assetUsages: knownAssetIds.map((assetRef) => ({ assetRef })),
        factUsages: input.factIntentions.map((factRef) => ({ factRef })),
        // Rights are an execution authority, not a warning. Any unauthorized
        // referenced asset makes readiness blocked until a new revision binds
        // an authorized set.
        blocked: unauthorizedAssetIds.length > 0,
      };
    },
  };

  const models: PlanCompilerModelPort = {
    async resolveAvailability(input) {
      const operations = [
        ...new Set(
          input.deliverables.map((item) => CARRIER_OPERATION[item.kind]),
        ),
      ];
      const modelRevisionIds: string[] = [];
      const carriers: string[] = [];
      let available = true;
      let unavailableReason: string | undefined;

      for (const operation of operations) {
        try {
          const catalog = await deps.models.getCatalog(
            input.workspaceId,
            operation,
          );
          modelRevisionIds.push(catalog.revisionId);
          carriers.push(operation);
          if (catalog.models.length === 0) {
            available = false;
            unavailableReason = `no_models:${operation}`;
          }
        } catch (error) {
          available = false;
          unavailableReason =
            error instanceof Error ? error.message : 'model_catalog_error';
        }
      }

      return {
        capabilitySummary: {
          source: 'model_supply_catalog',
          operations: carriers,
          harnessReleaseId: input.harnessReleaseId,
        },
        modelRevisionIds: [...new Set(modelRevisionIds)],
        available,
        ...(unavailableReason ? { unavailableReason } : {}),
      };
    },
  };

  const recipeSkills: PlanCompilerRecipeSkillPort = {
    async resolveRecipeSkills(input) {
      // D-101: merge onto existing Recipe/Skill registry — invocation receipt only.
      const catalogRevisionId =
        deps.catalogRevisionId?.trim() || 'creation-experience-catalog';
      return {
        recipeRevisionIds: [],
        catalogRevisionId,
        sourceRevisionIds: [],
        skillInvocationReceipts: [
          {
            skillId: PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
            skillRevisionRef: `${PLATFORM_BEAUTY_COPYWRITING_SKILL_ID}@plan_compile`,
            contentHash: fingerprintValue({
              skillId: PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
              harnessReleaseId: input.harnessReleaseId,
              stage: 'plan_compile',
            }).slice(0, 32),
            harnessReleaseId: input.harnessReleaseId,
            stage: 'plan_compile',
            invokedAt: input.now,
          },
        ],
        complianceSummary: {
          source: 'plan_compile_recipe_merge',
          deliverableKinds: input.deliverables.map((item) => item.kind),
        },
      };
    },
  };

  return { quote, rights, models, recipeSkills };
}

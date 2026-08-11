/**
 * Production PlanCompiler ports (V31-09 / V31-38).
 *
 * Deterministic authorities only — quote / rights / model availability /
 * recipe / source / catalog / skill never come from the model proposal or
 * synthetic compile-time fabrication. Full product quote reserve remains on
 * the confirm/admission path (V31-11/12); compile binds a plan-scoped quote ref.
 */

import {
  asRightsPlatform,
  type PlanDeliverable,
  type Platform,
} from '@meiye/contracts';

import { PLATFORM_BEAUTY_COPYWRITING_SKILL_ID } from '../skills/platform-provisioning.js';
import type {
  PlanCompilerModelPort,
  PlanCompilerPorts,
  PlanCompilerQuotePort,
  PlanCompilerRecipeSkillPort,
  PlanCompilerRightsPort,
} from './plan-compiler.js';
import { PlanCompilerError } from './plan-compiler.js';

export type ProductionPlanRightsResolver = {
  resolve(input: {
    workspaceId: string;
    assetIds: string[];
    platform?: Platform;
  }): Promise<{
    knownAssetIds?: string[];
    unauthorizedAssetIds: string[];
  }>;
  resolveWithRevision(input: {
    workspaceId: string;
    assetIds: string[];
    platform?: Platform;
  }): Promise<{
    knownAssetIds?: string[];
    rightsRevision: string;
    unauthorizedAssetIds: string[];
  }>;
};

export type ProductionPlanModelCatalog = {
  getCatalog(
    workspaceId: string,
    operation: 'copy.generate' | 'image.generate' | 'video.generate',
  ): Promise<{
    revisionId: string;
    models: ReadonlyArray<{ id: string }>;
  }>;
};

/**
 * Platform skill manifest / repository authority used at plan compile.
 * Returns the exact skillRevisionRef + contentHash already issued by the
 * skill domain — never a compile-time fingerprint (V31-38).
 */
export type ProductionPlanSkillAuthority = {
  resolveSkill(input: { skillId: string }): Promise<{
    skillId: string;
    skillRevisionRef: string;
    contentHash: string;
  } | null>;
};

const CARRIER_OPERATION: Record<
  PlanDeliverable['kind'],
  'copy.generate' | 'image.generate' | 'video.generate'
> = {
  copy: 'copy.generate',
  note: 'image.generate',
  media: 'video.generate',
};

function requireNonEmptyIds(
  values: readonly string[] | undefined,
  authority: 'recipe' | 'source',
): string[] {
  const ids = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (ids.length === 0) {
    throw new PlanCompilerError(
      'INVALID_STATE',
      `Plan compile requires authoritative ${authority} revision ids.`,
    );
  }
  return ids;
}

function requireCatalogRevisionId(value: string | undefined): string {
  const catalogRevisionId = value?.trim() ?? '';
  if (!catalogRevisionId) {
    throw new PlanCompilerError(
      'INVALID_STATE',
      'Plan compile requires an authoritative catalog revision id.',
    );
  }
  return catalogRevisionId;
}

export function createProductionPlanCompilerPorts(deps: {
  rights: ProductionPlanRightsResolver;
  models: ProductionPlanModelCatalog;
  /** Platform skill revision authority (repository / accepted manifest head). */
  skills: ProductionPlanSkillAuthority;
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
      if (!deps.rights.resolveWithRevision) {
        throw new Error(
          'Production plan compilation requires an authoritative rights revision.',
        );
      }
      const resolved = await deps.rights.resolveWithRevision(rightsInput);
      const knownAssetIds = resolved.knownAssetIds ?? [];
      const unauthorizedAssetIds = resolved.unauthorizedAssetIds;


      return {
        rightsSummary: {
          source: 'content_package_rights',
          knownAssetIds,
          unauthorizedAssetIds,
          status: unauthorizedAssetIds.length > 0 ? 'partial' : 'resolved',
        },
        rightsRevisionIds: [resolved.rightsRevision],
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
      // V31-38: recipe / source / catalog bind only from admitted authority pins.
      // Missing any pin fails closed — no empty arrays, no literal catalog fallback.
      const hint = input.recipeAuthorityHint;
      if (!hint) {
        throw new PlanCompilerError(
          'INVALID_STATE',
          'Plan compile requires recipe/source/catalog authority from the admitted submission.',
        );
      }
      const recipeRevisionIds = requireNonEmptyIds(
        hint.recipeRevisionIds,
        'recipe',
      );
      const catalogRevisionId = requireCatalogRevisionId(hint.catalogRevisionId);
      const sourceRevisionIds = requireNonEmptyIds(
        hint.sourceRevisionIds,
        'source',
      );

      // Skill receipt must carry a skill-domain-issued revision + contentHash.
      // Never fabricate a synthetic compile-stage revision or fingerprint hash.
      const skill = await deps.skills.resolveSkill({
        skillId: PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
      });
      const skillRevisionRef = skill?.skillRevisionRef?.trim() ?? '';
      const contentHash = skill?.contentHash?.trim() ?? '';
      if (!skill || !skillRevisionRef || !contentHash) {
        throw new PlanCompilerError(
          'INVALID_STATE',
          `Plan compile requires platform skill authority for ${PLATFORM_BEAUTY_COPYWRITING_SKILL_ID}.`,
        );
      }

      return {
        recipeRevisionIds,
        catalogRevisionId,
        sourceRevisionIds,
        skillInvocationReceipts: [
          {
            skillId: skill.skillId || PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
            skillRevisionRef,
            contentHash,
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

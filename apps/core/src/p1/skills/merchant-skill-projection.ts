/**
 * Merchant-facing Skill capability-pack projection (Spec E / #378).
 *
 * Distinct from admin `listCatalog`: only explainable / user_selectable packs
 * that pass workspace, tier, lens, publish, and binding filters. Serialization
 * is allowlist-only so hidden fields cannot leak through UI omission.
 */

import type {
  CreationLensId,
  MerchantSkillCapabilityItem,
  MerchantSkillPresentationPolicy,
  MerchantSkillProjection,
  MerchantSkillTier,
} from '@meiye/contracts';
import { creationLensIds } from '@meiye/contracts';

import type { SkillBinding, SkillCatalog, SkillTier } from './types.js';

/** Keys that must never appear on merchant skill projection payloads. */
export const FORBIDDEN_MERCHANT_SKILL_KEYS = [
  'SKILL.md',
  'allowed-tools',
  'allowedTools',
  'budget',
  'contentHash',
  'contextScopes',
  'credential',
  'credentialRef',
  'deployment',
  'evalRunId',
  'executionMode',
  'fallback',
  'governance',
  'hiddenPrompt',
  'hiddenPromptBody',
  'inputSchemaRef',
  'instruction',
  'instructions',
  'manifest',
  'nativeSkillId',
  'nativeVersion',
  'outputSchemaRef',
  'packagePaths',
  'prompt',
  'promptBody',
  'promptText',
  'prompt_text',
  'provider',
  'requiredModelCapabilities',
  'scripts',
  'sideEffectClass',
  'sourceKind',
  'sourceRef',
  'systemPrompt',
  'system_prompt',
  'tool',
  'tools',
  'workflowRevisionRefs',
] as const;

const MERCHANT_ITEM_ALLOWLIST = [
  'skillId',
  'skillRevisionRef',
  'title',
  'summary',
  'presentationPolicy',
  'selectionEligible',
  'tier',
] as const;

export type MerchantSkillProjectionSource = {
  catalog: SkillCatalog;
  skillRevisionRef: string;
};

export function isCreationLensId(value: string): value is CreationLensId {
  return (creationLensIds as readonly string[]).includes(value);
}

export function isMerchantPresentationPolicy(
  value: SkillCatalog['presentationPolicy'],
): value is MerchantSkillPresentationPolicy {
  return value === 'explainable' || value === 'user_selectable';
}

/**
 * Platform / industry: published catalog visibility.
 * Store (workspace) tier: only the owning workspace sees the pack.
 */
export function isMerchantSkillVisibleToWorkspace(input: {
  catalog: SkillCatalog;
  binding: SkillBinding;
  workspaceId: string;
}): boolean {
  const tier = input.catalog.tier;
  if (tier === 'platform' || tier === 'industry') {
    return true;
  }
  if (tier === 'store') {
    const owner = input.binding.ownerWorkspaceId?.trim() ?? '';
    return owner.length > 0 && owner === input.workspaceId;
  }
  return false;
}

/**
 * Project a catalog entry to the merchant allowlist DTO.
 * `backend_only` must be filtered before calling this.
 */
export function projectMerchantSkillCapabilityItem(
  source: MerchantSkillProjectionSource,
): MerchantSkillCapabilityItem {
  const { catalog, skillRevisionRef } = source;
  if (!isMerchantPresentationPolicy(catalog.presentationPolicy)) {
    throw new Error(
      `backend_only Skill ${catalog.skillId} must not enter merchant projection.`,
    );
  }
  const presentationPolicy = catalog.presentationPolicy;
  const item: MerchantSkillCapabilityItem = {
    skillId: catalog.skillId,
    skillRevisionRef,
    title: catalog.name,
    summary: catalog.description,
    presentationPolicy,
    selectionEligible: presentationPolicy === 'user_selectable',
    tier: catalog.tier as MerchantSkillTier,
  };
  return pickMerchantAllowlist(item);
}

/**
 * Deterministic curated order from the published catalog: skillId ascending.
 * No personalization or recommendation (merchant-skill-persistence-spec).
 */
export function sortMerchantSkillCapabilityItems(
  items: readonly MerchantSkillCapabilityItem[],
): MerchantSkillCapabilityItem[] {
  return [...items].sort((left, right) => {
    if (left.skillId < right.skillId) return -1;
    if (left.skillId > right.skillId) return 1;
    if (left.skillRevisionRef < right.skillRevisionRef) return -1;
    if (left.skillRevisionRef > right.skillRevisionRef) return 1;
    return 0;
  });
}

export function buildMerchantSkillProjection(input: {
  workspaceId: string;
  lensId: CreationLensId;
  items: readonly MerchantSkillCapabilityItem[];
}): MerchantSkillProjection {
  return {
    workspaceId: input.workspaceId,
    lensId: input.lensId,
    items: sortMerchantSkillCapabilityItems(input.items),
  };
}

function pickMerchantAllowlist(
  item: MerchantSkillCapabilityItem,
): MerchantSkillCapabilityItem {
  const raw = item as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of MERCHANT_ITEM_ALLOWLIST) {
    if (raw[key] !== undefined) {
      out[key] = structuredClone(raw[key]);
    }
  }
  return out as unknown as MerchantSkillCapabilityItem;
}

/**
 * Deep-scan a projected value for forbidden skill/governance keys.
 * Returns the first forbidden key path found, or null if clean.
 */
export function findForbiddenMerchantSkillKey(
  value: unknown,
  path = '$',
): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenMerchantSkillKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_MERCHANT_SKILL_KEYS as readonly string[]).includes(key)) {
      return `${path}.${key}`;
    }
    const hit = findForbiddenMerchantSkillKey(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

export function serializeMerchantSkillProjection(value: unknown): string {
  return JSON.stringify(value);
}

/** Skill tiers that appear on the merchant surface when visibility passes. */
export function isMerchantSkillTier(tier: SkillTier): tier is MerchantSkillTier {
  return tier === 'platform' || tier === 'industry' || tier === 'store';
}

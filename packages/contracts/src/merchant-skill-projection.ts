/**
 * Merchant-facing Skill capability-pack projection (Spec E / #378).
 *
 * Allowlisted DTO only — never carries SKILL.md, scripts, provider skill IDs,
 * hidden prompts, tools, or governance fields. Serialization lives in Core;
 * this module is the shared shape for Core + future Web consumers (#380).
 */

import { z } from 'zod';

import { creationLensIds } from './creation-experience.js';

/** Merchant-visible presentation policies (backend_only never appears here). */
export const merchantSkillPresentationPolicies = [
  'explainable',
  'user_selectable',
] as const;

export type MerchantSkillPresentationPolicy =
  (typeof merchantSkillPresentationPolicies)[number];

export const merchantSkillTiers = ['platform', 'industry', 'store'] as const;
export type MerchantSkillTier = (typeof merchantSkillTiers)[number];

/**
 * One capability pack (or readonly “本次优化” chip) on the merchant surface.
 * `selectionEligible` is true only for `user_selectable` — explainable items
 * never produce `userSelectedSkillRefs` entries.
 */
export const merchantSkillCapabilityItemSchema = z
  .object({
    skillId: z.string().min(1),
    skillRevisionRef: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    presentationPolicy: z.enum(merchantSkillPresentationPolicies),
    selectionEligible: z.boolean(),
    tier: z.enum(merchantSkillTiers),
  })
  .strict();

export type MerchantSkillCapabilityItem = z.infer<
  typeof merchantSkillCapabilityItemSchema
>;

export const merchantSkillProjectionSchema = z
  .object({
    workspaceId: z.string().min(1),
    lensId: z.enum(creationLensIds),
    items: z.array(merchantSkillCapabilityItemSchema),
  })
  .strict();

export type MerchantSkillProjection = z.infer<
  typeof merchantSkillProjectionSchema
>;

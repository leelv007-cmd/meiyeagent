import { z } from 'zod';

import {
  p1_entitlement_validation_add_on,
  p1_entitlement_validation_amount,
  p1_entitlement_validation_connection,
  p1_entitlement_validation_model,
  p1_entitlement_validation_monthly_cap_max,
  p1_entitlement_validation_monthly_cap_min,
  p1_entitlement_validation_profile,
  p1_entitlement_validation_prompt,
  p1_entitlement_validation_prompt_too_long,
} from '@/locale/paraglide/messages';

export const entitlementPlanFormSchema = z.object({
  tier: z.enum(['starter', 'growth', 'pro']),
});

export const entitlementAddOnFormSchema = z.object({
  offerId: z.string().trim().min(1, p1_entitlement_validation_add_on()),
});

export const autoTopUpFormSchema = z.object({
  enabled: z.boolean(),
  monthlyCapYuan: z
    .number({ error: p1_entitlement_validation_amount() })
    .finite(p1_entitlement_validation_amount())
    .min(0, p1_entitlement_validation_monthly_cap_min())
    .max(9_007_199_254, p1_entitlement_validation_monthly_cap_max()),
});

export const strictByokExecutionFormSchema = z.object({
  connectionId: z
    .string()
    .trim()
    .min(1, p1_entitlement_validation_connection()),
  modelId: z.string().trim().min(1, p1_entitlement_validation_model()),
  profileId: z.string().trim().min(1, p1_entitlement_validation_profile()),
  prompt: z
    .string()
    .trim()
    .min(1, p1_entitlement_validation_prompt())
    .max(65_536, p1_entitlement_validation_prompt_too_long()),
});

export type EntitlementPlanFormInput = z.infer<
  typeof entitlementPlanFormSchema
>;
export type EntitlementAddOnFormInput = z.infer<
  typeof entitlementAddOnFormSchema
>;
export type AutoTopUpFormInput = z.infer<typeof autoTopUpFormSchema>;
export type StrictByokExecutionFormInput = z.infer<
  typeof strictByokExecutionFormSchema
>;

export function monthlyCapMicros(monthlyCapYuan: number) {
  return Math.round(monthlyCapYuan * 1_000_000);
}

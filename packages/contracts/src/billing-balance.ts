import { z } from 'zod';

export const publicBillingBucketBalanceSchema = z
  .object({
    allowance: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    committed: z.number().int().nonnegative(),
    released: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  })
  .strict();

/** Legacy resource-bucket projection retained for cutover read paths only. */
export const publicBillingBalanceSchema = z
  .object({
    copy: publicBillingBucketBalanceSchema,
    image: publicBillingBucketBalanceSchema,
    video: publicBillingBucketBalanceSchema,
  })
  .strict();

/** Stable merchant-facing balance contract for the credit ledger. */
export const publicCreditBalanceSchema = z
  .object({
    grantedCredits: z.number().int().nonnegative(),
    usedCredits: z.number().int().nonnegative(),
    refundedCredits: z.number().int().nonnegative(),
    expiredCredits: z.number().int().nonnegative(),
    availableCredits: z.number().int().nonnegative(),
    soonestExpiringLot: z
      .object({
        remainingCredits: z.number().int().positive(),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type PublicCreditBalance = z.infer<
  typeof publicCreditBalanceSchema
>;

export const publicPlanTierIds = ['trial', 'starter', 'growth', 'pro'] as const;

export const entitlementsProjectionSchema = z
  .object({
    credits: publicCreditBalanceSchema,
    plan: z
      .object({
        tier: z.enum(publicPlanTierIds),
      })
      .strict(),
  })
  .strict();

export type EntitlementsProjection = z.infer<
  typeof entitlementsProjectionSchema
>;
export const publicPlanBillingCycles = [
  'single_month',
  'monthly',
  'yearly',
] as const;

export const publicPlanCyclePriceSchema = z
  .object({
    amountMicros: z.number().int().nonnegative(),
    cycle: z.enum(publicPlanBillingCycles),
  })
  .strict();

export const publicPlanAddOnOfferSchema = z
  .object({
    amountMicros: z.number().int().nonnegative(),
    credits: z.number().int().positive(),
    currency: z.literal('HKD'),
    expireDays: z.number().int().positive(),
    id: z.string().min(1),
  })
  .strict();

export const publicPlanReferenceOutputsSchema = z
  .object({
    copy: z.number().int().nonnegative(),
    image: z.number().int().nonnegative(),
    video: z.number().int().nonnegative(),
  })
  .strict();

/**
 * What a public pricing page is allowed to know about a plan (D-143).
 *
 * Plan credit and merchant price facts are safe to publish. Upstream provider
 * cost, model tokens and supply pricing are deliberately excluded (D-061).
 */
export const publicPlanOfferSchema = z
  .object({
    id: z.enum(publicPlanTierIds),
    credits: z.number().int().positive(),
    concurrencyLimit: z.number().int().positive(),
    currency: z.literal('HKD'),
    cyclePrices: z.array(publicPlanCyclePriceSchema).length(3),
    monthlyPriceMicros: z.number().int().nonnegative(),
    referenceOutputs: publicPlanReferenceOutputsSchema,
  })
  .strict();

export const publicPlanCatalogSchema = z
  .object({
    addOns: z.array(publicPlanAddOnOfferSchema),
    plans: z.array(publicPlanOfferSchema),
  })
  .strict();

export type PublicPlanOffer = z.infer<typeof publicPlanOfferSchema>;
export type PublicPlanCatalog = z.infer<typeof publicPlanCatalogSchema>;

export const commercePaymentMappingSchema = z
  .object({
    mappings: z.array(
      z
        .object({
          interval: z.enum(publicPlanBillingCycles),
          paymentProductId: z.string().trim().min(1),
          tier: z.enum(['starter', 'growth', 'pro']),
        })
        .strict(),
    ),
    revision: z.number().int().positive(),
  })
  .strict();

/**
 * Service-token-only checkout authority from Core.
 *
 * The revision vector binds every merchant price input to the exact applied
 * admin-config heads used to build `catalog`. Product IDs are provider routing
 * facts, not secrets. Provider status and credentials remain Web-owned facts.
 */
export const commercePlanCatalogSnapshotSchema = z
  .object({
    catalog: publicPlanCatalogSchema,
    paymentMapping: commercePaymentMappingSchema.nullable(),
    planRevision: z.string().min(1),
  })
  .strict();

export type CommercePlanCatalogSnapshot = z.infer<
  typeof commercePlanCatalogSnapshotSchema
>;

const frozenPlanCommerceAuthorityShape = {
  amountMicros: z.number().int().positive(),
  billingPeriod: z.enum(['monthly', 'yearly']),
  credits: z.number().int().positive(),
  currency: z.literal('HKD'),
  paymentMappingRevision: z.number().int().positive(),
  period: z.enum(publicPlanBillingCycles),
  planRevision: z.string().trim().min(1),
  tier: z.enum(['starter', 'growth', 'pro']),
} as const;

function matchingFrozenBillingPeriod(
  authority: { billingPeriod: 'monthly' | 'yearly'; period: string },
  context: z.core.$RefinementCtx,
) {
  const expected = authority.period === 'yearly' ? 'yearly' : 'monthly';
  if (authority.billingPeriod !== expected) {
    context.addIssue({
      code: 'custom',
      message: 'billingPeriod must match period.',
      path: ['billingPeriod'],
    });
  }
}

/** Durable checkout facts that cannot be recomputed after provider mutation. */
export const frozenPlanCommerceAuthoritySchema = z
  .object(frozenPlanCommerceAuthorityShape)
  .strict()
  .superRefine(matchingFrozenBillingPeriod);

/** Trusted Web → Core settlement authority for one verified Waffo payment. */
export const frozenPlanSettlementAuthoritySchema = z
  .object({
    ...frozenPlanCommerceAuthorityShape,
    paymentProductId: z.string().trim().min(1),
    paymentProvider: z.literal('waffo'),
  })
  .strict()
  .superRefine(matchingFrozenBillingPeriod);

export type FrozenPlanCommerceAuthority = z.infer<
  typeof frozenPlanCommerceAuthoritySchema
>;
export type FrozenPlanSettlementAuthority = z.infer<
  typeof frozenPlanSettlementAuthoritySchema
>;

/**
 * Cutover-only resource seed for the retired entitlement read path. Credit
 * billing must not import or write this structure.
 */
export const PUBLIC_PLAN_ALLOWANCE_SEED = [
  {
    id: 'starter',
    allowance: { copy: 100, image: 40, video: 3 },
    concurrencyLimit: 1,
  },
  {
    id: 'growth',
    allowance: { copy: 300, image: 100, video: 6 },
    concurrencyLimit: 4,
  },
  {
    id: 'pro',
    allowance: { copy: 600, image: 180, video: 9 },
    concurrencyLimit: 8,
  },
] as const;

/**
 * Public seed for the three sold credit tiers, in one place.
 *
 * Running numbers live in `plan.credits.*` admin-config keys. This only makes
 * an unconfigured deployment and the public pricing fallback usable.
 */
export const PUBLIC_PLAN_CREDIT_SEED: readonly PublicPlanOffer[] = [
  {
    id: 'starter',
    credits: 500,
    concurrencyLimit: 1,
    currency: 'HKD',
    cyclePrices: [
      { amountMicros: 231_000_000, cycle: 'single_month' },
      { amountMicros: 208_000_000, cycle: 'monthly' },
      { amountMicros: 2_081_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: 231_183_288,
    referenceOutputs: { copy: 500, image: 100, video: 10 },
  },
  {
    id: 'growth',
    credits: 1_300,
    concurrencyLimit: 4,
    currency: 'HKD',
    cyclePrices: [
      { amountMicros: 580_000_000, cycle: 'single_month' },
      { amountMicros: 522_000_000, cycle: 'monthly' },
      { amountMicros: 5_217_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: 579_700_809,
    referenceOutputs: { copy: 1_300, image: 260, video: 26 },
  },
  {
    id: 'pro',
    credits: 2_800,
    concurrencyLimit: 8,
    currency: 'HKD',
    cyclePrices: [
      { amountMicros: 1_044_000_000, cycle: 'single_month' },
      { amountMicros: 940_000_000, cycle: 'monthly' },
      { amountMicros: 9_400_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: 1_044_390_836,
    referenceOutputs: { copy: 2_800, image: 560, video: 56 },
  },
];

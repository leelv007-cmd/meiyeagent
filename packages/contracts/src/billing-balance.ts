import { z } from 'zod';

export const publicBillingBucketIds = ['copy', 'image', 'video'] as const;

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

export type PublicBillingBalance = z.infer<typeof publicBillingBalanceSchema>;

/** Stable merchant-facing balance contract for the credit ledger. */
export const publicCreditBalanceSchema = z
  .object({
    grantedCredits: z.number().int().nonnegative(),
    usedCredits: z.number().int().nonnegative(),
    refundedCredits: z.number().int().nonnegative(),
    expiredCredits: z.number().int().nonnegative(),
    availableCredits: z.number().int().nonnegative(),
  })
  .strict();

export type PublicCreditBalance = z.infer<
  typeof publicCreditBalanceSchema
>;

export const publicPlanTierIds = ['starter', 'growth', 'pro'] as const;
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
    currency: z.literal('CNY'),
    expireDays: z.number().int().positive(),
    id: z.string().min(1),
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
    currency: z.literal('CNY'),
    cyclePrices: z.array(publicPlanCyclePriceSchema).length(3),
    monthlyPriceMicros: z.number().int().positive(),
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
    currency: 'CNY',
    cyclePrices: [
      { amountMicros: 199_000_000, cycle: 'single_month' },
      { amountMicros: 179_100_000, cycle: 'monthly' },
      { amountMicros: 1_791_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: 199_000_000,
  },
  {
    id: 'growth',
    credits: 1_300,
    concurrencyLimit: 4,
    currency: 'CNY',
    cyclePrices: [
      { amountMicros: 499_000_000, cycle: 'single_month' },
      { amountMicros: 449_100_000, cycle: 'monthly' },
      { amountMicros: 4_491_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: 499_000_000,
  },
  {
    id: 'pro',
    credits: 2_800,
    concurrencyLimit: 8,
    currency: 'CNY',
    cyclePrices: [
      { amountMicros: 899_000_000, cycle: 'single_month' },
      { amountMicros: 809_100_000, cycle: 'monthly' },
      { amountMicros: 8_091_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: 899_000_000,
  },
];

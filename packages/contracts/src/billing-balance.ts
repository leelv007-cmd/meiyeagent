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

/**
 * Stable merchant-facing balance contract.
 *
 * Audio and provider-cost dimensions are intentionally absent: the launch
 * product exposes exactly the copy, image, and video entitlement buckets.
 */
export const publicBillingBalanceSchema = z
  .object({
    copy: publicBillingBucketBalanceSchema,
    image: publicBillingBucketBalanceSchema,
    video: publicBillingBucketBalanceSchema,
  })
  .strict();

export type PublicBillingBalance = z.infer<
  typeof publicBillingBalanceSchema
>;

export const publicPlanTierIds = ['starter', 'growth', 'pro'] as const;

/**
 * What a public pricing page is allowed to know about a plan (D-143).
 *
 * Only the three merchant-countable buckets plus how many creations run at
 * once. Deliberately no unit price, no provider, no queue priority — D-109
 * keeps supply detail invisible, and the money side of a plan comes from the
 * payment configuration, not from the entitlement catalogue.
 */
export const publicPlanOfferSchema = z
  .object({
    id: z.enum(publicPlanTierIds),
    allowance: z
      .object({
        copy: z.number().int().nonnegative(),
        image: z.number().int().nonnegative(),
        video: z.number().int().nonnegative(),
      })
      .strict(),
    concurrencyLimit: z.number().int().positive(),
  })
  .strict();

export const publicPlanCatalogSchema = z
  .object({ plans: z.array(publicPlanOfferSchema) })
  .strict();

export type PublicPlanOffer = z.infer<typeof publicPlanOfferSchema>;
export type PublicPlanCatalog = z.infer<typeof publicPlanCatalogSchema>;

/**
 * The D-123 seed for the three sold tiers, in one place.
 *
 * Running numbers live in the `plan.allowances.*` admin-config keys operations
 * fills in (D-123 数字＝运营参数); this is only what an unconfigured deployment
 * grants and what the pricing page states when the catalogue is unreachable.
 * It sits in the shared contract precisely so those two are not two literals —
 * three files disagreeing about the same plans is the defect D-143 closed.
 *
 * 视频 3/6/9 条/月 is the user's ruling; the 文案/图片 figures and the
 * concurrency limits are that decision's own reference table (初级/中级/高级).
 */
export const PUBLIC_PLAN_ALLOWANCE_SEED: readonly PublicPlanOffer[] = [
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
];

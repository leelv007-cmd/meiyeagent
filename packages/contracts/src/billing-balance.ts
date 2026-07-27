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

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

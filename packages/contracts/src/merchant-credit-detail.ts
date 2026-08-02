import { z } from 'zod';

export const merchantCreditBatchSourceSchema = z.enum([
  'trial',
  'subscription',
  'booster',
  'redemption',
]);

export const merchantCreditBatchStatusSchema = z.enum([
  'active',
  'depleted',
  'expired',
]);

export const merchantCreditBatchSchema = z
  .object({
    batchNumber: z.number().int().positive(),
    expiresAt: z.string().datetime().nullable(),
    remainingCredits: z.number().int().nonnegative(),
    source: merchantCreditBatchSourceSchema,
    status: merchantCreditBatchStatusSchema,
  })
  .strict();

export const merchantCreditTransactionTypeSchema = z.enum([
  'grant',
  'reserve',
  'refund',
  'expire',
]);

export const merchantCreditTransactionStatusSchema = z.enum([
  'not_applicable',
  'reserved',
  'settled',
  'partially_refunded',
  'refunded',
]);

export const merchantCreditRefundDispositionSchema = z.enum([
  'not_applicable',
  'credited',
  'expired_uncredited',
]);

/** A merchant-safe category, deliberately not an internal task identifier. */
export const merchantCreditTransactionOperationSchema = z.enum([
  'account_credit',
  'creation',
]);

export const merchantCreditTransactionSchema = z
  .object({
    batchNumber: z.number().int().positive(),
    credits: z.number().int().positive(),
    creditedAmount: z.number().int().nonnegative(),
    operation: merchantCreditTransactionOperationSchema,
    occurredAt: z.string().datetime(),
    refundDisposition: merchantCreditRefundDispositionSchema,
    status: merchantCreditTransactionStatusSchema,
    type: merchantCreditTransactionTypeSchema,
  })
  .strict();

export const merchantCreditPlanTierSchema = z.enum([
  'trial',
  'starter',
  'growth',
  'pro',
]);

export const merchantCreditSubscriptionIntervalSchema = z.enum([
  'single_month',
  'monthly',
  'yearly',
]);

export const merchantCreditBillingSchema = z
  .object({
    creditsThisPeriod: z.number().int().nonnegative(),
    interval: merchantCreditSubscriptionIntervalSchema,
    periodEndsAt: z.string().datetime(),
    tier: merchantCreditPlanTierSchema,
  })
  .strict();

export const merchantCreditDetailSchema = z
  .object({
    billing: merchantCreditBillingSchema.nullable(),
    batches: z.array(merchantCreditBatchSchema),
    transactions: z.array(merchantCreditTransactionSchema),
  })
  .strict();

export type MerchantCreditDetail = z.infer<typeof merchantCreditDetailSchema>;

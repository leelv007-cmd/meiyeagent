import { getDb } from '@/db';
import {
  adminApiMiddleware,
  recentAdminApiMiddleware,
} from '@/middlewares/admin-middleware';
import {
  PostgresPaymentRefundStore,
  resolvePaymentRefundReview,
} from '@/payment/payment-refunds';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const resolvePaymentRefundReviewSchema = z
  .object({
    eventStatus: z.enum(['failed', 'succeeded']),
    note: z.string().trim().min(1).max(2_000),
    providerEventId: z.string().trim().min(1).max(200),
  })
  .strict();

const listPaymentRefundReviewsSchema = z
  .object({ limit: z.number().int().min(1).max(100) })
  .strict();

export const listPaymentRefundReviews = createServerFn({ method: 'GET' })
  .inputValidator(listPaymentRefundReviewsSchema)
  .middleware([adminApiMiddleware])
  .handler(({ data }) =>
    new PostgresPaymentRefundStore(getDb()).listForReview(data.limit)
  );

export const resolvePaymentRefund = createServerFn({ method: 'POST' })
  .inputValidator(resolvePaymentRefundReviewSchema)
  .middleware([recentAdminApiMiddleware])
  .handler(async ({ context, data }) =>
    resolvePaymentRefundReview(
      {
        actorUserId: context.userId,
        eventStatus: data.eventStatus,
        note: data.note,
        provider: 'waffo',
        providerEventId: data.providerEventId,
      },
      new PostgresPaymentRefundStore(getDb())
    )
  );

import type { getDb as getDatabase } from '@/db';
import { sql } from 'drizzle-orm';
import type {
  PaymentRefundEventStatus,
  PaymentRefundReviewAlert,
} from './payment-refunds';

type PaymentDatabase = ReturnType<typeof getDatabase>;

export type PaymentRefundReviewAlertClaim = PaymentRefundReviewAlert & {
  claimToken: string;
};

export interface PaymentRefundReviewAlertOutbox {
  claimNext(): Promise<PaymentRefundReviewAlertClaim | null>;
  complete(claim: PaymentRefundReviewAlertClaim): Promise<void>;
  retry(claim: PaymentRefundReviewAlertClaim, errorCode: string): Promise<void>;
}

interface ClaimRow extends Record<string, unknown> {
  amount: string;
  claimToken: string;
  currency: string;
  eventStatus: PaymentRefundEventStatus;
  orderId: string;
  provider: 'waffo';
  providerEventId: string;
}

/**
 * The refund record and its alert row are inserted together. This store only
 * leases delivery after that durable boundary, so notification failures cannot
 * make a signed refund disappear from manual review.
 */
export class PostgresPaymentRefundReviewAlertOutbox
  implements PaymentRefundReviewAlertOutbox
{
  constructor(private readonly database: PaymentDatabase) {}

  async claimNext(): Promise<PaymentRefundReviewAlertClaim | null> {
    const claimToken = crypto.randomUUID();
    const rows = await this.database.execute<ClaimRow>(sql`
      WITH next_alert AS (
        SELECT provider, provider_event_id
        FROM payment_refund_review_alert_outbox
        WHERE (
          (status = 'pending' AND available_at <= now())
          OR (status = 'processing' AND lease_expires_at <= now())
        )
        ORDER BY available_at, created_at, provider, provider_event_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE payment_refund_review_alert_outbox AS outbox
        SET status = 'processing',
            claim_token = ${claimToken},
            attempt_count = outbox.attempt_count + 1,
            lease_expires_at = now() + interval '5 minutes',
            last_error_code = NULL,
            updated_at = now()
        FROM next_alert
        WHERE outbox.provider = next_alert.provider
          AND outbox.provider_event_id = next_alert.provider_event_id
        RETURNING outbox.provider, outbox.provider_event_id, outbox.claim_token
      )
      SELECT
        claimed.provider,
        claimed.provider_event_id AS "providerEventId",
        claimed.claim_token AS "claimToken",
        refund.amount,
        refund.currency,
        refund.event_status AS "eventStatus",
        refund.order_id AS "orderId"
      FROM claimed
      INNER JOIN payment_refund_events AS refund
        ON refund.provider = claimed.provider
        AND refund.provider_event_id = claimed.provider_event_id
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      amount: row.amount,
      claimToken: row.claimToken,
      currency: row.currency,
      eventStatus: row.eventStatus,
      orderId: row.orderId,
      provider: row.provider,
      providerEventId: row.providerEventId,
    };
  }

  async complete(claim: PaymentRefundReviewAlertClaim): Promise<void> {
    const rows = await this.database.execute(sql`
      UPDATE payment_refund_review_alert_outbox
      SET status = 'completed',
          completed_at = COALESCE(completed_at, now()),
          claim_token = NULL,
          lease_expires_at = NULL,
          last_error_code = NULL,
          updated_at = now()
      WHERE provider = ${claim.provider}
        AND provider_event_id = ${claim.providerEventId}
        AND status = 'processing'
        AND claim_token = ${claim.claimToken}
      RETURNING provider_event_id
    `);
    assertClaimMutation(rows);
  }

  async retry(
    claim: PaymentRefundReviewAlertClaim,
    errorCode: string
  ): Promise<void> {
    const rows = await this.database.execute(sql`
      UPDATE payment_refund_review_alert_outbox
      SET status = 'pending',
          available_at = now() + interval '30 seconds',
          claim_token = NULL,
          lease_expires_at = NULL,
          last_error_code = ${errorCode},
          updated_at = now()
      WHERE provider = ${claim.provider}
        AND provider_event_id = ${claim.providerEventId}
        AND status = 'processing'
        AND claim_token = ${claim.claimToken}
      RETURNING provider_event_id
    `);
    assertClaimMutation(rows);
  }
}

export async function drainPaymentRefundReviewAlerts(
  input: { limit: number },
  dependencies: {
    notify(
      alert: PaymentRefundReviewAlert
    ): Promise<'delivered' | 'unavailable'>;
    outbox: PaymentRefundReviewAlertOutbox;
  }
): Promise<{ completed: number; failed: number }> {
  let completed = 0;
  let failed = 0;

  for (let index = 0; index < input.limit; index += 1) {
    const claim = await dependencies.outbox.claimNext();
    if (!claim) break;
    try {
      const delivery = await dependencies.notify({
        amount: claim.amount,
        currency: claim.currency,
        eventStatus: claim.eventStatus,
        orderId: claim.orderId,
        provider: claim.provider,
        providerEventId: claim.providerEventId,
      });
      if (delivery !== 'delivered') {
        failed += 1;
        try {
          await dependencies.outbox.retry(
            claim,
            'PAYMENT_REFUND_ALERT_DELIVERY_UNAVAILABLE'
          );
        } catch {
          // An expired lease preserves the alert for the next recovery pass.
        }
        continue;
      }
      await dependencies.outbox.complete(claim);
      completed += 1;
    } catch {
      failed += 1;
      try {
        await dependencies.outbox.retry(
          claim,
          'PAYMENT_REFUND_ALERT_DELIVERY_FAILED'
        );
      } catch {
        // An expired lease preserves the alert for the next recovery pass.
      }
    }
  }

  return { completed, failed };
}

function assertClaimMutation(rows: unknown[]) {
  if (!rows[0]) {
    throw new Error('Payment refund alert claim was lost.');
  }
}

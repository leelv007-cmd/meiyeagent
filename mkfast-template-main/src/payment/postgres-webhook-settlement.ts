import type { getDb as getDatabase } from '@/db';
import { sql } from 'drizzle-orm';
import type { PaymentProviderName, VerifiedPaymentWebhookEvent } from './types';
import type {
  CanonicalPaymentWebhook,
  PaymentWebhookClaim,
  PaymentWebhookDelivery,
  PaymentWebhookInboxPort,
  PaymentWebhookReceipt,
} from './webhook-settlement';

type PaymentDatabase = ReturnType<typeof getDatabase>;

interface StatusRow extends Record<string, unknown> {
  status: string;
}

interface ClaimRow extends Record<string, unknown> {
  attemptCount: number;
  claimToken: string;
  eventId: string;
  eventType: string;
  payload: string;
  provider: PaymentProviderName;
  providerAppliedAt: string | null;
  normalizedEvent: VerifiedPaymentWebhookEvent | null;
  signature: string;
}

export class PostgresPaymentWebhookInbox implements PaymentWebhookInboxPort {
  constructor(private readonly database: PaymentDatabase) {}

  async receive(
    event: CanonicalPaymentWebhook
  ): Promise<PaymentWebhookReceipt> {
    return this.database.transaction(async (transaction) => {
      const verified = await transaction.execute<StatusRow>(sql`
        INSERT INTO payment_webhook_events
          (provider, event_id, event_type, status, verified_at, created_at)
        VALUES
          (${event.provider}, ${event.providerEventId}, ${event.eventType},
           'verified', now(), now())
        ON CONFLICT (provider, event_id) DO UPDATE
        SET event_type = EXCLUDED.event_type,
            verified_at = now(),
            status = CASE
              WHEN payment_webhook_events.status = 'processed'
                THEN 'processed'
              ELSE 'verified'
            END
        RETURNING status
      `);
      if (verified[0]?.status === 'processed') return 'processed';

      const inserted = await transaction.execute<StatusRow>(sql`
        INSERT INTO payment_webhook_settlement_outbox
          (provider, event_id, payload, signature, status,
           attempt_count, available_at, created_at, updated_at)
        VALUES
          (${event.provider}, ${event.providerEventId}, ${event.payload},
           ${event.signature}, 'pending', 0, now(), now(), now())
        ON CONFLICT (provider, event_id) DO NOTHING
        RETURNING status
      `);
      if (inserted[0]) return 'accepted';

      const current = await transaction.execute<StatusRow>(sql`
        SELECT status
        FROM payment_webhook_settlement_outbox
        WHERE provider = ${event.provider}
          AND event_id = ${event.providerEventId}
        LIMIT 1
      `);
      return current[0]?.status === 'completed' ? 'processed' : 'busy';
    });
  }

  async claimNext(
    delivery?: PaymentWebhookDelivery
  ): Promise<PaymentWebhookClaim | null> {
    const claimToken = crypto.randomUUID();
    const deliveryScope = delivery
      ? sql`
          AND provider = ${delivery.provider}
          AND event_id = ${delivery.providerEventId}
        `
      : sql``;
    const rows = await this.database.execute<ClaimRow>(sql`
      WITH next_event AS (
        SELECT provider, event_id
        FROM payment_webhook_settlement_outbox
        WHERE (
          (status IN ('pending', 'retry') AND available_at <= now())
          OR (status = 'processing' AND lease_expires_at <= now())
        )
          ${deliveryScope}
        ORDER BY available_at, created_at, provider, event_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE payment_webhook_settlement_outbox AS outbox
        SET status = 'processing',
            claim_token = ${claimToken},
            attempt_count = outbox.attempt_count + 1,
            lease_expires_at = now() + interval '5 minutes',
            last_error_code = NULL,
            updated_at = now()
        FROM next_event
        WHERE outbox.provider = next_event.provider
          AND outbox.event_id = next_event.event_id
        RETURNING outbox.provider, outbox.event_id, outbox.payload,
                  outbox.signature, outbox.attempt_count, outbox.claim_token,
                  outbox.provider_applied_at, outbox.normalized_event
      )
      SELECT
        claimed.provider,
        claimed.event_id AS "eventId",
        event.event_type AS "eventType",
        claimed.payload,
        claimed.signature,
        claimed.attempt_count AS "attemptCount",
        claimed.claim_token AS "claimToken",
        claimed.provider_applied_at AS "providerAppliedAt",
        claimed.normalized_event AS "normalizedEvent"
      FROM claimed
      INNER JOIN payment_webhook_events AS event
        ON event.provider = claimed.provider
        AND event.event_id = claimed.event_id
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      attemptCount: Number(row.attemptCount),
      claimToken: row.claimToken,
      ...(row.providerAppliedAt ? { appliedEvent: row.normalizedEvent } : {}),
      eventType: row.eventType,
      payload: row.payload,
      provider: row.provider,
      providerEventId: row.eventId,
      signature: row.signature,
    };
  }

  async checkpointApplied(
    claim: PaymentWebhookClaim,
    event: VerifiedPaymentWebhookEvent | null
  ) {
    const normalizedEvent = JSON.stringify(event);
    const rows = await this.database.execute(sql`
      UPDATE payment_webhook_settlement_outbox
      SET provider_applied_at = COALESCE(provider_applied_at, now()),
          normalized_event = ${normalizedEvent}::jsonb,
          updated_at = now()
      WHERE provider = ${claim.provider}
        AND event_id = ${claim.providerEventId}
        AND status = 'processing'
        AND claim_token = ${claim.claimToken}
      RETURNING event_id
    `);
    assertClaimMutation(rows);
  }

  async complete(claim: PaymentWebhookClaim) {
    await this.database.transaction(async (transaction) => {
      const completed = await transaction.execute(sql`
        UPDATE payment_webhook_settlement_outbox
        SET status = 'completed',
            completed_at = COALESCE(completed_at, now()),
            claim_token = NULL,
            lease_expires_at = NULL,
            last_error_code = NULL,
            updated_at = now()
        WHERE provider = ${claim.provider}
          AND event_id = ${claim.providerEventId}
          AND status = 'processing'
          AND claim_token = ${claim.claimToken}
        RETURNING event_id
      `);
      assertClaimMutation(completed);
      await transaction.execute(sql`
        UPDATE payment_webhook_events
        SET status = 'processed', processed_at = COALESCE(processed_at, now())
        WHERE provider = ${claim.provider}
          AND event_id = ${claim.providerEventId}
      `);
    });
  }

  async retry(claim: PaymentWebhookClaim, errorCode: string) {
    const retried = await this.database.execute(sql`
      UPDATE payment_webhook_settlement_outbox
      SET status = 'retry',
          available_at = now() + interval '30 seconds',
          claim_token = NULL,
          lease_expires_at = NULL,
          last_error_code = ${errorCode},
          updated_at = now()
      WHERE provider = ${claim.provider}
        AND event_id = ${claim.providerEventId}
        AND status = 'processing'
        AND claim_token = ${claim.claimToken}
      RETURNING event_id
    `);
    assertClaimMutation(retried);
  }
}

function assertClaimMutation(rows: unknown[]) {
  if (!rows[0]) {
    throw new Error('Payment webhook settlement claim was lost.');
  }
}

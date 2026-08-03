import type { getDb as getDatabase } from '@/db';
import { sql } from 'drizzle-orm';
import type { VerifiedPaymentWebhookEvent } from './types';

type PaymentDatabase = ReturnType<typeof getDatabase>;

export type PaymentRefundEventStatus = 'failed' | 'succeeded';
export type PaymentRefundDispositionStatus = 'pending_review' | 'resolved';

export type PaymentRefundRecordInput = {
  amount: string;
  currency: string;
  dispositionStatus: PaymentRefundDispositionStatus;
  eventStatus: PaymentRefundEventStatus;
  orderId: string;
  orderMerchantExternalId: string;
  ownerUserId: string;
  provider: 'waffo';
  providerDeliveryId: string;
  providerEventId: string;
  providerOccurredAt: string;
  rawPayload: string;
  scene: 'refund';
};

export type PaymentRefundReceipt = Pick<
  PaymentRefundRecordInput,
  | 'dispositionStatus'
  | 'eventStatus'
  | 'orderId'
  | 'provider'
  | 'providerEventId'
>;

export interface PaymentRefundStore {
  record(
    input: PaymentRefundRecordInput
  ): Promise<'already_recorded' | 'created'>;
}

export type PaymentRefundResolutionInput = {
  actorUserId: string;
  eventStatus: PaymentRefundEventStatus;
  note: string;
  provider: 'waffo';
  providerEventId: string;
};

export interface PaymentRefundResolutionStore {
  resolve(
    input: PaymentRefundResolutionInput
  ): Promise<'already_resolved' | 'resolved'>;
}

export type PaymentRefundReviewAlert = Pick<
  PaymentRefundRecordInput,
  | 'amount'
  | 'currency'
  | 'eventStatus'
  | 'orderId'
  | 'provider'
  | 'providerEventId'
>;

export type PaymentRefundPorts = PaymentRefundStore;

export class PaymentRefundContractError extends Error {
  readonly code = 'PAYMENT_REFUND_CONTRACT_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PaymentRefundContractError';
  }
}

export async function recordVerifiedPaymentRefund(
  event: VerifiedPaymentWebhookEvent,
  rawPayload: string,
  ports: PaymentRefundPorts
): Promise<PaymentRefundReceipt | null> {
  const input = paymentRefundRecordInputFromEvent(event, rawPayload);
  if (!input) return null;
  await ports.record(input);
  return {
    dispositionStatus: input.dispositionStatus,
    eventStatus: input.eventStatus,
    orderId: input.orderId,
    provider: input.provider,
    providerEventId: input.providerEventId,
  };
}

export async function resolvePaymentRefundReview(
  input: PaymentRefundResolutionInput,
  store: PaymentRefundResolutionStore
) {
  const normalized = {
    actorUserId: requiredValue(input.actorUserId, 'resolution actor'),
    eventStatus: input.eventStatus,
    note: requiredValue(input.note, 'resolution note'),
    provider: input.provider,
    providerEventId: requiredValue(input.providerEventId, 'provider event id'),
  } satisfies PaymentRefundResolutionInput;
  if (
    normalized.provider !== 'waffo' ||
    (normalized.eventStatus !== 'failed' &&
      normalized.eventStatus !== 'succeeded')
  ) {
    throw new PaymentRefundContractError(
      'Only a Waffo refund review can be resolved.'
    );
  }
  return store.resolve(normalized);
}

export function paymentRefundRecordInputFromEvent(
  event: VerifiedPaymentWebhookEvent,
  rawPayload: string
): PaymentRefundRecordInput | null {
  if (event.scene !== 'refund') return null;
  if (
    event.provider !== 'waffo' ||
    (event.eventType !== 'refund.succeeded' &&
      event.eventType !== 'refund.failed')
  ) {
    throw new PaymentRefundContractError(
      'Only normalized Waffo refund events can enter the refund audit.'
    );
  }

  const input = {
    amount: requiredValue(event.amount, 'amount'),
    currency: requiredValue(event.currency, 'currency'),
    dispositionStatus: 'pending_review' as const,
    eventStatus:
      event.eventType === 'refund.succeeded'
        ? ('succeeded' as const)
        : ('failed' as const),
    orderId: requiredValue(event.reference.id, 'order id'),
    orderMerchantExternalId: requiredValue(
      event.orderMerchantExternalId,
      'order binding'
    ),
    ownerUserId: requiredValue(event.buyerIdentity, 'buyer identity'),
    provider: 'waffo' as const,
    providerDeliveryId: requiredValue(
      event.providerDeliveryId,
      'provider delivery id'
    ),
    providerEventId: requiredValue(event.providerEventId, 'provider event id'),
    providerOccurredAt: requiredValue(
      event.providerOccurredAt,
      'provider occurrence time'
    ),
    rawPayload: requiredValue(rawPayload, 'raw payload'),
    scene: 'refund' as const,
  };
  if (event.reference.kind !== 'order') {
    throw new PaymentRefundContractError(
      'A Waffo refund must reference its provider order.'
    );
  }
  return input;
}

export class PostgresPaymentRefundStore implements PaymentRefundStore {
  constructor(private readonly database: PaymentDatabase) {}

  async record(
    input: PaymentRefundRecordInput
  ): Promise<'already_recorded' | 'created'> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.execute<{ providerEventId: string }>(sql`
        INSERT INTO payment_refund_events
          (provider, provider_event_id, provider_delivery_id, order_id,
           order_merchant_external_id, owner_user_id, scene, amount, currency,
           event_status, raw_payload, provider_occurred_at, received_at,
           disposition_status, created_at, updated_at)
        VALUES
          (${input.provider}, ${input.providerEventId}, ${input.providerDeliveryId},
           ${input.orderId}, ${input.orderMerchantExternalId}, ${input.ownerUserId},
           ${input.scene}, ${input.amount}, ${input.currency}, ${input.eventStatus},
           ${input.rawPayload}, ${input.providerOccurredAt}, now(),
           ${input.dispositionStatus}, now(), now())
        ON CONFLICT (provider, provider_event_id) DO NOTHING
        RETURNING provider_event_id AS "providerEventId"
      `);
      await transaction.execute(sql`
        INSERT INTO payment_refund_review_alert_outbox
          (provider, provider_event_id, status, attempt_count, available_at,
           created_at, updated_at)
        SELECT provider, provider_event_id, 'pending', 0, now(), now(), now()
        FROM payment_refund_events
        WHERE provider = ${input.provider}
          AND provider_event_id = ${input.providerEventId}
        ON CONFLICT (provider, provider_event_id) DO NOTHING
      `);
      return rows[0] ? 'created' : 'already_recorded';
    });
  }

  async resolve(
    input: PaymentRefundResolutionInput
  ): Promise<'already_resolved' | 'resolved'> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.execute(sql`
        UPDATE payment_refund_events
        SET disposition_status = 'resolved',
            disposition_actor_user_id = ${input.actorUserId},
            disposition_note = ${input.note},
            resolved_at = now(),
            updated_at = now()
        WHERE provider = ${input.provider}
          AND provider_event_id = ${input.providerEventId}
          AND event_status = ${input.eventStatus}
          AND disposition_status = 'pending_review'
        RETURNING provider_event_id
      `);
      if (rows[0]) return 'resolved';

      const existing = await transaction.execute<{
        dispositionActorUserId: string | null;
        dispositionNote: string | null;
        dispositionStatus: PaymentRefundDispositionStatus;
      }>(sql`
        SELECT
          disposition_actor_user_id AS "dispositionActorUserId",
          disposition_note AS "dispositionNote",
          disposition_status AS "dispositionStatus"
        FROM payment_refund_events
        WHERE provider = ${input.provider}
          AND provider_event_id = ${input.providerEventId}
          AND event_status = ${input.eventStatus}
      `);
      const receipt = existing[0];
      if (
        receipt?.dispositionStatus === 'resolved' &&
        receipt.dispositionActorUserId === input.actorUserId &&
        receipt.dispositionNote === input.note
      ) {
        return 'already_resolved';
      }
      if (receipt) {
        throw new PaymentRefundContractError(
          'Refund review was already resolved with different audit facts.'
        );
      }
      throw new PaymentRefundContractError('Refund review was not found.');
    });
  }
}

function requiredValue(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new PaymentRefundContractError(
      `Verified Waffo refund is missing ${field}.`
    );
  }
  return normalized;
}

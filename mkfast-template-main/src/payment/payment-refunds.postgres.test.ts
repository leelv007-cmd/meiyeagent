import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { schema } from '@/db/schema';
import {
  PostgresPaymentRefundStore,
  type PaymentRefundRecordInput,
} from '@/payment/payment-refunds';
import { PostgresPaymentRefundReviewAlertOutbox } from '@/payment/payment-refund-alerts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'a Waffo refund is idempotent by provider business event and remains audit-only',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const ownerUserId = `refund-owner-${suffix}`;
    const paymentId = `refund-payment-${suffix}`;
    const providerEventId = `waffo:refund.succeeded:waffo-refund-${suffix}`;
    const rawPayload = '{"event":"refund.succeeded","source":"waffo"}';

    try {
      await migratePaymentRefundEvents(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${ownerUserId}, 'Refund owner', ${`${ownerUserId}@example.test`},
           TRUE, now(), now())
      `;
      await client`
        INSERT INTO payment
          (id, provider, price_id, user_id, customer_id, type, scene, status,
           paid, created_at, updated_at)
        VALUES
          (${paymentId}, 'waffo', 'PROD_CREDITS_300', ${ownerUserId},
           ${`waffo-customer-${suffix}`}, 'one_time', 'credit_package',
           'completed', TRUE, now(), now())
      `;
      const beforePayment = await client<
        Array<{
          paid: boolean;
          scene: string | null;
          status: string;
        }>
      >`
        SELECT paid, scene, status
        FROM payment
        WHERE id = ${paymentId}
      `;
      const input = {
        amount: '161.00',
        currency: 'HKD',
        dispositionStatus: 'pending_review' as const,
        eventStatus: 'succeeded' as const,
        orderId: `waffo-order-${suffix}`,
        orderMerchantExternalId: `cpb-${suffix}`,
        ownerUserId,
        provider: 'waffo' as const,
        providerDeliveryId: `waffo-delivery-${suffix}`,
        providerEventId,
        providerOccurredAt: '2026-08-04T01:02:03.000Z',
        rawPayload,
        scene: 'refund' as const,
      } satisfies PaymentRefundRecordInput;
      const store = new PostgresPaymentRefundStore(db);

      assert.equal(await store.record(input), 'created');
      assert.equal(
        await store.record({
          ...input,
          providerDeliveryId: `waffo-replay-delivery-${suffix}`,
          rawPayload: '{"event":"refund.succeeded","replayed":true}',
        }),
        'already_recorded'
      );
      assert.equal(
        await store.resolve({
          actorUserId: ownerUserId,
          eventStatus: 'succeeded',
          note: 'Confirmed against the provider refund receipt.',
          provider: 'waffo',
          providerEventId,
        }),
        'resolved'
      );
      assert.equal(
        await store.resolve({
          actorUserId: ownerUserId,
          eventStatus: 'succeeded',
          note: 'Confirmed against the provider refund receipt.',
          provider: 'waffo',
          providerEventId,
        }),
        'already_resolved'
      );
      const listedReview = (await store.listForReview(100)).find(
        (review) => review.providerEventId === providerEventId
      );
      assert.ok(listedReview?.resolvedAt);
      assert.deepEqual(
        listedReview && {
          amount: listedReview.amount,
          currency: listedReview.currency,
          dispositionActorUserId: listedReview.dispositionActorUserId,
          dispositionNote: listedReview.dispositionNote,
          dispositionStatus: listedReview.dispositionStatus,
          eventStatus: listedReview.eventStatus,
          orderId: listedReview.orderId,
          provider: listedReview.provider,
          providerEventId: listedReview.providerEventId,
        },
        {
          amount: '161.00',
          currency: 'HKD',
          dispositionActorUserId: ownerUserId,
          dispositionNote: 'Confirmed against the provider refund receipt.',
          dispositionStatus: 'resolved',
          eventStatus: 'succeeded',
          orderId: input.orderId,
          provider: 'waffo',
          providerEventId,
        }
      );

      const alertOutbox = new PostgresPaymentRefundReviewAlertOutbox(db);
      const firstAlertClaim = await alertOutbox.claimNext();
      assert.ok(firstAlertClaim?.claimToken);
      if (!firstAlertClaim) throw new Error('Expected a refund alert claim.');
      const { claimToken: firstAlertClaimToken, ...firstAlert } =
        firstAlertClaim;
      assert.deepEqual(firstAlert, {
        amount: '161.00',
        currency: 'HKD',
        eventStatus: 'succeeded',
        orderId: input.orderId,
        provider: 'waffo',
        providerEventId,
      });
      await alertOutbox.retry(
        firstAlertClaim,
        'PAYMENT_REFUND_ALERT_DELIVERY_FAILED'
      );
      await client`
        UPDATE payment_refund_review_alert_outbox
        SET available_at = now() - interval '1 second'
        WHERE provider = 'waffo' AND provider_event_id = ${providerEventId}
      `;
      const recoveredAlertClaim = await alertOutbox.claimNext();
      assert.ok(recoveredAlertClaim?.claimToken);
      assert.notEqual(recoveredAlertClaim?.claimToken, firstAlertClaimToken);
      if (!recoveredAlertClaim) {
        throw new Error('Expected a recovered refund alert claim.');
      }
      await alertOutbox.complete(recoveredAlertClaim);

      const refunds = await client<
        Array<{
          disposition_status: string;
          disposition_actor_user_id: string | null;
          disposition_note: string | null;
          event_status: string;
          provider_delivery_id: string;
          provider_event_id: string;
          raw_payload: string;
        }>
      >`
        SELECT
          disposition_status,
          disposition_actor_user_id,
          disposition_note,
          event_status,
          provider_delivery_id,
          provider_event_id,
          raw_payload
        FROM payment_refund_events
        WHERE provider = 'waffo' AND provider_event_id = ${providerEventId}
      `;
      assert.deepEqual(
        [...refunds],
        [
          {
            disposition_actor_user_id: ownerUserId,
            disposition_note: 'Confirmed against the provider refund receipt.',
            disposition_status: 'resolved',
            event_status: 'succeeded',
            provider_delivery_id: input.providerDeliveryId,
            provider_event_id: providerEventId,
            raw_payload: rawPayload,
          },
        ]
      );
      assert.deepEqual(
        await client<
          Array<{
            paid: boolean;
            scene: string | null;
            status: string;
          }>
        >`
          SELECT paid, scene, status
          FROM payment
          WHERE id = ${paymentId}
        `,
        beforePayment
      );
      const alerts = await client<
        Array<{
          attempt_count: number;
          last_error_code: string | null;
          status: string;
        }>
      >`
        SELECT attempt_count, last_error_code, status
        FROM payment_refund_review_alert_outbox
        WHERE provider = 'waffo' AND provider_event_id = ${providerEventId}
      `;
      assert.deepEqual(
        [...alerts],
        [
          {
            attempt_count: 2,
            last_error_code: null,
            status: 'completed',
          },
        ]
      );
    } finally {
      await client`
        DELETE FROM payment_refund_events
        WHERE provider = 'waffo' AND provider_event_id = ${providerEventId}
      `;
      await client`DELETE FROM payment WHERE id = ${paymentId}`;
      await client`DELETE FROM "user" WHERE id = ${ownerUserId}`;
      await client.end();
    }
  }
);

test(
  'failed and succeeded refund events sharing a Waffo event id remain distinct audit facts',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const ownerUserId = `refund-transition-owner-${suffix}`;
    const rawProviderEventId = `waffo-refund-transition-${suffix}`;
    const store = new PostgresPaymentRefundStore(db);
    const base = {
      amount: '161.00',
      currency: 'HKD',
      dispositionStatus: 'pending_review' as const,
      orderId: `waffo-order-${suffix}`,
      orderMerchantExternalId: `cpb-${suffix}`,
      ownerUserId,
      provider: 'waffo' as const,
      providerOccurredAt: '2026-08-04T01:02:03.000Z',
      scene: 'refund' as const,
    };
    const failedId = `waffo:refund.failed:${rawProviderEventId}`;
    const succeededId = `waffo:refund.succeeded:${rawProviderEventId}`;

    try {
      await migratePaymentRefundEvents(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${ownerUserId}, 'Refund transition owner',
           ${`${ownerUserId}@example.test`}, TRUE, now(), now())
      `;
      assert.equal(
        await store.record({
          ...base,
          eventStatus: 'failed',
          providerDeliveryId: `delivery-failed-${suffix}`,
          providerEventId: failedId,
          rawPayload: JSON.stringify({
            eventId: rawProviderEventId,
            eventType: 'refund.failed',
          }),
        }),
        'created'
      );
      assert.equal(
        await store.record({
          ...base,
          eventStatus: 'succeeded',
          providerDeliveryId: `delivery-succeeded-${suffix}`,
          providerEventId: succeededId,
          rawPayload: JSON.stringify({
            eventId: rawProviderEventId,
            eventType: 'refund.succeeded',
          }),
        }),
        'created'
      );
      const rows = await client<
        Array<{ event_status: string; provider_event_id: string }>
      >`
        SELECT event_status, provider_event_id
        FROM payment_refund_events
        WHERE provider = 'waffo'
          AND provider_event_id IN (${failedId}, ${succeededId})
        ORDER BY event_status
      `;
      assert.deepEqual(
        [...rows],
        [
          { event_status: 'failed', provider_event_id: failedId },
          { event_status: 'succeeded', provider_event_id: succeededId },
        ]
      );
    } finally {
      await client`
        DELETE FROM payment_refund_events
        WHERE provider = 'waffo'
          AND provider_event_id IN (${failedId}, ${succeededId})
      `;
      await client`DELETE FROM "user" WHERE id = ${ownerUserId}`;
      await client.end();
    }
  }
);

test(
  'keeps a refund after owner deletion and nulls a deleted disposition actor',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const ownerUserId = `refund-delete-owner-${suffix}`;
    const actorUserId = `refund-delete-actor-${suffix}`;
    const providerEventId = `waffo:refund.failed:delete-${suffix}`;
    try {
      await migratePaymentRefundEvents(client);
      for (const userId of [ownerUserId, actorUserId]) {
        await client`
          INSERT INTO "user"
            (id, name, email, email_verified, created_at, updated_at)
          VALUES (${userId}, 'Refund test user', ${`${userId}@example.test`}, TRUE, now(), now())
        `;
      }
      const store = new PostgresPaymentRefundStore(db);
      await store.record({
        amount: '57.00',
        currency: 'HKD',
        dispositionStatus: 'pending_review',
        eventStatus: 'failed',
        orderId: `order-${suffix}`,
        orderMerchantExternalId: `cpb-${suffix}`,
        ownerUserId,
        provider: 'waffo',
        providerDeliveryId: `delivery-${suffix}`,
        providerEventId,
        providerOccurredAt: '2026-08-04T01:02:03.000Z',
        rawPayload: '{"event":"refund.failed"}',
        scene: 'refund',
      });
      await store.resolve({
        actorUserId,
        eventStatus: 'failed',
        note: 'Reviewed',
        provider: 'waffo',
        providerEventId,
      });
      await client`DELETE FROM "user" WHERE id IN (${ownerUserId}, ${actorUserId})`;
      const rows = await client<
        Array<{
          owner_user_id: string;
          disposition_actor_user_id: string | null;
        }>
      >`
        SELECT owner_user_id, disposition_actor_user_id
        FROM payment_refund_events
        WHERE provider = 'waffo' AND provider_event_id = ${providerEventId}
      `;
      assert.deepEqual(
        [...rows],
        [
          {
            owner_user_id: ownerUserId,
            disposition_actor_user_id: null,
          },
        ]
      );
    } finally {
      await client`DELETE FROM payment_refund_events WHERE provider_event_id = ${providerEventId}`;
      await client`DELETE FROM "user" WHERE id IN (${ownerUserId}, ${actorUserId})`;
      await client.end();
    }
  }
);

async function migratePaymentRefundEvents(client: postgres.Sql) {
  const [existing] = await client<Array<{ tableName: string | null }>>`
    SELECT to_regclass('public.payment_refund_events')::text AS "tableName"
  `;
  if (existing?.tableName) return;
  const migration = await readFile(
    new URL('../../drizzle/0022_payment_refund_events.sql', import.meta.url),
    'utf8'
  );
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) await client.unsafe(trimmed);
  }
}

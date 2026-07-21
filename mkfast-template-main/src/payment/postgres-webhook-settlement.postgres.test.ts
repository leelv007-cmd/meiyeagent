import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { schema } from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  PaymentRecordBusinessKeyConflictError,
  PostgresPaymentRecordEffectStore,
  persistPaymentRecordEffect,
  type PaymentRecordEffectInput,
} from './payment-record-effect';
import { PostgresPaymentWebhookInbox } from './postgres-webhook-settlement';
import { settlePendingPaymentWebhooks } from './webhook-settlement';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'verified webhook intake is atomic and an expired lease fences the stale worker',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const database = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const eventId = `evt_contract_${suffix}`;
    const userId = `user_contract_${suffix}`;
    const sessionId = `cs_contract_${suffix}`;
    const inbox = new PostgresPaymentWebhookInbox(database);
    const paymentEffects = new PostgresPaymentRecordEffectStore(database);
    const event = {
      eventType: 'checkout.session.completed',
      payload: JSON.stringify({
        id: eventId,
        type: 'checkout.session.completed',
      }),
      provider: 'stripe' as const,
      providerEventId: eventId,
      signature: 'verified-contract-signature',
    };

    try {
      const [contract] = await client<Array<{ installed: string | null }>>`
        SELECT to_regclass('payment_webhook_settlement_outbox')::text AS installed
      `;
      if (!contract?.installed) {
        const migration = await readFile(
          new URL(
            '../../drizzle/0007_payment_webhook_settlement_outbox.sql',
            import.meta.url
          ),
          'utf8'
        );
        await client.unsafe(
          migration.replaceAll('--> statement-breakpoint', '')
        );
      }
      const [rollout] = await client<
        Array<{
          deleteRule: string;
          sessionIndex: string | null;
          subscriptionIndex: string | null;
        }>
      >`
        SELECT
          constraint_row.confdeltype AS "deleteRule",
          to_regclass('payment_session_id_unique')::text AS "sessionIndex",
          to_regclass('payment_subscription_id_unique')::text AS "subscriptionIndex"
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conname = 'payment_webhook_settlement_outbox_event_fk'
      `;
      if (
        rollout?.deleteRule !== 'r' ||
        !rollout.sessionIndex ||
        !rollout.subscriptionIndex
      ) {
        const migration = await readFile(
          new URL(
            '../../drizzle/0010_payment_webhook_rollout_safety.sql',
            import.meta.url
          ),
          'utf8'
        );
        await client.unsafe(
          migration.replaceAll('--> statement-breakpoint', '')
        );
      }

      await client`
        INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${userId}, 'Webhook contract', ${`${userId}@example.test`}, FALSE, now(), now())
      `;

      assert.equal(await inbox.receive(event), 'accepted');
      assert.equal(await inbox.receive(event), 'busy');
      await assert.rejects(
        client`
          DELETE FROM payment_webhook_events
          WHERE provider = 'stripe' AND event_id = ${eventId}
        `,
        /foreign key|referenced/u
      );
      const [retained] = await client<Array<{ count: string }>>`
        SELECT count(*)::text AS count
        FROM payment_webhook_settlement_outbox
        WHERE provider = 'stripe' AND event_id = ${eventId}
      `;
      assert.equal(retained?.count, '1');
      await client`
        UPDATE payment_webhook_settlement_outbox
        SET available_at = '2000-01-01T00:00:00.000Z',
            created_at = '2000-01-01T00:00:00.000Z'
        WHERE provider = 'stripe' AND event_id = ${eventId}
      `;

      const first = await inbox.claimNext();
      assert.equal(first?.providerEventId, eventId);
      assert.ok(first?.claimToken);

      const effectInput: PaymentRecordEffectInput = {
        customerId: `customer_${suffix}`,
        invoiceId: null,
        paid: true,
        priceId: 'price_one_time_contract',
        sessionId,
        status: 'completed',
        type: 'one_time',
        userId,
      };
      assert.equal(
        await persistPaymentRecordEffect(effectInput, paymentEffects),
        'applied'
      );
      // Simulate a worker process dying after the provider effect committed,
      // before it can checkpoint the outbox claim.
      const appliedEvent = {
        eventType: 'checkout.session.completed' as const,
        provider: 'stripe' as const,
        providerEventId: eventId,
        reference: { id: 'checkout-contract', kind: 'checkout' as const },
      };
      await inbox.checkpointApplied(first, appliedEvent);
      await client`
        UPDATE payment_webhook_settlement_outbox
        SET lease_expires_at = now() - interval '1 second'
        WHERE provider = 'stripe' AND event_id = ${eventId}
      `;
      const second = await inbox.claimNext();
      assert.equal(second?.providerEventId, eventId);
      assert.ok(second?.claimToken);
      assert.notEqual(first.claimToken, second.claimToken);
      await assert.rejects(inbox.complete(first), /claim was lost/iu);
      await assert.rejects(
        inbox.retry(first, 'STALE_WORKER'),
        /claim was lost/iu
      );
      await client`
        UPDATE payment_webhook_settlement_outbox
        SET lease_expires_at = now() - interval '1 second'
        WHERE provider = 'stripe' AND event_id = ${eventId}
      `;
      let entitlementSettlements = 0;
      const resumed = await settlePendingPaymentWebhooks(
        { limit: 1 },
        {
          inbox,
          settlement: {
            async apply() {
              assert.equal(
                await persistPaymentRecordEffect(effectInput, paymentEffects),
                'already_applied'
              );
              return appliedEvent;
            },
            async settle() {
              entitlementSettlements += 1;
            },
          },
        }
      );
      assert.deepEqual(resumed, { completed: 1, failed: 0 });
      assert.equal(entitlementSettlements, 1);
      const [paymentCount] = await client<Array<{ count: string }>>`
        SELECT count(*)::text AS count
        FROM payment
        WHERE session_id = ${sessionId} AND invoice_id IS NULL
      `;
      assert.equal(paymentCount?.count, '1');

      await assert.rejects(
        persistPaymentRecordEffect(
          {
            ...effectInput,
            sessionId: `cs_other_${suffix}`,
            subscriptionId: `sub_contract_${suffix}`,
          },
          paymentEffects
        ).then(async () =>
          persistPaymentRecordEffect(
            {
              ...effectInput,
              sessionId: `cs_duplicate_subscription_${suffix}`,
              subscriptionId: `sub_contract_${suffix}`,
            },
            paymentEffects
          )
        ),
        PaymentRecordBusinessKeyConflictError
      );
      assert.equal(await inbox.receive(event), 'processed');
    } finally {
      await client`
        DELETE FROM payment_webhook_settlement_outbox
        WHERE provider = 'stripe' AND event_id = ${eventId}
      `;
      await client`
        DELETE FROM payment_webhook_events
        WHERE provider = 'stripe' AND event_id = ${eventId}
      `;
      await client`
        DELETE FROM payment
        WHERE user_id = ${userId}
      `;
      await client`
        DELETE FROM "user"
        WHERE id = ${userId}
      `;
      await client.end();
    }
  }
);

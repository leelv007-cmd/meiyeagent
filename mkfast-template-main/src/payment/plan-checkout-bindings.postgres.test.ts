import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgresPlanCheckoutBindingStore } from './plan-checkout-bindings';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'verified checkout metadata closes webhook-before-attach race and renewal resolves by subscription',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const userId = `plan-owner-${suffix}`;
    const workspaceId = `plan-workspace-${suffix}`;
    const paymentId = `plan-payment-${suffix}`;
    const checkoutId = `plan-checkout-${suffix}`;
    const subscriptionId = `plan-subscription-${suffix}`;
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-08-01T00:00:00.000Z');

    try {
      await migratePlanCheckoutBindings(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${userId}, 'Plan Owner', ${`${userId}@example.test`}, TRUE, now(), now())
      `;
      await client`
        INSERT INTO workspaces (id, name)
        VALUES (${workspaceId}, 'Plan Workspace')
      `;
      await client`
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${userId}, 'owner')
      `;

      const store = new PostgresPlanCheckoutBindingStore(db);
      const binding = await store.createOwnerBinding({
        interval: 'month',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'price_growth_month',
        provider: 'stripe',
        workspaceId,
      });
      assert.ok(binding);

      // The provider may deliver the webhook before createCheckout returns and
      // attachProviderCheckout can persist its checkout id.
      await client`
        INSERT INTO payment
          (id, price_id, user_id, customer_id, subscription_id, session_id,
           type, interval, status, paid, period_start, period_end,
           cancel_at_period_end, created_at, updated_at)
        VALUES
          (${paymentId}, 'price_growth_month', ${userId}, ${`customer-${suffix}`},
           ${subscriptionId}, ${checkoutId}, 'subscription', 'month', 'active',
           TRUE, ${periodStart.toISOString()}, ${periodEnd.toISOString()},
           FALSE, now(), now())
      `;

      const checkoutFacts = await store.resolveBinding({
        eventType: 'checkout.session.completed',
        provider: 'stripe',
        providerEventId: `checkout-event-${suffix}`,
        reference: { id: checkoutId, kind: 'checkout' },
        planBindingId: binding.id,
      });
      assert.deepEqual(normalizePeriodFacts(checkoutFacts), {
        workspaceId,
        ownerUserId: userId,
        priceId: 'price_growth_month',
        interval: 'month',
        periodStartsAt: periodStart.toISOString(),
        periodEndsAt: periodEnd.toISOString(),
        cancelAtPeriodEnd: false,
      });

      await store.markActive({
        bindingId: binding.id,
        provider: 'stripe',
        providerCheckoutId: checkoutId,
      });
      // createCheckout returning after the webhook is an idempotent attach,
      // rather than a false checkout failure.
      await store.attachProviderCheckout({
        bindingId: binding.id,
        providerCheckoutId: checkoutId,
      });

      const renewalFacts = await store.resolveBinding({
        eventType: 'invoice.paid',
        provider: 'stripe',
        providerEventId: `renewal-event-${suffix}`,
        reference: { id: subscriptionId, kind: 'subscription' },
      });
      assert.deepEqual(renewalFacts, checkoutFacts);

      await store.markActive({
        provider: 'stripe',
        subscriptionId,
      });
      const [activeBinding] = await client<
        Array<{ status: string; subscription_id: string | null }>
      >`
        SELECT status, subscription_id
        FROM plan_checkout_bindings
        WHERE id = ${binding.id}
      `;
      assert.deepEqual(activeBinding, {
        status: 'active',
        subscription_id: subscriptionId,
      });

      await store.markCanceled({ provider: 'stripe', subscriptionId });
      const [canceledBinding] = await client<Array<{ status: string }>>`
        SELECT status
        FROM plan_checkout_bindings
        WHERE id = ${binding.id}
      `;
      assert.equal(canceledBinding?.status, 'canceled');
    } finally {
      await client`DELETE FROM "user" WHERE id = ${userId}`;
      await client`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await client.end();
    }
  }
);

async function migratePlanCheckoutBindings(client: postgres.Sql) {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS plan_checkout_bindings (
      id text PRIMARY KEY,
      provider text NOT NULL,
      price_id text NOT NULL,
      payment_type text NOT NULL,
      interval text,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      provider_checkout_id text,
      subscription_id text,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS plan_checkout_bindings_provider_checkout_uidx
      ON plan_checkout_bindings (provider, provider_checkout_id);
    CREATE INDEX IF NOT EXISTS plan_checkout_bindings_subscription_id_idx
      ON plan_checkout_bindings (subscription_id)
  `);
}

function normalizePeriodFacts<
  T extends {
    periodEndsAt?: string | Date | null;
    periodStartsAt?: string | Date | null;
  },
>(facts: T | null) {
  if (!facts) return facts;
  return {
    ...facts,
    periodStartsAt: facts.periodStartsAt
      ? new Date(facts.periodStartsAt).toISOString()
      : null,
    periodEndsAt: facts.periodEndsAt
      ? new Date(facts.periodEndsAt).toISOString()
      : null,
  };
}

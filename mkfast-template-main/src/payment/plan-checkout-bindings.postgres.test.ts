import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from '@/db/schema';
import { PostgresPlanCheckoutBindingStore } from '@/payment/plan-checkout-bindings';
import { planSettlementIntentFromEvent } from '@/payment/plan-commerce';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
const TEST_COMMERCE_AUTHORITY = {
  amountMicros: 522_000_000,
  billingPeriod: 'monthly' as const,
  currency: 'HKD' as const,
  paymentMappingRevision: 1,
  period: 'monthly' as const,
  planRevision: 'plan.credits.growth@1',
  tier: 'growth' as const,
};

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
    const waffoSubscriptionId = `waffo-order-${suffix}`;
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
          (id, provider, price_id, user_id, customer_id, subscription_id, session_id,
           type, interval, status, paid, period_start, period_end,
           cancel_at_period_end, created_at, updated_at)
        VALUES
          (${paymentId}, 'stripe', 'price_growth_month', ${userId}, ${`customer-${suffix}`},
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
        subscriptionId,
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

      const foreignWaffoSubscriptionId = `waffo-foreign-${suffix}`;
      const foreignWaffoBinding = await store.createOwnerBinding({
        interval: 'month',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'PROD_GROWTH_MONTH',
        provider: 'waffo',
        workspaceId,
      });
      assert.ok(foreignWaffoBinding);
      await client`
        INSERT INTO payment
          (id, provider, price_id, user_id, customer_id, subscription_id,
           type, interval, status, paid, period_start, period_end,
           cancel_at_period_end, created_at, updated_at)
        VALUES
          (${`foreign-payment-${suffix}`}, 'stripe', 'PROD_GROWTH_MONTH',
           ${userId}, ${`foreign-customer-${suffix}`},
           ${foreignWaffoSubscriptionId}, 'subscription', 'month', 'active',
           TRUE, ${periodStart.toISOString()}, ${periodEnd.toISOString()},
           FALSE, now(), now())
      `;
      await assert.rejects(
        store.markActive({
          provider: 'waffo',
          subscriptionId: foreignWaffoSubscriptionId,
        }),
        /not activated/i
      );

      const foreignStripeSubscriptionId = `stripe-foreign-${suffix}`;
      const foreignStripeBinding = await store.createOwnerBinding({
        interval: 'month',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'price_growth_month',
        provider: 'stripe',
        workspaceId,
      });
      assert.ok(foreignStripeBinding);
      await store.attachProviderCheckout({
        bindingId: foreignStripeBinding.id,
        providerCheckoutId: `foreign-checkout-${suffix}`,
      });
      await client`
        INSERT INTO payment
          (id, provider, price_id, user_id, customer_id, subscription_id,
           session_id, type, interval, status, paid, period_start, period_end,
           cancel_at_period_end, created_at, updated_at)
        VALUES
          (${`foreign-cancel-payment-${suffix}`}, 'waffo', 'price_growth_month',
           ${userId}, ${`foreign-cancel-customer-${suffix}`},
           ${foreignStripeSubscriptionId}, ${`foreign-checkout-${suffix}`},
           'subscription', 'month', 'active', TRUE,
           ${periodStart.toISOString()}, ${periodEnd.toISOString()},
           FALSE, now(), now())
      `;
      await assert.rejects(
        store.markCanceled({
          provider: 'stripe',
          subscriptionId: foreignStripeSubscriptionId,
        }),
        /not canceled/i
      );

      // The in-flight unique index allows only one live Waffo attempt per
      // owner and workspace; retire the probe binding before the next one.
      await client`
        UPDATE plan_checkout_bindings
        SET status = 'failed', updated_at = now()
        WHERE id = ${foreignWaffoBinding.id}
      `;
      const waffoBinding = await store.createOwnerBinding({
        interval: 'month',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'PROD_GROWTH_MONTH',
        provider: 'waffo',
        workspaceId,
      });
      assert.ok(waffoBinding);

      // Waffo can deliver subscription.activated before createCheckout has
      // attached its provider checkout id. The explicit binding metadata must
      // still recover the pending row and preserve the first billing period.
      const pendingWaffoActivation = {
        buyerIdentity: userId,
        eventType: 'checkout.completed' as const,
        periodEndsAt: '2026-09-03T00:00:00.000Z',
        periodStartsAt: '2026-08-03T00:00:00.000Z',
        planBindingId: waffoBinding.id,
        provider: 'waffo' as const,
        providerDeliveryId: 'waffo-delivery-pending',
        providerEventId: 'waffo-payment-pending',
        reference: {
          id: 'waffo-order-pending',
          kind: 'subscription' as const,
        },
      };
      const pendingWaffoFacts = await store.resolveBinding(
        pendingWaffoActivation
      );
      assert.deepEqual(normalizePeriodFacts(pendingWaffoFacts), {
        workspaceId,
        ownerUserId: userId,
        priceId: 'PROD_GROWTH_MONTH',
        interval: 'month',
        periodStartsAt: '2026-08-03T00:00:00.000Z',
        periodEndsAt: '2026-09-03T00:00:00.000Z',
        subscriptionId: null,
      });
      assert.equal(
        planSettlementIntentFromEvent(
          pendingWaffoActivation,
          pendingWaffoFacts!
        )?.subscriptionId,
        'waffo-order-pending'
      );

      await store.attachProviderCheckout({
        bindingId: waffoBinding.id,
        providerCheckoutId: 'waffo-session-001',
      });

      const waffoPeriodStart = '2026-08-03T00:00:00.000Z';
      const waffoPeriodEnd = '2026-09-03T00:00:00.000Z';
      const waffoActivation = {
        buyerIdentity: userId,
        eventType: 'checkout.completed' as const,
        periodEndsAt: waffoPeriodEnd,
        periodStartsAt: waffoPeriodStart,
        planBindingId: waffoBinding.id,
        provider: 'waffo' as const,
        providerDeliveryId: 'waffo-delivery-001',
        providerEventId: 'waffo-payment-001',
        reference: { id: waffoSubscriptionId, kind: 'subscription' as const },
      };
      const waffoFacts = await store.resolveBinding(waffoActivation);
      assert.deepEqual(normalizePeriodFacts(waffoFacts), {
        workspaceId,
        ownerUserId: userId,
        priceId: 'PROD_GROWTH_MONTH',
        interval: 'month',
        periodStartsAt: waffoPeriodStart,
        periodEndsAt: waffoPeriodEnd,
        subscriptionId: null,
      });

      assert.equal(
        await store.upsertWaffoSubscriptionPayment({
          event: waffoActivation,
          intent: {
            interval: 'month',
            lifecycle: 'activate',
            ownerUserId: userId,
            paymentEventId: 'waffo:waffo-payment-001',
            periodEndsAt: waffoPeriodEnd,
            periodStartsAt: waffoPeriodStart,
            priceId: 'PROD_GROWTH_MONTH',
            provider: 'waffo',
            providerEventId: 'waffo-payment-001',
            subscriptionId: waffoSubscriptionId,
            workspaceId,
          },
        }),
        'applied'
      );
      const [waffoPayment] = await client<
        Array<{
          provider: string | null;
          subscription_id: string;
          customer_id: string;
        }>
      >`
        SELECT provider, subscription_id, customer_id
        FROM payment
        WHERE subscription_id = ${waffoSubscriptionId}
      `;
      assert.deepEqual(waffoPayment, {
        provider: 'waffo',
        subscription_id: waffoSubscriptionId,
        customer_id: userId,
      });

      assert.equal(
        await store.resolveBinding({
          ...waffoActivation,
          buyerIdentity: 'other-user',
        }),
        null
      );

      await store.markActive({
        bindingId: waffoBinding.id,
        provider: 'waffo',
        subscriptionId: waffoSubscriptionId,
      });
      const [activeWaffoBinding] = await client<
        Array<{ status: string; subscription_id: string | null }>
      >`
        SELECT status, subscription_id
        FROM plan_checkout_bindings
        WHERE id = ${waffoBinding.id}
      `;
      assert.deepEqual(activeWaffoBinding, {
        status: 'active',
        subscription_id: waffoSubscriptionId,
      });

      const pastDueEvent = {
        ...waffoActivation,
        eventType: 'subscription.past_due' as const,
        providerEventId: 'waffo-payment-past-due',
        providerOccurredAt: '2026-08-04T01:02:03.000Z',
      };
      const cancelingEvent = {
        ...waffoActivation,
        eventType: 'customer.subscription.updated' as const,
        providerEventId: 'waffo-payment-canceling',
        providerOccurredAt: '2026-08-04T00:00:00.000Z',
      };
      assert.equal(
        await store.upsertWaffoSubscriptionPayment({
          event: cancelingEvent,
          intent: {
            interval: 'month',
            lifecycle: 'cancel_at_period_end',
            ownerUserId: userId,
            paymentEventId: 'waffo:waffo-payment-canceling',
            periodEndsAt: waffoPeriodEnd,
            periodStartsAt: waffoPeriodStart,
            priceId: 'PROD_GROWTH_MONTH',
            provider: 'waffo',
            providerEventId: cancelingEvent.providerEventId,
            providerOccurredAt: cancelingEvent.providerOccurredAt,
            subscriptionId: waffoSubscriptionId,
            workspaceId,
          },
        }),
        'applied'
      );
      assert.equal(
        await store.upsertWaffoSubscriptionPayment({
          event: pastDueEvent,
          intent: {
            interval: 'month',
            lifecycle: 'past_due',
            ownerUserId: userId,
            paymentEventId: 'waffo:waffo-payment-past-due',
            periodEndsAt: waffoPeriodEnd,
            periodStartsAt: waffoPeriodStart,
            priceId: 'PROD_GROWTH_MONTH',
            provider: 'waffo',
            providerEventId: pastDueEvent.providerEventId,
            providerOccurredAt: pastDueEvent.providerOccurredAt,
            subscriptionId: waffoSubscriptionId,
            workspaceId,
          },
        }),
        'applied'
      );
      const [pastDuePayment] = await client<
        Array<{
          status: string;
          paid: boolean;
          cancel_at_period_end: boolean | null;
        }>
      >`
        SELECT status, paid, cancel_at_period_end
        FROM payment
        WHERE subscription_id = ${waffoSubscriptionId}
      `;
      assert.deepEqual(pastDuePayment, {
        status: 'past_due',
        paid: true,
        cancel_at_period_end: true,
      });

      const staleRenewal = {
        ...waffoActivation,
        eventType: 'subscription.renewed' as const,
        providerEventId: 'waffo-payment-stale-renewal',
        providerOccurredAt: '2026-08-03T23:59:59.000Z',
      };
      assert.equal(
        await store.upsertWaffoSubscriptionPayment({
          event: staleRenewal,
          intent: {
            interval: 'month',
            lifecycle: 'renew',
            ownerUserId: userId,
            paymentEventId: 'waffo:waffo-payment-stale-renewal',
            periodEndsAt: '2026-10-03T00:00:00.000Z',
            periodStartsAt: waffoPeriodEnd,
            priceId: 'PROD_GROWTH_MONTH',
            provider: 'waffo',
            providerEventId: staleRenewal.providerEventId,
            providerOccurredAt: staleRenewal.providerOccurredAt,
            subscriptionId: waffoSubscriptionId,
            workspaceId,
          },
        }),
        'ignored_stale'
      );
      const [stillPastDue] = await client<Array<{ status: string }>>`
        SELECT status
        FROM payment
        WHERE subscription_id = ${waffoSubscriptionId}
      `;
      assert.equal(stillPastDue?.status, 'past_due');

      assert.equal(
        await store.upsertWaffoSubscriptionPayment({
          event: pastDueEvent,
          intent: {
            interval: 'month',
            lifecycle: 'past_due',
            ownerUserId: userId,
            paymentEventId: 'waffo:waffo-payment-past-due-replay',
            periodEndsAt: waffoPeriodEnd,
            periodStartsAt: waffoPeriodStart,
            priceId: 'PROD_GROWTH_MONTH',
            provider: 'waffo',
            providerEventId: pastDueEvent.providerEventId,
            providerOccurredAt: pastDueEvent.providerOccurredAt,
            subscriptionId: waffoSubscriptionId,
            workspaceId,
          },
        }),
        'duplicate'
      );

      // A delayed terminal delivery from an older billing period cannot
      // overwrite the current past-due Waffo payment or its binding.
      await store.upsertWaffoSubscriptionPayment({
        event: waffoActivation,
        intent: {
          interval: 'month',
          lifecycle: 'expire',
          ownerUserId: userId,
          paymentEventId: 'waffo:waffo-expire-old',
          periodEndsAt: '2026-08-03T00:00:00.000Z',
          periodStartsAt: '2026-07-03T00:00:00.000Z',
          priceId: 'PROD_GROWTH_MONTH',
          provider: 'waffo',
          providerEventId: 'waffo-expire-old',
          subscriptionId: waffoSubscriptionId,
          workspaceId,
        },
      });
      const [stillActiveWaffoPayment] = await client<
        Array<{ status: string; period_start: Date | string | null }>
      >`
        SELECT status, period_start
        FROM payment
        WHERE subscription_id = ${waffoSubscriptionId}
      `;
      assert.equal(stillActiveWaffoPayment?.status, 'past_due');

      await assert.rejects(
        store.markActive({
          bindingId: 'missing-binding',
          provider: 'waffo',
          subscriptionId: waffoSubscriptionId,
        }),
        /not activated|not found|active/i
      );

      assert.deepEqual(
        normalizePeriodFacts(
          await store.resolveBinding({
            buyerIdentity: userId,
            eventType: 'subscription.renewed',
            periodEndsAt: '2026-10-03T00:00:00.000Z',
            periodStartsAt: waffoPeriodEnd,
            provider: 'waffo',
            providerDeliveryId: 'waffo-delivery-002',
            providerEventId: 'waffo-payment-002',
            reference: {
              id: waffoSubscriptionId,
              kind: 'subscription',
            },
          })
        ),
        {
          workspaceId,
          ownerUserId: userId,
          priceId: 'PROD_GROWTH_MONTH',
          interval: 'month',
          cancelAtPeriodEnd: true,
          periodStartsAt: waffoPeriodEnd,
          periodEndsAt: '2026-10-03T00:00:00.000Z',
          subscriptionId: waffoSubscriptionId,
        }
      );

      let providerCancelCalls = 0;
      const cancellationCheckpoint = {
        periodStartsAt: waffoPeriodStart,
        subscriptionId: waffoSubscriptionId,
        async cancel() {
          providerCancelCalls += 1;
        },
      };
      await store.cancelWaffoSubscriptionAtPeriodEnd(cancellationCheckpoint);
      await store.cancelWaffoSubscriptionAtPeriodEnd(cancellationCheckpoint);
      assert.equal(providerCancelCalls, 1);
    } finally {
      await client`DELETE FROM "user" WHERE id = ${userId}`;
      await client`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await client.end();
    }
  }
);

test(
  'Waffo cancellation checkpoints release the database before provider calls and retry after failure',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 2, prepare: false });
    const db = drizzle(client, { schema });
    const subscriptionId = `waffo-cancel-${crypto.randomUUID()}`;
    const periodStartsAt = '2026-08-03T00:00:00.000Z';
    let attempts = 0;
    const observed: Array<{ status: string; attempt_count: number }> = [];

    try {
      await migratePlanCheckoutBindings(client);
      const store = new PostgresPlanCheckoutBindingStore(db);
      await assert.rejects(
        store.cancelWaffoSubscriptionAtPeriodEnd({
          periodStartsAt,
          subscriptionId,
          async cancel() {
            attempts += 1;
            const [row] = await client<
              Array<{ status: string; attempt_count: number }>
            >`
              SELECT status, attempt_count
              FROM waffo_subscription_cancellation_receipts
              WHERE subscription_id = ${subscriptionId}
                AND period_starts_at = ${periodStartsAt}
            `;
            if (row) observed.push(row);
            throw new Error('provider unavailable');
          },
        })
      );
      assert.equal(attempts, 1);
      assert.deepEqual(observed, [{ status: 'processing', attempt_count: 1 }]);

      await client`
        UPDATE waffo_subscription_cancellation_receipts
        SET available_at = now()
        WHERE subscription_id = ${subscriptionId}
          AND period_starts_at = ${periodStartsAt}
      `;
      await store.cancelWaffoSubscriptionAtPeriodEnd({
        periodStartsAt,
        subscriptionId,
        async cancel() {
          attempts += 1;
          const [row] = await client<
            Array<{ status: string; attempt_count: number }>
          >`
            SELECT status, attempt_count
            FROM waffo_subscription_cancellation_receipts
            WHERE subscription_id = ${subscriptionId}
              AND period_starts_at = ${periodStartsAt}
          `;
          if (row) observed.push(row);
        },
      });
      assert.equal(attempts, 2);
      assert.deepEqual(observed, [
        { status: 'processing', attempt_count: 1 },
        { status: 'processing', attempt_count: 2 },
      ]);
      const [completed] = await client<Array<{ status: string }>>`
        SELECT status
        FROM waffo_subscription_cancellation_receipts
        WHERE subscription_id = ${subscriptionId}
          AND period_starts_at = ${periodStartsAt}
      `;
      assert.equal(completed?.status, 'completed');
    } finally {
      await client`
        DELETE FROM waffo_subscription_cancellation_receipts
        WHERE subscription_id = ${subscriptionId}
      `;
      await client.end();
    }
  }
);

test(
  'Waffo plan binding persists and resolves frozen commerce authority',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const userId = `commerce-owner-${suffix}`;
    const workspaceId = `commerce-workspace-${suffix}`;
    try {
      await migratePlanCheckoutBindings(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${userId}, 'Commerce Owner', ${`${userId}@example.test`}, TRUE, now(), now())
      `;
      await client`INSERT INTO workspaces (id, name) VALUES (${workspaceId}, 'Commerce Workspace')`;
      await client`
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${userId}, 'owner')
      `;
      const store = new PostgresPlanCheckoutBindingStore(db);
      const binding = await store.createOwnerBinding({
        commerceAuthority: {
          amountMicros: 522_000_000,
          billingPeriod: 'monthly',
          currency: 'HKD',
          paymentMappingRevision: 7,
          period: 'monthly',
          planRevision: 'plan.credits.growth@9',
          tier: 'growth',
        },
        interval: 'monthly',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'PROD_GROWTH_MONTHLY',
        provider: 'waffo',
        workspaceId,
      });
      assert.ok(binding);
      const facts = await store.resolveBinding({
        buyerIdentity: userId,
        eventType: 'checkout.completed',
        planBindingId: binding.id,
        provider: 'waffo',
        providerEventId: `evt-${suffix}`,
        reference: { id: `order-${suffix}`, kind: 'subscription' },
      });
      assert.deepEqual(facts?.commerceAuthority, {
        amountMicros: 522_000_000,
        billingPeriod: 'monthly',
        currency: 'HKD',
        paymentMappingRevision: 7,
        period: 'monthly',
        planRevision: 'plan.credits.growth@9',
        tier: 'growth',
      });
    } finally {
      await client`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await client`DELETE FROM "user" WHERE id = ${userId}`;
      await client.end();
    }
  }
);

async function migratePlanCheckoutBindings(client: postgres.Sql) {
  await client.unsafe(`
    ALTER TABLE payment ADD COLUMN IF NOT EXISTS provider text;
    ALTER TABLE payment ADD COLUMN IF NOT EXISTS waffo_provider_occurred_at timestamptz;
    ALTER TABLE payment ADD COLUMN IF NOT EXISTS waffo_event_id text;
    ALTER TABLE payment ADD COLUMN IF NOT EXISTS waffo_event_rank integer;
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
      replaces_subscription_id text,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE plan_checkout_bindings
      ADD COLUMN IF NOT EXISTS replaces_subscription_id text,
      ADD COLUMN IF NOT EXISTS commerce_plan_revision text,
      ADD COLUMN IF NOT EXISTS commerce_payment_mapping_revision integer,
      ADD COLUMN IF NOT EXISTS commerce_amount_micros bigint,
      ADD COLUMN IF NOT EXISTS commerce_currency text,
      ADD COLUMN IF NOT EXISTS commerce_tier text,
      ADD COLUMN IF NOT EXISTS commerce_period text,
      ADD COLUMN IF NOT EXISTS commerce_billing_period text;
    CREATE UNIQUE INDEX IF NOT EXISTS plan_checkout_bindings_provider_checkout_uidx
      ON plan_checkout_bindings (provider, provider_checkout_id);
    CREATE INDEX IF NOT EXISTS plan_checkout_bindings_subscription_id_idx
      ON plan_checkout_bindings (subscription_id);
    CREATE UNIQUE INDEX IF NOT EXISTS plan_checkout_bindings_waffo_inflight_uidx
      ON plan_checkout_bindings (owner_user_id, workspace_id)
      WHERE provider = 'waffo' AND status IN ('pending', 'checkout_created');
    CREATE TABLE IF NOT EXISTS waffo_subscription_changes (
      subscription_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      owner_user_id text NOT NULL,
      target_price_id text NOT NULL,
      target_interval text NOT NULL,
      effective_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('pending', 'applied', 'canceled'))
    );
    CREATE TABLE IF NOT EXISTS waffo_subscription_cancellation_receipts (
      subscription_id text NOT NULL,
      period_starts_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      requested_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      attempt_count integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      lease_expires_at timestamptz,
      claim_token text,
      last_error_code text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (subscription_id, period_starts_at),
      CHECK (status IN ('pending', 'processing', 'completed'))
    );
    ALTER TABLE waffo_subscription_cancellation_receipts
      ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS claim_token text,
      ADD COLUMN IF NOT EXISTS last_error_code text;
    ALTER TABLE waffo_subscription_cancellation_receipts
      DROP CONSTRAINT IF EXISTS waffo_subscription_cancellation_receipts_status_check;
    ALTER TABLE waffo_subscription_cancellation_receipts
      ADD CONSTRAINT waffo_subscription_cancellation_receipts_status_check
      CHECK (status IN ('pending', 'processing', 'completed'))
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

test(
  'Waffo checkout orchestration state closes the duplicate, stale and change-parking races',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const userId = `orch-owner-${suffix}`;
    const workspaceId = `orch-workspace-${suffix}`;
    const otherWorkspaceId = `orch-workspace-b-${suffix}`;
    const activeOrderId = `orch-order-active-${suffix}`;
    const cancellingOrderId = `orch-order-cancelling-${suffix}`;

    try {
      await migratePlanCheckoutBindings(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${userId}, 'Orch Owner', ${`${userId}@example.test`}, TRUE, now(), now())
      `;
      await client`
        INSERT INTO workspaces (id, name)
        VALUES (${workspaceId}, 'Orch Workspace'), (${otherWorkspaceId}, 'Orch Workspace B')
      `;
      await client`
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${userId}, 'owner'), (${otherWorkspaceId}, ${userId}, 'owner')
      `;

      const store = new PostgresPlanCheckoutBindingStore(db);

      // One in-flight binding per owner and workspace: the race loser gets
      // null instead of a second checkout.
      const first = await store.createOwnerBinding({
        commerceAuthority: TEST_COMMERCE_AUTHORITY,
        interval: 'monthly',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'PROD_GROWTH_MONTHLY',
        provider: 'waffo',
        workspaceId,
      });
      assert.ok(first);
      const raceLoser = await store.createOwnerBinding({
        commerceAuthority: TEST_COMMERCE_AUTHORITY,
        interval: 'monthly',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'PROD_GROWTH_MONTHLY',
        provider: 'waffo',
        workspaceId,
      });
      assert.equal(raceLoser, null);
      assert.equal(
        await store.hasPendingWaffoBinding({
          interval: 'monthly',
          ownerUserId: userId,
          priceId: 'PROD_GROWTH_MONTHLY',
          workspaceId,
        }),
        true
      );

      // An abandoned in-flight binding stops blocking after the stale
      // release sweep, and the guard no longer reports it as pending.
      await client`
        UPDATE plan_checkout_bindings
        SET updated_at = now() - interval '2 hours'
        WHERE id = ${first.id}
      `;
      assert.equal(
        await store.hasPendingWaffoBinding({
          interval: 'monthly',
          ownerUserId: userId,
          priceId: 'PROD_GROWTH_MONTHLY',
          workspaceId,
        }),
        false
      );
      await store.releaseStaleWaffoBindings({
        ownerUserId: userId,
        workspaceId,
      });
      const retry = await store.createOwnerBinding({
        commerceAuthority: TEST_COMMERCE_AUTHORITY,
        interval: 'monthly',
        ownerUserId: userId,
        paymentType: 'subscription',
        priceId: 'PROD_GROWTH_MONTHLY',
        provider: 'waffo',
        workspaceId,
      });
      assert.ok(retry);
      await client`
        UPDATE plan_checkout_bindings
        SET status = 'active', subscription_id = ${activeOrderId}
        WHERE id = ${retry.id}
      `;

      // The current-subscription snapshot ignores an order already
      // cancelling at period end, so post-upgrade classification never sees
      // the dying subscription as current.
      await client`
        INSERT INTO payment
          (id, provider, price_id, user_id, customer_id, subscription_id,
           type, interval, status, paid, period_start, period_end,
           cancel_at_period_end, created_at, updated_at)
        VALUES
          (${`waffo:${cancellingOrderId}`}, 'waffo', 'PROD_STARTER_MONTHLY', ${userId},
           ${userId}, ${cancellingOrderId}, 'subscription', 'monthly', 'active',
           TRUE, now() - interval '1 day', now() + interval '29 days',
           TRUE, now(), now() + interval '1 minute'),
          (${`waffo:${activeOrderId}`}, 'waffo', 'PROD_GROWTH_MONTHLY', ${userId},
           ${userId}, ${activeOrderId}, 'subscription', 'monthly', 'active',
           TRUE, now() - interval '1 day', now() + interval '29 days',
           FALSE, now(), now())
      `;
      await client`
        INSERT INTO plan_checkout_bindings
          (id, provider, price_id, payment_type, interval, workspace_id,
           owner_user_id, subscription_id, status, created_at, updated_at)
        VALUES
          (${`pcb-cancelling-${suffix}`}, 'waffo', 'PROD_STARTER_MONTHLY', 'subscription',
           'monthly', ${workspaceId}, ${userId}, ${cancellingOrderId}, 'active',
           now(), now())
      `;
      const current = await store.findCurrentWaffoSubscription({
        ownerUserId: userId,
        workspaceId,
      });
      assert.equal(current?.subscriptionId, activeOrderId);

      // Next-cycle changes park durably, an applied change is never rewritten
      // in place, and another workspace cannot rebind the subscription.
      assert.equal(
        await store.recordWaffoSubscriptionChange({
          effectiveAt: new Date('2026-09-03T00:00:00.000Z').toISOString(),
          ownerUserId: userId,
          subscriptionId: activeOrderId,
          targetInterval: 'yearly',
          targetPriceId: 'PROD_GROWTH_YEARLY',
          workspaceId,
        }),
        'pending'
      );
      await client`
        UPDATE waffo_subscription_changes
        SET status = 'applied'
        WHERE subscription_id = ${activeOrderId}
      `;
      assert.equal(
        await store.recordWaffoSubscriptionChange({
          effectiveAt: new Date('2026-10-03T00:00:00.000Z').toISOString(),
          ownerUserId: userId,
          subscriptionId: activeOrderId,
          targetInterval: 'monthly',
          targetPriceId: 'PROD_STARTER_MONTHLY',
          workspaceId,
        }),
        'applied'
      );
      const applied = await client`
        SELECT target_price_id AS "targetPriceId", status
        FROM waffo_subscription_changes
        WHERE subscription_id = ${activeOrderId}
      `;
      assert.equal(applied[0]?.targetPriceId, 'PROD_GROWTH_YEARLY');
      assert.equal(applied[0]?.status, 'applied');
      await assert.rejects(
        store.recordWaffoSubscriptionChange({
          effectiveAt: new Date('2026-10-03T00:00:00.000Z').toISOString(),
          ownerUserId: userId,
          subscriptionId: activeOrderId,
          targetInterval: 'monthly',
          targetPriceId: 'PROD_STARTER_MONTHLY',
          workspaceId: otherWorkspaceId,
        }),
        /belongs to another workspace/
      );
    } finally {
      await client`DELETE FROM waffo_subscription_changes WHERE subscription_id = ${activeOrderId}`;
      await client`DELETE FROM "user" WHERE id = ${userId}`;
      await client`DELETE FROM workspaces WHERE id IN (${workspaceId}, ${otherWorkspaceId})`;
      await client.end();
    }
  }
);

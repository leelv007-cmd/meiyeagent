import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgresProStudioCommerceStore } from './postgres-pro-studio-commerce';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'exact provider event claims one bound add-on and survives activation retry',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const userId = `commerce-owner-${suffix}`;
    const sessionId = `commerce-session-${suffix}`;
    const workspaceId = `commerce-workspace-${suffix}`;
    const paymentId = `commerce-payment-${suffix}`;
    const checkoutId = `commerce-checkout-${suffix}`;
    const eventId = `commerce-event-${suffix}`;
    try {
      await migrateCommerceTables(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${userId}, 'Commerce Owner', ${`${userId}@example.test`}, TRUE, now(), now())
      `;
      await client`
        INSERT INTO workspaces (id, name)
        VALUES (${workspaceId}, 'Commerce Workspace')
      `;
      await client`
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${userId}, 'owner')
      `;
      await client`
        INSERT INTO "session"
          (id, token, user_id, expires_at, created_at, updated_at)
        VALUES
          (${sessionId}, ${`token-${suffix}`}, ${userId}, now() + interval '1 hour', now(), now())
      `;

      const store = new PostgresProStudioCommerceStore(db);
      const binding = await store.createOwnerBinding({
        offerId: 'pro-studio-v1',
        ownerSessionId: sessionId,
        ownerUserId: userId,
        paymentType: 'one_time',
        priceId: 'price-pro-studio',
        provider: 'stripe',
        workspaceId,
      });
      assert.ok(binding);
      await store.attachProviderCheckout({
        bindingId: binding.id,
        providerCheckoutId: checkoutId,
      });
      await client`DELETE FROM "session" WHERE id = ${sessionId}`;
      const [durableBinding] = await client<
        Array<{ id: string; owner_session_id: string | null }>
      >`
        SELECT id, owner_session_id
        FROM pro_studio_checkout_bindings
        WHERE id = ${binding.id}
      `;
      assert.deepEqual(durableBinding, {
        id: binding.id,
        owner_session_id: null,
      });
      await client`
        INSERT INTO payment
          (id, price_id, user_id, customer_id, session_id, type, status,
           paid, created_at, updated_at)
        VALUES
          (${paymentId}, 'price-pro-studio', ${userId}, ${`customer-${suffix}`},
           ${checkoutId}, 'one_time', 'completed', TRUE, now(), now())
      `;

      assert.equal(
        await store.claimPaidCheckout({
          eventType: 'checkout.session.completed',
          provider: 'stripe',
          providerEventId: `unrelated-${eventId}`,
          reference: { id: `unrelated-${checkoutId}`, kind: 'checkout' },
        }),
        null
      );

      const claim = await store.claimPaidCheckout({
        eventType: 'checkout.session.completed',
        provider: 'stripe',
        providerEventId: eventId,
        reference: { id: checkoutId, kind: 'checkout' },
      });
      assert.deepEqual(claim, {
        activationAttempts: 0,
        offerId: 'pro-studio-v1',
        ownerUserId: userId,
        paymentEventId: `stripe:${eventId}`,
        paymentId,
        provider: 'stripe',
        providerCheckoutId: checkoutId,
        providerEventId: eventId,
        workspaceId,
      });
      assert.equal(
        await store.getLatestWorkspaceClaimStatus(workspaceId),
        'pending'
      );

      const firstLease = await store.leaseActivation(`stripe:${eventId}`);
      assert.equal(firstLease?.activationAttempts, 1);
      assert.equal(
        await store.getLatestWorkspaceClaimStatus(workspaceId),
        'activating'
      );
      await store.markActivationFailed({
        availableAt: new Date(Date.now() + 60_000),
        errorCode: 'CANVAS_ACTIVATION_FAILED',
        paymentEventId: `stripe:${eventId}`,
      });
      assert.equal(
        await store.getLatestWorkspaceClaimStatus(workspaceId),
        'pending'
      );
      assert.equal(await store.leaseNextActivation(), null);

      await client`
        UPDATE pro_studio_payment_claims
        SET activation_available_at = now()
        WHERE payment_event_id = ${`stripe:${eventId}`}
      `;
      const retryLease = await store.leaseNextActivation();
      assert.equal(retryLease?.paymentEventId, `stripe:${eventId}`);
      assert.equal(retryLease?.activationAttempts, 2);
      await store.markActivated(`stripe:${eventId}`);
      assert.equal(
        await store.getLatestWorkspaceClaimStatus(workspaceId),
        'active'
      );

      const [persisted] = await client<
        Array<{
          activation_attempts: number;
          offer_id: string;
          provider_checkout_id: string;
          provider_event_id: string;
          status: string;
        }>
      >`
        SELECT activation_attempts, offer_id, provider_checkout_id,
               provider_event_id, status
        FROM pro_studio_payment_claims
        WHERE payment_id = ${paymentId}
      `;
      assert.deepEqual(persisted, {
        activation_attempts: 2,
        offer_id: 'pro-studio-v1',
        provider_checkout_id: checkoutId,
        provider_event_id: eventId,
        status: 'active',
      });
    } finally {
      await client`DELETE FROM "user" WHERE id = ${userId}`;
      await client`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await client.end();
    }
  }
);

async function migrateCommerceTables(client: postgres.Sql) {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS pro_studio_checkout_bindings (
      id text PRIMARY KEY,
      provider text NOT NULL,
      offer_id text NOT NULL,
      price_id text NOT NULL,
      payment_type text NOT NULL,
      interval text,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      owner_session_id text REFERENCES "session"(id) ON DELETE SET NULL,
      provider_checkout_id text,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      activated_at timestamptz
    );
    ALTER TABLE pro_studio_checkout_bindings
      ADD COLUMN IF NOT EXISTS payment_type text,
      ADD COLUMN IF NOT EXISTS interval text;
    DELETE FROM pro_studio_checkout_bindings WHERE payment_type IS NULL;
    ALTER TABLE pro_studio_checkout_bindings
      ALTER COLUMN payment_type SET NOT NULL,
      ALTER COLUMN owner_session_id DROP NOT NULL,
      DROP COLUMN IF EXISTS plan_id;
    ALTER TABLE pro_studio_checkout_bindings
      DROP CONSTRAINT IF EXISTS pro_studio_checkout_bindings_owner_session_id_session_id_fk,
      DROP CONSTRAINT IF EXISTS pro_studio_checkout_bindings_owner_session_id_fkey;
    ALTER TABLE pro_studio_checkout_bindings
      ADD CONSTRAINT pro_studio_checkout_bindings_owner_session_id_session_id_fk
      FOREIGN KEY (owner_session_id) REFERENCES "session"(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS pro_studio_checkout_bindings_provider_checkout_uidx
      ON pro_studio_checkout_bindings (provider, provider_checkout_id);
    CREATE TABLE IF NOT EXISTS pro_studio_payment_claims (
      payment_id text PRIMARY KEY REFERENCES payment(id) ON DELETE CASCADE,
      payment_event_id text NOT NULL UNIQUE,
      provider text NOT NULL,
      provider_event_id text NOT NULL,
      provider_checkout_id text NOT NULL,
      offer_id text NOT NULL,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      price_id text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      activation_attempts integer NOT NULL DEFAULT 0,
      activation_available_at timestamptz NOT NULL DEFAULT now(),
      activation_lease_until timestamptz,
      last_activation_error text,
      activated_at timestamptz,
      claimed_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE pro_studio_payment_claims
      ADD COLUMN IF NOT EXISTS provider text,
      ADD COLUMN IF NOT EXISTS provider_event_id text,
      ADD COLUMN IF NOT EXISTS provider_checkout_id text,
      ADD COLUMN IF NOT EXISTS offer_id text,
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS activation_attempts integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS activation_available_at timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS activation_lease_until timestamptz,
      ADD COLUMN IF NOT EXISTS last_activation_error text,
      ADD COLUMN IF NOT EXISTS activated_at timestamptz;
    DELETE FROM pro_studio_payment_claims
      WHERE provider IS NULL OR provider_event_id IS NULL
        OR provider_checkout_id IS NULL OR offer_id IS NULL;
    ALTER TABLE pro_studio_payment_claims
      ALTER COLUMN provider SET NOT NULL,
      ALTER COLUMN provider_event_id SET NOT NULL,
      ALTER COLUMN provider_checkout_id SET NOT NULL,
      ALTER COLUMN offer_id SET NOT NULL,
      ALTER COLUMN status SET NOT NULL,
      ALTER COLUMN activation_attempts SET NOT NULL,
      ALTER COLUMN activation_available_at SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS pro_studio_payment_claims_provider_event_uidx
      ON pro_studio_payment_claims (provider, provider_event_id);
    CREATE INDEX IF NOT EXISTS pro_studio_payment_claims_activation_due_idx
      ON pro_studio_payment_claims (status, activation_available_at)
  `);
}

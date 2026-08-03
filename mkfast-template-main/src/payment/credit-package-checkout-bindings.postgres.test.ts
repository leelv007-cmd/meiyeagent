import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { schema } from '@/db/schema';
import { PostgresCreditPackageCheckoutBindingStore } from '@/payment/credit-package-checkout-bindings';
import type { VerifiedPaymentWebhookEvent } from '@/payment/types';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'a Waffo credit package order claims its owned binding once and fences conflicting orders',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const ownerUserId = `credit-package-owner-${suffix}`;
    const workspaceId = `credit-package-workspace-${suffix}`;

    try {
      await migrateCreditPackageCheckoutBindings(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${ownerUserId}, 'Credit package owner',
           ${`${ownerUserId}@example.test`}, TRUE, now(), now())
      `;
      await client`
        INSERT INTO workspaces (id, name)
        VALUES (${workspaceId}, 'Credit package workspace')
      `;
      await client`
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${ownerUserId}, 'owner')
      `;

      const store = new PostgresCreditPackageCheckoutBindingStore(db);
      const binding = await store.createOwnerBinding({
        offerId: 'credits-300',
        ownerUserId,
        productId: 'PROD_CREDITS_300',
        provider: 'waffo',
        workspaceId,
      });
      assert.ok(binding);

      const event = {
        amount: '161.00',
        buyerIdentity: ownerUserId,
        currency: 'HKD',
        eventType: 'credit_package.completed' as const,
        packageCheckoutBindingId: binding.id,
        provider: 'waffo' as const,
        providerDeliveryId: `waffo-delivery-${suffix}`,
        providerEventId: `waffo-payment-${suffix}`,
        providerOccurredAt: '2026-08-04T01:02:03.000Z',
        reference: { id: `waffo-order-${suffix}`, kind: 'order' as const },
        scene: 'credit_package' as const,
      } satisfies VerifiedPaymentWebhookEvent;
      const claimed = await store.claimSettlement(event);
      assert.ok(claimed);
      assert.equal(claimed.status, 'claimed');
      assert.deepEqual(claimed.binding, {
        id: binding.id,
        offerId: 'credits-300',
        ownerUserId,
        productId: 'PROD_CREDITS_300',
        workspaceId,
      });

      await assert.rejects(
        store.claimSettlement(event),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'CREDIT_PACKAGE_SETTLEMENT_IN_PROGRESS'
      );
      await client`
        UPDATE credit_package_checkout_bindings
        SET settlement_lease_expires_at = now() - interval '1 second'
        WHERE id = ${binding.id}
      `;
      const recovered = await store.claimSettlement(event);
      assert.ok(recovered);
      assert.equal(recovered.status, 'claimed');
      if (recovered.status !== 'claimed') throw new Error('Expected a claim.');
      await store.completeSettlement({
        bindingId: binding.id,
        claimToken: recovered.claimToken,
      });

      const replay = await store.claimSettlement({
        ...event,
        providerDeliveryId: `waffo-delivery-replayed-${suffix}`,
      });
      assert.deepEqual(replay, {
        binding: {
          id: binding.id,
          offerId: 'credits-300',
          ownerUserId,
          productId: 'PROD_CREDITS_300',
          workspaceId,
        },
        status: 'duplicate',
      });
      const equivalentPaymentEvent = await store.claimSettlement({
        ...event,
        providerDeliveryId: `waffo-delivery-equivalent-payment-${suffix}`,
        providerEventId: `waffo-payment-equivalent-${suffix}`,
      });
      assert.deepEqual(equivalentPaymentEvent, {
        binding: {
          id: binding.id,
          offerId: 'credits-300',
          ownerUserId,
          productId: 'PROD_CREDITS_300',
          workspaceId,
        },
        status: 'duplicate',
      });
      await assert.rejects(
        store.claimSettlement({
          ...event,
          reference: { id: `waffo-order-conflict-${suffix}`, kind: 'order' },
        }),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'CREDIT_PACKAGE_SETTLEMENT_CONFLICT'
      );

      await store.attachProviderCheckout({
        bindingId: binding.id,
        providerCheckoutId: `waffo-session-${suffix}`,
      });
      assert.equal(
        await store.claimSettlement({ ...event, buyerIdentity: 'other-owner' }),
        null
      );
    } finally {
      await client`DELETE FROM "user" WHERE id = ${ownerUserId}`;
      await client`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await client.end();
    }
  }
);

test(
  'a pending Waffo package binding rejects a duplicate checkout creation',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const ownerUserId = `credit-package-pending-owner-${suffix}`;
    const workspaceId = `credit-package-pending-workspace-${suffix}`;
    const input = {
      offerId: 'credits-300',
      ownerUserId,
      productId: 'PROD_CREDITS_300',
      provider: 'waffo' as const,
      workspaceId,
    };

    try {
      await migrateCreditPackageCheckoutBindings(client);
      await insertCreditPackageOwner(client, ownerUserId, workspaceId);
      const store = new PostgresCreditPackageCheckoutBindingStore(db);
      const first = await store.createOwnerBinding(input);
      assert.ok(first);

      assert.equal(await store.createOwnerBinding(input), null);
      const bindings = await client<Array<{ id: string; status: string }>>`
        SELECT id, status
        FROM credit_package_checkout_bindings
        WHERE provider = 'waffo'
          AND owner_user_id = ${ownerUserId}
          AND workspace_id = ${workspaceId}
      `;
      assert.deepEqual([...bindings], [{ id: first.id, status: 'pending' }]);
    } finally {
      await deleteCreditPackageOwner(client, ownerUserId, workspaceId);
      await client.end();
    }
  }
);

test(
  'a checkout-created Waffo package binding rejects a duplicate checkout creation',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const ownerUserId = `credit-package-checkout-owner-${suffix}`;
    const workspaceId = `credit-package-checkout-workspace-${suffix}`;
    const input = {
      offerId: 'credits-300',
      ownerUserId,
      productId: 'PROD_CREDITS_300',
      provider: 'waffo' as const,
      workspaceId,
    };

    try {
      await migrateCreditPackageCheckoutBindings(client);
      await insertCreditPackageOwner(client, ownerUserId, workspaceId);
      const store = new PostgresCreditPackageCheckoutBindingStore(db);
      const first = await store.createOwnerBinding(input);
      assert.ok(first);
      await store.attachProviderCheckout({
        bindingId: first.id,
        providerCheckoutId: `waffo-session-${suffix}`,
      });

      assert.equal(await store.createOwnerBinding(input), null);
      const bindings = await client<Array<{ id: string; status: string }>>`
        SELECT id, status
        FROM credit_package_checkout_bindings
        WHERE provider = 'waffo'
          AND owner_user_id = ${ownerUserId}
          AND workspace_id = ${workspaceId}
      `;
      assert.deepEqual(
        [...bindings],
        [{ id: first.id, status: 'checkout_created' }]
      );
    } finally {
      await deleteCreditPackageOwner(client, ownerUserId, workspaceId);
      await client.end();
    }
  }
);

async function migrateCreditPackageCheckoutBindings(client: postgres.Sql) {
  const [existing] = await client<Array<{ tableName: string | null }>>`
    SELECT to_regclass('public.credit_package_checkout_bindings')::text
      AS "tableName"
  `;
  if (existing?.tableName) return;
  const migration = await readFile(
    new URL(
      '../../drizzle/0021_credit_package_checkout_bindings.sql',
      import.meta.url
    ),
    'utf8'
  );
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) await client.unsafe(trimmed);
  }
}

async function insertCreditPackageOwner(
  client: postgres.Sql,
  ownerUserId: string,
  workspaceId: string
) {
  await client`
    INSERT INTO "user"
      (id, name, email, email_verified, created_at, updated_at)
    VALUES
      (${ownerUserId}, 'Credit package owner',
       ${`${ownerUserId}@example.test`}, TRUE, now(), now())
  `;
  await client`
    INSERT INTO workspaces (id, name)
    VALUES (${workspaceId}, 'Credit package workspace')
  `;
  await client`
    INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${workspaceId}, ${ownerUserId}, 'owner')
  `;
}

async function deleteCreditPackageOwner(
  client: postgres.Sql,
  ownerUserId: string,
  workspaceId: string
) {
  await client`DELETE FROM "user" WHERE id = ${ownerUserId}`;
  await client`DELETE FROM workspaces WHERE id = ${workspaceId}`;
}

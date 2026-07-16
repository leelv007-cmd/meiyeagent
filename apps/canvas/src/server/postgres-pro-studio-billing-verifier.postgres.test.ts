import assert from "node:assert/strict";
import test from "node:test";
import { migrateProStudioWorkspaceState } from "@meiye/core/pro-studio-runtime";
import { Pool } from "pg";
import { PostgresProStudioBillingVerifier } from "./postgres-pro-studio-billing-verifier";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
	"a trusted payment claim unlocks only its bound workspace",
	{ skip: !databaseUrl },
	async () => {
		const pool = new Pool({ connectionString: databaseUrl });
		const suffix = crypto.randomUUID();
		const userId = `billing-owner-${suffix}`;
		const workspaceOne = `billing-workspace-one-${suffix}`;
		const workspaceTwo = `billing-workspace-two-${suffix}`;
		const paymentId = `billing-payment-${suffix}`;
		const checkoutId = `billing-checkout-${suffix}`;
		const providerEventId = `billing-event-${suffix}`;
		const paymentEventId = `stripe:${providerEventId}`;
		const priceId = `billing-price-${suffix}`;
		const offerId = `billing-offer-${suffix}`;
		try {
			await migrateProStudioWorkspaceState(pool);
			await pool.query(
				`INSERT INTO "user"
					(id, name, email, email_verified, created_at, updated_at)
				 VALUES ($1, 'Billing Owner', $2, TRUE, now(), now())`,
				[userId, `${userId}@example.test`],
			);
			await pool.query(
				`INSERT INTO workspaces (id, name)
				 VALUES ($1, 'Billing Workspace One'), ($2, 'Billing Workspace Two')`,
				[workspaceOne, workspaceTwo],
			);
			await pool.query(
				`INSERT INTO workspace_memberships (workspace_id, user_id, role)
				 VALUES ($1, $3, 'owner'), ($2, $3, 'owner')`,
				[workspaceOne, workspaceTwo, userId],
			);
			await pool.query(
				`INSERT INTO payment
					(id, price_id, user_id, customer_id, session_id, type, status, paid, created_at, updated_at)
				 VALUES ($1, $2, $3, $4, $5, 'one_time', 'completed', TRUE, now(), now())`,
				[paymentId, priceId, userId, `billing-customer-${suffix}`, checkoutId],
			);
			await pool.query(
				`INSERT INTO pro_studio_payment_claims
					(payment_id, payment_event_id, provider, provider_event_id,
					 provider_checkout_id, offer_id, workspace_id, owner_user_id,
					 price_id, status)
					 VALUES ($1, $2, 'stripe', $3, $4, $5, $6, $7, $8, 'activating')`,
				[
					paymentId,
					paymentEventId,
					providerEventId,
					checkoutId,
					offerId,
					workspaceOne,
					userId,
					priceId,
				],
			);

			const verifier = new PostgresProStudioBillingVerifier(pool, priceId);
			assert.equal(
				(
					await verifier.verifyPaidEvent({
						offerId,
						paymentEventId,
						workspaceId: workspaceOne,
					})
				).status,
				"paid",
			);
			assert.deepEqual(
				await verifier.verifyPaidEvent({
					offerId,
					paymentEventId,
					workspaceId: workspaceTwo,
				}),
				{ status: "not_paid" },
			);
		} finally {
			await pool.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
			await pool.query(`DELETE FROM workspaces WHERE id = ANY($1::text[])`, [
				[workspaceOne, workspaceTwo],
			]);
			await pool.end();
		}
	},
);

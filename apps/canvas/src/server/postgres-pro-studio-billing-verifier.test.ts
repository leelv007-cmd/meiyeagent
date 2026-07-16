import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PostgresProStudioBillingVerifier } from "./postgres-pro-studio-billing-verifier";

interface PaymentVerificationRow {
	offerId: string;
	ownerUserId: string;
	paid: boolean;
	paymentEventId: string;
	paymentUserId: string;
	priceId: string;
	providerCheckoutId: string;
	providerEventId: string;
	role: string;
	sessionId: string;
	status: string;
	workspaceId: string;
}

const validPayment = (overrides: Partial<PaymentVerificationRow> = {}) => ({
	offerId: "pro-studio-v1",
	ownerUserId: "user-owner",
	paid: true,
	paymentEventId: "creem:event-1",
	paymentUserId: "user-owner",
	priceId: "price-pro-studio",
	providerCheckoutId: "checkout-1",
	providerEventId: "event-1",
	role: "owner",
	sessionId: "checkout-1",
	status: "activating",
	workspaceId: "workspace-1",
	...overrides,
});

function verifierReturning(row: PaymentVerificationRow) {
	const pool = {
		async query() {
			return { rows: [row] };
		},
	} as unknown as Pool;
	return new PostgresProStudioBillingVerifier(pool, "price-pro-studio");
}

test("verifies the exact leased offer and provider-event claim tuple", async () => {
	const result = await verifierReturning(validPayment()).verifyPaidEvent({
		offerId: "pro-studio-v1",
		paymentEventId: "creem:event-1",
		workspaceId: "workspace-1",
	});

	assert.deepEqual(result, {
		eventId: "creem:event-1",
		offerId: "pro-studio-v1",
		status: "paid",
		workspaceId: "workspace-1",
	});
});

test("rejects any mismatch in the exact activation claim", async () => {
	for (const [name, row] of Object.entries({
		"checkout mismatch": validPayment({ providerCheckoutId: "checkout-2" }),
		"empty provider event": validPayment({ providerEventId: "" }),
		"event mismatch": validPayment({ paymentEventId: "creem:event-2" }),
		"not leased": validPayment({ status: "pending" }),
		"not owner": validPayment({ role: "operator" }),
		"offer mismatch": validPayment({ offerId: "other-offer" }),
		"price mismatch": validPayment({ priceId: "other-price" }),
		unpaid: validPayment({ paid: false }),
	})) {
		const result = await verifierReturning(row).verifyPaidEvent({
			offerId: "pro-studio-v1",
			paymentEventId: "creem:event-1",
			workspaceId: "workspace-1",
		});
		assert.deepEqual(result, { status: "not_paid" }, name);
	}
});

test("returns not_paid on database failure or missing price config", async () => {
	let queries = 0;
	const pool = {
		async query() {
			queries += 1;
			throw new Error("database unavailable");
		},
	} as unknown as Pool;
	const input = {
		offerId: "pro-studio-v1",
		paymentEventId: "creem:event-1",
		workspaceId: "workspace-1",
	};
	assert.deepEqual(
		await new PostgresProStudioBillingVerifier(pool, "price").verifyPaidEvent(
			input,
		),
		{ status: "not_paid" },
	);
	assert.deepEqual(
		await new PostgresProStudioBillingVerifier(pool, " ").verifyPaidEvent(
			input,
		),
		{ status: "not_paid" },
	);
	assert.equal(queries, 1);
});

test("queries the complete server-owned claim tuple", async () => {
	const calls: Array<{ sql: string; values?: unknown[] }> = [];
	const pool = {
		async query(sql: string, values?: unknown[]) {
			calls.push({ sql, values });
			return { rows: [] };
		},
	} as unknown as Pool;
	const result = await new PostgresProStudioBillingVerifier(
		pool,
		"price-pro-studio",
	).verifyPaidEvent({
		offerId: "pro-studio-v1",
		paymentEventId: "creem:event-1",
		workspaceId: "workspace-1",
	});

	assert.deepEqual(result, { status: "not_paid" });
	assert.deepEqual(calls[0]?.values, [
		"workspace-1",
		"price-pro-studio",
		"creem:event-1",
		"pro-studio-v1",
	]);
	const sql = calls[0]?.sql ?? "";
	assert.match(sql, /claim\.payment_event_id = \$3/u);
	assert.match(sql, /claim\.offer_id = \$4/u);
	assert.match(sql, /payment\.session_id = claim\.provider_checkout_id/u);
	assert.match(sql, /claim\.provider \|\| ':' \|\| claim\.provider_event_id/u);
	assert.match(sql, /claim\.status = 'activating'/u);
	assert.match(sql, /workspace_memberships\.role = 'owner'/u);
});

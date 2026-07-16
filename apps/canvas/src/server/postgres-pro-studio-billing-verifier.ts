import type { ProStudioBillingVerificationPort } from "@meiye/core/pro-studio-runtime";
import type { Pool } from "pg";

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

export class PostgresProStudioBillingVerifier
	implements ProStudioBillingVerificationPort
{
	constructor(
		private readonly pool: Pool,
		private readonly priceId: string | undefined,
	) {}

	async verifyPaidEvent(input: {
		workspaceId: string;
		offerId: string;
		paymentEventId: string;
	}) {
		const priceId = this.priceId?.trim();
		if (!priceId) return { status: "not_paid" as const };

		let payment: PaymentVerificationRow | undefined;
		try {
			const result = await this.pool.query(
				`SELECT
					claim.offer_id AS "offerId",
					claim.owner_user_id AS "ownerUserId",
					claim.payment_event_id AS "paymentEventId",
					claim.provider_checkout_id AS "providerCheckoutId",
					claim.provider_event_id AS "providerEventId",
					claim.status,
					payment.paid,
					payment.price_id AS "priceId",
					payment.session_id AS "sessionId",
					payment.user_id AS "paymentUserId",
					workspace_memberships.workspace_id AS "workspaceId",
					workspace_memberships.role
				 FROM pro_studio_payment_claims AS claim
				 INNER JOIN payment
					ON payment.id = claim.payment_id
					AND payment.user_id = claim.owner_user_id
					AND payment.price_id = claim.price_id
					AND payment.session_id = claim.provider_checkout_id
				 INNER JOIN workspace_memberships
					ON workspace_memberships.user_id = claim.owner_user_id
					AND workspace_memberships.workspace_id = claim.workspace_id
					AND workspace_memberships.role = 'owner'
				 WHERE claim.workspace_id = $1
					AND claim.price_id = $2
					AND claim.payment_event_id = $3
					AND claim.offer_id = $4
					AND claim.payment_event_id = claim.provider || ':' || claim.provider_event_id
					AND claim.status = 'activating'
					AND payment.paid = TRUE
				 LIMIT 1`,
				[input.workspaceId, priceId, input.paymentEventId, input.offerId],
			);
			payment = result.rows[0] as PaymentVerificationRow | undefined;
		} catch {
			return { status: "not_paid" as const };
		}
		if (
			!payment ||
			payment.paid !== true ||
			payment.priceId !== priceId ||
			payment.role !== "owner" ||
			payment.workspaceId !== input.workspaceId ||
			payment.paymentUserId !== payment.ownerUserId ||
			payment.offerId !== input.offerId ||
			payment.paymentEventId !== input.paymentEventId ||
			payment.providerCheckoutId !== payment.sessionId ||
			payment.providerEventId.trim().length === 0 ||
			payment.status !== "activating"
		) {
			return { status: "not_paid" as const };
		}

		return {
			eventId: input.paymentEventId,
			offerId: input.offerId,
			status: "paid" as const,
			workspaceId: input.workspaceId,
		};
	}
}

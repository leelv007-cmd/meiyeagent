import type { getDb as getDatabase } from '@/db';
import { sql, type SQL } from 'drizzle-orm';
import type {
  PaymentProviderName,
  Price,
  VerifiedPaymentWebhookEvent,
} from './types';
import type {
  ProStudioActivationClaim,
  ProStudioCommerceStore,
  ProStudioPaymentClaimStatus,
} from './pro-studio-commerce';

interface IdentifierRow extends Record<string, unknown> {
  id: string;
}

interface ClaimRow extends Record<string, unknown> {
  activationAttempts: number;
  offerId: string;
  ownerUserId: string;
  paymentEventId: string;
  paymentId: string;
  provider: PaymentProviderName;
  providerCheckoutId: string;
  providerEventId: string;
  workspaceId: string;
}

interface ClaimStatusRow extends Record<string, unknown> {
  status: ProStudioPaymentClaimStatus;
}

export class PostgresProStudioCommerceStore implements ProStudioCommerceStore {
  constructor(private readonly db: ReturnType<typeof getDatabase>) {}

  async getLatestWorkspaceClaimStatus(workspaceId: string) {
    const rows = await this.db.execute<ClaimStatusRow>(sql`
      SELECT status
      FROM pro_studio_payment_claims
      WHERE workspace_id = ${workspaceId}
        AND status IN ('pending', 'activating', 'active')
      ORDER BY claimed_at DESC, payment_event_id DESC
      LIMIT 1
    `);
    return rows[0]?.status ?? null;
  }

  async createOwnerBinding(input: {
    interval?: Price['interval'];
    offerId: string;
    ownerSessionId: string;
    ownerUserId: string;
    paymentType: Price['type'];
    priceId: string;
    provider: PaymentProviderName;
    workspaceId: string;
  }) {
    const id = `psc_${crypto.randomUUID()}`;
    const rows = await this.db.execute<IdentifierRow>(sql`
      INSERT INTO pro_studio_checkout_bindings
        (id, provider, offer_id, price_id, payment_type, interval,
         workspace_id, owner_user_id, owner_session_id, status,
         created_at, updated_at)
      SELECT
        ${id}, ${input.provider}, ${input.offerId}, ${input.priceId},
        ${input.paymentType}, ${input.interval ?? null}, ${input.workspaceId},
        ${input.ownerUserId}, ${input.ownerSessionId}, 'pending', now(), now()
      FROM "session" AS owner_session
      INNER JOIN "user" AS owner_user
        ON owner_user.id = owner_session.user_id
      INNER JOIN workspace_memberships
        ON workspace_memberships.user_id = owner_session.user_id
        AND workspace_memberships.workspace_id = ${input.workspaceId}
        AND workspace_memberships.role = 'owner'
      WHERE owner_session.id = ${input.ownerSessionId}
        AND owner_session.user_id = ${input.ownerUserId}
        AND owner_session.expires_at > now()
        AND COALESCE(owner_user.banned, FALSE) = FALSE
      RETURNING id
    `);
    return rows[0] ?? null;
  }

  async attachProviderCheckout(input: {
    bindingId: string;
    providerCheckoutId: string;
  }) {
    const rows = await this.db.execute<IdentifierRow>(sql`
      UPDATE pro_studio_checkout_bindings
      SET provider_checkout_id = ${input.providerCheckoutId},
          status = 'checkout_created',
          updated_at = now()
      WHERE id = ${input.bindingId} AND status = 'pending'
      RETURNING id
    `);
    if (!rows[0])
      throw new Error('Pro Studio checkout binding was not attached.');
  }

  async markCheckoutFailed(bindingId: string) {
    await this.db.execute(sql`
      UPDATE pro_studio_checkout_bindings
      SET status = 'failed', updated_at = now()
      WHERE id = ${bindingId} AND status = 'pending'
    `);
  }

  async claimPaidCheckout(event: VerifiedPaymentWebhookEvent) {
    const paymentReference = exactPaymentReference(event);
    const paymentEventId = `${event.provider}:${event.providerEventId}`;
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        INSERT INTO pro_studio_payment_claims
          (payment_id, payment_event_id, provider, provider_event_id,
           provider_checkout_id, offer_id, workspace_id, owner_user_id,
           price_id, status, activation_attempts, activation_available_at,
           claimed_at)
        SELECT
          payment.id,
          ${paymentEventId},
          ${event.provider},
          ${event.providerEventId},
          binding.provider_checkout_id,
          binding.offer_id,
          binding.workspace_id,
          binding.owner_user_id,
          binding.price_id,
          'pending',
          0,
          now(),
          now()
        FROM payment
        INNER JOIN pro_studio_checkout_bindings AS binding
          ON binding.provider_checkout_id = payment.session_id
          AND binding.provider = ${event.provider}
          AND binding.owner_user_id = payment.user_id
          AND binding.price_id = payment.price_id
          AND binding.payment_type = payment.type
          AND binding.interval IS NOT DISTINCT FROM payment.interval
        INNER JOIN workspace_memberships
          ON workspace_memberships.workspace_id = binding.workspace_id
          AND workspace_memberships.user_id = binding.owner_user_id
          AND workspace_memberships.role = 'owner'
        WHERE binding.status = 'checkout_created'
          AND binding.provider_checkout_id IS NOT NULL
          AND payment.paid = TRUE
          AND ${paymentReference}
        ON CONFLICT (payment_id) DO NOTHING
      `);
      const rows = await transaction.execute<ClaimRow>(sql`
        SELECT
          claim.activation_attempts AS "activationAttempts",
          claim.offer_id AS "offerId",
          claim.owner_user_id AS "ownerUserId",
          claim.payment_event_id AS "paymentEventId",
          claim.payment_id AS "paymentId",
          claim.provider,
          claim.provider_checkout_id AS "providerCheckoutId",
          claim.provider_event_id AS "providerEventId",
          claim.workspace_id AS "workspaceId"
        FROM pro_studio_payment_claims AS claim
        INNER JOIN payment ON payment.id = claim.payment_id
        WHERE claim.provider = ${event.provider}
          AND claim.provider_event_id = ${event.providerEventId}
          AND claim.payment_event_id = ${paymentEventId}
          AND ${paymentReference}
        LIMIT 1
      `);
      return rows[0] ?? null;
    });
  }

  async leaseActivation(paymentEventId: string) {
    const rows = await this.db.execute<ClaimRow>(sql`
      UPDATE pro_studio_payment_claims
      SET status = 'activating',
          activation_attempts = activation_attempts + 1,
          activation_lease_until = now() + interval '5 minutes',
          last_activation_error = NULL
      WHERE payment_event_id = ${paymentEventId}
        AND (
          (status = 'pending' AND activation_available_at <= now())
          OR (status = 'activating' AND activation_lease_until <= now())
        )
      RETURNING
        activation_attempts AS "activationAttempts",
        offer_id AS "offerId",
        owner_user_id AS "ownerUserId",
        payment_event_id AS "paymentEventId",
        payment_id AS "paymentId",
        provider,
        provider_checkout_id AS "providerCheckoutId",
        provider_event_id AS "providerEventId",
        workspace_id AS "workspaceId"
    `);
    return rows[0] ?? null;
  }

  async leaseNextActivation(): Promise<ProStudioActivationClaim | null> {
    const rows = await this.db.execute<ClaimRow>(sql`
      WITH next_claim AS (
        SELECT payment_event_id
        FROM pro_studio_payment_claims
        WHERE
          (status = 'pending' AND activation_available_at <= now())
          OR (status = 'activating' AND activation_lease_until <= now())
        ORDER BY activation_available_at, claimed_at, payment_event_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE pro_studio_payment_claims AS claim
      SET status = 'activating',
          activation_attempts = claim.activation_attempts + 1,
          activation_lease_until = now() + interval '5 minutes',
          last_activation_error = NULL
      FROM next_claim
      WHERE claim.payment_event_id = next_claim.payment_event_id
      RETURNING
        claim.activation_attempts AS "activationAttempts",
        claim.offer_id AS "offerId",
        claim.owner_user_id AS "ownerUserId",
        claim.payment_event_id AS "paymentEventId",
        claim.payment_id AS "paymentId",
        claim.provider,
        claim.provider_checkout_id AS "providerCheckoutId",
        claim.provider_event_id AS "providerEventId",
        claim.workspace_id AS "workspaceId"
    `);
    return rows[0] ?? null;
  }

  async markActivated(paymentEventId: string) {
    await this.db.execute(sql`
      UPDATE pro_studio_payment_claims
      SET status = 'active',
          activated_at = COALESCE(activated_at, now()),
          activation_lease_until = NULL,
          last_activation_error = NULL
      WHERE payment_event_id = ${paymentEventId}
        AND status IN ('activating', 'active')
    `);
  }

  async markActivationFailed(input: {
    availableAt: Date;
    errorCode: 'CANVAS_ACTIVATION_FAILED';
    paymentEventId: string;
  }) {
    const availableAt = input.availableAt.toISOString();
    await this.db.execute(sql`
      UPDATE pro_studio_payment_claims
      SET status = 'pending',
          activation_available_at = ${availableAt}::timestamptz,
          activation_lease_until = NULL,
          last_activation_error = ${input.errorCode}
      WHERE payment_event_id = ${input.paymentEventId}
        AND status = 'activating'
    `);
  }
}

function exactPaymentReference(event: VerifiedPaymentWebhookEvent): SQL {
  return sql`payment.session_id = ${event.reference.id}`;
}

/**
 * Tc-1: plan checkout workspace binding store (PG).
 * Shape mirrors Pro Studio claim: bind workspace at checkout create, claim on webhook.
 */

import type { getDb as getDatabase } from '@/db';
import { sql } from 'drizzle-orm';
import type {
  PaymentProviderName,
  PaymentType,
  PlanInterval,
  VerifiedPaymentWebhookEvent,
} from './types';
import type {
  PlanCheckoutBindingFacts,
  PlanSettlementIntent,
} from './plan-commerce';

interface IdentifierRow extends Record<string, unknown> {
  id: string;
}

interface BindingRow extends Record<string, unknown> {
  interval: PlanInterval | 'lifetime' | null;
  ownerUserId: string;
  priceId: string;
  workspaceId: string;
  paymentType: PaymentType;
  cancelAtPeriodEnd: boolean | null;
  periodStart: Date | string | null;
  periodEnd: Date | string | null;
  subscriptionId: string | null;
}

export class PostgresPlanCheckoutBindingStore {
  constructor(private readonly db: ReturnType<typeof getDatabase>) {}

  async createOwnerBinding(input: {
    interval?: PlanInterval | 'lifetime' | null;
    ownerUserId: string;
    paymentType: PaymentType;
    priceId: string;
    provider: PaymentProviderName;
    workspaceId: string;
  }) {
    const id = `pcb_${crypto.randomUUID()}`;
    const rows = await this.db.execute<IdentifierRow>(sql`
      INSERT INTO plan_checkout_bindings
        (id, provider, price_id, payment_type, interval,
         workspace_id, owner_user_id, status, created_at, updated_at)
      SELECT
        ${id}, ${input.provider}, ${input.priceId}, ${input.paymentType},
        ${input.interval ?? null}, ${input.workspaceId}, ${input.ownerUserId},
        'pending', now(), now()
      FROM workspace_memberships
      WHERE workspace_memberships.workspace_id = ${input.workspaceId}
        AND workspace_memberships.user_id = ${input.ownerUserId}
        AND workspace_memberships.role = 'owner'
      RETURNING id
    `);
    return rows[0] ?? null;
  }

  async attachProviderCheckout(input: {
    bindingId: string;
    providerCheckoutId: string;
  }) {
    const rows = await this.db.execute<IdentifierRow>(sql`
      UPDATE plan_checkout_bindings
      SET provider_checkout_id = COALESCE(
            provider_checkout_id,
            ${input.providerCheckoutId}
          ),
          status = CASE
            WHEN status = 'pending' THEN 'checkout_created'
            ELSE status
          END,
          updated_at = now()
      WHERE id = ${input.bindingId}
        AND status IN ('pending', 'checkout_created', 'active')
        AND (
          provider_checkout_id IS NULL
          OR provider_checkout_id = ${input.providerCheckoutId}
        )
      RETURNING id
    `);
    if (!rows[0]) {
      throw new Error('Plan checkout binding was not attached.');
    }
  }

  async markCheckoutFailed(bindingId: string) {
    await this.db.execute(sql`
      UPDATE plan_checkout_bindings
      SET status = 'failed', updated_at = now()
      WHERE id = ${bindingId} AND status = 'pending'
    `);
  }

  /**
   * Resolve plan binding facts for a verified webhook event.
   * Returns null when the event is not a plan payment.
   */
  async resolveBinding(
    event: VerifiedPaymentWebhookEvent
  ): Promise<PlanCheckoutBindingFacts | null> {
    if (event.reference.kind === 'checkout') {
      const rows = await this.db.execute<BindingRow>(sql`
        SELECT
          binding.workspace_id AS "workspaceId",
          binding.owner_user_id AS "ownerUserId",
          binding.price_id AS "priceId",
          binding.interval AS "interval",
          binding.payment_type AS "paymentType",
          payment.cancel_at_period_end AS "cancelAtPeriodEnd",
          payment.period_start AS "periodStart",
          payment.period_end AS "periodEnd",
          payment.subscription_id AS "subscriptionId"
        FROM plan_checkout_bindings AS binding
        LEFT JOIN payment
          ON (
            payment.session_id = binding.provider_checkout_id
            OR (
              binding.id = ${event.planBindingId ?? null}
              AND payment.session_id = ${event.reference.id}
            )
          )
          AND payment.user_id = binding.owner_user_id
          AND payment.price_id = binding.price_id
        WHERE binding.provider = ${event.provider}
          AND binding.owner_user_id = COALESCE(
            ${event.buyerIdentity ?? null},
            binding.owner_user_id
          )
          AND (
            (
              binding.provider_checkout_id = ${event.reference.id}
              AND binding.status IN ('checkout_created', 'active')
            )
            OR (
              binding.id = ${event.planBindingId ?? null}
              AND binding.status = 'pending'
            )
          )
        LIMIT 1
      `);
      return factsWithVerifiedPeriod(rowToFacts(rows[0]), event);
    }

    if (event.reference.kind === 'subscription') {
      const rows = await this.db.execute<BindingRow>(sql`
        SELECT
          binding.workspace_id AS "workspaceId",
          binding.owner_user_id AS "ownerUserId",
          COALESCE(payment.price_id, binding.price_id) AS "priceId",
          COALESCE(payment.interval, binding.interval) AS "interval",
          binding.payment_type AS "paymentType",
          payment.cancel_at_period_end AS "cancelAtPeriodEnd",
          payment.period_start AS "periodStart",
          payment.period_end AS "periodEnd",
          COALESCE(payment.subscription_id, binding.subscription_id) AS "subscriptionId"
        FROM plan_checkout_bindings AS binding
        LEFT JOIN payment
          ON payment.subscription_id = ${event.reference.id}
          AND payment.user_id = binding.owner_user_id
        WHERE binding.provider = ${event.provider}
          AND binding.owner_user_id = COALESCE(
            ${event.buyerIdentity ?? null},
            binding.owner_user_id
          )
          AND (
            binding.subscription_id = ${event.reference.id}
            OR payment.session_id = binding.provider_checkout_id
            OR (
              binding.id = ${event.planBindingId ?? null}
              AND binding.status IN ('pending', 'checkout_created', 'active')
            )
          )
          AND binding.status IN ('checkout_created', 'active', 'canceled')
        ORDER BY binding.updated_at DESC
        LIMIT 1
      `);
      return factsWithVerifiedPeriod(rowToFacts(rows[0]), event);
    }

    if (event.reference.kind === 'invoice') {
      const rows = await this.db.execute<BindingRow>(sql`
        SELECT
          binding.workspace_id AS "workspaceId",
          binding.owner_user_id AS "ownerUserId",
          payment.price_id AS "priceId",
          payment.interval AS "interval",
          binding.payment_type AS "paymentType",
          payment.cancel_at_period_end AS "cancelAtPeriodEnd",
          payment.period_start AS "periodStart",
          payment.period_end AS "periodEnd",
          payment.subscription_id AS "subscriptionId"
        FROM payment
        INNER JOIN plan_checkout_bindings AS binding
          ON (
            binding.subscription_id = payment.subscription_id
            OR binding.provider_checkout_id = payment.session_id
          )
          AND binding.owner_user_id = payment.user_id
          AND binding.provider = ${event.provider}
        WHERE payment.invoice_id = ${event.reference.id}
          AND payment.paid = TRUE
        ORDER BY payment.updated_at DESC
        LIMIT 1
      `);
      return factsWithVerifiedPeriod(rowToFacts(rows[0]), event);
    }

    return null;
  }

  async markActive(input: {
    bindingId?: string | null;
    provider: PaymentProviderName;
    providerCheckoutId?: string | null;
    subscriptionId?: string | null;
  }) {
    if (input.bindingId) {
      await this.db.execute(sql`
        UPDATE plan_checkout_bindings
        SET status = 'active',
            provider_checkout_id = COALESCE(
              provider_checkout_id,
              ${sql.param(input.providerCheckoutId ?? null)}
            ),
            subscription_id = COALESCE(
              ${sql.param(input.subscriptionId ?? null)},
              subscription_id
            ),
            updated_at = now()
        WHERE id = ${input.bindingId}
          AND provider = ${input.provider}
          AND (
            provider_checkout_id IS NULL
            OR provider_checkout_id = COALESCE(
              ${sql.param(input.providerCheckoutId ?? null)},
              provider_checkout_id
            )
          )
          AND (
            subscription_id IS NULL
            OR subscription_id = COALESCE(
              ${sql.param(input.subscriptionId ?? null)},
              subscription_id
            )
          )
      `);
    } else if (input.providerCheckoutId) {
      await this.db.execute(sql`
        UPDATE plan_checkout_bindings
        SET status = 'active',
            subscription_id = COALESCE(${input.subscriptionId ?? null}, subscription_id),
            updated_at = now()
        WHERE provider = ${input.provider}
          AND provider_checkout_id = ${input.providerCheckoutId}
      `);
    } else if (input.subscriptionId) {
      await this.db.execute(sql`
        UPDATE plan_checkout_bindings AS binding
        SET status = 'active',
            subscription_id = ${input.subscriptionId},
            updated_at = now()
        FROM payment
        WHERE binding.provider = ${input.provider}
          AND payment.subscription_id = ${input.subscriptionId}
          AND payment.user_id = binding.owner_user_id
          AND (
            binding.subscription_id = ${input.subscriptionId}
            OR payment.session_id = binding.provider_checkout_id
          )
      `);
    }
  }

  async upsertWaffoSubscriptionPayment(input: {
    event: VerifiedPaymentWebhookEvent;
    intent: PlanSettlementIntent;
  }) {
    const subscriptionId = input.intent.subscriptionId?.trim();
    if (!subscriptionId) {
      throw new Error('Waffo subscription settlement requires subscriptionId.');
    }
    const paymentId = `waffo:${subscriptionId}`;
    const customerId =
      input.event.buyerIdentity?.trim() || input.intent.ownerUserId;
    const status =
      input.intent.lifecycle === 'expire'
        ? ('canceled' as const)
        : ('active' as const);
    const cancelAtPeriodEnd = input.intent.lifecycle === 'cancel_at_period_end';
    const rows = await this.db.execute<IdentifierRow>(sql`
      INSERT INTO payment (
        id, provider, price_id, user_id, customer_id, subscription_id,
        type, scene, interval, status, paid, period_start, period_end,
        cancel_at_period_end, created_at, updated_at
      )
      VALUES (
        ${paymentId}, 'waffo', ${input.intent.priceId},
        ${input.intent.ownerUserId}, ${customerId}, ${subscriptionId},
        'subscription', 'subscription', ${input.intent.interval}, ${status},
        TRUE, ${input.intent.periodStartsAt}, ${input.intent.periodEndsAt},
        ${cancelAtPeriodEnd}, now(), now()
      )
      ON CONFLICT (subscription_id) DO UPDATE
      SET provider = EXCLUDED.provider,
          price_id = EXCLUDED.price_id,
          customer_id = EXCLUDED.customer_id,
          interval = EXCLUDED.interval,
          status = EXCLUDED.status,
          paid = EXCLUDED.paid,
          period_start = COALESCE(EXCLUDED.period_start, payment.period_start),
          period_end = COALESCE(EXCLUDED.period_end, payment.period_end),
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          updated_at = now()
      WHERE payment.provider IS NULL OR payment.provider = 'waffo'
      RETURNING id
    `);
    if (!rows[0]) {
      throw new Error(
        'Waffo subscription payment belongs to another provider.'
      );
    }
  }

  async markCanceled(input: {
    provider: PaymentProviderName;
    subscriptionId: string;
  }) {
    await this.db.execute(sql`
      UPDATE plan_checkout_bindings AS binding
      SET status = 'canceled', updated_at = now()
      WHERE binding.provider = ${input.provider}
        AND (
          binding.subscription_id = ${input.subscriptionId}
          OR EXISTS (
            SELECT 1
            FROM payment
            WHERE payment.subscription_id = ${input.subscriptionId}
              AND payment.user_id = binding.owner_user_id
              AND payment.session_id = binding.provider_checkout_id
          )
        )
    `);
  }
}

function rowToFacts(
  row: BindingRow | undefined
): PlanCheckoutBindingFacts | null {
  if (!row?.workspaceId || !row.ownerUserId || !row.priceId) return null;
  const interval =
    row.interval === 'single_month' ||
    row.interval === 'monthly' ||
    row.interval === 'yearly' ||
    row.interval === 'month' ||
    row.interval === 'year' ||
    row.interval === 'lifetime'
      ? row.interval
      : row.paymentType === 'one_time'
        ? ('one_time' as const)
        : null;
  return {
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    priceId: row.priceId,
    interval,
    periodStartsAt: row.periodStart ?? null,
    periodEndsAt: row.periodEnd ?? null,
    subscriptionId: row.subscriptionId ?? null,
    ...(row.cancelAtPeriodEnd != null
      ? { cancelAtPeriodEnd: row.cancelAtPeriodEnd }
      : {}),
  };
}

function factsWithVerifiedPeriod(
  facts: PlanCheckoutBindingFacts | null,
  event: VerifiedPaymentWebhookEvent
): PlanCheckoutBindingFacts | null {
  if (!facts) return null;
  return {
    ...facts,
    ...(event.periodStartsAt ? { periodStartsAt: event.periodStartsAt } : {}),
    ...(event.periodEndsAt ? { periodEndsAt: event.periodEndsAt } : {}),
  };
}

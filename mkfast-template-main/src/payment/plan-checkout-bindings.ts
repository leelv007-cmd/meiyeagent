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
  replacesSubscriptionId: string | null;
}

export type WaffoSubscriptionPaymentMutation =
  | 'applied'
  | 'duplicate'
  | 'ignored_stale';

export type WaffoSubscriptionSnapshot = {
  subscriptionId: string;
  priceId: string;
  interval: PlanInterval | null;
  status: 'active' | 'past_due' | 'trialing';
  periodEnd: Date | string | null;
  cancelAtPeriodEnd: boolean;
};

type WaffoPaymentRow = {
  provider: PaymentProviderName | null;
  userId: string;
  status: string;
  paid: boolean;
  cancelAtPeriodEnd: boolean | null;
  periodStart: Date | string | null;
  periodEnd: Date | string | null;
  providerOccurredAt: Date | string | null;
  eventId: string | null;
  eventRank: number | null;
};

export class PostgresPlanCheckoutBindingStore {
  constructor(private readonly db: ReturnType<typeof getDatabase>) {}

  /**
   * Execute the Waffo single-month period-end cancel behind a durable
   * subscription+period checkpoint. A pending row is retried after a failed
   * provider call; a completed row is never called again on delivery replay.
   */
  async cancelWaffoSubscriptionAtPeriodEnd(input: {
    cancel: () => Promise<void>;
    periodStartsAt: string | null;
    subscriptionId: string;
  }) {
    const subscriptionId = input.subscriptionId.trim();
    const periodStartsAt = input.periodStartsAt?.trim() ?? '';
    if (!subscriptionId || !periodStartsAt) {
      throw new Error(
        'Waffo cancellation checkpoint requires subscriptionId and periodStartsAt.'
      );
    }
    if (!Number.isFinite(Date.parse(periodStartsAt))) {
      throw new Error(
        'Waffo cancellation periodStartsAt must be an ISO timestamp.'
      );
    }

    await this.db.execute(sql`
        INSERT INTO waffo_subscription_cancellation_receipts
          (subscription_id, period_starts_at, status, requested_at,
           attempt_count, available_at, updated_at)
        VALUES (${subscriptionId}, ${periodStartsAt}, 'pending', now(),
                0, now(), now())
        ON CONFLICT (subscription_id, period_starts_at) DO NOTHING
      `);

    const claimToken = crypto.randomUUID();
    const claimed = await this.db.execute<{ status: 'processing' }>(sql`
      UPDATE waffo_subscription_cancellation_receipts
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          claim_token = ${claimToken},
          lease_expires_at = now() + interval '5 minutes',
          updated_at = now()
      WHERE subscription_id = ${subscriptionId}
        AND period_starts_at = ${periodStartsAt}
        AND (
          (status = 'pending' AND available_at <= now())
          OR (
            status = 'processing'
            AND (lease_expires_at IS NULL OR lease_expires_at <= now())
          )
        )
      RETURNING status
    `);
    if (!claimed[0]) {
      const current = await this.db.execute<{
        status: 'pending' | 'processing' | 'completed';
      }>(sql`
        SELECT status
        FROM waffo_subscription_cancellation_receipts
        WHERE subscription_id = ${subscriptionId}
          AND period_starts_at = ${periodStartsAt}
        LIMIT 1
      `);
      if (current[0]?.status === 'completed') return;
      const busy = Object.assign(
        new Error('Waffo cancellation checkpoint is already in progress.'),
        { code: 'WAFFO_CANCELLATION_IN_PROGRESS' }
      );
      throw busy;
    }

    try {
      // Provider calls must not hold a database transaction or row lock.
      await input.cancel();
      const completed = await this.db.execute(sql`
        UPDATE waffo_subscription_cancellation_receipts
        SET status = 'completed',
            completed_at = now(),
            lease_expires_at = NULL,
            claim_token = NULL,
            last_error_code = NULL,
            updated_at = now()
        WHERE subscription_id = ${subscriptionId}
          AND period_starts_at = ${periodStartsAt}
          AND status = 'processing'
          AND claim_token = ${claimToken}
        RETURNING subscription_id
      `);
      if (!completed.length) {
        throw Object.assign(
          new Error('Waffo cancellation checkpoint lease was lost.'),
          { code: 'WAFFO_CANCELLATION_LEASE_LOST' }
        );
      }
    } catch (error) {
      await this.db.execute(sql`
        UPDATE waffo_subscription_cancellation_receipts
        SET status = 'pending',
            available_at = now() + LEAST(
              interval '1 hour',
              interval '30 seconds' * POWER(2, LEAST(attempt_count, 7))
            ),
            lease_expires_at = NULL,
            claim_token = NULL,
            last_error_code = ${safeWaffoErrorCode(error)},
            updated_at = now()
        WHERE subscription_id = ${subscriptionId}
          AND period_starts_at = ${periodStartsAt}
          AND status = 'processing'
          AND claim_token = ${claimToken}
      `);
      throw error;
    }
  }

  async createOwnerBinding(input: {
    interval?: PlanInterval | 'lifetime' | null;
    ownerUserId: string;
    paymentType: PaymentType;
    priceId: string;
    provider: PaymentProviderName;
    workspaceId: string;
    replacesSubscriptionId?: string | null;
  }) {
    const id = `pcb_${crypto.randomUUID()}`;
    const rows = await this.db.execute<IdentifierRow>(sql`
      INSERT INTO plan_checkout_bindings
        (id, provider, price_id, payment_type, interval,
         workspace_id, owner_user_id, replaces_subscription_id,
         status, created_at, updated_at)
      SELECT
        ${id}, ${input.provider}, ${input.priceId}, ${input.paymentType},
        ${input.interval ?? null}, ${input.workspaceId}, ${input.ownerUserId},
        ${input.replacesSubscriptionId ?? null}, 'pending', now(), now()
      FROM workspace_memberships
      WHERE workspace_memberships.workspace_id = ${input.workspaceId}
        AND workspace_memberships.user_id = ${input.ownerUserId}
        AND workspace_memberships.role = 'owner'
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return rows[0] ?? null;
  }

  /**
   * Abandoned hosted checkouts leave in-flight bindings behind; the unique
   * in-flight index would otherwise lock the owner out of checkout forever.
   * A settled binding is untouched — settlement resolves bindings regardless
   * of a 'failed' status, so a very late completion still lands.
   */
  async releaseStaleWaffoBindings(input: {
    ownerUserId: string;
    workspaceId: string;
  }) {
    await this.db.execute(sql`
      UPDATE plan_checkout_bindings
      SET status = 'failed', updated_at = now()
      WHERE provider = 'waffo'
        AND owner_user_id = ${input.ownerUserId}
        AND workspace_id = ${input.workspaceId}
        AND status IN ('pending', 'checkout_created')
        AND updated_at < now() - interval '1 hour'
    `);
  }

  async hasPendingWaffoBinding(input: {
    ownerUserId: string;
    priceId: string;
    interval: PlanInterval | null;
    workspaceId: string;
    replacesSubscriptionId?: string | null;
  }) {
    const rows = await this.db.execute<IdentifierRow>(sql`
      SELECT id
      FROM plan_checkout_bindings
      WHERE provider = 'waffo'
        AND owner_user_id = ${input.ownerUserId}
        AND workspace_id = ${input.workspaceId}
        AND price_id = ${input.priceId}
        AND interval IS NOT DISTINCT FROM ${input.interval}
        AND replaces_subscription_id IS NOT DISTINCT FROM
          ${input.replacesSubscriptionId ?? null}
        AND status IN ('pending', 'checkout_created')
        -- An abandoned hosted-checkout binding must not lock the price
        -- forever; only a fresh in-flight attempt blocks a duplicate.
        AND updated_at > now() - interval '1 hour'
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    return Boolean(rows[0]);
  }

  async findCurrentWaffoSubscription(input: {
    ownerUserId: string;
    workspaceId: string;
  }): Promise<WaffoSubscriptionSnapshot | null> {
    const rows = await this.db.execute<{
      subscriptionId: string;
      priceId: string;
      interval: PlanInterval | null;
      status: 'active' | 'past_due' | 'trialing';
      periodEnd: Date | string | null;
      cancelAtPeriodEnd: boolean | null;
    }>(sql`
      SELECT payment.subscription_id AS "subscriptionId",
             payment.price_id AS "priceId",
             payment.interval AS "interval",
             payment.status AS "status",
             payment.period_end AS "periodEnd",
             payment.cancel_at_period_end AS "cancelAtPeriodEnd"
      FROM payment
      INNER JOIN plan_checkout_bindings AS binding
        ON (
          binding.subscription_id = payment.subscription_id
          OR binding.provider_checkout_id = payment.session_id
        )
      WHERE payment.provider = 'waffo'
        AND payment.subscription_id IS NOT NULL
        AND payment.user_id = ${input.ownerUserId}
        AND binding.owner_user_id = ${input.ownerUserId}
        AND binding.workspace_id = ${input.workspaceId}
        AND binding.provider = 'waffo'
        AND binding.status IN ('checkout_created', 'active')
        AND payment.status IN ('active', 'past_due', 'trialing')
        -- A subscription already cancelling at period end is not the current
        -- plan for change classification; treating it as current would turn
        -- the next checkout into a second "upgrade" against a dying order.
        AND payment.cancel_at_period_end IS NOT TRUE
      ORDER BY payment.updated_at DESC
      LIMIT 1
    `);
    const row = rows[0];
    if (!row?.subscriptionId) return null;
    return {
      subscriptionId: row.subscriptionId,
      priceId: row.priceId,
      interval: row.interval ?? null,
      status: row.status,
      periodEnd: row.periodEnd ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    };
  }

  async recordWaffoSubscriptionChange(input: {
    ownerUserId: string;
    subscriptionId: string;
    targetPriceId: string;
    targetInterval: PlanInterval;
    workspaceId: string;
    effectiveAt: string;
  }) {
    const rows = await this.db.execute<{
      status: 'pending' | 'applied' | 'canceled';
    }>(sql`
      INSERT INTO waffo_subscription_changes
        (subscription_id, workspace_id, owner_user_id, target_price_id,
         target_interval, effective_at, status, created_at, updated_at)
      VALUES
        (${input.subscriptionId}, ${input.workspaceId}, ${input.ownerUserId},
         ${input.targetPriceId}, ${input.targetInterval}, ${input.effectiveAt},
         'pending', now(), now())
      ON CONFLICT (subscription_id) DO UPDATE
      SET target_price_id = EXCLUDED.target_price_id,
          target_interval = EXCLUDED.target_interval,
          effective_at = EXCLUDED.effective_at,
          status = 'pending',
          updated_at = now()
      WHERE waffo_subscription_changes.workspace_id = EXCLUDED.workspace_id
        AND waffo_subscription_changes.owner_user_id = EXCLUDED.owner_user_id
        -- An applied change is an executed fact; a new request must not
        -- rewrite its target in place and masquerade as already done.
        AND waffo_subscription_changes.status <> 'applied'
      RETURNING status
    `);
    if (rows[0]) return rows[0].status;
    const existing = await this.db.execute<{
      status: 'pending' | 'applied' | 'canceled';
      workspaceId: string;
    }>(sql`
      SELECT status, workspace_id AS "workspaceId"
      FROM waffo_subscription_changes
      WHERE subscription_id = ${input.subscriptionId}
      LIMIT 1
    `);
    if (existing[0]?.workspaceId === input.workspaceId) {
      return existing[0].status;
    }
    throw new Error('Waffo subscription change belongs to another workspace.');
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
          payment.subscription_id AS "subscriptionId",
          binding.replaces_subscription_id AS "replacesSubscriptionId"
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
          AND (
            payment.provider IS NULL
            OR payment.provider = ${event.provider}
          )
        WHERE binding.provider = ${event.provider}
          AND (
            ${event.planBindingId ?? null}::text IS NULL
            OR binding.id = ${event.planBindingId ?? null}
          )
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
          COALESCE(payment.subscription_id, binding.subscription_id) AS "subscriptionId",
          binding.replaces_subscription_id AS "replacesSubscriptionId"
        FROM plan_checkout_bindings AS binding
        LEFT JOIN payment
          ON payment.subscription_id = ${event.reference.id}
          AND payment.user_id = binding.owner_user_id
          AND (
            payment.provider IS NULL
            OR payment.provider = ${event.provider}
          )
        WHERE binding.provider = ${event.provider}
          AND (
            ${event.planBindingId ?? null}::text IS NULL
            OR binding.id = ${event.planBindingId ?? null}
          )
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
          AND (
            binding.status IN ('checkout_created', 'active', 'canceled')
            OR (
              binding.id = ${event.planBindingId ?? null}
              AND binding.status = 'pending'
            )
          )
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
          payment.subscription_id AS "subscriptionId",
          binding.replaces_subscription_id AS "replacesSubscriptionId"
        FROM payment
        INNER JOIN plan_checkout_bindings AS binding
          ON (
            binding.subscription_id = payment.subscription_id
            OR binding.provider_checkout_id = payment.session_id
          )
          AND binding.owner_user_id = payment.user_id
          AND binding.provider = ${event.provider}
          AND (
            payment.provider IS NULL
            OR payment.provider = ${event.provider}
          )
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
      const rows = await this.db.execute<IdentifierRow>(sql`
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
        RETURNING id
      `);
      if (!rows[0]) {
        throw new Error('Plan checkout binding was not activated.');
      }
    } else if (input.providerCheckoutId) {
      const rows = await this.db.execute<IdentifierRow>(sql`
        UPDATE plan_checkout_bindings
        SET status = 'active',
            subscription_id = COALESCE(${input.subscriptionId ?? null}, subscription_id),
            updated_at = now()
        WHERE provider = ${input.provider}
          AND provider_checkout_id = ${input.providerCheckoutId}
        RETURNING id
      `);
      if (!rows[0]) {
        throw new Error('Plan checkout binding was not activated.');
      }
    } else if (input.subscriptionId) {
      const rows = await this.db.execute<IdentifierRow>(sql`
        UPDATE plan_checkout_bindings AS binding
        SET status = 'active',
            subscription_id = ${input.subscriptionId},
            updated_at = now()
        FROM payment
        WHERE binding.provider = ${input.provider}
          AND payment.subscription_id = ${input.subscriptionId}
          AND payment.provider = ${input.provider}
          AND payment.user_id = binding.owner_user_id
          AND (
            binding.subscription_id = ${input.subscriptionId}
            OR payment.session_id = binding.provider_checkout_id
          )
        RETURNING binding.id
      `);
      if (!rows[0]) {
        throw new Error('Plan checkout binding was not activated.');
      }
    } else {
      throw new Error(
        'Plan checkout binding activation requires a provider reference.'
      );
    }
  }

  async upsertWaffoSubscriptionPayment(input: {
    event: VerifiedPaymentWebhookEvent;
    intent: PlanSettlementIntent;
  }): Promise<WaffoSubscriptionPaymentMutation> {
    const subscriptionId = input.intent.subscriptionId?.trim();
    if (!subscriptionId) {
      throw new Error('Waffo subscription settlement requires subscriptionId.');
    }
    const paymentId = `waffo:${subscriptionId}`;
    const customerId =
      input.event.buyerIdentity?.trim() || input.intent.ownerUserId;
    const status = waffoPaymentStatus(input.intent.lifecycle);
    // A past-due subscription retains the already-paid period and its
    // entitlement. The status changes, but the payment remains paid for the
    // current-plan read model.
    const paid = true;
    const cancelAtPeriodEnd = waffoCancelAtPeriodEnd(input.intent.lifecycle);
    const insertCancelAtPeriodEnd = cancelAtPeriodEnd ?? false;
    const eventId = input.event.providerEventId.trim();
    const providerOccurredAt = input.event.providerOccurredAt?.trim() || null;
    if (
      providerOccurredAt !== null &&
      !Number.isFinite(Date.parse(providerOccurredAt))
    ) {
      throw new Error('Waffo provider occurrence time must be valid.');
    }
    const eventRank = waffoLifecycleRank(input.event, input.intent);
    const periodStartsAt = input.intent.periodStartsAt;

    const existing = await this.db.execute<WaffoPaymentRow>(sql`
      SELECT provider,
             user_id AS "userId",
             status,
             paid,
             cancel_at_period_end AS "cancelAtPeriodEnd",
             period_start AS "periodStart",
             period_end AS "periodEnd",
             waffo_provider_occurred_at AS "providerOccurredAt",
             waffo_event_id AS "eventId",
             waffo_event_rank AS "eventRank"
      FROM payment
      WHERE subscription_id = ${subscriptionId}
      LIMIT 1
    `);
    const current = existing[0];
    if (current) {
      if (current.provider !== null && current.provider !== 'waffo') {
        throw new Error(
          'Waffo subscription payment belongs to another owner or provider.'
        );
      }
      if (current.userId !== input.intent.ownerUserId) {
        throw new Error(
          'Waffo subscription payment belongs to another owner or provider.'
        );
      }
      const order = compareWaffoPaymentOrder(
        {
          eventId,
          eventRank,
          periodStartsAt,
          providerOccurredAt,
        },
        current
      );
      if (order === 'duplicate' || order === 'ignored_stale') return order;
    }

    const rows = await this.db.execute<IdentifierRow>(sql`
      INSERT INTO payment (
        id, provider, price_id, user_id, customer_id, subscription_id,
        type, scene, interval, status, paid, period_start, period_end,
        cancel_at_period_end, waffo_provider_occurred_at, waffo_event_id,
        waffo_event_rank, created_at, updated_at
      )
      VALUES (
        ${paymentId}, 'waffo', ${input.intent.priceId},
        ${input.intent.ownerUserId}, ${customerId}, ${subscriptionId},
        'subscription', 'subscription', ${input.intent.interval}, ${status},
        ${paid}, ${periodStartsAt}, ${input.intent.periodEndsAt},
        ${insertCancelAtPeriodEnd}, ${providerOccurredAt}, ${eventId},
        ${eventRank}, now(), now()
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
          cancel_at_period_end = CASE
            WHEN ${cancelAtPeriodEnd}::boolean IS NULL
              THEN payment.cancel_at_period_end
            ELSE EXCLUDED.cancel_at_period_end
          END,
          waffo_provider_occurred_at = EXCLUDED.waffo_provider_occurred_at,
          waffo_event_id = EXCLUDED.waffo_event_id,
          waffo_event_rank = EXCLUDED.waffo_event_rank,
          updated_at = now()
      WHERE (payment.provider IS NULL OR payment.provider = 'waffo')
        AND payment.user_id = EXCLUDED.user_id
        AND (
          COALESCE(
            EXCLUDED.waffo_provider_occurred_at,
            EXCLUDED.period_start,
            '-infinity'::timestamptz
          ) > COALESCE(
            payment.waffo_provider_occurred_at,
            payment.period_start,
            '-infinity'::timestamptz
          )
          OR (
            COALESCE(
              EXCLUDED.waffo_provider_occurred_at,
              EXCLUDED.period_start,
              '-infinity'::timestamptz
            ) = COALESCE(
              payment.waffo_provider_occurred_at,
              payment.period_start,
              '-infinity'::timestamptz
            )
            AND COALESCE(EXCLUDED.waffo_event_rank, 0) >
              COALESCE(payment.waffo_event_rank, 0)
          )
        )
      RETURNING id
    `);
    if (rows[0]) return 'applied';

    const raced = await this.db.execute<WaffoPaymentRow>(sql`
      SELECT provider,
             user_id AS "userId",
             status,
             paid,
             cancel_at_period_end AS "cancelAtPeriodEnd",
             period_start AS "periodStart",
             period_end AS "periodEnd",
             waffo_provider_occurred_at AS "providerOccurredAt",
             waffo_event_id AS "eventId",
             waffo_event_rank AS "eventRank"
      FROM payment
      WHERE subscription_id = ${subscriptionId}
      LIMIT 1
    `);
    if (!raced[0]) {
      throw Object.assign(
        new Error('Waffo subscription payment upsert was lost.'),
        { code: 'WAFFO_PAYMENT_UPSERT_LOST' }
      );
    }
    if (raced[0].provider !== null && raced[0].provider !== 'waffo') {
      throw new Error(
        'Waffo subscription payment belongs to another owner or provider.'
      );
    }
    if (raced[0].userId !== input.intent.ownerUserId) {
      throw new Error(
        'Waffo subscription payment belongs to another owner or provider.'
      );
    }
    return compareWaffoPaymentOrder(
      { eventId, eventRank, periodStartsAt, providerOccurredAt },
      raced[0]
    );
  }

  async classifyWaffoSubscriptionPayment(input: {
    event: VerifiedPaymentWebhookEvent;
    intent: PlanSettlementIntent;
  }): Promise<WaffoSubscriptionPaymentMutation> {
    const subscriptionId = input.intent.subscriptionId?.trim();
    if (!subscriptionId) {
      throw new Error('Waffo subscription settlement requires subscriptionId.');
    }
    const rows = await this.db.execute<WaffoPaymentRow>(sql`
      SELECT provider,
             user_id AS "userId",
             status,
             paid,
             cancel_at_period_end AS "cancelAtPeriodEnd",
             period_start AS "periodStart",
             period_end AS "periodEnd",
             waffo_provider_occurred_at AS "providerOccurredAt",
             waffo_event_id AS "eventId",
             waffo_event_rank AS "eventRank"
      FROM payment
      WHERE subscription_id = ${subscriptionId}
      LIMIT 1
    `);
    const current = rows[0];
    if (!current) return 'applied';
    if (current.provider !== null && current.provider !== 'waffo') {
      throw new Error(
        'Waffo subscription payment belongs to another owner or provider.'
      );
    }
    if (current.userId !== input.intent.ownerUserId) {
      throw new Error(
        'Waffo subscription payment belongs to another owner or provider.'
      );
    }
    return compareWaffoPaymentOrder(
      {
        eventId: input.event.providerEventId.trim(),
        eventRank: waffoLifecycleRank(input.event, input.intent),
        periodStartsAt: input.intent.periodStartsAt,
        providerOccurredAt: input.event.providerOccurredAt?.trim() || null,
      },
      current
    );
  }

  async markCanceled(input: {
    provider: PaymentProviderName;
    subscriptionId: string;
  }) {
    const rows = await this.db.execute<IdentifierRow>(sql`
      UPDATE plan_checkout_bindings AS binding
      SET status = 'canceled', updated_at = now()
      WHERE binding.provider = ${input.provider}
        AND (
          ${input.provider} <> 'waffo'
          OR EXISTS (
            SELECT 1
            FROM payment AS current_payment
            WHERE current_payment.subscription_id = ${input.subscriptionId}
              AND current_payment.provider = 'waffo'
              AND current_payment.status = 'canceled'
          )
        )
        AND (
          binding.subscription_id = ${input.subscriptionId}
          OR EXISTS (
            SELECT 1
            FROM payment
            WHERE payment.subscription_id = ${input.subscriptionId}
              AND payment.provider = ${input.provider}
              AND payment.user_id = binding.owner_user_id
              AND payment.session_id = binding.provider_checkout_id
          )
        )
      RETURNING binding.id
    `);
    if (rows[0]) return;

    // A stale Waffo terminal delivery is intentionally a no-op when the
    // durable payment row is still active. Unknown targets remain errors so
    // callers cannot silently acknowledge a broken binding.
    if (input.provider === 'waffo') {
      const activePayment = await this.db.execute<IdentifierRow>(sql`
        SELECT id
        FROM payment
        WHERE provider = 'waffo'
          AND subscription_id = ${input.subscriptionId}
          AND status = 'active'
        LIMIT 1
      `);
      if (activePayment[0]) return;
    }
    throw new Error('Plan checkout binding was not canceled.');
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
    ...(row.replacesSubscriptionId
      ? { replacesSubscriptionId: row.replacesSubscriptionId }
      : {}),
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

function waffoPaymentStatus(
  lifecycle: PlanSettlementIntent['lifecycle']
): 'active' | 'past_due' | 'canceled' {
  if (lifecycle === 'past_due') return 'past_due';
  if (lifecycle === 'expire') return 'canceled';
  return 'active';
}

function waffoCancelAtPeriodEnd(
  lifecycle: PlanSettlementIntent['lifecycle']
): boolean | null {
  if (lifecycle === 'cancel_at_period_end') return true;
  if (lifecycle === 'uncancel_at_period_end' || lifecycle === 'expire') {
    return false;
  }
  return null;
}

export function waffoLifecycleRank(
  event: VerifiedPaymentWebhookEvent,
  intent: PlanSettlementIntent
): number {
  switch (intent.lifecycle) {
    case 'activate':
      return 10;
    case 'renew':
      return 20;
    case 'past_due':
      return 30;
    case 'cancel_at_period_end':
      return 40;
    case 'uncancel_at_period_end':
      return 50;
    case 'expire':
      return 60;
    default:
      return event.eventType === 'subscription.renewed' ? 20 : 0;
  }
}

export function compareWaffoPaymentOrder(
  incoming: {
    eventId: string;
    eventRank: number;
    periodStartsAt: string | null;
    providerOccurredAt: string | null;
  },
  existing: Pick<
    WaffoPaymentRow,
    'eventId' | 'eventRank' | 'periodStart' | 'providerOccurredAt'
  >
): WaffoSubscriptionPaymentMutation {
  if (incoming.eventId && incoming.eventId === existing.eventId) {
    return 'duplicate';
  }
  const incomingOccurredAt = orderTimestamp(
    incoming.providerOccurredAt,
    incoming.periodStartsAt
  );
  const existingOccurredAt = orderTimestamp(
    existing.providerOccurredAt,
    existing.periodStart
  );
  if (incomingOccurredAt > existingOccurredAt) return 'applied';
  if (incomingOccurredAt < existingOccurredAt) return 'ignored_stale';
  const existingRank = existing.eventRank ?? 0;
  if (incoming.eventRank > existingRank) return 'applied';
  return 'ignored_stale';
}

function orderTimestamp(
  occurredAt: string | Date | null,
  fallback: string | Date | null
): number {
  const value = occurredAt ?? fallback;
  if (!value) return Number.MIN_SAFE_INTEGER;
  const timestamp = Date.parse(
    value instanceof Date ? value.toISOString() : value
  );
  return Number.isFinite(timestamp) ? timestamp : Number.MIN_SAFE_INTEGER;
}

function safeWaffoErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,80}$/u.test(error.code)
  ) {
    return error.code;
  }
  return 'WAFFO_CANCELLATION_FAILED';
}

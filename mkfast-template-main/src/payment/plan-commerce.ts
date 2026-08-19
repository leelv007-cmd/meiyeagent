/**
 * Tc-1/Tc-2: plan entitlement settlement from verified payment webhooks.
 *
 * Pro Studio uses a dedicated claim table; plan checkout binds workspace via
 * checkout metadata.workspaceId (required for multi-workspace safety).
 * Settlement is pure intent + side-effect ports so unit tests stay free of PG.
 */

import type {
  PaymentProviderName,
  PlanInterval,
  VerifiedPaymentWebhookEvent,
} from './types';

export type PlanSettlementLifecycle =
  | 'activate'
  | 'renew'
  | 'resume'
  | 'uncancel_at_period_end'
  | 'past_due'
  | 'cancel_at_period_end'
  | 'expire';

export interface PlanSettlementIntent {
  lifecycle: PlanSettlementLifecycle;
  paymentEventId: string;
  provider: PaymentProviderName;
  providerEventId: string;
  providerOccurredAt?: string;
  workspaceId: string;
  ownerUserId: string;
  priceId: string;
  interval: PlanInterval | 'lifetime' | 'one_time' | null;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  subscriptionId: string | null;
  /** Existing Waffo subscription to cancel once an upgrade activates. */
  replacesSubscriptionId?: string | null;
  /** Cancel keeps access until periodEndsAt (end-of-period fall back). */
  cancelAtPeriodEnd?: boolean;
}

export interface PlanCheckoutBindingFacts {
  workspaceId: string;
  ownerUserId: string;
  priceId: string;
  interval?: PlanInterval | 'lifetime' | 'one_time' | null;
  periodStartsAt?: string | Date | null;
  periodEndsAt?: string | Date | null;
  subscriptionId?: string | null;
  cancelAtPeriodEnd?: boolean;
  replacesSubscriptionId?: string | null;
  commerceAuthority?: {
    amountMicros: number;
    billingPeriod: 'monthly' | 'yearly';
    currency: 'HKD';
    paymentMappingRevision: number;
    period: 'single_month' | 'monthly' | 'yearly';
    planRevision: string;
    tier: 'starter' | 'growth' | 'pro';
  };
}

export type WaffoPlanChangeDecision =
  | 'new_checkout'
  | 'upgrade'
  | 'defer_next_cycle'
  | 'duplicate';

export class WaffoNextCycleChangeUnavailableError extends Error {
  readonly code = 'WAFFO_NEXT_CYCLE_CHANGE_UNAVAILABLE' as const;

  constructor() {
    super(
      'Waffo cannot apply a downgrade or interval change at the next cycle yet.'
    );
    this.name = 'WaffoNextCycleChangeUnavailableError';
  }
}

export class WaffoCheckoutAlreadyActiveError extends Error {
  readonly code = 'WAFFO_CHECKOUT_ALREADY_ACTIVE' as const;

  constructor() {
    super(
      'A Waffo subscription for this workspace and plan is already active.'
    );
    this.name = 'WaffoCheckoutAlreadyActiveError';
  }
}

/**
 * Waffo 0.16.1 exposes no safe next-cycle mutation primitive in this
 * integration. Keep the decision pure so the HTTP boundary can fail closed
 * before creating a second subscription.
 */
export function classifyWaffoPlanChange(input: {
  current?: {
    planId: string;
    interval: PlanInterval | null;
  } | null;
  requested: {
    planId: string;
    interval: PlanInterval | null;
  };
}): WaffoPlanChangeDecision {
  if (!input.current) return 'new_checkout';
  if (
    input.current.planId === input.requested.planId &&
    canonicalWaffoInterval(input.current.interval) ===
      canonicalWaffoInterval(input.requested.interval)
  ) {
    return 'duplicate';
  }
  return waffoPlanTierRank(input.requested.planId) >
    waffoPlanTierRank(input.current.planId)
    ? 'upgrade'
    : 'defer_next_cycle';
}

export function canonicalWaffoInterval(
  interval: PlanInterval | null | undefined
): 'single_month' | 'monthly' | 'yearly' | null {
  if (interval === 'month') return 'monthly';
  if (interval === 'year') return 'yearly';
  if (
    interval === 'single_month' ||
    interval === 'monthly' ||
    interval === 'yearly'
  ) {
    return interval;
  }
  return null;
}

function waffoPlanTierRank(planId: string) {
  switch (planId.trim().toLowerCase()) {
    case 'starter':
      return 1;
    case 'growth':
      return 2;
    case 'pro':
      return 3;
    default:
      return 0;
  }
}

export interface PlanSettlementPorts {
  /**
   * Resolve workspace binding + price facts for a verified payment event.
   * Return null when the event is not a plan payment (e.g. Pro Studio add-on).
   */
  resolveBinding(
    event: VerifiedPaymentWebhookEvent
  ): Promise<PlanCheckoutBindingFacts | null>;
  /** Call core entitlements.payment_grant (Foundation commerce truth). */
  grantPlan(intent: PlanSettlementIntent): Promise<void>;
}

/**
 * Build the public Core command without resolving a tier in the web shell.
 * `plan.payment-mapping` is hot-read by Core at settlement time.
 */
export function planGrantCommandFromIntent(intent: PlanSettlementIntent) {
  return {
    module: 'entitlements' as const,
    action: 'payment_grant' as const,
    payload: {
      lifecycle: intent.lifecycle,
      paymentEventId: intent.paymentEventId,
      paymentProductId: intent.priceId,
      ...(intent.provider === 'waffo'
        ? { paymentProvider: 'waffo' as const }
        : {}),
      interval: intent.interval,
      subscriptionId: intent.subscriptionId,
      periodStartsAt: intent.periodStartsAt,
      periodEndsAt: intent.periodEndsAt,
      cancelAtPeriodEnd: intent.cancelAtPeriodEnd === true,
      ...(intent.providerOccurredAt
        ? { providerOccurredAt: intent.providerOccurredAt }
        : {}),
    },
  };
}

/** Only a terminal subscription expiry retires its durable checkout binding. */
export function shouldCancelPlanBinding(
  intent: PlanSettlementIntent,
  reference: VerifiedPaymentWebhookEvent['reference']
) {
  return intent.lifecycle === 'expire' && reference.kind === 'subscription';
}

/**
 * Map a verified webhook event + binding facts into a settlement intent.
 * Returns null when the event should not drive plan entitlement changes.
 */
export function planSettlementIntentFromEvent(
  event: VerifiedPaymentWebhookEvent,
  binding: PlanCheckoutBindingFacts
): PlanSettlementIntent | null {
  const workspaceId = binding.workspaceId.trim();
  const ownerUserId = binding.ownerUserId.trim();
  const priceId = binding.priceId.trim();
  if (!workspaceId || !ownerUserId || !priceId) return null;

  const lifecycle = lifecycleFromEvent(event);
  if (!lifecycle) return null;

  const subscriptionId =
    binding.subscriptionId?.trim() ||
    (event.reference.kind === 'subscription'
      ? event.reference.id.trim() || null
      : null);
  if (
    !subscriptionId &&
    binding.interval !== 'lifetime' &&
    binding.interval !== 'one_time'
  ) {
    return null;
  }

  const periodStartsAt = toIso(binding.periodStartsAt);
  const periodEndsAt = toIso(binding.periodEndsAt);
  if (
    event.provider === 'waffo' &&
    (lifecycle === 'activate' || lifecycle === 'renew') &&
    (!periodStartsAt || !periodEndsAt)
  ) {
    return null;
  }
  const paymentEventId = paymentSettlementEventId(event);
  if (!paymentEventId) return null;

  return {
    lifecycle,
    paymentEventId,
    provider: event.provider,
    providerEventId: event.providerEventId,
    ...(event.providerOccurredAt
      ? { providerOccurredAt: event.providerOccurredAt }
      : {}),
    workspaceId,
    ownerUserId,
    priceId,
    interval: binding.interval ?? null,
    periodStartsAt,
    periodEndsAt,
    subscriptionId,
    ...(binding.replacesSubscriptionId
      ? { replacesSubscriptionId: binding.replacesSubscriptionId }
      : {}),
    ...(event.eventType === 'customer.subscription.updated'
      ? { cancelAtPeriodEnd: true }
      : binding.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: binding.cancelAtPeriodEnd }
        : {}),
  };
}

function paymentSettlementEventId(event: VerifiedPaymentWebhookEvent) {
  const providerEventId = event.providerEventId.trim();
  return providerEventId ? `${event.provider}:${providerEventId}` : null;
}

function lifecycleFromEvent(
  event: VerifiedPaymentWebhookEvent
): PlanSettlementLifecycle | null {
  switch (event.eventType) {
    case 'checkout.completed':
    case 'checkout.session.completed':
      return 'activate';
    case 'invoice.paid':
    case 'subscription.renewed':
      return 'renew';
    case 'subscription.past_due':
      return 'past_due';
    case 'customer.subscription.resumed':
    case 'subscription.uncanceled':
      return 'uncancel_at_period_end';
    case 'customer.subscription.updated':
      // Cancel-at-period-end is expressed on the binding facts.
      return 'cancel_at_period_end';
    case 'customer.subscription.deleted':
    case 'subscription.expired':
      return 'expire';
    default:
      return null;
  }
}

/**
 * Settle a verified payment event into Foundation plan entitlement.
 * Core receipts deduplicate paymentEventId replays; paid-period uniqueness
 * separately prevents two provider payment IDs from granting one cycle twice.
 */
export async function settleVerifiedPlanPayment(
  event: VerifiedPaymentWebhookEvent,
  ports: PlanSettlementPorts
): Promise<PlanSettlementIntent | null> {
  // Pro Studio one-time claims use checkout reference only; plan path also
  // accepts subscription lifecycle events with subscription references.
  const binding = await ports.resolveBinding(event);
  if (!binding) return null;
  const intent = planSettlementIntentFromEvent(event, binding);
  if (!intent) return null;

  // Cancel = end-of-period fall back: keep paid tier until periodEndsAt.
  // We still notify core so periodEndsAt is authoritative; no immediate
  // downgrade grant is issued here.
  await ports.grantPlan(intent);
  return intent;
}

/**
 * Require workspaceId on checkout metadata for multi-workspace safety.
 * Callers should attach the active owner workspace before createCheckout.
 */
export function requireCheckoutWorkspaceBinding(metadata: {
  userId?: string;
  workspaceId?: string;
}): { userId: string; workspaceId: string } {
  const userId = metadata.userId?.trim() ?? '';
  const workspaceId = metadata.workspaceId?.trim() ?? '';
  if (!userId) {
    throw new Error('Checkout metadata.userId is required.');
  }
  if (!workspaceId) {
    throw new Error(
      'Checkout metadata.workspaceId is required for plan entitlement binding.'
    );
  }
  return { userId, workspaceId };
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

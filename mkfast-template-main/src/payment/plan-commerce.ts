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
  | 'cancel_at_period_end'
  | 'expire';

export interface PlanSettlementIntent {
  lifecycle: PlanSettlementLifecycle;
  paymentEventId: string;
  provider: PaymentProviderName;
  providerEventId: string;
  workspaceId: string;
  ownerUserId: string;
  priceId: string;
  interval: PlanInterval | 'lifetime' | 'one_time' | null;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  subscriptionId: string | null;
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
  const paymentEventId = paymentSettlementEventId({
    event,
    lifecycle,
    periodEndsAt,
    periodStartsAt,
    subscriptionId,
  });
  if (!paymentEventId) return null;

  return {
    lifecycle,
    paymentEventId,
    provider: event.provider,
    providerEventId: event.providerEventId,
    workspaceId,
    ownerUserId,
    priceId,
    interval: binding.interval ?? null,
    periodStartsAt,
    periodEndsAt,
    subscriptionId,
    ...(binding.cancelAtPeriodEnd !== undefined
      ? { cancelAtPeriodEnd: binding.cancelAtPeriodEnd }
      : {}),
  };
}

function paymentSettlementEventId(input: {
  event: VerifiedPaymentWebhookEvent;
  lifecycle: PlanSettlementLifecycle;
  periodEndsAt: string | null;
  periodStartsAt: string | null;
  subscriptionId: string | null;
}) {
  const { event, lifecycle, periodEndsAt, periodStartsAt, subscriptionId } =
    input;
  if (
    event.provider === 'waffo' &&
    (lifecycle === 'activate' || lifecycle === 'renew')
  ) {
    if (!subscriptionId || !periodStartsAt || !periodEndsAt) return null;
    return `waffo:subscription:${subscriptionId}:${periodStartsAt}:${periodEndsAt}`;
  }
  return `${event.provider}:${event.providerEventId}`;
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
    case 'customer.subscription.resumed':
      return 'resume';
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
 * Idempotency is owned by core paymentEventId uniqueness.
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

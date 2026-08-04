import * as z from 'zod';
import type { VerifiedPaymentWebhookEvent } from './types';

const stripeExpandableIdSchema = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1) }).passthrough(),
]);

const stripeCheckoutSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('checkout.session.completed'),
    data: z.object({
      object: z
        .object({
          id: z.string().min(1),
          mode: z.enum(['payment', 'subscription']),
          payment_status: z.literal('paid'),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    }),
  })
  .passthrough();

const stripeInvoicePaidSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('invoice.paid'),
    data: z.object({
      object: z
        .object({
          id: z.string().min(1),
          // checkout already activates the initial subscription period. Only
          // the provider's recurring-cycle invoice is a renewal grant.
          billing_reason: z.literal('subscription_cycle'),
          subscription: stripeExpandableIdSchema.optional(),
          parent: z
            .object({
              subscription_details: z
                .object({ subscription: stripeExpandableIdSchema })
                .passthrough(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    }),
  })
  .passthrough();

const stripeSubscriptionUpdatedSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('customer.subscription.updated'),
    data: z.object({
      object: z
        .object({
          id: z.string().min(1),
          status: z.string().min(1),
          cancel_at_period_end: z.boolean().optional(),
        })
        .passthrough(),
      previous_attributes: z
        .object({ cancel_at_period_end: z.boolean().optional() })
        .passthrough()
        .optional(),
    }),
  })
  .passthrough();

const stripeSubscriptionDeletedSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('customer.subscription.deleted'),
    data: z.object({
      object: z.object({ id: z.string().min(1) }).passthrough(),
    }),
  })
  .passthrough();

const RECOGNIZED_WAFFO_EVENT_TYPES = [
  'order.completed',
  'refund.succeeded',
  'refund.failed',
  'subscription.activated',
  'subscription.payment_succeeded',
  'subscription.past_due',
  'subscription.canceling',
  'subscription.uncanceled',
  'subscription.canceled',
] as const;

const waffoWebhookEventSchema = z
  .object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    // The provider occurrence time drives monotonic lifecycle fencing, so a
    // lifecycle event without one is a contract breach, not an optional gap.
    timestamp: z.string().min(1),
    eventType: z.enum(RECOGNIZED_WAFFO_EVENT_TYPES),
    data: z
      .object({
        orderId: z.string().min(1),
        merchantProvidedBuyerIdentity: z.string().min(1).optional(),
        orderMerchantExternalId: z.string().min(1).optional(),
        orderMetadata: z.record(z.string(), z.unknown()).optional(),
        amount: z.string().min(1).optional(),
        currency: z.string().min(1).optional(),
        currentPeriodStart: z.string().min(1).optional(),
        currentPeriodEnd: z.string().min(1).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export class WaffoPaymentEventContractError extends Error {
  readonly code = 'WAFFO_EVENT_CONTRACT_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WaffoPaymentEventContractError';
  }
}

function isRecognizedWaffoEventType(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const eventType = (input as { eventType?: unknown }).eventType;
  return (
    typeof eventType === 'string' &&
    (RECOGNIZED_WAFFO_EVENT_TYPES as readonly string[]).includes(eventType)
  );
}

/**
 * A complete billing period that fails to parse or is inverted is a contract
 * breach on paid lifecycle events. An absent or half-open period is left for
 * the Waffo provider adapter, which recovers the authoritative bounds from
 * the provider order record and fails closed retryable when it cannot.
 */
function assertWaffoPeriodContract(
  period: { periodStartsAt?: string; periodEndsAt?: string },
  eventType: (typeof RECOGNIZED_WAFFO_EVENT_TYPES)[number]
) {
  if (
    eventType !== 'subscription.activated' &&
    eventType !== 'subscription.payment_succeeded'
  ) {
    return;
  }
  if (!period.periodStartsAt || !period.periodEndsAt) return;
  const startsAt = Date.parse(period.periodStartsAt);
  const endsAt = Date.parse(period.periodEndsAt);
  if (
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    endsAt <= startsAt
  ) {
    throw new WaffoPaymentEventContractError(
      'Waffo paid lifecycle event has an invalid billing period.'
    );
  }
}

function assertWaffoPackageOrRefundContract(input: {
  amount: string | null;
  buyerIdentity: string | undefined;
  currency: string | null;
  orderMerchantExternalId: string | null;
  subject: 'one-time order' | 'refund';
}) {
  if (!input.orderMerchantExternalId) {
    throw new WaffoPaymentEventContractError(
      `Waffo ${input.subject} is missing external order binding.`
    );
  }
  if (!input.buyerIdentity) {
    throw new WaffoPaymentEventContractError(
      `Waffo ${input.subject} is missing buyer identity.`
    );
  }
  if (!input.amount || !/^\d+(?:\.\d+)?$/u.test(input.amount)) {
    throw new WaffoPaymentEventContractError(
      `Waffo ${input.subject} has an invalid amount.`
    );
  }
  if (!input.currency || !/^[A-Z]{3}$/u.test(input.currency)) {
    throw new WaffoPaymentEventContractError(
      `Waffo ${input.subject} has an invalid currency.`
    );
  }
}

export function normalizeStripeVerifiedPaymentEvent(
  input: unknown
): VerifiedPaymentWebhookEvent | null {
  const checkout = stripeCheckoutSchema.safeParse(input);
  if (checkout.success) {
    const planBindingId = textMetadata(
      checkout.data.data.object.metadata?.planCheckoutBindingId
    );
    return {
      eventType: checkout.data.type,
      provider: 'stripe',
      providerEventId: checkout.data.id,
      reference: {
        id: checkout.data.data.object.id,
        kind: 'checkout',
      },
      ...(planBindingId ? { planBindingId } : {}),
    };
  }

  const invoice = stripeInvoicePaidSchema.safeParse(input);
  if (invoice.success) {
    const subscriptionId = expandableId(
      invoice.data.data.object.parent?.subscription_details.subscription ??
        invoice.data.data.object.subscription
    );
    if (!subscriptionId) return null;
    return {
      eventType: 'invoice.paid',
      provider: 'stripe',
      providerEventId: invoice.data.id,
      reference: {
        id: subscriptionId,
        kind: 'subscription',
      },
    };
  }

  const updated = stripeSubscriptionUpdatedSchema.safeParse(input);
  if (updated.success) {
    // Renewal is driven by invoice.paid. Only a scheduled cancellation, or an
    // explicit reversal of one, is an entitlement lifecycle event; ordinary
    // active updates must not shorten or re-grant the current period.
    const cancelAtPeriodEnd = updated.data.data.object.cancel_at_period_end;
    const resumed =
      cancelAtPeriodEnd === false &&
      updated.data.data.previous_attributes?.cancel_at_period_end === true;
    if (cancelAtPeriodEnd !== true && !resumed) return null;
    return {
      eventType: resumed
        ? 'customer.subscription.resumed'
        : 'customer.subscription.updated',
      provider: 'stripe',
      providerEventId: updated.data.id,
      reference: {
        id: updated.data.data.object.id,
        kind: 'subscription',
      },
    };
  }

  const deleted = stripeSubscriptionDeletedSchema.safeParse(input);
  if (deleted.success) {
    return {
      eventType: 'customer.subscription.deleted',
      provider: 'stripe',
      providerEventId: deleted.data.id,
      reference: {
        id: deleted.data.data.object.id,
        kind: 'subscription',
      },
    };
  }

  return null;
}

function expandableId(
  value: string | { id: string } | undefined
): string | null {
  if (typeof value === 'string') return value;
  return value?.id ?? null;
}

export function normalizeWaffoVerifiedPaymentEvent(
  input: unknown
): VerifiedPaymentWebhookEvent | null {
  const event = waffoWebhookEventSchema.safeParse(input);
  if (!event.success) {
    // A recognized lifecycle event that fails contract validation (empty
    // identity strings, missing envelope fields) must reach durable retry
    // instead of being silently completed as irrelevant.
    if (isRecognizedWaffoEventType(input)) {
      throw new WaffoPaymentEventContractError(
        'Waffo lifecycle event failed contract validation.'
      );
    }
    return null;
  }

  const planBindingId =
    event.data.data.orderMerchantExternalId ??
    textMetadata(event.data.data.orderMetadata?.planCheckoutBindingId);
  const buyerIdentity = event.data.data.merchantProvidedBuyerIdentity;
  const orderMerchantExternalId = textMetadata(
    event.data.data.orderMerchantExternalId
  );
  const amount = textMetadata(event.data.data.amount);
  const currency = textMetadata(event.data.data.currency);
  const period = {
    ...(event.data.data.currentPeriodStart
      ? { periodStartsAt: event.data.data.currentPeriodStart }
      : {}),
    ...(event.data.data.currentPeriodEnd
      ? { periodEndsAt: event.data.data.currentPeriodEnd }
      : {}),
  };
  const providerOccurredAt = event.data.timestamp;
  if (!Number.isFinite(Date.parse(providerOccurredAt))) {
    throw new WaffoPaymentEventContractError(
      'Waffo event timestamp must be a valid ISO timestamp.'
    );
  }

  if (event.data.eventType === 'order.completed') {
    assertWaffoPackageOrRefundContract({
      amount,
      buyerIdentity,
      currency,
      orderMerchantExternalId,
      subject: 'one-time order',
    });
    return {
      eventType: 'credit_package.completed',
      provider: 'waffo',
      providerEventId: event.data.eventId,
      providerDeliveryId: event.data.id,
      providerOccurredAt,
      reference: { id: event.data.data.orderId, kind: 'order' },
      scene: 'credit_package',
      packageCheckoutBindingId: orderMerchantExternalId!,
      buyerIdentity: buyerIdentity!,
      amount: amount!,
      currency: currency!,
    };
  }

  if (
    event.data.eventType === 'refund.succeeded' ||
    event.data.eventType === 'refund.failed'
  ) {
    assertWaffoPackageOrRefundContract({
      amount,
      buyerIdentity,
      currency,
      orderMerchantExternalId,
      subject: 'refund',
    });
    return {
      eventType: event.data.eventType,
      provider: 'waffo',
      providerEventId: `waffo:${event.data.eventType}:${event.data.eventId}`,
      providerDeliveryId: event.data.id,
      providerOccurredAt,
      reference: { id: event.data.data.orderId, kind: 'order' },
      scene: 'refund',
      orderMerchantExternalId: orderMerchantExternalId!,
      buyerIdentity: buyerIdentity!,
      amount: amount!,
      currency: currency!,
    };
  }

  assertWaffoPeriodContract(period, event.data.eventType);
  const base = {
    provider: 'waffo' as const,
    // Waffo's business event id drives Core settlement idempotency. Its
    // delivery id is retained separately for durable inbox deduplication.
    providerEventId: event.data.eventId,
    providerDeliveryId: event.data.id,
    reference: { id: event.data.data.orderId, kind: 'subscription' as const },
    ...(buyerIdentity ? { buyerIdentity } : {}),
    ...period,
    ...(providerOccurredAt ? { providerOccurredAt } : {}),
  };

  if (event.data.eventType === 'subscription.activated') {
    if (!planBindingId) {
      throw new WaffoPaymentEventContractError(
        'Waffo activation is missing plan binding identity.'
      );
    }
    if (!buyerIdentity) {
      throw new WaffoPaymentEventContractError(
        'Waffo activation is missing buyer identity.'
      );
    }
    return {
      eventType: 'checkout.completed',
      ...base,
      planBindingId,
    };
  }

  if (event.data.eventType === 'subscription.payment_succeeded') {
    return { eventType: 'subscription.renewed', ...base };
  }

  if (event.data.eventType === 'subscription.past_due') {
    return { eventType: 'subscription.past_due', ...base };
  }

  if (event.data.eventType === 'subscription.canceling') {
    return { eventType: 'customer.subscription.updated', ...base };
  }

  if (event.data.eventType === 'subscription.uncanceled') {
    return { eventType: 'subscription.uncanceled', ...base };
  }

  return { eventType: 'customer.subscription.deleted', ...base };
}

function textMetadata(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

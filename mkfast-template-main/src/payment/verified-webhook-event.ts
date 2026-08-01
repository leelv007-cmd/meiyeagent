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

const stripeInvoicePaymentFailedSchema = stripeInvoicePaidSchema.extend({
  type: z.literal('invoice.payment_failed'),
});

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

const creemCheckoutSchema = z
  .object({
    id: z.string().min(1),
    eventType: z.literal('checkout.completed'),
    object: z
      .object({
        id: z.string().min(1),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const creemSubscriptionPaidSchema = z
  .object({
    id: z.string().min(1),
    eventType: z.literal('subscription.paid'),
    object: z.object({ id: z.string().min(1) }).passthrough(),
  })
  .passthrough();

const creemSubscriptionCanceledSchema = z
  .object({
    id: z.string().min(1),
    eventType: z.enum(['subscription.canceled', 'subscription.expired']),
    object: z.object({ id: z.string().min(1) }).passthrough(),
  })
  .passthrough();

const creemSubscriptionScheduledCancelSchema = z
  .object({
    id: z.string().min(1),
    eventType: z.literal('subscription.scheduled_cancel'),
    object: z.object({ id: z.string().min(1) }).passthrough(),
  })
  .passthrough();

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

  const paymentFailed = stripeInvoicePaymentFailedSchema.safeParse(input);
  if (paymentFailed.success) {
    const subscriptionId = expandableId(
      paymentFailed.data.data.object.parent?.subscription_details
        .subscription ?? paymentFailed.data.data.object.subscription
    );
    if (!subscriptionId) return null;
    return {
      eventType: 'invoice.payment_failed',
      provider: 'stripe',
      providerEventId: paymentFailed.data.id,
      reference: { id: subscriptionId, kind: 'subscription' },
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

export function normalizeCreemVerifiedPaymentEvent(
  input: unknown
): VerifiedPaymentWebhookEvent | null {
  const checkout = creemCheckoutSchema.safeParse(input);
  if (checkout.success) {
    const planBindingId = textMetadata(
      checkout.data.object.metadata?.planCheckoutBindingId
    );
    return {
      eventType: checkout.data.eventType,
      provider: 'creem',
      providerEventId: checkout.data.id,
      reference: { id: checkout.data.object.id, kind: 'checkout' },
      ...(planBindingId ? { planBindingId } : {}),
    };
  }

  const paid = creemSubscriptionPaidSchema.safeParse(input);
  if (paid.success) {
    return {
      eventType: 'subscription.renewed',
      provider: 'creem',
      providerEventId: paid.data.id,
      reference: { id: paid.data.object.id, kind: 'subscription' },
    };
  }

  const scheduledCancel =
    creemSubscriptionScheduledCancelSchema.safeParse(input);
  if (scheduledCancel.success) {
    return {
      eventType: 'customer.subscription.updated',
      provider: 'creem',
      providerEventId: scheduledCancel.data.id,
      reference: {
        id: scheduledCancel.data.object.id,
        kind: 'subscription',
      },
    };
  }

  const canceled = creemSubscriptionCanceledSchema.safeParse(input);
  if (canceled.success) {
    return {
      eventType:
        canceled.data.eventType === 'subscription.expired'
          ? 'subscription.expired'
          : 'customer.subscription.deleted',
      provider: 'creem',
      providerEventId: canceled.data.id,
      reference: { id: canceled.data.object.id, kind: 'subscription' },
    };
  }

  return null;
}

function textMetadata(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

import * as z from 'zod';
import type { VerifiedPaymentWebhookEvent } from './types';

const stripeSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('checkout.session.completed'),
    data: z.object({
      object: z
        .object({
          id: z.string().min(1),
          mode: z.literal('payment'),
          payment_status: z.literal('paid'),
        })
        .passthrough(),
    }),
  })
  .passthrough();

const creemSchema = z
  .object({
    id: z.string().min(1),
    eventType: z.literal('checkout.completed'),
    object: z.object({ id: z.string().min(1) }).passthrough(),
  })
  .passthrough();

export function normalizeStripeVerifiedPaymentEvent(
  input: unknown
): VerifiedPaymentWebhookEvent | null {
  const event = stripeSchema.safeParse(input);
  if (!event.success) return null;
  return {
    eventType: event.data.type,
    provider: 'stripe',
    providerEventId: event.data.id,
    reference: {
      id: event.data.data.object.id,
      kind: 'checkout',
    },
  };
}

export function normalizeCreemVerifiedPaymentEvent(
  input: unknown
): VerifiedPaymentWebhookEvent | null {
  const event = creemSchema.safeParse(input);
  if (!event.success) return null;
  return {
    eventType: event.data.eventType,
    provider: 'creem',
    providerEventId: event.data.id,
    reference: { id: event.data.object.id, kind: 'checkout' },
  };
}

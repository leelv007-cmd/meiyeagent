import { websiteConfig } from '@/config/website';
import { getDb } from '@/db';
import { paymentWebhookEvents } from '@/db/app.schema';
import { serverEnv } from '@/env/server';
import { and, eq } from 'drizzle-orm';
import { CreemProvider } from './provider/creem';
import {
  settlePendingProStudioActivations,
  settleVerifiedProStudioPayment,
} from './pro-studio-commerce';
import { PostgresProStudioCommerceStore } from './postgres-pro-studio-commerce';
import { StripeProvider } from './provider/stripe';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  CreatePortalParams,
  PaymentProvider,
  PaymentProviderName,
  PortalResult,
} from './types';

let paymentProvider: PaymentProvider | null = null;

type ProviderFactory = () => PaymentProvider;

const providerRegistry: Record<PaymentProviderName, ProviderFactory> = {
  stripe: () => new StripeProvider(),
  creem: () => new CreemProvider(),
};

function createProvider(): PaymentProvider {
  const paymentConfig = websiteConfig.payment;
  if (!paymentConfig?.enable) {
    throw new Error('Payment is disabled');
  }
  const name = paymentConfig.provider;
  if (!name) throw new Error('Payment provider is required.');
  const factory = providerRegistry[name as PaymentProviderName];
  if (!factory) {
    throw new Error(`Unsupported payment provider: ${name}.`);
  }
  return factory();
}

/** Whether payment (checkout/billing) is enabled */
export function isPaymentEnabled(): boolean {
  return !!websiteConfig.payment?.enable;
}

/**
 * Get the payment provider
 */
export function getPaymentProvider(): PaymentProvider {
  if (!paymentProvider) paymentProvider = createProvider();
  return paymentProvider;
}

export async function createCheckout(
  params: CreateCheckoutParams
): Promise<CheckoutResult> {
  const provider = getPaymentProvider();
  return provider.createCheckout(params);
}

export async function createCustomerPortal(
  params: CreatePortalParams
): Promise<PortalResult> {
  const provider = getPaymentProvider();
  return provider.createCustomerPortal(params);
}

export async function handleWebhookEvent(
  payload: string,
  signature: string
): Promise<void> {
  const provider = getPaymentProvider();
  const raw = JSON.parse(payload) as Record<string, unknown>;
  const eventId = raw.id;
  const eventType = raw.type ?? raw.eventType;
  const providerName = websiteConfig.payment?.provider;
  if (
    typeof eventId !== 'string' ||
    typeof eventType !== 'string' ||
    !providerName
  ) {
    throw new Error('Webhook event identity is missing.');
  }
  const [existing] = await getDb()
    .select({
      status: paymentWebhookEvents.status,
      createdAt: paymentWebhookEvents.createdAt,
    })
    .from(paymentWebhookEvents)
    .where(
      and(
        eq(paymentWebhookEvents.provider, providerName),
        eq(paymentWebhookEvents.eventId, eventId)
      )
    )
    .limit(1);
  if (existing?.status === 'processed') return;
  if (
    existing?.status === 'processing' &&
    existing.createdAt.getTime() > Date.now() - 10 * 60_000
  ) {
    return;
  }
  if (existing) {
    await getDb()
      .delete(paymentWebhookEvents)
      .where(
        and(
          eq(paymentWebhookEvents.provider, providerName),
          eq(paymentWebhookEvents.eventId, eventId)
        )
      );
  }
  const [claimed] = await getDb()
    .insert(paymentWebhookEvents)
    .values({
      provider: providerName,
      eventId,
      eventType,
      status: 'processing',
    })
    .onConflictDoNothing()
    .returning({ eventId: paymentWebhookEvents.eventId });
  if (!claimed) return;
  try {
    const verifiedEvent = await provider.handleWebhookEvent(payload, signature);
    if (verifiedEvent) {
      if (
        verifiedEvent.provider !== providerName ||
        verifiedEvent.providerEventId !== eventId
      ) {
        throw new Error('Verified webhook identity does not match payload.');
      }
      await settleVerifiedProStudioPurchase(verifiedEvent);
    }
    await getDb()
      .update(paymentWebhookEvents)
      .set({ status: 'processed', processedAt: new Date() })
      .where(
        and(
          eq(paymentWebhookEvents.provider, providerName),
          eq(paymentWebhookEvents.eventId, eventId)
        )
      );
  } catch (error) {
    await getDb()
      .delete(paymentWebhookEvents)
      .where(
        and(
          eq(paymentWebhookEvents.provider, providerName),
          eq(paymentWebhookEvents.eventId, eventId)
        )
      );
    throw error;
  }
}

export async function settlePendingProStudioPurchases() {
  return settlePendingProStudioActivations({
    activate: activateProStudioPurchase,
    limit: 25,
    store: new PostgresProStudioCommerceStore(getDb()),
  });
}

export async function settleVerifiedProStudioPurchase(
  event: import('./types').VerifiedPaymentWebhookEvent
) {
  return settleVerifiedProStudioPayment(event, {
    activate: activateProStudioPurchase,
    store: new PostgresProStudioCommerceStore(getDb()),
  });
}

async function activateProStudioPurchase(input: {
  offerId: string;
  ownerUserId: string;
  paymentEventId: string;
  workspaceId: string;
}) {
  const endpoint = new URL(
    '/api/internal/pro-studio-purchases',
    serverEnv.CANVAS_SERVICE_URL
  );
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      offerId: input.offerId,
      paymentEventId: input.paymentEventId,
      userId: input.ownerUserId,
      workspaceId: input.workspaceId,
    }),
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-canvas-service-token': serverEnv.CANVAS_SERVICE_TOKEN,
    },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Canvas purchase activation failed (${response.status}).`);
  }
}

import { websiteConfig } from '@/config/website';
import { getDb } from '@/db';
import { serverEnv } from '@/env/server';
import { CreemProvider } from './provider/creem';
import {
  settlePendingProStudioActivations,
  settleVerifiedProStudioPayment,
} from './pro-studio-commerce';
import { PostgresProStudioCommerceStore } from './postgres-pro-studio-commerce';
import { PostgresPlanCheckoutBindingStore } from './plan-checkout-bindings';
import {
  planGrantCommandFromIntent,
  settleVerifiedPlanPayment,
  type PlanSettlementIntent,
} from './plan-commerce';
import { StripeProvider } from './provider/stripe';
import { PostgresPaymentWebhookInbox } from './postgres-webhook-settlement';
import {
  receivePaymentWebhook,
  refreshVerifiedWebhookSignature,
  settlePendingPaymentWebhooks as consumePendingPaymentWebhooks,
} from './webhook-settlement';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  CreatePortalParams,
  PaymentProvider,
  PaymentProviderName,
  PortalResult,
  VerifiedPaymentWebhookEvent,
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

function createWebhookProvider(name: PaymentProviderName): PaymentProvider {
  const factory = providerRegistry[name];
  if (!factory) throw new Error(`Unsupported payment provider: ${name}.`);
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
  provider: PaymentProviderName,
  payload: string,
  signature: string
) {
  return receivePaymentWebhook(
    { payload, provider, signature },
    {
      inbox: new PostgresPaymentWebhookInbox(getDb()),
      secrets: {
        creemWebhookSecret: serverEnv.CREEM_WEBHOOK_SECRET,
        stripeApiKey: serverEnv.STRIPE_SECRET_KEY,
        stripeWebhookSecret: serverEnv.STRIPE_WEBHOOK_SECRET,
      },
    }
  );
}

export async function settlePendingPaymentWebhookEvents() {
  const inbox = new PostgresPaymentWebhookInbox(getDb());
  return consumePendingPaymentWebhooks(
    { limit: 25 },
    {
      inbox,
      settlement: {
        async apply(claim) {
          const provider = createWebhookProvider(claim.provider);
          const signature = await refreshVerifiedWebhookSignature(claim, {
            creemWebhookSecret: serverEnv.CREEM_WEBHOOK_SECRET,
            stripeWebhookSecret: serverEnv.STRIPE_WEBHOOK_SECRET,
          });
          return provider.handleWebhookEvent(claim.payload, signature);
        },
        async settle(event) {
          const proStudioSettlement =
            await settleVerifiedProStudioPurchase(event);
          const planSettlement = await settleVerifiedPlanPurchase(event);
          if (
            proStudioSettlement.status === 'not_applicable' &&
            !planSettlement
          ) {
            const error = new Error(
              'Verified payment event has no durable commerce binding yet.'
            ) as Error & { code: string };
            error.code = 'PAYMENT_BINDING_NOT_READY';
            throw error;
          }
        },
      },
    }
  );
}

export async function settlePendingProStudioPurchases() {
  return settlePendingProStudioActivations({
    activate: activateProStudioPurchase,
    limit: 25,
    store: new PostgresProStudioCommerceStore(getDb()),
  });
}

export async function settleVerifiedProStudioPurchase(
  event: VerifiedPaymentWebhookEvent
) {
  return settleVerifiedProStudioPayment(event, {
    activate: activateProStudioPurchase,
    store: new PostgresProStudioCommerceStore(getDb()),
  });
}

/** Tc: settle plan checkout/renewal/cancel into Foundation payment_grant. */
export async function settleVerifiedPlanPurchase(
  event: VerifiedPaymentWebhookEvent
) {
  const bindingStore = new PostgresPlanCheckoutBindingStore(getDb());
  return settleVerifiedPlanPayment(event, {
    resolveBinding: (verified) => bindingStore.resolveBinding(verified),
    grantPlan: async (intent) => {
      await grantPlanEntitlement(intent);
      if (
        intent.lifecycle === 'activate' ||
        intent.lifecycle === 'renew' ||
        intent.lifecycle === 'resume'
      ) {
        await bindingStore.markActive({
          bindingId: event.planBindingId ?? null,
          provider: intent.provider,
          providerCheckoutId:
            event.reference.kind === 'checkout' ? event.reference.id : null,
          subscriptionId:
            event.reference.kind === 'subscription' ? event.reference.id : null,
        });
      } else if (event.reference.kind === 'subscription') {
        await bindingStore.markCanceled({
          provider: intent.provider,
          subscriptionId: event.reference.id,
        });
      }
    },
  });
}

async function grantPlanEntitlement(intent: PlanSettlementIntent) {
  const command = planGrantCommandFromIntent(intent);
  const endpoint = new URL(
    `/v1/workspaces/${encodeURIComponent(intent.workspaceId)}/p1/commands`,
    serverEnv.CORE_SERVICE_URL
  );
  const response = await fetch(endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-service-token': serverEnv.CORE_SERVICE_TOKEN,
      'x-user-id': intent.ownerUserId,
      'x-workspace-id': intent.workspaceId,
      'x-core-actor': 'payment',
      'idempotency-key': intent.paymentEventId,
      'x-correlation-id': `payment:${intent.paymentEventId}`,
    },
    body: JSON.stringify({
      module: command.module,
      action: command.action,
      payload: command.payload,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Core plan payment_grant failed (${response.status}): ${await response.text()}`
    );
  }
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

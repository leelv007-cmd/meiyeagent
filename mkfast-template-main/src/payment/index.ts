import { websiteConfig } from '@/config/website';
import { getDb } from '@/db';
import { serverEnv } from '@/env/server';
import { CreemProvider } from './provider/creem';
import { PostgresPlanCheckoutBindingStore } from './plan-checkout-bindings';
import {
  planGrantCommandFromIntent,
  settleVerifiedPlanPayment,
  shouldCancelPlanBinding,
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
          // Pro Studio add-on settlement retired (D-170 / P1 fail-closed).
          // Plan commerce is the only durable binding path.
          const planSettlement = await settleVerifiedPlanPurchase(event);
          if (!planSettlement) {
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
          subscriptionId: intent.subscriptionId,
        });
      } else if (shouldCancelPlanBinding(intent, event.reference)) {
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

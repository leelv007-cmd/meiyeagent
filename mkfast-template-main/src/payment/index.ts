import { websiteConfig } from '@/config/website';
import { getDb } from '@/db';
import { serverEnv } from '@/env/server';
import { sendPaymentRefundReviewAlert } from '@/notification';
import { PostgresPlanCheckoutBindingStore } from '@/payment/plan-checkout-bindings';
import { PostgresCreditPackageCheckoutBindingStore } from '@/payment/credit-package-checkout-bindings';
import {
  settleVerifiedCreditPackagePurchase,
  type CreditPackageSettlementIntent,
} from '@/payment/credit-package-commerce';
import { assertWaffoCreditPackageSnapshot } from '@/payment/waffo-credit-package-catalog';
import {
  PostgresPaymentRefundStore,
  recordVerifiedPaymentRefund,
} from '@/payment/payment-refunds';
import {
  drainPaymentRefundReviewAlerts as drainRefundReviewAlertOutbox,
  PostgresPaymentRefundReviewAlertOutbox,
} from '@/payment/payment-refund-alerts';
import { settleVerifiedPaymentCommerce } from '@/payment/payment-commerce-settlement';
import {
  planGrantCommandFromIntent,
  settleVerifiedPlanPayment,
  type PlanSettlementIntent,
} from '@/payment/plan-commerce';
import { applyPlanSettlementIntent } from '@/payment/payment-settlement-side-effects';
import { StripeProvider } from '@/payment/provider/stripe';
import {
  WaffoProvider,
  type CreateWaffoCreditPackageCheckoutParams,
} from '@/payment/provider/waffo';
import type { WaffoWebhookPublicKeys } from '@/payment/waffo-environment';
import { PostgresPaymentWebhookInbox } from '@/payment/postgres-webhook-settlement';
import {
  receivePaymentWebhook,
  receiveAndSettlePaymentWebhook,
  refreshVerifiedWebhookSignature,
  settlePendingPaymentWebhooks as consumePendingPaymentWebhooks,
  type PaymentWebhookDelivery,
} from '@/payment/webhook-settlement';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  CreatePortalParams,
  PaymentProvider,
  PaymentProviderName,
  PortalResult,
  VerifiedPaymentWebhookEvent,
} from '@/payment/types';

let paymentProvider: PaymentProvider | null = null;

type ProviderFactory = () => PaymentProvider;

const providerRegistry: Record<PaymentProviderName, ProviderFactory> = {
  stripe: () => new StripeProvider(),
  waffo: createWaffoProvider,
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

export async function createCreditPackageCheckout(
  params: CreateWaffoCreditPackageCheckoutParams
): Promise<CheckoutResult> {
  const provider = getPaymentProvider();
  if (!(provider instanceof WaffoProvider)) {
    throw new Error('Credit package checkout requires Waffo.');
  }
  return provider.createCreditPackageCheckout(params);
}

export async function readWaffoCreditPackageProductFacts(productId: string) {
  const provider = getPaymentProvider();
  if (!(provider instanceof WaffoProvider)) {
    throw new Error('Credit package product reads require Waffo.');
  }
  return provider.readCreditPackageProductFacts(productId);
}

export async function handleWebhookEvent(
  provider: PaymentProviderName,
  payload: string,
  signature: string
) {
  return receivePaymentWebhook(
    { payload, provider, signature },
    {
      inbox: () => new PostgresPaymentWebhookInbox(getDb()),
      secrets: {
        stripeApiKey: serverEnv.STRIPE_SECRET_KEY,
        stripeWebhookSecret: serverEnv.STRIPE_WEBHOOK_SECRET,
        waffoEnvironment: serverEnv.WAFFO_ENVIRONMENT,
        waffoWebhookPublicKeys: waffoWebhookPublicKeys(),
      },
    }
  );
}

export async function handleAndSettleWebhookEvent(
  provider: PaymentProviderName,
  payload: string,
  signature: string
) {
  return receiveAndSettlePaymentWebhook(
    { payload, provider, signature },
    {
      inbox: () => new PostgresPaymentWebhookInbox(getDb()),
      secrets: {
        stripeApiKey: serverEnv.STRIPE_SECRET_KEY,
        stripeWebhookSecret: serverEnv.STRIPE_WEBHOOK_SECRET,
        waffoEnvironment: serverEnv.WAFFO_ENVIRONMENT,
        waffoWebhookPublicKeys: waffoWebhookPublicKeys(),
      },
      settle: settlePendingPaymentWebhookEvents,
    }
  );
}

export async function settlePendingPaymentWebhookEvents(
  delivery?: PaymentWebhookDelivery
) {
  const database = getDb();
  const inbox = new PostgresPaymentWebhookInbox(database);
  const settlement = await consumePendingPaymentWebhooks(
    delivery ? { delivery, limit: 1 } : { limit: 25 },
    {
      inbox,
      settlement: {
        async apply(claim) {
          const provider = createWebhookProvider(claim.provider);
          const signature = await refreshVerifiedWebhookSignature(claim, {
            stripeWebhookSecret: serverEnv.STRIPE_WEBHOOK_SECRET,
            waffoEnvironment: serverEnv.WAFFO_ENVIRONMENT,
            waffoWebhookPublicKeys: waffoWebhookPublicKeys(),
          });
          return provider.handleWebhookEvent(claim.payload, signature);
        },
        async settle(event, claim) {
          const creditPackages = new PostgresCreditPackageCheckoutBindingStore(
            database
          );
          const refunds = new PostgresPaymentRefundStore(database);
          await settleVerifiedPaymentCommerce(event, claim.payload, {
            recordRefund: (verified, rawPayload) =>
              recordVerifiedPaymentRefund(verified, rawPayload, {
                record: (input) => refunds.record(input),
              }),
            settleCreditPackage: (verified) =>
              settleVerifiedCreditPackagePurchase(verified, {
                grantAddOn: grantCreditPackageEntitlement,
                claimSettlement: (candidate) =>
                  creditPackages.claimSettlement(candidate),
                completeSettlement: (input) =>
                  creditPackages.completeSettlement(input),
                validateBinding: (candidate, binding) =>
                  assertWaffoCreditPackageSnapshot({
                    amount: candidate.amount,
                    currency: candidate.currency,
                    snapshot: binding.skuSnapshot,
                  }),
              }),
            settlePlan: settleVerifiedPlanPurchase,
          });
        },
      },
    }
  );
  return settlement;
}

/**
 * Recovery runs independently from a webhook delivery acknowledgement. A
 * poison alert therefore cannot delay or fail unrelated payment settlement.
 */
export async function drainPaymentRefundReviewAlerts() {
  const database = getDb();
  return drainRefundReviewAlertOutbox(
    { limit: 25 },
    {
      notify: sendPaymentRefundReviewAlert,
      outbox: new PostgresPaymentRefundReviewAlertOutbox(database),
    }
  );
}

function waffoWebhookPublicKeys(): WaffoWebhookPublicKeys {
  const test = serverEnv.WAFFO_WEBHOOK_TEST_PUBLIC_KEY?.trim();
  const prod = serverEnv.WAFFO_WEBHOOK_PRODUCTION_PUBLIC_KEY?.trim();
  return { ...(prod ? { prod } : {}), ...(test ? { test } : {}) };
}

function createWaffoProvider() {
  return new WaffoProvider({
    environment: serverEnv.WAFFO_ENVIRONMENT,
    webhookPublicKeys: waffoWebhookPublicKeys(),
  });
}

/** Tc: settle plan checkout/renewal/cancel into Foundation payment_grant. */
export async function settleVerifiedPlanPurchase(
  event: VerifiedPaymentWebhookEvent
) {
  const bindingStore = new PostgresPlanCheckoutBindingStore(getDb());
  return settleVerifiedPlanPayment(event, {
    resolveBinding: (verified) => bindingStore.resolveBinding(verified),
    grantPlan: (intent) =>
      applyPlanSettlementIntent(event, intent, {
        bindings: bindingStore,
        grantPlanEntitlement,
        cancelWaffoSubscriptionAtPeriodEnd: (input) =>
          bindingStore.cancelWaffoSubscriptionAtPeriodEnd({
            ...input,
            cancel: () =>
              createWaffoProvider().cancelSubscriptionAtPeriodEnd(
                input.subscriptionId
              ),
          }),
      }),
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

async function grantCreditPackageEntitlement(
  intent: CreditPackageSettlementIntent
) {
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
      module: 'entitlements',
      action: 'payment_add_on_grant',
      payload: {
        offerId: intent.offerId,
        paymentEventId: intent.paymentEventId,
        credits: intent.credits,
        expireDays: intent.expireDays,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Core credit package payment_add_on_grant failed (${response.status}): ${await response.text()}`
    );
  }
}

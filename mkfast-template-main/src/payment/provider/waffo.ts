import {
  WaffoPancake,
  type AuthenticatedCheckoutParams,
  type CancelSubscriptionParams,
  type VerifyWebhookOptions,
  type WebhookEvent,
  type WebhookPublicKeys,
} from '@waffo/pancake-ts';
import { serverEnv } from '@/env/server';
import { findPlanByPlanId, findPriceInPlan } from '@/lib/price-plan';
import { requireSellableCheckoutPrice } from '@/payment/checkout-policy';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  CreatePortalParams,
  PaymentProvider,
  PortalResult,
  VerifiedPaymentWebhookEvent,
} from '@/payment/types';
import { normalizeWaffoVerifiedPaymentEvent } from '@/payment/verified-webhook-event';

export type WaffoClient = {
  checkout: {
    authenticated: {
      create(
        params: AuthenticatedCheckoutParams
      ): Promise<{ checkoutUrl: string; sessionId: string }>;
    };
  };
  orders: {
    cancelSubscription(params: CancelSubscriptionParams): Promise<unknown>;
  };
  webhooks: {
    verify(
      payload: string,
      signature: string,
      options?: VerifyWebhookOptions
    ): WebhookEvent;
  };
};

export interface WaffoProviderOptions {
  allowTestEvents?: boolean;
  client?: WaffoClient;
  testCheckout?: boolean;
  webhookPublicKeys?: WebhookPublicKeys;
}

export class WaffoProvider implements PaymentProvider {
  private readonly allowTestEvents: boolean;
  private readonly client: WaffoClient;
  private readonly testCheckout: boolean;

  constructor(options: WaffoProviderOptions = {}) {
    this.allowTestEvents = options.allowTestEvents ?? serverEnv.WAFFO_DEBUG;
    this.testCheckout = options.testCheckout ?? false;
    this.client =
      options.client ?? createWaffoClient(options.webhookPublicKeys);
  }

  getProviderName(): string {
    return 'waffo';
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const price = requireSellableCheckoutPrice(
      { planId: params.planId, priceId: params.priceId },
      { findPlanByPlanId, findPriceInPlan }
    ).price;
    const buyerIdentity = params.metadata?.userId?.trim() ?? '';
    const planBindingId = params.metadata?.planCheckoutBindingId?.trim() ?? '';
    if (!buyerIdentity) {
      throw new Error('Checkout metadata.userId is required for Waffo.');
    }
    if (!planBindingId) {
      throw new Error(
        'Checkout metadata.planCheckoutBindingId is required for Waffo.'
      );
    }

    const checkout = await this.client.checkout.authenticated.create({
      productId: price.priceId,
      currency: price.currency,
      buyerIdentity,
      ...(params.customerEmail ? { buyerEmail: params.customerEmail } : {}),
      ...(params.successUrl ? { successUrl: params.successUrl } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
      orderMerchantExternalId: planBindingId,
      // Trial entitlement is a Core-owned registration grant, never a Waffo
      // subscription. Do not accept provider default trial rules here.
      withTrial: false,
    });
    return {
      id: checkout.sessionId,
      url: checkoutUrlForEnvironment(checkout.checkoutUrl, this.testCheckout),
    };
  }

  async createCustomerPortal(
    _params: CreatePortalParams
  ): Promise<PortalResult> {
    return { url: 'https://pancake.waffo.ai/consumer/portal/login' };
  }

  async cancelSubscriptionAtPeriodEnd(orderId: string): Promise<void> {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId) {
      throw new Error('Waffo subscription order ID is required.');
    }
    await this.client.orders.cancelSubscription({ orderId: normalizedOrderId });
  }

  async handleWebhookEvent(
    payload: string,
    signature: string
  ): Promise<VerifiedPaymentWebhookEvent | null> {
    // Freshness was enforced before the event was written to the durable inbox.
    // This pass checks RSA integrity again without rejecting a delayed worker.
    const event = this.client.webhooks.verify(payload, signature, {
      toleranceMs: 0,
    });
    if (event.mode === 'test' && !this.allowTestEvents) {
      throw new Error('Test-mode Waffo webhook events are disabled.');
    }
    return normalizeWaffoVerifiedPaymentEvent(event);
  }
}

function checkoutUrlForEnvironment(checkoutUrl: string, testCheckout: boolean) {
  if (!testCheckout) return checkoutUrl;
  const url = new URL(checkoutUrl);
  url.searchParams.set('test', 'true');
  return url.toString();
}

function createWaffoClient(publicKeys?: WebhookPublicKeys): WaffoClient {
  const merchantId = serverEnv.WAFFO_MERCHANT_ID?.trim();
  const privateKey = serverEnv.WAFFO_PRIVATE_KEY?.replaceAll(
    '\\n',
    '\n'
  ).trim();
  if (!merchantId || !privateKey) {
    throw new Error('Waffo credentials are not configured.');
  }
  return new WaffoPancake({
    merchantId,
    privateKey,
    ...(publicKeys ? { webhookPublicKey: publicKeys } : {}),
  });
}

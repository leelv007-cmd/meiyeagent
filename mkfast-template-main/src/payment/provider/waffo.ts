import {
  WaffoPancake,
  type AuthenticatedCheckoutParams,
  type CancelSubscriptionParams,
  type VerifyWebhookOptions,
  type WebhookEvent,
} from '@waffo/pancake-ts';
import { serverEnv } from '@/env/server';
import { findPlanByPlanId, findPriceInPlan } from '@/lib/price-plan';
import { requireSellableCheckoutPrice } from '@/payment/checkout-policy';
import {
  expectedWaffoWebhookMode,
  sdkWaffoEnvironment,
  selectWaffoWebhookPublicKey,
  type WaffoEnvironment,
  type WaffoWebhookPublicKeys,
} from '@/payment/waffo-environment';
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
  client?: WaffoClient;
  environment?: WaffoEnvironment;
  webhookPublicKeys?: WaffoWebhookPublicKeys;
}

export class WaffoProvider implements PaymentProvider {
  private readonly client: WaffoClient;
  private readonly environment: WaffoEnvironment;
  private readonly webhookPublicKeys: WaffoWebhookPublicKeys | undefined;

  constructor(options: WaffoProviderOptions = {}) {
    this.environment = options.environment ?? serverEnv.WAFFO_ENVIRONMENT;
    this.webhookPublicKeys = options.webhookPublicKeys;
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
      url: checkoutUrlForEnvironment(checkout.checkoutUrl, this.environment),
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
    const key = selectWaffoWebhookPublicKey(
      this.environment,
      this.webhookPublicKeys
    );
    if (!key) {
      throw new Error('Waffo webhook verification is not configured.');
    }
    const sdkEnvironment = sdkWaffoEnvironment(this.environment);
    const event = this.client.webhooks.verify(payload, signature, {
      environment: sdkEnvironment,
      publicKeys: { [sdkEnvironment]: key },
      toleranceMs: 0,
    });
    if (event.mode !== expectedWaffoWebhookMode(this.environment)) {
      throw new Error('Waffo webhook mode does not match its authority.');
    }
    return normalizeWaffoVerifiedPaymentEvent(event);
  }
}

function checkoutUrlForEnvironment(
  checkoutUrl: string,
  environment: WaffoEnvironment
) {
  if (environment !== 'test') return checkoutUrl;
  const url = new URL(checkoutUrl);
  url.searchParams.set('test', 'true');
  return url.toString();
}

function createWaffoClient(publicKeys?: WaffoWebhookPublicKeys): WaffoClient {
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

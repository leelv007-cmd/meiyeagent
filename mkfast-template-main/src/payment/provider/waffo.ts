import {
  WaffoPancake,
  type AuthenticatedCheckoutParams,
  type CancelSubscriptionParams,
  type GraphQLResponse,
  type VerifyWebhookOptions,
  type WebhookEvent,
} from '@waffo/pancake-ts';
import { serverEnv } from '@/env/server';
import { requireWaffoTestCheckoutAuthority } from '@/payment/checkout-policy';
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
import type { WaffoSubscriptionProductFacts } from '@/payment/commerce-readiness';
import { normalizeWaffoVerifiedPaymentEvent } from '@/payment/verified-webhook-event';

export type WaffoClient = {
  checkout: {
    authenticated: {
      create(
        params: AuthenticatedCheckoutParams
      ): Promise<{ checkoutUrl: string; sessionId: string }>;
    };
  };
  graphql?: {
    query<T>(input: {
      query: string;
      variables?: Record<string, unknown>;
    }): Promise<GraphQLResponse<T>>;
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
  storeId?: string;
  webhookPublicKeys?: WaffoWebhookPublicKeys;
}

export interface CreateWaffoCreditPackageCheckoutParams {
  buyerEmail?: string;
  buyerIdentity: string;
  currency: string;
  packageCheckoutBindingId: string;
  productId: string;
  successUrl?: string;
}

export interface WaffoCreditPackageProductFacts {
  amount: string;
  currency: string;
  metadata: Record<string, unknown> | string | null;
  productId: string;
  status: string;
}

/**
 * The Waffo Test sandbox stopped including `currentPeriodStart/End` in
 * subscription webhook payloads on 2026-08-03. Paid-lifecycle settlement still
 * fails closed without a provider-verified billing period, so the missing
 * bounds are recovered from the provider's own order record instead of being
 * derived locally. Unrecoverable lookups throw this retryable error and stay
 * in the durable retry loop.
 */
export class WaffoPaymentPeriodUnavailableError extends Error {
  readonly code = 'WAFFO_PERIOD_RECOVERY_UNAVAILABLE' as const;

  constructor(orderId: string) {
    super(
      `Waffo subscription ${orderId} has no provider-verified billing period yet.`
    );
    this.name = 'WaffoPaymentPeriodUnavailableError';
  }
}

type WaffoOrderPeriodLookup = {
  subscriptionOrders: Array<{
    id: string;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
  }>;
};

export class WaffoProvider implements PaymentProvider {
  private readonly client: WaffoClient;
  private readonly environment: WaffoEnvironment;
  private readonly storeIdOption: string | undefined;
  private readonly webhookPublicKeys: WaffoWebhookPublicKeys | undefined;

  constructor(options: WaffoProviderOptions = {}) {
    this.environment = options.environment ?? serverEnv.WAFFO_ENVIRONMENT;
    this.storeIdOption = options.storeId;
    this.webhookPublicKeys = options.webhookPublicKeys;
    this.client =
      options.client ?? createWaffoClient(options.webhookPublicKeys);
  }

  getProviderName(): string {
    return 'waffo';
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    requireWaffoTestCheckoutAuthority(this.environment);
    const commerceAuthority = params.commerceAuthority;
    if (
      !commerceAuthority?.planRevision.trim() ||
      !Number.isInteger(commerceAuthority.paymentMappingRevision) ||
      commerceAuthority.paymentMappingRevision < 1
    ) {
      throw new Error(
        'Core commerce authority is required for Waffo checkout.'
      );
    }
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
      productId: params.priceId,
      currency: commerceAuthority.currency,
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

  async createCreditPackageCheckout(
    params: CreateWaffoCreditPackageCheckoutParams
  ): Promise<CheckoutResult> {
    requireWaffoTestCheckoutAuthority(this.environment);
    const buyerIdentity = params.buyerIdentity.trim();
    const packageCheckoutBindingId = params.packageCheckoutBindingId.trim();
    const productId = params.productId.trim();
    if (!buyerIdentity) {
      throw new Error('Credit package buyer identity is required for Waffo.');
    }
    if (!packageCheckoutBindingId) {
      throw new Error('Credit package checkout binding is required for Waffo.');
    }
    if (!productId) {
      throw new Error('Credit package product is required for Waffo.');
    }

    const checkout = await this.client.checkout.authenticated.create({
      productId,
      currency: params.currency,
      buyerIdentity,
      ...(params.buyerEmail ? { buyerEmail: params.buyerEmail } : {}),
      ...(params.successUrl ? { successUrl: params.successUrl } : {}),
      metadata: { creditPackageCheckoutBindingId: packageCheckoutBindingId },
      orderMerchantExternalId: packageCheckoutBindingId,
    });
    return {
      id: checkout.sessionId,
      url: checkoutUrlForEnvironment(checkout.checkoutUrl, this.environment),
    };
  }

  async readCreditPackageProductFacts(
    productId: string
  ): Promise<WaffoCreditPackageProductFacts> {
    const normalizedProductId = productId.trim();
    if (!normalizedProductId)
      throw new Error('Credit package product is required.');
    if (!this.client.graphql) {
      throw new Error('Waffo Test product read capability is not configured.');
    }
    const response = await this.client.graphql.query<{
      onetimeProduct: {
        id: string;
        metadata: Record<string, unknown> | string | null;
        status: string;
        prices: Array<{ currency: string; priceInfo: { amount: string } }>;
      } | null;
    }>({
      query: `query WaffoCreditPackageProduct($id: ID!) {
        onetimeProduct(id: $id) {
          id status metadata
          prices { currency priceInfo { amount } }
        }
      }`,
      variables: { id: normalizedProductId },
    });
    const product = response.data?.onetimeProduct;
    const price = product?.prices?.length === 1 ? product.prices[0] : undefined;
    if (response.errors?.length || !product || !price) {
      throw new Error('Waffo Test product facts are unavailable or malformed.');
    }
    return {
      amount: price.priceInfo.amount,
      currency: price.currency,
      metadata: product.metadata,
      productId: product.id,
      status: product.status,
    };
  }

  async readSubscriptionProductFacts(
    productIds: readonly string[]
  ): Promise<WaffoSubscriptionProductFacts[]> {
    const expectedIds = new Set(
      productIds.map((id) => id.trim()).filter(Boolean)
    );
    if (expectedIds.size !== productIds.length || expectedIds.size === 0) {
      throw new Error('Waffo subscription product mapping is invalid.');
    }
    const storeId = (this.storeIdOption ?? serverEnv.WAFFO_STORE_ID)?.trim();
    if (!storeId || !this.client.graphql) {
      throw new Error(
        'Waffo Test subscription product reads are not configured.'
      );
    }
    const response = await this.client.graphql.query<{
      subscriptionProducts: Array<{
        billingPeriod: string;
        id: string;
        metadata: Record<string, unknown> | string | null;
        prices: Array<{ currency: string; priceInfo: { amount: string } }>;
        status: string;
      }>;
    }>({
      query: `query WaffoCommerceReadinessProducts($storeId: String!) {
        subscriptionProducts(storeId: $storeId) {
          id
          billingPeriod
          metadata
          status
          prices { currency priceInfo { amount } }
        }
      }`,
      variables: { storeId },
    });
    if (response.errors?.length || !response.data) {
      throw new Error('Waffo Test subscription product facts are unavailable.');
    }
    const matched = response.data.subscriptionProducts.filter((product) =>
      expectedIds.has(product.id)
    );
    if (matched.length !== expectedIds.size) {
      throw new Error('Waffo Test subscription product mapping is incomplete.');
    }
    return matched.map((product) => {
      const price = product.prices.length === 1 ? product.prices[0] : undefined;
      if (!price) {
        throw new Error('Waffo Test subscription product price is ambiguous.');
      }
      return {
        amount: price.priceInfo.amount,
        billingPeriod: product.billingPeriod,
        currency: price.currency,
        metadata: product.metadata,
        productId: product.id,
        status: product.status,
      };
    });
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
    const normalized = normalizeWaffoVerifiedPaymentEvent(event);
    if (!normalized) return null;
    return this.withRecoveredBillingPeriod(normalized);
  }

  /**
   * Paid lifecycle events must carry a provider-verified billing period; when
   * the webhook payload omits it, read the same fact back from the provider's
   * order record. Anything else throws retryable and never invents a period.
   */
  private async withRecoveredBillingPeriod(
    event: VerifiedPaymentWebhookEvent
  ): Promise<VerifiedPaymentWebhookEvent> {
    const isPaidLifecycle =
      event.eventType === 'checkout.completed' ||
      event.eventType === 'subscription.renewed';
    if (!isPaidLifecycle) return event;
    if (event.periodStartsAt && event.periodEndsAt) return event;

    const orderId = event.reference.id;
    const graphql = this.client.graphql;
    const storeId = (this.storeIdOption ?? serverEnv.WAFFO_STORE_ID)?.trim();
    if (!graphql || !storeId) {
      throw new WaffoPaymentPeriodUnavailableError(orderId);
    }
    const response = await graphql.query<WaffoOrderPeriodLookup>({
      query: `query WaffoOrderBillingPeriod($storeId: String!, $orderId: String!) {
        subscriptionOrders(storeId: $storeId, filter: { id: { eq: $orderId } }) {
          id
          currentPeriodStart
          currentPeriodEnd
        }
      }`,
      variables: { orderId, storeId },
    });
    if (response.errors?.length || !response.data) {
      throw new WaffoPaymentPeriodUnavailableError(orderId);
    }
    const order = response.data.subscriptionOrders.find(
      (candidate) => candidate.id === orderId
    );
    const periodStartsAt = order?.currentPeriodStart?.trim();
    const periodEndsAt = order?.currentPeriodEnd?.trim();
    if (!periodStartsAt || !periodEndsAt) {
      throw new WaffoPaymentPeriodUnavailableError(orderId);
    }
    const startsAt = Date.parse(periodStartsAt);
    const endsAt = Date.parse(periodEndsAt);
    if (
      !Number.isFinite(startsAt) ||
      !Number.isFinite(endsAt) ||
      endsAt <= startsAt
    ) {
      throw new WaffoPaymentPeriodUnavailableError(orderId);
    }
    return { ...event, periodEndsAt, periodStartsAt };
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

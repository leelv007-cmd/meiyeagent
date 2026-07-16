import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProviderName,
  Price,
  ServerCatalogOffer,
  VerifiedPaymentWebhookEvent,
} from './types';

export interface ProStudioAddOnOffer {
  offerId: string;
  price: Price;
  priceLabel: string;
}

export interface ProStudioActivationClaim {
  activationAttempts: number;
  offerId: string;
  ownerUserId: string;
  paymentEventId: string;
  paymentId: string;
  provider: PaymentProviderName;
  providerCheckoutId: string;
  providerEventId: string;
  workspaceId: string;
}

export type ProStudioPaymentClaimStatus = 'pending' | 'activating' | 'active';

interface MainPlanCatalog {
  findPlanByPriceId(priceId: string): { id: string } | undefined;
}

export interface ProStudioCommerceStore {
  getLatestWorkspaceClaimStatus(
    workspaceId: string
  ): Promise<ProStudioPaymentClaimStatus | null>;
  createOwnerBinding(input: {
    interval?: Price['interval'];
    offerId: string;
    ownerSessionId: string;
    ownerUserId: string;
    paymentType: Price['type'];
    priceId: string;
    provider: PaymentProviderName;
    workspaceId: string;
  }): Promise<{ id: string } | null>;
  attachProviderCheckout(input: {
    bindingId: string;
    providerCheckoutId: string;
  }): Promise<void>;
  markCheckoutFailed(bindingId: string): Promise<void>;
  claimPaidCheckout(
    event: VerifiedPaymentWebhookEvent
  ): Promise<ProStudioActivationClaim | null>;
  leaseActivation(
    paymentEventId: string
  ): Promise<ProStudioActivationClaim | null>;
  leaseNextActivation(): Promise<ProStudioActivationClaim | null>;
  markActivated(paymentEventId: string): Promise<void>;
  markActivationFailed(input: {
    availableAt: Date;
    errorCode: 'CANVAS_ACTIVATION_FAILED';
    paymentEventId: string;
  }): Promise<void>;
}

export class ProStudioCommerceError extends Error {
  constructor(
    readonly code:
      | 'CHECKOUT_FAILED'
      | 'CHECKOUT_UNAVAILABLE'
      | 'ACTIVATION_PENDING'
      | 'ALREADY_PURCHASED'
      | 'OWNER_REQUIRED',
    message: string
  ) {
    super(message);
    this.name = 'ProStudioCommerceError';
  }
}

export function resolveProStudioAddOnOffer(
  environment: Record<string, string | undefined>,
  mainCatalog: MainPlanCatalog
): ProStudioAddOnOffer {
  const offerId = environment.PRO_STUDIO_OFFER_ID?.trim();
  const priceId = environment.PRO_STUDIO_PRICE_ID?.trim();
  const currency = environment.PRO_STUDIO_CURRENCY?.trim().toUpperCase();
  const amountText = environment.PRO_STUDIO_AMOUNT_CENTS?.trim();
  const paymentType = environment.PRO_STUDIO_PAYMENT_TYPE?.trim();
  const interval = environment.PRO_STUDIO_INTERVAL?.trim();
  const amount =
    amountText && /^\d+$/u.test(amountText) ? Number(amountText) : 0;
  if (
    !offerId ||
    !priceId ||
    !currency ||
    !/^[A-Z]{3}$/u.test(currency) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    paymentType !== 'one_time' ||
    mainCatalog.findPlanByPriceId(priceId)
  ) {
    throw checkoutUnavailable();
  }
  if (interval) {
    throw checkoutUnavailable();
  }
  const price: Price = {
    amount,
    currency,
    priceId,
    type: paymentType,
  };
  return {
    offerId,
    price,
    priceLabel: formatPriceLabel(price),
  };
}

export async function createProStudioCheckout(
  context: {
    customerEmail: string;
    customerName: string;
    ownerSessionId: string;
    ownerUserId: string;
    workspaceId: string;
  },
  options: {
    offer: ProStudioAddOnOffer;
    provider: {
      name: PaymentProviderName;
      createCheckout(input: CreateCheckoutParams): Promise<CheckoutResult>;
      validateServerCatalogOffer(offer: ServerCatalogOffer): Promise<void>;
    };
    store: ProStudioCommerceStore;
    urls: { cancelUrl: string; successUrl: string };
  }
) {
  const claimStatus = await options.store.getLatestWorkspaceClaimStatus(
    context.workspaceId
  );
  if (claimStatus === 'pending' || claimStatus === 'activating') {
    throw new ProStudioCommerceError(
      'ACTIVATION_PENDING',
      'Pro Studio purchase activation is already pending.'
    );
  }
  if (claimStatus === 'active') {
    throw new ProStudioCommerceError(
      'ALREADY_PURCHASED',
      'Pro Studio is already purchased for this workspace.'
    );
  }
  const serverCatalogOffer: ServerCatalogOffer = {
    kind: 'pro_studio_add_on',
    offerId: options.offer.offerId,
    price: options.offer.price,
  };
  const binding = await options.store.createOwnerBinding({
    interval: options.offer.price.interval,
    offerId: options.offer.offerId,
    ownerSessionId: context.ownerSessionId,
    ownerUserId: context.ownerUserId,
    paymentType: options.offer.price.type,
    priceId: options.offer.price.priceId,
    provider: options.provider.name,
    workspaceId: context.workspaceId,
  });
  if (!binding) {
    throw new ProStudioCommerceError(
      'OWNER_REQUIRED',
      'The current session must belong to the workspace owner.'
    );
  }
  try {
    await options.provider.validateServerCatalogOffer(serverCatalogOffer);
  } catch {
    await options.store.markCheckoutFailed(binding.id);
    throw checkoutUnavailable();
  }
  let checkout: CheckoutResult;
  try {
    checkout = await options.provider.createCheckout({
      cancelUrl: options.urls.cancelUrl,
      customerEmail: context.customerEmail,
      metadata: {
        proStudioBindingId: binding.id,
        proStudioOfferId: options.offer.offerId,
        userId: context.ownerUserId,
        userName: context.customerName,
      },
      planId: options.offer.offerId,
      priceId: options.offer.price.priceId,
      serverCatalogOffer,
      successUrl: options.urls.successUrl,
    });
  } catch {
    await options.store.markCheckoutFailed(binding.id);
    throw new ProStudioCommerceError(
      'CHECKOUT_FAILED',
      'Payment provider checkout failed.'
    );
  }
  if (!checkout.id.trim() || !checkout.url.trim()) {
    await options.store.markCheckoutFailed(binding.id);
    throw new ProStudioCommerceError(
      'CHECKOUT_FAILED',
      'Payment provider returned an invalid checkout session.'
    );
  }
  await options.store.attachProviderCheckout({
    bindingId: binding.id,
    providerCheckoutId: checkout.id,
  });
  return { checkoutId: checkout.id, url: checkout.url };
}

export function isProStudioPaymentProviderReady(
  payment: { enable?: boolean; provider?: string } | undefined,
  environment: Record<string, string | undefined>
) {
  if (!payment?.enable) return false;
  if (payment.provider === 'stripe') {
    return Boolean(
      environment.STRIPE_SECRET_KEY?.trim() &&
        environment.STRIPE_WEBHOOK_SECRET?.trim()
    );
  }
  if (payment.provider === 'creem') {
    return Boolean(
      environment.CREEM_API_KEY?.trim() &&
        environment.CREEM_WEBHOOK_SECRET?.trim()
    );
  }
  return false;
}

export async function settleVerifiedProStudioPayment(
  event: VerifiedPaymentWebhookEvent,
  options: SettlementOptions
) {
  const claim = await options.store.claimPaidCheckout(event);
  if (!claim) return { status: 'not_applicable' as const };
  const leased = await options.store.leaseActivation(claim.paymentEventId);
  if (!leased) return { status: 'pending_retry' as const };
  try {
    await options.activate(leased);
    await options.store.markActivated(leased.paymentEventId);
    return { status: 'activated' as const };
  } catch (error) {
    await deferActivation(leased, options);
    throw error;
  }
}

export async function settlePendingProStudioActivations(
  options: SettlementOptions & { limit: number }
) {
  let activated = 0;
  let failed = 0;
  for (let index = 0; index < options.limit; index += 1) {
    const claim = await options.store.leaseNextActivation();
    if (!claim) break;
    try {
      await options.activate(claim);
      await options.store.markActivated(claim.paymentEventId);
      activated += 1;
    } catch {
      await deferActivation(claim, options);
      failed += 1;
    }
  }
  return { activated, failed };
}

interface SettlementOptions {
  activate(claim: ProStudioActivationClaim): Promise<void>;
  clock?: () => Date;
  store: ProStudioCommerceStore;
}

async function deferActivation(
  claim: ProStudioActivationClaim,
  options: SettlementOptions
) {
  const retrySeconds = 2 ** Math.min(Math.max(claim.activationAttempts, 1), 8);
  await options.store.markActivationFailed({
    availableAt: new Date(
      (options.clock?.() ?? new Date()).getTime() + retrySeconds * 1_000
    ),
    errorCode: 'CANVAS_ACTIVATION_FAILED',
    paymentEventId: claim.paymentEventId,
  });
}

function checkoutUnavailable() {
  return new ProStudioCommerceError(
    'CHECKOUT_UNAVAILABLE',
    'Pro Studio add-on checkout is not fully configured.'
  );
}

function formatPriceLabel(price: Price) {
  const amount = price.amount / 100;
  const renderedAmount = Number.isInteger(amount)
    ? String(amount)
    : amount.toFixed(2);
  const value =
    price.currency === 'CNY'
      ? `¥${renderedAmount}`
      : `${price.currency} ${renderedAmount}`;
  return `${value} 一次性`;
}

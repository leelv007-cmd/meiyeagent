import type { Entitlement } from '@meiye/contracts';
import type { PaymentStatus, PaymentType } from '@/payment/types';

interface PaymentEntitlementFact {
  paid: boolean;
  periodEnd: Date | null;
  priceId: string;
  status: PaymentStatus;
  type: PaymentType;
}

/** Price ids that map to growth (monthly/yearly subscription catalog). */
export function configuredGrowthPriceIds(env: NodeJS.ProcessEnv) {
  return new Set(
    [
      env.VITE_STRIPE_PRICE_PRO_MONTHLY,
      env.VITE_STRIPE_PRICE_PRO_YEARLY,
      env.VITE_CREEM_PRODUCT_PRO_MONTHLY,
      env.VITE_CREEM_PRODUCT_PRO_YEARLY,
    ].filter((value): value is string => Boolean(value))
  );
}

/** Price ids that map to pro (lifetime / one-time buyout). Tc-3 default. */
export function configuredProPriceIds(env: NodeJS.ProcessEnv) {
  return new Set(
    [env.VITE_STRIPE_PRICE_LIFETIME, env.VITE_CREEM_PRODUCT_LIFETIME].filter(
      (value): value is string => Boolean(value)
    )
  );
}

/** All paid plan price ids (growth + pro) for legacy payment fact queries. */
export function configuredPaidPlanPriceIds(env: NodeJS.ProcessEnv) {
  return new Set([
    ...configuredGrowthPriceIds(env),
    ...configuredProPriceIds(env),
  ]);
}

/**
 * Resolve a payment fact to a foundation/product plan tier.
 * Defaults: monthly/yearly → growth, lifetime one-time → pro.
 * free → trial is NOT a payment event (Tb register_gift).
 */
export function resolvePaymentEntitlement(
  payment: PaymentEntitlementFact,
  growthPriceIds: ReadonlySet<string>,
  currentTime = new Date(),
  proPriceIds: ReadonlySet<string> = new Set()
): Entitlement['plan'] {
  if (!payment.paid) return 'starter';

  const isProPrice = proPriceIds.has(payment.priceId);
  const isGrowthPrice = growthPriceIds.has(payment.priceId);
  if (!isProPrice && !isGrowthPrice) return 'starter';

  if (payment.type === 'one_time') {
    if (payment.status !== 'completed') return 'starter';
    return isProPrice ? 'pro' : 'growth';
  }

  if (
    payment.periodEnd &&
    payment.periodEnd.getTime() <= currentTime.getTime()
  ) {
    return 'starter';
  }
  if (payment.status === 'active' || payment.status === 'trialing') {
    return isProPrice ? 'pro' : 'growth';
  }
  // Cancel at period end: keep paid tier until periodEnd (end-of-period fall back).
  if (payment.status === 'canceled' && payment.periodEnd) {
    return isProPrice ? 'pro' : 'growth';
  }
  return 'starter';
}

/** Map price id + interval to tier for webhook → payment_grant (Tc-3). */
export function resolvePaidPlanTier(input: {
  priceId: string;
  interval?: 'month' | 'year' | 'lifetime' | 'one_time' | null;
  env?: NodeJS.ProcessEnv;
}): 'growth' | 'pro' {
  const env = input.env ?? process.env;
  if (configuredProPriceIds(env).has(input.priceId)) return 'pro';
  if (configuredGrowthPriceIds(env).has(input.priceId)) return 'growth';
  if (input.interval === 'lifetime' || input.interval === 'one_time') {
    return 'pro';
  }
  return 'growth';
}

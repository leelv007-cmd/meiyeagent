import type { Entitlement } from '@meiye/contracts';
import type { PaymentStatus, PaymentType } from '@/payment/types';

interface PaymentEntitlementFact {
  paid: boolean;
  periodEnd: Date | null;
  priceId: string;
  status: PaymentStatus;
  type: PaymentType;
}

export function configuredGrowthPriceIds(env: NodeJS.ProcessEnv) {
  return new Set(
    [
      env.VITE_STRIPE_PRICE_PRO_MONTHLY,
      env.VITE_STRIPE_PRICE_PRO_YEARLY,
      env.VITE_STRIPE_PRICE_LIFETIME,
      env.VITE_CREEM_PRODUCT_PRO_MONTHLY,
      env.VITE_CREEM_PRODUCT_PRO_YEARLY,
      env.VITE_CREEM_PRODUCT_LIFETIME,
    ].filter((value): value is string => Boolean(value))
  );
}

export function resolvePaymentEntitlement(
  payment: PaymentEntitlementFact,
  growthPriceIds: ReadonlySet<string>,
  currentTime = new Date()
): Entitlement['plan'] {
  if (!payment.paid || !growthPriceIds.has(payment.priceId)) {
    return 'starter';
  }
  if (payment.type === 'one_time') {
    return payment.status === 'completed' ? 'growth' : 'starter';
  }
  if (
    payment.periodEnd &&
    payment.periodEnd.getTime() <= currentTime.getTime()
  ) {
    return 'starter';
  }
  if (payment.status === 'active' || payment.status === 'trialing') {
    return 'growth';
  }
  if (payment.status === 'canceled' && payment.periodEnd) {
    return 'growth';
  }
  return 'starter';
}

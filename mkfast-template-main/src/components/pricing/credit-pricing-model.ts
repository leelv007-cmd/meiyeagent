import type {
  PublicPlanOffer,
  publicPlanBillingCycles,
} from '@meiye/contracts';

export type PricingBillingCycle = (typeof publicPlanBillingCycles)[number];

const MICROS_PER_CURRENCY_UNIT = 1_000_000;

export function planPriceForCycle(
  plan: PublicPlanOffer,
  cycle: PricingBillingCycle
) {
  const published = plan.cyclePrices.find((price) => price.cycle === cycle);
  if (!published) {
    throw new Error(`Published price is missing for ${plan.id}:${cycle}.`);
  }
  const months = cycle === 'yearly' ? 12 : 1;
  return {
    amountMicros: published.amountMicros,
    originalAmountMicros:
      Math.round(
        (plan.monthlyPriceMicros * months) / MICROS_PER_CURRENCY_UNIT
      ) * MICROS_PER_CURRENCY_UNIT,
  };
}

export function formatPublishedPrice(
  amountMicros: number,
  currency: string,
  locale: string
) {
  return new Intl.NumberFormat(locale, {
    currency,
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(amountMicros / MICROS_PER_CURRENCY_UNIT);
}

export function publishedReferenceOutputs(plan: PublicPlanOffer) {
  return { ...plan.referenceOutputs };
}

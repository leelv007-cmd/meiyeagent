import {
  pricing_output_plan_growth,
  pricing_output_plan_pro,
  pricing_output_plan_starter,
  pricing_output_plan_trial,
} from '@/locale/paraglide/messages';
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

/**
 * Plan names live on /pricing only (#336), so they resolve in exactly one
 * place. /contact reads them too now — a merchant who asked to be told when a
 * plan opens should see that plan named back to her.
 */
export const PLAN_NAME: Record<PublicPlanOffer['id'], () => string> = {
  trial: pricing_output_plan_trial,
  starter: pricing_output_plan_starter,
  growth: pricing_output_plan_growth,
  pro: pricing_output_plan_pro,
};

/** Resolves an untrusted plan id (a URL parameter) to its published name. */
export function planDisplayName(planId: string): string | null {
  const resolve = PLAN_NAME[planId as PublicPlanOffer['id']];
  return resolve ? resolve() : null;
}

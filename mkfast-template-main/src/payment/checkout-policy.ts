import { z } from 'zod';
import type { Price, PricePlan } from './types';

export const STRIPE_NEW_COMMERCE_RETIRED =
  'STRIPE_NEW_COMMERCE_RETIRED' as const;

export class StripeNewCommerceRetiredError extends Error {
  readonly code = STRIPE_NEW_COMMERCE_RETIRED;

  constructor() {
    super(
      'Stripe new commerce is retired; only controlled historical webhook processing remains.'
    );
    this.name = 'StripeNewCommerceRetiredError';
  }
}

export interface CheckoutCatalogLookup {
  findPlanByPlanId(planId: string): PricePlan | undefined;
  findPriceInPlan(planId: string, priceId: string): Price | undefined;
}

export interface SellableCheckoutSelection {
  plan: PricePlan;
  price: Price;
}

/**
 * Waffo checkout is deliberately Test-only until Production commerce is
 * explicitly authorized. Webhook verification keeps its own environment
 * authority and is not affected by this checkout gate.
 */
export function requireWaffoTestCheckoutAuthority(
  authority: unknown
): asserts authority is 'test' {
  if (authority !== 'test') {
    throw new Error('Waffo checkout requires WAFFO_ENVIRONMENT=test.');
  }
}

export function requireSellableCheckoutPrice(
  input: { planId: string; priceId: string },
  catalog: CheckoutCatalogLookup
): SellableCheckoutSelection {
  const plan = catalog.findPlanByPlanId(input.planId);
  const price = catalog.findPriceInPlan(input.planId, input.priceId);
  if (
    !plan ||
    !price ||
    plan.disabled ||
    price.disabled ||
    plan.isFree ||
    price.priceId !== input.priceId ||
    !price.priceId.trim() ||
    !Number.isSafeInteger(price.amount) ||
    price.amount <= 0 ||
    !/^[A-Z]{3}$/u.test(price.currency)
  ) {
    throw new Error('The requested plan and price are not available.');
  }

  if (
    (price.type === 'subscription' &&
      (plan.isLifetime || !isSubscriptionInterval(price.interval))) ||
    (price.type === 'one_time' && (!plan.isLifetime || price.interval != null))
  ) {
    throw new Error('The requested price has an invalid billing contract.');
  }

  return { plan, price };
}

function isSubscriptionInterval(interval: Price['interval']) {
  return (
    interval === 'single_month' ||
    interval === 'monthly' ||
    interval === 'yearly' ||
    interval === 'month' ||
    interval === 'year'
  );
}

export function createCheckoutInputSchema(catalog: CheckoutCatalogLookup) {
  return z
    .object({
      planId: z.string().min(1),
      priceId: z.string().min(1),
      metadata: z.record(z.string(), z.string()).optional(),
      workspaceId: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((input, context) => {
      try {
        requireSellableCheckoutPrice(input, catalog);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message:
            error instanceof Error
              ? error.message
              : 'The requested plan and price are not available.',
          path: ['priceId'],
        });
      }
    });
}

export const portalInputSchema = z
  .object({
    locale: z.string().optional(),
  })
  .strict();

/**
 * Tc-3: payment catalog → foundation ProductPlanTier mapping.
 *
 * Single truth for paid grants is Foundation commerce (`payment_grant` /
 * `checkout_plan`). Defaults: monthly/yearly → growth, lifetime → pro.
 * Admin can override via `plan.payment-mapping` config.
 *
 * free → trial is NOT a payment event (belongs to workspace provision / Tb).
 */

import type { ProductPlanTier } from './domain.js';

export type PaymentMappingInterval =
  | 'single_month'
  | 'monthly'
  | 'yearly'
  | 'month'
  | 'year'
  | 'lifetime'
  | 'one_time'
  | 'any';

export interface PaymentProductMapping {
  paymentProductId: string;
  interval?: PaymentMappingInterval;
  tier: ProductPlanTier;
}

export interface PaymentMappingConfig {
  mappings: PaymentProductMapping[];
}

export interface ResolvePaymentTierInput {
  /** Provider price / product id from checkout or invoice. */
  paymentProductId: string;
  /** Billing interval when known; lifetime one-time uses 'lifetime'. */
  interval?: PaymentMappingInterval | null;
  /** Admin-config mappings (optional). */
  config?: PaymentMappingConfig | null;
  /**
   * Fallback catalog of known price ids when config is empty.
   * Keys are price ids; value is interval hint for default tier rules.
   */
  defaultPriceCatalog?: ReadonlyMap<
    string,
    PaymentMappingInterval | 'subscription'
  >;
}

const DEFAULT_INTERVAL_TIERS: Record<
  Exclude<PaymentMappingInterval, 'any'>,
  ProductPlanTier
> = {
  month: 'growth',
  year: 'growth',
  single_month: 'growth',
  monthly: 'growth',
  yearly: 'growth',
  lifetime: 'pro',
  one_time: 'pro',
};

/** Built-in defaults when neither admin config nor catalog match. */
export function defaultTierForInterval(
  interval: PaymentMappingInterval | null | undefined
): ProductPlanTier {
  if (!interval || interval === 'any') return 'growth';
  return DEFAULT_INTERVAL_TIERS[interval] ?? 'growth';
}

/**
 * Resolve a payment product to a foundation plan tier.
 * Priority: exact (productId+interval) → productId+any → default catalog →
 * interval default rules.
 */
export function resolvePaymentTier(
  input: ResolvePaymentTierInput
): ProductPlanTier {
  const productId = input.paymentProductId.trim();
  if (!productId) return 'growth';

  const mappings = input.config?.mappings ?? [];
  const interval = normalizeInterval(input.interval);

  const exact = mappings.find(
    (row) =>
      row.paymentProductId === productId &&
      normalizeInterval(row.interval ?? 'any') === interval
  );
  if (exact) return exact.tier;

  const anyMatch = mappings.find(
    (row) =>
      row.paymentProductId === productId &&
      normalizeInterval(row.interval ?? 'any') === 'any'
  );
  if (anyMatch) return anyMatch.tier;

  const catalogInterval = input.defaultPriceCatalog?.get(productId);
  if (catalogInterval) {
    const mapped =
      catalogInterval === 'subscription'
        ? interval === 'year'
          ? 'year'
          : 'month'
        : catalogInterval;
    return defaultTierForInterval(mapped);
  }

  return defaultTierForInterval(interval);
}

/**
 * Build default env-based price catalog used when admin-config is empty.
 * monthly/yearly price ids → growth; lifetime → pro.
 */
export function defaultPriceCatalogFromEnv(env: {
  monthly?: string | null;
  yearly?: string | null;
  lifetime?: string | null;
  extraGrowth?: readonly string[];
  extraPro?: readonly string[];
}): Map<string, PaymentMappingInterval | 'subscription'> {
  const catalog = new Map<string, PaymentMappingInterval | 'subscription'>();
  for (const id of [env.monthly, ...(env.extraGrowth ?? [])]) {
    if (id?.trim()) catalog.set(id.trim(), 'month');
  }
  if (env.yearly?.trim()) catalog.set(env.yearly.trim(), 'year');
  for (const id of [env.lifetime, ...(env.extraPro ?? [])]) {
    if (id?.trim()) catalog.set(id.trim(), 'lifetime');
  }
  return catalog;
}

function normalizeInterval(
  value: PaymentMappingInterval | null | undefined
): PaymentMappingInterval {
  if (
    value === 'single_month' ||
    value === 'monthly' ||
    value === 'yearly' ||
    value === 'month' ||
    value === 'year' ||
    value === 'lifetime' ||
    value === 'one_time' ||
    value === 'any'
  ) {
    return value;
  }
  return 'any';
}

/**
 * Build billing period from provider facts.
 * Prefer provider period; fall back to UTC calendar month for month, or
 * +1 year for year, or far-future for lifetime.
 */
export function billingPeriodFromProvider(input: {
  interval?: PaymentMappingInterval | null;
  periodStartsAt?: string | null;
  periodEndsAt?: string | null;
  clock?: () => Date;
}): {
  periodId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  periodStrategy: 'calendar_month' | 'fixed_days' | 'provider_period';
} {
  const clock = input.clock ?? (() => new Date());
  const starts = parseIso(input.periodStartsAt) ?? startOfUtcMonth(clock());
  let ends = parseIso(input.periodEndsAt);

  if (!ends) {
    const interval = normalizeInterval(input.interval);
    if (interval === 'year' || interval === 'yearly') {
      ends = new Date(
        Date.UTC(
          starts.getUTCFullYear() + 1,
          starts.getUTCMonth(),
          starts.getUTCDate(),
          starts.getUTCHours(),
          starts.getUTCMinutes(),
          starts.getUTCSeconds(),
          starts.getUTCMilliseconds()
        )
      );
    } else if (interval === 'lifetime' || interval === 'one_time') {
      // Lifetime: long fixed window so periodEndsAt is real but far out.
      ends = new Date(
        Date.UTC(
          starts.getUTCFullYear() + 100,
          starts.getUTCMonth(),
          starts.getUTCDate()
        )
      );
    } else {
      ends = new Date(
        Date.UTC(starts.getUTCFullYear(), starts.getUTCMonth() + 1, 1)
      );
      if (!input.periodStartsAt) {
        const monthStart = startOfUtcMonth(clock());
        return {
          periodId: monthStart.toISOString().slice(0, 7),
          periodStartsAt: monthStart.toISOString(),
          periodEndsAt: ends.toISOString(),
          periodStrategy: 'calendar_month',
        };
      }
    }
  }

  const periodId = `provider-${starts.toISOString().slice(0, 10)}-${ends
    .toISOString()
    .slice(0, 10)}`;
  return {
    periodId,
    periodStartsAt: starts.toISOString(),
    periodEndsAt: ends.toISOString(),
    periodStrategy: 'provider_period',
  };
}

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

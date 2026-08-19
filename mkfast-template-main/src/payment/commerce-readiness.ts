import type {
  CommercePlanCatalogSnapshot,
  PublicPlanCatalog,
} from '@meiye/contracts';

import type { WaffoEnvironment } from './waffo-environment';

const PAID_PLAN_IDS = ['starter', 'growth', 'pro'] as const;
const BILLING_CYCLES = ['single_month', 'monthly', 'yearly'] as const;

export interface WaffoSubscriptionProductFacts {
  amount: string;
  currency: string;
  productId: string;
  status: string;
}

export interface WaffoCreditPackageProductFacts
  extends WaffoSubscriptionProductFacts {
  metadata: Record<string, unknown> | string | null;
}

export interface CommerceReadinessPorts {
  checkoutAuthority: {
    creditPackageProductMapping?: string;
    environment: WaffoEnvironment;
    merchantId?: string;
    privateKey?: string;
    provider?: string;
    storeId?: string;
    testCheckoutEnabled: boolean;
  };
  readCoreSnapshot(): Promise<CommercePlanCatalogSnapshot>;
  readCreditPackageProductFacts(
    productIds: readonly string[]
  ): Promise<readonly WaffoCreditPackageProductFacts[]>;
  readSubscriptionProductFacts(
    productIds: readonly string[]
  ): Promise<readonly WaffoSubscriptionProductFacts[]>;
}

export interface CommerceReadiness {
  addOnCheckoutReady: boolean;
  catalog: PublicPlanCatalog;
  planCheckoutReady: boolean;
  planRevision: string;
  paymentMappingRevision: number | null;
  portalReady: boolean;
  ready: boolean;
  reasonCodes: string[];
}

export interface CommerceReadyPlanSelection {
  amountMicros: number;
  currency: 'HKD';
  cycle: (typeof BILLING_CYCLES)[number];
  planId: (typeof PAID_PLAN_IDS)[number];
  planRevision: string;
  productId: string;
  mappedProducts: Array<{
    interval: (typeof BILLING_CYCLES)[number];
    paymentProductId: string;
    tier: (typeof PAID_PLAN_IDS)[number];
  }>;
  paymentMappingRevision: number;
}

export async function evaluateCommerceReadiness(
  ports: CommerceReadinessPorts
): Promise<CommerceReadiness> {
  const snapshot = await ports.readCoreSnapshot();
  const baseReasons = checkoutAuthorityReasons(ports.checkoutAuthority);
  const portalReady = baseReasons.length === 0;
  const planReasons = [...baseReasons];
  const addOnReasons = [...baseReasons];

  const mapping = completePlanMapping(snapshot);
  if (!mapping) planReasons.push('payment_mapping_incomplete');

  const addOnMapping = completeAddOnMapping(
    snapshot.catalog,
    ports.checkoutAuthority.creditPackageProductMapping
  );
  if (!addOnMapping) addOnReasons.push('add_on_mapping_incomplete');

  if (planReasons.length === 0 && mapping) {
    try {
      const facts = await ports.readSubscriptionProductFacts(
        mapping.map((entry) => entry.paymentProductId)
      );
      if (!subscriptionFactsMatch(snapshot.catalog, mapping, facts)) {
        planReasons.push('subscription_provider_facts_drift');
      }
    } catch {
      planReasons.push('subscription_provider_facts_unavailable');
    }
  }

  if (addOnReasons.length === 0 && addOnMapping) {
    try {
      const facts = await ports.readCreditPackageProductFacts(
        addOnMapping.map((entry) => entry.productId)
      );
      if (!addOnFactsMatch(snapshot.catalog, addOnMapping, facts)) {
        addOnReasons.push('add_on_provider_facts_drift');
      }
    } catch {
      addOnReasons.push('add_on_provider_facts_unavailable');
    }
  }

  const planCheckoutReady = planReasons.length === 0;
  const addOnCheckoutReady = addOnReasons.length === 0;
  const reasonCodes = [...new Set([...planReasons, ...addOnReasons])];
  return {
    addOnCheckoutReady,
    catalog: snapshot.catalog,
    planCheckoutReady,
    planRevision: snapshot.planRevision,
    paymentMappingRevision: snapshot.paymentMapping?.revision ?? null,
    portalReady,
    ready: planCheckoutReady && addOnCheckoutReady && portalReady,
    reasonCodes,
  };
}

export async function executeCommerceReadyPlanCheckout<T>(
  input: {
    cycle: (typeof BILLING_CYCLES)[number];
    planId: (typeof PAID_PLAN_IDS)[number];
  },
  ports: CommerceReadinessPorts,
  checkout: (selection: CommerceReadyPlanSelection) => Promise<T>
): Promise<T> {
  const readiness = await evaluateCommerceReadiness(ports);
  if (!readiness.planCheckoutReady) {
    throw new Error('Commerce is not ready for plan checkout.');
  }
  const snapshot = await ports.readCoreSnapshot();
  if (snapshot.planRevision !== readiness.planRevision) {
    throw new Error('Commerce is not ready: Core plan revision changed.');
  }
  if (snapshot.paymentMapping?.revision !== readiness.paymentMappingRevision) {
    throw new Error('Commerce is not ready: payment mapping revision changed.');
  }
  const mapping = completePlanMapping(snapshot);
  const mapped = mapping?.find(
    (entry) => entry.tier === input.planId && entry.interval === input.cycle
  );
  const plan = snapshot.catalog.plans.find(
    (candidate) => candidate.id === input.planId
  );
  const price = plan?.cyclePrices.find(
    (candidate) => candidate.cycle === input.cycle
  );
  if (!mapping || !mapped || !plan || !price || price.amountMicros <= 0) {
    throw new Error('Commerce is not ready for the requested plan checkout.');
  }
  return checkout({
    amountMicros: price.amountMicros,
    currency: plan.currency,
    cycle: input.cycle,
    planId: input.planId,
    planRevision: snapshot.planRevision,
    productId: mapped.paymentProductId,
    mappedProducts: mapping.map((entry) => ({ ...entry })),
    paymentMappingRevision: snapshot.paymentMapping!.revision,
  });
}

function checkoutAuthorityReasons(
  authority: CommerceReadinessPorts['checkoutAuthority']
) {
  const reasons: string[] = [];
  if (authority.provider !== 'waffo') reasons.push('provider_not_waffo');
  if (authority.environment !== 'test') reasons.push('environment_not_allowed');
  if (!authority.testCheckoutEnabled) reasons.push('checkout_mode_disabled');
  if (!authority.merchantId?.trim()) reasons.push('merchant_id_absent');
  if (!authority.privateKey?.trim()) reasons.push('private_key_absent');
  if (!authority.storeId?.trim()) reasons.push('store_id_absent');
  return reasons;
}

function completePlanMapping(snapshot: CommercePlanCatalogSnapshot) {
  const mappings = snapshot.paymentMapping?.mappings;
  if (!mappings || mappings.length !== 9) return null;
  const combinations = new Set<string>();
  const productIds = new Set<string>();
  for (const mapping of mappings) {
    const combination = `${mapping.tier}:${mapping.interval}`;
    if (
      combinations.has(combination) ||
      productIds.has(mapping.paymentProductId)
    ) {
      return null;
    }
    combinations.add(combination);
    productIds.add(mapping.paymentProductId);
  }
  const complete = PAID_PLAN_IDS.every((tier) =>
    BILLING_CYCLES.every((cycle) => combinations.has(`${tier}:${cycle}`))
  );
  return complete ? mappings : null;
}

function completeAddOnMapping(
  catalog: PublicPlanCatalog,
  serialized: string | undefined
) {
  if (!serialized?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const record = parsed as Record<string, unknown>;
  const entries = catalog.addOns.map((offer) => {
    const productId = record[offer.id];
    return {
      offerId: offer.id,
      productId: typeof productId === 'string' ? productId.trim() : '',
    };
  });
  if (
    entries.some((entry) => !entry.productId) ||
    new Set(entries.map((entry) => entry.productId)).size !== entries.length
  ) {
    return null;
  }
  return entries;
}

function subscriptionFactsMatch(
  catalog: PublicPlanCatalog,
  mappings: NonNullable<ReturnType<typeof completePlanMapping>>,
  facts: readonly WaffoSubscriptionProductFacts[]
) {
  if (facts.length !== mappings.length) return false;
  const factsById = new Map(facts.map((fact) => [fact.productId, fact]));
  return mappings.every((mapping) => {
    const plan = catalog.plans.find(
      (candidate) => candidate.id === mapping.tier
    );
    const price = plan?.cyclePrices.find(
      (candidate) => candidate.cycle === mapping.interval
    );
    const fact = factsById.get(mapping.paymentProductId);
    return Boolean(
      plan &&
        price &&
        fact &&
        fact.status === 'active' &&
        fact.currency === plan.currency &&
        fact.amount === amountString(price.amountMicros)
    );
  });
}

function addOnFactsMatch(
  catalog: PublicPlanCatalog,
  mappings: NonNullable<ReturnType<typeof completeAddOnMapping>>,
  facts: readonly WaffoCreditPackageProductFacts[]
) {
  if (facts.length !== mappings.length) return false;
  const factsById = new Map(facts.map((fact) => [fact.productId, fact]));
  return mappings.every((mapping) => {
    const offer = catalog.addOns.find(
      (candidate) => candidate.id === mapping.offerId
    );
    const fact = factsById.get(mapping.productId);
    const metadata = fact ? normalizedMetadata(fact.metadata) : null;
    return Boolean(
      offer &&
        fact &&
        fact.status === 'active' &&
        fact.currency === offer.currency &&
        fact.amount === amountString(offer.amountMicros) &&
        metadata?.commerceSku === offer.id &&
        metadata.credits === offer.credits &&
        metadata.expireDays === offer.expireDays
    );
  });
}

function normalizedMetadata(metadata: Record<string, unknown> | string | null) {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return metadata;
}

function amountString(amountMicros: number) {
  return (amountMicros / 1_000_000).toFixed(2);
}

type PaymentProvider = 'stripe' | 'creem' | 'waffo' | '';

interface PaymentPriceIds {
  growthMonthly?: string;
  growthSingleMonth?: string;
  growthYearly?: string;
  proMonthly?: string;
  proSingleMonth?: string;
  proYearly?: string;
  lifetime?: string;
  starterMonthly?: string;
  starterSingleMonth?: string;
  starterYearly?: string;
}

interface PaymentRuntimePolicyInput {
  provider: PaymentProvider;
  publicPaidLaunchEnabled: boolean;
  creemPriceIds: PaymentPriceIds;
  waffoProductIds?: PaymentPriceIds;
}

interface PaymentRuntimePolicy {
  enabled: boolean;
  provider: Exclude<PaymentProvider, ''> | undefined;
  priceIds: PaymentPriceIds;
}

const EMPTY_PRICE_IDS: PaymentPriceIds = {
  proMonthly: '',
  proYearly: '',
  lifetime: '',
};

export function resolvePaymentRuntimePolicy({
  provider,
  publicPaidLaunchEnabled,
  creemPriceIds,
  waffoProductIds = {},
}: PaymentRuntimePolicyInput): PaymentRuntimePolicy {
  if (provider === 'stripe') {
    return { enabled: true, provider, priceIds: { ...EMPTY_PRICE_IDS } };
  }

  if (provider === 'creem' && publicPaidLaunchEnabled) {
    return {
      enabled: true,
      provider,
      priceIds: {
        proMonthly: creemPriceIds.proMonthly ?? '',
        proYearly: creemPriceIds.proYearly ?? '',
        lifetime: creemPriceIds.lifetime ?? '',
      },
    };
  }

  if (
    provider === 'waffo' &&
    publicPaidLaunchEnabled &&
    hasCompleteWaffoCatalog(waffoProductIds)
  ) {
    return {
      enabled: true,
      provider,
      priceIds: {
        ...EMPTY_PRICE_IDS,
        ...waffoProductIds,
      },
    };
  }

  return {
    enabled: false,
    provider: undefined,
    priceIds: { ...EMPTY_PRICE_IDS },
  };
}

function hasCompleteWaffoCatalog(ids: PaymentPriceIds) {
  return [
    ids.starterSingleMonth,
    ids.starterMonthly,
    ids.starterYearly,
    ids.growthSingleMonth,
    ids.growthMonthly,
    ids.growthYearly,
    ids.proSingleMonth,
    ids.proMonthly,
    ids.proYearly,
  ].every((id) => Boolean(id?.trim()));
}

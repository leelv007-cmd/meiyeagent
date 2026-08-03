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

type ResolvedPaymentPriceIds = Required<PaymentPriceIds>;

interface PaymentRuntimePolicyInput {
  provider: PaymentProvider;
  publicPaidLaunchEnabled: boolean;
  waffoTestCheckoutEnabled?: boolean;
  creemPriceIds: PaymentPriceIds;
  waffoProductIds?: PaymentPriceIds;
}

interface PaymentRuntimePolicy {
  enabled: boolean;
  provider: Exclude<PaymentProvider, ''> | undefined;
  priceIds: ResolvedPaymentPriceIds;
}

const EMPTY_PRICE_IDS: ResolvedPaymentPriceIds = {
  growthMonthly: '',
  growthSingleMonth: '',
  growthYearly: '',
  proMonthly: '',
  proSingleMonth: '',
  proYearly: '',
  lifetime: '',
  starterMonthly: '',
  starterSingleMonth: '',
  starterYearly: '',
};

export function resolvePaymentRuntimePolicy({
  provider,
  publicPaidLaunchEnabled,
  waffoTestCheckoutEnabled = false,
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
        ...EMPTY_PRICE_IDS,
        proMonthly: creemPriceIds.proMonthly ?? '',
        proYearly: creemPriceIds.proYearly ?? '',
        lifetime: creemPriceIds.lifetime ?? '',
      },
    };
  }

  if (
    provider === 'waffo' &&
    waffoTestCheckoutEnabled &&
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

function hasCompleteWaffoCatalog(
  ids: PaymentPriceIds
): ids is ResolvedPaymentPriceIds {
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

type PaymentProvider = 'stripe' | 'waffo' | '';

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
  waffoTestCheckoutEnabled?: boolean;
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
  waffoTestCheckoutEnabled = false,
}: PaymentRuntimePolicyInput): PaymentRuntimePolicy {
  if (provider === 'stripe') {
    return { enabled: true, provider, priceIds: { ...EMPTY_PRICE_IDS } };
  }

  if (provider === 'waffo' && waffoTestCheckoutEnabled) {
    return {
      enabled: true,
      provider,
      priceIds: { ...EMPTY_PRICE_IDS },
    };
  }

  return {
    enabled: false,
    provider: undefined,
    priceIds: { ...EMPTY_PRICE_IDS },
  };
}

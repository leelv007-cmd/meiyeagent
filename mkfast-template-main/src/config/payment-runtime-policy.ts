type PaymentProvider = 'stripe' | 'creem' | '';

interface PaymentPriceIds {
  proMonthly?: string;
  proYearly?: string;
  lifetime?: string;
}

interface PaymentRuntimePolicyInput {
  provider: PaymentProvider;
  publicPaidLaunchEnabled: boolean;
  creemPriceIds: PaymentPriceIds;
}

interface PaymentRuntimePolicy {
  enabled: boolean;
  provider: Exclude<PaymentProvider, ''> | undefined;
  priceIds: Required<PaymentPriceIds>;
}

const EMPTY_PRICE_IDS: Required<PaymentPriceIds> = {
  proMonthly: '',
  proYearly: '',
  lifetime: '',
};

export function resolvePaymentRuntimePolicy({
  provider,
  publicPaidLaunchEnabled,
  creemPriceIds,
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

  return {
    enabled: false,
    provider: undefined,
    priceIds: { ...EMPTY_PRICE_IDS },
  };
}

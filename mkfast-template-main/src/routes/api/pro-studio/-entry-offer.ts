import {
  ProStudioCommerceError,
  resolveProStudioAddOnOffer,
  type ProStudioPaymentClaimStatus,
} from '@/payment/pro-studio-commerce';

interface LockedEntry {
  offer: {
    canPurchase: boolean;
    demoUrl: string;
    description: string;
    id: string;
    priceLabel: string;
    purchasePath: string;
  };
  status: 'locked';
}

export function withCanonicalProStudioOffer(
  entry: LockedEntry,
  environment: Record<string, string | undefined>,
  mainCatalog: {
    findPlanByPriceId(priceId: string): { id: string } | undefined;
  },
  paymentProviderReady: boolean,
  claimStatus: ProStudioPaymentClaimStatus | null = null
) {
  const claimPurchaseReason =
    claimStatus === 'pending' || claimStatus === 'activating'
      ? ('activation_pending' as const)
      : claimStatus === 'active'
        ? ('already_purchased' as const)
        : undefined;
  try {
    const offer = resolveProStudioAddOnOffer(environment, mainCatalog);
    if (!paymentProviderReady)
      throw new ProStudioCommerceError(
        'CHECKOUT_UNAVAILABLE',
        'Payment provider is unavailable.'
      );
    const purchaseReason =
      claimPurchaseReason ??
      (entry.offer.canPurchase ? undefined : ('owner_required' as const));
    return {
      ...entry,
      offer: {
        ...entry.offer,
        canPurchase: entry.offer.canPurchase && claimStatus === null,
        id: offer.offerId,
        priceLabel: offer.priceLabel,
        purchasePath: claimStatus === null ? '/api/pro-studio/checkout' : '',
        purchaseReason,
      },
    };
  } catch (error) {
    if (!(error instanceof ProStudioCommerceError)) throw error;
    return {
      ...entry,
      offer: {
        ...entry.offer,
        canPurchase: false,
        id: environment.PRO_STUDIO_OFFER_ID?.trim() || entry.offer.id,
        priceLabel: '价格暂不可用',
        purchasePath: '',
        purchaseReason: claimPurchaseReason ?? ('unavailable' as const),
      },
    };
  }
}

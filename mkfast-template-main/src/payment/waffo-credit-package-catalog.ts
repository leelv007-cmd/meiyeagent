export class WaffoCreditPackageCatalogError extends Error {
  readonly code = 'WAFFO_CREDIT_PACKAGE_CATALOG_INVALID' as const;

  constructor(message = 'Waffo credit package catalog is not configured.') {
    super(message);
    this.name = 'WaffoCreditPackageCatalogError';
  }
}

export const WAFFO_CREDIT_PACKAGE_OFFER_IDS = [
  'credits-100',
  'credits-300',
  'credits-1000',
] as const;

export type WaffoCreditPackageOfferId =
  (typeof WAFFO_CREDIT_PACKAGE_OFFER_IDS)[number];

export type WaffoCreditPackageOffer = {
  amount: string;
  credits: number;
  currency: 'HKD';
  expireDays: 7;
  offerId: WaffoCreditPackageOfferId;
};

export type CreditPackageSkuSnapshot = {
  amountMicros: number;
  currency: 'HKD';
  credits: number;
  expireDays: number;
  fingerprint: string;
};

export const WAFFO_CREDIT_PACKAGE_OFFERS = [
  {
    amount: '57.00',
    credits: 100,
    currency: 'HKD',
    expireDays: 7,
    offerId: 'credits-100',
  },
  {
    amount: '161.00',
    credits: 300,
    currency: 'HKD',
    expireDays: 7,
    offerId: 'credits-300',
  },
  {
    amount: '498.00',
    credits: 1_000,
    currency: 'HKD',
    expireDays: 7,
    offerId: 'credits-1000',
  },
] as const satisfies readonly WaffoCreditPackageOffer[];

export function resolveWaffoCreditPackageProduct(
  offerId: string,
  serializedMapping: string | undefined
) {
  const mapping = parseWaffoCreditPackageProductMapping(serializedMapping);
  const productId = mapping[offerId];
  if (!productId) {
    throw new WaffoCreditPackageCatalogError(
      'The requested Waffo credit package is not configured.'
    );
  }
  return productId;
}

export function resolveWaffoCreditPackageOffer(
  offerId: string
): WaffoCreditPackageOffer {
  const offer = WAFFO_CREDIT_PACKAGE_OFFERS.find(
    (candidate) => candidate.offerId === offerId
  );
  if (!offer) {
    throw new WaffoCreditPackageCatalogError(
      'The requested Waffo credit package is not configured.'
    );
  }
  return offer;
}

export function snapshotWaffoCreditPackageAddOn(input: {
  amountMicros: number;
  currency: string;
  credits: number;
  expireDays: number;
  id: string;
}): CreditPackageSkuSnapshot {
  if (
    input.currency !== 'HKD' ||
    !Number.isSafeInteger(input.amountMicros) ||
    input.amountMicros <= 0 ||
    !Number.isSafeInteger(input.credits) ||
    input.credits <= 0 ||
    !Number.isSafeInteger(input.expireDays) ||
    input.expireDays <= 0
  ) {
    throw new WaffoCreditPackageCatalogError(
      'Core credit package catalog contains invalid SKU facts.'
    );
  }
  return {
    amountMicros: input.amountMicros,
    currency: 'HKD',
    credits: input.credits,
    expireDays: input.expireDays,
    fingerprint: `${input.id}:${input.amountMicros}:${input.currency}:${input.credits}:${input.expireDays}`,
  };
}

/**
 * The signed one-time order must still match the server-selected Test SKU.
 * Waffo does not include a product id in every order webhook, so the durable
 * checkout binding is the product authority and the signed price is checked
 * against the same catalog before Core can grant credits.
 */
export function assertWaffoCreditPackagePaymentFacts(
  input: {
    amount: string | undefined;
    currency: string | undefined;
    offerId: string;
    productId: string;
  },
  serializedMapping: string | undefined
): void {
  const offer = resolveWaffoCreditPackageOffer(input.offerId);
  const expectedProductId = resolveWaffoCreditPackageProduct(
    input.offerId,
    serializedMapping
  );
  if (input.productId.trim() !== expectedProductId) {
    throw new WaffoCreditPackageCatalogError(
      'Credit package binding does not match the configured Waffo product.'
    );
  }
  if (normalizeAmount(input.amount) !== offer.amount) {
    throw new WaffoCreditPackageCatalogError(
      'Credit package amount does not match the Test catalog.'
    );
  }
  if (input.currency?.trim() !== offer.currency) {
    throw new WaffoCreditPackageCatalogError(
      'Credit package currency does not match the Test catalog.'
    );
  }
}

export function assertWaffoCreditPackageSnapshot(
  input: {
    amount: string | undefined;
    currency: string | undefined;
    snapshot: CreditPackageSkuSnapshot;
  }
): void {
  if (
    normalizeAmount(input.amount) !==
    (input.snapshot.amountMicros / 1_000_000).toFixed(2)
  ) {
    throw new WaffoCreditPackageCatalogError(
      'Credit package amount does not match the frozen checkout snapshot.'
    );
  }
  if (input.currency?.trim() !== input.snapshot.currency) {
    throw new WaffoCreditPackageCatalogError(
      'Credit package currency does not match the frozen checkout snapshot.'
    );
  }
}

function parseWaffoCreditPackageProductMapping(
  serializedMapping: string | undefined
): Record<string, string> {
  if (!serializedMapping?.trim()) {
    throw new WaffoCreditPackageCatalogError();
  }
  let value: unknown;
  try {
    value = JSON.parse(serializedMapping);
  } catch {
    throw new WaffoCreditPackageCatalogError();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WaffoCreditPackageCatalogError();
  }

  const mapping: Record<string, string> = {};
  const productIds = new Set<string>();
  for (const [offerId, productId] of Object.entries(value)) {
    if (!offerId.trim() || typeof productId !== 'string' || !productId.trim()) {
      throw new WaffoCreditPackageCatalogError();
    }
    const normalizedProductId = productId.trim();
    if (productIds.has(normalizedProductId)) {
      throw new WaffoCreditPackageCatalogError(
        'Credit package SKUs must not share a Waffo product.'
      );
    }
    productIds.add(normalizedProductId);
    mapping[offerId] = normalizedProductId;
  }
  const offerIds = Object.keys(mapping).sort();
  const expectedOfferIds = [...WAFFO_CREDIT_PACKAGE_OFFER_IDS].sort();
  if (
    offerIds.length !== expectedOfferIds.length ||
    !offerIds.every((offerId, index) => offerId === expectedOfferIds[index])
  ) {
    throw new WaffoCreditPackageCatalogError();
  }
  return mapping;
}

function normalizeAmount(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || !/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return `${whole.replace(/^0+(?=\d)/u, '')}.${fraction.padEnd(2, '0')}`;
}

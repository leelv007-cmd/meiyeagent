import type { ServerCatalogOffer } from '../types';

interface StripeCatalogPrice {
  active: boolean;
  currency: string;
  id: string;
  recurring: { interval: string } | null;
  type: string;
  unit_amount: number | null;
}

interface CreemCatalogProduct {
  billingPeriod: string;
  billingType: string;
  currency: string;
  id: string;
  price: number;
  status: string;
}

export function assertStripeServerCatalogOffer(
  offer: Pick<ServerCatalogOffer, 'offerId' | 'price'>,
  actual: StripeCatalogPrice
) {
  if (
    !actual.active ||
    actual.id !== offer.price.priceId ||
    actual.unit_amount !== offer.price.amount ||
    actual.currency.toUpperCase() !== offer.price.currency.toUpperCase() ||
    actual.type !== 'one_time' ||
    actual.recurring !== null ||
    offer.price.type !== 'one_time'
  ) {
    throw new Error('Stripe catalog does not match the canonical add-on.');
  }
}

export function assertCreemServerCatalogOffer(
  offer: Pick<ServerCatalogOffer, 'offerId' | 'price'>,
  actual: CreemCatalogProduct
) {
  if (
    actual.status !== 'active' ||
    actual.id !== offer.price.priceId ||
    actual.price !== offer.price.amount ||
    actual.currency.toUpperCase() !== offer.price.currency.toUpperCase() ||
    actual.billingType !== 'onetime' ||
    actual.billingPeriod !== 'once' ||
    offer.price.type !== 'one_time'
  ) {
    throw new Error('Creem catalog does not match the canonical add-on.');
  }
}

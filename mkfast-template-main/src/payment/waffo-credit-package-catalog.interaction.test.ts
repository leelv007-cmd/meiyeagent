import { describe, expect, it } from 'vitest';
import {
  assertWaffoCreditPackagePaymentFacts,
  WaffoCreditPackageCatalogError,
  resolveWaffoCreditPackageOffer,
  resolveWaffoCreditPackageProduct,
} from './waffo-credit-package-catalog';

describe('Waffo credit package catalog', () => {
  it('resolves a configured Test product only for its exact credit-package SKU', () => {
    expect(
      resolveWaffoCreditPackageProduct(
        'credits-300',
        JSON.stringify({
          'credits-100': 'PROD_CREDITS_100',
          'credits-300': 'PROD_CREDITS_300',
          'credits-1000': 'PROD_CREDITS_1000',
        })
      )
    ).toBe('PROD_CREDITS_300');
    expect(resolveWaffoCreditPackageOffer('credits-300')).toEqual({
      amount: '161.00',
      credits: 300,
      currency: 'HKD',
      expireDays: 7,
      offerId: 'credits-300',
    });
  });

  it('requires the signed order amount, currency, and binding product to match the Test SKU', () => {
    const mapping = JSON.stringify({
      'credits-100': 'PROD_CREDITS_100',
      'credits-300': 'PROD_CREDITS_300',
      'credits-1000': 'PROD_CREDITS_1000',
    });
    const input = {
      amount: '161.00',
      currency: 'HKD',
      offerId: 'credits-300',
      productId: 'PROD_CREDITS_300',
    };

    expect(() =>
      assertWaffoCreditPackagePaymentFacts(input, mapping)
    ).not.toThrow();
    for (const invalid of [
      { ...input, amount: '161.01' },
      { ...input, currency: 'CNY' },
      { ...input, productId: 'PROD_CREDITS_100' },
    ]) {
      expect(() =>
        assertWaffoCreditPackagePaymentFacts(invalid, mapping)
      ).toThrow(WaffoCreditPackageCatalogError);
    }
  });

  it.each([
    undefined,
    '',
    '{',
    '{"credits-300":""}',
  ])('fails closed when the Test catalog mapping is unavailable or invalid: %p', (mapping) => {
    expect(() =>
      resolveWaffoCreditPackageProduct('credits-300', mapping)
    ).toThrow(WaffoCreditPackageCatalogError);
  });

  it('rejects a product shared by two package SKUs', () => {
    expect(() =>
      resolveWaffoCreditPackageProduct(
        'credits-300',
        JSON.stringify({
          'credits-100': 'PROD_SHARED',
          'credits-300': 'PROD_SHARED',
        })
      )
    ).toThrow('must not share a Waffo product');
  });

  it.each([
    { 'credits-100': 'PROD_100', 'credits-300': 'PROD_300' },
    {
      'credits-100': 'PROD_100',
      'credits-300': 'PROD_300',
      'credits-1000': 'PROD_1000',
      'credits-5000': 'PROD_5000',
    },
  ])('rejects a mapping that is not the exact three-SKU catalog', (mapping) => {
    expect(() =>
      resolveWaffoCreditPackageProduct('credits-300', JSON.stringify(mapping))
    ).toThrow(WaffoCreditPackageCatalogError);
  });
});

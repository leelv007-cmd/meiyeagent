import { createServerFn } from '@tanstack/react-start';

import { websiteConfig } from '@/config/website';
import { serverEnv } from '@/env/server';
import {
  evaluateCommerceReadiness,
  toPublicCommerceReadiness,
  type CommerceReadinessScope,
  type CommerceReadinessPorts,
} from '@/payment/commerce-readiness';
import {
  readWaffoCreditPackageProductsFacts,
  readWaffoSubscriptionProductFacts,
} from '@/payment';

import { fetchCommercePlanCatalogSnapshot } from './plan-catalog';

export function productionCommerceReadinessPorts(): CommerceReadinessPorts {
  return {
    checkoutAuthority: {
      creditPackageProductMapping:
        serverEnv.WAFFO_CREDIT_PACKAGE_PRODUCT_MAPPING,
      environment: serverEnv.WAFFO_ENVIRONMENT,
      merchantId: serverEnv.WAFFO_MERCHANT_ID,
      privateKey: serverEnv.WAFFO_PRIVATE_KEY,
      provider: websiteConfig.payment?.provider,
      storeId: serverEnv.WAFFO_STORE_ID,
      testCheckoutEnabled: websiteConfig.payment?.enable === true,
      deadlineMs: 1_500,
    },
    readCoreSnapshot: fetchCommercePlanCatalogSnapshot,
    readCreditPackageProductFacts: readWaffoCreditPackageProductsFacts,
    readSubscriptionProductFacts: readWaffoSubscriptionProductFacts,
  };
}

export async function readCommerceReadiness(
  scope: CommerceReadinessScope = 'all'
) {
  return evaluateCommerceReadiness(productionCommerceReadinessPorts(), scope);
}

type PublicCommerceReadiness = ReturnType<typeof toPublicCommerceReadiness>;

let displayCache:
  | {
      expiresAt: number;
      fingerprint: string;
      value: PublicCommerceReadiness;
    }
  | undefined;

async function readPublicCommerceReadiness() {
  const ports = productionCommerceReadinessPorts();
  const snapshot = await fetchCommercePlanCatalogSnapshot();
  const fingerprint = [
    snapshot.planRevision,
    snapshot.paymentMapping?.revision ?? 'none',
    ports.checkoutAuthority.provider ?? 'none',
    ports.checkoutAuthority.environment,
    ports.checkoutAuthority.testCheckoutEnabled,
    Boolean(ports.checkoutAuthority.merchantId),
    Boolean(ports.checkoutAuthority.privateKey),
    Boolean(ports.checkoutAuthority.storeId),
    ports.checkoutAuthority.creditPackageProductMapping ?? 'none',
  ].join('|');
  if (
    displayCache &&
    displayCache.fingerprint === fingerprint &&
    displayCache.expiresAt > Date.now()
  ) {
    return displayCache.value;
  }
  const readiness = await evaluateCommerceReadiness(
    { ...ports, readCoreSnapshot: async () => snapshot },
    'display'
  );
  const value = toPublicCommerceReadiness(readiness);
  displayCache = {
    expiresAt: Date.now() + 5_000,
    fingerprint,
    value,
  };
  return value;
}

export const getCommerceReadiness = createServerFn({ method: 'GET' }).handler(
  readPublicCommerceReadiness
);

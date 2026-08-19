import { createServerFn } from '@tanstack/react-start';

import { websiteConfig } from '@/config/website';
import { serverEnv } from '@/env/server';
import {
  evaluateCommerceReadiness,
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
    },
    readCoreSnapshot: fetchCommercePlanCatalogSnapshot,
    readCreditPackageProductFacts: readWaffoCreditPackageProductsFacts,
    readSubscriptionProductFacts: readWaffoSubscriptionProductFacts,
  };
}

export async function readCommerceReadiness() {
  return evaluateCommerceReadiness(productionCommerceReadinessPorts());
}

export const getCommerceReadiness = createServerFn({ method: 'GET' }).handler(
  readCommerceReadiness
);

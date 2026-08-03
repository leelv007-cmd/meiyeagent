import {
  pricing_plans_free_description,
  pricing_plans_free_name,
  pricing_plans_lifetime_description,
  pricing_plans_lifetime_name,
  pricing_plans_pro_description,
  pricing_plans_pro_name,
  site_description,
  site_name,
  site_title,
} from '@/locale/paraglide/messages';
import {
  DEFAULT_ALLOWED_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_USER_FILES_FOLDER,
} from '@/storage/constants';
import { clientEnv } from '@/env/client';
import { PUBLIC_DISPLAY_PRICE_CENTS } from '@/lib/public-display-price';
import { waffoSubscriptionPricesForPlan } from '@/payment/waffo-subscription-catalog';
import type { WebsiteConfig } from '../types';
import { resolvePaymentRuntimePolicy } from './payment-runtime-policy';

// Stripe is retirement-only: keep its runtime available for controlled legacy
// webhooks, but never publish a sellable Stripe catalog or new-commerce UI.
const paymentRuntimePolicy = resolvePaymentRuntimePolicy({
  provider: clientEnv.VITE_PAYMENT_PROVIDER,
  publicPaidLaunchEnabled: clientEnv.VITE_PUBLIC_PAID_LAUNCH_ENABLED,
  waffoTestCheckoutEnabled: clientEnv.VITE_WAFFO_TEST_CHECKOUT_ENABLED,
  creemPriceIds: {
    proMonthly: clientEnv.VITE_CREEM_PRODUCT_PRO_MONTHLY,
    proYearly: clientEnv.VITE_CREEM_PRODUCT_PRO_YEARLY,
    lifetime: clientEnv.VITE_CREEM_PRODUCT_LIFETIME,
  },
  waffoProductIds: {
    starterSingleMonth: clientEnv.VITE_WAFFO_PRODUCT_STARTER_SINGLE_MONTH,
    starterMonthly: clientEnv.VITE_WAFFO_PRODUCT_STARTER_MONTHLY,
    starterYearly: clientEnv.VITE_WAFFO_PRODUCT_STARTER_YEARLY,
    growthSingleMonth: clientEnv.VITE_WAFFO_PRODUCT_GROWTH_SINGLE_MONTH,
    growthMonthly: clientEnv.VITE_WAFFO_PRODUCT_GROWTH_MONTHLY,
    growthYearly: clientEnv.VITE_WAFFO_PRODUCT_GROWTH_YEARLY,
    proSingleMonth: clientEnv.VITE_WAFFO_PRODUCT_PRO_SINGLE_MONTH,
    proMonthly: clientEnv.VITE_WAFFO_PRODUCT_PRO_MONTHLY,
    proYearly: clientEnv.VITE_WAFFO_PRODUCT_PRO_YEARLY,
  },
});

const waffoPriceIds = paymentRuntimePolicy.priceIds;
const usesWaffoCatalog = paymentRuntimePolicy.provider === 'waffo';

/**
 * Website config
 */
export const websiteConfig: WebsiteConfig = {
  ui: {
    mode: {
      defaultMode: 'light',
      enableSwitch: true,
    },
  },
  metadata: {
    get name() {
      return site_name();
    },
    get title() {
      return site_title();
    },
    get description() {
      return site_description();
    },
  },
  social: {},
  auth: {
    enable: true,
    enableGoogleLogin: true,
    enableCredentialLogin: true,
    enableDeleteAccount: true,
  },
  blog: {
    enable: false,
    paginationSize: 6,
  },
  mail: {
    enable: true,
    provider: 'resend',
    fromEmail: 'onboarding@resend.dev',
  },
  notification: {
    enable: true,
    provider: 'discord',
  },
  storage: {
    enable: true,
    provider: 'r2',
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    allowedTypes: DEFAULT_ALLOWED_TYPES,
    userFilesFolder: DEFAULT_USER_FILES_FOLDER,
  },
  payment: {
    enable: paymentRuntimePolicy.enabled,
    provider: paymentRuntimePolicy.provider,
    price: {
      plans: {
        free: {
          id: 'free',
          prices: [],
          isFree: true,
          isLifetime: false,
          get name() {
            return pricing_plans_free_name();
          },
          get description() {
            return pricing_plans_free_description();
          },
        },
        pro: {
          id: 'pro',
          prices: usesWaffoCatalog
            ? waffoSubscriptionPricesForPlan('pro', waffoPriceIds)
            : [
                {
                  type: 'subscription',
                  priceId: paymentRuntimePolicy.priceIds.proMonthly,
                  amount: PUBLIC_DISPLAY_PRICE_CENTS.growthMonthly,
                  currency: 'CNY',
                  interval: 'month',
                },
                {
                  type: 'subscription',
                  priceId: paymentRuntimePolicy.priceIds.proYearly,
                  amount: PUBLIC_DISPLAY_PRICE_CENTS.growthYearly,
                  currency: 'CNY',
                  interval: 'year',
                },
              ],
          isFree: false,
          isLifetime: false,
          popular: true,
          get name() {
            return pricing_plans_pro_name();
          },
          get description() {
            return pricing_plans_pro_description();
          },
        },
        lifetime: {
          id: 'lifetime',
          disabled: true,
          prices: [
            {
              type: 'one_time',
              priceId: paymentRuntimePolicy.priceIds.lifetime,
              amount: PUBLIC_DISPLAY_PRICE_CENTS.lifetime,
              currency: 'CNY',
              allowPromotionCode: true,
            },
          ],
          isFree: false,
          isLifetime: true,
          get name() {
            return pricing_plans_lifetime_name();
          },
          get description() {
            return pricing_plans_lifetime_description();
          },
        },
        ...(usesWaffoCatalog
          ? {
              starter: {
                id: 'starter',
                name: 'Starter',
                description: 'Starter subscription',
                prices: waffoSubscriptionPricesForPlan(
                  'starter',
                  waffoPriceIds
                ),
                isFree: false,
                isLifetime: false,
              },
              growth: {
                id: 'growth',
                name: 'Growth',
                description: 'Growth subscription',
                prices: waffoSubscriptionPricesForPlan('growth', waffoPriceIds),
                isFree: false,
                isLifetime: false,
                popular: true,
              },
            }
          : {}),
      },
    },
  },
};

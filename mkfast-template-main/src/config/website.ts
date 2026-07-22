import { getMessageList } from '@/lib/locale';
import {
  pricing_plans_free_description,
  pricing_plans_free_features,
  pricing_plans_free_limits,
  pricing_plans_free_name,
  pricing_plans_lifetime_description,
  pricing_plans_lifetime_features,
  pricing_plans_lifetime_limits,
  pricing_plans_lifetime_name,
  pricing_plans_pro_description,
  pricing_plans_pro_features,
  pricing_plans_pro_limits,
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
import type { WebsiteConfig } from '../types';
import { resolvePaymentRuntimePolicy } from './payment-runtime-policy';

// Stripe is retirement-only: keep its runtime available for controlled legacy
// webhooks, but never publish a sellable Stripe catalog or new-commerce UI.
const paymentRuntimePolicy = resolvePaymentRuntimePolicy({
  provider: clientEnv.VITE_PAYMENT_PROVIDER,
  publicPaidLaunchEnabled: clientEnv.VITE_PUBLIC_PAID_LAUNCH_ENABLED,
  creemPriceIds: {
    proMonthly: clientEnv.VITE_CREEM_PRODUCT_PRO_MONTHLY,
    proYearly: clientEnv.VITE_CREEM_PRODUCT_PRO_YEARLY,
    lifetime: clientEnv.VITE_CREEM_PRODUCT_LIFETIME,
  },
});

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
    enable: false,
    provider: 'cloudflare',
  },
  newsletter: {
    enable: false,
    provider: 'resend',
    autoSubscribeAfterSignUp: false,
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
          get features() {
            return [...getMessageList(pricing_plans_free_features())];
          },
          get limits() {
            return [...getMessageList(pricing_plans_free_limits())];
          },
        },
        pro: {
          id: 'pro',
          prices: [
            {
              type: 'subscription',
              priceId: paymentRuntimePolicy.priceIds.proMonthly,
              amount: clientEnv.VITE_GROWTH_MONTHLY_AMOUNT_CENTS,
              currency: 'CNY',
              interval: 'month',
            },
            {
              type: 'subscription',
              priceId: paymentRuntimePolicy.priceIds.proYearly,
              amount: clientEnv.VITE_GROWTH_YEARLY_AMOUNT_CENTS,
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
          get features() {
            return [...getMessageList(pricing_plans_pro_features())];
          },
          get limits() {
            return [...getMessageList(pricing_plans_pro_limits())];
          },
        },
        lifetime: {
          id: 'lifetime',
          disabled: true,
          prices: [
            {
              type: 'one_time',
              priceId: paymentRuntimePolicy.priceIds.lifetime,
              amount: clientEnv.VITE_LIFETIME_AMOUNT_CENTS,
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
          get features() {
            return [...getMessageList(pricing_plans_lifetime_features())];
          },
          get limits() {
            return [...getMessageList(pricing_plans_lifetime_limits())];
          },
        },
      },
    },
  },
};

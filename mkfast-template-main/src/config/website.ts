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
import { clientEnv } from '@/env/client';
import type { WebsiteConfig } from '../types';
import {
  DEFAULT_ALLOWED_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_USER_FILES_FOLDER,
} from '@/storage/constants';

// Payment provider controlled by env var: 'stripe' | 'creem' | '' (empty means disabled)
const paymentProvider = clientEnv.VITE_PAYMENT_PROVIDER;
const isPaymentEnabled =
  paymentProvider !== '' && clientEnv.VITE_PUBLIC_PAID_LAUNCH_ENABLED;
const isCreemPayment = paymentProvider === 'creem';
// Resolve price/product IDs based on the active payment provider
const priceIds = isPaymentEnabled
  ? {
      proMonthly: isCreemPayment
        ? (clientEnv.VITE_CREEM_PRODUCT_PRO_MONTHLY ?? '')
        : (clientEnv.VITE_STRIPE_PRICE_PRO_MONTHLY ?? ''),
      proYearly: isCreemPayment
        ? (clientEnv.VITE_CREEM_PRODUCT_PRO_YEARLY ?? '')
        : (clientEnv.VITE_STRIPE_PRICE_PRO_YEARLY ?? ''),
      lifetime: isCreemPayment
        ? (clientEnv.VITE_CREEM_PRODUCT_LIFETIME ?? '')
        : (clientEnv.VITE_STRIPE_PRICE_LIFETIME ?? ''),
    }
  : { proMonthly: '', proYearly: '', lifetime: '' };

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
    enable: isPaymentEnabled,
    provider: isPaymentEnabled ? paymentProvider : undefined,
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
              priceId: priceIds.proMonthly,
              amount: clientEnv.VITE_GROWTH_MONTHLY_AMOUNT_CENTS,
              currency: 'CNY',
              interval: 'month',
            },
            {
              type: 'subscription',
              priceId: priceIds.proYearly,
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
              priceId: priceIds.lifetime,
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

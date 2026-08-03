import { createEnv } from '@t3-oss/env-core';
import * as z from 'zod';

/**
 * Client-side env (build-time from Vite, import.meta.env)
 */
export const clientEnv = createEnv({
  clientPrefix: 'VITE_',
  client: {
    VITE_BASE_URL: z.url().default('http://localhost:3000'),

    // Payment provider: 'stripe' | 'creem' | 'waffo' | '' (empty = disabled)
    VITE_PAYMENT_PROVIDER: z.enum(['stripe', 'creem', 'waffo', '']).default(''),
    VITE_PUBLIC_PAID_LAUNCH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    VITE_WAFFO_TEST_CHECKOUT_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // The amounts the public pages quote are copy, not configuration, and
    // live in `@/lib/public-display-price` (D-156). They were declared here
    // until 2026-07-28, but the deploy workflow never injected them — the
    // default was the production number, so this was an env var in appearance
    // only, and the appearance is what invited a copy edit to move a price.

    // Payment (Stripe)
    VITE_STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    VITE_STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
    VITE_STRIPE_PRICE_LIFETIME: z.string().optional(),

    // Payment (Creem)
    VITE_CREEM_PRODUCT_PRO_MONTHLY: z.string().optional(),
    VITE_CREEM_PRODUCT_PRO_YEARLY: z.string().optional(),
    VITE_CREEM_PRODUCT_LIFETIME: z.string().optional(),

    // Payment (Waffo): all nine Test fixture product IDs are required before
    // its isolated checkout can be enabled.
    VITE_WAFFO_PRODUCT_STARTER_SINGLE_MONTH: z.string().optional(),
    VITE_WAFFO_PRODUCT_STARTER_MONTHLY: z.string().optional(),
    VITE_WAFFO_PRODUCT_STARTER_YEARLY: z.string().optional(),
    VITE_WAFFO_PRODUCT_GROWTH_SINGLE_MONTH: z.string().optional(),
    VITE_WAFFO_PRODUCT_GROWTH_MONTHLY: z.string().optional(),
    VITE_WAFFO_PRODUCT_GROWTH_YEARLY: z.string().optional(),
    VITE_WAFFO_PRODUCT_PRO_SINGLE_MONTH: z.string().optional(),
    VITE_WAFFO_PRODUCT_PRO_MONTHLY: z.string().optional(),
    VITE_WAFFO_PRODUCT_PRO_YEARLY: z.string().optional(),

    // Analytics
    VITE_GOOGLE_ANALYTICS_ID: z.string().optional(),
    VITE_PLAUSIBLE_SCRIPT: z.string().optional(),
    VITE_RELEASE_VERSION: z.string().default('local'),
    VITE_SCHEMA_REVISION: z.string().default('uiux-p1-v1'),
    VITE_UMAMI_WEBSITE_ID: z.string().optional(),
    VITE_UMAMI_SCRIPT: z.string().optional(),

    // Chatbot (Crisp Chat)
    VITE_CRISP_WEBSITE_ID: z.string().optional(),
  },
  runtimeEnv: import.meta.env,
});

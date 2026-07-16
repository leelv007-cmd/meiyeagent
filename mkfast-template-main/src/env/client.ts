import { createEnv } from '@t3-oss/env-core';
import * as z from 'zod';

/**
 * Client-side env (build-time from Vite, import.meta.env)
 */
export const clientEnv = createEnv({
  clientPrefix: 'VITE_',
  client: {
    VITE_BASE_URL: z.url().default('http://localhost:3000'),

    // Payment provider: 'stripe' | 'creem' | '' (empty = disabled)
    VITE_PAYMENT_PROVIDER: z.enum(['stripe', 'creem', '']).default(''),
    VITE_PUBLIC_PAID_LAUNCH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    VITE_GROWTH_MONTHLY_AMOUNT_CENTS: z.coerce
      .number()
      .int()
      .positive()
      .default(49900),
    VITE_GROWTH_YEARLY_AMOUNT_CENTS: z.coerce
      .number()
      .int()
      .positive()
      .default(499000),
    VITE_LIFETIME_AMOUNT_CENTS: z.coerce
      .number()
      .int()
      .positive()
      .default(699000),

    // Payment (Stripe)
    VITE_STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    VITE_STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
    VITE_STRIPE_PRICE_LIFETIME: z.string().optional(),

    // Payment (Creem)
    VITE_CREEM_PRODUCT_PRO_MONTHLY: z.string().optional(),
    VITE_CREEM_PRODUCT_PRO_YEARLY: z.string().optional(),
    VITE_CREEM_PRODUCT_LIFETIME: z.string().optional(),

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

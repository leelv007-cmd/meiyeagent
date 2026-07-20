import { createEnv } from '@t3-oss/env-core';
import * as z from 'zod';
import {
  allowsDevSecretDefaults,
  isWeakSecretValue,
  REJECTED_SECRET_SET_HINT,
} from './secret-hardening';

function serviceSecretSchema(name: string, devDefault: string) {
  if (allowsDevSecretDefaults()) {
    // Defaults so local fixture / e2e / CLI-under-test can run without a full .env.
    return z.string().min(1).default(devDefault);
  }
  return z
    .string()
    .min(
      1,
      `${name} is required in production/staging. ${REJECTED_SECRET_SET_HINT}`
    )
    .refine((value) => !isWeakSecretValue(value), {
      message: `${name} rejects weak placeholder values in production/staging. ${REJECTED_SECRET_SET_HINT}`,
    });
}

/**
 * Server-side env (runtime process.env; Worker vars/secrets populate it)
 */
export const serverEnv = createEnv({
  server: {
    // Defaults so CLI (e.g. auth:schema:generate via pnpm dlx) can run without loading .env.local
    VITE_BASE_URL: z.url().default('http://localhost:3000'),

    // Database (PostgreSQL)
    DATABASE_URL: z.string().min(1).optional(),

    // Auth (Better Auth) — weak default allowed outside production/staging
    BETTER_AUTH_SECRET: serviceSecretSchema(
      'BETTER_AUTH_SECRET',
      'better-auth-secret'
    ),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    // Internal Core service
    CORE_SERVICE_URL: z.url().default('http://127.0.0.1:4100'),
    CORE_SERVICE_TOKEN: serviceSecretSchema(
      'CORE_SERVICE_TOKEN',
      'local-core-service-token'
    ),

    // Internal Canvas service
    CANVAS_SERVICE_URL: z.url().default('http://127.0.0.1:4200'),
    CANVAS_SERVICE_TOKEN: serviceSecretSchema(
      'CANVAS_SERVICE_TOKEN',
      'local-canvas-service-token'
    ),
    CANVAS_ORIGIN: z.url().default('http://127.0.0.1:4200'),

    // Dedicated Pro Studio add-on catalog. Its price must not exist in the
    // free/pro/lifetime catalog; missing values keep checkout disabled.
    PRO_STUDIO_OFFER_ID: z.string().optional(),
    PRO_STUDIO_PRICE_ID: z.string().optional(),
    PRO_STUDIO_AMOUNT_CENTS: z.string().optional(),
    PRO_STUDIO_CURRENCY: z.string().optional(),
    PRO_STUDIO_PAYMENT_TYPE: z.string().optional(),

    // Mail and Newsletter (Resend)
    RESEND_API_KEY: z.string().optional(),

    // Mail (Cloudflare Email)
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_API_TOKEN: z.string().optional(),

    // Newsletter (Beehiiv)
    BEEHIIV_API_KEY: z.string().optional(),
    BEEHIIV_PUBLICATION_ID: z.string().optional(),

    // Notification (Discord and Feishu)
    DISCORD_WEBHOOK_URL: z.string().optional(),
    FEISHU_WEBHOOK_URL: z.string().optional(),

    // Payment (Stripe)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Payment (Creem)
    CREEM_DEBUG: z.string().optional(),
    CREEM_API_KEY: z.string().optional(),
    CREEM_WEBHOOK_SECRET: z.string().optional(),

    // AI image generation (fal.ai)
    FAL_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
});

export {
  allowsDevSecretDefaults,
  isWeakSecretValue,
  WEAK_SECRET_VALUES,
} from './secret-hardening';

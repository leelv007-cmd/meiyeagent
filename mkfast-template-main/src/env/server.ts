import { createEnv } from '@t3-oss/env-core';
import * as z from 'zod';
import { internalServiceTransportSchema } from './internal-service-boundary';
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
    // Auth (Better Auth) — weak default allowed outside production/staging
    BETTER_AUTH_SECRET: serviceSecretSchema(
      'BETTER_AUTH_SECRET',
      'better-auth-secret'
    ),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    // Internal Core service
    INTERNAL_SERVICE_TRANSPORT: internalServiceTransportSchema(),
    CORE_SERVICE_URL: z.url().default('http://127.0.0.1:4100'),
    CORE_SERVICE_TOKEN: serviceSecretSchema(
      'CORE_SERVICE_TOKEN',
      'local-core-service-token'
    ),

    // Mail and Newsletter (Resend)
    RESEND_API_KEY: z.string().optional(),

    // Mail (Cloudflare Email)
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_API_TOKEN: z.string().optional(),

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

    // Payment (Waffo Pancake)
    WAFFO_ENVIRONMENT: z.enum(['test', 'production']).default('production'),
    WAFFO_MERCHANT_ID: z.string().optional(),
    WAFFO_PRIVATE_KEY: z.string().optional(),
    WAFFO_WEBHOOK_TEST_PUBLIC_KEY: z.string().optional(),
    WAFFO_WEBHOOK_PRODUCTION_PUBLIC_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
});

export {
  allowsDevSecretDefaults,
  isWeakSecretValue,
  WEAK_SECRET_VALUES,
} from './secret-hardening';

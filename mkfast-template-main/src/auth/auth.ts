import type { User } from 'better-auth';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '@/db';
import { sendEmail } from '@/mail';
import { subscribe } from '@/newsletter';
import { getBaseUrl } from '@/lib/urls';
import { serverEnv } from '@/env/server';
import { websiteConfig } from '@/config/website';
import { resolveEmailVerificationPolicy } from '@/auth/email-verification-policy';
import { safeErrorFields } from '@/auth/safe-log';
import { recentAuthenticationHook } from '@/auth/recent-authentication-hook';
import { assembleVerifiedUser } from '@/auth/user-assembly';
import { ensurePersonalWorkspace } from '@/lib/auth/workspace-bootstrap';
import { ensureVerifiedWorkspaceProvisioned } from '@/lib/auth/workspace-provisioning';
import { createAuthPlugins } from '@/auth/plugins';

/**
 * Better Auth Configuration
 * https://www.better-auth.com/docs/reference/options
 * https://www.better-auth.com/docs/adapters/drizzle
 */
export function createAuth() {
  const emailVerificationPolicy = resolveEmailVerificationPolicy({
    appEnv: process.env.APP_ENV,
    isDev: import.meta.env?.DEV === true,
    mode: import.meta.env?.MODE ?? '',
  });

  return betterAuth({
    baseURL: getBaseUrl(),
    appName: websiteConfig.metadata?.name,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
    }),
    session: {
      // https://www.better-auth.com/docs/concepts/session-management#cookie-cache
      cookieCache: {
        enabled: true,
        maxAge: 60 * 60, // Cache duration in seconds
      },
      // https://www.better-auth.com/docs/concepts/session-management#session-expiration
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // https://www.better-auth.com/docs/concepts/session-management#session-freshness
      // https://www.better-auth.com/docs/concepts/users-accounts#authentication-requirements
      // Global freshness stays disabled. High-risk endpoints use the explicit
      // 15-minute recentAuthenticationHook below instead.
      freshAge: 0 /* 60 * 60 * 24 */,
    },
    emailAndPassword: {
      // https://discord.com/channels/1300839113142046730/1300839113594769431/1454280549060444393
      enabled: websiteConfig.auth?.enableCredentialLogin ?? false,
      // https://www.better-auth.com/docs/concepts/email#2-require-email-verification
      requireEmailVerification:
        emailVerificationPolicy.requireEmailVerification,
      // https://www.better-auth.com/docs/authentication/email-password#forget-password
      sendResetPassword: async ({ user, url }) => {
        if (import.meta.env.MODE === 'e2e') return;
        await sendEmail({
          to: user.email,
          template: 'forgotPassword',
          context: { url, name: user.name ?? '' },
        });
      },
    },
    emailVerification: {
      // https://www.better-auth.com/docs/concepts/email#auto-signin-after-verification
      autoSignInAfterVerification: true,
      // https://www.better-auth.com/docs/authentication/email-password#require-email-verification
      sendVerificationEmail: async ({ user, url }) => {
        if (import.meta.env.MODE === 'e2e') return;
        await sendEmail({
          to: user.email,
          template: 'verifyEmail',
          context: { url, name: user.name ?? '' },
        });
      },
      afterEmailVerification: async (user) => {
        await assembleUser(user);
      },
      sendOnSignIn: true,
    },
    socialProviders: {
      // https://www.better-auth.com/docs/authentication/google
      ...(websiteConfig.auth?.enableGoogleLogin &&
      serverEnv.GOOGLE_CLIENT_ID &&
      serverEnv.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: serverEnv.GOOGLE_CLIENT_ID,
              clientSecret: serverEnv.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    account: {
      // https://www.better-auth.com/docs/concepts/users-accounts#account-linking
      accountLinking: {
        enabled: websiteConfig.auth?.enableGoogleLogin,
        trustedProviders: websiteConfig.auth?.enableGoogleLogin
          ? ['google']
          : [],
      },
    },
    user: {
      // https://www.better-auth.com/docs/concepts/database#extending-core-schema
      additionalFields: {
        customerId: {
          type: 'string',
          required: false,
        },
        provisionedByUserId: {
          type: 'string',
          required: false,
          input: false,
        },
      },
      // https://www.better-auth.com/docs/concepts/users-accounts#delete-user
      deleteUser: {
        enabled: websiteConfig.auth?.enableDeleteAccount ?? false,
      },
    },
    databaseHooks: {
      // https://www.better-auth.com/docs/concepts/database#database-hooks
      user: {
        create: {
          before: async (user) => {
            if (!emailVerificationPolicy.autoVerifyNewUsers) return;
            return { data: { ...user, emailVerified: true } };
          },
          after: async (user) => {
            await onCreateUser(user);
          },
        },
      },
    },
    hooks: {
      before: recentAuthenticationHook,
    },
    plugins: createAuthPlugins(),
    onAPIError: {
      // https://www.better-auth.com/docs/reference/options#onapierror
      errorURL: '/auth/error',
      onError: (error, _ctx) => {
        console.error('auth error', {
          event: 'AUTH_API_ERROR',
          ...safeErrorFields(error),
        });
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

async function assembleUser(user: User) {
  const database = getDb();
  return assembleVerifiedUser(user, {
    ensureWorkspace: (verifiedUser) =>
      ensurePersonalWorkspace(verifiedUser, database),
    provisionWorkspace: ({ ownerUserId, workspaceId }) =>
      ensureVerifiedWorkspaceProvisioned({
        coreServiceToken: serverEnv.CORE_SERVICE_TOKEN,
        coreServiceUrl: serverEnv.CORE_SERVICE_URL,
        database,
        ownerUserId,
        workspaceId,
      }),
  });
}

/**
 * Runs after a new user is created. Auto-subscribes to newsletter when enabled.
 */
async function onCreateUser(user: User) {
  await assembleUser(user);
  const newsletterConfig = websiteConfig.newsletter;
  if (
    !user.email ||
    !newsletterConfig?.enable ||
    !newsletterConfig.autoSubscribeAfterSignUp
  ) {
    return;
  }

  try {
    const subscribed = await subscribe(user.email);
    if (!subscribed) {
      console.error('newsletter subscription failed', {
        event: 'NEWSLETTER_SUBSCRIPTION_FAILED',
        userId: user.id,
      });
    } else {
      console.info('newsletter subscription completed', {
        event: 'NEWSLETTER_SUBSCRIPTION_COMPLETED',
        userId: user.id,
      });
    }
  } catch (error) {
    console.error('newsletter subscription error', {
      event: 'NEWSLETTER_SUBSCRIPTION_ERROR',
      userId: user.id,
      ...safeErrorFields(error),
    });
  }
}

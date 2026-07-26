import { emailHarmony } from 'better-auth-harmony';
import { admin } from 'better-auth/plugins';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { apiKeyPlugin } from './api-key-compatibility';

function createAdminPlugin() {
  return admin({
    // https://www.better-auth.com/docs/plugins/admin#default-ban-reason
    // defaultBanReason: 'Spamming',
    defaultBanExpiresIn: undefined,
    bannedUserMessage:
      'You have been banned from this application. Please contact support if you believe this is an error.',
  });
}

function createEmailHarmonyPlugin() {
  return emailHarmony({
    // Don't allow login with any version of the unnormalized email address
    // e.g., user signed up with johndoe@googlemail.com can't login with john.doe@gmail.com
    // e.g., user signed up with johndoe@googlemail.com can't login with johndoe+abc@gmail.com
    allowNormalizedSignin: false,
  });
}

function createTanstackCookiesPlugin() {
  return tanstackStartCookies();
}

type AuthPlugins = [
  ReturnType<typeof createAdminPlugin>,
  typeof apiKeyPlugin,
  ReturnType<typeof createEmailHarmonyPlugin>,
  ReturnType<typeof createTanstackCookiesPlugin>,
];

export function createAuthPlugins(): AuthPlugins {
  return [
    // https://www.better-auth.com/docs/plugins/admin
    // support user management, ban/unban user, manage user roles, etc.
    createAdminPlugin(),
    // https://www.better-auth.com/docs/plugins/api-key
    // support API key management for user authentication
    apiKeyPlugin,
    // https://github.com/gekorm/better-auth-harmony
    // email normalization and validation to prevent duplicate registrations
    createEmailHarmonyPlugin(),
    // https://www.better-auth.com/docs/integrations/tanstack
    // This must remain last so every plugin's Set-Cookie headers are forwarded.
    createTanstackCookiesPlugin(),
  ];
}

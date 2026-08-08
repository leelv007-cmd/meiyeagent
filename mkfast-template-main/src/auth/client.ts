import { apiKeyClient } from '@better-auth/api-key/client';
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { getBaseUrl } from '@/lib/urls';
import type { Auth } from './auth';

export function resolveAuthClientBaseUrl(
  browserOrigin: string | undefined
): string {
  return browserOrigin ?? getBaseUrl();
}

/**
 * Better Auth Client Configuration
 * https://www.better-auth.com/docs/integrations/tanstack
 */
export const authClient = createAuthClient({
  baseURL: resolveAuthClientBaseUrl(
    typeof window === 'undefined' ? undefined : window.location.origin
  ),
  plugins: [
    // https://www.better-auth.com/docs/plugins/admin#add-the-client-plugin
    adminClient(),
    // https://www.better-auth.com/docs/plugins/api-key#add-the-client-plugin
    apiKeyClient(),
    // https://www.better-auth.com/docs/concepts/typescript#inferring-additional-fields-on-client
    inferAdditionalFields<Auth>(),
  ],
});

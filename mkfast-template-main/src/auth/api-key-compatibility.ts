import { apiKey } from '@better-auth/api-key';

export const API_KEY_SCHEMA_COMPATIBILITY = {
  apikey: {
    fields: {
      referenceId: 'userId',
    },
  },
} as const;

/**
 * Better Auth 1.6 names an API key owner `referenceId`. Keep the existing
 * userId field mapping so deployed keys and the user foreign key remain valid.
 */
export const apiKeyPlugin = apiKey({
  schema: API_KEY_SCHEMA_COMPATIBILITY,
});

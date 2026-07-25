import {
  p1ModuleRequestSchema,
  requiredP1Capability,
  type P1ModuleRequest,
} from '@meiye/contracts';

export const RECENT_AUTHENTICATION_WINDOW_MS = 15 * 60 * 1000;

const RECENT_AUTHENTICATION_PATHS = new Set([
  '/api-key/create',
  '/api-key/update',
  '/api-key/delete',
  '/delete-user',
  '/admin/set-role',
  '/admin/create-user',
  '/admin/update-user',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/impersonate-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/remove-user',
  '/admin/set-user-password',
]);

const RECENT_AUTHENTICATION_P1_CAPABILITIES = new Set([
  'account.commerce.govern',
  'config.publish',
  'credential.govern',
]);

export class RecentAuthenticationRequiredError extends Error {
  readonly code = 'RECENT_AUTHENTICATION_REQUIRED';

  constructor() {
    super('Recent authentication is required.');
    this.name = 'RecentAuthenticationRequiredError';
  }
}

export function requiresRecentAuthentication(path: string) {
  return RECENT_AUTHENTICATION_PATHS.has(path);
}

export function requiresRecentAuthenticationForP1Command(
  module: P1ModuleRequest['module'],
  action: string
) {
  const capability = requiredP1Capability('command', module, action);
  return (
    capability !== null && RECENT_AUTHENTICATION_P1_CAPABILITIES.has(capability)
  );
}

export function requiresRecentAuthenticationForP1RequestBody(body?: string) {
  if (!body) return false;
  try {
    const request = p1ModuleRequestSchema.safeParse(JSON.parse(body));
    return (
      request.success &&
      requiresRecentAuthenticationForP1Command(
        request.data.module,
        request.data.action
      )
    );
  } catch {
    return false;
  }
}

export function recentAuthenticationRequiredResponse() {
  return Response.json(
    {
      error: 'Recent authentication is required.',
      code: 'RECENT_AUTHENTICATION_REQUIRED',
    },
    { status: 403 }
  );
}

export function requireRecentAuthentication(
  session: { createdAt: Date | string; updatedAt?: Date | string },
  now = new Date()
) {
  const authenticatedAt = new Date(session.createdAt).getTime();
  const age = now.getTime() - authenticatedAt;
  if (
    !Number.isFinite(authenticatedAt) ||
    age < 0 ||
    age >= RECENT_AUTHENTICATION_WINDOW_MS
  ) {
    throw new RecentAuthenticationRequiredError();
  }
}

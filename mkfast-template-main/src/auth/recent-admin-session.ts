import {
  RecentAuthenticationRequiredError,
  recentAuthenticationRequiredResponse,
  requireRecentAuthentication,
} from './recent-authentication';

export const ADMIN_ROLE = 'admin';

export type AuthSession = {
  session: { createdAt: Date };
  user: {
    emailVerified: boolean;
    id: string;
    role?: string | null;
  };
};

export type AuthSessionGetter = (options: {
  headers: Headers;
  query?: {
    disableCookieCache: true;
    disableRefresh: true;
  };
}) => Promise<AuthSession | null>;

export type RecentAdminSessionResult =
  | { ok: false; response: Response }
  | { ok: true; session: AuthSession };

export function adminForbiddenResponse() {
  return Response.json(
    { success: false, error: 'Forbidden' },
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}

export function adminUnauthorizedResponse() {
  return Response.json(
    { success: false, error: 'Unauthorized' },
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}

async function defaultSessionGetter(
  options: Parameters<AuthSessionGetter>[0]
): Promise<AuthSession | null> {
  const { createAuth } = await import('./auth');
  return createAuth().api.getSession(options);
}

export async function requireRecentAdminSession(
  request: Pick<Request, 'headers'>,
  getSession: AuthSessionGetter = defaultSessionGetter
): Promise<RecentAdminSessionResult> {
  const session = await getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!session?.user?.id || !session.user.emailVerified) {
    return { ok: false, response: adminUnauthorizedResponse() };
  }
  if (session.user.role !== ADMIN_ROLE) {
    return { ok: false, response: adminForbiddenResponse() };
  }
  try {
    requireRecentAuthentication(session.session);
  } catch (error) {
    if (!(error instanceof RecentAuthenticationRequiredError)) throw error;
    return { ok: false, response: recentAuthenticationRequiredResponse() };
  }
  return { ok: true, session };
}

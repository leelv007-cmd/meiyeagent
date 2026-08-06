import {
  applyExpiredSessionCookies,
  requireActiveSession,
} from './active-session';
import {
  RecentAuthenticationRequiredError,
  recentAuthenticationRequiredResponse,
  requireRecentAuthentication,
} from './recent-authentication';

export const ADMIN_ROLE = 'admin';

export type AuthSession = {
  session: {
    createdAt: Date;
    token?: string;
    id?: string;
    userId?: string;
    expiresAt?: Date;
  };
  user: {
    emailVerified: boolean;
    id: string;
    role?: string | null;
    banned?: boolean | null;
  };
};

export type AuthSessionGetter = (options: {
  headers: Headers;
  query?: {
    disableCookieCache?: boolean;
    disableRefresh?: boolean;
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

function adminUnauthorizedWithExpiredCookies(): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  applyExpiredSessionCookies(headers);
  return new Response(
    JSON.stringify({ success: false, error: 'Unauthorized' }),
    {
      status: 401,
      headers,
    }
  );
}

/**
 * Step-up admin gate. When `getSession` is omitted (production), reads go
 * through requireActiveSession so ban/revoke take effect on the next request.
 */
export async function requireRecentAdminSession(
  request: Pick<Request, 'headers'>,
  getSession?: AuthSessionGetter
): Promise<RecentAdminSessionResult> {
  let session: AuthSession;

  if (getSession) {
    const resolved = await getSession({
      headers: request.headers,
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!resolved?.user?.id || !resolved.user.emailVerified) {
      return { ok: false, response: adminUnauthorizedResponse() };
    }
    session = resolved;
  } else {
    const active = await requireActiveSession({
      headers: request.headers,
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!active.ok) {
      return { ok: false, response: adminUnauthorizedWithExpiredCookies() };
    }
    if (!active.session.user.emailVerified) {
      return { ok: false, response: adminUnauthorizedResponse() };
    }
    session = active.session;
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

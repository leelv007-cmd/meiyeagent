import { requireActiveSession } from '@/auth/active-session';
import {
  requireRecentAdminSession,
  type AuthSessionGetter,
  type RecentAdminSessionResult,
} from '@/auth/recent-admin-session';
import { requiresRecentAuthenticationForP1RequestBody } from '@/auth/recent-authentication';

/**
 * Workspace Core BFF gate. When `getSession` is omitted (production), the
 * shared requireActiveSession guard is the session authority so bans and
 * revocations apply on the next request despite cookie cache.
 */
export async function authorizeWorkspaceCoreRequest(
  request: Pick<Request, 'headers'>,
  resource: string,
  body: string | undefined,
  getSession?: AuthSessionGetter
): Promise<RecentAdminSessionResult> {
  if (
    resource === 'p1/commands' &&
    requiresRecentAuthenticationForP1RequestBody(body)
  ) {
    return requireRecentAdminSession(request, getSession);
  }

  if (getSession) {
    const session = await getSession({ headers: request.headers });
    if (!session?.user?.id || !session.user.emailVerified) {
      return {
        ok: false,
        response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }
    return { ok: true, session };
  }

  const active = await requireActiveSession({ headers: request.headers });
  if (!active.ok) return active;
  if (!active.session.user.emailVerified) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, session: active.session };
}

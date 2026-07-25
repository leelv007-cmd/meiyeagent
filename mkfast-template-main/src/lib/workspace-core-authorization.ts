import {
  requireRecentAdminSession,
  type AuthSessionGetter,
} from '@/auth/recent-admin-session';
import { requiresRecentAuthenticationForP1RequestBody } from '@/auth/recent-authentication';

export async function authorizeWorkspaceCoreRequest(
  request: Pick<Request, 'headers'>,
  resource: string,
  body: string | undefined,
  getSession: AuthSessionGetter
) {
  if (
    resource === 'p1/commands' &&
    requiresRecentAuthenticationForP1RequestBody(body)
  ) {
    return requireRecentAdminSession(request, getSession);
  }

  const session = await getSession({ headers: request.headers });
  if (!session?.user?.id || !session.user.emailVerified) {
    return {
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { session };
}

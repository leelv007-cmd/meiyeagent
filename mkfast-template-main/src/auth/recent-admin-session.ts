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

async function defaultSessionGetter(options: Parameters<AuthSessionGetter>[0]) {
  const { createAuth } = await import('./auth');
  return createAuth().api.getSession(options);
}

export async function requireRecentAdminSession(
  request: Pick<Request, 'headers'>,
  getSession: AuthSessionGetter = defaultSessionGetter
) {
  const session = await getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!session?.user?.id || !session.user.emailVerified) {
    return {
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (session.user.role !== ADMIN_ROLE) {
    return {
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  try {
    requireRecentAuthentication(session.session);
  } catch (error) {
    if (!(error instanceof RecentAuthenticationRequiredError)) throw error;
    return { response: recentAuthenticationRequiredResponse() };
  }
  return { session };
}

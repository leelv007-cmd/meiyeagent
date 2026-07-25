import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import {
  RecentAuthenticationRequiredError,
  requireRecentAuthentication,
  requiresRecentAuthentication,
} from './recent-authentication';
import {
  applyAdminAssistedAccountPolicy,
  stripAdminProvisioningAttribution,
} from './admin-provisioning-attribution';

type SessionLoader = (
  context: Parameters<typeof getSessionFromCtx>[0],
  options: { disableCookieCache: true }
) => ReturnType<typeof getSessionFromCtx>;

export function createRecentAuthenticationHook(
  loadSession: SessionLoader = getSessionFromCtx
) {
  return createAuthMiddleware(async (context) => {
    if (!context.path) return;

    if (context.path.startsWith('/admin/') && context.body?.data) {
      context.body.data = stripAdminProvisioningAttribution(context.body.data);
    }

    if (!requiresRecentAuthentication(context.path)) return;

    const current = await loadSession(context, {
      disableCookieCache: true,
    });
    if (!current?.session) throw new APIError('UNAUTHORIZED');

    try {
      requireRecentAuthentication(current.session);
    } catch (error) {
      if (!(error instanceof RecentAuthenticationRequiredError)) throw error;
      throw new APIError('FORBIDDEN', {
        code: error.code,
        message: error.message,
      });
    }

    if (context.path === '/admin/create-user') {
      context.body.data = applyAdminAssistedAccountPolicy(
        context.body.data,
        current.user.id
      );
    }
  });
}

export const recentAuthenticationHook = createRecentAuthenticationHook();

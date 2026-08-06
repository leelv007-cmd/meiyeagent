import { requireActiveSession } from '@/auth/active-session';
import { redirect } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { Routes } from '@/lib/routes';
import { websiteConfig } from '@/config/website';
import {
  ADMIN_ROLE,
  adminForbiddenResponse,
  requireRecentAdminSession,
} from '@/auth/recent-admin-session';

/**
 * Admin Route middleware: requires authenticated user with role === 'admin'.
 * Use after auth or alone (redirects to login if not signed in, then to dashboard if not admin).
 */
export const adminRouteMiddleware = createMiddleware().server(
  async ({ next }) => {
    if (!websiteConfig.auth?.enable) {
      throw redirect({ to: Routes.Root });
    }

    const headers = getRequestHeaders();
    const active = await requireActiveSession({ headers });

    if (!active.ok) {
      throw redirect({ to: Routes.Login });
    }

    const role = active.session.user.role;
    if (role !== ADMIN_ROLE) {
      throw redirect({ to: Routes.Dashboard });
    }

    return await next();
  }
);

/**
 * Admin API middleware: same check as adminMiddleware but returns 401/403 Response for API routes.
 * Passes context: { userId } so server function handlers can use them.
 */
export const adminApiMiddleware = createMiddleware().server(
  async ({ next }) => {
    const headers = getRequestHeaders();
    const active = await requireActiveSession({ headers });

    if (!active.ok) {
      return active.response;
    }
    if (active.session.user.role !== ADMIN_ROLE) {
      return adminForbiddenResponse();
    }

    return await next({
      context: {
        userId: active.session.user.id,
      },
    });
  }
);

/** Route-level step-up for critical admin writes. */
export const recentAdminApiMiddleware = createMiddleware().server(
  async ({ next }) => {
    const headers = getRequestHeaders();
    const authorization = await requireRecentAdminSession({ headers });
    if (!authorization.ok) return authorization.response;

    return await next({ context: { userId: authorization.session.user.id } });
  }
);

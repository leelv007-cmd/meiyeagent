import { requireActiveSession } from '@/auth/active-session';
import { redirect } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { Routes } from '@/lib/routes';
import { websiteConfig } from '@/config/website';
import {
  RecentAuthenticationRequiredError,
  recentAuthenticationRequiredResponse,
  requireRecentAuthentication,
} from '@/auth/recent-authentication';

/**
 * Auth Route middleware: requires authenticated user.
 * Use in route definitions via server: { middleware: [authMiddleware] }.
 * https://www.better-auth.com/docs/integrations/tanstack#middleware
 */
export const authRouteMiddleware = createMiddleware().server(
  async ({ next }) => {
    if (!websiteConfig.auth?.enable) {
      throw redirect({ to: Routes.Root });
    }

    const headers = getRequestHeaders();
    const active = await requireActiveSession({ headers });

    if (!active.ok) {
      throw redirect({ to: Routes.Login });
    }

    if (!active.session.user.emailVerified) {
      throw redirect({
        to: Routes.Login,
        search: { error: 'email_not_verified' },
      });
    }

    return await next();
  }
);

/**
 * Auth API middleware: same as authMiddleware but returns 401 JSON for API routes.
 * Passes context: { userId } so server function handlers can use context.userId.
 */
export const authApiMiddleware = createMiddleware().server(async ({ next }) => {
  const headers = getRequestHeaders();
  const active = await requireActiveSession({ headers });

  if (!active.ok) {
    return active.response;
  }

  if (!active.session.user.emailVerified) {
    return Response.json(
      { error: 'Email not verified', code: 'email_not_verified' },
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return await next({ context: { userId: active.session.user.id } });
});

/**
 * Sensitive API middleware: authenticated, verified, and signed in within the
 * last 15 minutes. Use only on high-risk actions, never as a global gate.
 */
export const recentAuthApiMiddleware = createMiddleware().server(
  async ({ next }) => {
    const headers = getRequestHeaders();
    const active = await requireActiveSession({
      headers,
      query: { disableCookieCache: true, disableRefresh: true },
    });

    if (!active.ok) {
      return active.response;
    }
    if (!active.session.user.emailVerified) {
      return Response.json(
        { error: 'Email not verified', code: 'email_not_verified' },
        { status: 403 }
      );
    }
    try {
      requireRecentAuthentication(active.session.session);
    } catch (error) {
      if (!(error instanceof RecentAuthenticationRequiredError)) throw error;
      return recentAuthenticationRequiredResponse();
    }

    return await next({ context: { userId: active.session.user.id } });
  }
);

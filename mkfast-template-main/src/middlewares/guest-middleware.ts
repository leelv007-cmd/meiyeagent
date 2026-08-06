import { requireActiveSession } from '@/auth/active-session';
import { redirect } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { DEFAULT_LOGIN_REDIRECT, Routes } from '@/lib/routes';
import { websiteConfig } from '@/config/website';

/**
 * Guest Route middleware: redirects authenticated users to the dashboard.
 * Use on public auth pages (login, register) to prevent logged-in users
 * from seeing them.
 *
 * Uses requireActiveSession so a revoked/banned cookie-cache hit is not
 * treated as a signed-in guest (would otherwise bounce login ↔ dashboard).
 */
export const guestRouteMiddleware = createMiddleware().server(
  async ({ next }) => {
    if (!websiteConfig.auth?.enable) {
      throw redirect({ to: Routes.Root });
    }

    const headers = getRequestHeaders();
    const active = await requireActiveSession({ headers });

    if (active.ok) {
      throw redirect({ to: DEFAULT_LOGIN_REDIRECT });
    }

    return await next();
  }
);

/**
 * Exact pathname dispatch for `/api/auth/$` (Spec A / #365).
 *
 * Better Auth registers the admin plugin as a whole, so product-unused
 * admin endpoints are closed here — not by removing the plugin.
 * #366 will extend this same map for a custom `/admin/set-role` handler.
 */

/** Better Auth default base path; must stay in lockstep with createAuth(). */
export const AUTH_API_BASE_PATH = '/api/auth';

/**
 * Stable product-facing code when a bare admin endpoint is closed.
 * Returned for both admins and non-admins (no role check; endpoint is gone).
 */
export const AUTH_ENDPOINT_NOT_FOUND_CODE = 'AUTH_ENDPOINT_NOT_FOUND';

/**
 * Better Auth relative paths (after `/api/auth`) with no product surface.
 * Exact match only — do not use prefix matching.
 */
export const DISABLED_AUTH_ADMIN_ENDPOINTS = [
  '/admin/remove-user',
  '/admin/impersonate-user',
  '/admin/set-user-password',
] as const;

const DISABLED_AUTH_ADMIN_ENDPOINT_SET = new Set<string>(
  DISABLED_AUTH_ADMIN_ENDPOINTS
);

export type AuthEndpointDispatchDecision =
  | { kind: 'not_found' }
  | { kind: 'forward' };
// #366 will add: | { kind: 'set_role' }

export type AuthRequestHandler = (
  request: Request
) => Response | Promise<Response>;

export type CreateAuthCatchAllHandlersOptions = {
  /** Defaults to `createAuth().handler`. Injectable for route harness tests. */
  handleAuth?: AuthRequestHandler;
};

/**
 * Map a request URL pathname to the Better Auth relative path.
 * `/api/auth/admin/ban-user` → `/admin/ban-user`
 * Already-relative paths (e.g. `/admin/ban-user`) pass through unchanged.
 */
export function toAuthRelativePath(pathname: string): string {
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? pathname;
  let path = withoutQuery;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  if (path === AUTH_API_BASE_PATH) return '/';
  if (path.startsWith(`${AUTH_API_BASE_PATH}/`)) {
    return path.slice(AUTH_API_BASE_PATH.length);
  }
  return path.startsWith('/') ? path : `/${path}`;
}

export function resolveAuthEndpointDispatch(
  pathname: string
): AuthEndpointDispatchDecision {
  const relative = toAuthRelativePath(pathname);
  if (DISABLED_AUTH_ADMIN_ENDPOINT_SET.has(relative)) {
    return { kind: 'not_found' };
  }
  // #366: if (relative === '/admin/set-role') return { kind: 'set_role' };
  return { kind: 'forward' };
}

export function authEndpointNotFoundResponse(): Response {
  return Response.json(
    {
      error: {
        code: AUTH_ENDPOINT_NOT_FOUND_CODE,
        message: 'Not found.',
      },
    },
    { status: 404 }
  );
}

async function defaultHandleAuth(request: Request): Promise<Response> {
  const { createAuth } = await import('@/auth/auth');
  return createAuth().handler(request);
}

/**
 * Real GET/POST handlers for `/api/auth/$`.
 * Disabled bare admin endpoints return 404 before Better Auth; everything else
 * is forwarded unchanged (including self-serve `/delete-user` and live admin
 * ban/unban/create/update paths).
 */
export function createAuthCatchAllHandlers(
  options: CreateAuthCatchAllHandlersOptions = {}
) {
  const handleAuth = options.handleAuth ?? defaultHandleAuth;

  const handle = async ({ request }: { request: Request }) => {
    const pathname = new URL(request.url).pathname;
    const decision = resolveAuthEndpointDispatch(pathname);
    if (decision.kind === 'not_found') {
      return authEndpointNotFoundResponse();
    }
    // #366: if (decision.kind === 'set_role') return customSetRoleHandler(request);
    return handleAuth(request);
  };

  return {
    GET: handle,
    POST: handle,
  };
}

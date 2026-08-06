import type { AuthSession, AuthSessionGetter } from '@/auth/recent-admin-session';
import {
  authorizeAdminConfigProxyRequest,
  observeAdminConfigProxyDenied,
  type AdminConfigProxyDeniedObservation,
  type AuthorizeAdminConfigProxyRequestInput,
  type AdminConfigProxyAuthorizationResult,
} from '@/lib/admin-config-proxy-authorization';
import {
  CoreRequestBoundaryError,
  readRequestText,
} from '@/lib/core-request';
import { authorizeWorkspaceCoreRequest } from '@/lib/workspace-core-authorization';

export type P1ModuleProxyResource = 'p1/commands' | 'p1/query';

export type P1ModuleProxyForwardUpstream = (input: {
  request: Request;
  body: string | undefined;
  session: AuthSession;
  resource: P1ModuleProxyResource;
}) => Promise<Response>;

export type AuthorizeAdminConfigProxyRequest = (
  input: AuthorizeAdminConfigProxyRequestInput
) => AdminConfigProxyAuthorizationResult;

export type P1ModuleProxyHandlerDeps = {
  getSession: AuthSessionGetter;
  authorizeAdminConfig: AuthorizeAdminConfigProxyRequest;
  forwardUpstream: P1ModuleProxyForwardUpstream;
  observeDenied: (observation: AdminConfigProxyDeniedObservation) => void;
};

export type CreateP1ModuleProxyPostHandlerOptions = Partial<P1ModuleProxyHandlerDeps>;

async function defaultGetSession(
  options: Parameters<AuthSessionGetter>[0]
): Promise<AuthSession | null> {
  const { createAuth } = await import('@/auth/auth');
  return createAuth().api.getSession(options) as Promise<AuthSession | null>;
}

async function defaultForwardUpstream(input: {
  request: Request;
  body: string | undefined;
  session: AuthSession;
  resource: P1ModuleProxyResource;
}): Promise<Response> {
  const { forwardWorkspaceCoreRequest } = await import('@/lib/core-client');
  // Body was already consumed by the gate; rebuild so the production forward
  // can re-read text and re-run the ordinary workspace/Core path.
  const replay = new Request(input.request.url, {
    method: input.request.method,
    headers: input.request.headers,
    body: input.body,
    signal: input.request.signal,
  });
  return forwardWorkspaceCoreRequest(replay, input.resource);
}

function coreRequestBoundaryResponse(error: unknown) {
  if (!(error instanceof CoreRequestBoundaryError)) throw error;
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status }
  );
}

/**
 * Real POST handler factory for `/api/core/p1/commands` and `/api/core/p1/query`.
 * Session getter, admin-config action authorizer, and Core upstream are injectable
 * so route-level harness tests can call the same handler code path.
 */
export function createP1ModuleProxyPostHandler(
  resource: P1ModuleProxyResource,
  options: CreateP1ModuleProxyPostHandlerOptions = {}
) {
  const getSession = options.getSession ?? defaultGetSession;
  const authorizeAdminConfig =
    options.authorizeAdminConfig ?? authorizeAdminConfigProxyRequest;
  const forwardUpstream = options.forwardUpstream ?? defaultForwardUpstream;
  const observeDenied = options.observeDenied ?? observeAdminConfigProxyDenied;

  return async ({ request }: { request: Request }): Promise<Response> => {
    let body: string | undefined;
    try {
      body =
        request.method === 'GET' ? undefined : await readRequestText(request);
    } catch (error) {
      return coreRequestBoundaryResponse(error);
    }

    const authorization = await authorizeWorkspaceCoreRequest(
      request,
      resource,
      body,
      getSession
    );
    if (!authorization.ok) return authorization.response;

    const adminConfig = authorizeAdminConfig({
      body,
      resource,
      session: authorization.session,
    });
    if (!adminConfig.ok) {
      observeDenied(adminConfig.observation);
      return adminConfig.response;
    }

    return forwardUpstream({
      request,
      body,
      session: authorization.session,
      resource,
    });
  };
}

export function createP1CommandsHandlers(
  options: CreateP1ModuleProxyPostHandlerOptions = {}
) {
  return {
    POST: createP1ModuleProxyPostHandler('p1/commands', options),
  };
}

export function createP1QueryHandlers(
  options: CreateP1ModuleProxyPostHandlerOptions = {}
) {
  return {
    POST: createP1ModuleProxyPostHandler('p1/query', options),
  };
}

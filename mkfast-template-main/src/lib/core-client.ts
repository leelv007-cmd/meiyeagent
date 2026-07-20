import { createAuth } from '@/auth/auth';
import { getDb } from '@/db';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { serverEnv } from '@/env/server';
import { coreProxyResponse } from '@/lib/core-stream';
import { isAllowedWorkspaceAssetObjectKey } from '@/lib/core-asset-path';
import { ensureVerifiedWorkspaceProvisioned } from '@/lib/auth/workspace-provisioning';
import {
  workspaceCoreFetchInit,
  workspaceCoreUpstreamPath,
  type WorkspaceHarnessTaskCollectionResource,
  type WorkspaceHarnessDecisionResource,
  type WorkspaceHarnessProductMetricResource,
  type WorkspacePendingActionsResource,
  type WorkspaceWorkflowEventResource,
} from '@/lib/core-request';
import { normalizeProductRole } from '@meiye/contracts';

export async function forwardAuthenticatedCoreRequest(
  request: Request,
  path: string
) {
  const session = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspace = await resolveActiveWorkspace(session.user.id);
  if (!workspace) {
    return Response.json({ error: 'Workspace not found' }, { status: 404 });
  }
  const productRole = normalizeProductRole({
    platformRole: session.user.role,
    workspaceRole: workspace.role,
  });
  if (!productRole) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (session.user.emailVerified && workspace.role === 'owner') {
    await ensureVerifiedWorkspaceProvisioned({
      coreServiceToken: serverEnv.CORE_SERVICE_TOKEN,
      coreServiceUrl: serverEnv.CORE_SERVICE_URL,
      database: getDb(),
      ownerUserId: session.user.id,
      workspaceId: workspace.id,
    });
  }

  const headers = new Headers();
  headers.set('x-service-token', serverEnv.CORE_SERVICE_TOKEN);
  headers.set(
    'x-correlation-id',
    request.headers.get('x-correlation-id') ?? `corr-${crypto.randomUUID()}`
  );
  headers.set(
    'idempotency-key',
    request.headers.get('idempotency-key') ?? crypto.randomUUID()
  );
  headers.set('x-user-id', session.user.id);
  headers.set('x-workspace-id', workspace.id);
  headers.set('x-core-actor', productRole === 'admin' ? 'admin' : 'user');
  headers.set(
    'x-workspace-role',
    productRole === 'admin' ? workspace.role : productRole
  );
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const body = request.method === 'GET' ? undefined : await request.text();
  const upstream = await fetch(`${serverEnv.CORE_SERVICE_URL}${path}`, {
    method: request.method,
    headers,
    body,
  });
  const responseHeaders = new Headers();
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType)
    responseHeaders.set('content-type', upstreamContentType);
  responseHeaders.set('cache-control', 'no-store');
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function forwardWorkspaceCoreRequest(
  request: Request,
  resource:
    | 'state'
    | 'commands'
    | 'p1/commands'
    | 'p1/query'
    | 'p1/assistant/stream'
    | 'p1/copy/stream'
    | 'p1/harness/recommendation'
    | WorkspacePendingActionsResource
    | WorkspaceHarnessTaskCollectionResource
    | WorkspaceHarnessDecisionResource
    | WorkspaceHarnessProductMetricResource
    | WorkspaceWorkflowEventResource
) {
  const session = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id || !session.user.emailVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspace = await resolveActiveWorkspace(session.user.id);
  if (!workspace) {
    return Response.json({ error: 'Workspace not found' }, { status: 404 });
  }
  const productRole = normalizeProductRole({
    platformRole: session.user.role,
    workspaceRole: workspace.role,
  });
  if (!productRole) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (workspace.role === 'owner') {
    await ensureVerifiedWorkspaceProvisioned({
      coreServiceToken: serverEnv.CORE_SERVICE_TOKEN,
      coreServiceUrl: serverEnv.CORE_SERVICE_URL,
      database: getDb(),
      ownerUserId: session.user.id,
      workspaceId: workspace.id,
    });
  }

  const headers = new Headers();
  headers.set('x-service-token', serverEnv.CORE_SERVICE_TOKEN);
  headers.set('x-user-id', session.user.id);
  headers.set('x-workspace-id', workspace.id);
  headers.set('x-core-actor', productRole === 'admin' ? 'admin' : 'user');
  headers.set(
    'x-workspace-role',
    productRole === 'admin' ? workspace.role : productRole
  );
  headers.set(
    'x-correlation-id',
    request.headers.get('x-correlation-id') ?? `corr-${crypto.randomUUID()}`
  );
  headers.set(
    'idempotency-key',
    request.headers.get('idempotency-key') ?? crypto.randomUUID()
  );
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const body = request.method === 'GET' ? undefined : await request.text();
  const upstream = await fetch(
    `${serverEnv.CORE_SERVICE_URL}${workspaceCoreUpstreamPath(
      workspace.id,
      resource,
      request.url
    )}`,
    workspaceCoreFetchInit(request, headers, body)
  );
  return coreProxyResponse(upstream);
}

export async function forwardWorkspaceAssetRequest(request: Request) {
  const session = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id || !session.user.emailVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspace = await resolveActiveWorkspace(session.user.id);
  if (!workspace) {
    return Response.json({ error: 'Workspace not found' }, { status: 404 });
  }
  const productRole = normalizeProductRole({
    platformRole: session.user.role,
    workspaceRole: workspace.role,
  });
  if (!productRole) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const objectKey = new URL(request.url).searchParams.get('objectKey');
  if (!objectKey || !isAllowedWorkspaceAssetObjectKey(objectKey)) {
    return Response.json({ error: 'Asset not found' }, { status: 404 });
  }
  if (objectKey.split('/')[0] !== workspace.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const headers = new Headers();
  headers.set('x-service-token', serverEnv.CORE_SERVICE_TOKEN);
  headers.set('x-user-id', session.user.id);
  headers.set('x-workspace-id', workspace.id);
  headers.set('x-core-actor', productRole === 'admin' ? 'admin' : 'user');
  headers.set(
    'x-workspace-role',
    productRole === 'admin' ? workspace.role : productRole
  );
  headers.set('x-correlation-id', `asset-${crypto.randomUUID()}`);
  const path = objectKey.split('/').map(encodeURIComponent).join('/');
  const upstream = await fetch(
    `${serverEnv.CORE_SERVICE_URL}/v1/assets/${path}`,
    { headers }
  );
  const responseHeaders = new Headers({
    'cache-control': 'private, max-age=31536000, immutable',
    'content-type':
      upstream.headers.get('content-type') ?? 'application/octet-stream',
  });
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) responseHeaders.set('content-length', contentLength);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

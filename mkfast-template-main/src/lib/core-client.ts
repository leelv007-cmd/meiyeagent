import { requireActiveSession } from '@/auth/active-session';
import { getDb } from '@/db';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { serverEnv } from '@/env/server';
import { coreProxyResponse } from '@/lib/core-stream';
import {
  isAllowedWorkspaceAssetObjectKey,
  workspaceIntakeUploadDigest,
} from '@/lib/core-asset-path';
import { ensureVerifiedWorkspaceProvisioned } from '@/lib/auth/workspace-provisioning';
import {
  CoreRequestBoundaryError,
  coreFetch,
  forwardedCorrelationId,
  forwardedIdempotencyKey,
  readRequestBytes,
  readRequestText,
  workspaceCoreFetchInit,
  workspaceCoreUpstreamPath,
  type WorkspaceComposerDestinationResource,
  type WorkspaceComposerSubmissionResource,
  type WorkspaceComposerTaskReviseResource,
  type WorkspaceComposerTaskStartResource,
  type WorkspaceAgentSemanticResource,
  type WorkspaceConfirmationDecisionResource,
  type WorkspaceHarnessTaskCollectionResource,
  type WorkspaceHarnessDecisionResource,
  type WorkspaceHarnessInteractionResource,
  type WorkspaceHarnessProductMetricResource,
  type WorkspacePendingActionsResource,
  type WorkspacePendingInterruptResource,
  type WorkspaceWorkflowEventResource,
} from '@/lib/core-request';
import { normalizeProductRole } from '@meiye/contracts';
import { sha256Hex } from '@/p1/workspace-asset-upload';
import { authorizeWorkspaceCoreRequest } from '@/lib/workspace-core-authorization';

export async function forwardAuthenticatedCoreRequest(
  request: Request,
  path: string
) {
  const active = await requireActiveSession({ headers: request.headers });
  if (!active.ok) {
    return active.response;
  }
  const session = active.session;
  if (!session.user.id) {
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
    forwardedCorrelationId(request.headers.get('x-correlation-id'))
  );
  try {
    headers.set(
      'idempotency-key',
      forwardedIdempotencyKey(request.headers.get('idempotency-key'))
    );
  } catch (error) {
    return coreRequestBoundaryResponse(error);
  }
  headers.set('x-user-id', session.user.id);
  headers.set('x-workspace-id', workspace.id);
  headers.set('x-core-actor', productRole === 'admin' ? 'admin' : 'user');
  headers.set(
    'x-workspace-role',
    productRole === 'admin' ? workspace.role : productRole
  );
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  let body: string | undefined;
  try {
    body =
      request.method === 'GET' ? undefined : await readRequestText(request);
  } catch (error) {
    return coreRequestBoundaryResponse(error);
  }
  let upstream: Response;
  try {
    upstream = await coreFetch(
      fetch,
      `${serverEnv.CORE_SERVICE_URL}${path}`,
      { body, headers, method: request.method, signal: request.signal },
      { stream: path.endsWith('/events') }
    );
  } catch {
    return coreUnavailableResponse();
  }
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
    | 'p1/harness/recommendation'
    | WorkspaceComposerDestinationResource
    | WorkspaceComposerSubmissionResource
    | WorkspaceComposerTaskReviseResource
    | WorkspaceComposerTaskStartResource
    | WorkspaceAgentSemanticResource
    | WorkspacePendingActionsResource
    | WorkspacePendingInterruptResource
    | WorkspaceHarnessTaskCollectionResource
    | WorkspaceHarnessDecisionResource
    | WorkspaceHarnessInteractionResource
    | WorkspaceHarnessProductMetricResource
    | WorkspaceConfirmationDecisionResource
    | WorkspaceWorkflowEventResource
) {
  let body: string | undefined;
  try {
    body =
      request.method === 'GET' ? undefined : await readRequestText(request);
  } catch (error) {
    return coreRequestBoundaryResponse(error);
  }
  // Production path: no getSession override → requireActiveSession.
  const authorization = await authorizeWorkspaceCoreRequest(
    request,
    resource,
    body
  );
  if (!authorization.ok) return authorization.response;
  const { session } = authorization;

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
    forwardedCorrelationId(request.headers.get('x-correlation-id'))
  );
  try {
    headers.set(
      'idempotency-key',
      forwardedIdempotencyKey(request.headers.get('idempotency-key'))
    );
  } catch (error) {
    return coreRequestBoundaryResponse(error);
  }
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  let upstream: Response;
  try {
    upstream = await coreFetch(
      fetch,
      `${serverEnv.CORE_SERVICE_URL}${workspaceCoreUpstreamPath(
        workspace.id,
        resource,
        request.url
      )}`,
      workspaceCoreFetchInit(request, headers, body),
      {
        stream:
          resource === 'p1/assistant/stream' || resource.endsWith('/events'),
      }
    );
  } catch {
    return coreUnavailableResponse();
  }
  return coreProxyResponse(upstream);
}

/** Bytes a merchant may push into their own workspace asset space (W02 ①). */
const WORKSPACE_ASSET_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const WORKSPACE_ASSET_PROVIDER_URL_TTL_SECONDS = 10 * 60;

async function workspaceAssetProviderSignature(
  objectKey: string,
  expires: string
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(serverEnv.CORE_SERVICE_TOKEN),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${objectKey}\n${expires}`)
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hasValidWorkspaceAssetProviderSignature(
  url: URL,
  objectKey: string
) {
  const expires = url.searchParams.get('providerExpires');
  const supplied = url.searchParams.get('providerSignature');
  if (
    !expires ||
    !supplied ||
    !/^\d+$/u.test(expires) ||
    !/^[a-f0-9]{64}$/u.test(supplied) ||
    Number(expires) < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }
  const expected = await workspaceAssetProviderSignature(objectKey, expires);
  let different = 0;
  for (let index = 0; index < expected.length; index += 1) {
    different |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return different === 0;
}

export async function forwardWorkspaceAssetRequest(request: Request) {
  const headOnly = request.method === 'HEAD';
  const writing = request.method === 'PUT';
  const requestUrl = new URL(request.url);
  const objectKey = requestUrl.searchParams.get('objectKey');
  if (!objectKey || !isAllowedWorkspaceAssetObjectKey(objectKey)) {
    return Response.json({ error: 'Asset not found' }, { status: 404 });
  }
  const providerAuthorized =
    !writing &&
    (await hasValidWorkspaceAssetProviderSignature(requestUrl, objectKey));
  const serviceWorkspaceId = request.headers.get('x-workspace-id');
  const serviceAuthorized =
    request.headers.get('x-service-token') === serverEnv.CORE_SERVICE_TOKEN &&
    Boolean(serviceWorkspaceId);
  let workspaceId: string;
  let productRole: Exclude<ReturnType<typeof normalizeProductRole>, null>;
  let userId: string | undefined;
  let workspaceRole: string;
  if (providerAuthorized) {
    workspaceId = objectKey.split('/')[0]!;
    productRole = 'owner';
    workspaceRole = 'owner';
  } else if (serviceAuthorized) {
    workspaceId = serviceWorkspaceId!;
    productRole = 'owner';
    workspaceRole = 'owner';
  } else {
    const active = await requireActiveSession({ headers: request.headers });
    if (!active.ok) {
      return active.response;
    }
    const session = active.session;
    if (!session.user.id || !session.user.emailVerified) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const workspace = await resolveActiveWorkspace(session.user.id);
    if (!workspace) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }
    const resolvedProductRole = normalizeProductRole({
      platformRole: session.user.role,
      workspaceRole: workspace.role,
    });
    if (!resolvedProductRole) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    productRole = resolvedProductRole;
    userId = session.user.id;
    workspaceId = workspace.id;
    workspaceRole = productRole === 'admin' ? workspace.role : productRole;
  }
  if (objectKey.split('/')[0] !== workspaceId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const headers = new Headers();
  headers.set('x-service-token', serverEnv.CORE_SERVICE_TOKEN);
  if (userId) headers.set('x-user-id', userId);
  headers.set('x-workspace-id', workspaceId);
  headers.set('x-core-actor', productRole === 'admin' ? 'admin' : 'user');
  headers.set('x-workspace-role', workspaceRole);
  headers.set('x-correlation-id', `asset-${crypto.randomUUID()}`);
  const path = objectKey.split('/').map(encodeURIComponent).join('/');

  if (writing) {
    // Writing is narrower than reading twice over. The key has to be an intake
    // object whose name *is* the digest of its bytes, so a merchant cannot
    // aim the write at an unrelated canvas asset or store content that does not
    // match what the key claims. And the body is read bounded rather than
    // buffered whole: a chunked upload declares no `Content-Length`, so
    // `arrayBuffer()` first would let an authenticated member decide how much
    // Worker memory this proxy spends before the 413 is reached.
    const digest = workspaceIntakeUploadDigest(objectKey);
    if (!digest) {
      return Response.json(
        { error: { code: 'ASSET_WRITE_FORBIDDEN' } },
        { status: 403 }
      );
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readRequestBytes(request, WORKSPACE_ASSET_UPLOAD_MAX_BYTES);
    } catch (error) {
      if (!(error instanceof CoreRequestBoundaryError)) throw error;
      return Response.json(
        { error: { code: 'ASSET_PAYLOAD_INVALID' } },
        { status: 413 }
      );
    }
    if (bytes.byteLength === 0) {
      return Response.json(
        { error: { code: 'ASSET_PAYLOAD_INVALID' } },
        { status: 413 }
      );
    }
    if ((await sha256Hex(bytes)) !== digest) {
      return Response.json(
        { error: { code: 'ASSET_DIGEST_MISMATCH' } },
        { status: 400 }
      );
    }
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    headers.set('content-length', String(bytes.byteLength));
    let written: Response;
    try {
      written = await coreFetch(
        fetch,
        `${serverEnv.CORE_SERVICE_URL}/v1/assets/${path}`,
        { body: bytes, headers, method: 'PUT', signal: request.signal }
      );
    } catch {
      return coreUnavailableResponse();
    }
    if (!written.ok) return coreProxyResponse(written);
    const providerExpires = String(
      Math.floor(Date.now() / 1000) + WORKSPACE_ASSET_PROVIDER_URL_TTL_SECONDS
    );
    const providerSignature = await workspaceAssetProviderSignature(
      objectKey,
      providerExpires
    );
    const sourceUrl = new URL('/api/core/p1/assets', requestUrl.origin);
    sourceUrl.searchParams.set('objectKey', objectKey);
    sourceUrl.searchParams.set('providerExpires', providerExpires);
    sourceUrl.searchParams.set('providerSignature', providerSignature);
    return Response.json({ sourceUrl: sourceUrl.toString() });
  }

  let upstream: Response;
  try {
    upstream = await coreFetch(
      fetch,
      `${serverEnv.CORE_SERVICE_URL}/v1/assets/${path}`,
      { headers, method: 'GET', signal: request.signal },
      { stream: true }
    );
  } catch {
    return coreUnavailableResponse();
  }
  const responseHeaders = new Headers({
    'cache-control': 'private, max-age=31536000, immutable',
    'content-type':
      upstream.headers.get('content-type') ?? 'application/octet-stream',
  });
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) responseHeaders.set('content-length', contentLength);
  if (new URL(request.url).searchParams.get('download') === '1') {
    const fileName = objectKey.split('/').at(-1) ?? 'download';
    responseHeaders.set(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
  }
  return new Response(headOnly ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

function coreRequestBoundaryResponse(error: unknown) {
  if (!(error instanceof CoreRequestBoundaryError)) throw error;
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status }
  );
}

function coreUnavailableResponse() {
  return Response.json(
    {
      error: { code: 'CORE_UNAVAILABLE', message: 'Product Core unavailable.' },
    },
    { status: 503 }
  );
}

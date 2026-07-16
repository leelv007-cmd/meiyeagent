import { createAuth } from '@/auth/auth';
import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { serverEnv } from '@/env/server';
import {
  configuredGrowthPriceIds,
  resolvePaymentEntitlement,
} from '@/lib/auth/payment-entitlement';
import { coreProxyResponse } from '@/lib/core-stream';
import { isAllowedWorkspaceAssetObjectKey } from '@/lib/core-asset-path';
import { workspaceCoreFetchInit } from '@/lib/core-request';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { normalizeProductRole } from '@meiye/contracts';

async function syncEntitlementFromPayments(
  userId: string,
  workspaceId: string,
  headers: Headers
) {
  const growthPriceIds = configuredGrowthPriceIds(process.env);
  if (growthPriceIds.size === 0) return;
  const [latestPayment] = await getDb()
    .select({
      id: payment.id,
      paid: payment.paid,
      periodEnd: payment.periodEnd,
      priceId: payment.priceId,
      status: payment.status,
      type: payment.type,
      updatedAt: payment.updatedAt,
    })
    .from(payment)
    .where(
      and(
        eq(payment.userId, userId),
        inArray(payment.priceId, [...growthPriceIds])
      )
    )
    .orderBy(desc(payment.updatedAt))
    .limit(1);
  if (!latestPayment) return;

  const plan = resolvePaymentEntitlement(latestPayment, growthPriceIds);
  const eventId = [
    'payment',
    latestPayment.id,
    latestPayment.updatedAt.toISOString(),
    latestPayment.status,
    latestPayment.paid ? 'paid' : 'unpaid',
    plan,
  ].join('-');
  const syncHeaders = new Headers(headers);
  syncHeaders.set('content-type', 'application/json');
  syncHeaders.set('idempotency-key', eventId);
  syncHeaders.set('x-core-actor', 'payment');
  const response = await fetch(
    `${serverEnv.CORE_SERVICE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/commands`,
    {
      method: 'POST',
      headers: syncHeaders,
      body: JSON.stringify({
        type: 'apply_plan',
        plan,
        eventId,
        effectiveAt: latestPayment.updatedAt.toISOString(),
      }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Core entitlement sync failed (${response.status}): ${await response.text()}`
    );
  }
}

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

  if (
    resource === 'state' &&
    (productRole === 'admin' || productRole === 'owner')
  ) {
    await syncEntitlementFromPayments(session.user.id, workspace.id, headers);
  }

  const body = request.method === 'GET' ? undefined : await request.text();
  const upstream = await fetch(
    `${serverEnv.CORE_SERVICE_URL}/v1/workspaces/${encodeURIComponent(workspace.id)}/${resource}`,
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

import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { createFileRoute } from '@tanstack/react-router';
import * as z from 'zod';
import { createAuth } from '@/auth/auth';
import { getDb } from '@/db';
import { workspaceMemberships } from '@/db/app.schema';
import { session as authSession, user } from '@/db/auth.schema';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { serverEnv } from '@/env/server';

export const Route = createFileRoute('/api/pro-studio/launch')({
  server: {
    handlers: {
      POST: ({ request }) => handleLaunch(request),
    },
  },
});

const validationSchema = z.strictObject({
  action: z.literal('validate'),
  audience: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('workspace') }),
    z.strictObject({
      kind: z.literal('project'),
      projectId: z.string().min(1),
    }),
  ]),
  mainSessionId: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
});

async function handleLaunch(request: Request) {
  if (request.headers.get('content-type')?.includes('application/json')) {
    return validateUpstreamSession(request);
  }
  return issueForBrowser(request);
}

async function validateUpstreamSession(request: Request) {
  if (
    request.headers.get('x-canvas-service-token') !==
    serverEnv.CANVAS_SERVICE_TOKEN
  ) {
    return new Response(null, { status: 401 });
  }
  const parsed = validationSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) return new Response(null, { status: 400 });
  const input = parsed.data;
  const [active] = await getDb()
    .select({ id: authSession.id })
    .from(authSession)
    .innerJoin(user, eq(user.id, authSession.userId))
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.userId, authSession.userId),
        eq(workspaceMemberships.workspaceId, input.workspaceId)
      )
    )
    .where(
      and(
        eq(authSession.id, input.mainSessionId),
        eq(authSession.userId, input.userId),
        gt(authSession.expiresAt, new Date()),
        or(isNull(user.banned), eq(user.banned, false))
      )
    )
    .limit(1);
  return new Response(null, {
    headers: { 'cache-control': 'no-store' },
    status: active ? 204 : 401,
  });
}

async function issueForBrowser(request: Request) {
  const canvasOrigin = new URL(serverEnv.CANVAS_ORIGIN).origin;
  if (request.headers.get('origin') !== canvasOrigin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const current = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (!current?.user?.id || !current.user.emailVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspace = await resolveActiveWorkspace(current.user.id);
  if (!workspace) {
    return Response.json({ error: 'Workspace not found' }, { status: 404 });
  }
  const form = await request.formData();
  const browserNonce = form.get('browserNonce');
  const audienceKind = form.get('audience');
  const projectId = form.get('projectId');
  if (
    typeof browserNonce !== 'string' ||
    browserNonce.length < 32 ||
    (audienceKind !== 'workspace' && audienceKind !== 'project') ||
    (audienceKind === 'project' && typeof projectId !== 'string')
  ) {
    return Response.json({ error: 'Invalid launch request' }, { status: 400 });
  }
  const audience =
    audienceKind === 'project'
      ? { kind: 'project' as const, projectId: projectId as string }
      : { kind: 'workspace' as const };
  const canvasServiceUrl = new URL(
    '/api/internal/launch-codes',
    serverEnv.CANVAS_SERVICE_URL
  );
  const upstream = await fetch(canvasServiceUrl, {
    body: JSON.stringify({
      audience,
      bootstrap: {
        locale: normalizeLocale(form.get('locale')),
        returnTo: safeReturnTo(form.get('returnTo')),
        theme: normalizeTheme(form.get('theme')),
      },
      browserNonce,
      mainSessionId: current.session.id,
      userId: current.user.id,
      workspaceId: workspace.id,
    }),
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-canvas-service-token': serverEnv.CANVAS_SERVICE_TOKEN,
    },
    method: 'POST',
  });
  if (!upstream.ok) {
    return Response.json(
      { error: 'Pro Studio launch is unavailable' },
      { status: upstream.status >= 500 ? 503 : upstream.status }
    );
  }
  const issued = z
    .strictObject({ code: z.string().min(32), expiresAt: z.string() })
    .parse(await upstream.json());
  return formPostResponse(
    new URL('/exchange', canvasOrigin).href,
    issued.code,
    canvasOrigin
  );
}

function formPostResponse(action: string, code: string, canvasOrigin: string) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>正在进入 Pro Studio</title></head><body><form id="exchange" method="post" action="${escapeHtml(action)}"><input type="hidden" name="code" value="${escapeHtml(code)}"><noscript><button type="submit">继续进入 Pro Studio</button></noscript></form><script>document.getElementById('exchange').submit()</script></body></html>`;
  return new Response(html, {
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; form-action ${canvasOrigin}; base-uri 'none'; frame-ancestors 'none'`,
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
    },
  });
}

function normalizeTheme(value: FormDataEntryValue | null) {
  return value === 'dark' || value === 'light' ? value : 'system';
}

function normalizeLocale(value: FormDataEntryValue | null) {
  return typeof value === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(value)
    ? value
    : 'zh-CN';
}

function safeReturnTo(value: FormDataEntryValue | null) {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
    ? value
    : '/dashboard';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

import { createFileRoute } from '@tanstack/react-router';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { and, eq } from 'drizzle-orm';
import { createAuth } from '@/auth/auth';
import { getDb } from '@/db';
import { userFiles, workspaceMemberships } from '@/db/app.schema';
import { getFile } from '@/storage';
import { isPublicFolder } from '@/storage/utils';
import { ConfigurationError } from '@/storage/types';
import { serverEnv } from '@/env/server';

/**
 * Serves a file by key via the storage provider (same-origin proxy URL).
 * Shared asset folders stay public; private user files require workspace membership.
 */
export const Route = createFileRoute('/api/storage/file')({
  server: {
    handlers: {
      GET: async ({ request }) => serveFile(request, false),
      HEAD: async ({ request }) => serveFile(request, true),
    },
  },
});

async function serveFile(request: Request, headOnly: boolean) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key || key.includes('..')) {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    const serviceWorkspaceId = request.headers.get('x-workspace-id');
    const serviceAuthorized =
      request.headers.get('x-service-token') === serverEnv.CORE_SERVICE_TOKEN &&
      Boolean(serviceWorkspaceId) &&
      key.startsWith(`${serviceWorkspaceId}/`);
    const headers = getRequestHeaders();
    const session = serviceAuthorized
      ? null
      : await createAuth().api.getSession({ headers });
    const userId = session?.user?.id;
    const isPublicKey = isPublicFolder(key);

    const db = getDb();
    const [fileRecord] = await db
      .select({
        contentType: userFiles.contentType,
        workspaceId: userFiles.workspaceId,
        isPublic: userFiles.isPublic,
        size: userFiles.size,
      })
      .from(userFiles)
      .where(eq(userFiles.r2Key, key))
      .limit(1);

    if (!fileRecord && !isPublicKey) {
      return new Response('Not Found', { status: 404 });
    }

    if (
      serviceAuthorized &&
      (!fileRecord || fileRecord.workspaceId !== serviceWorkspaceId)
    ) {
      return new Response('Forbidden', { status: 403 });
    }

    if (fileRecord && !fileRecord.isPublic && !serviceAuthorized) {
      if (!userId) {
        return new Response('Forbidden', { status: 403 });
      }
      const [membership] = await db
        .select({ workspaceId: workspaceMemberships.workspaceId })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, fileRecord.workspaceId),
            eq(workspaceMemberships.userId, userId)
          )
        )
        .limit(1);
      if (!membership) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const file = await getFile(key);
    if (!file) {
      return new Response('Not Found', { status: 404 });
    }

    // Only allow safe content types to be rendered inline;
    // force download for everything else to prevent stored XSS.
    const safeInlineTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/x-icon',
      'application/pdf',
      'video/mp4',
    ];
    const isPublicFile = fileRecord?.isPublic === true || isPublicKey;
    const responseHeaders: Record<string, string> = {
      'Content-Type': file.contentType,
      'Cache-Control': isPublicFile
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (fileRecord) {
      responseHeaders['Content-Length'] = String(fileRecord.size);
    }
    if (!safeInlineTypes.includes(file.contentType)) {
      responseHeaders['Content-Disposition'] = 'attachment';
    }

    return new Response(headOnly ? null : file.body, {
      headers: responseHeaders,
    });
  } catch (e) {
    if (e instanceof ConfigurationError) {
      return new Response('Storage not configured', { status: 503 });
    }
    throw e;
  }
}

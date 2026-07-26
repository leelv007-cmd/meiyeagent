import { createFileRoute } from '@tanstack/react-router';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { and, eq } from 'drizzle-orm';
import { createAuth } from '@/auth/auth';
import { getDb } from '@/db';
import {
  legacyAvatarAccessClaims,
  userFiles,
  workspaceMemberships,
} from '@/db/app.schema';
import { user } from '@/db/auth.schema';
import { getFile } from '@/storage';
import {
  hasActiveLegacyAvatarClaim,
  isStrictLegacyAvatarKey,
} from '@/storage/legacy-avatar';
import { ConfigurationError } from '@/storage/types';
import { serverEnv } from '@/env/server';

/**
 * Serves a file by key via the storage provider (same-origin proxy URL).
 * Only DB-authorized avatars are public; every other file requires authorization.
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
    const db = getDb();
    const legacyKey = isStrictLegacyAvatarKey(key);
    const [legacyClaim] = legacyKey
      ? await db
          .select({
            imageUrl: legacyAvatarAccessClaims.imageUrl,
            objectKey: legacyAvatarAccessClaims.objectKey,
            userImage: user.image,
          })
          .from(legacyAvatarAccessClaims)
          .innerJoin(user, eq(legacyAvatarAccessClaims.userId, user.id))
          .where(eq(legacyAvatarAccessClaims.objectKey, key))
          .limit(1)
      : [];
    const [fileRecord] = await db
      .select({
        contentType: userFiles.contentType,
        description: userFiles.description,
        deletedAt: userFiles.deletedAt,
        workspaceId: userFiles.workspaceId,
        isPublic: userFiles.isPublic,
        purpose: userFiles.purpose,
        size: userFiles.size,
      })
      .from(userFiles)
      .where(eq(userFiles.r2Key, key))
      .limit(1);

    if (fileRecord?.deletedAt) {
      return new Response('Not Found', { status: 404 });
    }
    if (!fileRecord && !legacyClaim) {
      return new Response('Not Found', { status: 404 });
    }

    const legacyFile = legacyClaim ? await getFile(key) : null;
    const legacyClaimIsActive =
      legacyClaim && legacyFile
        ? hasActiveLegacyAvatarClaim(legacyClaim, legacyFile.contentType)
        : false;
    const isMetadataAvatar =
      fileRecord?.purpose === 'avatar' && fileRecord.isPublic === true;
    const isPublicFile = Boolean(
      (isMetadataAvatar && (!legacyKey || legacyClaimIsActive)) ||
        (!fileRecord && legacyClaimIsActive)
    );

    if (!fileRecord && !isPublicFile) {
      return new Response('Not Found', { status: 404 });
    }

    if (
      serviceAuthorized &&
      (!fileRecord || fileRecord.workspaceId !== serviceWorkspaceId)
    ) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!isPublicFile && !serviceAuthorized) {
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

    const file = legacyFile ?? (await getFile(key));
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
    const responseHeaders: Record<string, string> = {
      'Content-Type': file.contentType,
      'Cache-Control': isPublicFile
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (fileRecord) {
      responseHeaders['Content-Length'] = String(fileRecord.size);
      const productAssetSha256 =
        fileRecord.purpose === 'product_asset'
          ? fileRecord.description?.match(
              /^product-asset:([a-f0-9]{64})$/u
            )?.[1]
          : undefined;
      if (productAssetSha256) {
        responseHeaders['X-Content-SHA256'] = productAssetSha256;
      }
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

import { getDb } from '@/db';
import { userFiles } from '@/db/app.schema';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { authApiMiddleware } from '@/middlewares/auth-middleware';
import { requireWorkspaceCapability } from '@/lib/workspace-authorization';
import { uploadFile } from '@/storage';
import { createServerFn } from '@tanstack/react-start';
import { and, eq } from 'drizzle-orm';

const uploadSchema = (value: unknown) => {
  if (!(value instanceof FormData)) throw new Error('Form data is required');
  const file = value.get('file');
  if (!(file instanceof File))
    throw new Error('Select an image or short video');
  const uploadIdValue = value.get('uploadId');
  const uploadId =
    typeof uploadIdValue === 'string' &&
    /^[a-zA-Z0-9-]{1,100}$/.test(uploadIdValue)
      ? uploadIdValue
      : undefined;
  const contentHashValue = value.get('contentHash');
  const contentHash =
    typeof contentHashValue === 'string' &&
    /^[a-f0-9]{64}$/.test(contentHashValue)
      ? contentHashValue
      : undefined;
  if (uploadId && !contentHash) throw new Error('File hash is required');
  return { contentHash, file, uploadId };
};

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export const uploadProductAsset = createServerFn({ method: 'POST' })
  .inputValidator(uploadSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const workspace = await resolveActiveWorkspace(context.userId);
    if (!workspace) throw new Error('Workspace not found');
    requireWorkspaceCapability(workspace.role, 'content.create');
    const db = getDb();
    const bytes = await data.file.arrayBuffer();
    const contentHash = await sha256(bytes);
    if (data.contentHash && data.contentHash !== contentHash) {
      throw new Error('File hash mismatch');
    }
    const uploadDescription = data.uploadId
      ? `mobile-upload:${data.uploadId}:${contentHash}`
      : undefined;
    if (uploadDescription) {
      const [stored] = await db
        .select({
          contentType: userFiles.contentType,
          key: userFiles.r2Key,
        })
        .from(userFiles)
        .where(
          and(
            eq(userFiles.workspaceId, workspace.id),
            eq(userFiles.description, uploadDescription)
          )
        )
        .limit(1);
      if (stored) {
        return {
          key: stored.key,
          url: `/api/storage/file?key=${encodeURIComponent(stored.key)}`,
          contentType: stored.contentType,
          replayed: true,
        };
      }
    }
    const fileBody = new Blob([bytes], {
      type: data.file.type,
    });
    const result = await uploadFile(fileBody, data.file.name, data.file.type, {
      folder: `${workspace.id}/assets`,
      userId: context.userId,
    });
    if (result.metadata) {
      const timestamp = result.metadata.uploadedAt;
      await db.insert(userFiles).values({
        id: result.metadata.id,
        userId: context.userId,
        workspaceId: workspace.id,
        filename: result.metadata.filename,
        originalName: result.metadata.originalName,
        contentType: result.metadata.contentType,
        size: result.metadata.size,
        r2Key: result.metadata.r2Key,
        createdAt: timestamp,
        updatedAt: timestamp,
        isPublic: false,
        description: uploadDescription ?? 'P0 real store asset',
      });
    }
    return {
      key: result.key,
      url: result.url,
      contentType: data.file.type,
      contentHash,
      replayed: false,
    };
  });

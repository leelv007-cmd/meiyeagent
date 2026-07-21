import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { userFiles } from '@/db/app.schema';
import { deleteFile, uploadFile } from './index';
import { uploadAndPersistObject } from './object-lifecycle';
import { enqueueStorageDelete } from './object-outbox';
import { resolveUploadPolicy, type UploadPurpose } from './upload-policy';

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

async function persistUserFile(input: {
  description?: string;
  file: File;
  folder?: string;
  isPublic: boolean;
  purpose: UploadPurpose;
  requestOrigin: string;
  userId: string;
  workspaceId: string;
}) {
  const bytes = await input.file.arrayBuffer();
  const database = getDb();
  return uploadAndPersistObject(
    {
      reason: 'upload_compensation',
      userId: input.userId,
      workspaceId: input.workspaceId,
    },
    {
      deleteObject: deleteFile,
      enqueueDelete: async (intent) => {
        await enqueueStorageDelete(intent);
      },
      persistMetadata: async (metadata) => {
        const timestamp = metadata.uploadedAt;
        await database.insert(userFiles).values({
          id: metadata.id,
          userId: input.userId,
          workspaceId: input.workspaceId,
          filename: metadata.filename,
          originalName: metadata.originalName,
          contentType: metadata.contentType,
          size: metadata.size,
          r2Key: metadata.r2Key,
          purpose: input.purpose,
          createdAt: timestamp,
          updatedAt: timestamp,
          isPublic: input.isPublic,
          description: input.description,
        });
      },
      uploadObject: () =>
        uploadFile(
          new Blob([bytes], { type: input.file.type }),
          input.file.name,
          input.file.type,
          {
            folder: input.folder,
            purpose: input.purpose,
            requestOrigin: input.requestOrigin,
            userId: input.userId,
            workspaceId: input.workspaceId,
          }
        ),
    }
  );
}

export async function uploadUserFile(input: {
  description?: string;
  file: File;
  purpose: 'avatar' | 'private_file';
  requestOrigin: string;
  userId: string;
  workspaceId: string;
}) {
  const policy = resolveUploadPolicy(input.purpose);
  return persistUserFile({
    ...input,
    description:
      input.purpose === 'avatar' ? 'profile-avatar' : input.description,
    folder: policy.folder,
    isPublic: policy.isPublic,
  });
}

export async function uploadProductAsset(input: {
  contentHash?: string;
  file: File;
  requestOrigin: string;
  uploadId?: string;
  userId: string;
  workspaceId: string;
}) {
  const bytes = await input.file.arrayBuffer();
  const contentHash = await sha256(bytes);
  if (input.contentHash && input.contentHash !== contentHash) {
    throw new Error('File hash mismatch');
  }
  const uploadDescription = input.uploadId
    ? `mobile-upload:${input.uploadId}:${contentHash}`
    : undefined;
  const database = getDb();
  if (uploadDescription) {
    const [stored] = await database
      .select({
        contentType: userFiles.contentType,
        key: userFiles.r2Key,
      })
      .from(userFiles)
      .where(
        and(
          eq(userFiles.workspaceId, input.workspaceId),
          eq(userFiles.description, uploadDescription),
          isNull(userFiles.deletedAt)
        )
      )
      .limit(1);
    if (stored) {
      return {
        key: stored.key,
        url: `${input.requestOrigin}/api/storage/file?key=${encodeURIComponent(stored.key)}`,
        contentType: stored.contentType,
        contentHash,
        replayed: true,
      };
    }
  }

  const result = await persistUserFile({
    description: uploadDescription ?? 'P0 real store asset',
    file: new File([bytes], input.file.name, { type: input.file.type }),
    folder: `${input.workspaceId}/assets`,
    isPublic: false,
    purpose: 'product_asset',
    requestOrigin: input.requestOrigin,
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
  return {
    key: result.key,
    url: result.url,
    contentType: input.file.type,
    contentHash,
    replayed: false,
  };
}

import { and, eq, isNull, sql } from 'drizzle-orm';
import { sharedAssetObjectLockKey } from '@meiye/contracts';
import { getDb } from '@/db';
import { storageObjectCleanupClaims, userFiles } from '@/db/app.schema';
import { deleteFile, inspectSharedAsset, uploadFile } from './index';
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
  contentHash?: string;
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
        const values = {
          id: metadata.id,
          userId: input.userId,
          workspaceId: input.workspaceId,
          filename: metadata.filename,
          originalName: metadata.originalName,
          contentType: metadata.contentType,
          size: metadata.size,
          r2Key: metadata.r2Key,
          storageRevision: metadata.storageRevision,
          purpose: input.purpose,
          createdAt: timestamp,
          updatedAt: timestamp,
          isPublic: input.isPublic,
          description: input.description,
        };
        if (input.purpose !== 'product_asset') {
          await database.insert(userFiles).values(values);
          return;
        }
        const objectLockKey = sharedAssetObjectLockKey(
          input.workspaceId,
          metadata.r2Key
        );
        await database.transaction(async (transaction) => {
          await transaction.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${objectLockKey}))`
          );
          const [cleanupClaim] = await transaction
            .select({
              receiptStorageRevision:
                storageObjectCleanupClaims.receiptStorageRevision,
              status: storageObjectCleanupClaims.status,
            })
            .from(storageObjectCleanupClaims)
            .where(
              and(
                eq(storageObjectCleanupClaims.workspaceId, input.workspaceId),
                eq(storageObjectCleanupClaims.objectKey, metadata.r2Key)
              )
            )
            .limit(1);
          if (cleanupClaim?.status === 'deleting') {
            throw new Error(
              'Shared asset cleanup is in progress; retry registration.'
            );
          }
          if (
            cleanupClaim?.status === 'deleted' &&
            cleanupClaim.receiptStorageRevision === metadata.storageRevision
          ) {
            throw new Error(
              'Shared asset was deleted during registration; retry upload.'
            );
          }
          if (cleanupClaim?.status === 'delete_failed') {
            throw new Error(
              'Shared asset cleanup is incomplete; retry upload after cleanup succeeds.'
            );
          }
          const sharedState = await inspectSharedAsset(metadata.r2Key);
          if (
            !metadata.storageRevision ||
            !sharedState.objectExists ||
            sharedState.objectVerified !== true ||
            sharedState.receipt?.storageRevision !== metadata.storageRevision
          ) {
            throw new Error(
              'Shared asset receipt and object could not be verified for registration.'
            );
          }
          if (cleanupClaim && cleanupClaim.status === 'deleted') {
            await transaction
              .update(storageObjectCleanupClaims)
              .set({
                lastError: null,
                receiptStorageRevision: metadata.storageRevision,
                status: 'registration_recovered',
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(storageObjectCleanupClaims.workspaceId, input.workspaceId),
                  eq(storageObjectCleanupClaims.objectKey, metadata.r2Key)
                )
              );
          }
          const [existing] = await transaction
            .select({ id: userFiles.id })
            .from(userFiles)
            .where(
              and(
                eq(userFiles.workspaceId, input.workspaceId),
                eq(userFiles.userId, input.userId),
                eq(userFiles.purpose, 'product_asset'),
                eq(userFiles.description, input.description ?? ''),
                isNull(userFiles.deletedAt)
              )
            )
            .limit(1);
          if (!existing) await transaction.insert(userFiles).values(values);
        });
      },
      uploadObject: () =>
        uploadFile(
          new Blob([bytes], { type: input.file.type }),
          input.file.name,
          input.file.type,
          {
            contentHash: input.contentHash,
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

export async function uploadAvatar(input: {
  file: File;
  requestOrigin: string;
  userId: string;
  workspaceId: string;
}) {
  const policy = resolveUploadPolicy('avatar');
  return persistUserFile({
    ...input,
    description: 'profile-avatar',
    folder: policy.folder,
    isPublic: policy.isPublic,
    purpose: 'avatar',
  });
}

export async function uploadProductAsset(input: {
  contentHash?: string;
  file: File;
  requestOrigin: string;
  userId: string;
  workspaceId: string;
}) {
  const bytes = await input.file.arrayBuffer();
  const contentHash = await sha256(bytes);
  if (input.contentHash && input.contentHash !== contentHash) {
    throw new Error('File hash mismatch');
  }
  const uploadDescription = `product-asset:${contentHash}`;
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
          eq(userFiles.userId, input.userId),
          eq(userFiles.purpose, 'product_asset'),
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
    contentHash,
    description: uploadDescription,
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

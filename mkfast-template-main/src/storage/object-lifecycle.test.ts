import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileMetadata, UploadFileResult } from './types';
import {
  processStorageDeleteJob,
  UploadPersistenceError,
  uploadAndPersistObject,
} from './object-lifecycle';

const metadata: FileMetadata = {
  id: 'file-1',
  userId: 'user-1',
  filename: 'file-1-cover.png',
  originalName: 'cover.png',
  contentType: 'image/png',
  size: 8,
  r2Key: 'userfiles/user-1/file-1-cover.png',
  uploadedAt: new Date('2026-07-22T00:00:00.000Z'),
};

test('queues durable recovery when metadata persistence and immediate object cleanup both fail', async () => {
  const recoveries: unknown[] = [];
  const uploaded: UploadFileResult = {
    key: metadata.r2Key,
    metadata,
    url: `/api/storage/file?key=${encodeURIComponent(metadata.r2Key)}`,
  };

  await assert.rejects(
    uploadAndPersistObject(
      {
        reason: 'upload_compensation',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      {
        deleteObject: async () => {
          throw new Error('R2 unavailable');
        },
        enqueueDelete: async (recovery) => {
          recoveries.push(recovery);
        },
        persistMetadata: async () => {
          throw new Error('database unavailable');
        },
        uploadObject: async () => uploaded,
      }
    ),
    (error) =>
      error instanceof UploadPersistenceError &&
      error.compensated === false &&
      error.recoveryQueued === true
  );

  assert.deepEqual(recoveries, [
    {
      objectKey: metadata.r2Key,
      reason: 'upload_compensation',
      userFileId: metadata.id,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
  ]);
});

test('reports successful compensation when metadata persistence fails but object cleanup succeeds', async () => {
  const uploaded: UploadFileResult = {
    key: metadata.r2Key,
    metadata,
    url: `/api/storage/file?key=${encodeURIComponent(metadata.r2Key)}`,
  };
  await assert.rejects(
    uploadAndPersistObject(
      {
        reason: 'upload_compensation',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      {
        deleteObject: async () => undefined,
        enqueueDelete: async () => {
          throw new Error('recovery should not be queued');
        },
        persistMetadata: async () => {
          throw new Error('database unavailable');
        },
        uploadObject: async () => uploaded,
      }
    ),
    (error) =>
      error instanceof UploadPersistenceError &&
      error.compensated === true &&
      error.recoveryQueued === false
  );
});

test('a failed object deletion remains retryable instead of restoring the file', async () => {
  let persistedStatus = 'processing';
  const result = await processStorageDeleteJob(
    {
      id: 'delete-1',
      objectKey: metadata.r2Key,
      reason: 'user_delete',
      userFileId: metadata.id,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    {
      complete: async () => {
        persistedStatus = 'completed';
      },
      deleteObject: async () => {
        throw new Error('R2 unavailable');
      },
      retry: async () => {
        persistedStatus = 'retry';
      },
    }
  );

  assert.deepEqual(result, {
    errorCode: 'OBJECT_DELETE_FAILED',
    status: 'retry',
  });
  assert.equal(persistedStatus, 'retry');
});

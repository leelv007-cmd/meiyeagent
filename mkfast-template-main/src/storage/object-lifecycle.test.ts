import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type FileMetadata,
  type UploadFileResult,
  UploadRegistrationError,
} from './types';
import {
  processStorageDeleteJob,
  SHARED_ASSET_CLEANUP_SAFETY_WINDOW_MS,
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

test('carries the shared receipt revision into deferred cleanup recovery', async () => {
  const recoveries: unknown[] = [];
  const sharedMetadata = { ...metadata, storageRevision: 'receipt-revision-a' };
  let deleteCalls = 0;
  const startedAt = Date.now();
  await assert.rejects(
    uploadAndPersistObject(
      {
        reason: 'upload_compensation',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      {
        deleteObject: async () => {
          deleteCalls += 1;
        },
        enqueueDelete: async (recovery) => {
          recoveries.push(recovery);
        },
        persistMetadata: async () => {
          throw new Error('database unavailable');
        },
        uploadObject: async () => ({
          key: sharedMetadata.r2Key,
          metadata: sharedMetadata,
          url: `/api/storage/file?key=${encodeURIComponent(sharedMetadata.r2Key)}`,
        }),
      }
    )
  );
  assert.equal(deleteCalls, 0);
  const [recovery] = recoveries as [
    {
      availableAt: Date;
      objectKey: string;
      receiptStorageRevision?: string;
      reason: string;
      userFileId: string;
      userId: string;
      workspaceId: string;
    },
  ];
  assert.equal(recoveries.length, 1);
  assert.deepEqual(
    {
      objectKey: recovery?.objectKey,
      receiptStorageRevision: recovery?.receiptStorageRevision,
      reason: recovery?.reason,
      userFileId: recovery?.userFileId,
      userId: recovery?.userId,
      workspaceId: recovery?.workspaceId,
    },
    {
      objectKey: sharedMetadata.r2Key,
      receiptStorageRevision: 'receipt-revision-a',
      reason: 'upload_compensation',
      userFileId: sharedMetadata.id,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }
  );
  assert.ok(
    recovery.availableAt.getTime() >=
      startedAt + SHARED_ASSET_CLEANUP_SAFETY_WINDOW_MS
  );
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

test('queues recovery when receipt registration fails after an object write', async () => {
  const recoveries: unknown[] = [];
  let deleteCalls = 0;
  const startedAt = Date.now();
  await assert.rejects(
    uploadAndPersistObject(
      {
        reason: 'upload_compensation',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      {
        deleteObject: async () => {
          deleteCalls += 1;
        },
        enqueueDelete: async (recovery) => {
          recoveries.push(recovery);
        },
        persistMetadata: async () => {
          throw new Error('must not persist metadata');
        },
        uploadObject: async () => {
          throw new UploadRegistrationError(metadata.r2Key, metadata, {
            cause: new Error('receipt write failed'),
          });
        },
      }
    ),
    (error) =>
      error instanceof UploadPersistenceError &&
      error.compensated === false &&
      error.recoveryQueued === true
  );
  assert.equal(deleteCalls, 0);
  assert.equal(recoveries.length, 1);
  const [recovery] = recoveries as [
    {
      availableAt: Date;
      objectKey: string;
      reason: string;
      userFileId: string;
      userId: string;
      workspaceId: string;
    },
  ];
  assert.equal(recovery.objectKey, metadata.r2Key);
  assert.equal(recovery.reason, 'upload_compensation');
  assert.equal(recovery.userFileId, metadata.id);
  assert.equal(recovery.userId, 'user-1');
  assert.equal(recovery.workspaceId, 'workspace-1');
  assert.ok(
    recovery.availableAt.getTime() >=
      startedAt + SHARED_ASSET_CLEANUP_SAFETY_WINDOW_MS
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

test('does not delete an object that a concurrent metadata write references', async () => {
  let deleted = false;
  let completed = false;
  const result = await processStorageDeleteJob(
    {
      id: 'delete-referenced',
      objectKey: metadata.r2Key,
      reason: 'user_delete',
      userFileId: metadata.id,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    {
      complete: async () => {
        completed = true;
      },
      deleteObject: async () => {
        deleted = true;
      },
      isStillReferenced: async () => true,
      retry: async () => {
        throw new Error('referenced objects do not retry deletion');
      },
    }
  );

  assert.deepEqual(result, { status: 'completed' });
  assert.equal(completed, true);
  assert.equal(deleted, false);
});

import {
  type FileMetadata,
  type UploadFileResult,
  UploadRegistrationError,
} from './types';

export type StorageDeleteReason = 'upload_compensation' | 'user_delete';
export const SHARED_ASSET_CLEANUP_SAFETY_WINDOW_MS = 10 * 60 * 1_000;

export interface StorageDeleteIntent {
  availableAt?: Date;
  objectKey: string;
  receiptStorageRevision?: string;
  reason: StorageDeleteReason;
  userFileId?: string;
  userId: string;
  workspaceId: string;
}

export interface StorageDeleteJob extends StorageDeleteIntent {
  id: string;
}

interface UploadLifecycleDependencies {
  deleteObject: (key: string) => Promise<void>;
  enqueueDelete: (intent: StorageDeleteIntent) => Promise<void>;
  persistMetadata: (metadata: FileMetadata) => Promise<void>;
  uploadObject: () => Promise<UploadFileResult>;
}

export class UploadPersistenceError extends Error {
  readonly compensated: boolean;
  readonly recoveryQueued: boolean;

  constructor(input: {
    cause: unknown;
    compensated: boolean;
    recoveryQueued: boolean;
  }) {
    super('Uploaded object metadata could not be persisted', {
      cause: input.cause,
    });
    this.name = 'UploadPersistenceError';
    this.compensated = input.compensated;
    this.recoveryQueued = input.recoveryQueued;
  }
}

export async function uploadAndPersistObject(
  input: Omit<StorageDeleteIntent, 'objectKey' | 'userFileId'>,
  dependencies: UploadLifecycleDependencies
): Promise<UploadFileResult> {
  let uploaded: UploadFileResult;
  try {
    uploaded = await dependencies.uploadObject();
  } catch (cause) {
    if (!(cause instanceof UploadRegistrationError)) throw cause;
    return enqueueDeferredSharedAssetCleanup(
      input,
      dependencies,
      {
        key: cause.key,
        metadata: cause.metadata,
        url: cause.key,
      },
      cause
    );
  }
  if (!uploaded.metadata) {
    throw new UploadPersistenceError({
      cause: new Error('Uploaded object metadata is missing'),
      compensated: false,
      recoveryQueued: false,
    });
  }

  try {
    await dependencies.persistMetadata(uploaded.metadata);
    return uploaded;
  } catch (cause) {
    return compensateUploadedObject(input, dependencies, uploaded, cause);
  }
}

async function enqueueDeferredSharedAssetCleanup(
  input: Omit<StorageDeleteIntent, 'objectKey' | 'userFileId'>,
  dependencies: UploadLifecycleDependencies,
  uploaded: UploadFileResult,
  cause: unknown
): Promise<never> {
  await dependencies.enqueueDelete({
    availableAt: new Date(Date.now() + SHARED_ASSET_CLEANUP_SAFETY_WINDOW_MS),
    objectKey: uploaded.key,
    ...(uploaded.metadata.storageRevision
      ? { receiptStorageRevision: uploaded.metadata.storageRevision }
      : {}),
    reason: input.reason,
    userFileId: uploaded.metadata.id,
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
  throw new UploadPersistenceError({
    cause,
    compensated: false,
    recoveryQueued: true,
  });
}

async function compensateUploadedObject(
  input: Omit<StorageDeleteIntent, 'objectKey' | 'userFileId'>,
  dependencies: UploadLifecycleDependencies,
  uploaded: UploadFileResult,
  cause: unknown
): Promise<never> {
  // A shared receipt means the database result may be indeterminate after a
  // commit response is lost. Let the durable, object-locked worker recheck for
  // a committed reference instead of deleting an object that may now be live.
  if (uploaded.metadata.storageRevision) {
    return enqueueDeferredSharedAssetCleanup(
      input,
      dependencies,
      uploaded,
      cause
    );
  }
  try {
    await dependencies.deleteObject(uploaded.key);
    throw new UploadPersistenceError({
      cause,
      compensated: true,
      recoveryQueued: false,
    });
  } catch (cleanupError) {
    if (cleanupError instanceof UploadPersistenceError) throw cleanupError;
    await dependencies.enqueueDelete({
      objectKey: uploaded.key,
      ...(uploaded.metadata.storageRevision
        ? { receiptStorageRevision: uploaded.metadata.storageRevision }
        : {}),
      reason: input.reason,
      userFileId: uploaded.metadata.id,
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
    throw new UploadPersistenceError({
      cause,
      compensated: false,
      recoveryQueued: true,
    });
  }
}

export async function processStorageDeleteJob(
  job: StorageDeleteJob,
  dependencies: {
    complete: (job: StorageDeleteJob) => Promise<void>;
    deleteObject: (key: string) => Promise<void>;
    isStillReferenced?: (job: StorageDeleteJob) => Promise<boolean>;
    retry: (job: StorageDeleteJob, errorCode: string) => Promise<void>;
  }
): Promise<{ status: 'completed' } | { errorCode: string; status: 'retry' }> {
  if (await dependencies.isStillReferenced?.(job)) {
    await dependencies.complete(job);
    return { status: 'completed' };
  }
  try {
    await dependencies.deleteObject(job.objectKey);
  } catch {
    const errorCode = 'OBJECT_DELETE_FAILED';
    await dependencies.retry(job, errorCode);
    return { errorCode, status: 'retry' };
  }

  try {
    await dependencies.complete(job);
    return { status: 'completed' };
  } catch {
    const errorCode = 'DELETE_FINALIZATION_FAILED';
    await dependencies.retry(job, errorCode);
    return { errorCode, status: 'retry' };
  }
}

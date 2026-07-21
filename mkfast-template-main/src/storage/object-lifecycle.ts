import type { FileMetadata, UploadFileResult } from './types';

export type StorageDeleteReason = 'upload_compensation' | 'user_delete';

export interface StorageDeleteIntent {
  objectKey: string;
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
  const uploaded = await dependencies.uploadObject();
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
}

export async function processStorageDeleteJob(
  job: StorageDeleteJob,
  dependencies: {
    complete: (job: StorageDeleteJob) => Promise<void>;
    deleteObject: (key: string) => Promise<void>;
    retry: (job: StorageDeleteJob, errorCode: string) => Promise<void>;
  }
): Promise<{ status: 'completed' } | { errorCode: string; status: 'retry' }> {
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

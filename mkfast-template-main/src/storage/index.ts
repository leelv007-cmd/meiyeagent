import { R2Provider } from './provider/r2';
import type {
  FileMetadata,
  SharedAssetObjectState,
  UploadFileResult,
} from './types';
import type { UploadPurpose } from './upload-policy';

let r2: R2Provider | undefined;

/**
 * Get the storage provider (lazy-initialized on first use).
 */
function getR2(): R2Provider {
  r2 ??= new R2Provider();
  return r2;
}

export const uploadFile = async (
  file: Buffer | Blob | File,
  filename: string,
  contentType: string,
  options: {
    contentHash?: string;
    purpose: UploadPurpose;
    requestOrigin?: string;
    userId: string;
    workspaceId: string;
  }
): Promise<UploadFileResult> => {
  return getR2().uploadFile({
    contentHash: options.contentHash,
    file,
    filename,
    contentType,
    purpose: options.purpose,
    userId: options.userId,
    workspaceId: options.workspaceId,
    requestOrigin: options.requestOrigin,
  });
};

export const deleteFile = async (key: string): Promise<void> => {
  return getR2().deleteFile(key);
};

export const inspectSharedAsset = async (
  key: string
): Promise<SharedAssetObjectState> => {
  return getR2().inspectSharedAsset(key);
};

export const deleteSharedAsset = async (key: string): Promise<void> => {
  return getR2().deleteSharedAsset(key);
};

export const downloadFile = async (
  keyOrMetadata: string | FileMetadata
): Promise<ReadableStream | null> => {
  return getR2().downloadFile(keyOrMetadata);
};

export const getFileInfo = async (
  key: string
): Promise<{ size?: number; contentType?: string } | null> => {
  return getR2().getFileInfo(key);
};

export const getFile = async (
  key: string
): Promise<{ body: ReadableStream; contentType: string } | null> => {
  return getR2().getFile(key);
};

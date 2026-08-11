/**
 * Supported storage provider names
 */
export type StorageProviderName = 'r2';

/**
 * Cloudflare R2 bucket interface used by the storage provider
 */
export interface R2BucketInterface {
  put(
    key: string,
    value: Blob | ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      onlyIf?: Headers;
    }
  ): Promise<unknown | null>;
  get(key: string): Promise<{
    body: ReadableStream | null;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<{
    size?: number;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    objects: { key: string; size: number; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

/**
 * File metadata
 */
export interface FileMetadata {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  r2Key: string;
  /** Sidecar receipt version for product-asset registration/deletion claims. */
  storageRevision?: string;
  uploadedAt: Date;
}

/** Recoverable two-key state for a shared object and its immutable receipt. */
export interface SharedAssetObjectState {
  objectExists: boolean;
  objectVerified?: boolean;
  receipt?: import('@meiye/contracts').SharedAssetStorageReceipt;
}

/**
 * Validation result type for file validation
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export const R2_ERROR_CODES = {
  FILE_TOO_LARGE: 'File is too large. Please choose a smaller file',
  INVALID_FILE_TYPE: 'File type not supported. Please choose a different file',
  NO_FILE_PROVIDED: 'Please select a file to upload',
  UPLOAD_FAILED: 'Upload failed. Please check your connection and try again',
  R2_STORAGE_NOT_CONFIGURED:
    'File storage is temporarily unavailable. Please try again later',
  LIST_FILES_FAILED: 'Unable to load your files. Please refresh the page',
} as const;

/**
 * Storage provider error types
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class ConfigurationError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class UploadError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/** Upload created a shared object, but its durable receipt could not be registered. */
export class UploadRegistrationError extends UploadError {
  constructor(
    readonly key: string,
    readonly metadata: FileMetadata,
    options: { cause: unknown }
  ) {
    super('Uploaded object could not be registered');
    this.cause = options.cause;
  }
}

/**
 * Params for upload operation
 */
export interface UploadFileParams {
  /** Verified content hash for deterministic shared Product asset keys. */
  contentHash?: string;
  file: Buffer | Blob | File;
  filename: string;
  contentType: string;
  purpose: import('./upload-policy').UploadPurpose;
  /** Server-resolved folder. Never accept this value from client input. */
  folder?: string;
  /** Every uploaded object is owner-scoped, including public avatars. */
  userId: string;
  workspaceId: string;
  /** Used to build same-origin proxy URL for the returned file. */
  requestOrigin?: string;
}

export interface UploadFileResult {
  url: string;
  key: string;
  metadata: FileMetadata;
}

/**
 * Storage provider interface
 */
export interface StorageProvider {
  /** Get the provider's name */
  getProviderName(): string;

  /** Upload a file */
  uploadFile(params: UploadFileParams): Promise<UploadFileResult>;

  /** Delete a file */
  deleteFile(key: string): Promise<void>;

  /** Inspect a shared object and receipt together before generation-fenced deletion. */
  inspectSharedAsset(key: string): Promise<SharedAssetObjectState>;

  /** Delete both halves of a shared object; retries may complete a partial delete. */
  deleteSharedAsset(key: string): Promise<void>;

  /** Download by R2 key or by FileMetadata. Returns stream or null */
  downloadFile(
    keyOrMetadata: string | FileMetadata
  ): Promise<ReadableStream | null>;

  /** Get object head (size, contentType, etc.) by key. */
  getFileInfo(
    key: string
  ): Promise<{ size?: number; contentType?: string } | null>;

  /** Get file stream and content-type by key (for same-origin proxy serving). */
  getFile(
    key: string
  ): Promise<{ body: ReadableStream; contentType: string } | null>;

}

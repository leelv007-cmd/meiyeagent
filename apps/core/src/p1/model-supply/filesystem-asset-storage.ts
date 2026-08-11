import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isSharedWorkspaceAssetObjectKey } from '@meiye/contracts';
import type {
  CustodyOwnedAssetContentType,
  ModelAssetStoragePort,
  OwnedAsset,
} from './index.js';
import { resolveFfprobePath } from './media-tool-paths.js';
import { validateGeneratedAudio } from './audio-asset-pipeline.js';
import {
  assertAssetOwnedBy,
  MAX_CANVAS_ASSET_UPLOAD_BYTES,
} from './asset-http-policy.js';

const execFileAsync = promisify(execFile);
const corePackageDirectory = fileURLToPath(
  new URL('../../../', import.meta.url)
);
const defaultAssetStorageDirectory = fileURLToPath(
  new URL('../../../.data/p1-assets', import.meta.url)
);

export interface VideoProbeResult {
  playable: true;
  codec: 'h264';
  durationSeconds: number;
  width?: number;
  height?: number;
}

export interface FileSystemAssetStorageOptions {
  ffprobeTimeoutMs?: number;
  rootDirectory: string;
  publicBaseUrl?: string;
  ffprobePath?: string;
  videoProbe?: (path: string) => Promise<VideoProbeResult>;
}

export function fileSystemAssetStorageFromEnv(env: NodeJS.ProcessEnv) {
  assertLocalAssetStorageEnvironment(env);
  const configuredRoot = env.P1_ASSET_STORAGE_DIR;
  return new FileSystemAssetStorage({
    rootDirectory: configuredRoot
      ? isAbsolute(configuredRoot)
        ? configuredRoot
        : resolve(corePackageDirectory, configuredRoot)
      : defaultAssetStorageDirectory,
    publicBaseUrl:
      env.P1_ASSET_PUBLIC_BASE_URL ??
      `${env.APP_BASE_URL ?? 'http://localhost:3000'}/api/core/p1/assets?objectKey=`,
    ...(env.FFPROBE_PATH ? { ffprobePath: resolveFfprobePath(env) } : {}),
  });
}

function assertLocalAssetStorageEnvironment(env: NodeJS.ProcessEnv) {
  const appEnv = env.APP_ENV ?? '';
  if (
    appEnv === 'production' ||
    appEnv === 'staging' ||
    (!appEnv && env.NODE_ENV === 'production')
  ) {
    throw new Error(
      'Shared object storage is required in production; filesystem asset storage is restricted to development, test, and e2e environments.',
    );
  }
}

/** Local durable object store used by recorded and development runtimes. */
export class FileSystemAssetStorage implements ModelAssetStoragePort {
  readonly maxUploadBytes = MAX_CANVAS_ASSET_UPLOAD_BYTES;
  private readonly rootDirectory: string;
  private readonly publicBaseUrl?: string;
  private readonly videoProbe: (path: string) => Promise<VideoProbeResult>;

  constructor(options: FileSystemAssetStorageOptions) {
    if (!options.rootDirectory.trim()) {
      throw new Error('Asset storage rootDirectory is required.');
    }
    this.rootDirectory = resolve(options.rootDirectory);
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/$/, '');
    this.videoProbe =
      options.videoProbe ??
      ((path) =>
        probeVideo(
          path,
          options.ffprobePath ?? resolveFfprobePath(),
          options.ffprobeTimeoutMs ?? 15_000,
        ));
  }

  assertOwnedBy(input: Parameters<typeof assertAssetOwnedBy>[0]) {
    assertAssetOwnedBy(input);
  }

  async persistGeneratedAsset(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: OwnedAsset['contentType'];
    sourceTaskRef?: string;
    sourceExpiresAt?: string;
  }) {
    return this.persistBytes({
      ...input,
      namespace: 'generated',
      idPrefix: 'asset',
    });
  }

  async persistOwnedAsset(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: CustodyOwnedAssetContentType;
  }) {
    return this.persistBytes({
      ...input,
      namespace: 'owned',
      idPrefix: 'owned',
    });
  }

  async inspectOwnedAsset(input: {
    workspaceId: string;
    objectKey: string;
    sha256: string;
    sizeBytes?: number;
    contentType: CustodyOwnedAssetContentType;
  }) {
    if (!input.objectKey.startsWith(`${input.workspaceId}/owned/`))
      return false;
    try {
      const stored = await this.read(input.objectKey);
      return (
        stored.contentType === input.contentType &&
        digest(stored.bytes) === input.sha256 &&
        (input.sizeBytes === undefined ||
          stored.bytes.byteLength === input.sizeBytes)
      );
    } catch {
      return false;
    }
  }

  async materialize(input: { workspaceId: string; asset: OwnedAsset }) {
    if (!input.asset.objectKey.startsWith(`${input.workspaceId}/`)) {
      throw new Error('Asset belongs to another workspace.');
    }
    const path = this.pathFor(input.asset.objectKey);
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== input.asset.sizeBytes ||
      digest(bytes) !== input.asset.sha256
    ) {
      throw new Error('Stored asset no longer matches its durable receipt.');
    }
    return { path };
  }

  async persistComposedVideo(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    path: string;
    sourceAssetIds: string[];
    compositionEvidence: NonNullable<OwnedAsset['compositionEvidence']>;
  }) {
    const bytes = await readFile(input.path);
    const asset = await this.persistBytes({
      workspaceId: input.workspaceId,
      bytes,
      contentType: 'video/mp4',
      namespace: 'composed',
      idPrefix: `composition-${safeSegment(input.compositionKey).slice(0, 24)}`,
    });
    if (
      input.compositionEvidence.outputSha256 !== asset.sha256 ||
      input.compositionEvidence.outputSizeBytes !== asset.sizeBytes
    ) {
      throw new Error(
        'Composition evidence does not match the persisted video bytes.'
      );
    }
    const lineagePath = `${this.pathFor(asset.objectKey)}.json`;
    await writeFile(
      lineagePath,
      JSON.stringify({
        compositionKey: input.compositionKey,
        compositionEvidence: structuredClone(input.compositionEvidence),
        sourceAssetIds: [...input.sourceAssetIds],
        workflowId: input.workflowId,
      }),
      { flag: 'w' }
    );
    return {
      ...asset,
      compositionEvidence: structuredClone(input.compositionEvidence),
    };
  }

  async persistRecordedComposedVideo(input: {
    bytes: Uint8Array;
    compositionEvidence: NonNullable<OwnedAsset['compositionEvidence']>;
    compositionKey: string;
    technicalValidation: NonNullable<OwnedAsset['technicalValidation']>;
    workflowId: string;
    workspaceId: string;
  }) {
    const asset = await this.persistBytes({
      workspaceId: input.workspaceId,
      bytes: input.bytes,
      contentType: 'video/mp4',
      namespace: 'composed',
      idPrefix: `composition-${safeSegment(input.compositionKey).slice(0, 24)}`,
      sourceTaskRef: `recorded-composition:${input.workflowId}:${input.compositionKey}`,
      technicalValidation: input.technicalValidation,
    });
    if (
      input.compositionEvidence.outputSha256 !== asset.sha256 ||
      input.compositionEvidence.outputSizeBytes !== asset.sizeBytes
    ) {
      throw new Error(
        'Recorded composition evidence does not match the persisted video bytes.'
      );
    }
    const lineagePath = `${this.pathFor(asset.objectKey)}.json`;
    const lineage = JSON.stringify({
      compositionKey: input.compositionKey,
      compositionEvidence: structuredClone(input.compositionEvidence),
      workflowId: input.workflowId,
    });
    try {
      await writeFile(lineagePath, lineage, { flag: 'wx' });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if ((await readFile(lineagePath, 'utf8')) !== lineage) {
        throw new Error(
          'Recorded composition lineage conflicts with the immutable receipt.',
        );
      }
    }
    return {
      ...asset,
      compositionEvidence: structuredClone(input.compositionEvidence),
    };
  }

  async releaseMaterialized(_paths: string[]) {
    // Local objects are already materialized and remain durable by design.
  }

  async read(objectKey: string) {
    assertPublicObjectKey(objectKey);
    const bytes = await readFile(this.pathFor(objectKey));
    const extension = extname(objectKey).toLowerCase();
    const contentType = contentTypeForExtension(extension);
    return { bytes, contentType } as const;
  }

  async head(objectKey: string) {
    assertPublicObjectKey(objectKey);
    const metadata = await stat(this.pathFor(objectKey));
    if (!metadata.isFile()) throw new Error('Asset object is not a file.');
    return {
      contentType: contentTypeForExtension(extname(objectKey).toLowerCase()),
      sizeBytes: metadata.size,
    };
  }

  async putCanvasAsset(input: {
    bytes: Uint8Array;
    objectKey: string;
    workspaceId: string;
  }) {
    assertCanvasObjectKey(input.workspaceId, input.objectKey);
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > this.maxUploadBytes
    ) {
      throw new Error('Canvas asset payload has an invalid size.');
    }
    const contentType = contentTypeForExtension(
      extname(input.objectKey).toLowerCase(),
    );
    if (contentType === 'application/zip') {
      throw new Error('Canvas asset payload has an unsupported media type.');
    }
    assertMediaBytes(contentType, input.bytes);
    const path = this.pathFor(input.objectKey);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, input.bytes, { flag: 'wx' });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const stored = await readFile(path);
    if (
      stored.byteLength !== input.bytes.byteLength ||
      digest(stored) !== digest(input.bytes)
    ) {
      throw new Error('Canvas asset key already contains different bytes.');
    }
    await this.writeCanvasAssetReceipt({
      contentType,
      objectKey: input.objectKey,
      sha256: digest(stored),
      sizeBytes: stored.byteLength,
    });
  }

  /**
   * Verifies the local immutable-receipt sidecar without opening the media
   * object, so Canvas export can reject a changed receipt before payload I/O.
   */
  async verifyCanvasAssetReceipt(input: {
    contentType: CustodyOwnedAssetContentType;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
    workspaceId: string;
  }) {
    try {
      assertCanvasObjectKey(input.workspaceId, input.objectKey);
      const receipt = await this.readCanvasAssetReceipt(input.objectKey);
      return (
        receipt.contentType === input.contentType &&
        receipt.objectKey === input.objectKey &&
        receipt.sha256 === input.sha256 &&
        receipt.sizeBytes === input.sizeBytes
      );
    } catch {
      return false;
    }
  }

  async deleteCanvasAsset(input: {
    objectKey: string;
    workspaceId: string;
  }) {
    assertCanvasObjectKey(input.workspaceId, input.objectKey);
    for (const path of [
      this.pathFor(input.objectKey),
      this.canvasAssetReceiptPath(input.objectKey),
    ]) {
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  async deleteCachedAsset(objectKey: string) {
    const path = this.pathFor(objectKey);
    for (const target of [path, `${path}.json`]) {
      try {
        await unlink(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  publicUrl(objectKey: string) {
    assertPublicObjectKey(objectKey);
    if (!this.publicBaseUrl) {
      throw new Error('Asset publicBaseUrl is not configured.');
    }
    if (this.publicBaseUrl.endsWith('objectKey=')) {
      return `${this.publicBaseUrl}${encodeURIComponent(objectKey)}`;
    }
    const encoded = objectKey.split('/').map(encodeURIComponent).join('/');
    return `${this.publicBaseUrl}/${encoded}`;
  }

  private async persistBytes<T extends CustodyOwnedAssetContentType>(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: T;
    namespace: 'generated' | 'composed' | 'owned';
    idPrefix: string;
    sourceTaskRef?: string;
    sourceExpiresAt?: string;
    technicalValidation?: OwnedAsset['technicalValidation'];
  }): Promise<Omit<OwnedAsset, 'contentType'> & { contentType: T }> {
    const workspaceId = safeSegment(input.workspaceId);
    if (input.bytes.byteLength === 0) {
      throw new Error('Cannot persist an empty media asset.');
    }
    assertMediaBytes(input.contentType, input.bytes);
    if (
      input.contentType === 'audio/mpeg' ||
      input.contentType === 'audio/wav'
    ) {
      await validateGeneratedAudio({
        bytes: input.bytes,
        contentType: input.contentType,
      });
    }
    const sha256 = digest(input.bytes);
    const receiptDigest = generatedReceiptDigest(sha256, input.sourceTaskRef);
    const extension = assetExtension(input.contentType);
    const objectKey = `${workspaceId}/${input.namespace}/${receiptDigest}.${extension}`;
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, input.bytes, { flag: 'wx' });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const stored = await readFile(path);
    const metadata = await stat(path);
    if (digest(stored) !== sha256 || metadata.size !== input.bytes.byteLength) {
      throw new Error('Persisted asset failed hash or size verification.');
    }
    const technicalValidation =
      input.contentType === 'video/mp4'
        ? {
            ...(input.technicalValidation ?? (await this.videoProbe(path))),
            hashVerified: true,
            evidenceKind:
              input.technicalValidation?.evidenceKind ??
              ('measured' as const),
          }
        : undefined;
    return {
      id: `${input.idPrefix}-${receiptDigest.slice(0, 32)}`,
      objectKey,
      sha256,
      sizeBytes: metadata.size,
      contentType: input.contentType,
      ...(input.sourceTaskRef ? { sourceTaskRef: input.sourceTaskRef } : {}),
      ...(input.sourceTaskRef && input.sourceExpiresAt
        ? {
            sourceTtlEvidence: {
              providerTaskRef: input.sourceTaskRef,
              expiresAt: input.sourceExpiresAt,
              recordedAt: new Date().toISOString(),
            },
          }
        : {}),
      ...(technicalValidation ? { technicalValidation } : {}),
    };
  }

  private pathFor(objectKey: string) {
    const segments = objectKey.split('/');
    if (
      segments.length < 3 ||
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('\\')
      )
    ) {
      throw new Error('Invalid object key.');
    }
    const path = resolve(this.rootDirectory, ...segments);
    if (!path.startsWith(`${this.rootDirectory}${sep}`)) {
      throw new Error('Object key escapes the storage root.');
    }
    return path;
  }

  private canvasAssetReceiptPath(objectKey: string) {
    return resolve(
      this.rootDirectory,
      '.canvas-asset-receipts',
      `${digest(Buffer.from(objectKey))}.json`,
    );
  }

  private async readCanvasAssetReceipt(objectKey: string) {
    const raw = await readFile(this.canvasAssetReceiptPath(objectKey));
    let value: unknown;
    try {
      value = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new Error('Canvas asset receipt is not valid JSON.');
    }
    if (!validCanvasAssetReceipt(value)) {
      throw new Error('Canvas asset receipt is invalid.');
    }
    return value;
  }

  private async writeCanvasAssetReceipt(input: {
    contentType: CustodyOwnedAssetContentType;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  }) {
    const path = this.canvasAssetReceiptPath(input.objectKey);
    const expected: CanvasAssetStorageReceipt = {
      ...input,
      createdAt: new Date().toISOString(),
      storageRevision: randomUUID(),
    };
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, JSON.stringify(expected), { flag: 'wx' });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const existing = await this.readCanvasAssetReceipt(input.objectKey);
    if (
      existing.contentType !== input.contentType ||
      existing.objectKey !== input.objectKey ||
      existing.sha256 !== input.sha256 ||
      existing.sizeBytes !== input.sizeBytes
    ) {
      throw new Error('Canvas asset receipt does not match the immutable object.');
    }
  }
}

interface CanvasAssetStorageReceipt {
  contentType: CustodyOwnedAssetContentType;
  createdAt: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  storageRevision: string;
}

async function probeVideo(
  path: string,
  ffprobePath: string,
  timeoutMs: number,
): Promise<VideoProbeResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('ffprobe timeout must be a positive integer.');
  }
  const abortSignal = AbortSignal.timeout(timeoutMs);
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height:format=duration',
      '-of',
      'json',
      path,
    ],
    {
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      signal: abortSignal,
      timeout: timeoutMs,
    },
  );
  const value = JSON.parse(stdout) as {
    streams?: Array<{
      codec_name?: unknown;
      width?: unknown;
      height?: unknown;
    }>;
    format?: { duration?: unknown };
  };
  const stream = value.streams?.[0];
  const durationSeconds = Number(value.format?.duration);
  if (
    stream?.codec_name !== 'h264' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new Error('Persisted MP4 is not a playable H.264 video.');
  }
  return {
    playable: true,
    codec: 'h264',
    durationSeconds,
    ...(typeof stream.width === 'number' ? { width: stream.width } : {}),
    ...(typeof stream.height === 'number' ? { height: stream.height } : {}),
  };
}

function assertMediaBytes(
  contentType: CustodyOwnedAssetContentType,
  bytes: Uint8Array
) {
  if (contentType === 'image/png') return assertPng(bytes);
  if (
    contentType === 'audio/mpeg' &&
    !(
      String.fromCharCode(...bytes.slice(0, 3)) === 'ID3' ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
    )
  ) {
    throw new Error('Persisted audio payload is not an MP3 container.');
  }
  if (
    contentType === 'audio/wav' &&
    (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE')
  ) {
    throw new Error('Persisted audio payload is not a WAV container.');
  }
  if (
    contentType === 'image/jpeg' &&
    (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
  ) {
    throw new Error('Persisted image is not a JPEG payload.');
  }
  if (
    contentType === 'image/webp' &&
    (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP')
  ) {
    throw new Error('Persisted image is not a WebP payload.');
  }
}

function assertPng(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Persisted image is not a PNG payload.');
  }
}

function safeSegment(value: string) {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error('Workspace or storage key segment is invalid.');
  }
  return trimmed;
}

function assertPublicObjectKey(objectKey: string) {
  if (!isSharedWorkspaceAssetObjectKey(objectKey)) {
    throw new Error('Object key is not a public media asset.');
  }
}

function assertCanvasObjectKey(workspaceId: string, objectKey: string) {
  const workspace = safeSegment(workspaceId);
  if (
    !new RegExp(
      `^${workspace.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\/canvas\/assets\/[A-Za-z0-9._-]+\\.(?:jpg|png|webp|mp4|mp3|wav)$`,
      'u',
    ).test(objectKey)
  ) {
    throw new Error('Canvas asset key is outside the active workspace.');
  }
}

function digest(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function assetExtension(contentType: CustodyOwnedAssetContentType) {
  switch (contentType) {
    case 'application/zip':
      return 'zip';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
      return 'wav';
  }
}

function contentTypeForExtension(
  extension: string
): CustodyOwnedAssetContentType {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.m4a':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    case '.zip':
      return 'application/zip';
    default:
      throw new Error('Object key has an unsupported media extension.');
  }
}

function generatedReceiptDigest(
  contentDigest: string,
  sourceTaskRef: string | undefined
) {
  return sourceTaskRef
    ? createHash('sha256')
        .update(`provider-task\0${sourceTaskRef}\0${contentDigest}`)
        .digest('hex')
    : contentDigest;
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
  );
}

function validCanvasAssetReceipt(
  value: unknown,
): value is CanvasAssetStorageReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<CanvasAssetStorageReceipt>;
  return (
    typeof receipt.contentType === 'string' &&
    typeof receipt.createdAt === 'string' &&
    Number.isFinite(Date.parse(receipt.createdAt)) &&
    typeof receipt.objectKey === 'string' &&
    typeof receipt.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(receipt.sha256) &&
    typeof receipt.sizeBytes === 'number' &&
    Number.isSafeInteger(receipt.sizeBytes) &&
    receipt.sizeBytes >= 0 &&
    typeof receipt.storageRevision === 'string' &&
    receipt.storageRevision.length > 0
  );
}

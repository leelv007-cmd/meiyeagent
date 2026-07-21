import { createHash } from 'node:crypto';
import type {
  AdvancedCanvasContext,
  CanvasGraph,
  JsonValue,
} from './advanced-canvas-project.js';
import type { ProStudioAccessAuditPort } from './security-access-audit.js';

export type CanvasAssetContentType =
  | 'audio/mpeg'
  | 'audio/wav'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'video/mp4';

export type CanvasLocalDerivation =
  | 'crop'
  | 'mask'
  | 'retouch'
  | 'split'
  | 'upscale';

export interface CanvasAudioValidation {
  bitRate: number;
  codec: 'mp3' | 'pcm_s16le';
  container: 'mp3' | 'wav';
  displayMetadata: Array<{ name: string; value: string }>;
  durationSeconds: number;
  metadataBytes: number;
  sampleRate: number;
}

export type CanvasAssetSource =
  | { kind: 'local_import' }
  | {
      derivation: CanvasLocalDerivation;
      kind: 'local_canvas_derivative';
      parentAssetId: string;
    }
  | { kind: 'product_asset'; sourceAssetId: string }
  | {
      audioValidation?: CanvasAudioValidation;
      jobId: string;
      kind: 'generation_job';
    };

export interface CanvasOwnedAsset {
  contentType: CanvasAssetContentType;
  createdAt: string;
  fileName: string;
  id: string;
  legacyStorageKey?: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  source: CanvasAssetSource;
  workspaceId: string;
}

export interface CanvasAssetDeletionOutboxRecord {
  assetId: string;
  claimToken?: string;
  createdAt: string;
  id: string;
  leaseExpiresAt?: string;
  objectKey: string;
  reason: 'asset_delete' | 'orphan_compensation';
  status: 'pending' | 'claimed' | 'completed';
  workspaceId: string;
}

export interface CanvasAssetRepository {
  claimDeletion(input: {
    claimToken: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<CanvasAssetDeletionOutboxRecord | null>;
  completeDeletion(input: { claimToken: string; id: string }): Promise<boolean>;
  enqueueOrphanDeletion(input: {
    assetId: string;
    createdAt: string;
    objectKey: string;
    workspaceId: string;
  }): Promise<CanvasAssetDeletionOutboxRecord>;
  findByLegacyStorageKey(
    workspaceId: string,
    storageKey: string
  ): Promise<CanvasOwnedAsset | null>;
  get(workspaceId: string, assetId: string): Promise<CanvasOwnedAsset | null>;
  insert(asset: CanvasOwnedAsset): Promise<void>;
  list(workspaceId: string): Promise<CanvasOwnedAsset[]>;
  releaseDeletion(input: { claimToken: string; id: string }): Promise<boolean>;
  tombstoneAndEnqueueDeletion(
    workspaceId: string,
    assetId: string,
    createdAt: string,
  ): Promise<CanvasAssetDeletionOutboxRecord | null>;
}

export interface CanvasObjectStorage {
  delete(objectKey: string): Promise<void>;
  put(objectKey: string, bytes: Uint8Array): Promise<void>;
  read(objectKey: string): Promise<Uint8Array | null>;
}

export type CanvasAssetErrorCode =
  | 'GENERATED_ASSET_REJECTED'
  | 'INVALID_INPUT'
  | 'INVALID_MEDIA'
  | 'NOT_FOUND'
  | 'RANGE_NOT_SATISFIABLE';

export class CanvasAssetError extends Error {
  constructor(
    readonly code: CanvasAssetErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CanvasAssetError';
  }
}

export class CanvasAssetPersistenceError extends Error {
  constructor(
    readonly recoveryQueued: boolean,
    options: { cause: unknown },
  ) {
    super('Canvas asset metadata could not be persisted.', options);
    this.name = 'CanvasAssetPersistenceError';
  }
}

interface CanvasAssetFacadeOptions {
  accessAudit?: ProStudioAccessAuditPort;
  clock?: () => Date;
  maxUploadBytes?: number;
  nextId?: () => string;
  repository: CanvasAssetRepository;
  storage: CanvasObjectStorage;
}

export class CanvasAssetFacade {
  private readonly clock: () => Date;
  private readonly maxUploadBytes: number;
  private readonly nextId: () => string;

  constructor(private readonly options: CanvasAssetFacadeOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.maxUploadBytes = options.maxUploadBytes ?? 25 * 1024 * 1024;
    this.nextId = options.nextId ?? (() => `asset-${crypto.randomUUID()}`);
  }

  async listAssets(context: AdvancedCanvasContext) {
    requireContext(context);
    return this.options.repository.list(context.workspaceId);
  }

  async getAsset(context: AdvancedCanvasContext, assetId: string) {
    requireContext(context);
    requireId(assetId, 'assetId');
    const asset = await this.options.repository.get(
      context.workspaceId,
      assetId
    );
    if (!asset) {
      await this.denyAccess(context, assetId);
      throw new CanvasAssetError('NOT_FOUND', 'Canvas asset was not found.');
    }
    return asset;
  }

  async deleteAsset(context: AdvancedCanvasContext, assetId: string) {
    requireContext(context);
    requireId(assetId, 'assetId');
    const deletion = await this.options.repository.tombstoneAndEnqueueDeletion(
      context.workspaceId,
      assetId,
      this.clock().toISOString(),
    );
    if (!deletion) {
      await this.denyAccess(context, assetId);
      throw new CanvasAssetError('NOT_FOUND', 'Canvas asset was not found.');
    }
    return { assetId, status: 'pending' as const };
  }

  private async denyAccess(context: AdvancedCanvasContext, assetId: string) {
    await this.options.accessAudit?.recordAccessDenied({
      actorId: context.userId,
      createdAt: this.clock().toISOString(),
      objectId: assetId,
      objectKind: 'asset',
      workspaceId: context.workspaceId,
    });
  }

  async persistLocalCanvasArtifact(
    context: AdvancedCanvasContext,
    input: {
      bytes: Uint8Array;
      contentType: CanvasAssetContentType;
      derivation: CanvasLocalDerivation;
      fileName: string;
      legacyStorageKey?: string;
      parentAssetId?: string;
    }
  ) {
    requireContext(context);
    if (
      !['crop', 'mask', 'retouch', 'split', 'upscale'].includes(
        input.derivation
      )
    ) {
      throw new CanvasAssetError(
        'GENERATED_ASSET_REJECTED',
        'Generated output must be persisted by its authoritative Job.'
      );
    }
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > this.maxUploadBytes ||
      !matchesMagicBytes(input.contentType, input.bytes)
    ) {
      throw new CanvasAssetError(
        'INVALID_MEDIA',
        'Canvas artifact failed media validation.'
      );
    }
    const parentAsset = input.parentAssetId
      ? await this.options.repository.get(
          context.workspaceId,
          input.parentAssetId,
        )
      : null;
    if (input.parentAssetId && !parentAsset) {
      await this.denyAccess(context, input.parentAssetId);
      throw new CanvasAssetError(
        'NOT_FOUND',
        'Canvas parent asset was not found.',
      );
    }
    if (!input.parentAssetId && input.derivation !== 'retouch') {
      throw new CanvasAssetError(
        'INVALID_INPUT',
        'Canvas derivatives require an owned parent asset.',
      );
    }
    const id = this.nextId();
    const extension = extensionFor(input.contentType);
    const objectKey = `${context.workspaceId}/canvas/assets/${id}.${extension}`;
    const asset: CanvasOwnedAsset = {
      contentType: input.contentType,
      createdAt: this.clock().toISOString(),
      fileName: safeFileName(input.fileName, extension),
      id,
      ...(input.legacyStorageKey
        ? { legacyStorageKey: input.legacyStorageKey }
        : {}),
      objectKey,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      sizeBytes: input.bytes.byteLength,
      source: input.parentAssetId
        ? {
            derivation: input.derivation,
            kind: 'local_canvas_derivative',
            parentAssetId: input.parentAssetId,
          }
        : { kind: 'local_import' },
      workspaceId: context.workspaceId,
    };
    await this.options.storage.put(objectKey, Uint8Array.from(input.bytes));
    try {
      await this.options.repository.insert(asset);
    } catch (error) {
      try {
        await this.options.storage.delete(objectKey);
      } catch (compensationError) {
        try {
          await this.options.repository.enqueueOrphanDeletion({
            assetId: asset.id,
            createdAt: this.clock().toISOString(),
            objectKey,
            workspaceId: context.workspaceId,
          });
        } catch (recoveryError) {
          throw new AggregateError(
            [error, compensationError, recoveryError],
            'Canvas asset metadata, immediate cleanup, and durable recovery all failed.',
          );
        }
        throw new CanvasAssetPersistenceError(true, { cause: error });
      }
      throw error;
    }
    return structuredClone(asset);
  }

  async hydrateGraph(workspaceId: string, graph: CanvasGraph) {
    requireId(workspaceId, 'workspaceId');
    const hydrated = structuredClone(graph);
    for (const node of hydrated.nodes) {
      const storageKey = node.data.storageKey;
      if (typeof storageKey !== 'string') continue;
      const asset = await this.options.repository.findByLegacyStorageKey(
        workspaceId,
        storageKey
      );
      if (!asset) {
        throw new CanvasAssetError(
          'NOT_FOUND',
          'Canvas media could not be restored from server assets.'
        );
      }
      const nextData: Record<string, JsonValue> = { ...node.data };
      delete nextData.storageKey;
      nextData.assetId = asset.id;
      node.data = nextData;
    }
    return hydrated;
  }

  async getAssetDelivery(
    context: AdvancedCanvasContext,
    input: { assetId: string; download?: boolean; range?: string }
  ) {
    const asset = await this.getAsset(context, input.assetId);
    const bytes = await this.options.storage.read(asset.objectKey);
    if (!bytes) {
      throw new CanvasAssetError('NOT_FOUND', 'Canvas asset was not found.');
    }
    const range = input.range
      ? parseRange(input.range, bytes.byteLength)
      : null;
    const body = range
      ? bytes.slice(range.start, range.end + 1)
      : Uint8Array.from(bytes);
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'content-length': String(body.byteLength),
      'content-type': asset.contentType,
      'x-content-type-options': 'nosniff',
    };
    if (range) {
      headers['content-range'] =
        `bytes ${range.start}-${range.end}/${bytes.byteLength}`;
    }
    if (input.download) {
      headers['content-disposition'] =
        `attachment; filename="${asciiFileName(asset.fileName)}"`;
    }
    return { body, headers, status: range ? 206 : 200 } as const;
  }
}

export class MemoryCanvasAssetRepository implements CanvasAssetRepository {
  private readonly assets = new Map<string, CanvasOwnedAsset>();
  private readonly deletions = new Map<string, CanvasAssetDeletionOutboxRecord>();
  private readonly tombstones = new Set<string>();

  private key(workspaceId: string, assetId: string) {
    return `${workspaceId}\0${assetId}`;
  }

  async insert(asset: CanvasOwnedAsset) {
    this.assets.set(
      this.key(asset.workspaceId, asset.id),
      structuredClone(asset)
    );
  }

  async list(workspaceId: string) {
    return structuredClone(
      [...this.assets.values()]
        .filter(
          (asset) =>
            asset.workspaceId === workspaceId &&
            !this.tombstones.has(this.key(asset.workspaceId, asset.id)),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    );
  }

  async get(workspaceId: string, assetId: string) {
    if (this.tombstones.has(this.key(workspaceId, assetId))) return null;
    const asset = this.assets.get(this.key(workspaceId, assetId));
    return asset ? structuredClone(asset) : null;
  }

  async findByLegacyStorageKey(workspaceId: string, storageKey: string) {
    const asset = [...this.assets.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        !this.tombstones.has(this.key(candidate.workspaceId, candidate.id)) &&
        candidate.legacyStorageKey === storageKey
    );
    return asset ? structuredClone(asset) : null;
  }

  inspect() {
    return structuredClone([...this.assets.values()]);
  }

  async tombstoneAndEnqueueDeletion(
    workspaceId: string,
    assetId: string,
    createdAt: string,
  ) {
    const key = this.key(workspaceId, assetId);
    const asset = this.assets.get(key);
    if (!asset) return null;
    const id = `canvas-asset-delete:${workspaceId}:${assetId}`;
    const existing = this.deletions.get(id);
    if (existing) return structuredClone(existing);
    this.tombstones.add(key);
    const deletion: CanvasAssetDeletionOutboxRecord = {
      assetId,
      createdAt,
      id,
      objectKey: asset.objectKey,
      reason: 'asset_delete',
      status: 'pending',
      workspaceId,
    };
    this.deletions.set(id, deletion);
    return structuredClone(deletion);
  }

  async enqueueOrphanDeletion(input: {
    assetId: string;
    createdAt: string;
    objectKey: string;
    workspaceId: string;
  }) {
    const assetKey = this.key(input.workspaceId, input.assetId);
    const existingAsset = this.assets.get(assetKey);
    if (existingAsset?.objectKey === input.objectKey) {
      this.tombstones.add(assetKey);
    }
    const id = `canvas-asset-delete:${input.workspaceId}:${input.assetId}`;
    const existing = this.deletions.get(id);
    if (existing) return structuredClone(existing);
    const deletion: CanvasAssetDeletionOutboxRecord = {
      assetId: input.assetId,
      createdAt: input.createdAt,
      id,
      objectKey: input.objectKey,
      reason: 'orphan_compensation',
      status: 'pending',
      workspaceId: input.workspaceId,
    };
    this.deletions.set(id, deletion);
    return structuredClone(deletion);
  }

  async claimDeletion(input: {
    claimToken: string;
    leaseExpiresAt: string;
    now: string;
  }) {
    const item = [...this.deletions.values()]
      .filter(
        (candidate) =>
          candidate.status === 'pending' ||
          (candidate.status === 'claimed' &&
            Boolean(candidate.leaseExpiresAt) &&
            candidate.leaseExpiresAt! <= input.now),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!item) return null;
    item.status = 'claimed';
    item.claimToken = input.claimToken;
    item.leaseExpiresAt = input.leaseExpiresAt;
    return structuredClone(item);
  }

  async completeDeletion(input: { claimToken: string; id: string }) {
    const item = this.deletions.get(input.id);
    if (item?.status !== 'claimed' || item.claimToken !== input.claimToken) {
      return false;
    }
    item.status = 'completed';
    delete item.claimToken;
    delete item.leaseExpiresAt;
    this.assets.delete(this.key(item.workspaceId, item.assetId));
    return true;
  }

  async releaseDeletion(input: { claimToken: string; id: string }) {
    const item = this.deletions.get(input.id);
    if (item?.status !== 'claimed' || item.claimToken !== input.claimToken) {
      return false;
    }
    item.status = 'pending';
    delete item.claimToken;
    delete item.leaseExpiresAt;
    return true;
  }
}

export class MemoryCanvasObjectStorage implements CanvasObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();

  async put(objectKey: string, bytes: Uint8Array) {
    this.objects.set(objectKey, Uint8Array.from(bytes));
  }

  async delete(objectKey: string) {
    this.objects.delete(objectKey);
  }

  async read(objectKey: string) {
    const bytes = this.objects.get(objectKey);
    return bytes ? Uint8Array.from(bytes) : null;
  }
}

export class CanvasAssetDeletionWorker {
  private readonly claimToken: () => string;
  private readonly clock: () => Date;
  private readonly leaseMs: number;

  constructor(
    private readonly options: {
      claimToken?: () => string;
      clock?: () => Date;
      leaseMs?: number;
      repository: CanvasAssetRepository;
      storage: CanvasObjectStorage;
    },
  ) {
    this.claimToken = options.claimToken ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 60_000;
  }

  async runOnce() {
    const now = this.clock();
    const claimToken = this.claimToken();
    const item = await this.options.repository.claimDeletion({
      claimToken,
      leaseExpiresAt: new Date(now.getTime() + this.leaseMs).toISOString(),
      now: now.toISOString(),
    });
    if (!item) return { status: 'idle' as const };
    try {
      await this.options.storage.delete(item.objectKey);
      const completed = await this.options.repository.completeDeletion({
        claimToken,
        id: item.id,
      });
      if (!completed) throw new Error('Canvas asset deletion claim was lost.');
      return { assetId: item.assetId, status: 'completed' as const };
    } catch (error) {
      await this.options.repository.releaseDeletion({ claimToken, id: item.id });
      throw error;
    }
  }
}

function matchesMagicBytes(
  contentType: CanvasAssetContentType,
  bytes: Uint8Array
) {
  if (contentType === 'image/png') {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === 'image/jpeg') {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (contentType === 'image/webp') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
  }
  if (contentType === 'video/mp4') {
    return ascii(bytes, 4, 4) === 'ftyp';
  }
  if (contentType === 'audio/wav') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
  }
  return (
    ascii(bytes, 0, 3) === 'ID3' ||
    (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
  );
}

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (!match) {
    throw new CanvasAssetError(
      'RANGE_NOT_SATISFIABLE',
      'Only one bounded byte range is supported.'
    );
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  const end = Math.min(requestedEnd, size - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    throw new CanvasAssetError(
      'RANGE_NOT_SATISFIABLE',
      'Requested byte range is not satisfiable.'
    );
  }
  return { end, start };
}

function extensionFor(contentType: CanvasAssetContentType) {
  return {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
  }[contentType];
}

function safeFileName(value: string, extension: string) {
  const cleaned = value
    .trim()
    .replaceAll(/[\\/\0\r\n]/gu, '_')
    .slice(0, 180);
  return cleaned || `canvas-asset.${extension}`;
}

function asciiFileName(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9._-]/gu, '_');
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function requireContext(context: AdvancedCanvasContext) {
  requireId(context.userId, 'userId');
  requireId(context.workspaceId, 'workspaceId');
}

function requireId(value: string, field: string) {
  if (!value.trim()) {
    throw new CanvasAssetError('INVALID_INPUT', `${field} is required.`);
  }
}

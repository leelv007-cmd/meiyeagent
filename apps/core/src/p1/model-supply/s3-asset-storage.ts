import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  sharedAssetReceiptKey,
  type SharedAssetStorageReceipt,
} from '@meiye/contracts';
import {
  FileSystemAssetStorage,
  type FileSystemAssetStorageOptions,
} from './filesystem-asset-storage.js';
import type {
  CustodyOwnedAssetContentType,
  ModelAssetStoragePort,
  OwnedAsset,
} from './index.js';
import {
  type OwnedAssetRegistrationFailureStage,
} from './owned-asset-registration-lifecycle.js';
import {
  assertAssetOwnedBy,
  MAX_CANVAS_ASSET_UPLOAD_BYTES,
} from './asset-http-policy.js';

export interface SharedObjectClient {
  delete(key: string): Promise<void>;
  get(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  head(
    key: string,
  ): Promise<{ contentType: string; sizeBytes: number } | null>;
  list?(prefix: string): Promise<string[]>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  putIfAbsent?(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<boolean>;
}

export type AssetStorageReceipt = SharedAssetStorageReceipt;

class SharedObjectPostWriteVerificationError extends Error {
  constructor(cause: unknown) {
    super(
      'Shared asset write completed but post-write verification was unavailable.',
      { cause },
    );
    this.name = 'SharedObjectPostWriteVerificationError';
  }
}

export class SharedAssetReceiptMissingError extends Error {
  constructor() {
    super('Shared asset has no durable storage receipt.');
    this.name = 'SharedAssetReceiptMissingError';
  }
}

export interface OwnedAssetRegistrationFailureRecord {
  assetId: string;
  cleanupAction: 'verify_reference_then_delete';
  error: { message: string; name: string };
  failureStage: OwnedAssetRegistrationFailureStage;
  id: string;
  objectKey: string;
  recordedAt: string;
  retryable: true;
  /** Receipt generation that this replay is allowed to clean up. */
  storageRevision?: string;
  workspaceId: string;
}

export interface SharedAssetObjectState {
  objectExists: boolean;
  receipt?: AssetStorageReceipt;
}

interface S3CompatibleObjectClientOptions {
  accessKeyId: string;
  bucket: string;
  clock?: () => Date;
  endpoint: string;
  fetcher?: typeof fetch;
  region: string;
  secretAccessKey: string;
  timeoutMs?: number;
}

export class S3CompatibleObjectClient implements SharedObjectClient {
  private readonly clock: () => Date;
  private readonly endpoint: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: S3CompatibleObjectClientOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = new URL(options.endpoint);
    if (this.endpoint.protocol !== 'https:') {
      throw new Error('S3 endpoint must use HTTPS.');
    }
    if (this.endpoint.username || this.endpoint.password) {
      throw new Error('S3 endpoint must not contain a username or password.');
    }
    if (this.endpoint.search || this.endpoint.hash) {
      throw new Error('S3 endpoint must not contain a query or fragment.');
    }
    for (const [name, value] of Object.entries({
      accessKeyId: options.accessKeyId,
      bucket: options.bucket,
      region: options.region,
      secretAccessKey: options.secretAccessKey,
    })) {
      if (!value.trim()) throw new Error(`S3 ${name} is required.`);
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    const response = await this.request('PUT', key, { bytes, contentType });
    await requireSuccess(response, 'write');
  }

  /** Provisioning helper used by the isolated MinIO service-contract test. */
  async createBucket() {
    const response = await this.request('PUT', undefined);
    if (response.status === 409) {
      await discardResponse(response);
      return;
    }
    await requireSuccess(response, 'create bucket');
  }

  async putIfAbsent(key: string, bytes: Uint8Array, contentType: string) {
    const response = await this.request('PUT', key, {
      bytes,
      contentType,
      ifNoneMatch: '*',
    });
    if (response.status === 409 || response.status === 412) {
      await discardResponse(response);
      return false;
    }
    await requireSuccess(response, 'conditional write');
    return true;
  }

  async get(key: string) {
    const response = await this.request('GET', key);
    if (response.status === 404) {
      await discardResponse(response);
      return null;
    }
    await requireSuccess(response, 'read');
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async head(key: string) {
    const response = await this.request('HEAD', key);
    if (response.status === 404) {
      await discardResponse(response);
      return null;
    }
    await requireSuccess(response, 'head');
    const sizeBytes = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new Error('Shared asset head response has no valid content length.');
    }
    return {
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
      sizeBytes,
    };
  }

  async delete(key: string) {
    const response = await this.request('DELETE', key);
    if (response.status === 404) {
      await discardResponse(response);
      return;
    }
    await requireSuccess(response, 'delete');
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.request('GET', undefined, {
        query: {
          'continuation-token': continuationToken,
          'list-type': '2',
          prefix,
        },
      });
      await requireSuccess(response, 'list');
      const body = await response.text();
      keys.push(
        ...[...body.matchAll(/<Key>([\s\S]*?)<\/Key>/gu)].map((match) =>
          decodeXmlText(match[1]!),
        ),
      );
      const next = body.match(
        /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/u,
      );
      continuationToken = next ? decodeXmlText(next[1]!) : undefined;
    } while (continuationToken);
    return keys;
  }

  private async request(
    method: 'DELETE' | 'GET' | 'HEAD' | 'PUT',
    key: string | undefined,
    options: {
      bytes?: Uint8Array;
      contentType?: string;
      ifNoneMatch?: string;
      query?: Record<string, string | undefined>;
    } = {},
  ) {
    const bytes = options.bytes ?? new Uint8Array();
    const url = key === undefined
      ? this.bucketUrl(options.query)
      : this.objectUrl(key, options.query);
    const now = this.clock();
    const amzDate = awsTimestamp(now);
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(bytes);
    const signingHeaders = Object.entries({
      host: url.host,
      ...(options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    }).sort(([left], [right]) => left.localeCompare(right));
    const canonicalHeaders = signingHeaders
      .map(([name, value]) => `${name}:${value}\n`)
      .join('');
    const signedHeaders = signingHeaders.map(([name]) => name).join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      url.search.slice(1),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${date}/${this.options.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(Buffer.from(canonicalRequest)),
    ].join('\n');
    const signature = createHmac('sha256', signingKey(
      this.options.secretAccessKey,
      date,
      this.options.region,
    ))
      .update(stringToSign)
      .digest('hex');
    const headers: Record<string, string> = {
      authorization:
        `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(options.contentType ? { 'content-type': options.contentType } : {}),
      ...(options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}),
    };
    return this.fetcher(url, {
      ...(method === 'PUT' ? { body: Buffer.from(bytes) } : {}),
      headers,
      method,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
  }

  private objectUrl(
    key: string,
    query?: Record<string, string | undefined>,
  ) {
    const segments = keySegments(key);
    const basePath = this.endpoint.pathname.replace(/\/$/u, '');
    const encodedPath = [this.options.bucket, ...segments]
      .map(awsEncode)
      .join('/');
    const url = new URL(this.endpoint);
    url.pathname = `${basePath}/${encodedPath}`;
    url.search = canonicalQuery(query);
    return url;
  }

  private bucketUrl(query: Record<string, string | undefined> | undefined) {
    const basePath = this.endpoint.pathname.replace(/\/$/u, '');
    const url = new URL(this.endpoint);
    url.pathname = `${basePath}/${awsEncode(this.options.bucket)}`;
    url.search = canonicalQuery(query);
    return url;
  }
}

interface S3CompatibleAssetStorageOptions {
  cacheDirectory: string;
  client: SharedObjectClient;
  ffprobePath?: string;
  ffprobeTimeoutMs?: number;
  publicBaseUrl?: string;
  videoProbe?: FileSystemAssetStorageOptions['videoProbe'];
}

export class S3CompatibleAssetStorage implements ModelAssetStoragePort {
  readonly maxUploadBytes = MAX_CANVAS_ASSET_UPLOAD_BYTES;
  private readonly cache: FileSystemAssetStorage;
  private readonly cacheDirectory: string;
  private readonly publicBaseUrl?: string;

  constructor(private readonly options: S3CompatibleAssetStorageOptions) {
    if (!options.cacheDirectory.trim()) {
      throw new Error('Shared asset cacheDirectory is required.');
    }
    this.cacheDirectory = resolve(options.cacheDirectory);
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/$/u, '');
    this.cache = new FileSystemAssetStorage({
      rootDirectory: this.cacheDirectory,
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
      ...(options.ffprobeTimeoutMs
        ? { ffprobeTimeoutMs: options.ffprobeTimeoutMs }
        : {}),
      ...(options.videoProbe ? { videoProbe: options.videoProbe } : {}),
    });
  }

  assertOwnedBy(input: Parameters<typeof assertAssetOwnedBy>[0]) {
    assertAssetOwnedBy(input);
  }

  async persistGeneratedAsset(
    input: Parameters<FileSystemAssetStorage['persistGeneratedAsset']>[0],
  ) {
    return this.persistAndUpload(input.workspaceId, () =>
      this.cache.persistGeneratedAsset(input),
    );
  }

  async persistOwnedAsset(
    input: Parameters<FileSystemAssetStorage['persistOwnedAsset']>[0],
  ) {
    return this.persistAndUpload(input.workspaceId, () =>
      this.cache.persistOwnedAsset(input),
    );
  }

  async inspectOwnedAsset(input: {
    workspaceId: string;
    objectKey: string;
    sha256: string;
    sizeBytes?: number;
    contentType: CustodyOwnedAssetContentType;
  }) {
    if (!input.objectKey.startsWith(`${input.workspaceId}/owned/`)) return false;
    try {
      const receipt = await this.readReceipt(input.objectKey);
      return (
        receipt.contentType === input.contentType &&
        receipt.sha256 === input.sha256 &&
        (input.sizeBytes === undefined || receipt.sizeBytes === input.sizeBytes)
      );
    } catch {
      return false;
    }
  }

  async materialize(input: { workspaceId: string; asset: OwnedAsset }) {
    if (!input.asset.objectKey.startsWith(`${input.workspaceId}/`)) {
      throw new Error('Asset belongs to another workspace.');
    }
    const stored = await this.read(input.asset.objectKey);
    if (
      !stored ||
      stored.bytes.byteLength !== input.asset.sizeBytes ||
      sha256Hex(stored.bytes) !== input.asset.sha256 ||
      stored.contentType !== input.asset.contentType
    ) {
      throw new Error('Shared asset no longer matches its durable receipt.');
    }
    const directory = join(
      this.cacheDirectory,
      'materialized',
      randomUUID(),
    );
    await mkdir(directory, { recursive: true });
    const path = join(directory, basename(input.asset.objectKey));
    await writeFile(path, stored.bytes, { flag: 'wx' });
    return { path };
  }

  async persistComposedVideo(
    input: Parameters<FileSystemAssetStorage['persistComposedVideo']>[0],
  ) {
    return this.persistAndUpload(input.workspaceId, () =>
      this.cache.persistComposedVideo(input),
    );
  }

  async persistRecordedComposedVideo(
    input: Parameters<FileSystemAssetStorage['persistRecordedComposedVideo']>[0],
  ) {
    return this.persistAndUpload(input.workspaceId, () =>
      this.cache.persistRecordedComposedVideo(input),
    );
  }

  async releaseMaterialized(paths: string[]) {
    for (const path of paths) {
      const resolvedPath = resolve(path);
      if (!resolvedPath.startsWith(`${this.cacheDirectory}/materialized/`)) {
        throw new Error('Materialized asset path escaped the shared cache.');
      }
      await rm(dirname(resolvedPath), { force: true, recursive: true });
    }
  }

  async read(objectKey: string) {
    const receipt = await this.readReceipt(objectKey);
    const stored = await this.options.client.get(objectKey);
    if (!stored) throw notFound(objectKey);
    return {
      bytes: stored.bytes,
      contentType: receipt.contentType as CustodyOwnedAssetContentType,
    };
  }

  async head(objectKey: string) {
    const receipt = await this.readReceipt(objectKey);
    return {
      contentType: receipt.contentType as CustodyOwnedAssetContentType,
      sizeBytes: receipt.sizeBytes,
    };
  }

  async putCanvasAsset(input: {
    bytes: Uint8Array;
    objectKey: string;
    workspaceId: string;
  }) {
    await this.cache.putCanvasAsset(input);
    const stored = await this.cache.read(input.objectKey);
    const storageRevision = randomUUID();
    try {
      try {
        await this.putImmutable(
          input.objectKey,
          stored.bytes,
          stored.contentType,
        );
      } catch (error) {
        if (error instanceof SharedObjectPostWriteVerificationError) {
          await this.recordReceiptRegistrationFailure({
            assetId: `canvas:${sha256Hex(Buffer.from(input.objectKey))}`,
            error,
            objectKey: input.objectKey,
            storageRevision,
            workspaceId: input.workspaceId,
          });
        }
        throw error;
      }
      try {
        await this.writeVerifiedReceipt(
          input.objectKey,
          stored.bytes,
          stored.contentType,
          storageRevision,
        );
      } catch (error) {
        await this.recordReceiptRegistrationFailure({
          assetId: `canvas:${sha256Hex(Buffer.from(input.objectKey))}`,
          error,
          objectKey: input.objectKey,
          storageRevision,
          workspaceId: input.workspaceId,
        });
        throw error;
      }
    } finally {
      await this.cache.deleteCanvasAsset(input);
    }
  }

  async deleteCanvasAsset(input: {
    objectKey: string;
    workspaceId: string;
  }) {
    keySegments(input.objectKey);
    if (!input.objectKey.startsWith(`${input.workspaceId}/canvas/assets/`)) {
      throw new Error('Canvas asset object key belongs to another workspace.');
    }
    await this.options.client.delete(input.objectKey);
    await this.options.client.delete(receiptKey(input.objectKey));
    await this.cache.deleteCanvasAsset(input);
  }

  async readReceipt(objectKey: string): Promise<AssetStorageReceipt> {
    const receipt = await this.readStoredReceipt(objectKey);
    const stored = await this.options.client.get(objectKey);
    if (
      !stored ||
      stored.contentType !== receipt.contentType ||
      stored.bytes.byteLength !== receipt.sizeBytes ||
      sha256Hex(stored.bytes) !== receipt.sha256
    ) {
      throw new Error('Shared asset no longer matches its durable receipt.');
    }
    return receipt;
  }

  /** Reads only the immutable sidecar so cleanup can recover a sidecar-only state. */
  async readStoredReceipt(objectKey: string): Promise<AssetStorageReceipt> {
    keySegments(objectKey);
    const storedReceipt = await this.options.client.get(receiptKey(objectKey));
    if (!storedReceipt) throw new SharedAssetReceiptMissingError();
    if (storedReceipt.contentType !== 'application/json') {
      throw new Error('Shared asset has no durable storage receipt.');
    }
    const receipt = parseReceipt(storedReceipt.bytes);
    if (receipt.objectKey !== objectKey) {
      throw new Error('Shared asset receipt does not match its object key.');
    }
    return receipt;
  }

  /**
   * Cleanup treats the data object and receipt sidecar as one recoverable
   * state. A missing sidecar never authorizes deletion of a present object.
   */
  async inspectSharedObject(objectKey: string): Promise<SharedAssetObjectState> {
    keySegments(objectKey);
    const [object, receipt] = await Promise.all([
      this.options.client.head(objectKey),
      this.readStoredReceipt(objectKey).catch((error: unknown) => {
        if (error instanceof SharedAssetReceiptMissingError) return undefined;
        throw error;
      }),
    ]);
    return { objectExists: Boolean(object), ...(receipt ? { receipt } : {}) };
  }

  /**
   * Explicit migration-only receipt registration. Readers deliberately never
   * call this: an operator-supplied manifest must prove the stored bytes first.
   */
  async backfillVerifiedReceipt(
    receipt: AssetStorageReceipt,
    options: { dryRun?: boolean } = { dryRun: true },
  ): Promise<'already_present' | 'created' | 'would_create'> {
    keySegments(receipt.objectKey);
    const existing = await this.options.client.get(receiptKey(receipt.objectKey));
    if (existing) {
      const persisted = parseReceipt(existing.bytes);
      assertSameReceipt(persisted, receipt);
      assertSameBackfillReceipt(persisted, receipt);
      await this.readReceipt(receipt.objectKey);
      return 'already_present';
    }

    const stored = await this.options.client.get(receipt.objectKey);
    if (
      !stored ||
      stored.contentType !== receipt.contentType ||
      stored.bytes.byteLength !== receipt.sizeBytes ||
      sha256Hex(stored.bytes) !== receipt.sha256
    ) {
      throw new Error('Trusted receipt backfill does not match the stored object.');
    }
    if (options.dryRun !== false) return 'would_create';

    const persisted = await this.persistReceipt(receipt);
    await this.readReceipt(receipt.objectKey);
    return persisted.storageRevision === receipt.storageRevision
      ? 'created'
      : 'already_present';
  }

  async recordOwnedAssetRegistrationFailure(input: {
    asset: OwnedAsset;
    error: unknown;
    failureStage: OwnedAssetRegistrationFailureStage;
    workspaceId: string;
  }) {
    await this.recordRegistrationFailure({
      assetId: input.asset.id,
      error: input.error,
      failureStage: input.failureStage,
      objectKey: input.asset.objectKey,
      storageRevision: input.asset.storageRevision,
      workspaceId: input.workspaceId,
    });
  }

  private async recordRegistrationFailure(input: {
    assetId: string;
    error: unknown;
    failureStage: OwnedAssetRegistrationFailureStage;
    objectKey: string;
    storageRevision?: string;
    workspaceId: string;
  }) {
    if (
      !input.objectKey.startsWith(`${input.workspaceId}/`) ||
      !input.assetId
    ) {
      throw new Error('Shared asset registration failure is not workspace-owned.');
    }
    const record: OwnedAssetRegistrationFailureRecord = {
      assetId: input.assetId,
      cleanupAction: 'verify_reference_then_delete',
      error: failureSummary(input.error),
      failureStage: input.failureStage,
      id: randomUUID(),
      objectKey: input.objectKey,
      recordedAt: new Date().toISOString(),
      retryable: true,
      ...(input.storageRevision ? { storageRevision: input.storageRevision } : {}),
      workspaceId: input.workspaceId,
    };
    await this.putLifecycleJson(registrationFailureKey(record.id), record);
  }

  async listOwnedAssetRegistrationFailures() {
    const list = this.options.client.list;
    if (!list) {
      throw new Error('Shared asset storage does not support durable cleanup listing.');
    }
    const keys = await list.call(this.options.client, REGISTRATION_FAILURE_PREFIX);
    const records: OwnedAssetRegistrationFailureRecord[] = [];
    for (const key of keys.sort()) {
      if (!isRegistrationFailureKey(key)) continue;
      const value = await this.readLifecycleJson(key);
      if (!isRegistrationFailureRecord(value)) {
        throw new Error('Shared asset registration failure record is invalid.');
      }
      if (await this.options.client.get(registrationResolutionKey(value.id))) {
        continue;
      }
      records.push(value);
    }
    return records.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  }

  async deleteSharedObject(objectKey: string) {
    keySegments(objectKey);
    await this.options.client.delete(objectKey);
    await this.options.client.delete(receiptKey(objectKey));
  }

  async hasSharedObject(objectKey: string) {
    return (await this.inspectSharedObject(objectKey)).objectExists;
  }

  async resolveOwnedAssetRegistrationFailure(input: {
    failure: OwnedAssetRegistrationFailureRecord;
    outcome: 'deleted' | 'referenced';
    resolvedAt: string;
  }) {
    if (!isRegistrationFailureRecord(input.failure)) {
      throw new Error('Shared asset registration failure record is invalid.');
    }
    await this.putLifecycleJsonIfAbsent(registrationResolutionKey(input.failure.id), {
      objectKey: input.failure.objectKey,
      outcome: input.outcome,
      resolvedAt: input.resolvedAt,
      workspaceId: input.failure.workspaceId,
    });
  }

  publicUrl(objectKey: string) {
    keySegments(objectKey);
    if (!this.publicBaseUrl) {
      throw new Error('Asset publicBaseUrl is not configured.');
    }
    if (this.publicBaseUrl.endsWith('objectKey=')) {
      return `${this.publicBaseUrl}${encodeURIComponent(objectKey)}`;
    }
    return `${this.publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async persistAndUpload<
    T extends { contentType: string; id: string; objectKey: string },
  >(workspaceId: string, persist: () => Promise<T>) {
    const receipt = await persist();
    const stored = await this.cache.read(receipt.objectKey);
    const storageRevision = randomUUID();
    try {
      try {
        await this.putImmutable(
          receipt.objectKey,
          stored.bytes,
          stored.contentType,
        );
      } catch (error) {
        if (error instanceof SharedObjectPostWriteVerificationError) {
          await this.recordReceiptRegistrationFailure({
            assetId: receipt.id,
            error,
            objectKey: receipt.objectKey,
            storageRevision,
            workspaceId,
          });
        }
        throw error;
      }
      try {
        const verifiedReceipt = await this.writeVerifiedReceipt(
          receipt.objectKey,
          stored.bytes,
          stored.contentType,
          storageRevision,
        );
        return {
          ...receipt,
          storageRevision: verifiedReceipt.storageRevision,
        };
      } catch (error) {
        await this.recordReceiptRegistrationFailure({
          assetId: receipt.id,
          error,
          objectKey: receipt.objectKey,
          storageRevision,
          workspaceId,
        });
        throw error;
      }
    } finally {
      await this.cache.deleteCachedAsset(receipt.objectKey);
    }
  }

  private async recordReceiptRegistrationFailure(input: {
    assetId: string;
    error: unknown;
    objectKey: string;
    storageRevision: string;
    workspaceId: string;
  }) {
    try {
      await this.recordRegistrationFailure({
        ...input,
        failureStage: 'receipt_registration',
      });
    } catch (recordError) {
      try {
        await this.deleteSharedObject(input.objectKey);
      } catch (deleteError) {
        throw new AggregateError(
          [input.error, recordError, deleteError],
          'Shared asset receipt registration failed without durable cleanup.',
        );
      }
      throw new AggregateError(
        [input.error, recordError],
        'Shared asset receipt registration failed and the object was deleted.',
      );
    }
  }

  private async writeVerifiedReceipt(
    objectKey: string,
    bytes: Uint8Array,
    contentType: string,
    storageRevision = randomUUID(),
  ) {
    const receipt = await this.persistReceipt({
      contentType,
      createdAt: new Date().toISOString(),
      objectKey,
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.byteLength,
      storageRevision,
    });
    await this.readReceipt(objectKey);
    return receipt;
  }

  private async putImmutable(
    objectKey: string,
    bytes: Uint8Array,
    contentType: string,
  ) {
    const existing = await this.options.client.get(objectKey);
    if (existing) {
      if (
        existing.contentType !== contentType ||
        existing.bytes.byteLength !== bytes.byteLength ||
        sha256Hex(existing.bytes) !== sha256Hex(bytes)
      ) {
        throw new Error('Shared asset key already contains different bytes.');
      }
      return;
    }
    let created: boolean;
    try {
      created = this.options.client.putIfAbsent
        ? await this.options.client.putIfAbsent(objectKey, bytes, contentType)
        : (await this.options.client.put(objectKey, bytes, contentType), true);
    } catch (error) {
      throw new SharedObjectPostWriteVerificationError(error);
    }
    try {
      const stored = await this.options.client.get(objectKey);
      if (!created && !stored) {
        throw new Error('Shared asset conditional write did not expose an existing object.');
      }
      if (
        !stored ||
        stored.contentType !== contentType ||
        stored.bytes.byteLength !== bytes.byteLength ||
        sha256Hex(stored.bytes) !== sha256Hex(bytes)
      ) {
        throw new Error('Shared asset failed hash or size verification.');
      }
    } catch (error) {
      if (created) throw new SharedObjectPostWriteVerificationError(error);
      throw error;
    }
  }

  private async persistReceipt(receipt: AssetStorageReceipt) {
    const key = receiptKey(receipt.objectKey);
    const existing = await this.options.client.get(key);
    if (existing) {
      const persisted = parseReceipt(existing.bytes);
      assertSameReceipt(persisted, receipt);
      return persisted;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(receipt));
    if (this.options.client.putIfAbsent) {
      await this.options.client.putIfAbsent(key, bytes, 'application/json');
    } else {
      await this.options.client.put(key, bytes, 'application/json');
    }
    const persisted = await this.options.client.get(key);
    if (!persisted || persisted.contentType !== 'application/json') {
      throw new Error('Shared asset receipt could not be persisted.');
    }
    const parsed = parseReceipt(persisted.bytes);
    assertSameReceipt(parsed, receipt);
    return parsed;
  }

  private async putLifecycleJson(key: string, value: unknown) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    await this.options.client.put(key, bytes, 'application/json');
    const persisted = await this.options.client.get(key);
    if (!persisted || persisted.contentType !== 'application/json') {
      throw new Error('Shared asset lifecycle record could not be persisted.');
    }
  }

  private async putLifecycleJsonIfAbsent(key: string, value: unknown) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (this.options.client.putIfAbsent) {
      return this.options.client.putIfAbsent(key, bytes, 'application/json');
    }
    if (await this.options.client.get(key)) return false;
    await this.options.client.put(key, bytes, 'application/json');
    return true;
  }

  private async readLifecycleJson(key: string): Promise<unknown | null> {
    const stored = await this.options.client.get(key);
    if (!stored) return null;
    if (stored.contentType !== 'application/json') {
      throw new Error('Shared asset lifecycle record has an invalid content type.');
    }
    try {
      return JSON.parse(new TextDecoder().decode(stored.bytes));
    } catch {
      throw new Error('Shared asset lifecycle record is not valid JSON.');
    }
  }

}

const LIFECYCLE_PREFIX = '_meiye-asset-lifecycle/';
const REGISTRATION_FAILURE_PREFIX = `${LIFECYCLE_PREFIX}registration-failures/`;
const REGISTRATION_RESOLUTION_PREFIX = `${LIFECYCLE_PREFIX}registration-resolutions/`;

function canonicalQuery(query: Record<string, string | undefined> | undefined) {
  if (!query) return '';
  return Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue.localeCompare(rightValue)
        : leftName.localeCompare(rightName),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function decodeXmlText(value: string) {
  return value.replace(/&(amp|apos|gt|lt|quot|#x[0-9a-fA-F]+|#[0-9]+);/gu, (entity) => {
    if (entity === '&amp;') return '&';
    if (entity === '&apos;') return "'";
    if (entity === '&gt;') return '>';
    if (entity === '&lt;') return '<';
    if (entity === '&quot;') return '"';
    const codePoint = entity.startsWith('&#x')
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10);
    return String.fromCodePoint(codePoint);
  });
}

function registrationFailureKey(id: string) {
  return `${REGISTRATION_FAILURE_PREFIX}${id}.json`;
}

function registrationResolutionKey(id: string) {
  return `${REGISTRATION_RESOLUTION_PREFIX}${id}.json`;
}

function isRegistrationFailureKey(key: string) {
  return new RegExp(`^${REGISTRATION_FAILURE_PREFIX}[a-f0-9-]{36}\\.json$`, 'u').test(key);
}

function isRegistrationFailureRecord(
  value: unknown,
): value is OwnedAssetRegistrationFailureRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;
  if (
    record.cleanupAction !== 'verify_reference_then_delete' ||
    typeof error?.message !== 'string' ||
    typeof error?.name !== 'string' ||
    (record.failureStage !== 'content_package_persistence' &&
      record.failureStage !== 'ledger_settlement' &&
      record.failureStage !== 'receipt_registration' &&
      record.failureStage !== 'result_persistence') ||
    typeof record.assetId !== 'string' ||
    typeof record.id !== 'string' ||
    typeof record.objectKey !== 'string' ||
    typeof record.recordedAt !== 'string' ||
    record.retryable !== true ||
    (record.storageRevision !== undefined &&
      (typeof record.storageRevision !== 'string' || !record.storageRevision)) ||
    typeof record.workspaceId !== 'string' ||
    !Number.isFinite(Date.parse(record.recordedAt))
  ) {
    return false;
  }
  try {
    keySegments(record.objectKey);
  } catch {
    return false;
  }
  return record.objectKey.startsWith(`${record.workspaceId}/`);
}

function failureSummary(error: unknown) {
  return {
    message: (error instanceof Error ? error.message : 'Unknown storage registration error.').slice(0, 512),
    name: error instanceof Error ? error.name : 'UnknownError',
  };
}

function keySegments(key: string) {
  const segments = key.split('/');
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.includes('\\'),
    )
  ) {
    throw new Error('Invalid shared asset object key.');
  }
  return segments;
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function awsTimestamp(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid S3 signing time.');
  return value.toISOString().replace(/[:-]|\.\d{3}/gu, '');
}

function signingKey(secret: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function receiptKey(objectKey: string) {
  return sharedAssetReceiptKey(sha256Hex(Buffer.from(objectKey)));
}

function parseReceipt(bytes: Uint8Array): AssetStorageReceipt {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Shared asset receipt is not valid JSON.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    typeof Reflect.get(value, 'contentType') !== 'string' ||
    typeof Reflect.get(value, 'createdAt') !== 'string' ||
    typeof Reflect.get(value, 'objectKey') !== 'string' ||
    typeof Reflect.get(value, 'sha256') !== 'string' ||
    typeof Reflect.get(value, 'sizeBytes') !== 'number' ||
    typeof Reflect.get(value, 'storageRevision') !== 'string'
  ) {
    throw new Error('Shared asset receipt has an invalid shape.');
  }
  const receipt = value as AssetStorageReceipt;
  if (
    !Number.isSafeInteger(receipt.sizeBytes) ||
    receipt.sizeBytes < 0 ||
    !/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
    !Number.isFinite(Date.parse(receipt.createdAt))
  ) {
    throw new Error('Shared asset receipt has invalid values.');
  }
  return receipt;
}

function assertSameReceipt(
  persisted: AssetStorageReceipt,
  expected: AssetStorageReceipt,
) {
  if (
    persisted.objectKey !== expected.objectKey ||
    persisted.contentType !== expected.contentType ||
    persisted.sha256 !== expected.sha256 ||
    persisted.sizeBytes !== expected.sizeBytes
  ) {
    throw new Error('Shared asset receipt conflicts with immutable bytes.');
  }
}

/** A reviewed migration manifest is the complete identity, not just byte proof. */
function assertSameBackfillReceipt(
  persisted: AssetStorageReceipt,
  expected: AssetStorageReceipt,
) {
  if (
    persisted.createdAt !== expected.createdAt ||
    persisted.storageRevision !== expected.storageRevision
  ) {
    throw new Error('Shared asset receipt conflicts with trusted migration truth.');
  }
}

async function requireSuccess(response: Response, operation: string) {
  if (response.ok) return;
  const detail = (await response.text()).slice(0, 512);
  throw new Error(
    `Shared asset ${operation} failed with status ${response.status}${detail ? `: ${detail}` : '.'}`,
  );
}

async function discardResponse(response: Response) {
  await response.body?.cancel();
}

function notFound(objectKey: string) {
  const error = new Error(`Shared asset ${objectKey} was not found.`) as Error & {
    code?: string;
  };
  error.code = 'ENOENT';
  return error;
}

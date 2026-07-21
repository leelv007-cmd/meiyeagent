import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { CompositionAssetStoragePort } from './ffmpeg-composition-port.js';
import {
  FileSystemAssetStorage,
  type FileSystemAssetStorageOptions,
} from './filesystem-asset-storage.js';
import type {
  CustodyOwnedAssetContentType,
  ModelAssetStoragePort,
  OwnedAsset,
} from './index.js';

export interface SharedObjectClient {
  delete(key: string): Promise<void>;
  get(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  head(
    key: string,
  ): Promise<{ contentType: string; sizeBytes: number } | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
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
    const response = await this.request('PUT', key, bytes, contentType);
    await requireSuccess(response, 'write');
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

  private async request(
    method: 'DELETE' | 'GET' | 'HEAD' | 'PUT',
    key: string,
    bytes: Uint8Array = new Uint8Array(),
    contentType?: string,
  ) {
    const url = this.objectUrl(key);
    const now = this.clock();
    const amzDate = awsTimestamp(now);
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(bytes);
    const canonicalHeaders =
      `host:${url.host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      url.pathname,
      '',
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
      ...(contentType ? { 'content-type': contentType } : {}),
    };
    return this.fetcher(url, {
      ...(method === 'PUT' ? { body: Buffer.from(bytes) } : {}),
      headers,
      method,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
  }

  private objectUrl(key: string) {
    const segments = keySegments(key);
    const basePath = this.endpoint.pathname.replace(/\/$/u, '');
    const encodedPath = [this.options.bucket, ...segments]
      .map(awsEncode)
      .join('/');
    const url = new URL(this.endpoint);
    url.pathname = `${basePath}/${encodedPath}`;
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

export class S3CompatibleAssetStorage
  implements ModelAssetStoragePort, CompositionAssetStoragePort
{
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

  async persistGeneratedAsset(
    input: Parameters<FileSystemAssetStorage['persistGeneratedAsset']>[0],
  ) {
    return this.persistAndUpload(() => this.cache.persistGeneratedAsset(input));
  }

  async persistOwnedAsset(
    input: Parameters<FileSystemAssetStorage['persistOwnedAsset']>[0],
  ) {
    return this.persistAndUpload(() => this.cache.persistOwnedAsset(input));
  }

  async inspectOwnedAsset(input: {
    workspaceId: string;
    objectKey: string;
    sha256: string;
    sizeBytes?: number;
    contentType: CustodyOwnedAssetContentType;
  }) {
    if (!input.objectKey.startsWith(`${input.workspaceId}/owned/`)) return false;
    const stored = await this.options.client.get(input.objectKey);
    return Boolean(
      stored &&
        stored.contentType === input.contentType &&
        sha256Hex(stored.bytes) === input.sha256 &&
        (input.sizeBytes === undefined ||
          stored.bytes.byteLength === input.sizeBytes),
    );
  }

  async materialize(input: { workspaceId: string; asset: OwnedAsset }) {
    if (!input.asset.objectKey.startsWith(`${input.workspaceId}/`)) {
      throw new Error('Asset belongs to another workspace.');
    }
    const stored = await this.options.client.get(input.asset.objectKey);
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
    return this.persistAndUpload(() => this.cache.persistComposedVideo(input));
  }

  async persistRecordedComposedVideo(
    input: Parameters<FileSystemAssetStorage['persistRecordedComposedVideo']>[0],
  ) {
    return this.persistAndUpload(() =>
      this.cache.persistRecordedComposedVideo(input),
    );
  }

  async persistVideoCover(
    input: Parameters<FileSystemAssetStorage['persistVideoCover']>[0],
  ) {
    return this.persistAndUpload(() => this.cache.persistVideoCover(input));
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
    const stored = await this.options.client.get(objectKey);
    if (!stored) throw notFound(objectKey);
    return {
      bytes: stored.bytes,
      contentType: stored.contentType as CustodyOwnedAssetContentType,
    };
  }

  async head(objectKey: string) {
    const stored = await this.options.client.head(objectKey);
    if (!stored) throw notFound(objectKey);
    return {
      contentType: stored.contentType as CustodyOwnedAssetContentType,
      sizeBytes: stored.sizeBytes,
    };
  }

  async putCanvasAsset(input: {
    bytes: Uint8Array;
    objectKey: string;
    workspaceId: string;
  }) {
    await this.cache.putCanvasAsset(input);
    const stored = await this.cache.read(input.objectKey);
    await this.putImmutable(
      input.objectKey,
      stored.bytes,
      stored.contentType,
    );
    await this.cache.deleteCanvasAsset(input);
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
    await this.cache.deleteCanvasAsset(input);
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
    T extends { contentType: string; objectKey: string },
  >(persist: () => Promise<T>) {
    const receipt = await persist();
    const stored = await this.cache.read(receipt.objectKey);
    await this.putImmutable(
      receipt.objectKey,
      stored.bytes,
      stored.contentType,
    );
    await this.cache.deleteCachedAsset(receipt.objectKey);
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
    await this.options.client.put(objectKey, bytes, contentType);
  }
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

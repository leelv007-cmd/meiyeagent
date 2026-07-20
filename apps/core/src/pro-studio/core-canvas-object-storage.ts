import type { CanvasObjectStorage } from './canvas-asset-facade.js';

interface CoreCanvasObjectStorageOptions {
  coreServiceToken: string;
  coreServiceUrl: string;
  fetcher?: typeof fetch;
}

export class CoreCanvasObjectStorage implements CanvasObjectStorage {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: CoreCanvasObjectStorageOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async put(objectKey: string, bytes: Uint8Array) {
    const workspaceId = workspaceFromObjectKey(objectKey);
    const response = await this.fetcher(this.assetUrl(objectKey), {
      body: Buffer.from(bytes),
      cache: 'no-store',
      headers: {
        'content-type': contentTypeFromObjectKey(objectKey),
        'x-service-token': this.options.coreServiceToken,
        'x-workspace-id': workspaceId,
      },
      method: 'PUT',
    });
    if (!response.ok) {
      throw new Error(`Core asset write failed with status ${response.status}.`);
    }
  }

  async read(objectKey: string) {
    const workspaceId = workspaceFromObjectKey(objectKey);
    const response = await this.fetcher(this.assetUrl(objectKey), {
      cache: 'no-store',
      headers: {
        'x-service-token': this.options.coreServiceToken,
        'x-workspace-id': workspaceId,
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Core asset read failed with status ${response.status}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private assetUrl(objectKey: string) {
    return new URL(
      `/v1/assets/${encodeURIComponent(objectKey)}`,
      this.options.coreServiceUrl,
    );
  }
}

export class CompositeCanvasObjectStorage implements CanvasObjectStorage {
  constructor(
    private readonly writable: CanvasObjectStorage,
    private readonly fallback: CanvasObjectStorage
  ) {}

  async put(objectKey: string, bytes: Uint8Array) {
    await this.writable.put(objectKey, bytes);
  }

  async read(objectKey: string) {
    return (
      (await this.writable.read(objectKey)) ??
      (await this.fallback.read(objectKey))
    );
  }
}

function workspaceFromObjectKey(objectKey: string) {
  const [workspaceId] = objectKey.split('/');
  if (!workspaceId || workspaceId === '.' || workspaceId === '..') {
    throw new Error('Core asset object key has no workspace prefix.');
  }
  return workspaceId;
}

function contentTypeFromObjectKey(objectKey: string) {
  const extension = objectKey.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    png: 'image/png',
    wav: 'audio/wav',
    webp: 'image/webp',
  };
  const contentType = extension ? contentTypes[extension] : undefined;
  if (!contentType) {
    throw new Error('Core asset object key has an unsupported media extension.');
  }
  return contentType;
}

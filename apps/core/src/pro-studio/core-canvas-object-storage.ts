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

  async put() {
    throw new Error('Core canvas object storage is read-only.');
  }

  async read(objectKey: string) {
    const workspaceId = workspaceFromObjectKey(objectKey);
    const response = await this.fetcher(
      new URL(
        `/v1/assets/${encodeURIComponent(objectKey)}`,
        this.options.coreServiceUrl
      ),
      {
        cache: 'no-store',
        headers: {
          'x-service-token': this.options.coreServiceToken,
          'x-workspace-id': workspaceId,
        },
      }
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Core asset read failed with status ${response.status}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
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

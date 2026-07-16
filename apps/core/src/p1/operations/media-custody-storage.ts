import { createHash } from 'node:crypto';

import type {
  CustodyOwnedAssetContentType,
  ModelAssetStoragePort,
} from '../model-supply/index.js';
import type { ReferenceAssetResolverPort } from '../model-supply/reference-asset-resolver.js';
import {
  MediaCustodyError,
  type MediaCustodyStoragePort,
} from './media-custody.js';

const CUSTODY_CONTENT_TYPES = new Set<CustodyOwnedAssetContentType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
]);

export class MediaCustodyStorageAdapter implements MediaCustodyStoragePort {
  constructor(
    private readonly sources: Pick<
      ReferenceAssetResolverPort,
      'inspect' | 'resolve'
    >,
    private readonly storage: ModelAssetStoragePort
  ) {}

  async inspectOwned(input: {
    assets: Array<{
      contentType: string;
      id: string;
      objectKey: string;
      sha256: string;
      sizeBytes?: number;
    }>;
    workspaceId: string;
  }) {
    if (!this.storage.inspectOwnedAsset) {
      throw new MediaCustodyError(
        'MEDIA_CUSTODY_STORAGE_UNAVAILABLE',
        'The configured storage cannot verify custody-owned Assets.'
      );
    }
    const verified = await Promise.all(
      input.assets.map(async (asset) => ({
        asset,
        valid: await this.storage.inspectOwnedAsset!({
          contentType: asset.contentType as CustodyOwnedAssetContentType,
          objectKey: asset.objectKey,
          sha256: asset.sha256,
          ...(asset.sizeBytes === undefined
            ? {}
            : { sizeBytes: asset.sizeBytes }),
          workspaceId: input.workspaceId,
        }),
      }))
    );
    return verified
      .filter((result) => result.valid)
      .map((result) => result.asset.id);
  }

  async inspectSources(input: {
    sourceAssetIds: string[];
    workspaceId: string;
  }) {
    const inspected = await this.sources.inspect(
      input.workspaceId,
      input.sourceAssetIds
    );
    return inspected.map((source) => {
      if (
        source.kind !== 'resolved' ||
        typeof source.objectKey !== 'string' ||
        !source.objectKey.startsWith(`${input.workspaceId}/`)
      ) {
        throw new MediaCustodyError(
          'SOURCE_ASSET_NOT_FOUND',
          `Custody source Asset ${source.assetId} is not readable in this workspace.`
        );
      }
      return { id: source.assetId, objectKey: source.objectKey };
    });
  }

  async copyToOwned(input: {
    sourceAssetId: string;
    sourceObjectKey: string;
    workspaceId: string;
  }) {
    const [source] = await this.sources.resolve(input.workspaceId, [
      input.sourceAssetId,
    ]);
    if (
      source?.kind !== 'resolved' ||
      typeof source.objectKey !== 'string' ||
      source.objectKey !== input.sourceObjectKey ||
      !source.objectKey.startsWith(`${input.workspaceId}/`)
    ) {
      throw new MediaCustodyError(
        'SOURCE_ASSET_NOT_FOUND',
        'The custody source Asset changed or is outside this workspace.'
      );
    }
    if (!CUSTODY_CONTENT_TYPES.has(source.contentType as CustodyOwnedAssetContentType)) {
      throw new MediaCustodyError(
        'SOURCE_ASSET_UNSUPPORTED',
        `Custody does not support ${source.contentType}.`
      );
    }
    if (!this.storage.persistOwnedAsset) {
      throw new MediaCustodyError(
        'MEDIA_CUSTODY_STORAGE_UNAVAILABLE',
        'The configured storage cannot persist custody-owned Assets.'
      );
    }
    const sha256 = createHash('sha256').update(source.bytes).digest('hex');
    if (sha256 !== source.sha256) {
      throw new MediaCustodyError(
        'SOURCE_ASSET_CHANGED',
        'The custody source bytes changed after resolution.'
      );
    }
    const owned = await this.storage.persistOwnedAsset({
      bytes: source.bytes,
      contentType: source.contentType as CustodyOwnedAssetContentType,
      workspaceId: input.workspaceId,
    });
    if (
      owned.sha256 !== source.sha256 ||
      owned.contentType !== source.contentType ||
      !owned.objectKey.startsWith(`${input.workspaceId}/owned/`)
    ) {
      throw new MediaCustodyError(
        'OWNED_ASSET_INVALID',
        'The custody copy receipt does not match the resolved source.'
      );
    }
    return {
      ...owned,
      id: `owned-${createHash('sha256')
        .update(`${input.sourceAssetId}\0${owned.sha256}`)
        .digest('hex')
        .slice(0, 32)}`,
    };
  }
}

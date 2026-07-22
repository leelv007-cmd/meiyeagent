import { createHash } from 'node:crypto';
import { hasCurrentRestrictedAssetAuthorization } from '@meiye/contracts';
import type { ProductRepository } from '../../product/repository.js';
import type {
  CanvasAssetRepository,
  CanvasOwnedAsset,
} from '../../pro-studio/canvas-asset-facade.js';

export type ReferenceAssetResolutionFailureReason =
  | 'not_found'
  | 'authorization_withdrawn'
  | 'rights_incomplete'
  | 'unreadable'
  | 'oversized';

export interface ReferenceAssetResolutionFailure {
  assetId: string;
  kind: 'failure';
  reason: ReferenceAssetResolutionFailureReason;
}

export interface ReferenceAssetInspectionSuccess {
  assetId: string;
  contentType: string;
  kind: 'resolved';
  objectKey?: string;
}

export interface ResolvedReferenceAsset extends ReferenceAssetInspectionSuccess {
  bytes: Uint8Array;
  providerReadableUrl: string;
  sha256: string;
}

export type ReferenceAssetInspection =
  | ReferenceAssetInspectionSuccess
  | ReferenceAssetResolutionFailure;
export type ReferenceAssetResolution =
  | ResolvedReferenceAsset
  | ReferenceAssetResolutionFailure;

export interface ReferenceAssetResolverPort {
  inspect(
    workspaceId: string,
    assetIds: string[],
  ): Promise<ReferenceAssetInspection[]>;
  resolve(
    workspaceId: string,
    assetIds: string[],
  ): Promise<ReferenceAssetResolution[]>;
}

export interface ProductReferenceAssetResolverOptions {
  appBaseUrl: string;
  serviceToken: string;
  maxBytes?: number;
  clock?: () => Date;
  fetch?: typeof fetch;
}

const DEFAULT_MAX_REFERENCE_ASSET_BYTES = 10 * 1024 * 1024;

interface OwnedAssetReferenceStorage {
  head?(objectKey: string): Promise<{
    contentType: string;
    sizeBytes: number;
  } | null>;
  read(objectKey: string): Promise<Uint8Array | null>;
}

export class CompositeReferenceAssetResolver
  implements ReferenceAssetResolverPort
{
  constructor(private readonly resolvers: ReferenceAssetResolverPort[]) {
    if (resolvers.length === 0) {
      throw new Error('At least one reference asset resolver is required.');
    }
  }

  async inspect(workspaceId: string, assetIds: string[]) {
    return Promise.all(
      assetIds.map(async (assetId) => {
        for (const resolver of this.resolvers) {
          const result = (await resolver.inspect(workspaceId, [assetId]))[0];
          if (
            result &&
            !(result.kind === 'failure' && result.reason === 'not_found')
          ) {
            return result;
          }
        }
        return failure(assetId, 'not_found');
      }),
    );
  }

  async resolve(workspaceId: string, assetIds: string[]) {
    return Promise.all(
      assetIds.map(async (assetId) => {
        for (const resolver of this.resolvers) {
          const result = (await resolver.resolve(workspaceId, [assetId]))[0];
          if (
            result &&
            !(result.kind === 'failure' && result.reason === 'not_found')
          ) {
            return result;
          }
        }
        return failure(assetId, 'not_found');
      }),
    );
  }
}

export class OwnedAssetReferenceResolver implements ReferenceAssetResolverPort {
  private readonly maxBytes: number;

  constructor(
    private readonly assets: Pick<CanvasAssetRepository, 'get'>,
    private readonly storage: OwnedAssetReferenceStorage,
    options: { maxBytes?: number } = {},
  ) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_REFERENCE_ASSET_BYTES;
    if (!Number.isInteger(this.maxBytes) || this.maxBytes <= 0) {
      throw new Error('Reference asset byte limit must be a positive integer.');
    }
  }

  async inspect(workspaceId: string, assetIds: string[]) {
    return Promise.all(
      assetIds.map(async (assetId): Promise<ReferenceAssetInspection> => {
        const receipt = await this.loadReceipt(workspaceId, assetId);
        if ('kind' in receipt) return receipt;
        if (this.storage.head) {
          let metadata;
          try {
            metadata = await this.storage.head(receipt.asset.objectKey);
          } catch {
            return failure(assetId, 'unreadable');
          }
          if (!metadata) return failure(assetId, 'unreadable');
          if (metadata.sizeBytes > this.maxBytes) {
            return failure(assetId, 'oversized');
          }
          if (
            metadata.sizeBytes !== receipt.asset.sizeBytes ||
            normalizedContentType(metadata.contentType) !== receipt.contentType
          ) {
            return failure(assetId, 'unreadable');
          }
        }
        return {
          assetId,
          contentType: receipt.contentType,
          kind: 'resolved',
          objectKey: receipt.asset.objectKey,
        };
      }),
    );
  }

  async resolve(workspaceId: string, assetIds: string[]) {
    return this.read(workspaceId, assetIds);
  }

  private async read(workspaceId: string, assetIds: string[]) {
    return Promise.all(
      assetIds.map(async (assetId): Promise<ReferenceAssetResolution> => {
        const receipt = await this.loadReceipt(workspaceId, assetId);
        if ('kind' in receipt) return receipt;
        const { asset, contentType } = receipt;
        let bytes: Uint8Array | null;
        try {
          bytes = await this.storage.read(asset.objectKey);
        } catch {
          return failure(assetId, 'unreadable');
        }
        if (!bytes) return failure(assetId, 'unreadable');
        if (bytes.byteLength > this.maxBytes) {
          return failure(assetId, 'oversized');
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (bytes.byteLength !== asset.sizeBytes || sha256 !== asset.sha256) {
          return failure(assetId, 'unreadable');
        }
        return {
          assetId,
          bytes,
          contentType,
          kind: 'resolved',
          objectKey: asset.objectKey,
          providerReadableUrl: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`,
          sha256,
        };
      }),
    );
  }

  private async loadReceipt(
    workspaceId: string,
    assetId: string,
  ): Promise<
    | { asset: CanvasOwnedAsset; contentType: string }
    | ReferenceAssetResolutionFailure
  > {
    let asset;
    try {
      asset = await this.assets.get(workspaceId, assetId);
    } catch {
      return failure(assetId, 'unreadable');
    }
    if (!asset) return failure(assetId, 'not_found');
    if (
      !asset.objectKey.startsWith(`${workspaceId}/`) ||
      !Number.isInteger(asset.sizeBytes) ||
      asset.sizeBytes <= 0 ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256)
    ) {
      return failure(assetId, 'unreadable');
    }
    if (asset.sizeBytes > this.maxBytes) {
      return failure(assetId, 'oversized');
    }
    const contentType = normalizedContentType(asset.contentType);
    if (!contentType) return failure(assetId, 'unreadable');
    return { asset, contentType };
  }
}

export class ProductReferenceAssetResolver
  implements ReferenceAssetResolverPort
{
  private readonly fetch: typeof fetch;
  private readonly maxBytes: number;
  private readonly appBaseUrl: string;

  constructor(
    private readonly products: Pick<ProductRepository, 'load'>,
    private readonly options: ProductReferenceAssetResolverOptions,
  ) {
    if (!options.appBaseUrl.trim()) {
      throw new Error('Reference asset APP base URL is required.');
    }
    if (!options.serviceToken.trim()) {
      throw new Error('Reference asset service token is required.');
    }
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_REFERENCE_ASSET_BYTES;
    if (!Number.isInteger(this.maxBytes) || this.maxBytes <= 0) {
      throw new Error('Reference asset byte limit must be a positive integer.');
    }
    this.appBaseUrl = options.appBaseUrl.replace(/\/+$/u, '');
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async inspect(workspaceId: string, assetIds: string[]) {
    return this.read(workspaceId, assetIds, 'inspect');
  }

  async resolve(workspaceId: string, assetIds: string[]) {
    return this.read(workspaceId, assetIds, 'content');
  }

  private read(
    workspaceId: string,
    assetIds: string[],
    mode: 'inspect',
  ): Promise<ReferenceAssetInspection[]>;
  private read(
    workspaceId: string,
    assetIds: string[],
    mode: 'content',
  ): Promise<ReferenceAssetResolution[]>;
  private async read(
    workspaceId: string,
    assetIds: string[],
    mode: 'inspect' | 'content',
  ): Promise<ReferenceAssetInspection[] | ReferenceAssetResolution[]> {
    const state = await this.products.load(workspaceId);
    return Promise.all(
      assetIds.map(async (assetId) => {
        const asset = state?.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return failure(assetId, 'not_found');
        if (asset.authorizationStatus !== 'authorized') {
          return failure(assetId, 'authorization_withdrawn');
        }
        if (
          asset.sourceType !== 'real' ||
          asset.consentScope === 'internal_only' ||
          !asset.rightsEvidence?.trim() ||
          !hasCurrentRestrictedAssetAuthorization(
            asset,
            this.options.clock?.() ?? new Date(),
          )
        ) {
          return failure(assetId, 'rights_incomplete');
        }
        if (!asset.objectKey.startsWith(`${workspaceId}/`)) {
          return failure(assetId, 'unreadable');
        }

        let response: Response;
        try {
          response = await this.fetch(this.fileUrl(asset.objectKey), {
            headers: {
              'x-service-token': this.options.serviceToken,
              'x-workspace-id': workspaceId,
            },
            method: mode === 'inspect' ? 'HEAD' : 'GET',
          });
        } catch {
          return failure(assetId, 'unreadable');
        }
        if (!response.ok) return failure(assetId, 'unreadable');
        const declaredLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
          return failure(assetId, 'oversized');
        }
        const contentType = normalizedContentType(
          response.headers.get('content-type'),
        );
        if (!contentType) return failure(assetId, 'unreadable');
        if (mode === 'inspect') {
          return {
            assetId,
            contentType,
            kind: 'resolved' as const,
            objectKey: asset.objectKey,
          };
        }

        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await response.arrayBuffer());
        } catch {
          return failure(assetId, 'unreadable');
        }
        if (bytes.byteLength > this.maxBytes) {
          return failure(assetId, 'oversized');
        }
        return {
          assetId,
          bytes,
          contentType,
          kind: 'resolved' as const,
          objectKey: asset.objectKey,
          providerReadableUrl: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      }),
    );
  }

  private fileUrl(objectKey: string) {
    return `${this.appBaseUrl}/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`;
  }
}

function failure(
  assetId: string,
  reason: ReferenceAssetResolutionFailureReason,
): ReferenceAssetResolutionFailure {
  return { assetId, kind: 'failure', reason };
}

function normalizedContentType(value: string | null) {
  const contentType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return contentType && /^(?:image\/(?:jpeg|png|webp)|video\/mp4|audio\/(?:mpeg|wav))$/u.test(contentType)
    ? contentType
    : undefined;
}

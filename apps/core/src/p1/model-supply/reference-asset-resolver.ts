import { createHash } from 'node:crypto';
import type { ProductRepository } from '../../product/repository.js';

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
  fetch?: typeof fetch;
}

const DEFAULT_MAX_REFERENCE_ASSET_BYTES = 10 * 1024 * 1024;

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
          !asset.rightsEvidence?.trim()
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
    return `${this.appBaseUrl}/api/storage/file?key=${encodeURIComponent(objectKey)}`;
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

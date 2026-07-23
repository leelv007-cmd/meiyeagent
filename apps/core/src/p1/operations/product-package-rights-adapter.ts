import {
  hasCurrentRestrictedAssetAuthorization,
  type Platform,
} from '@meiye/contracts';
import type { ProductPackageRightsPropagationPort } from '../../product/product-service.js';
import type { OperationsApplicationService } from './application-service.js';
import type {
  ContentPackageAssetExportPolicyPort,
  ContentPackageRightsResolverPort,
} from './types.js';

interface ProductAssetRightsRepository {
  load(workspaceId: string): Promise<{
    assets: Array<{
      authorizationStatus: 'pending' | 'authorized' | 'withdrawn' | 'blocked';
      category?: 'store' | 'before_after' | 'customer_case' | 'price_list' | 'other';
      consentScope: 'internal_only' | 'public_marketing' | 'paid_advertising';
      containsPerson?: boolean;
      id: string;
      rightsEvidence?: string;
      rightsNoFixedExpiry?: boolean;
      rightsPlatforms?: Platform[];
      rightsValidUntil?: string;
      sourceType: 'real' | 'ai_generated';
    }>;
  } | null>;
}

export class ProductContentPackageRightsResolver
  implements
    ContentPackageRightsResolverPort,
    ContentPackageAssetExportPolicyPort
{
  constructor(
    private readonly product: ProductAssetRightsRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async resolve(
    input: Parameters<ContentPackageRightsResolverPort['resolve']>[0]
  ) {
    const state = await this.product.load(input.workspaceId);
    if (!state) {
      return {
        knownAssetIds: [],
        unauthorizedAssetIds: [...new Set(input.assetIds)],
      };
    }
    const requested = new Set(input.assetIds);
    const knownAssets = state.assets.filter((asset) => requested.has(asset.id));
    return {
      knownAssetIds: knownAssets.map((asset) => asset.id),
      unauthorizedAssetIds: knownAssets
        .filter(
          (asset) =>
            asset.sourceType !== 'real' ||
            asset.authorizationStatus !== 'authorized' ||
            asset.consentScope === 'internal_only' ||
            !asset.rightsEvidence?.trim() ||
            !hasCurrentRestrictedAssetAuthorization(
              {
                category: asset.category,
                containsPerson: asset.containsPerson ?? false,
                rightsNoFixedExpiry: asset.rightsNoFixedExpiry,
                rightsPlatforms: asset.rightsPlatforms,
                rightsValidUntil: asset.rightsValidUntil,
              },
              this.clock()
            )
        )
      .map((asset) => asset.id),
    };
  }

  async resolveExportPolicy(
    input: Parameters<ContentPackageAssetExportPolicyPort['resolveExportPolicy']>[0]
  ) {
    const asset = (await this.product.load(input.workspaceId))?.assets.find(
      (candidate) => candidate.id === input.assetId
    );
    if (!asset) return { kind: 'unknown' as const };
    if (
      asset.authorizationStatus === 'withdrawn' ||
      asset.authorizationStatus === 'blocked'
    ) {
      return { kind: 'unavailable' as const, reason: 'revoked' as const };
    }
    if (asset.authorizationStatus !== 'authorized' || asset.sourceType !== 'real') {
      return { kind: 'unavailable' as const, reason: 'access_denied' as const };
    }
    if (asset.consentScope === 'internal_only') {
      return {
        kind: 'unavailable' as const,
        reason: 'private_retrieval_denied' as const,
      };
    }
    const now = this.clock();
    if (
      asset.rightsNoFixedExpiry !== true &&
      asset.rightsValidUntil &&
      Number.isFinite(Date.parse(asset.rightsValidUntil)) &&
      Date.parse(asset.rightsValidUntil) <= now.getTime()
    ) {
      return { kind: 'unavailable' as const, reason: 'expired' as const };
    }
    if (
      !asset.rightsEvidence?.trim() ||
      !hasCurrentRestrictedAssetAuthorization(
        {
          category: asset.category,
          containsPerson: asset.containsPerson ?? false,
          rightsNoFixedExpiry: asset.rightsNoFixedExpiry,
          rightsPlatforms: asset.rightsPlatforms,
          rightsValidUntil: asset.rightsValidUntil,
        },
        now
      )
    ) {
      return { kind: 'unavailable' as const, reason: 'access_denied' as const };
    }
    return { kind: 'authorized' as const };
  }
}

export class OperationsProductPackageRightsAdapter
  implements ProductPackageRightsPropagationPort
{
  constructor(
    private readonly operations: () => OperationsApplicationService
  ) {}

  revokePackagesUsingAsset(
    context: Parameters<
      ProductPackageRightsPropagationPort['revokePackagesUsingAsset']
    >[0],
    assetId: string
  ) {
    return this.operations().revokeContentPackagesUsingAsset(
      {
        actor: context.actor === 'worker' ? 'worker' : 'owner',
        correlationId: context.correlationId,
        userId: context.userId,
        workspaceId: context.workspaceId,
      },
      assetId
    );
  }
}

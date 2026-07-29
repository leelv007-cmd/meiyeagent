import {
  rightsBasisSchema,
  type ContentPackage,
  type ContentPackageVersion,
  type RightsBasis,
  type SupplyContract,
  type SupplyDeployment,
} from '@meiye/contracts';

import type {
  ContentPackageRightsBasisResolverPort,
  ContentPackageRightsResolverPort,
} from './types.js';
import { resolveCompleteGenerationRightsChain } from './generation-rights-chain.js';

export interface ContentPackageRightsBasisRegistryPort {
  getRegistryRevision(
    workspaceId: string,
    revisionId: string,
  ): Promise<{
    catalogRevisionId?: string;
    contracts: SupplyContract[];
    deployments: SupplyDeployment[];
  } | null>;
}

export class ContentPackageRightsBasisError extends Error {
  readonly code = 'CONTENT_PACKAGE_RIGHTS_BASIS_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'ContentPackageRightsBasisError';
  }
}

export class ContentPackageRightsBasisResolver
  implements ContentPackageRightsBasisResolverPort
{
  constructor(
    private readonly assetRights: ContentPackageRightsResolverPort,
    private readonly supplyRegistry: ContentPackageRightsBasisRegistryPort,
  ) {}

  async resolve(input: {
    contentPackage: ContentPackage;
    platform: ContentPackage['variants'][number]['platform'];
    version: ContentPackageVersion;
    workspaceId: string;
  }): Promise<RightsBasis> {
    const versionInPackage =
      input.contentPackage.versions.some(
        (version) => version.id === input.version.id,
      ) ||
      input.contentPackage.variants
        .find((variant) => variant.platform === input.platform)
        ?.versions.some((version) => version.id === input.version.id);
    if (
      input.contentPackage.workspaceId !== input.workspaceId ||
      !versionInPackage
    ) {
      throw unavailable('The ContentPackage export scope is invalid.');
    }

    const sourceAssetIds = unique(input.contentPackage.source.assetIds);
    if (sourceAssetIds.length > 0) {
      return this.resolveSourceAuthorizations(
        input.contentPackage,
        sourceAssetIds,
        input.platform,
        input.workspaceId,
      );
    }
    return this.resolveGenerationTerms(input);
  }

  private async resolveSourceAuthorizations(
    contentPackage: ContentPackage,
    sourceAssetIds: string[],
    platform: ContentPackage['variants'][number]['platform'],
    workspaceId: string,
  ): Promise<RightsBasis> {
    if (
      !contentPackage.marketing ||
      !sameSet(contentPackage.marketing.rightsRefs, sourceAssetIds)
    ) {
      throw unavailable(
        'Frozen source assets do not match MarketingPackage rights references.',
      );
    }
    const current = await this.assetRights.resolve({
      assetIds: sourceAssetIds,
      platform,
      workspaceId,
    });
    if (
      current.unauthorizedAssetIds.length > 0 ||
      !current.knownAssetIds ||
      !sameSet(current.knownAssetIds, sourceAssetIds)
    ) {
      throw unavailable(
        'Frozen source assets are not all currently authorized.',
      );
    }
    return rightsBasisSchema.parse({
      kind: 'source_asset_authorizations',
      rightsRefs: sourceAssetIds,
    });
  }

  private async resolveGenerationTerms(input: {
    contentPackage: ContentPackage;
    version: ContentPackageVersion;
    workspaceId: string;
  }): Promise<RightsBasis> {
    const { contentPackage, version, workspaceId } = input;
    if (!contentPackage.marketing || contentPackage.marketing.rightsRefs.length) {
      throw unavailable(
        'Source-free generation cannot carry source authorization references.',
      );
    }
    const chain = resolveCompleteGenerationRightsChain({
      generated: contentPackage.generated,
      selectedAssetIds: version.orderedAssetIds,
    });
    if (!chain) {
      throw unavailable(
        'The selected asset is not bound to one complete generation chain.',
      );
    }
    const {
      childRun,
      completedAttempt,
      generatedAssetId,
      providerTaskRef,
      route,
    } = chain;
    const registry = await this.supplyRegistry.getRegistryRevision(
      workspaceId,
      route.catalogRevisionId,
    );
    if (!registry || registry.catalogRevisionId !== route.catalogRevisionId) {
      throw unavailable(
        'The generation-time supply registry revision is unavailable.',
      );
    }
    const deployments = registry.deployments.filter(
      (deployment) =>
        deployment.id === route.deploymentId &&
        deployment.catalogModelId === route.actualCatalogModelId &&
        deployment.lifecycleStatus === 'active',
    );
    if (deployments.length !== 1) {
      throw unavailable(
        'The generation route does not match one supply deployment.',
      );
    }
    const generatedAt = Date.parse(completedAttempt.createdAt);
    const deployment = deployments[0];
    if (!deployment) {
      throw unavailable(
        'The generation route does not match one supply deployment.',
      );
    }
    const contracts = registry.contracts.filter(
      (contract) =>
        contract.providerProfileId === deployment.providerProfileId &&
        contractEffectiveAt(contract, generatedAt),
    );
    const contract = contracts[0];
    if (
      contracts.length !== 1 ||
      !contract ||
      contract.commercialUse !== 'allowed' ||
      !contract.termsRevisionId.trim()
    ) {
      throw unavailable(
        'The generation-time supply contract does not permit commercial use.',
      );
    }
    return rightsBasisSchema.parse({
      commercialUse: 'allowed',
      generatedAssetId,
      kind: 'ai_generation_terms',
      providerTaskRef,
      runId: childRun.runId,
      termsRevisionId: contract.termsRevisionId,
    });
  }
}

function contractEffectiveAt(contract: SupplyContract, timestamp: number) {
  const effectiveFrom = Date.parse(contract.effectiveFrom);
  const effectiveTo = contract.effectiveTo
    ? Date.parse(contract.effectiveTo)
    : Number.POSITIVE_INFINITY;
  return (
    Number.isFinite(timestamp) &&
    Number.isFinite(effectiveFrom) &&
    effectiveFrom <= timestamp &&
    timestamp < effectiveTo
  );
}

function sameSet(left: readonly string[], right: readonly string[]) {
  const uniqueLeft = unique(left);
  const uniqueRight = unique(right);
  return (
    uniqueLeft.length === left.length &&
    uniqueRight.length === right.length &&
    uniqueLeft.length === uniqueRight.length &&
    uniqueLeft.every((value) => uniqueRight.includes(value))
  );
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function unavailable(message: string) {
  return new ContentPackageRightsBasisError(message);
}

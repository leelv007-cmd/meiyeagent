import type {
  AssetRevision,
  ContentPackage,
  ReusableAssetCandidate,
} from '@meiye/contracts';

import type { ContextBundleRepository } from './context-bundle-repository.js';
import { contentPackageRightsAssetIds } from './content-package.js';
import {
  ReuseMemoryError,
  type ReusableAssetSourceVerifier,
} from './reuse-memory-service.js';
import type {
  ContentPackageRightsResolverPort,
  OperationContext,
} from './types.js';

interface ReuseSourcePackageReader {
  getContentPackage(
    context: OperationContext,
    packageId: string,
  ): Promise<ContentPackage>;
}

type ReuseSource = Pick<
  ReusableAssetCandidate,
  'workspaceId' | 'provenance' | 'rights' | 'fixedItems'
> & { actorId: string };

export class OperationsReusableAssetSourceVerifier
  implements ReusableAssetSourceVerifier
{
  constructor(
    private readonly packages: ReuseSourcePackageReader,
    private readonly rights: ContentPackageRightsResolverPort,
    private readonly bundles: ContextBundleRepository,
  ) {}

  verifyCandidate(candidate: ReusableAssetCandidate) {
    return this.verify(
      {
        workspaceId: candidate.workspaceId,
        provenance: candidate.provenance,
        rights: candidate.rights,
        fixedItems: candidate.fixedItems,
        actorId: candidate.createdBy,
      },
      true,
    );
  }

  verifyRevision(revision: AssetRevision) {
    return this.verify(
      {
        workspaceId: revision.workspaceId,
        provenance: revision.provenance,
        rights: revision.rights,
        fixedItems: revision.fixedItems,
        actorId: revision.createdBy,
      },
      false,
    );
  }

  private async verify(
    source: ReuseSource,
    requireCurrentPackageRevision: boolean,
  ) {
    const contentPackage = await this.packages.getContentPackage(
      {
        actor: 'owner',
        correlationId: `reuse-source:${source.provenance.sourcePackageId}`,
        userId: source.actorId,
        workspaceId: source.workspaceId,
      },
      source.provenance.sourcePackageId,
    );
    if (
      (requireCurrentPackageRevision &&
        contentPackage.revision !== source.provenance.sourcePackageRevision) ||
      contentPackage.revision < source.provenance.sourcePackageRevision
    ) {
      throw new ReuseMemoryError(
        'CONFLICT',
        'Source ContentPackage revision does not match the reusable provenance.',
      );
    }
    if (
      !['accepted', 'review_ready'].includes(contentPackage.status) ||
      contentPackage.rights.state !== 'authorized'
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Source ContentPackage is not currently reusable.',
      );
    }
    const version = contentPackage.versions.find(
      (item) => item.id === source.provenance.sourceVersionId,
    );
    if (!version) {
      throw new ReuseMemoryError(
        'NOT_FOUND',
        'Source package version not found.',
      );
    }
    const expectedSourceRef = `${contentPackage.id}:${version.id}`;
    if (
      source.fixedItems.some((item) => item.sourceRef !== expectedSourceRef)
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Reusable structure is not bound to the exact source package version.',
      );
    }
    const bundle = await this.bundles.get(
      source.workspaceId,
      source.provenance.contextBundleId,
      source.provenance.contextBundleRevision,
    );
    if (!bundle) {
      throw new ReuseMemoryError(
        'NOT_FOUND',
        'Source ContextBundle not found.',
      );
    }
    const requiredAssetIds = contentPackageRightsAssetIds(
      contentPackage,
      version,
    ).sort();
    const declaredAssetIds = [...new Set(source.rights.assetIds)].sort();
    if (
      source.rights.status !== 'authorized' ||
      JSON.stringify(requiredAssetIds) !== JSON.stringify(declaredAssetIds)
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Reusable rights do not match the exact source version assets.',
      );
    }
    const live = await this.rights.resolve({
      workspaceId: source.workspaceId,
      assetIds: declaredAssetIds,
    });
    if (
      live.unauthorizedAssetIds.length > 0 ||
      (live.knownAssetIds !== undefined &&
        declaredAssetIds.some(
          (assetId) => !live.knownAssetIds?.includes(assetId),
        ))
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Live Product rights block this reusable source.',
      );
    }
  }
}

export interface CustodySourceAsset {
  id: string;
  objectKey: string;
}

export interface CustodyOwnedAsset {
  contentType: string;
  id: string;
  objectKey: string;
  sha256: string;
  sizeBytes?: number;
  sourceAssetId?: string;
}

export interface CustodyPackage {
  generated: { assetIds: string[]; ownedAssets?: CustodyOwnedAsset[] };
  id: string;
  source: { assetIds: string[] };
  versions: Array<{ id: string; orderedAssetIds: string[] }>;
  workspaceId: string;
}

export interface MediaCustodyInput {
  contentPackages: CustodyPackage[];
  sourceAssets: CustodySourceAsset[];
  workspaceId: string;
}

export interface MediaCustodyStoragePort {
  copyToOwned(input: {
    sourceAssetId: string;
    sourceObjectKey: string;
    workspaceId: string;
  }): Promise<Omit<CustodyOwnedAsset, 'sourceAssetId'>>;
  inspectSources(input: {
    sourceAssetIds: string[];
    workspaceId: string;
  }): Promise<CustodySourceAsset[]>;
  inspectOwned(input: {
    assets: CustodyOwnedAsset[];
    workspaceId: string;
  }): Promise<string[]>;
}

export class MediaCustodyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function reconcileMediaCustody(input: MediaCustodyInput) {
  const sourceAssets = new Map(
    input.sourceAssets.map((asset) => [asset.id, asset])
  );
  const ownedAssets = new Map<string, CustodyOwnedAsset>();
  const ownedToSource = new Map<string, string>();
  for (const contentPackage of input.contentPackages) {
    if (contentPackage.workspaceId !== input.workspaceId) {
      throw new Error('Custody reconciliation cannot cross workspaces.');
    }
    const packageOwnedAssets = contentPackage.generated.ownedAssets ?? [];
    packageOwnedAssets.forEach((asset) => {
      if (
        !asset.objectKey.startsWith(`${input.workspaceId}/`) ||
        asset.objectKey.includes('://')
      ) {
        throw new Error(
          'Custody owned assets require a workspace-owned object key.'
        );
      }
      ownedAssets.set(asset.id, asset);
      const sourceAssetId = asset.sourceAssetId;
      if (sourceAssetId && sourceAssets.has(sourceAssetId)) {
        ownedToSource.set(asset.id, sourceAssetId);
      }
    });
  }

  const packageLinks: Array<{
    assetId: string;
    custody: 'replica';
    packageId: string;
    sourceAssetId?: string;
    status: 'complete' | 'missing_replica';
    versionId: string;
  }> = [];
  const repairs: Array<{
    action: 'copy_to_owned';
    packageId: string;
    sourceAssetId: string;
    sourceObjectKey: string;
    versionId: string;
  }> = [];
  for (const contentPackage of input.contentPackages) {
    for (const version of contentPackage.versions) {
      for (const assetId of version.orderedAssetIds) {
        const owned = ownedAssets.get(assetId);
        if (owned) {
          packageLinks.push({
            assetId: owned.id,
            custody: 'replica',
            packageId: contentPackage.id,
            ...(ownedToSource.get(assetId)
              ? { sourceAssetId: ownedToSource.get(assetId) }
              : {}),
            status: 'complete',
            versionId: version.id,
          });
          continue;
        }
        const source = sourceAssets.get(assetId);
        if (!source) continue;
        packageLinks.push({
          assetId: source.id,
          custody: 'replica',
          packageId: contentPackage.id,
          sourceAssetId: source.id,
          status: 'missing_replica',
          versionId: version.id,
        });
        repairs.push({
          action: 'copy_to_owned',
          packageId: contentPackage.id,
          sourceAssetId: source.id,
          sourceObjectKey: source.objectKey,
          versionId: version.id,
        });
      }
    }
  }

  return {
    assets: [
      ...input.sourceAssets.map((asset) => ({
        custody: 'source' as const,
        id: asset.id,
        objectKey: asset.objectKey,
      })),
      ...[...ownedAssets.values()].map((asset) => ({
        custody: 'owned' as const,
        id: asset.id,
        objectKey: asset.objectKey,
        ...(ownedToSource.get(asset.id)
          ? { sourceAssetId: ownedToSource.get(asset.id) }
          : {}),
      })),
    ],
    packageLinks,
    repairs,
    summary: {
      missingReplicas: repairs.length,
      ownedAssets: ownedAssets.size,
      sampledLinks: packageLinks.length,
      sourceAssets: input.sourceAssets.length,
    },
  };
}

export async function repairMediaCustody(input: MediaCustodyInput & {
  packageId: string;
  storage: MediaCustodyStoragePort;
  versionId: string;
}) {
  const contentPackages = structuredClone(input.contentPackages);
  const contentPackage = contentPackages.find(
    (candidate) => candidate.id === input.packageId
  );
  if (
    !contentPackage ||
    contentPackage.workspaceId !== input.workspaceId
  ) {
    throw new MediaCustodyError(
      'CONTENT_PACKAGE_NOT_FOUND',
      'The custody ContentPackage was not found in this workspace.'
    );
  }
  const version = contentPackage.versions.find(
    (candidate) => candidate.id === input.versionId
  );
  if (!version) {
    throw new MediaCustodyError(
      'CONTENT_PACKAGE_VERSION_NOT_FOUND',
      'The custody ContentPackage version was not found.'
    );
  }
  const ownedAssets = contentPackage.generated.ownedAssets ?? [];
  const ownedById = new Map(ownedAssets.map((asset) => [asset.id, asset]));
  const referencedOwnedAssets = unique(version.orderedAssetIds)
    .map((assetId) => ownedById.get(assetId))
    .filter((asset): asset is CustodyOwnedAsset => Boolean(asset));
  const verifiedOwnedIds = new Set(
    await input.storage.inspectOwned({
      assets: referencedOwnedAssets,
      workspaceId: input.workspaceId,
    })
  );
  const missingOwnedAssets = referencedOwnedAssets.filter(
    (asset) => !verifiedOwnedIds.has(asset.id)
  );
  if (missingOwnedAssets.some((asset) => !asset.sourceAssetId)) {
    throw new MediaCustodyError(
      'SOURCE_ASSET_NOT_FOUND',
      'A missing custody replica has no source lineage for repair.'
    );
  }
  const missingOwnedToSource = new Map(
    missingOwnedAssets.map((asset) => [asset.id, asset.sourceAssetId as string])
  );
  const sourceAssetIds = unique([
    ...version.orderedAssetIds.filter((assetId) => !ownedById.has(assetId)),
    ...referencedOwnedAssets.flatMap((asset) =>
      asset.sourceAssetId ? [asset.sourceAssetId] : []
    ),
  ]);
  if (sourceAssetIds.length === 0) {
    throw new MediaCustodyError(
      'MEDIA_CUSTODY_REPAIR_NOT_NEEDED',
      'The target version has no source custody lineage to repair.'
    );
  }
  if (
    sourceAssetIds.some(
      (sourceAssetId) => !contentPackage.source.assetIds.includes(sourceAssetId)
    )
  ) {
    throw new MediaCustodyError(
      'SOURCE_ASSET_NOT_FOUND',
      'The custody source Asset is not referenced by the target version.'
    );
  }
  const inspectedSources = await input.storage.inspectSources({
    sourceAssetIds,
    workspaceId: input.workspaceId,
  });
  assertInspectedSources(input.workspaceId, sourceAssetIds, inspectedSources);
  const reportBefore = reconcileMediaCustody({
    contentPackages: [
      {
        ...contentPackage,
        versions: [
          {
            ...version,
            orderedAssetIds: version.orderedAssetIds.map(
              (assetId) => missingOwnedToSource.get(assetId) ?? assetId
            ),
          },
        ],
      },
    ],
    sourceAssets: inspectedSources,
    workspaceId: input.workspaceId,
  });
  const repairs = reportBefore.repairs.filter(
    (repair) =>
      repair.packageId === contentPackage.id && repair.versionId === version.id
  );
  const replacementBySource = new Map<string, CustodyOwnedAsset>();
  for (const repair of repairs) {
    const copied = await input.storage.copyToOwned({
      sourceAssetId: repair.sourceAssetId,
      sourceObjectKey: repair.sourceObjectKey,
      workspaceId: input.workspaceId,
    });
    assertOwnedAsset(input.workspaceId, copied);
    const owned = { ...copied, sourceAssetId: repair.sourceAssetId };
    replacementBySource.set(repair.sourceAssetId, owned);
    ownedById.set(owned.id, owned);
  }
  contentPackage.generated.ownedAssets = [...ownedById.values()];
  version.orderedAssetIds = version.orderedAssetIds.map(
    (assetId) =>
      replacementBySource.get(missingOwnedToSource.get(assetId) ?? assetId)
        ?.id ?? assetId
  );
  contentPackage.generated.assetIds = unique([
    ...contentPackage.generated.assetIds.map(
      (assetId) =>
        replacementBySource.get(missingOwnedToSource.get(assetId) ?? assetId)
          ?.id ?? assetId
    ),
    ...version.orderedAssetIds.filter((assetId) => ownedById.has(assetId)),
  ]);

  const report = reconcileMediaCustody({
    contentPackages: [{ ...contentPackage, versions: [version] }],
    sourceAssets: inspectedSources,
    workspaceId: input.workspaceId,
  });
  if (report.summary.missingReplicas > 0) {
    throw new MediaCustodyError(
      'MEDIA_CUSTODY_REPAIR_INCOMPLETE',
      'Media custody still has missing replicas after repair.'
    );
  }
  return {
    contentPackages,
    copiedAssetIds: version.orderedAssetIds.filter((assetId) =>
      ownedById.has(assetId)
    ),
    packageId: contentPackage.id,
    report,
    sourceAssetIds,
    versionId: version.id,
  };
}

function assertInspectedSources(
  workspaceId: string,
  expectedIds: string[],
  sources: CustodySourceAsset[]
) {
  const actualIds = sources.map((source) => source.id);
  if (
    new Set(actualIds).size !== actualIds.length ||
    expectedIds.some((sourceAssetId) => !actualIds.includes(sourceAssetId)) ||
    actualIds.some((sourceAssetId) => !expectedIds.includes(sourceAssetId)) ||
    sources.some(
      (source) =>
        !source.objectKey.startsWith(`${workspaceId}/`) ||
        source.objectKey.includes('://')
    )
  ) {
    throw new MediaCustodyError(
      'SOURCE_ASSET_NOT_FOUND',
      'Every custody source Asset must resolve inside the workspace.'
    );
  }
}

function assertOwnedAsset(
  workspaceId: string,
  asset: Omit<CustodyOwnedAsset, 'sourceAssetId'>
) {
  if (
    !asset.id.trim() ||
    !asset.contentType.trim() ||
    !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
    !asset.objectKey.startsWith(`${workspaceId}/`) ||
    asset.objectKey.includes('://') ||
    (asset.sizeBytes !== undefined && asset.sizeBytes <= 0)
  ) {
    throw new MediaCustodyError(
      'OWNED_ASSET_INVALID',
      'The copied custody Asset receipt is invalid.'
    );
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}

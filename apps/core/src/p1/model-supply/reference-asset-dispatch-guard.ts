import type { ModelSupplySubmission } from './route-contracts.js';
import type { ReferenceAssetResolverPort } from './reference-asset-resolver.js';
import type { DataClass } from './supply-contracts.js';

export async function withServerDerivedReferenceDataClass(
  submission: ModelSupplySubmission,
  resolver: Pick<ReferenceAssetResolverPort, 'inspect'> | undefined,
): Promise<ModelSupplySubmission> {
  const assetIds =
    submission.input?.inputAssets?.map((asset) => asset.assetId) ??
    submission.input?.referenceAssetIds ??
    [];
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) return submission;
  if (!resolver) {
    throw new Error('Reference asset resolver is unavailable.');
  }

  let inspections;
  try {
    inspections = await resolver.inspect(
      submission.workspaceId,
      uniqueAssetIds,
    );
  } catch {
    throw new Error('Reference asset inspection failed.');
  }
  if (
    inspections.length !== uniqueAssetIds.length ||
    inspections.some(
      (inspection, index) => inspection.assetId !== uniqueAssetIds[index],
    )
  ) {
    throw new Error('Reference asset inspection was incomplete or out of order.');
  }

  const dataClass = new Set<DataClass>(submission.dataClass);
  let domesticOnly = false;
  for (const inspection of inspections) {
    if (inspection.kind !== 'resolved') {
      throw new Error(
        `Reference asset ${inspection.assetId} is not dispatchable: ${inspection.reason}.`,
      );
    }
    for (const value of inspection.dataClass ?? []) dataClass.add(value);
    if (inspection.classificationSource !== 'server_fact') {
      domesticOnly = true;
    }
  }
  return {
    ...submission,
    dataClass: [...dataClass].sort(),
    ...(domesticOnly
      ? { referenceAssetRegionBoundary: 'domestic' as const }
      : {}),
  };
}

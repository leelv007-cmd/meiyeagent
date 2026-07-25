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
  if (!resolver || uniqueAssetIds.length === 0) return submission;

  const inspections = await resolver.inspect(
    submission.workspaceId,
    uniqueAssetIds,
  );
  if (
    inspections.length !== uniqueAssetIds.length ||
    inspections.some(
      (inspection, index) =>
        inspection.kind === 'failure' ||
        inspection.assetId !== uniqueAssetIds[index],
    )
  ) {
    return submission;
  }

  const dataClass = new Set<DataClass>();
  for (const inspection of inspections) {
    if (inspection.kind !== 'resolved') continue;
    for (const value of inspection.dataClass ?? []) dataClass.add(value);
  }
  return {
    ...submission,
    dataClass: [...dataClass].sort(),
  };
}

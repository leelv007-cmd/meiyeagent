import type { ContentPackage } from '@meiye/contracts';

type GeneratedEvidence = Pick<
  ContentPackage['generated'],
  'assetIds' | 'childRuns' | 'ownedAssets'
>;
type ChildRun = GeneratedEvidence['childRuns'][number];
type ProviderAttempt = NonNullable<ChildRun['providerAttempts']>[number];
type RouteSnapshot = NonNullable<ChildRun['routeSnapshot']>;

export interface CompleteGenerationRightsChain {
  childRun: ChildRun;
  completedAttempt: ProviderAttempt;
  generatedAssetId: string;
  providerTaskRef: string;
  route: RouteSnapshot;
}

export function resolveCompleteGenerationRightsChain(input: {
  generated: GeneratedEvidence;
  selectedAssetIds: readonly string[];
}): CompleteGenerationRightsChain | null {
  const selectedAssetIds = [...new Set(input.selectedAssetIds)];
  if (selectedAssetIds.length !== 1) return null;
  const generatedAssetId = selectedAssetIds[0];
  if (!generatedAssetId || !input.generated.assetIds.includes(generatedAssetId)) {
    return null;
  }
  const ownedAssets = (input.generated.ownedAssets ?? []).filter(
    (asset) => asset.id === generatedAssetId,
  );
  const childRuns = input.generated.childRuns.filter((run) =>
    run.assetIds?.includes(generatedAssetId),
  );
  if (ownedAssets.length !== 1 || childRuns.length !== 1) return null;

  const ownedAsset = ownedAssets[0];
  const childRun = childRuns[0];
  if (!ownedAsset || !childRun) return null;
  const providerTaskRef = ownedAsset.sourceTaskRef?.trim();
  const route = childRun.routeSnapshot;
  if (
    childRun.status !== 'succeeded' ||
    !providerTaskRef ||
    !route ||
    childRun.routeSnapshotId !== route.id ||
    route.actualCatalogModelId !== childRun.actualCatalogModelId
  ) {
    return null;
  }
  const completedAttempts = (childRun.providerAttempts ?? []).filter(
    (attempt) =>
      attempt.acceptance === 'accepted' &&
      attempt.status === 'completed' &&
      attempt.jobId === childRun.runId &&
      attempt.providerTaskRef === providerTaskRef &&
      attempt.deploymentId === route.deploymentId &&
      attempt.catalogModelId === route.actualCatalogModelId,
  );
  const completedAttempt = completedAttempts[0];
  if (completedAttempts.length !== 1 || !completedAttempt) return null;
  return {
    childRun,
    completedAttempt,
    generatedAssetId,
    providerTaskRef,
    route,
  };
}

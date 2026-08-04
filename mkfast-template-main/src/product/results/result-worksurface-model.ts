import type {
  ContentPackagePlatform,
  PublicContentPackage,
  ResultWorkspaceKind,
  VideoWorkflowPublicProjection,
} from '@meiye/contracts';

import type { ResultCenterPageProps } from './result-center-page';
import {
  buildLiveVideoWorksurface,
  buildNativeVideoWorksurface,
  imageWorksurfaceFromContentPackage,
  platformPreviewsFromContentPackage,
  type ResultCenterLiveSelection,
} from './result-live-projection';
import { calibrateTerminalRevision } from './result-token-stream';
import type { PartialCopyCandidate } from './result-token-stream';

type PackageVersion = PublicContentPackage['versions'][number];

export function buildResultVideoWorksurface(input: {
  contentPackage?: PublicContentPackage;
  currentPackageVersion?: PackageVersion;
  selected?: ResultCenterLiveSelection | null;
  workflow?: VideoWorkflowPublicProjection | null;
}): ResultCenterPageProps['videoWorksurface'] {
  const base = input.selected
    ? (buildLiveVideoWorksurface(input.selected, input.workflow) ??
      buildNativeVideoWorksurface(input.selected, input.contentPackage))
    : undefined;
  const composedAsset = input.contentPackage?.generated.ownedAssets
    ?.filter((asset) => asset.contentType === 'video/mp4')
    .at(-1);
  const packageBacked =
    base && composedAsset
      ? {
          ...base,
          composedCandidate: {
            assetId: composedAsset.id,
            durationSeconds: base.composedCandidate?.durationSeconds ?? 0,
            playableUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(composedAsset.objectKey)}`,
          },
        }
      : base;

  return packageBacked &&
    input.contentPackage?.status === 'accepted' &&
    input.currentPackageVersion
    ? {
        ...packageBacked,
        adoption: {
          adoptedAt: input.contentPackage.updatedAt,
          composedAssetId:
            input.currentPackageVersion.orderedAssetIds[0] ?? null,
          contentPackageId: input.contentPackage.id,
          contentRevision: input.contentPackage.revision,
          status: 'adopted',
        },
        baseRevisionId: input.currentPackageVersion.id,
        contentId: input.contentPackage.id,
        loopPhase: 'adopted',
        versionId: input.currentPackageVersion.id,
      }
    : packageBacked;
}

export function buildResultCopyWorksurface(input: {
  contentPackage?: PublicContentPackage;
  currentVersion?: PackageVersion;
  editVersions: PackageVersion[];
  partialCandidates?: PartialCopyCandidate[];
  resultEditPlatform?: ContentPackagePlatform | null;
  selected?: ResultCenterLiveSelection | null;
  workId: string;
  workspaceKind: ResultWorkspaceKind;
}): ResultCenterPageProps['copyWorksurface'] {
  const terminalCalibration =
    input.currentVersion &&
    (input.workspaceKind === 'copy' || input.workspaceKind === 'image')
      ? calibrateTerminalRevision({
          streamed: input.partialCandidates?.[0],
          terminal: {
            title: input.currentVersion.title,
            body: input.currentVersion.body,
            conversionHook: input.currentVersion.conversionHook ?? '',
            revisionId: input.currentVersion.id,
          },
        })
      : null;
  const platform = input.resultEditPlatform
    ? { sourcePlatform: input.resultEditPlatform }
    : {};

  if (
    input.selected?.copyWorksurface &&
    input.contentPackage &&
    input.currentVersion
  ) {
    return {
      ...input.selected.copyWorksurface,
      baseRevisionId: input.currentVersion.id,
      packageId: input.contentPackage.id,
      ...platform,
      document: {
        body: terminalCalibration?.body ?? input.currentVersion.body,
        conversionHook:
          terminalCalibration?.conversionHook ??
          input.currentVersion.conversionHook ??
          '',
        orderedAssetIds: [...input.currentVersion.orderedAssetIds],
        title: terminalCalibration?.title ?? input.currentVersion.title,
        topics: [...input.currentVersion.topics],
      },
      lifecycle: 'adopted',
      platformPreviews: platformPreviewsFromContentPackage(
        input.contentPackage
      ),
    };
  }

  if (!input.contentPackage) return input.selected?.copyWorksurface;
  if (!input.currentVersion) return undefined;

  return {
    workId: input.workId,
    baseRevisionId: input.currentVersion.id,
    packageId: input.contentPackage.id,
    ...platform,
    document: {
      body: input.currentVersion.body,
      conversionHook: input.currentVersion.conversionHook ?? '',
      orderedAssetIds: [...input.currentVersion.orderedAssetIds],
      title: input.currentVersion.title,
      topics: [...input.currentVersion.topics],
    },
    alternativeCandidates: input.editVersions
      .filter((version) => version.id !== input.currentVersion?.id)
      .map((version) => ({
        body: version.body,
        candidateId: version.id,
        conversionHook: version.conversionHook ?? '',
        title: version.title,
        topics: [...version.topics],
      })),
    lifecycle:
      input.contentPackage.status === 'accepted' ? 'adopted' : 'candidate',
    platformPreviews: platformPreviewsFromContentPackage(input.contentPackage),
  };
}

export function buildResultImageWorksurface(input: {
  contentPackage?: PublicContentPackage;
  currentPackageVersion?: PackageVersion;
  selected?: ResultCenterLiveSelection | null;
  workId: string;
}): ResultCenterPageProps['imageWorksurface'] {
  if (input.selected?.imageWorksurface && input.currentPackageVersion) {
    return {
      ...input.selected.imageWorksurface,
      adoptedOrderedAssetIds: [...input.currentPackageVersion.orderedAssetIds],
      baseRevisionId: input.currentPackageVersion.id,
      hasContentPackage: true,
      lifecycle: 'adopted',
    };
  }
  if (input.selected?.imageWorksurface) return input.selected.imageWorksurface;
  if (!input.currentPackageVersion || !input.contentPackage) return undefined;

  return imageWorksurfaceFromContentPackage({
    adopted: input.contentPackage.status === 'accepted',
    generated: input.contentPackage.generated,
    version: input.currentPackageVersion,
    workId: input.workId,
  });
}

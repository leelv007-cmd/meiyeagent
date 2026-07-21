/**
 * Result Center live projection adapter.
 *
 * Reads the existing canonical Work / Job / Asset / Content projection and
 * derives page facts for one exact route workId. It never selects a latest
 * work and never creates a parallel Result state.
 */

import type {
  CreativeAssetProjection,
  CreativeContent,
  CreativeJob,
  CreativeWorkbenchProjection,
  CreativeWork,
  ResultWorkspaceKind,
  VideoWorkflowPublicProjection,
} from '@meiye/contracts';

import type { CopyImageTextWorksurfaceFacts } from './copy-image-text-worksurface-model';
import type { ImageWorksurfaceFacts } from './image-worksurface-model';
import type { ResultShellProgressState } from './result-shell-model';
import type { ClientResolverWorkRecord } from './result-target-wiring';
import {
  buildVideoWorksurfaceState,
  type VideoWorksurfaceState,
} from './video/video-worksurface-model';

export type ResultCenterLiveSelection = {
  work: CreativeWork;
  job: CreativeJob | null;
  assets: CreativeAssetProjection[];
  contents: CreativeContent[];
  workspaceKind: ResultWorkspaceKind;
  progressState: ResultShellProgressState;
  hasUsableCandidate: boolean;
  hasAdoptedCandidate: boolean;
  copyWorksurface?: CopyImageTextWorksurfaceFacts;
  imageWorksurface?: Omit<
    ImageWorksurfaceFacts,
    'workingSelection' | 'explicitMode'
  >;
  videoAsset?: CreativeAssetProjection;
};

export type ResultCenterLiveProjection = {
  resolverWorks: ClientResolverWorkRecord[];
  selected: ResultCenterLiveSelection | null;
};

/** Operations returns ContentPackages in updatedAt DESC order. */
export function latestContentPackageForWork<
  TPackage extends { source: { workId?: string } },
>(packages: TPackage[] | undefined, workId: string) {
  return packages?.find((candidate) => candidate.source.workId === workId);
}

function workspaceKindForWork(work: CreativeWork): ResultWorkspaceKind {
  switch (work.operation) {
    case 'image.generate':
    case 'image.edit':
      return 'image';
    case 'video.generate':
      return 'video';
    case 'copy.generate':
    case 'copy.adapt':
    case 'audio.speech':
    case 'audio.sfx':
    case undefined:
      return 'copy';
    default: {
      const _exhaustive: never = work.operation;
      return _exhaustive;
    }
  }
}

function latestJobForWork(
  projection: CreativeWorkbenchProjection,
  work: CreativeWork
): CreativeJob | null {
  const jobs = projection.jobs.filter((job) => job.workId === work.id);
  const current = work.currentJobId
    ? jobs.find((job) => job.id === work.currentJobId)
    : undefined;
  if (current) return current;
  return (
    [...jobs].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )[0] ?? null
  );
}

function progressFor(
  work: CreativeWork,
  job: CreativeJob | null
): ResultShellProgressState {
  switch (job?.status) {
    case 'submitting':
      return 'waiting';
    case 'running':
      return 'running';
    case 'recoverable':
    case 'unknown':
      return 'suspended';
    case 'completed':
      return 'success';
    case 'failed':
      return 'failed';
    case undefined:
      break;
  }

  switch (work.status) {
    case 'draft':
      return 'waiting';
    case 'running':
      return 'running';
    case 'completed':
    case 'accepted':
      return 'success';
    case 'failed':
      return 'failed';
    default: {
      const _exhaustive: never = work.status;
      return _exhaustive;
    }
  }
}

function resolverWorksFromProjection(
  projection: CreativeWorkbenchProjection
): ClientResolverWorkRecord[] {
  return projection.works.map((work) => {
    const contents = projection.contents.filter(
      (content) => content.workId === work.id
    );
    const assets = projection.assets.filter(
      (asset) => asset.workId === work.id
    );
    return {
      workId: work.id,
      workspaceId: work.workspaceId,
      contentIds: contents.map((content) => content.id),
      versionIdsByContentId: Object.fromEntries(
        contents.map((content) => [content.id, []])
      ),
      allowedFocusKeys: assets.map((asset) => asset.id),
      origin: 'native',
    };
  });
}

function candidateLifecycle(
  contents: readonly CreativeContent[]
): 'candidate' | 'adopted' {
  return contents.length > 0 ? 'adopted' : 'candidate';
}

function copyFacts(input: {
  work: CreativeWork;
  job: CreativeJob | null;
  assets: CreativeAssetProjection[];
  contents: CreativeContent[];
}): CopyImageTextWorksurfaceFacts | undefined {
  const textAssets = input.assets.filter((asset) => asset.kind === 'text');
  const selected =
    textAssets.find((asset) => asset.id === input.job?.recommendedAssetId) ??
    textAssets[0];
  if (!selected) return undefined;

  return {
    workId: input.work.id,
    baseRevisionId: input.contents[0]?.id ?? input.job?.id ?? input.work.id,
    document: {
      title: selected.title,
      body: selected.body ?? '',
      conversionHook: selected.conversionHook ?? '',
      topics: [],
      orderedAssetIds: input.assets
        .filter((asset) => asset.kind === 'image')
        .map((asset) => asset.id),
    },
    lifecycle: candidateLifecycle(input.contents),
  };
}

function imageFacts(input: {
  work: CreativeWork;
  job: CreativeJob | null;
  assets: CreativeAssetProjection[];
  contents: CreativeContent[];
}): ResultCenterLiveSelection['imageWorksurface'] | undefined {
  const images = input.assets.filter((asset) => asset.kind === 'image');
  if (images.length === 0) return undefined;
  const adoptedAssetIds = new Set(
    input.contents.flatMap((content) => content.assetIds)
  );
  const baseRevisionId =
    input.contents[0]?.id ?? input.job?.id ?? input.work.id;
  const savedSelection = input.work.workingSelectionDraft;
  return {
    workId: input.work.id,
    baseRevisionId,
    outputType: images.length >= 2 ? 'ordered_image_set' : 'single_image',
    slot: images.length >= 2 ? 'gallery' : 'standalone',
    lifecycle: candidateLifecycle(input.contents),
    candidates: images.map((asset, index) => ({
      assetId: asset.id,
      ...(asset.ownedAssetId
        ? { previewUrl: `/v1/assets/${asset.ownedAssetId}` }
        : {}),
      persisted: Boolean(asset.ownedAssetId || asset.objectKey),
      rightsOk: true,
      generationOk: true,
      recipeOrder: index + 1,
    })),
    focusedAssetId: input.job?.recommendedAssetId ?? images[0]?.id,
    hasContentPackage: input.contents.length > 0,
    adoptedOrderedAssetIds: images
      .filter((asset) => adoptedAssetIds.has(asset.id))
      .map((asset) => asset.id),
    mediaVersionReady: images.every((asset) =>
      Boolean(asset.ownedAssetId || asset.objectKey)
    ),
    ...(savedSelection?.baseRevisionId === baseRevisionId
      ? {
          workingSelection: {
            workId: input.work.id,
            baseRevisionId: savedSelection.baseRevisionId,
            orderedAssetIds: [...savedSelection.orderedAssetIds],
            coverAssetId: savedSelection.coverAssetId,
            removedAssetIds: [],
            updatedAt: savedSelection.savedAt,
            surfaceVersion: savedSelection.surfaceVersion,
          },
        }
      : {}),
  };
}

export function projectResultCenterLiveProjection(
  projection: CreativeWorkbenchProjection,
  workId: string
): ResultCenterLiveProjection {
  const resolverWorks = resolverWorksFromProjection(projection);
  const work = projection.works.find((candidate) => candidate.id === workId);
  if (!work) return { resolverWorks, selected: null };

  const job = latestJobForWork(projection, work);
  const assets = projection.assets.filter(
    (asset) => asset.workId === work.id && (!job || asset.jobId === job.id)
  );
  const contents = projection.contents.filter(
    (content) => content.workId === work.id
  );
  const workspaceKind = workspaceKindForWork(work);
  const common = { work, job, assets, contents };

  return {
    resolverWorks,
    selected: {
      ...common,
      workspaceKind,
      progressState: progressFor(work, job),
      hasUsableCandidate: assets.length > 0,
      hasAdoptedCandidate: contents.length > 0,
      ...(workspaceKind === 'copy'
        ? { copyWorksurface: copyFacts(common) }
        : {}),
      ...(workspaceKind === 'image'
        ? { imageWorksurface: imageFacts(common) }
        : {}),
      ...(workspaceKind === 'video'
        ? { videoAsset: assets.find((asset) => asset.kind === 'video') }
        : {}),
    },
  };
}

/** Join the public video workflow with canonical owned Asset facts. */
export function buildLiveVideoWorksurface(
  selection: ResultCenterLiveSelection,
  workflow: VideoWorkflowPublicProjection | null | undefined
): VideoWorksurfaceState | undefined {
  if (selection.workspaceKind !== 'video' || !workflow) return undefined;
  if (workflow.workId && workflow.workId !== selection.work.id) {
    return undefined;
  }
  const videoAsset = selection.videoAsset;
  const content = selection.contents[0];
  const baseRevisionId = content?.id ?? selection.job?.id ?? selection.work.id;

  return buildVideoWorksurfaceState({
    workId: selection.work.id,
    workflow,
    baseRevisionId,
    ...(content ? { contentId: content.id, versionId: content.id } : {}),
    ...(videoAsset ? { selectedObjectId: videoAsset.id } : {}),
    composedCandidate: videoAsset
      ? {
          assetId: videoAsset.id,
          playableUrl: `/v1/assets/${videoAsset.ownedAssetId ?? videoAsset.id}`,
          durationSeconds: selection.job?.contract.durationSeconds ?? 0,
        }
      : null,
    adoption: content
      ? {
          status: 'adopted',
          contentPackageId: content.id,
          contentRevision: 1,
          composedAssetId: videoAsset?.id ?? null,
          adoptedAt: content.acceptedAt ?? content.createdAt,
        }
      : { status: videoAsset ? 'candidate_ready' : 'none' },
  });
}

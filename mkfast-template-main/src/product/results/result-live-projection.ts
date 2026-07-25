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
  PublicContentPackage,
  ResultWorkspaceKind,
  VideoWorkflowPublicProjection,
} from '@meiye/contracts';

import type {
  CopyImageTextWorksurfaceFacts,
  CopyPreviewCarrier,
  FactSourceItem,
  PlatformPreviewVariant,
} from './copy-image-text-worksurface-model';
import type { ImageWorksurfaceFacts } from './image-worksurface-model';
import type {
  RevisionTimelineFacts,
  RevisionTimelineVersionFact,
} from './result-revision-timeline-model';
import type { ResultRunDetailFacts } from './result-run-detail-model';
import type { ResultShellProgressState } from './result-shell-model';
import type { ClientResolverWorkRecord } from './result-target-wiring';
import {
  buildVideoWorksurfaceState,
  type VideoWorksurfaceState,
} from './video/video-worksurface-model';
import { formatMerchantSupportReference } from './merchant-support-reference';
import type { ResultShellPhase } from '@meiye/contracts';

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

/** Stable client-side marker for detecting an asynchronously refreshed package. */
export function contentPackageRefreshToken(
  contentPackage:
    | Pick<PublicContentPackage, 'id' | 'revision' | 'updatedAt'>
    | undefined
) {
  return contentPackage
    ? `${contentPackage.id}:${contentPackage.revision}:${contentPackage.updatedAt}`
    : null;
}

export function resultContentPackageMutationFacts(
  contentPackage:
    | Pick<
        PublicContentPackage,
        'currentVersionId' | 'harnessSelection' | 'status' | 'variants'
      >
    | undefined
) {
  const hasCanonicalAdoption =
    Boolean(contentPackage?.currentVersionId) &&
    (contentPackage?.harnessSelection
      ? Boolean(contentPackage.harnessSelection.adoptedCandidateId)
      : contentPackage?.status === 'accepted' ||
        contentPackage?.status === 'export_failed');
  return {
    hasAdoptedCandidate: hasCanonicalAdoption,
    hasDeliverableVariant:
      hasCanonicalAdoption && Boolean(contentPackage?.variants.length),
  };
}

/**
 * Only expose a platform preview after the canonical ContentPackage records
 * the server-produced copy.adapt output. Acceptance seed shells are export
 * scaffolding, not a platform rewrite.
 */
export function platformPreviewsFromContentPackage(
  contentPackage: Pick<PublicContentPackage, 'variants'> | undefined
): PlatformPreviewVariant[] {
  return (contentPackage?.variants ?? []).flatMap((variant) => {
    const current = variant.versions.find(
      (version) => version.id === variant.currentVersionId
    );
    if (
      !current ||
      (current.source !== 'ai_generated' &&
        current.source !== 'merchant_edited')
    ) {
      return [];
    }
    return [
      {
        carrier: variant.platform as CopyPreviewCarrier,
        title: current.title,
        body: current.body,
        conversionHook: current.conversionHook ?? '',
        topics: [...current.topics],
        source: 'copy.adapt' as const,
      },
    ];
  });
}

function workspaceKindForWork(work: CreativeWork): ResultWorkspaceKind {
  switch (work.operation) {
    case 'image.generate':
    case 'image.edit':
    case 'image.reference_transform':
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

/**
 * Fact Sources for the current revision only: projects/prices actually
 * referenced by intent, grounding assets used as materials, identity, and
 * rights. Unused catalog rows never enter the drawer.
 */
export function factSourcesFromGroundingSnapshot(
  work: CreativeWork,
  job: CreativeJob | null,
  options?: {
    contentPackageRights?: PublicContentPackage['rights'];
    referencedAssetIds?: readonly string[];
  }
): FactSourceItem[] {
  const items: FactSourceItem[] = [];
  const grounding = job?.groundingSnapshot;
  const store = grounding?.store;

  if (store && job) {
    const namedProjects = store.projects.filter((project) =>
      work.intent.includes(project.name)
    );
    const projects =
      namedProjects.length > 0
        ? namedProjects
        : store.projects.length === 1
          ? store.projects
          : [];
    for (const project of projects) {
      if (!Number.isFinite(project.price) || project.price < 0) continue;
      items.push({
        id: `grounding:${job.id}:project:${project.id}:price`,
        kind: 'price',
        label: `${project.name}价格`,
        summary: `${project.price} 元 · ${store.name}已确认`,
        status: 'confirmed',
        sourceRef: `grounding:${job.id}:project:${project.id}`,
      });
    }

    items.push({
      id: `grounding:${job.id}:identity:store`,
      kind: 'identity',
      label: '门店身份',
      summary: `${store.name} · ${store.city}${store.district}`,
      status: 'confirmed',
      sourceRef: `grounding:${job.id}:store`,
    });

    const referenced = new Set(options?.referencedAssetIds ?? []);
    const usedAssets =
      referenced.size > 0
        ? grounding.assets.filter((asset) => referenced.has(asset.id))
        : grounding.assets.filter((asset) =>
            work.sourceReferences.some((ref) => ref.id === asset.id)
          );
    for (const asset of usedAssets) {
      const categoryLabel =
        asset.category === 'customer_case'
          ? '顾客案例素材'
          : asset.category === 'before_after'
            ? '前后对比素材'
            : asset.category === 'price_list'
              ? '价目素材'
              : asset.category === 'store'
                ? '门店实拍'
                : '授权素材';
      items.push({
        id: `grounding:${job.id}:asset:${asset.id}`,
        kind: asset.category === 'customer_case' ? 'customer_case' : 'material',
        label: categoryLabel,
        summary:
          asset.consentScope === 'public_marketing'
            ? '已授权公开营销使用'
            : asset.consentScope === 'paid_advertising'
              ? '已授权付费投放使用'
              : '仅限内部使用',
        status:
          asset.authorizationStatus === 'authorized' ? 'confirmed' : 'pending',
        sourceRef: `grounding:${job.id}:asset:${asset.id}`,
      });
    }

    if (grounding.qualification?.confirmed) {
      items.push({
        id: `grounding:${job.id}:credential`,
        kind: 'credential',
        label: '门店资质',
        summary: grounding.qualification.admitted
          ? '资质已确认，可用于合规宣发'
          : '资质待补全',
        status: grounding.qualification.admitted ? 'confirmed' : 'pending',
        sourceRef: `grounding:${job.id}:qualification`,
      });
    }
  }

  const rights = options?.contentPackageRights;
  if (rights) {
    items.push({
      id: 'content-package:rights',
      kind: 'rights',
      label: '内容权利',
      summary:
        rights.state === 'authorized'
          ? '当前版本授权有效，可继续交付'
          : '授权已撤回，仅可审计查看历史版本',
      status: rights.state === 'authorized' ? 'confirmed' : 'pending',
      sourceRef: 'content-package:rights',
    });
  }

  return items;
}

/** Project revision timeline facts from a public ContentPackage version list. */
export function revisionTimelineFactsFromContentPackage(
  contentPackage:
    | Pick<PublicContentPackage, 'currentVersionId' | 'versions'>
    | null
    | undefined
): RevisionTimelineFacts {
  if (!contentPackage) return { versions: [] };
  const versions: RevisionTimelineVersionFact[] = contentPackage.versions.map(
    (version) => ({
      versionId: version.id,
      title: version.title,
      createdAt: version.createdAt,
      ...(version.source ? { source: version.source } : {}),
      ...(version.derivedFromVersionId
        ? { derivedFromVersionId: version.derivedFromVersionId }
        : {}),
      // createdBy is an internal id — never pass through as operator label.
    })
  );
  return {
    ...(contentPackage.currentVersionId
      ? { currentVersionId: contentPackage.currentVersionId }
      : {}),
    versions,
  };
}

/** Project Run Detail facts from the exact Work/Job without tech leaks. */
export function runDetailFactsFromLiveSelection(input: {
  workId: string;
  phase: ResultShellPhase;
  progressState?: ResultShellProgressState;
  job: CreativeJob | null;
  workspaceKind?: 'copy' | 'image' | 'video';
}): ResultRunDetailFacts {
  const provenance = input.job?.executionProvenance;
  return {
    phase: input.phase,
    ...(input.progressState ? { progressState: input.progressState } : {}),
    jobStatus: input.job?.status ?? 'none',
    ...(provenance?.modelDisplayName
      ? { modelDisplayName: provenance.modelDisplayName }
      : {}),
    ...(input.job?.productUsageQuantity !== undefined
      ? { productUsageQuantity: input.job.productUsageQuantity }
      : {}),
    ...(input.job?.failureCode ? { failureCode: input.job.failureCode } : {}),
    ...(input.job?.recoveredAt ? { recoveredAt: input.job.recoveredAt } : {}),
    supportReference: formatMerchantSupportReference(input.workId),
    ...(input.workspaceKind ? { workspaceKind: input.workspaceKind } : {}),
  };
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
    factSources: factSourcesFromGroundingSnapshot(input.work, input.job),
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
      ...(asset.objectKey
        ? {
            previewUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(asset.objectKey)}`,
          }
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
  const composedCandidate = videoAsset?.objectKey
    ? {
        assetId: videoAsset.id,
        playableUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(videoAsset.objectKey)}`,
        durationSeconds: selection.job?.contract.durationSeconds ?? 0,
      }
    : null;

  return buildVideoWorksurfaceState({
    workId: selection.work.id,
    workflow,
    baseRevisionId,
    ...(content ? { contentId: content.id, versionId: content.id } : {}),
    ...(videoAsset ? { selectedObjectId: videoAsset.id } : {}),
    composedCandidate,
    adoption: content
      ? {
          status: 'adopted',
          contentPackageId: content.id,
          contentRevision: 1,
          composedAssetId: videoAsset?.id ?? null,
          adoptedAt: content.acceptedAt ?? content.createdAt,
        }
      : { status: composedCandidate ? 'candidate_ready' : 'none' },
  });
}

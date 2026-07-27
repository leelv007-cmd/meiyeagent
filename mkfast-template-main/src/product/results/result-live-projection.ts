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
  WorkflowState,
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
import type {
  ResultShellDeliveryAttemptState,
  ResultShellProgressState,
} from './result-shell-model';
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

export function resultWorkflowIdForWork<
  TPackage extends { source: { workId?: string; workflowId?: string } },
>(packages: TPackage[] | undefined, workId: string) {
  return latestContentPackageForWork(packages, workId)?.source.workflowId ?? '';
}

export function resultHarnessStreamLifecycle(input: {
  hasCanonicalVersion: boolean;
  latestProgressState?: WorkflowState;
  projectedProgressState?: ResultShellProgressState;
  workflowState?: WorkflowState;
}) {
  const streamTerminal =
    input.hasCanonicalVersion ||
    input.workflowState === 'failed' ||
    input.workflowState === 'success' ||
    input.projectedProgressState === 'failed' ||
    input.projectedProgressState === 'success';
  const progressState = input.hasCanonicalVersion
    ? ('success' as const)
    : input.workflowState === 'failed'
      ? ('failed' as const)
      : input.workflowState === 'success'
        ? ('success' as const)
        : input.projectedProgressState;
  return {
    progressState,
    streamActive:
      !streamTerminal &&
      (progressState === 'running' ||
        progressState === 'waiting' ||
        input.latestProgressState === 'running' ||
        input.latestProgressState === 'waiting'),
  };
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

/** Charset `create_creative_work` accepts for a creative session id. */
const CREATIVE_SESSION_ID = /^[A-Za-z0-9._:-]{1,160}$/u;

/**
 * The session id 「基于此再创作」 may carry.
 *
 * A Composer-created Work does not have one that core would take back: the
 * submission coordinator writes the Work row itself with
 * `composer:<surfaceId>:<surfaceId>@<revision>`, and the `@` in a surface
 * revision id is outside the charset `create_creative_work` enforces. Forwarding
 * the Work's own sessionId therefore failed with INVALID_CREATIVE_SESSION on
 * exactly the 作品 the button is offered on — the derive never happened, so the
 * lineage it was supposed to write never existed either. A re-creation is its
 * own session, so mint a stable one from the Work when the inherited one cannot
 * be used.
 */
export function resultDeriveSessionId(work: {
  id: string;
  sessionId?: string;
}): string {
  const inherited = work.sessionId?.trim() ?? '';
  if (CREATIVE_SESSION_ID.test(inherited)) return inherited;
  return `result-derive:${work.id}`
    .replace(/[^A-Za-z0-9._:-]/gu, '-')
    .slice(0, 160);
}

/**
 * The platform (and exact platform version) the page is currently acting on.
 * Absent means the whole package — the pre-W09 reading.
 */
export type ResultDeliveryScope = {
  platform?: PublicContentPackage['exportReceipts'][number]['platform'] | null;
  variantVersionId?: string;
};

/** Does this delivery row belong to the platform the page is looking at? */
function inDeliveryScope(
  row: { platform: string; variantVersionId: string },
  scope: ResultDeliveryScope | undefined
) {
  if (!scope?.platform) return true;
  if (row.platform !== scope.platform) return false;
  return (
    scope.variantVersionId === undefined ||
    row.variantVersionId === scope.variantVersionId
  );
}

/**
 * Which delivery attempt state this package is in (W09).
 *
 * `ResultShellFacts.deliveryAttempt` has driven the shell's partial / failed /
 * awaiting-approval branches since WT-D, and the page never supplied it — so
 * those branches were unreachable and a half-delivered package looked finished.
 * Derived only from canonical package facts; it is not a second Result status.
 *
 * Read whole-package it also lies the other way round: one platform published
 * makes every platform read 已交付, so a merchant standing on the 抖音 tab of a
 * package that published on 小红书 and failed on 抖音 was told the failed
 * delivery was done. A delivery is per platform version, so the answer is too.
 */
export function resultDeliveryAttemptState(
  contentPackage:
    | Pick<
        PublicContentPackage,
        'approvalRequests' | 'deliveryEvents' | 'exportReceipts' | 'status'
      >
    | undefined,
  scope?: ResultDeliveryScope
): ResultShellDeliveryAttemptState {
  if (!contentPackage) return 'none';
  const events = (contentPackage.deliveryEvents ?? []).filter((event) =>
    inDeliveryScope(event, scope)
  );
  const published = events.some(
    (event) =>
      (event.type === 'manual_publish_result' ||
        event.type === 'automatic_publish_result') &&
      event.status === 'published'
  );
  if (published) return 'delivered';

  const publishFailed = events.some(
    (event) =>
      (event.type === 'manual_publish_result' ||
        event.type === 'automatic_publish_result') &&
      event.status === 'failed'
  );
  const failedExports = contentPackage.exportReceipts.filter(
    (receipt) => receipt.status === 'failed' && inDeliveryScope(receipt, scope)
  );
  // `export_failed` is a package-wide status with no platform on it. Once the
  // page is standing on one platform, only that platform's receipts may speak
  // for it — otherwise another platform's failure follows the merchant around.
  const exportFailed =
    failedExports.length > 0 ||
    (!scope?.platform && contentPackage.status === 'export_failed');
  if (publishFailed || exportFailed) return 'failed';

  if (
    (contentPackage.approvalRequests ?? []).some(
      (request) =>
        request.status === 'pending' && inDeliveryScope(request, scope)
    )
  ) {
    return 'awaiting_approval';
  }

  // Materials went out and nothing came back: honest 未完成, not 已交付.
  const handedOff = events.some(
    (event) =>
      event.type === 'assisted_handoff_prepared' ||
      event.type === 'legacy_handoff_event'
  );
  return handedOff ? 'partial' : 'none';
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

/**
 * ContentPackage fallback for the 图文 worksurface.
 *
 * `imageFacts` above reads the CreativeAsset rows of
 * `operations.creative_workbench`, and the ContentPackage seam does not write
 * them — so a 图文 run delivered through the new seam left Result Center on
 * 「等待图片候选…」 while its own status already read 可发布, with no way to
 * reach the pages it had just produced. The copy worksurface has carried a
 * package-shaped fallback for exactly that reason (`results_/$workId.tsx`);
 * this is the same fallback for images.
 *
 * Undefined when the package names no images: an empty gallery is a state the
 * surface must keep showing honestly, not one to fabricate around.
 */
export function imageWorksurfaceFromContentPackage(input: {
  adopted: boolean;
  generated: {
    assetIds: readonly string[];
    ownedAssets?: readonly {
      id: string;
      objectKey: string;
      sourceAssetId?: string;
    }[];
  };
  version: { id: string; orderedAssetIds: readonly string[] };
  workId: string;
}): ResultCenterLiveSelection['imageWorksurface'] | undefined {
  const orderedAssetIds =
    input.version.orderedAssetIds.length > 0
      ? input.version.orderedAssetIds
      : input.generated.assetIds;
  if (orderedAssetIds.length === 0) return undefined;
  const owned = orderedAssetIds.map((assetId) =>
    input.generated.ownedAssets?.find(
      (asset) => asset.sourceAssetId === assetId || asset.id === assetId
    )
  );
  return {
    workId: input.workId,
    baseRevisionId: input.version.id,
    outputType:
      orderedAssetIds.length >= 2 ? 'ordered_image_set' : 'single_image',
    slot: orderedAssetIds.length >= 2 ? 'gallery' : 'standalone',
    lifecycle: input.adopted ? 'adopted' : 'candidate',
    candidates: orderedAssetIds.map((assetId, index) => ({
      assetId,
      ...(owned[index]
        ? {
            previewUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(owned[index].objectKey)}`,
          }
        : {}),
      persisted: Boolean(owned[index]),
      rightsOk: true,
      generationOk: true,
      recipeOrder: index + 1,
    })),
    focusedAssetId: orderedAssetIds[0],
    hasContentPackage: true,
    adoptedOrderedAssetIds: input.adopted ? [...orderedAssetIds] : [],
    mediaVersionReady: owned.every(Boolean),
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

/** Project a model-native single-call video directly from its ContentPackage. */
export function buildNativeVideoWorksurface(
  selection: ResultCenterLiveSelection,
  contentPackage: PublicContentPackage | undefined
): VideoWorksurfaceState | undefined {
  if (selection.workspaceKind !== 'video' || contentPackage?.kind !== 'video') {
    return undefined;
  }
  const version = contentPackage.versions.find(
    (candidate) => candidate.id === contentPackage.currentVersionId
  );
  const asset = contentPackage.generated.ownedAssets
    ?.filter((candidate) => candidate.contentType === 'video/mp4')
    .at(-1);
  const run = contentPackage.generated.childRuns.find((candidate) =>
    (candidate.assetIds ?? []).some((assetId) => assetId === asset?.id)
  );
  const catalogModelId =
    run?.actualCatalogModelId ?? selection.job?.contract.catalogModelId;
  if (!version || !asset || !run || !catalogModelId) return undefined;

  return buildVideoWorksurfaceState({
    workId: selection.work.id,
    workflow: {
      workflowId: run.runId,
      workId: selection.work.id,
      status: 'completed',
      storyboardVersion: Math.max(1, contentPackage.revision),
      storyboardRevision: version.id,
      catalogModelId,
      confirmed: true,
      shots: [
        {
          shotId: version.id,
          promptPreview: version.body,
          candidatesPerShot: 1,
          selectedCandidateIndex: 0,
          candidateCount: 1,
        },
      ],
      revision: contentPackage.revision,
      updatedAt: contentPackage.updatedAt,
    },
    baseRevisionId: version.id,
    contentId: contentPackage.id,
    versionId: version.id,
    selectedObjectId: asset.id,
    composedCandidate: {
      assetId: asset.id,
      playableUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(asset.objectKey)}`,
      durationSeconds: selection.job?.contract.durationSeconds ?? 0,
    },
    adoption: {
      status:
        contentPackage.status === 'accepted' ? 'adopted' : 'candidate_ready',
      contentPackageId: contentPackage.id,
      contentRevision: contentPackage.revision,
      composedAssetId: asset.id,
      adoptedAt:
        contentPackage.status === 'accepted' ? contentPackage.updatedAt : null,
    },
  });
}

import type {
  Asset,
  ContentItem,
  CreativeAssetProjection,
  CreativeContent,
  CreativeJob,
  CreativeWork,
} from '@meiye/contracts';
import {
  canonical_canvas_image_generation,
  canonical_history_canvas_work_detail,
  canonical_history_content_detail,
  canonical_history_generated_asset_detail,
  canonical_history_session_detail,
  canonical_history_session_title,
  canonical_history_untitled_asset,
  canonical_media_kind_audio,
  canonical_media_kind_image,
  canonical_media_kind_text,
  canonical_media_kind_video,
  creative_object_mode_agent,
  creative_object_mode_direct,
  p1_admin_model_operation_copy,
  p1_admin_model_operation_image_edit,
  p1_admin_model_operation_image_generate,
  p1_admin_model_operation_video,
  p1_canvas_asset_source_ai,
  p1_canvas_asset_source_real,
  p1_canvas_authorization_authorized,
  p1_canvas_authorization_blocked,
  p1_canvas_authorization_pending,
  p1_canvas_authorization_withdrawn,
  p1_task_status_archived,
  p1_task_status_blocked,
  p1_task_status_done,
  p1_task_status_in_progress,
  p1_task_status_needs_asset,
  p1_task_status_needs_review,
  p1_task_status_ready,
  p1_task_status_todo,
} from '@/locale/paraglide/messages';
import { taskView, type RawTask } from '@/p1/operations-view-model';
import { productStatusView } from '@/lib/uiux/status';
import type { ComposedVideoTaskEnvelope } from './async-task-center-model';
import { creativeOutputLabel } from './creative-quote';
import { canvasName } from '@/p1/canvas-name';
import {
  creativeWorkDisplay,
  type CreativeWorkTemplateDisplay,
} from './creative-work-display';
import { assetAuthorizationPresentation } from './canonical-asset-governance-model';

export interface RawCanvasWork {
  id: string;
  name: string;
  templateId?: string;
  templateVersionId?: string;
  currentRevisionId: string;
  brandWatermarkEnabled: boolean;
  aigcLabelEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  revisions: Array<{
    id: string;
    revision: number;
    document: Record<string, unknown>;
    templateVersionId?: string;
    createdAt?: string;
  }>;
}

export type RawCanvasWorkSummary = Omit<RawCanvasWork, 'revisions'> & {
  revisions: Array<Omit<RawCanvasWork['revisions'][number], 'document'>>;
};

export interface RawCanonicalHistory {
  assets: CreativeAssetProjection[];
  canvasWorks: RawCanvasWorkSummary[];
  contents: CreativeContent[];
  creativeWorks: CreativeWork[];
  exportReceipts: Array<{
    id: string;
    workId: string;
    workRevisionId: string;
    objectKey: string;
    sha256: string;
    bytes: number;
    format: string;
    createdAt: string;
  }>;
  imageJobs: Array<{
    id: string;
    origin:
      | { kind: 'layout_work'; id: string; revisionId: string }
      | { kind: 'advanced_canvas'; id: string; revisionId: string };
    requestedModelId: string;
    actualModelId: string;
    status: string;
    outputAssetId?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  jobs: CreativeJob[];
  pageInfo?: {
    limit: number;
    offset: number;
    totals: Record<string, number>;
  };
  sessions: Array<{
    id: string;
    workIds: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  tasks: RawTask[];
}

export type CanonicalHistoryKind =
  | 'session'
  | 'work'
  | 'job'
  | 'asset'
  | 'content'
  | 'task';

export interface CanonicalHistoryItem {
  id: string;
  kind: CanonicalHistoryKind;
  title: string;
  detail: string;
  href: string;
  updatedAt: string;
  media?: CanonicalMediaProjection[];
}

export interface CanonicalMediaProjection {
  assetId: string;
  href: string;
  kind: 'image' | 'video';
  src: string;
  title: string;
}

export interface CanonicalLegacyContentDetail {
  assetIds: string[];
  body: string;
  id: string;
  productStatus?: ContentItem['status'];
  source: 'creative_content' | 'product_content_item';
  title: string;
}

function byRecent(left: CanonicalHistoryItem, right: CanonicalHistoryItem) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function operationLabel(operation: CreativeJob['contract']['operation']) {
  if (operation.startsWith('copy.')) return p1_admin_model_operation_copy();
  if (operation === 'image.edit') return p1_admin_model_operation_image_edit();
  if (operation === 'image.generate') {
    return p1_admin_model_operation_image_generate();
  }
  return p1_admin_model_operation_video();
}

function taskStatusLabel(status: RawTask['status']) {
  if (status === 'archived') return p1_task_status_archived();
  if (status === 'blocked') return p1_task_status_blocked();
  if (status === 'done') return p1_task_status_done();
  if (status === 'in_progress') return p1_task_status_in_progress();
  if (status === 'needs_asset') return p1_task_status_needs_asset();
  if (status === 'needs_review') return p1_task_status_needs_review();
  if (status === 'ready') return p1_task_status_ready();
  return p1_task_status_todo();
}

function productAssetMediaLabel(mediaType: Asset['mediaType']) {
  if (mediaType === 'audio') return canonical_media_kind_audio();
  return mediaType === 'video'
    ? canonical_media_kind_video()
    : canonical_media_kind_image();
}

function productAssetSourceLabel(sourceType: Asset['sourceType']) {
  return sourceType === 'ai_generated'
    ? p1_canvas_asset_source_ai()
    : p1_canvas_asset_source_real();
}

function productAssetAuthorizationLabel(asset: Asset) {
  return {
    authorized: p1_canvas_authorization_authorized,
    blocked: p1_canvas_authorization_blocked,
    pending: p1_canvas_authorization_pending,
    withdrawn: p1_canvas_authorization_withdrawn,
  }[assetAuthorizationPresentation(asset).status]();
}

function generatedMedia(
  asset: CreativeAssetProjection,
  productAssets: Asset[]
): CanonicalMediaProjection | undefined {
  if (asset.kind !== 'image' && asset.kind !== 'video') return undefined;
  const ownedAsset = productAssets.find(
    (item) => item.id === asset.ownedAssetId || item.id === asset.id
  );
  const objectKey = asset.objectKey ?? ownedAsset?.objectKey;
  if (!objectKey) return undefined;
  return {
    assetId: asset.id,
    href: `/dashboard/assets/${encodeURIComponent(asset.id)}`,
    kind: asset.kind,
    src: `/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`,
    title: asset.title,
  };
}

function uploadedMedia(asset: Asset): CanonicalMediaProjection {
  if (asset.mediaType === 'audio') {
    throw new Error('Audio assets do not use the visual media projection.');
  }
  return {
    assetId: asset.id,
    href: `/dashboard/assets/${encodeURIComponent(asset.id)}`,
    kind: asset.mediaType,
    src: `/api/storage/file?key=${encodeURIComponent(asset.objectKey)}`,
    title:
      asset.tags[0] ??
      canonical_history_untitled_asset({
        kind: productAssetMediaLabel(asset.mediaType),
      }),
  };
}

function canonicalMediaMap(
  creativeAssets: CreativeAssetProjection[],
  productAssets: Asset[]
) {
  const media = new Map<string, CanonicalMediaProjection>();
  for (const asset of creativeAssets) {
    const projection = generatedMedia(asset, productAssets);
    if (!projection) continue;
    media.set(asset.id, projection);
    if (asset.ownedAssetId) media.set(asset.ownedAssetId, projection);
  }
  for (const asset of productAssets) {
    if (asset.mediaType !== 'audio' && !media.has(asset.id)) {
      media.set(asset.id, uploadedMedia(asset));
    }
  }
  return media;
}

function mediaForIds(
  media: Map<string, CanonicalMediaProjection>,
  ids: string[]
) {
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    const projection = media.get(id);
    if (!projection || seen.has(projection.assetId)) return [];
    seen.add(projection.assetId);
    return [projection];
  });
}

export function canonicalLegacyContentDetail(
  creativeContents: CreativeContent[],
  productContents: ContentItem[],
  contentId: string
): CanonicalLegacyContentDetail | undefined {
  const creative = creativeContents.find((item) => item.id === contentId);
  if (creative) {
    return {
      assetIds: [...creative.assetIds],
      body: creative.body,
      id: creative.id,
      source: 'creative_content',
      title: creative.title,
    };
  }

  const product = productContents.find((item) => item.id === contentId);
  if (!product) return undefined;
  const currentVersion = product.variants
    .flatMap((variant) => variant.versions)
    .find((version) =>
      product.variants.some(
        (variant) => variant.currentVersionId === version.id
      )
    );
  return {
    assetIds: [...product.assetIds],
    body: currentVersion?.body ?? '',
    id: product.id,
    productStatus: product.status,
    source: 'product_content_item',
    title: currentVersion?.title ?? product.scenario,
  };
}

export function canonicalMediaForAssetIds(
  creativeAssets: CreativeAssetProjection[],
  productAssets: Asset[],
  assetIds: string[]
) {
  return mediaForIds(
    canonicalMediaMap(creativeAssets, productAssets),
    assetIds
  );
}

export function composedVideoCanonicalAssets(
  envelopes: readonly ComposedVideoTaskEnvelope[]
): CreativeAssetProjection[] {
  const seenAssetIds = new Set<string>();
  return envelopes
    .flatMap((envelope): CreativeAssetProjection[] => {
      const { job, workflow } = envelope;
      const asset = workflow.composedAsset;
      if (
        workflow.status !== 'completed' ||
        !workflow.workId ||
        !job ||
        !asset?.id ||
        !asset.sha256 ||
        asset.contentType !== 'video/mp4' ||
        asset.technicalValidation?.playable !== true ||
        seenAssetIds.has(asset.id)
      ) {
        return [];
      }
      seenAssetIds.add(asset.id);
      return [
        {
          contentType: 'video/mp4',
          createdAt: workflow.updatedAt,
          id: asset.id,
          jobId: job.jobId,
          kind: 'video',
          objectKey: asset.objectKey,
          ownedAssetId: asset.id,
          sha256: asset.sha256,
          title: `${p1_admin_model_operation_video()} · V${workflow.storyboardVersion}`,
          workId: workflow.workId,
          workspaceId: workflow.workspaceId,
        },
      ];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function canonicalHistoryWithComposedVideos(
  history: RawCanonicalHistory,
  envelopes: readonly ComposedVideoTaskEnvelope[]
): RawCanonicalHistory {
  const knownAssetIds = new Set(
    history.assets.flatMap((asset) =>
      asset.ownedAssetId ? [asset.id, asset.ownedAssetId] : [asset.id]
    )
  );
  const additions = composedVideoCanonicalAssets(envelopes).filter((asset) => {
    if (knownAssetIds.has(asset.id)) return false;
    knownAssetIds.add(asset.id);
    return true;
  });
  if (additions.length === 0) return history;
  return {
    ...history,
    assets: [...history.assets, ...additions],
  };
}

export function canonicalHistoryItems(
  history: RawCanonicalHistory,
  productAssets: Asset[] = [],
  templates: CreativeWorkTemplateDisplay[] = [],
  catalogLoaded = false
): CanonicalHistoryItem[] {
  const media = canonicalMediaMap(history.assets, productAssets);
  return [
    ...history.sessions.map(
      (session): CanonicalHistoryItem => ({
        detail: canonical_history_session_detail({
          count: session.workIds.length,
        }),
        href: `/dashboard/sessions/${session.id}`,
        id: session.id,
        kind: 'session',
        title: canonical_history_session_title(),
        updatedAt: session.updatedAt,
      })
    ),
    ...history.creativeWorks.map((work): CanonicalHistoryItem => {
      const display = creativeWorkDisplay(work, templates, catalogLoaded);
      const workMedia = mediaForIds(
        media,
        history.assets
          .filter((asset) => asset.workId === work.id)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .map((asset) => asset.id)
      );
      return {
        detail: `${
          work.mode === 'agent'
            ? creative_object_mode_agent()
            : creative_object_mode_direct()
        } · ${productStatusView(work.status).label}`,
        href: `/dashboard/works/${work.id}`,
        id: work.id,
        kind: 'work',
        ...(workMedia.length > 0 ? { media: workMedia } : {}),
        title: display.title,
        updatedAt: work.updatedAt,
      };
    }),
    ...history.canvasWorks.map(
      (work): CanonicalHistoryItem => ({
        detail: canonical_history_canvas_work_detail({
          count: work.revisions.length,
        }),
        href: `/dashboard/works/${work.id}`,
        id: work.id,
        kind: 'work',
        title: canvasName(work.name),
        updatedAt: work.updatedAt,
      })
    ),
    ...history.jobs.map((job): CanonicalHistoryItem => {
      const jobMedia = mediaForIds(media, job.outputAssetIds);
      return {
        detail: `${operationLabel(job.contract.operation)} · ${
          productStatusView(job.status).label
        }`,
        href: `/dashboard/jobs/${job.id}`,
        id: job.id,
        kind: 'job',
        ...(jobMedia.length > 0 ? { media: jobMedia } : {}),
        title: creativeOutputLabel(
          job.contract.operation,
          job.contract.outputCount,
          job.contract.aspectRatio
        ),
        updatedAt: job.updatedAt,
      };
    }),
    ...history.imageJobs.map(
      (job): CanonicalHistoryItem => ({
        detail: productStatusView(job.status).label,
        href: `/dashboard/jobs/${job.id}`,
        id: job.id,
        kind: 'job',
        ...(job.outputAssetId && media.get(job.outputAssetId)
          ? { media: [media.get(job.outputAssetId)!] }
          : {}),
        title: canonical_canvas_image_generation(),
        updatedAt: job.updatedAt,
      })
    ),
    ...history.assets.map(
      (asset): CanonicalHistoryItem => ({
        detail: canonical_history_generated_asset_detail({
          kind:
            asset.kind === 'video'
              ? canonical_media_kind_video()
              : asset.kind === 'image'
                ? canonical_media_kind_image()
                : canonical_media_kind_text(),
        }),
        href: `/dashboard/assets/${asset.id}`,
        id: asset.id,
        kind: 'asset',
        ...(media.get(asset.id) ? { media: [media.get(asset.id)!] } : {}),
        title: asset.title,
        updatedAt: asset.createdAt,
      })
    ),
    ...history.contents.map((content): CanonicalHistoryItem => {
      const contentMedia = mediaForIds(media, content.assetIds);
      return {
        detail: canonical_history_content_detail({
          count: content.assetIds.length,
        }),
        href: `/dashboard/content/${content.id}`,
        id: content.id,
        kind: 'content',
        ...(contentMedia.length > 0 ? { media: contentMedia } : {}),
        title: content.title,
        updatedAt: content.acceptedAt ?? content.createdAt,
      };
    }),
    ...history.tasks.map(
      (task): CanonicalHistoryItem => ({
        detail: `${taskView(task).sourceLabel} · ${taskStatusLabel(task.status)}`,
        href: `/dashboard/tasks/${task.id}`,
        id: task.id,
        kind: 'task',
        title: taskView(task).title,
        updatedAt: task.createdAt,
      })
    ),
  ].sort(byRecent);
}

export function canonicalAssetItems(
  history: RawCanonicalHistory,
  productAssets: Asset[]
): CanonicalHistoryItem[] {
  const persistedMediaIds = new Set(
    history.assets.flatMap((asset) =>
      asset.ownedAssetId ? [asset.id, asset.ownedAssetId] : [asset.id]
    )
  );
  return [
    ...canonicalHistoryItems(history, productAssets).filter(
      (item) => item.kind === 'asset'
    ),
    ...productAssets
      .filter((asset) => !persistedMediaIds.has(asset.id))
      .map(
        (asset): CanonicalHistoryItem => ({
          detail: `${productAssetSourceLabel(asset.sourceType)} · ${productAssetAuthorizationLabel(asset)}`,
          href: `/dashboard/assets/${asset.id}`,
          id: asset.id,
          kind: 'asset',
          ...(asset.mediaType === 'audio'
            ? {}
            : { media: [uploadedMedia(asset)] }),
          title:
            asset.tags[0] ??
            canonical_history_untitled_asset({
              kind: productAssetMediaLabel(asset.mediaType),
            }),
          updatedAt: asset.createdAt,
        })
      ),
  ].sort(byRecent);
}

export function queryCanonicalHistory(
  items: CanonicalHistoryItem[],
  query: string
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    [item.id, item.kind, item.title, item.detail].some((value) =>
      value.toLocaleLowerCase().includes(normalized)
    )
  );
}

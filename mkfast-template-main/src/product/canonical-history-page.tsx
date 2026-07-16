import { DashboardHeader } from '@/components/layout/dashboard-header';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { ObjectEvidence } from '@/components/uiux/object-evidence';
import { ProductStatus } from '@/components/uiux/product-status';
import { StatePanel } from '@/components/uiux/state-panel';
import { WarmEmptyState } from '@/components/uiux/warm-empty-state';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  canonical_asset_detail_description,
  canonical_asset_detail_title,
  canonical_asset_generation_relation,
  canonical_asset_loading_description,
  canonical_asset_loading_title,
  canonical_asset_not_found_description,
  canonical_asset_not_found_title,
  canonical_asset_persisted_relation,
  canonical_asset_persisted_title,
  canonical_asset_source_generation,
  canonical_asset_source_upload,
  canonical_asset_type,
  canonical_canvas_image_generation,
  canonical_canvas_job_asset_relation,
  canonical_canvas_job_description,
  canonical_canvas_job_loading_description,
  canonical_canvas_job_loading_title,
  canonical_canvas_job_model_fixed,
  canonical_canvas_job_not_found_description,
  canonical_canvas_job_not_found_title,
  canonical_canvas_job_source,
  canonical_canvas_job_title,
  canonical_canvas_job_work_relation,
  canonical_content_asset_count,
  canonical_content_body_empty,
  canonical_content_detail_description,
  canonical_content_detail_title,
  canonical_content_loading_description,
  canonical_content_loading_title,
  canonical_content_not_found_description,
  canonical_content_not_found_title,
  canonical_content_source_accepted_asset,
  canonical_content_source_product,
  canonical_history_assets_description,
  canonical_history_assets_empty_description,
  canonical_history_assets_empty_store_action,
  canonical_history_assets_empty_title,
  canonical_history_assets_empty_upload_action,
  canonical_history_empty_description,
  canonical_history_empty_title,
  canonical_history_error_description,
  canonical_history_error_title,
  canonical_history_jobs_description,
  canonical_history_jobs_title,
  canonical_history_kind_asset,
  canonical_history_kind_content,
  canonical_history_kind_job,
  canonical_history_kind_session,
  canonical_history_kind_task,
  canonical_history_kind_work,
  canonical_history_loading_description,
  canonical_history_loading_title,
  canonical_history_navigation_aria,
  canonical_history_navigation_jobs,
  canonical_history_navigation_recent,
  canonical_history_navigation_search,
  canonical_history_navigation_works,
  canonical_history_open_object,
  canonical_history_recent_description,
  canonical_history_recent_title,
  canonical_history_retry,
  canonical_history_search_description,
  canonical_history_search_label,
  canonical_history_search_placeholder,
  canonical_history_search_title,
  canonical_history_session_title,
  canonical_history_sessions_description,
  canonical_history_untitled_asset,
  canonical_history_untitled_material,
  canonical_history_works_description,
  canonical_history_works_title,
  canonical_media_kind_image,
  canonical_media_kind_video,
  content_package_legacy_read_only,
  product_navigation_assets,
  product_navigation_content,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { getLocale, localeConfig } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { operationsQuery } from '@/p1/client';
import { templateViews } from '@/p1/operations-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import { useProductState } from '@/product/client';
import { useQuery } from '@tanstack/react-query';
import { IconPhoto } from '@tabler/icons-react';
import { useMemo } from 'react';
import {
  canonicalAssetItems,
  canonicalLegacyContentDetail,
  canonicalHistoryWithComposedVideos,
  canonicalHistoryItems,
  canonicalMediaForAssetIds,
  queryCanonicalHistory,
  type CanonicalHistoryItem,
  type CanonicalHistoryKind,
  type CanonicalLegacyContentDetail,
  type CanonicalMediaProjection,
  type RawCanonicalHistory,
} from './canonical-history-model';
import { CanonicalMediaGallery } from './canonical-media-gallery';
import type { CreationCatalogResponse } from './creation-catalog-model';
import { useVideoWorkflowListObserver } from './creative-job-observer';
import {
  CanonicalAssetCapture,
  CanonicalAssetGovernance,
} from './canonical-asset-actions';

type CanonicalHistoryMode =
  | 'recent'
  | 'search'
  | 'assets'
  | 'sessions'
  | 'works'
  | 'jobs';

const copy: Record<
  CanonicalHistoryMode,
  {
    description: () => string;
    title: () => string;
    kind?: CanonicalHistoryKind;
  }
> = {
  assets: {
    description: canonical_history_assets_description,
    kind: 'asset',
    title: product_navigation_assets,
  },
  jobs: {
    description: canonical_history_jobs_description,
    kind: 'job',
    title: canonical_history_jobs_title,
  },
  recent: {
    description: canonical_history_recent_description,
    title: canonical_history_recent_title,
  },
  search: {
    description: canonical_history_search_description,
    title: canonical_history_search_title,
  },
  sessions: {
    description: canonical_history_sessions_description,
    kind: 'session',
    title: canonical_history_session_title,
  },
  works: {
    description: canonical_history_works_description,
    kind: 'work',
    title: canonical_history_works_title,
  },
};

const HISTORY_KIND_LABELS: Record<CanonicalHistoryKind, () => string> = {
  asset: canonical_history_kind_asset,
  content: canonical_history_kind_content,
  job: canonical_history_kind_job,
  session: canonical_history_kind_session,
  task: canonical_history_kind_task,
  work: canonical_history_kind_work,
};

const HISTORY_NAVIGATION_CLASS = buttonVariants({
  className:
    'text-muted-foreground hover:bg-surface-1 aria-[current=page]:bg-surface-1 aria-[current=page]:text-foreground',
  variant: 'ghost',
});

function historyItemTitle(item: CanonicalHistoryItem) {
  if (item.kind !== 'asset') return item.title;

  for (const kind of [
    canonical_media_kind_image(),
    canonical_media_kind_video(),
  ]) {
    if (item.title === canonical_history_untitled_asset({ kind })) {
      return canonical_history_untitled_material({ kind });
    }
  }

  return item.title;
}

function CanonicalHistoryList({
  items,
  mode,
  hasStore,
}: {
  items: CanonicalHistoryItem[];
  mode: CanonicalHistoryMode;
  hasStore: boolean;
}) {
  if (items.length === 0) {
    if (mode === 'assets') {
      return (
        <WarmEmptyState
          action={
            hasStore ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  document.getElementById('canonical-asset-upload')?.click()
                }
              >
                {canonical_history_assets_empty_upload_action()}
              </Button>
            ) : (
              <a
                className={buttonVariants()}
                href={getPathWithLocale(Routes.StoreProfile)}
              >
                {canonical_history_assets_empty_store_action()}
              </a>
            )
          }
          description={canonical_history_assets_empty_description()}
          media={<IconPhoto />}
          title={canonical_history_assets_empty_title()}
        />
      );
    }

    return (
      <WarmEmptyState
        action={
          <a
            className={buttonVariants()}
            href={getPathWithLocale(Routes.Dashboard)}
          >
            {product_navigation_workbench()}
          </a>
        }
        description={canonical_history_empty_description()}
        media={<IconPhoto />}
        title={canonical_history_empty_title()}
      />
    );
  }
  return (
    <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          <article className="meiye-porcelain group flex h-full flex-col overflow-hidden rounded-2xl">
            {item.media ? (
              <CanonicalMediaGallery
                className="gap-0 [&>*]:rounded-none"
                media={item.media.slice(0, 1)}
                showMeta={false}
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex aspect-10/7 items-center justify-center bg-muted text-muted-foreground"
              >
                <IconPhoto className="size-10 opacity-50" />
              </div>
            )}
            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <Badge variant="outline">
                    {HISTORY_KIND_LABELS[item.kind]()}
                  </Badge>
                  <h3 className="meiye-type-body line-clamp-2 font-semibold">
                    {historyItemTitle(item)}
                  </h3>
                </div>
                <time className="meiye-type-aux shrink-0">
                  {new Date(item.updatedAt).toLocaleDateString(
                    localeConfig[getLocale()].hreflang
                  )}
                </time>
              </div>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
              <a
                className="mt-auto inline-flex min-h-touch-target items-center font-medium text-primary underline-offset-4 hover:underline"
                href={getPathWithLocale(item.href)}
              >
                {canonical_history_open_object()}
              </a>
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}

export function CanonicalHistoryPage({
  mode,
  searchQuery = '',
  onSearchQueryChange,
}: {
  mode: CanonicalHistoryMode;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}) {
  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  const creationCatalogQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creation_catalog'),
    queryFn: ({ signal }) =>
      operationsQuery<CreationCatalogResponse>('creation_catalog', {}, signal),
  });
  const videoWorkflowsQuery = useVideoWorkflowListObserver();
  const product = useProductState();
  const page = copy[mode];
  const templates = useMemo(
    () =>
      templateViews(
        creationCatalogQuery.data?.templates ?? [],
        creationCatalogQuery.data?.userTemplates ?? [],
        creationCatalogQuery.data?.shortcuts ?? []
      ),
    [creationCatalogQuery.data]
  );
  const items = useMemo(() => {
    if (!historyQuery.data) return [];
    const projectedHistory = canonicalHistoryWithComposedVideos(
      historyQuery.data,
      videoWorkflowsQuery.data ?? []
    );
    const all =
      mode === 'assets'
        ? canonicalAssetItems(projectedHistory, product.state?.assets ?? [])
        : canonicalHistoryItems(
            projectedHistory,
            product.state?.assets ?? [],
            templates,
            Boolean(creationCatalogQuery.data)
          );
    const scoped = page.kind
      ? all.filter((item) => item.kind === page.kind)
      : all;
    return mode === 'search'
      ? queryCanonicalHistory(scoped, searchQuery)
      : scoped;
  }, [
    creationCatalogQuery.data,
    historyQuery.data,
    mode,
    page.kind,
    product.state?.assets,
    searchQuery,
    templates,
    videoWorkflowsQuery.data,
  ]);

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_workbench(), isCurrentPage: false },
          { label: page.title(), isCurrentPage: true },
        ]}
      />
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 px-4 py-4 lg:gap-6 lg:px-6 lg:py-6">
          <div>
            <h1 className="hidden meiye-type-body font-semibold md:block">
              {page.title()}
            </h1>
            <p className="meiye-type-aux mt-1">{page.description()}</p>
          </div>
          <nav
            aria-label={canonical_history_navigation_aria()}
            className="flex flex-wrap gap-2"
          >
            <a
              aria-current={mode === 'recent' ? 'page' : undefined}
              className={HISTORY_NAVIGATION_CLASS}
              href={getPathWithLocale('/dashboard/recent')}
            >
              {canonical_history_navigation_recent()}
            </a>
            <a
              aria-current={mode === 'search' ? 'page' : undefined}
              className={HISTORY_NAVIGATION_CLASS}
              href={getPathWithLocale('/dashboard/search')}
            >
              {canonical_history_navigation_search()}
            </a>
            <a
              aria-current={mode === 'works' ? 'page' : undefined}
              className={HISTORY_NAVIGATION_CLASS}
              href={getPathWithLocale('/dashboard/works')}
            >
              {canonical_history_navigation_works()}
            </a>
            <a
              aria-current={mode === 'jobs' ? 'page' : undefined}
              className={HISTORY_NAVIGATION_CLASS}
              href={getPathWithLocale('/dashboard/jobs')}
            >
              {canonical_history_navigation_jobs()}
            </a>
          </nav>
          {mode === 'assets' ? (
            <CanonicalAssetCapture product={product} />
          ) : null}
          {mode === 'search' ? (
            <label
              className="grid max-w-xl gap-1.5 text-sm font-medium"
              htmlFor="canonical-history-search"
            >
              {canonical_history_search_label()}
              <Input
                id="canonical-history-search"
                aria-label={canonical_history_search_label()}
                autoFocus
                placeholder={canonical_history_search_placeholder()}
                value={searchQuery}
                onChange={(event) => onSearchQueryChange?.(event.target.value)}
              />
            </label>
          ) : null}
          {historyQuery.isLoading ||
          creationCatalogQuery.isLoading ||
          videoWorkflowsQuery.isLoading ||
          (mode === 'assets' && product.loading) ? (
            <StatePanel
              kind="loading"
              title={canonical_history_loading_title()}
              description={canonical_history_loading_description()}
            />
          ) : null}
          {historyQuery.isError || videoWorkflowsQuery.isError ? (
            <StatePanel
              kind="error"
              title={canonical_history_error_title()}
              description={canonical_history_error_description()}
              actionLabel={canonical_history_retry()}
              onAction={() => {
                void historyQuery.refetch();
                void creationCatalogQuery.refetch();
                void videoWorkflowsQuery.refetch();
              }}
            />
          ) : null}
          {historyQuery.isSuccess &&
          videoWorkflowsQuery.isSuccess &&
          (mode !== 'assets' || (!product.loading && product.state)) ? (
            <CanonicalHistoryList
              hasStore={Boolean(product.state?.store)}
              items={items}
              mode={mode}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

export function CanonicalAssetDetailPage({ assetId }: { assetId: string }) {
  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  const videoWorkflowsQuery = useVideoWorkflowListObserver();
  const product = useProductState();
  const projectedHistory = historyQuery.data
    ? canonicalHistoryWithComposedVideos(
        historyQuery.data,
        videoWorkflowsQuery.data ?? []
      )
    : undefined;
  const creative = projectedHistory?.assets.find((item) => item.id === assetId);
  const persisted = product.state?.assets.find(
    (item) => item.id === assetId || item.id === creative?.ownedAssetId
  );
  const item = creative ?? persisted;
  const media = projectedHistory
    ? canonicalMediaForAssetIds(
        projectedHistory.assets,
        product.state?.assets ?? [],
        [creative?.id ?? persisted?.id ?? assetId]
      )
    : [];

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: product_navigation_assets(), isCurrentPage: false },
        { label: canonical_asset_detail_title(), isCurrentPage: true },
      ]}
      description={canonical_asset_detail_description()}
      title={canonical_asset_detail_title()}
    >
      {historyQuery.isLoading ||
      videoWorkflowsQuery.isLoading ||
      product.loading ? (
        <StatePanel
          kind="loading"
          title={canonical_asset_loading_title()}
          description={canonical_asset_loading_description()}
        />
      ) : null}
      {historyQuery.isError || videoWorkflowsQuery.isError ? (
        <StatePanel
          kind="error"
          title={canonical_history_error_title()}
          description={canonical_history_error_description()}
          actionLabel={canonical_history_retry()}
          onAction={() => {
            void historyQuery.refetch();
            void videoWorkflowsQuery.refetch();
          }}
        />
      ) : null}
      {!item &&
      !historyQuery.isLoading &&
      !videoWorkflowsQuery.isLoading &&
      !historyQuery.isError &&
      !videoWorkflowsQuery.isError &&
      !product.loading ? (
        <StatePanel
          kind="empty"
          title={canonical_asset_not_found_title()}
          description={canonical_asset_not_found_description()}
        />
      ) : null}
      {item ? (
        <article
          className="meiye-porcelain overflow-hidden rounded-2xl"
          data-source-highlight="true"
        >
          <CanonicalMediaGallery media={media} presentation="hero" />
          <div className="space-y-3 p-5 text-sm sm:p-6">
            <ObjectEvidence
              id={creative?.id ?? persisted!.id}
              kind="Asset"
              source={
                creative
                  ? canonical_asset_source_generation()
                  : canonical_asset_source_upload()
              }
            />
            <h2 className="text-lg font-semibold leading-7">
              {creative?.title ??
                persisted?.tags[0] ??
                canonical_asset_persisted_title()}
            </h2>
            <p>
              {canonical_asset_type({
                type: creative?.kind ?? persisted?.mediaType ?? '',
              })}
            </p>
            {creative?.jobId ? (
              <p>{canonical_asset_generation_relation()}</p>
            ) : null}
            {creative?.ownedAssetId ? (
              <p>{canonical_asset_persisted_relation()}</p>
            ) : null}
            {persisted ? (
              <div className="border-t border-divider pt-4">
                <CanonicalAssetGovernance asset={persisted} product={product} />
              </div>
            ) : null}
          </div>
        </article>
      ) : null}
    </DashboardLayout>
  );
}

export function CanonicalLegacyContentCard({
  detail,
  media,
}: {
  detail: CanonicalLegacyContentDetail;
  media: CanonicalMediaProjection[];
}) {
  return (
    <article className="meiye-porcelain overflow-hidden rounded-2xl">
      {media.length > 0 ? (
        <CanonicalMediaGallery media={media} presentation="hero" />
      ) : null}
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <ObjectEvidence
            id={detail.id}
            kind="Content"
            source={
              detail.source === 'creative_content'
                ? canonical_content_source_accepted_asset()
                : canonical_content_source_product()
            }
          />
          <Badge variant="outline">{content_package_legacy_read_only()}</Badge>
        </div>
        <h2 className="text-lg font-semibold leading-7">{detail.title}</h2>
        <p className="whitespace-pre-wrap text-sm leading-6">
          {detail.body || canonical_content_body_empty()}
        </p>
        {detail.source === 'creative_content' ? (
          <p className="text-sm text-muted-foreground">
            {canonical_content_asset_count({
              count: detail.assetIds.length,
            })}
          </p>
        ) : null}
        {detail.productStatus ? (
          <ProductStatus status={detail.productStatus} />
        ) : null}
      </div>
    </article>
  );
}

export function CanonicalContentDetailPage({
  contentId,
}: {
  contentId: string;
}) {
  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  const product = useProductState();
  const detail = canonicalLegacyContentDetail(
    historyQuery.data?.contents ?? [],
    product.state?.contents ?? [],
    contentId
  );
  const media =
    historyQuery.data && detail
      ? canonicalMediaForAssetIds(
          historyQuery.data.assets,
          product.state?.assets ?? [],
          detail.assetIds
        )
      : [];

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: product_navigation_content(), isCurrentPage: false },
        { label: canonical_content_detail_title(), isCurrentPage: true },
      ]}
      description={canonical_content_detail_description()}
      title={canonical_content_detail_title()}
    >
      {historyQuery.isLoading || product.loading ? (
        <StatePanel
          kind="loading"
          title={canonical_content_loading_title()}
          description={canonical_content_loading_description()}
        />
      ) : null}
      {!detail && !historyQuery.isLoading && !product.loading ? (
        <StatePanel
          kind="empty"
          title={canonical_content_not_found_title()}
          description={canonical_content_not_found_description()}
        />
      ) : null}
      {detail ? (
        <CanonicalLegacyContentCard detail={detail} media={media} />
      ) : null}
    </DashboardLayout>
  );
}

export function CanvasImageJobDetailPage({ jobId }: { jobId: string }) {
  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  const product = useProductState();
  const job = historyQuery.data?.imageJobs.find((item) => item.id === jobId);
  const media =
    historyQuery.data && job?.outputAssetId
      ? canonicalMediaForAssetIds(
          historyQuery.data.assets,
          product.state?.assets ?? [],
          [job.outputAssetId]
        )
      : [];

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: canonical_history_jobs_title(), isCurrentPage: false },
        { label: canonical_canvas_job_title(), isCurrentPage: true },
      ]}
      description={canonical_canvas_job_description()}
      title={canonical_canvas_job_title()}
    >
      {historyQuery.isLoading || product.loading ? (
        <StatePanel
          kind="loading"
          title={canonical_canvas_job_loading_title()}
          description={canonical_canvas_job_loading_description()}
        />
      ) : null}
      {!job && historyQuery.data ? (
        <StatePanel
          kind="empty"
          title={canonical_canvas_job_not_found_title()}
          description={canonical_canvas_job_not_found_description()}
        />
      ) : null}
      {job ? (
        <article className="meiye-porcelain overflow-hidden rounded-2xl">
          {media.length > 0 ? (
            <CanonicalMediaGallery media={media} presentation="hero" />
          ) : null}
          <div className="space-y-3 p-5 text-sm sm:p-6">
            <ObjectEvidence
              id={job.id}
              kind="Job"
              source={canonical_canvas_job_source()}
            />
            <h2 className="text-lg font-semibold leading-7">
              {canonical_canvas_image_generation()}
            </h2>
            <ProductStatus status={job.status} />
            <p>{canonical_canvas_job_model_fixed()}</p>
            <p>{canonical_canvas_job_work_relation()}</p>
            {job.outputAssetId ? (
              <p>{canonical_canvas_job_asset_relation()}</p>
            ) : null}
          </div>
        </article>
      ) : null}
    </DashboardLayout>
  );
}

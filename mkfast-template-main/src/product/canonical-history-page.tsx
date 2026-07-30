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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  canonical_history_conversation_delete_action,
  canonical_history_conversation_delete_cancel,
  canonical_history_conversation_delete_confirm,
  canonical_history_conversation_delete_description,
  canonical_history_conversation_delete_error,
  canonical_history_conversation_delete_pending,
  canonical_history_conversation_delete_title,
  canonical_history_empty_description,
  canonical_history_empty_title,
  canonical_history_error_description,
  canonical_history_error_title,
  canonical_history_jobs_title,
  canonical_history_kind_asset,
  canonical_history_kind_content,
  canonical_history_kind_task,
  canonical_history_loading_description,
  canonical_history_loading_title,
  canonical_history_navigation_recent,
  canonical_history_navigation_search,
  canonical_history_open_object,
  canonical_history_recent_title,
  canonical_history_retry,
  canonical_history_search_title,
  canonical_history_untitled_asset,
  canonical_history_untitled_material,
  canonical_media_kind_image,
  canonical_media_kind_video,
  content_package_legacy_read_only,
  legacy_projection_canvas_job_description,
  legacy_projection_canvas_job_loading_description,
  legacy_projection_canvas_job_loading_title,
  legacy_projection_canvas_job_material_relation,
  legacy_projection_canvas_job_not_found_description,
  legacy_projection_canvas_job_not_found_title,
  legacy_projection_canvas_job_readonly_notice,
  legacy_projection_canvas_job_source,
  legacy_projection_canvas_job_title,
  legacy_projection_canvas_job_work_relation,
  legacy_projection_delivery_syncing,
  legacy_projection_history_content_detail,
  legacy_projection_history_jobs_description,
  legacy_projection_history_jobs_readonly_notice,
  legacy_projection_history_navigation_aria,
  legacy_projection_history_recent_description,
  legacy_projection_history_search_description,
  legacy_projection_history_search_label,
  legacy_projection_history_search_placeholder,
  legacy_projection_history_sessions_description,
  legacy_projection_history_works_description,
  legacy_projection_kind_job,
  legacy_projection_kind_session,
  legacy_projection_kind_work,
  legacy_projection_open_package,
  product_navigation_assets,
  product_navigation_content,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { getLocale, localeConfig } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { operationsCommand, operationsQuery } from '@/p1/client';
import { templateViews } from '@/p1/operations-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import { useProductState } from '@/product/client';
import { TrustedReturnAnchor } from '@/product/trusted-return';
import { useQuery } from '@tanstack/react-query';
import { IconPhoto, IconTrash } from '@tabler/icons-react';
import { type ReactNode, useMemo, useState } from 'react';
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
import { assetBusinessTitle } from './canonical-asset-governance-model';
import {
  contentPackageProjectionState,
  creativeWorkProjectionState,
  legacyRecordProjectionState,
  type ContentPackageProjection,
  type LegacyContentPackageState,
} from './legacy-content-package-projection';

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
    description: legacy_projection_history_jobs_description,
    kind: 'job',
    // Deep-link title uses ContentPackage semantics (ADR-0011 / D07).
    title: product_navigation_content,
  },
  recent: {
    description: legacy_projection_history_recent_description,
    title: canonical_history_recent_title,
  },
  search: {
    description: legacy_projection_history_search_description,
    title: canonical_history_search_title,
  },
  sessions: {
    description: legacy_projection_history_sessions_description,
    kind: 'session',
    title: product_navigation_content,
  },
  works: {
    description: legacy_projection_history_works_description,
    kind: 'work',
    title: product_navigation_content,
  },
};

const HISTORY_KIND_LABELS: Record<CanonicalHistoryKind, () => string> = {
  asset: canonical_history_kind_asset,
  content: canonical_history_kind_content,
  job: legacy_projection_kind_job,
  session: legacy_projection_kind_session,
  task: canonical_history_kind_task,
  work: legacy_projection_kind_work,
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

function historyItemProjectionState(
  item: CanonicalHistoryItem,
  history: RawCanonicalHistory,
  contentPackages: readonly ContentPackageProjection[]
): LegacyContentPackageState | undefined {
  if (item.kind === 'work') {
    const work = history.creativeWorks.find(
      (candidate) => candidate.id === item.id
    );
    return work
      ? creativeWorkProjectionState(work, history.jobs, contentPackages)
      : legacyRecordProjectionState();
  }

  if (item.kind === 'job') {
    const job = history.jobs.find((candidate) => candidate.id === item.id);
    const work = job
      ? history.creativeWorks.find((candidate) => candidate.id === job.workId)
      : undefined;
    return work
      ? creativeWorkProjectionState(work, history.jobs, contentPackages)
      : legacyRecordProjectionState();
  }

  if (item.kind !== 'session') return undefined;
  const session = history.sessions.find(
    (candidate) => candidate.id === item.id
  );
  const workIds = new Set(session?.workIds ?? []);
  const works = history.creativeWorks.filter(
    (work) => work.sessionId === item.id || workIds.has(work.id)
  );
  const states = works.map((work) =>
    creativeWorkProjectionState(work, history.jobs, contentPackages)
  );
  const contentPackage = states
    .flatMap((state) =>
      state.kind === 'content_package' ? [state.contentPackage] : []
    )
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.revision - left.revision ||
        right.id.localeCompare(left.id)
    )[0];
  if (contentPackage) return contentPackageProjectionState(contentPackage);
  if (states.length > 0 && states.every((state) => state.kind === 'draft')) {
    return states[0];
  }
  return legacyRecordProjectionState();
}

export function CanonicalHistoryList({
  items,
  mode,
  hasStore,
  history,
  contentPackages,
  contentPackagesSynchronizing = false,
}: {
  contentPackages: readonly ContentPackageProjection[];
  contentPackagesSynchronizing?: boolean;
  items: CanonicalHistoryItem[];
  mode: CanonicalHistoryMode;
  hasStore: boolean;
  history: RawCanonicalHistory;
}) {
  const [conversationToDelete, setConversationToDelete] = useState<
    string | null
  >(null);
  const [deletedConversationIds, setDeletedConversationIds] = useState(
    () => new Set<string>()
  );
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const visibleItems = items.filter(
    (item) => item.kind !== 'session' || !deletedConversationIds.has(item.id)
  );

  const confirmConversationDelete = async () => {
    if (!conversationToDelete || deletePending) return;
    const conversationId = conversationToDelete;
    setDeletePending(true);
    setDeleteError(false);
    try {
      await operationsCommand('delete_composer_conversation', {
        conversationId,
      });
      setDeletedConversationIds((current) => {
        const next = new Set(current);
        next.add(conversationId);
        return next;
      });
      setConversationToDelete(null);
    } catch {
      setDeleteError(true);
    } finally {
      setDeletePending(false);
    }
  };

  if (visibleItems.length === 0) {
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
      {visibleItems.map((item) => {
        const projection = historyItemProjectionState(
          item,
          history,
          contentPackages
        );
        const content =
          item.kind === 'content'
            ? history.contents.find((candidate) => candidate.id === item.id)
            : undefined;
        const detail =
          contentPackagesSynchronizing && projection?.kind === 'legacy'
            ? legacy_projection_delivery_syncing()
            : projection
              ? projection.label
              : content
                ? legacy_projection_history_content_detail({
                    count: content.assetIds.length,
                  })
                : item.detail;
        const href =
          projection?.kind === 'content_package'
            ? `/dashboard/content?packageId=${encodeURIComponent(projection.contentPackage.id)}`
            : item.href;
        return (
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
                <p className="text-sm text-muted-foreground">{detail}</p>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <a
                    className="inline-flex min-h-touch-target items-center font-medium text-primary underline-offset-4 hover:underline"
                    href={getPathWithLocale(href)}
                  >
                    {projection?.kind === 'content_package'
                      ? legacy_projection_open_package()
                      : canonical_history_open_object()}
                  </a>
                  {mode === 'recent' && item.kind === 'session' ? (
                    <Button
                      aria-label={canonical_history_conversation_delete_action()}
                      onClick={() => {
                        setDeleteError(false);
                        setConversationToDelete(item.id);
                      }}
                      size="icon-sm"
                      title={canonical_history_conversation_delete_action()}
                      type="button"
                      variant="ghost"
                    >
                      <IconTrash aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          </li>
        );
      })}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deletePending) {
            setConversationToDelete(null);
            setDeleteError(false);
          }
        }}
        open={Boolean(conversationToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {canonical_history_conversation_delete_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {canonical_history_conversation_delete_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {canonical_history_conversation_delete_error()}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              {canonical_history_conversation_delete_cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletePending}
              onClick={() => void confirmConversationDelete()}
              variant="destructive"
            >
              {deletePending
                ? canonical_history_conversation_delete_pending()
                : canonical_history_conversation_delete_confirm()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ol>
  );
}

export function CanonicalHistoryNavigation({
  mode,
}: {
  mode: CanonicalHistoryMode;
}) {
  // ADR-0011 / D07: Work/Job/Session are not merchant first-level surfaces.
  // Assets use their own page chrome; legacy object modes hide projection nav.
  if (
    mode === 'assets' ||
    mode === 'works' ||
    mode === 'jobs' ||
    mode === 'sessions'
  ) {
    return null;
  }

  return (
    <nav
      aria-label={legacy_projection_history_navigation_aria()}
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
    </nav>
  );
}

export function CanonicalHistoryPage({
  children,
  mode,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
}: {
  children?: ReactNode;
  mode: CanonicalHistoryMode;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}) {
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const searchQuery = controlledSearchQuery ?? internalSearchQuery;
  const setSearchQuery = onSearchQueryChange ?? setInternalSearchQuery;
  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  const contentPackagesQuery = useQuery({
    enabled: mode !== 'assets',
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<ContentPackageProjection[]>(
        'content_packages',
        {},
        signal
      ),
    retry: false,
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
    if (mode === 'search' || mode === 'assets') {
      return queryCanonicalHistory(scoped, searchQuery);
    }
    return scoped;
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
          <div className="meiye-ambient-copy">
            <h1 className="hidden meiye-type-title md:block">{page.title()}</h1>
            <p className="meiye-type-aux mt-1">{page.description()}</p>
            {/*
             * D-137: the jobs island is a read-only leftover from the previous
             * workflow. Say so in the merchant's words (D-116) instead of
             * leaving her to infer it from the absence of any action. One
             * sentence only — D-137 rules out investing further in this island.
             */}
            {mode === 'jobs' ? (
              <p
                className="meiye-type-aux mt-1"
                data-testid="history-jobs-readonly-notice"
              >
                {legacy_projection_history_jobs_readonly_notice()}
              </p>
            ) : null}
          </div>
          <CanonicalHistoryNavigation mode={mode} />
          {mode === 'assets' ? (
            <CanonicalAssetCapture product={product} />
          ) : null}
          {children}
          {mode === 'search' || mode === 'assets' ? (
            <label
              className="grid max-w-xl gap-1.5 text-sm font-medium"
              htmlFor="canonical-history-search"
            >
              {legacy_projection_history_search_label()}
              <Input
                id="canonical-history-search"
                aria-label={legacy_projection_history_search_label()}
                autoFocus={mode === 'search'}
                data-testid={
                  mode === 'assets' ? 'asset-library-search' : undefined
                }
                placeholder={legacy_projection_history_search_placeholder()}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          ) : null}
          {historyQuery.isLoading ||
          creationCatalogQuery.isLoading ||
          videoWorkflowsQuery.isLoading ||
          (mode !== 'assets' && contentPackagesQuery.isLoading) ||
          (mode === 'assets' && product.loading) ? (
            <StatePanel
              kind="loading"
              title={canonical_history_loading_title()}
              description={canonical_history_loading_description()}
            />
          ) : null}
          {historyQuery.isError ||
          videoWorkflowsQuery.isError ||
          contentPackagesQuery.isError ? (
            <StatePanel
              kind="error"
              title={canonical_history_error_title()}
              description={canonical_history_error_description()}
              actionLabel={canonical_history_retry()}
              onAction={() => {
                void historyQuery.refetch();
                void creationCatalogQuery.refetch();
                void videoWorkflowsQuery.refetch();
                void contentPackagesQuery.refetch();
              }}
            />
          ) : null}
          {historyQuery.isSuccess &&
          videoWorkflowsQuery.isSuccess &&
          (mode === 'assets' || contentPackagesQuery.isSuccess) &&
          (mode !== 'assets' || (!product.loading && product.state)) ? (
            <CanonicalHistoryList
              contentPackages={contentPackagesQuery.data ?? []}
              contentPackagesSynchronizing={contentPackagesQuery.isFetching}
              hasStore={Boolean(product.state?.store)}
              history={historyQuery.data}
              items={items}
              mode={mode}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

export function CanonicalAssetDetailPage({
  assetId,
  returnFrom,
}: {
  assetId: string;
  returnFrom?: unknown;
}) {
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
      <TrustedReturnAnchor from={returnFrom} />
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
              {creative?.title &&
              !/^(asset|image|video|generated)/i.test(creative.title)
                ? creative.title
                : persisted
                  ? (assetBusinessTitle(persisted) ??
                    canonical_asset_persisted_title())
                  : canonical_asset_persisted_title()}
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
  const legacyState = legacyRecordProjectionState();

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: canonical_history_jobs_title(), isCurrentPage: false },
        { label: legacy_projection_canvas_job_title(), isCurrentPage: true },
      ]}
      description={legacy_projection_canvas_job_description()}
      title={legacy_projection_canvas_job_title()}
    >
      {/*
       * D-137: sits above every state — loading, not-found and the record
       * itself — because "this is old and you can only look at it" is true
       * before the data arrives, not a property of the record.
       */}
      <p className="meiye-type-aux" data-testid="canvas-job-readonly-notice">
        {legacy_projection_canvas_job_readonly_notice()}
      </p>
      {historyQuery.isLoading || product.loading ? (
        <StatePanel
          kind="loading"
          title={legacy_projection_canvas_job_loading_title()}
          description={legacy_projection_canvas_job_loading_description()}
        />
      ) : null}
      {!job && historyQuery.data ? (
        <StatePanel
          kind="empty"
          title={legacy_projection_canvas_job_not_found_title()}
          description={legacy_projection_canvas_job_not_found_description()}
        />
      ) : null}
      {job ? (
        <article className="meiye-porcelain overflow-hidden rounded-2xl">
          {media.length > 0 ? (
            <CanonicalMediaGallery media={media} presentation="hero" />
          ) : null}
          <div className="space-y-3 p-5 text-sm sm:p-6">
            <Badge variant="outline">{legacyState.label}</Badge>
            <p className="text-muted-foreground">{legacyState.description}</p>
            <h2 className="text-lg font-semibold leading-7">
              {canonical_canvas_image_generation()}
            </h2>
            <p>{legacy_projection_canvas_job_source()}</p>
            <p>{legacy_projection_canvas_job_work_relation()}</p>
            {job.outputAssetId ? (
              <p>{legacy_projection_canvas_job_material_relation()}</p>
            ) : null}
          </div>
        </article>
      ) : null}
    </DashboardLayout>
  );
}

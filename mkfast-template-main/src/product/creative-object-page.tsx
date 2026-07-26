import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  canonical_history_retry,
  canonical_media_kind_image,
  canonical_media_kind_text,
  canonical_media_kind_video,
  creative_object_derived_version,
  creative_object_mode_direct,
  creative_object_source_count,
  legacy_projection_error_description,
  legacy_projection_error_title,
  legacy_projection_kind_job,
  legacy_projection_kind_work,
  legacy_projection_loading_description,
  legacy_projection_loading_title,
  legacy_projection_mode_agent,
  legacy_projection_not_found_description,
  legacy_projection_not_found_title,
  legacy_projection_open_job,
  legacy_projection_open_package,
  legacy_projection_open_session,
  legacy_projection_open_work,
  legacy_projection_package_results_description,
  legacy_projection_package_results_title,
  legacy_projection_page_job_description,
  legacy_projection_page_job_title,
  legacy_projection_page_session_description,
  legacy_projection_page_session_title,
  legacy_projection_page_work_description,
  legacy_projection_page_work_title,
  legacy_projection_result_count,
  legacy_projection_results_empty,
  legacy_projection_results_title,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { operationsQuery } from '@/p1/client';
import { templateViews } from '@/p1/operations-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import type { TemplateCatalogItemView } from '@/p1/types';
import type {
  CreativeAssetProjection,
  CreativeWorkbenchProjection,
} from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { getPathWithLocale } from '@/lib/urls';
import { CanonicalMediaGallery } from './canonical-media-gallery';
import {
  canonicalMediaForAssetIds,
  composedVideoCanonicalAssets,
} from './canonical-history-model';
import type { CreationCatalogResponse } from './creation-catalog-model';
import { useVideoWorkflowListObserver } from './creative-job-observer';
import { creativeWorkDisplay } from './creative-work-display';
import { creativeOperationLabel, creativeOutputLabel } from './creative-quote';
import {
  creativeWorkProjectionState,
  legacyRecordProjectionState,
  type ContentPackageProjection,
  type LegacyContentPackageState,
} from './legacy-content-package-projection';

type CreativeObjectKind = 'Session' | 'Work' | 'Job';

const pageCopy: Record<
  CreativeObjectKind,
  { description: () => string; title: () => string }
> = {
  Session: {
    description: legacy_projection_page_session_description,
    title: legacy_projection_page_session_title,
  },
  Work: {
    description: legacy_projection_page_work_description,
    title: legacy_projection_page_work_title,
  },
  Job: {
    description: legacy_projection_page_job_description,
    title: legacy_projection_page_job_title,
  },
};

export function CreativeObjectPage({
  id,
  kind,
}: {
  id: string;
  kind: CreativeObjectKind;
}) {
  const query = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
  });
  const creationCatalogQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creation_catalog'),
    queryFn: ({ signal }) =>
      operationsQuery<CreationCatalogResponse>('creation_catalog', {}, signal),
  });
  const contentPackagesQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<ContentPackageProjection[]>(
        'content_packages',
        {},
        signal
      ),
    retry: false,
  });
  const videoWorkflowsQuery = useVideoWorkflowListObserver();
  const templates = templateViews(
    creationCatalogQuery.data?.templates ?? [],
    creationCatalogQuery.data?.userTemplates ?? [],
    creationCatalogQuery.data?.shortcuts ?? []
  );
  const copy = pageCopy[kind];

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: product_navigation_workbench(), isCurrentPage: false },
        { label: copy.title(), isCurrentPage: true },
      ]}
      description={copy.description()}
      title={copy.title()}
    >
      {query.isLoading ||
      creationCatalogQuery.isLoading ||
      contentPackagesQuery.isLoading ||
      videoWorkflowsQuery.isLoading ? (
        <StatePanel
          kind="loading"
          title={legacy_projection_loading_title()}
          description={legacy_projection_loading_description()}
        />
      ) : null}
      {query.isError ||
      contentPackagesQuery.isError ||
      videoWorkflowsQuery.isError ? (
        <StatePanel
          kind="error"
          title={legacy_projection_error_title()}
          description={legacy_projection_error_description()}
          actionLabel={canonical_history_retry()}
          onAction={() => {
            void query.refetch();
            void contentPackagesQuery.refetch();
            void videoWorkflowsQuery.refetch();
          }}
        />
      ) : null}
      {query.data &&
      contentPackagesQuery.data &&
      !videoWorkflowsQuery.isLoading ? (
        <CreativeObjectProjection
          catalogLoaded={Boolean(creationCatalogQuery.data)}
          data={query.data}
          id={id}
          kind={kind}
          composedVideoAssets={composedVideoCanonicalAssets(
            videoWorkflowsQuery.data ?? []
          )}
          contentPackages={contentPackagesQuery.data}
          templates={templates}
        />
      ) : null}
    </DashboardLayout>
  );
}

export function CreativeObjectProjection({
  catalogLoaded,
  composedVideoAssets,
  contentPackages,
  data,
  id,
  kind,
  templates,
}: {
  catalogLoaded: boolean;
  composedVideoAssets: CreativeAssetProjection[];
  contentPackages: ContentPackageProjection[];
  data: CreativeWorkbenchProjection;
  id: string;
  kind: CreativeObjectKind;
  templates: TemplateCatalogItemView[];
}) {
  const works =
    kind === 'Session'
      ? data.works.filter((work) => work.sessionId === id)
      : kind === 'Work'
        ? data.works.filter((work) => work.id === id)
        : data.works.filter((work) =>
            data.jobs.some((job) => job.id === id && job.workId === work.id)
          );
  const workIds = new Set(works.map((work) => work.id));
  const jobs = data.jobs.filter((job) =>
    kind === 'Job' ? job.id === id : workIds.has(job.workId)
  );
  const jobIds = new Set(jobs.map((job) => job.id));
  const persistedAssets = data.assets.filter((asset) =>
    jobIds.has(asset.jobId)
  );
  const knownAssetIds = new Set(
    persistedAssets.flatMap((asset) =>
      asset.ownedAssetId ? [asset.id, asset.ownedAssetId] : [asset.id]
    )
  );
  const assets = [
    ...persistedAssets,
    ...(kind === 'Job'
      ? []
      : composedVideoAssets.filter(
          (asset) => workIds.has(asset.workId) && !knownAssetIds.has(asset.id)
        )),
  ];
  const contents = data.contents.filter((content) => jobIds.has(content.jobId));
  const media = canonicalMediaForAssetIds(
    assets,
    [],
    assets.map((asset) => asset.id)
  );

  if (works.length === 0 || (kind === 'Job' && jobs.length === 0)) {
    return (
      <StatePanel
        kind="empty"
        title={legacy_projection_not_found_title()}
        description={legacy_projection_not_found_description()}
      />
    );
  }

  const workStates = new Map(
    works.map((work) => [
      work.id,
      creativeWorkProjectionState(work, data.jobs, contentPackages),
    ])
  );
  const mappedPackages = Array.from(workStates.values())
    .flatMap((state) =>
      state.kind === 'content_package' ? [state.contentPackage] : []
    )
    .filter(
      (contentPackage, index, all) =>
        all.findIndex((candidate) => candidate.id === contentPackage.id) ===
        index
    );
  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        {works.map((work) => {
          const display = creativeWorkDisplay(work, templates, catalogLoaded);
          const projection = workStates.get(work.id)!;
          return (
            <Card key={work.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {legacy_projection_kind_work()}
                    </p>
                    <CardTitle className="mt-1 text-base">
                      {display.title}
                    </CardTitle>
                  </div>
                  <LegacyProjectionStatus state={projection} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {work.mode === 'agent'
                      ? legacy_projection_mode_agent()
                      : creative_object_mode_direct()}
                  </Badge>
                  <Badge variant="outline">
                    {creative_object_source_count({
                      count: work.sourceReferences.length,
                    })}
                  </Badge>
                  {work.derivedFrom ? (
                    <Badge variant="outline">
                      {creative_object_derived_version()}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-4">
                  {projection.kind === 'content_package' ? (
                    <ContentPackageLink
                      packageId={projection.contentPackage.id}
                    />
                  ) : null}
                  {kind !== 'Session' ? (
                    <a
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      href={getPathWithLocale(
                        `/dashboard/sessions/${encodeURIComponent(work.sessionId)}`
                      )}
                    >
                      {legacy_projection_open_session()}
                    </a>
                  ) : null}
                  {kind !== 'Work' ? (
                    <a
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      href={getPathWithLocale(
                        `/dashboard/results/${encodeURIComponent(work.id)}`
                      )}
                    >
                      {legacy_projection_open_work()}
                    </a>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {jobs.map((job) => {
          const projection =
            workStates.get(job.workId) ?? legacyRecordProjectionState();
          return (
            <Card key={job.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {legacy_projection_kind_job()}
                    </p>
                    <CardTitle className="mt-1 text-base">
                      {creativeOutputLabel(
                        job.contract.operation,
                        job.contract.outputCount,
                        job.contract.aspectRatio
                      )}
                    </CardTitle>
                  </div>
                  <LegacyProjectionStatus state={projection} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Badge variant="outline">
                  {creativeOperationLabel(job.contract.operation)}
                </Badge>
                <p className="text-muted-foreground">
                  {legacy_projection_result_count({
                    assets: job.outputAssetIds.length,
                    contents: job.outputContentIds.length,
                  })}
                </p>
                <div className="flex flex-wrap gap-4">
                  {projection.kind === 'content_package' ? (
                    <ContentPackageLink
                      packageId={projection.contentPackage.id}
                    />
                  ) : null}
                  {kind !== 'Job' ? (
                    <a
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      href={getPathWithLocale(
                        `/dashboard/jobs/${encodeURIComponent(job.id)}`
                      )}
                    >
                      {legacy_projection_open_job()}
                    </a>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {mappedPackages.length > 0 ? (
        <section
          aria-labelledby="creative-object-results"
          className="space-y-3"
        >
          <div>
            <h2
              id="creative-object-results"
              className="text-base font-semibold"
            >
              {legacy_projection_package_results_title()}
            </h2>
            <p className="text-sm text-muted-foreground">
              {legacy_projection_package_results_description()}
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {mappedPackages.map((contentPackage) => {
              const state = Array.from(workStates.values()).find(
                (candidate) =>
                  candidate.kind === 'content_package' &&
                  candidate.contentPackage.id === contentPackage.id
              )!;
              return (
                <li className="rounded-xl border p-4" key={contentPackage.id}>
                  <LegacyProjectionStatus state={state} />
                  <ContentPackageLink
                    className="mt-3"
                    packageId={contentPackage.id}
                    primary
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section
          aria-labelledby="creative-object-results"
          className="space-y-3"
        >
          <div>
            <h2
              id="creative-object-results"
              className="text-base font-semibold"
            >
              {legacy_projection_results_title()}
            </h2>
            <p className="text-sm text-muted-foreground">
              {legacy_projection_result_count({
                assets: assets.length,
                contents: contents.length,
              })}
            </p>
          </div>
          <CanonicalMediaGallery media={media} />
          {assets.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {assets.map((asset) => (
                <li key={asset.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{asset.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {asset.kind === 'video'
                      ? canonical_media_kind_video()
                      : asset.kind === 'image'
                        ? canonical_media_kind_image()
                        : canonical_media_kind_text()}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {legacy_projection_results_empty()}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function LegacyProjectionStatus({
  state,
}: {
  state: LegacyContentPackageState;
}) {
  return (
    <div className="space-y-1">
      <Badge variant="outline">{state.label}</Badge>
      {state.description !== state.label ? (
        <p className="max-w-md text-xs leading-5 text-muted-foreground">
          {state.description}
        </p>
      ) : null}
    </div>
  );
}

function ContentPackageLink({
  className,
  packageId,
  primary = false,
}: {
  className?: string;
  packageId: string;
  primary?: boolean;
}) {
  return (
    <a
      className={
        primary
          ? buttonVariants({ className })
          : `font-medium text-primary underline-offset-4 hover:underline ${className ?? ''}`
      }
      href={getPathWithLocale(
        `/dashboard/content?packageId=${encodeURIComponent(packageId)}`
      )}
    >
      {legacy_projection_open_package()}
    </a>
  );
}

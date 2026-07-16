import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { ObjectEvidence } from '@/components/uiux/object-evidence';
import { ProductStatus } from '@/components/uiux/product-status';
import { StatePanel } from '@/components/uiux/state-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  canonical_history_retry,
  canonical_history_session_title,
  canonical_media_kind_image,
  canonical_media_kind_text,
  canonical_media_kind_video,
  creative_object_derived_version,
  creative_object_error_description,
  creative_object_error_title,
  creative_object_job_description,
  creative_object_job_title,
  creative_object_loading_description,
  creative_object_loading_title,
  creative_object_mode_agent,
  creative_object_mode_direct,
  creative_object_model,
  creative_object_model_fixed,
  creative_object_not_found_description,
  creative_object_not_found_title,
  creative_object_open_job,
  creative_object_open_session,
  creative_object_open_work,
  creative_object_operation,
  creative_object_persisted_result_count,
  creative_object_persisted_results,
  creative_object_quote,
  creative_object_quote_confirmed,
  creative_object_result_count,
  creative_object_results,
  creative_object_results_empty,
  creative_object_session_description,
  creative_object_source_count,
  creative_object_work_description,
  creative_object_work_title,
  object_evidence_kind_job,
  object_evidence_kind_work,
  p1_admin_model_operation_audio_sfx,
  p1_admin_model_operation_audio_speech,
  p1_admin_model_operation_copy,
  p1_admin_model_operation_image_edit,
  p1_admin_model_operation_image_generate,
  p1_admin_model_operation_video,
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
import { Link } from '@tanstack/react-router';
import { CanonicalMediaGallery } from './canonical-media-gallery';
import {
  canonicalMediaForAssetIds,
  composedVideoCanonicalAssets,
} from './canonical-history-model';
import type { CreationCatalogResponse } from './creation-catalog-model';
import { useVideoWorkflowListObserver } from './creative-job-observer';
import { creativeWorkDisplay } from './creative-work-display';
import { creativeOutputLabel } from './creative-quote';

type CreativeObjectKind = 'Session' | 'Work' | 'Job';

const pageCopy: Record<
  CreativeObjectKind,
  { description: () => string; title: () => string }
> = {
  Session: {
    description: creative_object_session_description,
    title: canonical_history_session_title,
  },
  Work: {
    description: creative_object_work_description,
    title: creative_object_work_title,
  },
  Job: {
    description: creative_object_job_description,
    title: creative_object_job_title,
  },
};

const OPERATION_LABELS = {
  'copy.adapt': p1_admin_model_operation_copy,
  'copy.generate': p1_admin_model_operation_copy,
  'image.edit': p1_admin_model_operation_image_edit,
  'image.generate': p1_admin_model_operation_image_generate,
  'video.generate': p1_admin_model_operation_video,
  'audio.speech': p1_admin_model_operation_audio_speech,
  'audio.sfx': p1_admin_model_operation_audio_sfx,
} as const;

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
      videoWorkflowsQuery.isLoading ? (
        <StatePanel
          kind="loading"
          title={creative_object_loading_title()}
          description={creative_object_loading_description()}
        />
      ) : null}
      {query.isError || videoWorkflowsQuery.isError ? (
        <StatePanel
          kind="error"
          title={creative_object_error_title()}
          description={creative_object_error_description()}
          actionLabel={canonical_history_retry()}
          onAction={() => {
            void query.refetch();
            void videoWorkflowsQuery.refetch();
          }}
        />
      ) : null}
      {query.data && !videoWorkflowsQuery.isLoading ? (
        <CreativeObjectProjection
          catalogLoaded={Boolean(creationCatalogQuery.data)}
          data={query.data}
          id={id}
          kind={kind}
          composedVideoAssets={composedVideoCanonicalAssets(
            videoWorkflowsQuery.data ?? []
          )}
          templates={templates}
        />
      ) : null}
    </DashboardLayout>
  );
}

function CreativeObjectProjection({
  catalogLoaded,
  composedVideoAssets,
  data,
  id,
  kind,
  templates,
}: {
  catalogLoaded: boolean;
  composedVideoAssets: CreativeAssetProjection[];
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
        title={creative_object_not_found_title()}
        description={creative_object_not_found_description()}
      />
    );
  }

  const evidenceKind = kind === 'Session' ? 'Session' : kind;
  return (
    <div className="space-y-5">
      <ObjectEvidence id={id} kind={evidenceKind} />
      <div className="grid gap-4 xl:grid-cols-2">
        {works.map((work) => {
          const display = creativeWorkDisplay(work, templates, catalogLoaded);
          return (
            <Card key={work.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {object_evidence_kind_work()}
                    </p>
                    <CardTitle className="mt-1 text-base">
                      {display.title}
                    </CardTitle>
                  </div>
                  <ProductStatus status={work.status} showExplanation />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {work.mode === 'agent'
                      ? creative_object_mode_agent()
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
                  <Link
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    to="/dashboard/sessions/$sessionId"
                    params={{ sessionId: work.sessionId }}
                  >
                    {creative_object_open_session()}
                  </Link>
                  <Link
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    to="/dashboard/works/$workId"
                    params={{ workId: work.id }}
                  >
                    {creative_object_open_work()}
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {jobs.map((job) => (
          <Card key={job.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {object_evidence_kind_job()}
                  </p>
                  <CardTitle className="mt-1 text-base">
                    {creativeOutputLabel(
                      job.contract.operation,
                      job.contract.outputCount,
                      job.contract.aspectRatio
                    )}
                  </CardTitle>
                </div>
                <ProductStatus status={job.status} showExplanation />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">
                  {creative_object_model()}
                </dt>
                <dd>{creative_object_model_fixed()}</dd>
                <dt className="text-muted-foreground">
                  {creative_object_operation()}
                </dt>
                <dd>{OPERATION_LABELS[job.contract.operation]()}</dd>
                <dt className="text-muted-foreground">
                  {creative_object_quote()}
                </dt>
                <dd>{creative_object_quote_confirmed()}</dd>
                <dt className="text-muted-foreground">
                  {creative_object_results()}
                </dt>
                <dd>
                  {creative_object_result_count({
                    assets: job.outputAssetIds.length,
                    contents: job.outputContentIds.length,
                  })}
                </dd>
              </dl>
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                to="/dashboard/jobs/$jobId"
                params={{ jobId: job.id }}
              >
                {creative_object_open_job()}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
      <section aria-labelledby="creative-object-results" className="space-y-3">
        <div>
          <h2 id="creative-object-results" className="text-base font-semibold">
            {creative_object_persisted_results()}
          </h2>
          <p className="text-sm text-muted-foreground">
            {creative_object_persisted_result_count({
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
            {creative_object_results_empty()}
          </p>
        )}
      </section>
    </div>
  );
}

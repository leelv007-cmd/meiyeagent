import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import {
  canonical_object_breadcrumb,
  canonical_object_description,
  canonical_object_loading_description,
  canonical_object_loading_title,
  canonical_object_title,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { useQuery } from '@tanstack/react-query';
import { CanvasWorkPage } from './canvas-work-page';
import { CanvasImageJobDetailPage } from './canonical-history-page';
import type { RawCanonicalHistory } from './canonical-history-model';
import { CreativeObjectPage } from './creative-object-page';
import type { QuickEditExportUseDelivery } from '@meiye/contracts';

type LightComposerDelivery = Extract<
  QuickEditExportUseDelivery,
  { kind: 'light_composer' }
>;

function LoadingObject() {
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: product_navigation_workbench(), isCurrentPage: false },
        { label: canonical_object_breadcrumb(), isCurrentPage: true },
      ]}
      description={canonical_object_description()}
      title={canonical_object_title()}
    >
      <StatePanel
        kind="loading"
        title={canonical_object_loading_title()}
        description={canonical_object_loading_description()}
      />
    </DashboardLayout>
  );
}

export function CanonicalWorkRoutePage({
  exportUseDelivery,
  workId,
}: {
  exportUseDelivery?: LightComposerDelivery;
  workId: string;
}) {
  const history = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  if (history.isLoading) return <LoadingObject />;
  if (history.data?.canvasWorks.some((work) => work.id === workId)) {
    return (
      <CanvasWorkPage exportUseDelivery={exportUseDelivery} workId={workId} />
    );
  }
  return <CreativeObjectPage id={workId} kind="Work" />;
}

export function CanonicalJobRoutePage({ jobId }: { jobId: string }) {
  const history = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  if (history.isLoading) return <LoadingObject />;
  if (history.data?.imageJobs.some((job) => job.id === jobId)) {
    return <CanvasImageJobDetailPage jobId={jobId} />;
  }
  return <CreativeObjectPage id={jobId} kind="Job" />;
}

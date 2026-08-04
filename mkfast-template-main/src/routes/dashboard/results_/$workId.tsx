import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import { ResultCenterPage } from '@/product/results/result-center-page';
import {
  parseResultCenterSearch,
  type ResultCenterSearch,
} from '@/product/results/result-center-search';
import { useResultCenterView } from '@/product/results/use-result-center-view';
import { createFileRoute } from '@tanstack/react-router';

export type { ResultCenterSearch } from '@/product/results/result-center-search';

export const Route = createFileRoute('/dashboard/results_/$workId')({
  validateSearch: (search: Record<string, unknown>): ResultCenterSearch =>
    parseResultCenterSearch(search),
  component: ResultCenterRoutePage,
});

function ResultCenterRoutePage() {
  const { workId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const result = useResultCenterView(workId, search, navigate);

  if (result.status === 'loading') {
    return (
      <DashboardLayout
        breadcrumbs={[]}
        description={result.description}
        title="结果中心"
      >
        <StatePanel
          kind="loading"
          title={result.title}
          description={result.detail}
        />
      </DashboardLayout>
    );
  }

  if (result.status === 'error') {
    return (
      <DashboardLayout
        breadcrumbs={[]}
        description="结果读取失败"
        title="结果中心"
      >
        <StatePanel
          kind="error"
          title="暂时无法读取结果"
          description="请稍后重试。"
        />
      </DashboardLayout>
    );
  }

  return <ResultCenterPage {...result.view} />;
}

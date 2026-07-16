import { UnifiedCreationWorkbench } from '@/product/unified-creation-workbench';
import { MobileActionBook } from '@/product/mobile-action-book';
import { useIsMobile } from '@/hooks/use-mobile';
import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

interface DashboardSearch {
  entry?: 'feishu' | 'notification';
  packageId?: string;
  stage?: 'action' | 'progress' | 'handoff';
  view?: 'recent' | 'works';
  workId?: string;
}

export const Route = createFileRoute('/dashboard/')({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    ...(search.entry === 'feishu' || search.entry === 'notification'
      ? { entry: search.entry }
      : {}),
    ...(typeof search.packageId === 'string' && search.packageId.length > 0
      ? { packageId: search.packageId }
      : {}),
    ...(search.stage === 'action' ||
    search.stage === 'progress' ||
    search.stage === 'handoff'
      ? { stage: search.stage }
      : {}),
    ...(search.view === 'recent' || search.view === 'works'
      ? { view: search.view }
      : {}),
    ...(typeof search.workId === 'string' && search.workId.length > 0
      ? { workId: search.workId }
      : {}),
  }),
  component: DashboardHome,
});

function DashboardHome() {
  const isMobile = useIsMobile();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!isMobile && search.view) {
    return <CanonicalHistoryPage mode={search.view} />;
  }
  return isMobile ? (
    <MobileActionBook
      {...search}
      onWorkIdChange={(workId) =>
        navigate({ replace: true, search: { ...search, workId } })
      }
    />
  ) : (
    <UnifiedCreationWorkbench
      workId={search.workId}
      onWorkIdChange={(workId) =>
        navigate({ replace: true, search: { ...search, workId } })
      }
    />
  );
}

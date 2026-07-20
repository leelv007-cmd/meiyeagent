import { ComposerHome } from '@/product/composer/composer-home';
import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { desktopRelayLanding } from '@/product/device-relay';
import { useIsMobile } from '@/hooks/use-mobile';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * Dashboard home — Z1 / #105 cutover.
 *
 * - Primary creation entry = Composer surface (`src/product/composer/**`)
 * - Legacy `?workId=` result bridge UNHOOKED: redirects to Result Center
 * - recent/content/tasks/notifications resolve via same deep link path
 */

interface DashboardSearch {
  catalogRecipeRevisionId?: string;
  catalogSurfaceRevisionId?: string;
  entry?: 'feishu' | 'notification';
  packageId?: string;
  stage?: 'action' | 'progress' | 'handoff';
  view?: 'recent' | 'works';
  /** @deprecated Z1: accepted only to redirect → /dashboard/results/$workId */
  workId?: string;
}

export const Route = createFileRoute('/dashboard/')({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    ...(typeof search.catalogRecipeRevisionId === 'string' &&
    search.catalogRecipeRevisionId.length > 0
      ? { catalogRecipeRevisionId: search.catalogRecipeRevisionId }
      : {}),
    ...(typeof search.catalogSurfaceRevisionId === 'string' &&
    search.catalogSurfaceRevisionId.length > 0
      ? { catalogSurfaceRevisionId: search.catalogSurfaceRevisionId }
      : {}),
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

  // Z1: unhook legacy ?workId= result bridge → canonical Result Center.
  useEffect(() => {
    if (!search.workId) return;
    void navigate({
      to: '/dashboard/results/$workId',
      params: { workId: search.workId },
      search: {},
      replace: true,
    });
  }, [navigate, search.workId]);

  // Desktop package relay landing still goes to content detail.
  const relayLanding = isMobile ? undefined : desktopRelayLanding(search);
  const relayContentId = relayLanding?.contentId;
  useEffect(() => {
    if (!relayContentId) return;
    void navigate({
      params: { contentId: relayContentId },
      replace: true,
      to: '/dashboard/content/$contentId',
    });
  }, [navigate, relayContentId]);

  if (search.workId) {
    return null;
  }

  if (!isMobile && search.view) {
    return <CanonicalHistoryPage mode={search.view} />;
  }

  if (relayContentId) {
    return null;
  }

  return (
    <ComposerHome
      initialRecipeRevisionId={search.catalogRecipeRevisionId}
      initialSurfaceRevisionId={search.catalogSurfaceRevisionId}
    />
  );
}

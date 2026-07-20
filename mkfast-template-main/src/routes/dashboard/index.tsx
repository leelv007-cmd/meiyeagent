import { UnifiedCreationWorkbench } from '@/product/unified-creation-workbench';
import { MobileActionBook } from '@/product/mobile-action-book';
import { useIsMobile } from '@/hooks/use-mobile';
import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { desktopRelayLanding } from '@/product/device-relay';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

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
  // 桌面端打开 package 接力链接时落内容详情（工作台只消费 workId）。
  // 只在客户端 effect 里跳转：SSR 阶段不知道视口，不能误伤手机扫码。
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
  if (!isMobile && search.view) {
    return <CanonicalHistoryPage mode={search.view} />;
  }
  if (relayContentId) {
    return null;
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

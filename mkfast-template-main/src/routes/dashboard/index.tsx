import { ComposerHome } from '@/product/composer/composer-home';
import {
  AI_COVER_ASPECT_RATIOS,
  AI_COVER_BEAUTY_PRESETS,
  type AiCoverAspectRatio,
  type AiCoverBeautyPreset,
} from '@/product/composer/ai-cover-action';
import { desktopRelayLanding } from '@/product/device-relay';
import { useIsMobile } from '@/hooks/use-mobile';
import { appPageHead } from '@/lib/seo';
import { product_navigation_workbench } from '@/locale/paraglide/messages';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * Dashboard home — Z1 / #105 cutover.
 *
 * - Primary creation entry = Composer surface (`src/product/composer/**`)
 * - Legacy `?workId=` result bridge UNHOOKED: redirects to Result Center
 * - recent/content/tasks/notifications resolve via same deep link path
 * - T30 / #224: the Glass sheet rides a route-level <link>, not src/styles.css.
 *   HeroUI v3's --background/--foreground/--border/--radius collide with the
 *   shadcn tokens every other page still uses, so importing it globally would
 *   restyle surfaces this ticket does not own (see components/heroui-pro/README).
 */

interface DashboardSearch {
  aiCoverAspectRatio?: AiCoverAspectRatio;
  aiCoverStyle?: AiCoverBeautyPreset;
  aiCoverTopic?: string;
  catalogRecipeRevisionId?: string;
  catalogSurfaceRevisionId?: string;
  entry?: 'feishu' | 'notification';
  /** T33 / #227: identity handed over for this Composer session only. */
  identity?: string;
  packageId?: string;
  stage?: 'action' | 'progress' | 'handoff';
  /** D-145 时间桥: reopen the conversation for one in-flight run. */
  taskId?: string;
  view?: 'recent' | 'works';
  /** @deprecated Z1: accepted only to redirect → /dashboard/results/$workId */
  workId?: string;
}

export const Route = createFileRoute('/dashboard/')({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    ...(typeof search.aiCoverAspectRatio === 'string' &&
    AI_COVER_ASPECT_RATIOS.includes(
      search.aiCoverAspectRatio as AiCoverAspectRatio
    )
      ? { aiCoverAspectRatio: search.aiCoverAspectRatio as AiCoverAspectRatio }
      : {}),
    ...(typeof search.aiCoverStyle === 'string' &&
    AI_COVER_BEAUTY_PRESETS.includes(search.aiCoverStyle as AiCoverBeautyPreset)
      ? { aiCoverStyle: search.aiCoverStyle as AiCoverBeautyPreset }
      : {}),
    ...(typeof search.aiCoverTopic === 'string' &&
    search.aiCoverTopic.trim().length > 0 &&
    search.aiCoverTopic.length <= 200
      ? { aiCoverTopic: search.aiCoverTopic.trim() }
      : {}),
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
    ...(typeof search.identity === 'string' && search.identity.length > 0
      ? { identity: search.identity }
      : {}),
    ...(typeof search.packageId === 'string' && search.packageId.length > 0
      ? { packageId: search.packageId }
      : {}),
    ...(search.stage === 'action' ||
    search.stage === 'progress' ||
    search.stage === 'handoff'
      ? { stage: search.stage }
      : {}),
    ...(typeof search.taskId === 'string' && search.taskId.length > 0
      ? { taskId: search.taskId }
      : {}),
    ...(search.view === 'recent' || search.view === 'works'
      ? { view: search.view }
      : {}),
    ...(typeof search.workId === 'string' && search.workId.length > 0
      ? { workId: search.workId }
      : {}),
  }),
  head: () => appPageHead(product_navigation_workbench()),
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

  // Desktop package relay landing goes to the content detail page, which is the
  // reshelled one since T34 / #228 — the relay carries a ContentPackage id and
  // that route resolves one directly.
  const relayLanding = isMobile ? undefined : desktopRelayLanding(search);
  const relayContentId = relayLanding?.contentId;
  useEffect(() => {
    if (!relayContentId) return;
    void navigate({
      params: { workId: relayContentId },
      replace: true,
      to: '/dashboard/works/$workId',
    });
  }, [navigate, relayContentId]);

  // D-164①: one dashboard route. `?view=` used to render a whole history page
  // in place of the workbench, which made `/dashboard` a second destination
  // wearing the first one's URL — the merchant could be on "the dashboard" and
  // see no way to create anything. Both views already have routes of their own,
  // so the parameter survives as a redirect for old links and nothing else.
  useEffect(() => {
    if (!search.view) return;
    void navigate({
      to: search.view === 'recent' ? '/dashboard/recent' : '/dashboard/works',
      replace: true,
    });
  }, [navigate, search.view]);

  if (search.workId) {
    return null;
  }

  if (search.view) {
    return null;
  }

  if (relayContentId) {
    return null;
  }

  return (
    <ComposerHome
      {...(search.aiCoverAspectRatio && search.aiCoverStyle
        ? {
            initialAiCover: {
              aspectRatio: search.aiCoverAspectRatio,
              style: search.aiCoverStyle,
              ...(search.aiCoverTopic
                ? { topicHint: search.aiCoverTopic }
                : {}),
            },
          }
        : {})}
      initialRecipeRevisionId={search.catalogRecipeRevisionId}
      initialSessionIdentityId={search.identity}
      initialSurfaceRevisionId={search.catalogSurfaceRevisionId}
      initialTaskId={search.taskId}
    />
  );
}

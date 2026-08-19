import { ComposerHome } from '@/product/composer/composer-home';
import { authClient } from '@/auth/client';
import {
  AI_COVER_ASPECT_RATIOS,
  AI_COVER_BEAUTY_PRESETS,
  type AiCoverAspectRatio,
  type AiCoverBeautyPreset,
} from '@/product/composer/ai-cover-action';
import {
  canonicalDeepLinkRedirectHref,
  parseDeepLinkEntry,
  parseDeepLinkStage,
  resolveCanonicalDeepLink,
} from '@/product/canonical-deep-link';
import { CanonicalDeepLinkUnavailable } from '@/product/canonical-deep-link-unavailable';
import { appPageHead } from '@/lib/seo';
import { product_navigation_workbench } from '@/locale/paraglide/messages';
import { createFileRoute, redirect } from '@tanstack/react-router';

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
  contentId?: string;
  entry?: 'feishu' | 'notification';
  handoffId?: string;
  /** T33 / #227: identity handed over for this Composer session only. */
  identity?: string;
  packageId?: string;
  stage?: 'action' | 'progress' | 'handoff';
  /** D-145 时间桥: reopen the conversation for one in-flight run. */
  taskId?: string;
  /**
   * V31-05 / V3.1 §4: explicit Thread-root target. Wins over auto-resume
   * from WorkbenchSessionProjection.
   */
  threadId?: string;
  view?: 'recent' | 'works';
  /** @deprecated Z1: accepted only to redirect → /dashboard/results/$workId */
  workId?: string;
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
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
    ...(optionalId(search.contentId)
      ? { contentId: optionalId(search.contentId) }
      : {}),
    ...(parseDeepLinkEntry(search.entry)
      ? { entry: parseDeepLinkEntry(search.entry) }
      : {}),
    ...(optionalId(search.handoffId)
      ? { handoffId: optionalId(search.handoffId) }
      : {}),
    ...(typeof search.identity === 'string' && search.identity.length > 0
      ? { identity: search.identity }
      : {}),
    ...(optionalId(search.packageId)
      ? { packageId: optionalId(search.packageId) }
      : {}),
    ...(parseDeepLinkStage(search.stage)
      ? { stage: parseDeepLinkStage(search.stage) }
      : {}),
    ...(optionalId(search.taskId) ? { taskId: optionalId(search.taskId) } : {}),
    ...(typeof search.threadId === 'string' && search.threadId.length > 0
      ? { threadId: search.threadId }
      : {}),
    ...(search.view === 'recent' || search.view === 'works'
      ? { view: search.view }
      : {}),
    ...(optionalId(search.workId) ? { workId: optionalId(search.workId) } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.view === 'recent' || search.view === 'works') {
      throw redirect({
        href:
          search.view === 'recent' ? '/dashboard/recent' : '/dashboard/works',
        replace: true,
      });
    }
    const destination = resolveCanonicalDeepLink({
      pathname: '/dashboard',
      search,
    });
    const href = canonicalDeepLinkRedirectHref('/dashboard', destination);
    if (href) {
      throw redirect({ href, replace: true });
    }
  },
  head: () => appPageHead(product_navigation_workbench()),
  component: DashboardHome,
});

function DashboardHome() {
  const { data: authSession } = authClient.useSession();
  const search = Route.useSearch();
  const destination = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search,
  });

  if (destination.consumer === 'historical_unavailable') {
    return <CanonicalDeepLinkUnavailable destination={destination} />;
  }

  return (
    <ComposerHome
      accountId={authSession?.user.id ?? null}
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
      initialThreadId={search.threadId}
    />
  );
}

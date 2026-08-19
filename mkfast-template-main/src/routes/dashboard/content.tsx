/**
 * 旧内容库路由壳 — T34 / #228 + LINK-01 / R-P1-09.
 *
 * 一级导航「内容」now lands on the reshelled content surface (`/dashboard/works`).
 * This path survives so links already in the wild keep working.
 *
 * `?packageId=` maps one-to-one onto the works archive. Legacy `?contentId=`
 * and `?handoffId=` are historical ProductState ids with no ContentPackage
 * counterpart — they render explicit unavailable and never pretend to be
 * the content list or default Composer.
 */

import {
  canonicalDeepLinkRedirectHref,
  parseDeepLinkEntry,
  parseDeepLinkStage,
  resolveCanonicalDeepLink,
} from '@/product/canonical-deep-link';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import { CanonicalDeepLinkUnavailable } from '@/product/canonical-deep-link-unavailable';
import { optionalSourceId } from '@/p1/source-object-navigation';

export const Route = createFileRoute('/dashboard/content')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(optionalSourceId(search.contentId)
      ? { contentId: optionalSourceId(search.contentId) }
      : {}),
    ...(parseDeepLinkEntry(search.entry)
      ? { entry: parseDeepLinkEntry(search.entry) }
      : {}),
    ...(optionalSourceId(search.handoffId)
      ? { handoffId: optionalSourceId(search.handoffId) }
      : {}),
    ...(optionalSourceId(search.packageId)
      ? { packageId: optionalSourceId(search.packageId) }
      : {}),
    ...(parseDeepLinkStage(search.stage)
      ? { stage: parseDeepLinkStage(search.stage) }
      : {}),
  }),
  beforeLoad: ({ search }) => {
    if (
      !search.packageId &&
      !search.contentId &&
      !search.handoffId &&
      !search.stage &&
      !search.entry
    ) {
      throw redirect({ href: resolveLegacyRedirect('/dashboard/content')! });
    }
    const destination = resolveCanonicalDeepLink({
      pathname: '/dashboard/content',
      search,
    });
    const href = canonicalDeepLinkRedirectHref(
      '/dashboard/content',
      destination
    );
    if (href) {
      throw redirect({ href, replace: true });
    }
  },
  component: LegacyContentDeepLink,
});

function LegacyContentDeepLink() {
  const search = Route.useSearch();
  const destination = resolveCanonicalDeepLink({
    pathname: '/dashboard/content',
    search,
  });
  if (destination.consumer === 'historical_unavailable') {
    return <CanonicalDeepLinkUnavailable destination={destination} />;
  }
  return null;
}

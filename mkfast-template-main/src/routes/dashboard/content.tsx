/**
 * 旧内容库路由壳 — T34 / #228.
 *
 * 一级导航「内容」now lands on the reshelled content surface (`/dashboard/works`).
 * This path survives only so links already in the wild keep working; it renders
 * nothing of its own, which is what makes the old library surface零路由引用 for
 * T38's delete batch (D-127 无双轨期).
 *
 * `?packageId=` keeps its target: the new detail route resolves a ContentPackage
 * id directly, so the address maps one-to-one. The legacy `?contentId=` and
 * `?handoffId=` addresses point at 旧世界 ProductState rows that have no
 * ContentPackage counterpart, so they land on the list rather than on a page
 * claiming to be that object.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import { optionalSourceId } from '@/p1/source-object-navigation';

export const Route = createFileRoute('/dashboard/content')({
  validateSearch: (search: Record<string, unknown>) => {
    const packageId = optionalSourceId(search.packageId);
    return packageId ? { packageId } : {};
  },
  beforeLoad: ({ search }) => {
    if (search.packageId) {
      throw redirect({
        to: '/dashboard/works/$workId',
        params: { workId: search.packageId },
      });
    }
    throw redirect({ href: resolveLegacyRedirect('/dashboard/content')! });
  },
});
